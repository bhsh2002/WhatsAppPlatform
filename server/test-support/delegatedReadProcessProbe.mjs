// Private child-process probe: only a fresh synthetic database path and a mode
// are arguments. Cipher material arrives over stdin and is never returned.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { SqliteDelegatedReadBindings } from '../services/delegatedReadSessionStore.js';

const start = Date.parse('2026-11-17T10:00:00Z');
const principal = { userId: 1, tenantId: 1, sessionId: 'synthetic-process-jti', authVersion: 0,
    sessionExpiresAt: start / 1000 + 300 };
const readCredentials = { accessToken: 'synthetic-process-read-token', expiresAt: '2026-11-17T11:00:00Z',
    centralActorId: 'synthetic-actor', consumerAccountId: 'synthetic-consumer', consumerInstallationId: 'synthetic-installation',
    scope: { organization_id: 'synthetic-organization', activity_id: 'synthetic-activity' } };
const identity = { accessToken: 'synthetic-process-identity-token', expiresAt: '2026-11-17T11:00:00Z',
    actorId: 'synthetic-actor', organizationId: 'synthetic-organization' };
const intent = { operation: 'read_request_create', idempotencyKey: 'synthetic-process-intent',
    payload: { scope: { organization_id: 'synthetic-organization', activity_id: 'synthetic-activity' }, fields: ['name'] } };
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

try {
    let privateInput = '';
    for await (const chunk of process.stdin) {
        privateInput += chunk;
        if (privateInput.length > 4096) throw new Error('Oversized private input');
    }
    const { keyHex } = JSON.parse(privateInput);
    privateInput = '';
    assert.match(keyHex, /^[0-9a-f]{64}$/);
    assert.equal(process.argv.some(value => value.includes(keyHex)), false);
    assert.equal(Object.values(process.env).some(value => String(value).includes(keyHex)), false);
    const key = Buffer.from(keyHex, 'hex');
    const encryption = {
        encrypt(plaintext) {
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
            return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
        },
        decrypt(encoded) {
            const bytes = Buffer.from(encoded, 'base64');
            const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
            cipher.setAuthTag(bytes.subarray(12, 28));
            return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
        },
    };
    let remoteDispatchAttempts = 0;
    globalThis.fetch = () => { remoteDispatchAttempts++; throw new Error('No network in durability probe'); };
    const [filename, mode] = process.argv.slice(2);
    assert.ok(['write-and-exit', 'read-sessions', 'inspect-intent'].includes(mode));
    const database = new Database(filename, { fileMustExist: true });
    database.pragma('foreign_keys = ON');
    let now = start;
    const store = new SqliteDelegatedReadBindings({ database, encryption, now: () => now });
    const report = { mode, pid: process.pid, runtime: process.execPath, key_source: 'stdin', remote_dispatch_attempts: 0 };
    if (mode === 'write-and-exit') {
        store.saveOwnerSession(principal, identity);
        store.bind(principal, readCredentials);
        const recorded = store.prepareAction(principal, intent);
        assert.equal(store.claimAction(principal, recorded.id), true);
        report.committed = true;
        report.intent_id = recorded.id;
        report.state = store.action(principal, recorded.id).state;
        report.database_closed_explicitly = false;
    } else if (mode === 'read-sessions') {
        const savedIdentity = store.ownerSession(principal);
        const savedRead = store.load(principal);
        assert.equal(savedIdentity.accessToken, identity.accessToken);
        assert.equal(savedIdentity.actorId, identity.actorId);
        assert.equal(savedIdentity.organizationId, identity.organizationId);
        assert.equal(savedRead.accessToken, readCredentials.accessToken);
        assert.deepEqual(savedRead.scope, readCredentials.scope);
        assert.equal(savedRead.centralActorId, readCredentials.centralActorId);
        assert.equal(savedRead.expiresAt, new Date(principal.sessionExpiresAt * 1000).toISOString());
        assert.equal(savedIdentity.expiresAt, savedRead.expiresAt);
        assert.equal(store.current(principal, savedRead), true);
        assert.equal(store.ownerCurrent(principal, savedIdentity), true);
        for (const other of [{ ...principal, userId: 2 }, { ...principal, tenantId: 2 },
            { ...principal, sessionId: 'different-synthetic-jti' }, { ...principal, authVersion: 1 }]) {
            assert.equal(store.load(other), null);
            assert.equal(store.ownerSession(other), null);
        }
        now = principal.sessionExpiresAt * 1000;
        assert.equal(store.load(principal), null);
        assert.equal(store.ownerSession(principal), null);
        assert.equal(store.current(principal, savedRead), false);
        assert.equal(store.ownerCurrent(principal, savedIdentity), false);
        assert.equal(store.summary(principal).state, 'expired');
        assert.equal(store.ownerSummary(principal).state, 'expired');
        report.identity_and_read_restored = true;
        report.principal_boundaries_checked = 4;
        report.expired_at_exact_local_session_boundary = true;
    } else {
        const row = database.prepare('SELECT * FROM savana_operational_read_actions').get();
        const before = { ...row };
        const recorded = store.action(principal, row.id);
        assert.equal(recorded.state, 'inflight');
        assert.deepEqual(recorded.payload, intent.payload);
        assert.equal(recorded.result, null);
        assert.equal(store.prepareAction(principal, intent).id, row.id);
        assert.equal(store.claimAction(principal, row.id), false);
        assert.throws(() => store.prepareAction(principal, { ...intent, payload: { fields: ['description'] } }),
            { code: 'shared_read_action_content_conflict' });
        assert.equal(store.action({ ...principal, sessionId: 'different-synthetic-jti' }, row.id), undefined);
        assert.deepEqual(database.prepare('SELECT * FROM savana_operational_read_actions').get(), before);
        report.intent_id = row.id;
        report.state = recorded.state;
        report.uncertain_after_exit = true;
        report.reclaimed = false;
        report.immutable_record_sha256 = digest(JSON.stringify(before));
    }
    report.remote_dispatch_attempts = remoteDispatchAttempts;
    // Deliberately omit database.close(): the writer exits after synchronous
    // commits. A later process must reopen the file, not reuse a live handle.
    process.stdout.write(`${JSON.stringify(report)}\n`, () => process.exit(0));
} catch {
    // Assertion details can contain decrypted values; return only a fixed code.
    process.stderr.write('Synthetic delegated-read process probe failed\n');
    process.exit(2);
}
