import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { WorkspaceCoreTransport } from '../services/workspaceCoreTransport.js';
import { SharedProductReadError } from '../services/centralProductRead.js';

const fixture = () => {
    const now = Date.parse('2026-11-18T12:00:00Z');
    const principal = { tenantId: 4, userId: 8, sessionId: 'native-session', role: 'tenant', authVersion: 2,
        sessionExpiresAt: now / 1000 + 600 };
    const owner = { actorId: 'verified-core-actor', organizationId: 'verified-organization', generation: 'current-generation',
        expiresAt: new Date(now + 300_000).toISOString(), accessToken: 'synthetic-never-browser-token' };
    const native = { id: 'verified-native-account', organization_id: owner.organizationId, platform_code: 'wa_savana',
        status: 'active', external_tenant_id: 'wa_savana:tenant:4' };
    let local = true; let current = true; let send = async () => Response.json({ organization: { label: 'المؤسسة' } });
    const calls = []; let checks = 0;
    const setupService = { config: { centerOrigin: 'https://core.invalid', platformToken: 'synthetic-server-secret' },
        assertLocal(p) { if (!local || p.sessionExpiresAt * 1000 <= now) throw Object.assign(new Error('revoked'), { code: 'native_revoked' }); },
        async identity() { checks++; return { ...owner }; },
        async nativeAccount() { return { ...native }; },
        store: { ownerCurrent: () => current },
    };
    const transport = new WorkspaceCoreTransport({ setupService, now: () => now, fetchImpl: async (url, options) => {
        calls.push({ url, options }); return send();
    } });
    return { transport, principal, owner, native, calls, setupService, now,
        revoke: () => { local = false; }, disconnect: () => { current = false; },
        reply: fn => { send = fn; }, checks: () => checks };
};

test('workspace transport uses only trusted platform/OIDC credentials and returns sanitized identity without credentials', async () => {
    const f = fixture();
    const result = await f.transport.request(f.principal, { path: '/v1/integration/workspace/context' });
    assert.deepEqual(result.identity, { actorId: f.owner.actorId, organizationId: f.owner.organizationId,
        nativeAccountId: f.native.external_tenant_id, coreAccountId: f.native.id, generation: f.owner.generation, expiresAt: f.owner.expiresAt });
    assert.equal(JSON.stringify(result).includes(f.owner.accessToken), false);
    assert.equal(JSON.stringify(result).includes('synthetic-server-secret'), false);
    assert.equal(f.calls[0].url, 'https://core.invalid/v1/integration/workspace/context');
    assert.equal(f.calls[0].options.headers.Authorization, `Bearer ${f.owner.accessToken}`);
    assert.equal(f.calls[0].options.headers['X-Savana-Platform-Code'], 'wa_savana');
    assert.equal(f.calls[0].options.redirect, 'error');
    assert.equal(f.calls[0].options.cache, 'no-store');
    assert.equal(f.checks(), 3);
});

test('private consumer selector is explicit and invalid header values are rejected before HTTP', async () => {
    const f = fixture();
    await f.transport.request(f.principal, { path: '/v1/integration/workspace/discovery', consumerInstallation: 'verified-consumer' });
    assert.equal(f.calls[0].options.headers['X-Savana-Consumer-Installation'], 'verified-consumer');
    for (const consumerInstallation of ['', 'x'.repeat(256), 'consumer\r\nInjected: true']) {
        await assert.rejects(f.transport.request(f.principal, { path: '/v1/integration/workspace/discovery', consumerInstallation }),
            error => error.code === 'workspace_request_invalid' && error.requestDispatched === false);
    }
    assert.equal(f.calls.length, 1);
});

const sharedSearch = () => ({ authorization: { scope: { organization_id: 'verified-organization', activity_id: 'activity' },
    provider_ref: 'source', source_platform: 'catalog', source_installation_id: 'source-installation', principal_kind: 'native_oidc',
    consumer_installation_id: 'verified-consumer', consumer_platform: 'wa_savana', allowed_fields: ['name'],
    authorization_revision: 'a'.repeat(64), valid_until: '2026-11-18T12:00:05Z' }, records: [] });

test('qualified shared resource GET accepts only the closed public authorization model', async () => {
    const f = fixture(); const options = { path: '/v1/integration/workspace/resources?activity_id=activity&provider_ref=source&resource_kind=offering&fields=name',
        sharedResourceModel: 'SharedResourceSearchView', consumerInstallation: 'verified-consumer' };
    f.reply(async () => Response.json(sharedSearch()));
    const result = await f.transport.request(f.principal, options);
    assert.deepEqual(result.payload, sharedSearch());
    for (const mutate of [p => { p.authorization = 'Bearer private'; },
        p => { p.authorization.access_token = 'private'; }, p => { p.records = [{ authorization: { password: 'private' } }]; }]) {
        const payload = sharedSearch(); mutate(payload); f.reply(async () => Response.json(payload));
        await assert.rejects(f.transport.request(f.principal, options), error => error.status === 502);
    }
    f.reply(async () => Response.json(sharedSearch()));
    await assert.rejects(f.transport.request(f.principal, { path: options.path }), { code: 'workspace_response_invalid' });
    f.reply(async () => Response.json(sharedSearch(), { status: 403 }));
    await assert.rejects(f.transport.request(f.principal, options), { code: 'workspace_response_invalid' });
    const before = f.calls.length;
    for (const extra of [{ path: '/v1/integration/workspace/discovery' }, { sharedResourceModel: 'SharedResourceReadView' },
        { method: 'POST', body: {} }, { consumerInstallation: null }, { sharedResourceModel: '__proto__' },
        { path: '/v1/integration/workspace/resources/%2e%2e' },
        { sharedResourceModel: 'SharedMediaPreviewView', path: '/v1/integration/workspace/resources/product/media/asset%3Aone/preview' },
        { sharedResourceModel: 'SharedResourceReadView', path: '/v1/integration/workspace/resources/_noncanonical' }]) {
        await assert.rejects(f.transport.request(f.principal, { ...options, ...extra }),
            error => error.code === 'workspace_request_invalid' && error.requestDispatched === false);
    }
    assert.equal(f.calls.length, before);
});

test('qualified resource queries preserve bounded opaque cursor characters without relaxing path traversal checks', async () => {
    const f = fixture(); f.reply(async () => Response.json(sharedSearch()));
    const cursor = 'جزء/صفحة.'.repeat(700);
    const query = new URLSearchParams({ activity_id: 'activity', provider_ref: 'source', resource_kind: 'offering', fields: 'name', cursor });
    await f.transport.request(f.principal, { path: `/v1/integration/workspace/resources?${query}`,
        sharedResourceModel: 'SharedResourceSearchView', consumerInstallation: 'verified-consumer' });
    assert.equal(new URL(f.calls[0].url).searchParams.get('cursor'), cursor);
    await assert.rejects(f.transport.request(f.principal, { path: `/v1/integration/workspace/discovery?${query}` }),
        { code: 'workspace_request_invalid' });
});

test('draft2 resource route identities retain raw source colons on the fixed Core path', async () => {
    const f = fixture(); const authorization = sharedSearch().authorization;
    const payload = { resource_kind: 'product', resource_ref: 'product:one', authorization,
        record: { resource_kind: 'product', scope: authorization.scope,
            source: { platform: 'catalog', installation_id: 'source-installation', external_tenant_id: 'catalog:tenant' },
            source_local_id: 'native-product', native_revision: 2, observed_at: '2026-11-18T12:00:00Z', data: { name: 'Actual source value' } } };
    f.reply(async () => Response.json(payload));
    await f.transport.request(f.principal, { path: '/v1/integration/workspace/resources/product:one?activity_id=activity&provider_ref=source&resource_kind=product&fields=name',
        sharedResourceModel: 'SharedResourceReadView', consumerInstallation: 'verified-consumer' });
    assert.equal(new URL(f.calls[0].url).pathname, '/v1/integration/workspace/resources/product:one');
});

test('source result uses exact MIME/hash/bytes and current identity; CSV is never mislabeled as a JSON receipt', async () => {
    const f = fixture(); const csv = Buffer.from('"اسم","الحالة"\r\n"عميل تجريبي","مؤكد"\r\n');
    const sha256 = crypto.createHash('sha256').update(csv).digest('hex');
    f.reply(async () => new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'x-savana-result-sha256': sha256 } }));
    const result = await f.transport.request(f.principal, { path: '/v1/integration/workspace/commands/original-command/result?format=csv', representation: 'csv' });
    assert.equal(result.payload.contentType, 'text/csv'); assert.equal(result.payload.sha256, sha256); assert.deepEqual(result.payload.bytes, csv);
    f.reply(async () => new Response(csv, { headers: { 'content-type': 'application/json', 'x-savana-result-sha256': sha256 } }));
    await assert.rejects(f.transport.request(f.principal, { path: '/v1/integration/workspace/commands/original-command/result?format=csv', representation: 'csv' }), { code: 'workspace_result_invalid', status: 502 });
    f.reply(async () => new Response(csv, { headers: { 'content-type': 'text/csv', 'x-savana-result-sha256': 'a'.repeat(64) } }));
    await assert.rejects(f.transport.request(f.principal, { path: '/v1/integration/workspace/commands/original-command/result?format=csv', representation: 'csv' }), { code: 'workspace_result_invalid', status: 502 });
    const before = f.calls.length;
    await assert.rejects(f.transport.request(f.principal, { path: '/v1/integration/workspace/discovery?format=csv', representation: 'csv' }), { code: 'workspace_request_invalid' });
    assert.equal(f.calls.length, before);
});

test('actual peer discovery and binding requests allow an unbound native account but commands never do', async () => {
    const f = fixture(); const calls = [];
    const setup = { ...f.setupService, nativeAccount: async (_p, _owner, { allowUnbound } = {}) => {
        if (allowUnbound) return null;
        throw new SharedProductReadError('shared_read_native_binding_required', 403);
    } };
    const transport = new WorkspaceCoreTransport({ setupService: setup, now: () => f.now,
        fetchImpl: async (url) => { calls.push(url); return Response.json({ state: 'current' }); } });
    const discovered = await transport.request(f.principal, { path: '/v1/integration/workspace/discovery' });
    assert.equal(discovered.identity.nativeAccountId, 'wa_savana:tenant:4');
    assert.equal(discovered.identity.coreAccountId, null);
    await transport.request(f.principal, { method: 'POST', path: '/v1/integration/workspace/binding-requests', body: {} });
    await assert.rejects(transport.request(f.principal, { method: 'POST', path: '/v1/integration/workspace/commands', body: {} }),
        error => error.code === 'shared_read_native_binding_required' && error.requestDispatched === false);
    assert.equal(calls.length, 2);
});

test('origin escape, arbitrary paths and encoded traversal cannot reach transport', async () => {
    const f = fixture();
    for (const path of ['https://other.invalid/v1/integration/workspace', '//other.invalid/v1/integration/workspace',
        '/api/session', '/v1/integration/workspace/../admin', '/v1/integration/workspace/%2e%2e/admin',
        '/v1/integration/workspace/\t../outside', '/v1/integration/workspace/%09../outside',
        '/v1/integration/workspace%2fadmin', '/v1/integration/workspace\\admin', '/v1/integration/workspace#secret']) {
        await assert.rejects(f.transport.request(f.principal, { path }), { code: 'workspace_request_invalid' });
    }
    await assert.rejects(f.transport.request(f.principal, { method: 'DELETE', path: '/v1/integration/workspace' }), { code: 'workspace_request_invalid' });
    assert.equal(f.calls.length, 0);
    assert.throws(() => new WorkspaceCoreTransport({ setupService: { ...f.setupService,
        config: { ...f.setupService.config, centerOrigin: 'http://public.invalid' } } }));
});

test('a review expiring during fresh identity checks never sends a mutation and carries local no-effect proof', async () => {
    const f = fixture(); let clock = f.now;
    const setup = { ...f.setupService, identity: async () => { clock += 1500; return { ...f.owner }; } };
    const transport = new WorkspaceCoreTransport({ setupService: setup, now: () => clock,
        fetchImpl: async () => { assert.fail('expired review must not dispatch'); } });
    await assert.rejects(transport.request(f.principal, { method: 'POST', path: '/v1/integration/workspace/commands',
        body: {}, notAfter: f.now + 1000 }), error => error.code === 'workspace_review_expired' && error.requestDispatched === false);
});

test('foreign native binding and missing current OIDC proof stop before remote mutation', async () => {
    for (const key of ['organization_id', 'platform_code', 'external_tenant_id', 'status']) {
        const f = fixture(); f.native[key] = 'foreign';
        await assert.rejects(f.transport.request(f.principal, { method: 'POST', path: '/v1/integration/workspace/requests', body: {} }),
            { code: 'workspace_context_changed' });
        assert.equal(f.calls.length, 0);
    }
    const f = fixture(); f.disconnect();
    await assert.rejects(f.transport.request(f.principal, { path: '/v1/integration/workspace' }), { code: 'workspace_identity_required' });
    assert.equal(f.calls.length, 0);
});

test('revocation or changed account/actor/session during the awaited effect discards its response', async () => {
    for (const mutate of [f => f.revoke(), f => f.disconnect(), f => { f.owner.actorId = 'other'; },
        f => { f.owner.generation = 'rotated'; }, f => { f.native.id = 'another-account'; },
        f => { f.principal.authVersion++; }]) {
        const f = fixture(); f.reply(async () => { mutate(f); return Response.json({ state: 'approved' }); });
        await assert.rejects(f.transport.request(f.principal, { method: 'POST', path: '/v1/integration/workspace/requests', body: {} }));
        assert.equal(f.calls.length, 1);
    }
});

test('a lost mutation reply or Core server failure remains unknown; definitive rejects remain distinct', async () => {
    const f = fixture(); f.reply(async () => { throw new Error('connection lost'); });
    await assert.rejects(f.transport.request(f.principal, { method: 'POST', path: '/v1/integration/workspace/requests', body: {} }),
        { code: 'workspace_outcome_unknown' });
    await assert.rejects(f.transport.request(f.principal, { path: '/v1/integration/workspace' }), { code: 'workspace_unavailable' });
    f.reply(async () => Response.json({ detail: { code: 'grant_revoked' } }, { status: 403 }));
    await assert.rejects(f.transport.request(f.principal, { method: 'POST', path: '/v1/integration/workspace/requests', body: {} }),
        error => error.code === 'workspace_rejected' && error.status === 403 && error.reasonCode === 'grant_revoked');
    f.reply(async () => Response.json({ detail: { code: 'temporary_failure' } }, { status: 500 }));
    await assert.rejects(f.transport.request(f.principal, { method: 'POST', path: '/v1/integration/workspace/requests', body: {} }),
        { code: 'workspace_outcome_unknown' });
});

test('secret-bearing, oversized and malformed Core responses never reach the owner', async () => {
    for (const reply of [() => Response.json({ nested: { access_token: 'not-for-browser' } }),
        () => new Response('{bad-json'), () => Response.json({ label: 'x'.repeat(1_048_576) }),
        () => new Response('{}', { headers: { 'Content-Length': '1048577' } })]) {
        const f = fixture(); f.reply(async () => reply());
        await assert.rejects(f.transport.request(f.principal, { path: '/v1/integration/workspace' }), { code: 'workspace_response_invalid' });
    }
});

test('a proposal prepared under another identity and non-JSON request values stop before dispatch', async () => {
    const f = fixture();
    const identity = await f.transport.currentIdentity(f.principal);
    f.owner.generation = 'different-generation';
    await assert.rejects(f.transport.request(f.principal, { method: 'POST', path: '/v1/integration/workspace/requests',
        body: {}, expectedIdentity: identity }), { code: 'workspace_context_changed' });
    const cyclic = {}; cyclic.self = cyclic;
    const accessor = { get name() { assert.fail('must not run a body getter'); } };
    for (const body of [{ amount: Infinity }, { value: undefined }, cyclic, accessor, new Date(), { huge: 'x'.repeat(1_048_576) }]) {
        await assert.rejects(f.transport.request(f.principal, { method: 'POST', path: '/v1/integration/workspace/requests', body }),
            { code: 'workspace_request_invalid' });
    }
    assert.equal(f.calls.length, 0);
});
