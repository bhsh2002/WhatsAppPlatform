import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { OperationalConsumerEnrollmentService } from '../services/operationalConsumerEnrollment.js';
import { runMigrationsSync } from '../db/migrator.js';
import { seedSavanaUpgrade, sourceState } from '../test-support/savanaMigrationFixture.js';

const now = Date.parse('2026-11-17T10:00:00Z');
const principal = { userId: 1, tenantId: 1, sessionId: 'synthetic-enrollment-jti', authVersion: 0,
    sessionExpiresAt: now / 1000 + 300 };
const identity = () => ({ actorId: 'synthetic-central-actor', organizationId: 'synthetic-organization',
    accessToken: 'synthetic-server-only-oidc-token', generation: 'synthetic-generation',
    expiresAt: '2026-11-17T10:05:00Z' });
const config = { enabled: true, centerOrigin: 'https://center.invalid', platformToken: 'synthetic-platform-token' };
const input = { displayName: 'Synthetic native tenant' };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
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
const publicResponse = body => ({ enrollment_id: 'synthetic-central-enrollment', organization_id: body.organization_id,
    platform: 'wa_savana', external_tenant_id: body.external_tenant_id, display_name: body.display_name,
    version: 1, accepted_scopes: ['savana.products.sync'], public_key_fingerprint: sha(body.public_key_pem) });
const fixture = (t, { filename = ':memory:', serviceConfig = config, encryption = cipher(), documented = false } = {}) => {
    const database = new Database(filename);
    seedSavanaUpgrade(database);
    runMigrationsSync(database);
    database.exec(`INSERT INTO users(id,username,password_hash,role,tenant_id,is_active,auth_version)
        VALUES(1,'synthetic-enrollment-user','unused','tenant',1,1,0);`);
    const before = sourceState(database);
    t.after(() => { if (database.open) database.close(); });
    const calls = [];
    let current = true;
    let oidcCurrent = true;
    let transform = value => value;
    let responseStatus = 201;
    let fetchHook = async () => {};
    const session = identity();
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        await fetchHook();
        return Response.json(transform(publicResponse(JSON.parse(options.body))), {
            status: responseStatus, headers: { 'Cache-Control': 'no-store' },
        });
    };
    const makeService = (overrides = {}) => new OperationalConsumerEnrollmentService({ database, encryption,
        config: serviceConfig, verifyLocalPrincipal: () => current, verifyOidcSession: async () => oidcCurrent,
        fetchImpl, now: () => now, identicalEnrollmentReplayDocumented: documented, ...overrides });
    const service = makeService();
    const row = () => database.prepare('SELECT * FROM savana_operational_consumer_enrollments').get();
    return { database, before, encryption, service, session, calls, row, makeService,
        local: value => { current = value; }, oidc: value => { oidcCurrent = value; },
        transform: value => { transform = value; }, status: value => { responseStatus = value; },
        duringFetch: value => { fetchHook = value; } };
};
const immutable = row => Object.fromEntries(['id', 'tenant_id', 'organization_id', 'external_tenant_id', 'center_origin',
    'encrypted_private_key', 'request_json', 'request_sha256', 'public_key_fingerprint'].map(key => [key, row[key]]));

test('enrollment disabled or without current server identity performs no HTTP, key creation or grant', async t => {
    const f = fixture(t, { serviceConfig: { ...config, enabled: false } });
    await assert.rejects(f.service.enroll(principal, f.session, input), { code: 'consumer_enrollment_disabled' });
    assert.equal(f.row(), undefined);
    assert.equal(f.calls.length, 0);
    const enabled = f.makeService({ config });
    f.local(false);
    await assert.rejects(enabled.enroll(principal, f.session, input), { code: 'shared_product_read_session_required' });
    f.local(true);
    f.oidc(false);
    await assert.rejects(enabled.enroll(principal, f.session, input), { code: 'shared_read_identity_session_required' });
    assert.equal(f.row(), undefined);
    assert.equal(f.calls.length, 0);
});

test('native enrollment sends published platform-authenticated request and persists only an encrypted RSA key', async t => {
    const f = fixture(t);
    const result = await f.service.enroll(principal, f.session, input);
    assert.equal(result.state, 'completed');
    assert.equal(result.enrollment.platform, 'wa_savana');
    assert.equal(result.enrollment.external_tenant_id, 'wa_savana:tenant:1');
    assert.equal(result.grants_created, false);
    assert.equal(f.calls.length, 1);
    const [{ url, options }] = f.calls;
    assert.equal(url, 'https://center.invalid/v1/integration/operational/enrollments');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json', 'X-Savana-Platform-Code': 'wa_savana',
        'X-Savana-Platform-Token': config.platformToken });
    assert.equal(JSON.stringify(options).includes(f.session.accessToken), false);
    const body = JSON.parse(options.body);
    assert.deepEqual(Object.keys(body), ['organization_id', 'external_tenant_id', 'display_name', 'public_key_pem', 'accepted_scopes']);
    assert.equal(body.organization_id, f.session.organizationId);
    assert.deepEqual(body.accepted_scopes, ['savana.products.sync']);
    const key = crypto.createPublicKey(body.public_key_pem);
    assert.equal(key.asymmetricKeyType, 'rsa');
    assert.ok(key.asymmetricKeyDetails.modulusLength >= 2048);
    const row = f.row();
    assert.equal(options.body, row.request_json);
    assert.equal(row.request_sha256, sha(options.body));
    const stored = JSON.parse(f.encryption.decrypt(row.encrypted_private_key));
    assert.equal(stored.tenant_id, 1);
    assert.equal(stored.organization_id, f.session.organizationId);
    assert.equal(crypto.createPublicKey(stored.private_key_pem).export({ format: 'pem', type: 'spki' }), body.public_key_pem);
    assert.equal(JSON.stringify(row).includes('BEGIN PRIVATE KEY'), false);
    assert.equal(JSON.stringify(result).includes('BEGIN'), false);
    assert.equal(JSON.stringify(result).includes('public_key_pem'), false);
    assert.deepEqual(sourceState(f.database), f.before);
    assert.equal(f.database.prepare('SELECT COUNT(*) count FROM savana_delegated_read_sessions').get().count, 0);
});

test('retry preserves key and exact request, rejects browser authority and changed organization or display name', async t => {
    const f = fixture(t);
    await assert.rejects(f.service.enroll(principal, f.session, { ...input, organization_id: 'browser-organization' }),
        { code: 'consumer_enrollment_request_invalid' });
    assert.equal(f.row(), undefined);
    const first = await f.service.enroll(principal, f.session, input);
    const before = immutable(f.row());
    assert.deepEqual(await f.service.enroll(principal, f.session, input), first);
    await assert.rejects(f.service.enroll(principal, f.session, { displayName: 'Changed' }), { code: 'consumer_enrollment_content_conflict' });
    await assert.rejects(f.service.status(principal, { ...f.session, organizationId: 'different-organization' }),
        { code: 'consumer_enrollment_binding_conflict' });
    assert.equal(f.calls.length, 1);
    assert.deepEqual(immutable(f.row()), before);
    assert.throws(() => f.database.prepare("UPDATE savana_operational_consumer_enrollments SET organization_id='changed'").run(),
        /consumer enrollment binding is immutable/);
});

test('lost acknowledgement preserves unknown key and bytes across reopen and prohibits undocumented replay', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-consumer-enrollment-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'synthetic.db');
    const f = fixture(t, { filename });
    f.duringFetch(async () => { throw new Error('Synthetic acknowledgement loss'); });
    await assert.rejects(f.service.enroll(principal, f.session, input), { code: 'consumer_enrollment_outcome_unknown' });
    const before = immutable(f.row());
    assert.equal(f.row().state, 'unknown');
    assert.equal((await f.service.enroll(principal, f.session, input)).state, 'unknown');
    await assert.rejects(f.service.reconcile(principal, f.session), { code: 'consumer_enrollment_reconciliation_not_documented' });
    f.database.close();
    const reopened = new Database(filename);
    t.after(() => reopened.close());
    const service = f.makeService({ database: reopened });
    const status = await service.status(principal, f.session);
    assert.equal(status.state, 'unknown');
    assert.equal(status.reconciliation_available, false);
    assert.deepEqual(immutable(reopened.prepare('SELECT * FROM savana_operational_consumer_enrollments').get()), before);
    assert.equal(f.calls.length, 1);
});

test('explicit documented reconciliation reuses byte-identical enrollment without rotating its key', async t => {
    const f = fixture(t, { documented: true });
    let lost = false;
    f.duringFetch(async () => { if (!lost) { lost = true; throw new Error('Synthetic lost response'); } });
    await assert.rejects(f.service.enroll(principal, f.session, input), { code: 'consumer_enrollment_outcome_unknown' });
    const before = immutable(f.row());
    const result = await f.service.reconcile(principal, f.session);
    assert.equal(result.state, 'completed');
    assert.equal(result.attempts, 2);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0].options.body, f.calls[1].options.body);
    assert.deepEqual(immutable(f.row()), before);
    assert.equal(result.enrollment.enrollment_id, 'synthetic-central-enrollment');
});

test('401 and 403 preserve secret binding and never cause automatic enrollment retry', async t => {
    const f = fixture(t, { documented: true });
    f.status(401);
    await assert.rejects(f.service.enroll(principal, f.session, input), { code: 'consumer_enrollment_rejected', status: 401 });
    const before = immutable(f.row());
    assert.equal((await f.service.enroll(principal, f.session, input)).state, 'failed');
    assert.equal(f.calls.length, 1);
    f.status(403);
    await assert.rejects(f.service.reconcile(principal, f.session), { code: 'consumer_enrollment_rejected', status: 403 });
    assert.deepEqual(immutable(f.row()), before);
    assert.equal((await f.service.enroll(principal, f.session, input)).state, 'failed');
    assert.equal(f.calls.length, 2);
});

test('local revocation or changed actual OIDC actor during remote await cannot complete enrollment', async t => {
    const f = fixture(t, { documented: true });
    f.duringFetch(async () => { f.local(false); });
    await assert.rejects(f.service.enroll(principal, f.session, input), { code: 'shared_product_read_session_required' });
    const before = immutable(f.row());
    assert.equal(f.row().state, 'unknown');
    f.local(true);
    f.duringFetch(async () => { f.session.actorId = 'different-actor'; });
    await assert.rejects(f.service.reconcile(principal, f.session), { code: 'shared_read_identity_session_changed' });
    assert.equal(f.row().state, 'unknown');
    assert.equal(f.row().response_json, null);
    assert.deepEqual(immutable(f.row()), before);
});

test('central enrollment response must match exact tenant, organization, platform, fingerprint and strict public DTO', async t => {
    const f = fixture(t, { documented: true });
    const invalid = [value => ({ ...value, platform: 'catalog' }), value => ({ ...value, organization_id: 'foreign' }),
        value => ({ ...value, external_tenant_id: 'wa_savana:tenant:2' }), value => ({ ...value, version: 0 }),
        value => ({ ...value, public_key_fingerprint: '0'.repeat(64) }), value => ({ ...value, enrollment_id: '' }),
        value => ({ ...value, secret: 'unexpected-secret-must-not-be-returned' })];
    for (const [index, mutate] of invalid.entries()) {
        f.transform(mutate);
        const attempt = index === 0 ? f.service.enroll(principal, f.session, input) : f.service.reconcile(principal, f.session);
        await assert.rejects(attempt, { code: 'consumer_enrollment_response_invalid' });
        assert.equal(f.row().state, 'unknown');
        assert.equal(f.row().response_json, null);
    }
    const before = immutable(f.row());
    f.transform(value => value);
    assert.equal((await f.service.reconcile(principal, f.session)).state, 'completed');
    assert.deepEqual(immutable(f.row()), before);
});

test('wrong cipher cannot present completed enrollment as usable or generate a replacement key', async t => {
    const f = fixture(t);
    await f.service.enroll(principal, f.session, input);
    const before = f.row();
    const wrongKeyService = f.makeService({ encryption: cipher() });
    await assert.rejects(wrongKeyService.status(principal, f.session), { code: 'consumer_enrollment_key_unavailable' });
    await assert.rejects(wrongKeyService.enroll(principal, f.session, input), { code: 'consumer_enrollment_key_unavailable' });
    assert.deepEqual(f.row(), before);
    assert.equal(f.calls.length, 1);
});

test('concurrent enrollment claims one prepared request and stranded inflight never dispatches again', async t => {
    const f = fixture(t, { documented: true });
    let release;
    let dispatched;
    const started = new Promise(resolve => { dispatched = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    f.duringFetch(async () => { dispatched(); await waiting; });
    const first = f.service.enroll(principal, f.session, input);
    await started;
    const before = immutable(f.row());
    assert.equal((await f.service.enroll(principal, f.session, input)).state, 'inflight');
    await assert.rejects(f.service.reconcile(principal, f.session), { code: 'consumer_enrollment_reconciliation_unavailable' });
    assert.equal(f.calls.length, 1);
    assert.deepEqual(immutable(f.row()), before);
    release();
    assert.equal((await first).state, 'completed');
    assert.equal(f.calls.length, 1);
});
