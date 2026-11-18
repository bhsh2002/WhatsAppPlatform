import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { WorkspaceReferences, workspaceContextReference } from '../services/workspaceReferences.js';

const START = Date.parse('2026-11-18T12:00:00Z');
const p = extra => ({ tenantId: 1, userId: 2, sessionId: 'synthetic-native-jti', authVersion: 0,
    role: 'tenant', sessionExpiresAt: START / 1000 + 600, issuedAt: START / 1000 - 10, ...extra });
const owner = extra => ({ actorId: 'synthetic-actor', organizationId: 'synthetic-org', nativeAccountId: 'synthetic-native-account',
    generation: 'synthetic-generation', expiresAt: new Date(START + 300_000).toISOString(), ...extra });
const cipher = () => {
    const key = crypto.randomBytes(32);
    return { encrypt(raw) { const iv = crypto.randomBytes(12), aes = crypto.createCipheriv('aes-256-gcm', key, iv);
        const body = Buffer.concat([aes.update(raw), aes.final()]); return Buffer.concat([iv, aes.getAuthTag(), body]).toString('base64'); },
    decrypt(raw) { const bytes = Buffer.from(raw, 'base64'), aes = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        aes.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([aes.update(bytes.subarray(28)), aes.final()]).toString(); } };
};
const fixture = () => {
    let clock = START, active = true, current = owner(), calls = 0;
    const encryption = cipher();
    const refs = new WorkspaceReferences({ encryption, verifyLocalPrincipal: () => active,
        currentIdentity: async () => { calls++; return current; }, now: () => clock });
    return { refs, encryption, calls: () => calls, revoke: () => { active = false; }, setClock: value => { clock = value; }, setIdentity: value => { current = value; } };
};

test('typed encrypted lookup references reveal no IDs and resolve through two fresh identity checks', async () => {
    const f = fixture(); const key = 'synthetic-private-record-id';
    const ref = f.refs.issue(p(), owner(), { type: 'record', key });
    assert.match(ref, /^wr1\.[A-Za-z0-9_-]+$/); assert.equal(ref.includes(key), false);
    assert.equal(Buffer.from(ref.slice(4), 'base64url').toString().includes(key), false);
    const result = await f.refs.resolve(p(), ref, 'record');
    assert.equal(result.key, key); assert.equal(result.identity.actorId, owner().actorId); assert.equal(f.calls(), 2);
});

test('stable context partition and references survive fresh JWT/auth version/OIDC generation for same verified owner', async () => {
    const f = fixture(); const ref = f.refs.issue(p(), owner(), { type: 'intent', key: 'server-review-key' });
    const renewed = p({ sessionId: 'fresh-jti', authVersion: 4 }); const renewedOwner = owner({ generation: 'fresh-generation' });
    f.setIdentity(renewedOwner);
    assert.equal(workspaceContextReference(p(), owner()), workspaceContextReference(renewed, renewedOwner));
    assert.equal((await f.refs.resolve(renewed, ref, 'intent')).key, 'server-review-key');
});

test('tenant, native user, Core actor/org and actual native account each partition references independently', async () => {
    for (const [native, identity] of [
        [p({ tenantId: 3 }), owner()], [p({ userId: 9 }), owner()],
        [p(), owner({ actorId: 'other' })], [p(), owner({ organizationId: 'other' })], [p(), owner({ nativeAccountId: 'other' })],
    ]) {
        const f = fixture(); const ref = f.refs.issue(p(), owner(), { type: 'command', key: 'synthetic-command-id' }); f.setIdentity(identity);
        assert.notEqual(workspaceContextReference(p(), owner()), workspaceContextReference(native, identity));
        await assert.rejects(f.refs.resolve(native, ref, 'command'), { code: 'workspace_reference_context_changed' });
    }
});

test('wrong reference type/cipher and malformed oversized values never become keys or grants', async () => {
    const f = fixture(); const ref = f.refs.issue(p(), owner(), { type: 'intent', key: 'server-key' });
    await assert.rejects(f.refs.resolve(p(), ref, 'record'), { code: 'workspace_reference_unavailable' });
    const wrong = new WorkspaceReferences({ encryption: cipher(), verifyLocalPrincipal: () => true, currentIdentity: async () => owner(), now: () => START });
    await assert.rejects(wrong.resolve(p(), ref, 'intent'), { code: 'workspace_reference_unavailable' });
    await assert.rejects(f.refs.resolve(p(), 'wr1.' + 'x'.repeat(65_536), 'intent'), { code: 'workspace_reference_invalid' });
    assert.throws(() => f.refs.issue(p(), owner(), { type: 'intent', key: 'x'.repeat(256) }), { code: 'workspace_reference_invalid' });
    assert.throws(() => f.refs.issue(p(), owner(), { type: 'invented', key: 'x' }), { code: 'workspace_reference_invalid' });
});

test('thirty-day expiry blocks old lookup but fresh overview can reissue the same unresolved key', async () => {
    const f = fixture(); const ref = f.refs.issue(p(), owner(), { type: 'intent', key: 'old-unknown-key' });
    const clock = START + 30 * 24 * 3600_000; f.setClock(clock);
    const current = p({ sessionId: 'new', sessionExpiresAt: clock / 1000 + 600 });
    const currentOwner = owner({ generation: 'new', expiresAt: new Date(clock + 300_000).toISOString() }); f.setIdentity(currentOwner);
    await assert.rejects(f.refs.resolve(current, ref, 'intent'), { code: 'workspace_reference_expired' });
    const reissued = f.refs.issue(current, currentOwner, { type: 'intent', key: 'old-unknown-key' });
    assert.equal((await f.refs.resolve(current, reissued, 'intent')).key, 'old-unknown-key');
});

test('revocation during decryption and changed fresh Core generation reject lookup without disclosing its key', async () => {
    const f = fixture(); const ref = f.refs.issue(p(), owner(), { type: 'record', key: 'private' });
    const decrypt = f.encryption.decrypt; f.encryption.decrypt = value => { f.revoke(); return decrypt(value); };
    await assert.rejects(f.refs.resolve(p(), ref, 'record'), { code: 'workspace_reference_context_changed' });
    const g = fixture(); const second = g.refs.issue(p(), owner(), { type: 'record', key: 'private' });
    let reads = 0;
    const changing = new WorkspaceReferences({ encryption: g.encryption, verifyLocalPrincipal: () => true,
        currentIdentity: async () => owner({ generation: ++reads === 1 ? 'first' : 'changed' }), now: () => START });
    await assert.rejects(changing.resolve(p(), second, 'record'), { code: 'workspace_reference_context_changed' });
});

test('opaque reference possession never bypasses revoked native identity or fresh identity lookup failure', async () => {
    const f = fixture(); const ref = f.refs.issue(p(), owner(), { type: 'intent', key: 'server-key' }); f.revoke();
    await assert.rejects(f.refs.resolve(p(), ref, 'intent'), { code: 'workspace_reference_context_changed' });
    assert.equal(f.calls(), 0);
    const unavailable = new WorkspaceReferences({ encryption: f.encryption, verifyLocalPrincipal: () => true,
        currentIdentity: async () => { throw new Error('synthetic-private-upstream'); }, now: () => START });
    await assert.rejects(unavailable.resolve(p(), ref, 'intent'), error => error.code === 'workspace_reference_identity_unavailable'
        && !error.message.includes('synthetic-private'));
});

test('sharing request and read-grant references retain independent current versions and cannot be interchanged', async () => {
    const f = fixture();
    const request = f.refs.issue(p(), owner(), { type: 'request', key: 'reviewed-sharing-request', version: 4 });
    const grant = f.refs.issue(p(), owner(), { type: 'read_grant', key: 'effective-read-grant', version: 2 });
    assert.equal((await f.refs.resolve(p(), request, 'request')).version, 4);
    assert.equal((await f.refs.resolve(p(), grant, 'read_grant')).version, 2);
    await assert.rejects(f.refs.resolve(p(), request, 'read_grant'), { code: 'workspace_reference_unavailable' });
    await assert.rejects(f.refs.resolve(p(), grant, 'request'), { code: 'workspace_reference_unavailable' });
});

test('command/record references preserve exact reviewed versions and intent references reject them', async () => {
    const f = fixture();
    for (const type of ['command', 'record']) {
        const ref = f.refs.issue(p(), owner(), { type, key: 'synthetic-versioned-resource', version: 7 });
        assert.equal((await f.refs.resolve(p(), ref, type)).version, 7);
        const sealed = Buffer.from(ref.slice(4), 'base64url').toString('utf8');
        const invalid = JSON.parse(f.encryption.decrypt(sealed)); invalid.version = 0;
        const tampered = 'wr1.' + Buffer.from(f.encryption.encrypt(JSON.stringify(invalid))).toString('base64url');
        await assert.rejects(f.refs.resolve(p(), tampered, type), { code: 'workspace_reference_unavailable' });
        await assert.rejects(f.refs.resolve(p(), ref, 'intent'), { code: 'workspace_reference_unavailable' });
    }
    assert.throws(() => f.refs.issue(p(), owner(), { type: 'intent', key: 'server-key', version: 1 }), { code: 'workspace_reference_invalid' });
    for (const version of [0, -1, 1.5, '7', null]) {
        assert.throws(() => f.refs.issue(p(), owner(), { type: 'command', key: 'server-key', version }), { code: 'workspace_reference_invalid' });
    }
});
