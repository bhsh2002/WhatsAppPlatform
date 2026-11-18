import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { WorkspaceChoices } from '../services/workspaceChoices.js';

const fixture = () => {
    let now = Date.parse('2026-11-18T08:00:00Z');
    let allowed = true;
    let loads = 0;
    const secret = crypto.randomBytes(32);
    const encryption = {
        encrypt(raw) {
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
            const body = Buffer.concat([cipher.update(raw), cipher.final()]);
            return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
        },
        decrypt(raw) {
            const value = Buffer.from(raw, 'base64');
            const decipher = crypto.createDecipheriv('aes-256-gcm', secret, value.subarray(0, 12));
            decipher.setAuthTag(value.subarray(12, 28));
            return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString();
        },
    };
    const principal = { tenantId: 3, userId: 8, sessionId: 'native-session', authVersion: 4,
        sessionExpiresAt: Math.floor(now / 1000) + 3600, role: 'tenant' };
    const context = { actorId: 'core-actor', organizationId: 'core-organization', nativeAccountId: 'native-account', coreAccountId: 'verified-core-native-account',
        identityGeneration: 'current-oidc-generation', revision: 'verified-context-revision', validUntil: new Date(now + 600_000).toISOString(),
        choices: { activity: [{ key: 'source-owned-activity', version: 2, label: 'Main activity', selectable: true }] } };
    const service = new WorkspaceChoices({ encryption, verifyLocalPrincipal: () => allowed,
        loadContext: async () => { loads++; return context; }, now: () => now });
    return { service, principal, context, encryption, setNow: value => { now = value; },
        revoke: () => { allowed = false; }, loads: () => loads, now: () => now };
};
const changed = error => error.code === 'workspace_choice_changed' && error.status === 409;

test('opaque choices reveal no technical identity and resolve only after fresh verified context', async () => {
    const f = fixture();
    const token = f.service.issue(f.principal, f.context, { kind: 'activity', key: 'source-owned-activity' });
    const decoded = Buffer.from(token, 'base64url').toString();
    for (const value of ['core-actor', 'core-organization', 'native-account', 'source-owned-activity']) {
        assert.equal(token.includes(value) || decoded.includes(value), false);
    }
    const result = await f.service.resolve(f.principal, token, 'activity');
    assert.equal(result.option.label, 'Main activity');
    assert.equal(f.loads(), 1);
});

test('choices cannot cross native tenant/user/session/auth generation or Core identity/context', async () => {
    const f = fixture();
    const token = f.service.issue(f.principal, f.context, { kind: 'activity', key: 'source-owned-activity' });
    for (const [key, value] of Object.entries({ tenantId: 4, userId: 9, sessionId: 'another-session', authVersion: 5 })) {
        await assert.rejects(f.service.resolve({ ...f.principal, [key]: value }, token, 'activity'), changed);
    }
    for (const key of ['actorId', 'organizationId', 'nativeAccountId', 'coreAccountId', 'identityGeneration', 'revision']) {
        const original = f.context[key]; f.context[key] = 'changed-current-context';
        await assert.rejects(f.service.resolve(f.principal, token, 'activity'), changed);
        f.context[key] = original;
    }
});

test('an exact source price-policy choice fits the opaque envelope without relaxing its business-key bound', async () => {
    const f = fixture();
    const key = JSON.stringify({ unit_code: 'unit-'.repeat(20), currency: 'LYD', price_list_id: 'actual-source-list-'.repeat(20),
        channel: 'actual-source-channel-'.repeat(10), provider_ref: 'actual-verified-provider', activity_id: 'actual-verified-activity' });
    assert.ok(key.length < 1024);
    f.context.choices.price_choices = [{ key, label: 'السعر المعتمد / دينار / القطعة', version: 1, selectable: true }];
    const token = f.service.issue(f.principal, f.context, { kind: 'price_choices', key });
    assert.equal((await f.service.resolve(f.principal, token, 'price_choices')).option.key, key);
    assert.equal(Buffer.from(token, 'base64url').toString().includes(key), false);
});

test('withdrawn or changed options and mismatched choice types are rejected despite an unexpired token', async () => {
    const f = fixture(); const option = f.context.choices.activity[0];
    const token = f.service.issue(f.principal, f.context, { kind: 'activity', key: option.key });
    await assert.rejects(f.service.resolve(f.principal, token, 'person'), changed);
    option.selectable = false;
    await assert.rejects(f.service.resolve(f.principal, token, 'activity'), changed);
    option.selectable = true; option.version++;
    await assert.rejects(f.service.resolve(f.principal, token, 'activity'), changed);
    option.version--; f.context.choices.activity.push({ ...option });
    await assert.rejects(f.service.resolve(f.principal, token, 'activity'), changed);
});

test('expiry is bounded by both native and current Core session; malformed ciphertext never dispatches', async () => {
    const f = fixture();
    f.context.validUntil = new Date(f.now() + 1500).toISOString();
    const token = f.service.issue(f.principal, f.context, { kind: 'activity', key: 'source-owned-activity' });
    f.setNow(f.now() + 1500);
    await assert.rejects(f.service.resolve(f.principal, token, 'activity'), changed);
    await assert.rejects(f.service.resolve(f.principal, 'raw-user-identifier', 'activity'), changed);
    assert.equal(f.loads(), 0);
});

test('local revocation during awaited context lookup rejects selection', async () => {
    const f = fixture();
    const service = new WorkspaceChoices({ encryption: f.encryption, verifyLocalPrincipal: () => true,
        loadContext: async principal => { principal.authVersion++; return f.context; }, now: f.now });
    const token = service.issue(f.principal, f.context, { kind: 'activity', key: 'source-owned-activity' });
    await assert.rejects(service.resolve(f.principal, token, 'activity'), changed);
    f.revoke();
    assert.throws(() => f.service.issue(f.principal, f.context, { kind: 'activity', key: 'source-owned-activity' }), changed);
});

test('unencrypted choice storage and non-current options fail closed', () => {
    const f = fixture();
    const service = new WorkspaceChoices({ encryption: { encrypt: value => value, decrypt: value => value },
        verifyLocalPrincipal: () => true, loadContext: async () => f.context, now: f.now });
    assert.throws(() => service.issue(f.principal, f.context, { kind: 'activity', key: 'source-owned-activity' }), changed);
    assert.throws(() => f.service.issue(f.principal, f.context, { kind: 'activity', key: 'browser-invented-id' }), changed);
});

test('review seals exact proposal and idempotency identity; replay cannot change the approved payload', async () => {
    const f = fixture();
    const payload = { action: 'product.change', expected_record_version: 3, fields: { name: 'قهوة', description: 'وصف'.repeat(1000) } };
    const token = f.service.issueReview(f.principal, f.context, { operation: 'command.create', payload });
    assert.equal(Buffer.from(token, 'base64url').toString().includes('قهوة'), false);
    const first = await f.service.resolveReview(f.principal, token, 'command.create');
    const again = await f.service.resolveReview(f.principal, token, 'command.create');
    assert.deepEqual(first.payload, payload);
    assert.equal(first.idempotencyKey, again.idempotencyKey);
    assert.equal(first.payloadHash, again.payloadHash);
    await assert.rejects(f.service.resolve(f.principal, token, 'activity'), changed);
    await assert.rejects(f.service.resolveReview(f.principal, token, 'command.approve'), changed);
    await assert.rejects(f.service.resolveReview({ ...f.principal, userId: 9 }, token, 'command.create'), changed);
});

test('context revision change, expiry or forged review forces a new review without dispatch', async () => {
    const f = fixture();
    const token = f.service.issueReview(f.principal, f.context, { operation: 'connection.request', payload: { fields: ['name'] } });
    f.context.revision = 'revoked-field-policy';
    await assert.rejects(f.service.resolveReview(f.principal, token, 'connection.request'), changed);
    f.context.revision = 'verified-context-revision';
    const encrypted = Buffer.from(token, 'base64url').toString();
    const value = JSON.parse(f.encryption.decrypt(encrypted)); value.payload.fields.push('price');
    const forged = Buffer.from(f.encryption.encrypt(JSON.stringify(value))).toString('base64url');
    await assert.rejects(f.service.resolveReview(f.principal, forged, 'connection.request'), changed);
    f.setNow(f.now() + 300_000);
    await assert.rejects(f.service.resolveReview(f.principal, token, 'connection.request'), changed);
});

test('non-JSON or oversized reviews and plaintext ciphers fail closed', () => {
    const f = fixture();
    for (const payload of [{ value: NaN }, { value: undefined }, { value: 'x'.repeat(65_537) }]) {
        assert.throws(() => f.service.issueReview(f.principal, f.context, { operation: 'command.create', payload }), changed);
    }
    const service = new WorkspaceChoices({ encryption: { encrypt: value => value, decrypt: value => value },
        verifyLocalPrincipal: () => true, loadContext: async () => f.context, now: f.now });
    assert.throws(() => service.issueReview(f.principal, f.context, { operation: 'command.create', payload: {} }), changed);
});

test('choice and review expiry are checked again after an awaited fresh context lookup', async () => {
    for (const review of [false, true]) {
        const f = fixture();
        const service = new WorkspaceChoices({ encryption: f.encryption, verifyLocalPrincipal: () => true,
            loadContext: async () => { f.setNow(f.now() + 300_000); return f.context; }, now: f.now });
        const token = review ? service.issueReview(f.principal, f.context, { operation: 'command.create', payload: {} })
            : service.issue(f.principal, f.context, { kind: 'activity', key: 'source-owned-activity' });
        await assert.rejects(review ? service.resolveReview(f.principal, token, 'command.create') : service.resolve(f.principal, token, 'activity'), changed);
    }
});
