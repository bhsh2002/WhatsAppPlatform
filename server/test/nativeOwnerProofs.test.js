import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { NativeOwnerProofs } from '../services/nativeOwnerProofs.js';

const NOW = Date.parse('2026-11-18T14:00:00Z');
const principal = (extra = {}) => ({ userId: 1, tenantId: 1, role: 'tenant', authVersion: 0,
    sessionId: 'synthetic-native-jwt-a', sessionExpiresAt: NOW / 1000 + 600, ...extra });
const identity = (extra = {}) => ({ actorId: 'synthetic-core-owner', organizationId: 'synthetic-org',
    nativeAccountId: 'wa_savana:tenant:1', generation: 'synthetic-oidc-generation-a',
    expiresAt: new Date(NOW + 300_000).toISOString(), ...extra });
const scope = { organization_id: 'synthetic-org', activity_id: 'synthetic-activity', branch_id: null, warehouse_id: null };
const request = (extra = {}) => ({ nativeTenantId: 1, scope, grantApprovedBy: 'synthetic-core-owner', ...extra });

const fixture = t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-native-owner-proof-'));
    const database = new Database(path.join(directory, 'owned.sqlite'));
    database.pragma('foreign_keys = ON');
    database.exec(`CREATE TABLE tenants(id INTEGER PRIMARY KEY,status TEXT NOT NULL);
        CREATE TABLE users(id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            auth_version INTEGER NOT NULL,role TEXT NOT NULL,is_active INTEGER NOT NULL);
        INSERT INTO tenants VALUES(1,'Active'),(2,'Active');
        INSERT INTO users VALUES(1,1,0,'tenant',1),(2,1,0,'tenant',1),(3,2,0,'tenant',1);`);
    database.exec(fs.readFileSync(new URL('../db/migrations/064_native_owner_proofs.sql', import.meta.url), 'utf8'));
    t.after(() => { database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
    let clock = NOW; let jwtCurrent = true; let coreIdentity = identity();
    let binding = { id: 'synthetic-native-account', platform_code: 'wa_savana', organization_id: scope.organization_id,
        external_tenant_id: 'wa_savana:tenant:1', status: 'active' };
    let identityRead = async () => structuredClone(coreIdentity);
    let bindingRead = async selected => {
        assert.deepEqual(selected, { nativeTenantId: 1, organizationId: scope.organization_id });
        return structuredClone(binding);
    };
    const calls = { identity: 0, binding: 0 };
    const service = new NativeOwnerProofs({ database, now: () => clock,
        verifyLocalPrincipal: () => jwtCurrent,
        currentIdentity: async p => { calls.identity++; return identityRead(p); },
        resolveBinding: async selected => { calls.binding++; return bindingRead(selected); },
        issuer: 'https://synthetic-core.example.test', clientId: 'synthetic-native-client' });
    return { database, service, calls, setClock: value => { clock = value; }, revokeJwt: () => { jwtCurrent = false; },
        setIdentity: value => { coreIdentity = value; }, onIdentity: value => { identityRead = value; },
        setBinding: value => { binding = value; }, onBinding: value => { bindingRead = value; },
        binding: () => structuredClone(binding), count: () => database.prepare('SELECT COUNT(*) n FROM savana_native_owner_proofs').get().n };
};

test('native/Core identity capture writes only identity evidence and creates no binding or grant', async t => {
    const f = fixture(t);
    assert.deepEqual(await f.service.capture(principal()), { recorded: true, identityOnly: true });
    assert.equal(f.count(), 1);
    assert.equal(f.calls.identity, 1); assert.equal(f.calls.binding, 0);
    assert.deepEqual(f.database.prepare('SELECT action FROM savana_native_owner_proof_audit').all(), [{ action: 'identity_verified' }]);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM users').get().n, 3);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM tenants').get().n, 2);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND (name LIKE '%grant%' OR name LIKE '%enrollment%' OR name LIKE '%binding%')").get().n, 0);
    await assert.rejects(f.service.authority(request({ grantApprovedBy: 'uncaptured-core-actor' })), { code: 'native_owner_authority_unavailable' });
    assert.equal(f.calls.binding, 0);
});

test('same verified native identity capture is idempotent across JWT and normal OIDC generation renewal', async t => {
    const f = fixture(t); await f.service.capture(principal());
    const first = await f.service.authority(request());
    f.setIdentity(identity({ generation: 'synthetic-oidc-generation-b', expiresAt: new Date(NOW + 500_000).toISOString() }));
    await Promise.all([f.service.capture(principal({ sessionId: 'synthetic-native-jwt-b' })),
        f.service.capture(principal({ sessionId: 'synthetic-native-jwt-c' }))]);
    const repeated = await f.service.authority(request());
    assert.equal(f.count(), 1);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_native_owner_proof_audit').get().n, 1);
    assert.equal(first.nativeAuthorityRevision, repeated.nativeAuthorityRevision);
    assert.match(first.nativeAuthorityRevision, /^[a-f0-9]{64}$/);
    assert.equal(first.verified, true); assert.equal(first.grantApprovedBy, request().grantApprovedBy);
});

test('capture requires current native JWT and exact active tenant-user SQL identity before calling Core', async t => {
    for (const input of [principal({ userId: 3 }), principal({ tenantId: 2 }), principal({ authVersion: 1 }),
        principal({ role: 'admin' }), principal({ sessionExpiresAt: NOW / 1000 }), principal({ sessionId: '' })]) {
        const f = fixture(t);
        await assert.rejects(f.service.capture(input), { code: 'native_owner_identity_required' });
        assert.equal(f.calls.identity, 0); assert.equal(f.count(), 0);
    }
    const f = fixture(t); f.revokeJwt();
    await assert.rejects(f.service.capture(principal()), { code: 'native_owner_identity_required' });
    assert.equal(f.calls.identity, 0); assert.equal(f.count(), 0);
});

test('native disable/auth-version/role/tenant change or JWT expiry during fresh identity await cannot create evidence', async t => {
    for (const change of [f => f.database.prepare('UPDATE users SET is_active=0 WHERE id=1').run(),
        f => f.database.prepare('UPDATE users SET auth_version=1 WHERE id=1').run(),
        f => f.database.prepare("UPDATE users SET role='admin' WHERE id=1").run(),
        f => f.database.prepare('UPDATE users SET tenant_id=2 WHERE id=1').run(),
        f => f.database.prepare("UPDATE tenants SET status='Suspended' WHERE id=1").run(),
        f => f.setClock(NOW + 600_000), f => f.revokeJwt()]) {
        const f = fixture(t);
        f.onIdentity(async () => { await Promise.resolve(); change(f); return identity(); });
        await assert.rejects(f.service.capture(principal()), { code: 'native_owner_identity_required' });
        assert.equal(f.count(), 0);
        assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_native_owner_proof_audit').get().n, 0);
    }
});

test('expired or incomplete fresh Core identity and mutation of the native principal across await are rejected', async t => {
    for (const changed of [identity({ actorId: '' }), identity({ organizationId: '' }), identity({ generation: '' }),
        identity({ expiresAt: new Date(NOW).toISOString() }), identity({ expiresAt: 'invalid' })]) {
        const f = fixture(t); f.setIdentity(changed);
        await assert.rejects(f.service.capture(principal()), { code: 'native_owner_identity_required' });
        assert.equal(f.count(), 0);
    }
    const f = fixture(t); const p = principal();
    f.onIdentity(async () => { p.sessionId = 'changed-during-current-identity'; return identity(); });
    await assert.rejects(f.service.capture(p), { code: 'native_owner_identity_required' });
    assert.equal(f.count(), 0);
});

test('authority requires a retained approver identity in the same Core organization and exact native binding', async t => {
    const f = fixture(t); await f.service.capture(principal());
    for (const changed of [request({ grantApprovedBy: 'foreign-actor' }), request({ scope: { ...scope, organization_id: 'foreign-org' } }),
        request({ nativeTenantId: 2 })]) {
        await assert.rejects(f.service.authority(changed), { code: 'native_owner_authority_unavailable' });
    }
    assert.equal(f.calls.binding, 0);
    const goodBinding = f.binding();
    for (const changed of [{ ...goodBinding, organization_id: 'foreign-org' }, { ...goodBinding, platform_code: 'catalog' },
        { ...goodBinding, external_tenant_id: 'wa_savana:tenant:2' }, { ...goodBinding, status: 'revoked' }, { ...goodBinding, id: '' }, null]) {
        f.setBinding(changed);
        await assert.rejects(f.service.authority(request()), { code: 'native_owner_authority_changed' });
    }
});

test('current SQL owner withdrawal before or during binding lookup immediately denies native authority', async t => {
    const changes = [f => f.database.prepare('UPDATE users SET is_active=0 WHERE id=1').run(),
        f => f.database.prepare('UPDATE users SET auth_version=1 WHERE id=1').run(),
        f => f.database.prepare("UPDATE users SET role='user' WHERE id=1").run(),
        f => f.database.prepare('UPDATE users SET tenant_id=2 WHERE id=1').run(),
        f => f.database.prepare("UPDATE tenants SET status='Suspended' WHERE id=1").run(),
        f => f.database.prepare("UPDATE savana_native_owner_proofs SET revoked_at='2026-11-18T14:00:01Z'").run()];
    for (const change of changes) {
        const before = fixture(t); await before.service.capture(principal()); change(before);
        await assert.rejects(before.service.authority(request()), { code: 'native_owner_authority_unavailable' });
        const during = fixture(t); await during.service.capture(principal());
        during.onBinding(async () => { const binding = during.binding(); await Promise.resolve(); change(during); return binding; });
        await assert.rejects(during.service.authority(request()));
    }
});

test('native ownership revision is stable across read-only/resource/enrollment observations and changes on actual owners or binding', async t => {
    const f = fixture(t); await f.service.capture(principal());
    const first = await f.service.authority(request());
    const otherResource = await f.service.authority(request({ scope: { ...scope, activity_id: 'another-actual-activity', branch_id: 'different-branch' } }));
    assert.equal(first.nativeAuthorityRevision, otherResource.nativeAuthorityRevision);
    f.setBinding({ ...f.binding(), enrollment_version: 999, resource_fingerprint: 'different-resource-not-owner-authority' });
    assert.equal((await f.service.authority(request())).nativeAuthorityRevision, first.nativeAuthorityRevision);
    f.setBinding({ ...f.binding(), id: 'synthetic-new-actual-native-binding' });
    const changedBinding = await f.service.authority(request());
    assert.notEqual(changedBinding.nativeAuthorityRevision, first.nativeAuthorityRevision);
    await f.service.capture(principal({ userId: 2, sessionId: 'synthetic-other-native-owner-jwt' }));
    const changedOwners = await f.service.authority(request());
    assert.notEqual(changedOwners.nativeAuthorityRevision, changedBinding.nativeAuthorityRevision);
});

test('new native auth version requires fresh identity evidence and cannot reuse the previous owner proof', async t => {
    const f = fixture(t); await f.service.capture(principal()); const original = await f.service.authority(request());
    f.database.prepare('UPDATE users SET auth_version=1 WHERE id=1').run();
    await assert.rejects(f.service.authority(request()), { code: 'native_owner_authority_unavailable' });
    await assert.rejects(f.service.capture(principal()), { code: 'native_owner_identity_required' });
    await f.service.capture(principal({ authVersion: 1, sessionId: 'synthetic-reauthenticated-current-jwt' }));
    assert.notEqual((await f.service.authority(request())).nativeAuthorityRevision, original.nativeAuthorityRevision);
});

test('withdrawn generation cannot restore itself; fresh verified reauthentication retains history and creates one current proof', async t => {
    const f = fixture(t); await f.service.capture(principal()); const original = await f.service.authority(request());
    const row = f.database.prepare('SELECT id FROM savana_native_owner_proofs').get();
    f.database.prepare("UPDATE savana_native_owner_proofs SET revoked_at='2026-11-18T14:00:01Z' WHERE id=?").run(row.id);
    await assert.rejects(f.service.capture(principal()), { code: 'native_owner_identity_withdrawn' });
    assert.equal(f.count(), 1);
    f.setIdentity(identity({ generation: 'synthetic-new-generation-after-explicit-withdrawal' }));
    await f.service.capture(principal({ sessionId: 'synthetic-reauthenticated-jwt' }));
    assert.equal(f.count(), 2);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_native_owner_proofs WHERE revoked_at IS NULL').get().n, 1);
    assert.notEqual((await f.service.authority(request())).nativeAuthorityRevision, original.nativeAuthorityRevision);
    assert.throws(() => f.database.prepare('UPDATE savana_native_owner_proofs SET revoked_at=NULL WHERE id=?').run(row.id), /cannot be restored/);
    assert.throws(() => f.database.prepare("UPDATE savana_native_owner_proofs SET identity_generation='invented' WHERE id=?").run(row.id), /immutable/);
});

test('owner evidence cannot be reassigned while native-user deletion preserves the withdrawn identity history', async t => {
    const f = fixture(t); await f.service.capture(principal());
    const row = f.database.prepare('SELECT id FROM savana_native_owner_proofs').get();
    assert.throws(() => f.database.prepare('UPDATE savana_native_owner_proofs SET user_id=2 WHERE id=?').run(row.id), /immutable/);
    f.database.prepare('DELETE FROM users WHERE id=1').run();
    assert.equal(f.database.prepare('SELECT user_id FROM savana_native_owner_proofs WHERE id=?').get(row.id).user_id, null);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_native_owner_proof_audit').get().n, 1);
    await assert.rejects(f.service.authority(request()), { code: 'native_owner_authority_unavailable' });
});
