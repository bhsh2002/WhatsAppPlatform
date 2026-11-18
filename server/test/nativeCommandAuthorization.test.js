import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { NativeCommandAuthorizationClient } from '../services/nativeCommandAuthorization.js';
import { nativeCommandJson } from '../services/nativeCommandProtocol.js';
import { validateAdapterCommand, validateEffectAuthorization } from '../services/nativeCommandModels.js';

const NOW = Date.parse('2026-11-18T13:00:00Z');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const command = () => ({ command_id: 'synthetic-command', version: 2, fingerprint: 'a'.repeat(64), attempt_id: 'synthetic-attempt',
    capability: 'messaging.send', action: 'message.send', scope: { organization_id: 'synthetic-org', activity_id: 'synthetic-activity' },
    actor_id: 'synthetic-reviewer', provider_ref: 'synthetic-provider', provider_installation_id: 'synthetic-installation',
    // Explicit synthetic authority tuple exercises protocol binding only. It
    // does not advertise a goods authority or qualify any WA business handler.
    external_tenant_id: 'wa_savana:tenant:1', authorization_revision: 'synthetic-current-revision', ownership_epoch: 1, authority_domain: 'products.goods',
    capability_grant_revision: 7, grant_approved_by: 'synthetic-grant-approver', native_authority_revision: 'synthetic-native-authority-v9',
    validation_revision: 'synthetic-reviewed-native-v3', validation_valid_until: new Date(NOW + 20_000).toISOString(),
    allowed_fields: ['message', 'recipient'], resource_policy: 'selected', resource_refs: ['synthetic-contact'],
    scope_epochs: [{ scope: { organization_id: 'synthetic-org', activity_id: 'synthetic-activity' }, ownership_epoch: 1 }],
    payload: { payload_type: 'native_action', parameters: { channel: 'sms', message: 'رسالة اختبار غير مرسلة' } } });
const fixture = (commandValue = command()) => {
    const token = crypto.randomBytes(32).toString('hex'); let clock = NOW; const calls = [];
    let transform = value => value;
    const signed = (url, options, overrides = {}) => {
        const c = commandValue;
        const normal = { command_id: c.command_id, version: c.version, fingerprint: c.fingerprint, attempt_id: c.attempt_id,
            authorized: true, valid_until: new Date(clock + 5000).toISOString(), authorization_revision: c.authorization_revision,
            ...Object.fromEntries(['capability_grant_revision', 'grant_approved_by', 'native_authority_revision',
                'allowed_fields', 'resource_policy', 'resource_refs', 'scope_epochs', 'authority_domain', 'ownership_epoch',
                'effect_fields', 'effect_resources', 'creates_resource', 'effect_values']
                .filter(key => Object.hasOwn(c, key)).map(key => [key, c[key]])) };
        const proof = { ...normal, ...overrides.proof };
        const bytes = Buffer.from(overrides.raw ?? nativeCommandJson(proof));
        const timestamp = overrides.time ?? String(Math.floor(clock / 1000));
        const nonce = overrides.nonce ?? options.headers['X-Savana-Command-Nonce'];
        const status = overrides.status ?? 200; const pathname = new URL(url).pathname;
        const signature = `v1=${crypto.createHmac('sha256', overrides.signingKey ?? token).update([
            'savana-command-response-v1','POST',pathname,timestamp,nonce,sha(options.body),String(status),sha(bytes),
        ].join('\n')).digest('hex')}`;
        return new Response(bytes, { status, headers: { 'X-Savana-Command-Timestamp': timestamp, 'X-Savana-Command-Nonce': nonce,
            'X-Savana-Command-Signature': overrides.signature ?? signature, ...overrides.headers } });
    };
    const client = new NativeCommandAuthorizationClient({ centerOrigin: 'https://core.example.test', platformToken: token,
        now: () => clock, fetchImpl: async (url, options) => { calls.push({ url, options }); return transform({ url, options, signed }); } });
    transform = ({ url, options }) => signed(url, options);
    return { client, token, calls, transform: value => { transform = value; }, setClock: value => { clock = value; }, signed };
};

test('actual platform-token request/response HMAC binds exact method/path/bytes/status and fresh nonce', async () => {
    const f = fixture(); const proof = await f.client.authorize(command()); const call = f.calls[0];
    assert.equal(call.url, 'https://core.example.test/v1/integration/operational/commands/synthetic-command/authorize-effect');
    assert.equal(call.options.method, 'POST'); assert.equal(call.options.redirect, 'error'); assert.equal(call.options.cache, 'no-store');
    assert.ok(call.options.headers['X-Savana-Platform-Token'] === f.token); assert.equal(call.options.headers['X-Savana-Callback-Token'], undefined);
    assert.deepEqual(JSON.parse(call.options.body), { attempt_id: 'synthetic-attempt', fingerprint: 'a'.repeat(64), version: 2 });
    const h = call.options.headers;
    assert.match(h['X-Savana-Command-Nonce'], /^[a-f0-9]{32}$/);
    const expected = `v1=${crypto.createHmac('sha256', f.token).update(['savana-command-request-v1','POST',new URL(call.url).pathname,
        h['X-Savana-Command-Timestamp'],h['X-Savana-Command-Nonce'],sha(call.options.body)].join('\n')).digest('hex')}`;
    assert.ok(h['X-Savana-Command-Signature'] === expected); assert.equal(proof.authorized, true);
    await f.client.authorize(command());
    assert.notEqual(f.calls[0].options.headers['X-Savana-Command-Nonce'], f.calls[1].options.headers['X-Savana-Command-Nonce']);
});

test('tampered signature, nonce, timestamp and wrong-direction callback key never authorize', async () => {
    for (const overrides of [{ signature: 'v1=' + '0'.repeat(64) }, { nonce: 'b'.repeat(32) },
        { time: String(NOW / 1000 - 31) }, { time: String(NOW / 1000 + 31) }, { signingKey: ['synthetic','unrelated','callback','key'].join('-') }]) {
        const f = fixture(); f.transform(({ url, options, signed }) => signed(url, options, overrides));
        await assert.rejects(f.client.authorize(command())); assert.equal(f.calls.length, 1);
    }
});

test('correctly signed mismatched command/version/fingerprint/attempt/delegation proof or expired proof rejects', async () => {
    for (const proof of [{ command_id: 'different' }, { version: 3 }, { fingerprint: 'b'.repeat(64) }, { attempt_id: 'different' },
        { authorization_revision: 'revoked-revision' }, { valid_until: new Date(NOW).toISOString() }, { authorized: false },
        { valid_until: new Date(NOW + 7000).toISOString() },
        { capability_grant_revision: 8 }, { grant_approved_by: 'different-approver' }, { native_authority_revision: 'different-native-authority' },
        { allowed_fields: ['message'] }, { resource_policy: 'activity' }, { resource_refs: ['different-contact'] },
        { authority_domain: 'native.service_namespace' }, { ownership_epoch: 2 },
        { scope_epochs: [{ scope: { organization_id: 'synthetic-org', activity_id: 'synthetic-activity' }, ownership_epoch: 2 }] }]) {
        const f = fixture(); f.transform(({ url, options, signed }) => signed(url, options, { proof }));
        await assert.rejects(f.client.authorize(command()),
            Object.hasOwn(proof, 'authority_domain') || Object.hasOwn(proof, 'ownership_epoch') ? { code: 'native_command_authorization_changed' } : undefined);
        assert.equal(f.calls.length, 1);
    }
});

test('signed denial, malformed JSON and oversized body do not become approvals or cause automatic retry', async () => {
    for (const response of [{ status: 403 }, { raw: '{bad json' }, { raw: 'x'.repeat(1_048_577) }]) {
        const f = fixture(); f.transform(({ url, options, signed }) => signed(url, options, response));
        await assert.rejects(f.client.authorize(command())); assert.equal(f.calls.length, 1);
    }
});

test('V2 correctly signed complete semantic proofs must match every optional effect field without widening parameter handlers', async () => {
    // These synthetic schema-valid semantic tuples test crypto correlation only;
    // actual WA parameter handlers separately reject semantic permission claims.
    const semantic = { effect_fields: ['message'], effect_resources: ['synthetic-contact'], creates_resource: false,
        effect_values: { channels: ['sms'], currencies: ['LYD'] } };
    const c = { ...command(), ...semantic }; validateAdapterCommand(c);
    const positive = fixture(c); const accepted = await positive.client.authorize(c);
    for (const key of Object.keys(semantic)) assert.deepEqual(accepted[key], semantic[key]);
    const changes = [{ effect_fields: ['message', 'recipient'] }, { effect_resources: ['different-contact'] },
        { creates_resource: true }, { effect_values: { channels: ['whatsapp'], currencies: ['LYD'] } },
        { effect_fields: null, effect_resources: null, creates_resource: null, effect_values: null }];
    for (const change of changes) {
        const f = fixture(c);
        f.transform(({ url, options, signed }) => {
            const proof = { ...accepted, ...change }; validateEffectAuthorization(proof);
            return signed(url, options, { proof });
        });
        await assert.rejects(f.client.authorize(c), { code: 'native_command_authorization_changed' });
        assert.equal(f.calls.length, 1);
    }
    const parameter = fixture();
    parameter.transform(({ url, options, signed }) => signed(url, options, { proof: semantic }));
    await assert.rejects(parameter.client.authorize(command()), { code: 'native_command_authorization_changed' });
    assert.equal(parameter.calls.length, 1);
});

test('lost authorization reply is denied without redispatch and invalid command models never fetch', async () => {
    const f = fixture(); f.transform(() => { throw new Error('synthetic-private-network-error'); });
    await assert.rejects(f.client.authorize(command()), { code: 'native_command_authorization_unavailable' });
    assert.equal(f.calls.length, 1);
    await assert.rejects(f.client.authorize({ ...command(), actor_role: 'browser-owner' }), { code: 'native_command_model_invalid' });
    assert.equal(f.calls.length, 1);
});

test('operator origin validation rejects browser URLs, credentials, insecure remote and path/query overrides', () => {
    for (const centerOrigin of ['http://outside.example.test', 'https://user:password@core.example.test',
        'https://core.example.test/private', 'https://core.example.test?override=1']) {
        assert.throws(() => new NativeCommandAuthorizationClient({ centerOrigin, platformToken: 'synthetic-only' }));
    }
});
