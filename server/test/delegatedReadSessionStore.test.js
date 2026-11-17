import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SqliteDelegatedReadBindings } from '../services/delegatedReadSessionStore.js';
import { runMigrationsSync } from '../db/migrator.js';
import { seedSavanaUpgrade, sourceState } from '../test-support/savanaMigrationFixture.js';

const cipher = () => {
    const key = crypto.randomBytes(32);
    return {
        encrypt(value) {
            const iv = crypto.randomBytes(12);
            const aes = crypto.createCipheriv('aes-256-gcm', key, iv);
            const body = Buffer.concat([aes.update(value), aes.final()]);
            return Buffer.concat([iv, aes.getAuthTag(), body]).toString('base64');
        },
        decrypt(value) {
            const body = Buffer.from(value, 'base64');
            const aes = crypto.createDecipheriv('aes-256-gcm', key, body.subarray(0, 12));
            aes.setAuthTag(body.subarray(12, 28));
            return Buffer.concat([aes.update(body.subarray(28)), aes.final()]).toString();
        },
    };
};
const start = Date.parse('2026-11-17T10:00:00Z');
const principal = { userId: 1, tenantId: 1, sessionId: 'synthetic-local-jti', authVersion: 0, sessionExpiresAt: start / 1000 + 300 };
const credentials = { accessToken: 'synthetic-central-secret-never-plaintext', expiresAt: '2026-11-17T11:00:00Z',
    centralActorId: 'central-actor', consumerAccountId: 'wa-account', consumerInstallationId: 'wa-install',
    scope: { organization_id: 'synthetic-org', activity_id: 'synthetic-activity' } };
const fixture = (t, filename = ':memory:') => {
    const database = new Database(filename);
    seedSavanaUpgrade(database);
    const before = sourceState(database);
    runMigrationsSync(database);
    database.exec(`INSERT INTO users(id,username,password_hash,role,tenant_id,is_active,auth_version)
        VALUES(1,'synthetic-owner','unused','tenant',1,1,0),(2,'synthetic-employee','unused','tenant',1,1,0);`);
    t.after(() => { if (database.open) database.close(); });
    let clock = start;
    const encryption = cipher();
    const store = new SqliteDelegatedReadBindings({ database, encryption, now: () => clock });
    return { database, before, store, encryption, setClock: value => { clock = value; } };
};

test('058 preserves existing source/identity data and begins with no owner sessions, bindings or grants', t => {
    const f = fixture(t);
    assert.deepEqual(sourceState(f.database), f.before);
    assert.equal(f.store.load(principal), null);
    assert.equal(f.store.ownerSession(principal), null);
    assert.deepEqual(f.store.summary(principal), { state: 'disconnected' });
    assert.deepEqual(f.database.pragma('foreign_key_check'), []);
});

test('owner OIDC connection alone grants no shared read binding and secrets are ciphertext only', t => {
    const f = fixture(t);
    f.store.saveOwnerSession(principal, { accessToken: credentials.accessToken, expiresAt: credentials.expiresAt });
    assert.equal(f.store.ownerSummary(principal).state, 'connected');
    assert.equal(f.store.ownerSession(principal).accessToken, credentials.accessToken);
    assert.equal(f.store.load(principal), null);
    assert.equal(JSON.stringify(f.database.prepare('SELECT * FROM savana_operational_owner_sessions').all()).includes(credentials.accessToken), false);
    assert.equal(JSON.stringify(f.store.ownerSummary(principal)).includes(credentials.accessToken), false);
});

test('delegated binding survives reopening, expires with its local JWT and invalidates old generations', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-vault-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'synthetic.db');
    const f = fixture(t, filename);
    f.store.bind(principal, credentials);
    const old = f.store.load(principal);
    assert.equal(old.expiresAt, '2026-11-17T10:05:00.000Z');
    const other = new Database(filename);
    t.after(() => other.close());
    const reopened = new SqliteDelegatedReadBindings({ database: other, encryption: f.encryption, now: () => start });
    assert.equal(reopened.load(principal).accessToken, credentials.accessToken);
    reopened.bind(principal, { ...credentials, accessToken: 'new-synthetic-central-token' });
    assert.equal(f.store.current(principal, old), false);
    assert.equal(f.store.load(principal).accessToken, 'new-synthetic-central-token');
    f.setClock(start + 301000);
    assert.equal(f.store.load(principal), null);
    assert.equal(f.store.summary(principal).state, 'expired');
    assert.equal(f.database.prepare('SELECT COUNT(*) count FROM savana_delegated_read_sessions').get().count, 1);
});

test('ciphertext cannot be moved between employees or between owner and read purposes', t => {
    const f = fixture(t);
    const employee = { ...principal, userId: 2 };
    f.store.bind(principal, credentials);
    f.store.bind(employee, { ...credentials, accessToken: 'employee-only-read-token' });
    const ownerCipher = f.database.prepare('SELECT encrypted_credentials FROM savana_delegated_read_sessions WHERE user_id=1').get().encrypted_credentials;
    f.database.prepare('UPDATE savana_delegated_read_sessions SET encrypted_credentials=? WHERE user_id=2').run(ownerCipher);
    assert.equal(f.store.load(employee), null);
    assert.equal(f.store.load({ ...principal, authVersion: 1 }), null);
    f.store.saveOwnerSession(principal, { ...credentials, accessToken: 'owner-control-purpose-only' });
    const controlCipher = f.database.prepare('SELECT encrypted_session FROM savana_operational_owner_sessions').get().encrypted_session;
    f.database.prepare('UPDATE savana_delegated_read_sessions SET encrypted_credentials=? WHERE user_id=1').run(controlCipher);
    assert.equal(f.store.load(principal), null);
});

test('local read disconnect preserves audit/history and does not revoke owner access or claim central revocation', t => {
    const f = fixture(t);
    f.store.bind(principal, credentials);
    f.store.saveOwnerSession(principal, { accessToken: 'owner-token', expiresAt: credentials.expiresAt });
    const old = f.store.load(principal);
    f.store.revoke(principal);
    assert.equal(f.store.load(principal), null);
    assert.equal(f.store.current(principal, old), false);
    assert.equal(f.store.ownerSession(principal).accessToken, 'owner-token');
    assert.equal(f.database.prepare('SELECT encrypted_credentials FROM savana_delegated_read_sessions').get().encrypted_credentials, null);
    assert.equal(f.database.prepare('SELECT COUNT(*) count FROM savana_delegated_read_sessions').get().count, 1);
    assert.ok(f.database.prepare('SELECT action FROM savana_delegated_read_audit ORDER BY id DESC').get().action.includes('not_central_grant_revoke'));
});

test('PKCE flow state is one-use, principal-bound, encrypted and preserves an uncertain outcome', t => {
    const f = fixture(t);
    const flow = f.store.beginFlow(principal, { verifier: 'private-pkce-verifier', nonce: 'private-nonce' });
    const row = f.database.prepare('SELECT * FROM savana_delegated_read_flows').get();
    assert.equal(JSON.stringify(row).includes(flow.state), false);
    assert.equal(JSON.stringify(row).includes('private-pkce-verifier'), false);
    assert.throws(() => f.store.consumeFlow({ ...principal, userId: 2 }, flow.state), { code: 'shared_read_authorization_state_invalid' });
    const consumed = f.store.consumeFlow(principal, flow.state);
    assert.equal(consumed.flow.verifier, 'private-pkce-verifier');
    assert.throws(() => f.store.consumeFlow(principal, flow.state), { code: 'shared_read_authorization_state_invalid' });
    f.store.finishFlow(principal, consumed.flowId, 'unknown');
    assert.equal(f.store.flowSummary(principal).state, 'unknown');
    assert.equal(f.database.prepare('SELECT encrypted_flow FROM savana_delegated_read_flows').get().encrypted_flow, null);
    assert.throws(() => f.store.consumeFlow(principal, flow.state), { code: 'shared_read_authorization_state_invalid' });
    assert.equal(f.store.load(principal), null);
});

test('expired or interrupted authorization does not become a connected/readable session', t => {
    const f = fixture(t);
    const flow = f.store.beginFlow(principal, { verifier: 'private' }, 1);
    f.setClock(start + 2000);
    assert.throws(() => f.store.consumeFlow(principal, flow.state), { code: 'shared_read_authorization_state_invalid' });
    assert.equal(f.store.flowSummary(principal).state, 'expired');
    const other = f.store.beginFlow(principal, { verifier: 'new-private' }, 1);
    f.store.consumeFlow(principal, other.state);
    f.setClock(start + 4000);
    assert.equal(f.store.flowSummary(principal).state, 'unknown');
    assert.equal(f.store.ownerSession(principal), null);
});

test('operational intent is immutable/idempotent and unknown is reconciled without re-claim or force', t => {
    const f = fixture(t);
    const args = { operation: 'read_request_create', idempotencyKey: 'same-local-intent', payload: { fields: ['name'], scope: 'test' } };
    const intent = f.store.prepareAction(principal, args);
    assert.equal(f.store.prepareAction(principal, { ...args, payload: { scope: 'test', fields: ['name'] } }).id, intent.id);
    assert.throws(() => f.store.prepareAction(principal, { ...args, payload: { fields: ['private'] } }), { code: 'shared_read_action_content_conflict' });
    assert.equal(f.store.claimAction(principal, intent.id), true);
    assert.equal(f.store.claimAction(principal, intent.id), false);
    const before = f.database.prepare('SELECT encrypted_request,payload_hash FROM savana_operational_read_actions').get();
    f.store.finishAction(principal, intent.id, 'unknown');
    assert.equal(f.store.claimAction(principal, intent.id), false);
    assert.equal(f.store.action(principal, intent.id).state, 'unknown');
    assert.equal(f.store.action({ ...principal, userId: 2 }, intent.id), undefined);
    f.store.finishAction(principal, intent.id, 'completed', { reconciled: true });
    assert.deepEqual(f.database.prepare('SELECT encrypted_request,payload_hash FROM savana_operational_read_actions').get(), before);
    assert.deepEqual(f.store.action(principal, intent.id).result, { reconciled: true });
});

test('two SQLite connections can claim one operational intent only once', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-vault-claim-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'synthetic.db');
    const f = fixture(t, filename);
    f.database.pragma('journal_mode=WAL');
    const second = new Database(filename);
    t.after(() => second.close());
    const other = new SqliteDelegatedReadBindings({ database: second, encryption: f.encryption, now: () => start });
    const args = { operation: 'read_request_create', idempotencyKey: 'claim-once', payload: { fields: ['name'] } };
    const intent = f.store.prepareAction(principal, args);
    assert.equal(other.prepareAction(principal, args).id, intent.id);
    assert.equal(f.store.claimAction(principal, intent.id), true);
    assert.equal(other.claimAction(principal, intent.id), false);
    assert.equal(second.prepare('SELECT COUNT(*) count FROM savana_operational_read_actions').get().count, 1);
});

test('disconnect prevents a late PKCE result from restoring a local session', t => {
    const f = fixture(t);
    const flow = f.store.beginFlow(principal, { verifier: 'old-private' });
    f.store.consumeFlow(principal, flow.state);
    f.store.disconnectOwner(principal);
    assert.throws(() => f.store.completeOwnerFlow(principal, flow.flowId, {
        accessToken: 'late-token', expiresAt: credentials.expiresAt,
    }), { code: 'shared_read_authorization_state_invalid' });
    assert.equal(f.store.ownerSession(principal), null);
    assert.equal(f.database.prepare('SELECT encrypted_flow FROM savana_delegated_read_flows').get().encrypted_flow, null);
});

test('owner session and completed flow persist atomically or neither does', t => {
    const f = fixture(t);
    const flow = f.store.beginFlow(principal, { verifier: 'private' });
    f.store.consumeFlow(principal, flow.state);
    f.database.exec(`CREATE TRIGGER fail_flow_complete BEFORE UPDATE ON savana_delegated_read_flows
        WHEN NEW.state='completed' BEGIN SELECT RAISE(ABORT,'synthetic completion failure'); END;`);
    assert.throws(() => f.store.completeOwnerFlow(principal, flow.flowId, {
        accessToken: 'never-partially-persisted', expiresAt: credentials.expiresAt,
    }), /synthetic completion failure/);
    assert.equal(f.store.ownerSession(principal), null);
    assert.equal(f.store.flowSummary(principal).state, 'exchanging');
    assert.equal(f.database.prepare("SELECT COUNT(*) count FROM savana_delegated_read_audit WHERE action='central_owner_session_connected_not_read_grant'").get().count, 0);
    f.database.exec('DROP TRIGGER fail_flow_complete');
    f.store.completeOwnerFlow(principal, flow.flowId, { accessToken: 'saved-atomically', expiresAt: credentials.expiresAt });
    assert.equal(f.store.ownerSession(principal).accessToken, 'saved-atomically');
    assert.equal(f.store.flowSummary(principal).state, 'completed');
    assert.equal(f.store.load(principal), null);
});
