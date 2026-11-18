import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import express from 'express';
import Database from 'better-sqlite3';
import { CentralProductReadService, DelegatedReadBindings, centralProductReadConfigFromEnv, createSqliteReadPrincipalVerifier } from '../services/centralProductRead.js';
import { createSharedProductReadsRouter } from '../routes/sharedProductReads.js';

const now = Date.parse('2026-11-17T10:00:00Z');
const principal = { userId: 1, tenantId: 2, sessionId: 'verified-local-jti', authVersion: 3, role: 'tenant', sessionExpiresAt: now / 1000 + 3600 };
const scope = { organization_id: 'synthetic-org', activity_id: 'synthetic-activity', branch_id: null, warehouse_id: null };
const credentials = {
    accessToken: 'synthetic-central-oidc-read-token', expiresAt: '2026-11-17T11:00:00Z', scope,
    centralActorId: 'central-reader', consumerAccountId: 'wa-account', consumerInstallationId: 'wa-installation',
};
const context = () => ({ scope, actor_id: credentials.centralActorId, consumer_platform: 'wa_savana',
    consumer_account_id: credentials.consumerAccountId, consumer_installation_id: credentials.consumerInstallationId,
    checked_at: '2026-11-17T10:00:00Z', valid_until: '2026-11-17T10:05:00Z',
    authorization_revision: 'a'.repeat(64), permissions: ['data.read', 'capabilities.view_requirements'], freshness_max_age_seconds: 300 });
const product = overrides => ({ scope, entity_id: 'shared-product', entity_type: 'product', domain: 'product.core',
    source: { installation_id: 'catalog-installation', entity_type: 'product', local_entity_id: 'native-offering' },
    ownership_epoch: 2, expected_version: 2, source_revision: 'source-3', version: 3,
    observed_at: '2026-11-17T09:59:00Z', received_at: '2026-11-17T09:59:01Z',
    state: 'active', data: { name: 'Permitted source name' }, freshness: 'current', field_visibility: 'explicit_grants_only', ...overrides });
const fixture = () => {
    const bindings = new DelegatedReadBindings();
    bindings.bind(principal, credentials);
    const calls = [];
    let valid = true;
    let clock = now;
    let mutation = (path, payload) => payload;
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        const parsed = new URL(url);
        let payload;
        if (parsed.pathname === '/v1/integration/context') payload = { context: context() };
        else if (parsed.pathname === '/v1/integration/capabilities') payload = {
            runtime_activation: false, platforms: ['pos', 'catalog', 'wa_savana', 'sawemly'],
            capabilities: [{ code: 'products.read', result_meaning: 'read_model' }],
        };
        else if (parsed.pathname === '/v1/integration/eligibility') payload = {
            scope, actor_id: credentials.centralActorId, consumer_platform: 'wa_savana', capability_code: 'products.read',
            view_requirements: true, request_review: false, execute: false, authorization_token: false,
            blockers: [{ code: 'not_implemented', message: 'Business execution unavailable' }],
        };
        else if (parsed.pathname === '/v1/integration/data/search') payload = {
            context: context(), records: [product()], has_more: false, next_cursor: null,
        };
        else if (parsed.pathname === '/v1/integration/data/changes') payload = {
            context: context(), changes: [{ cursor: 8, record: product({ state: 'archived' }) }], cursor: 10, has_more: false,
        };
        else if (parsed.pathname === '/v1/integration/data/records/product/shared-product') payload = {
            context: context(), record: product(),
        };
        else assert.fail(`Unexpected network path ${parsed.pathname}`);
        const result = await mutation(parsed.pathname, { spec_version: '1.0', ...payload });
        return result instanceof Response ? result : Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    };
    const service = new CentralProductReadService({ enabled: true, baseUrl: 'http://127.0.0.1:40001', platformToken: 'server-platform-secret',
        trustedBindings: bindings, verifyLocalPrincipal: () => valid, fetchImpl, now: () => clock, allowLoopback: true });
    return { service, bindings, calls, setValid: value => { valid = value; }, setClock: value => { clock = value; }, mutate: fn => { mutation = fn; } };
};

test('new read feature defaults off, makes no request and never borrows browser/local tokens', async () => {
    assert.equal(centralProductReadConfigFromEnv({}).enabled, false);
    let calls = 0;
    const service = new CentralProductReadService({ fetchImpl: () => { calls++; } });
    await assert.rejects(service.search(principal), { code: 'shared_product_reads_disabled', status: 503 });
    assert.equal(calls, 0);
    const f = fixture();
    for (const changed of [{ tenantId: 9 }, { userId: 9 }, { sessionId: 'another-session' }, { authVersion: 4 }]) {
        await assert.rejects(f.service.search({ ...principal, ...changed }), { code: 'shared_product_read_session_required' });
    }
    assert.equal(f.calls.length, 0);
});

test('published canonical availability is accepted as advisory metadata and never changes data.read authority', async () => {
    const f = fixture();
    const availability = { state: 'permission_required', reason_code: 'command_scope_required', message: 'Review current command permission',
        next_action: { code: 'review', label: 'Review permission', href: '/?workspace=shared' } };
    f.mutate((path, payload) => path === '/v1/integration/eligibility'
        ? { ...payload, availability, provider_evaluations: [{ platform: 'catalog', account_id: 'catalog-account', installation_id: 'catalog-installation',
            authorization_revision: 'a'.repeat(64), can_request_review: false, can_execute: false, blockers: [], availability }] } : payload);
    const result = await f.service.search(principal);
    assert.equal(result.records.length, 1); assert.equal(result.eligibility.availability.state, 'permission_required');
    f.mutate((path, payload) => path === '/v1/integration/eligibility' ? { ...payload, availability: { ...availability, state: 'invented-ready' } } : payload);
    await assert.rejects(f.service.search(principal), { code: 'shared_product_response_invalid', status: 502 });
});

test('read uses only server-bound credentials/selectors, real advisory paths and provenance without inventing prices/actions', async () => {
    const f = fixture();
    const result = await f.service.search(principal, { q: 'source', limit: 10 });
    assert.deepEqual(f.calls.map(call => [new URL(call.url).pathname, call.options.method]), [
        ['/v1/integration/context', 'GET'], ['/v1/integration/capabilities', 'GET'],
        ['/v1/integration/eligibility', 'POST'], ['/v1/integration/data/search', 'GET'],
    ]);
    for (const call of f.calls) {
        assert.equal(call.options.headers.Authorization, `Bearer ${credentials.accessToken}`);
        assert.equal(call.options.headers['X-Savana-Platform-Code'], 'wa_savana');
        assert.equal(call.options.headers['X-Savana-Platform-Token'], 'server-platform-secret');
        assert.equal(call.options.redirect, 'error');
    }
    assert.deepEqual(result.records[0], product());
    assert.equal(result.records[0].data.price, undefined);
    assert.equal(result.records[0].data.currency, undefined);
    assert.equal(result.records[0].data.unit, undefined);
    assert.equal(result.execution_ready, false);
    assert.equal(result.pricing_use_allowed, false);
    assert.equal(result.eligibility.execute, false);
    assert.equal(JSON.stringify(result).includes(credentials.accessToken), false);
    const query = new URL(f.calls.at(-1).url).searchParams;
    assert.equal(query.get('organization_id'), scope.organization_id);
    assert.equal(query.get('consumer_installation_id'), credentials.consumerInstallationId);
    assert.equal(query.has('domain'), false);
});

test('changes are read observations preserving returned cursor, duplicates and old versions cannot mutate or revive any product', async () => {
    const f = fixture();
    f.mutate((path, payload) => path.endsWith('/changes') ? { ...payload, changes: [
        { cursor: 8, record: product({ state: 'tombstone', version: 5 }) },
        { cursor: 9, record: product({ state: 'active', version: 2 }) },
    ], cursor: 12 } : payload);
    const first = await f.service.changes(principal, { after: 7, limit: 10 });
    const repeated = await f.service.changes(principal, { after: 7, limit: 10 });
    assert.deepEqual(repeated, first);
    assert.equal(first.cursor, 12);
    assert.equal(first.changes[0].record.state, 'tombstone');
    assert.equal(first.changes[1].record.version, 2);
    // A fresh record read always comes from the current record endpoint;
    // observations above are never applied into a cached/native product row.
    assert.equal((await f.service.record(principal, { entityId: 'shared-product' })).record.version, 3);
});

test('non-product domains are filtered without altering opaque search or change continuations', async () => {
    const f = fixture();
    f.mutate((path, payload) => path.endsWith('/search') ? { ...payload,
        records: [{ entity_type: 'customer', domain: 'customer.core', data: { name: 'unrelated' } }],
        has_more: true, next_cursor: 'opaque-original',
    } : path.endsWith('/changes') ? { ...payload,
        changes: [{ cursor: 9, record: { entity_type: 'order', domain: 'order.core' } }], cursor: 11,
    } : payload);
    const search = await f.service.search(principal);
    assert.deepEqual(search.records, []);
    assert.equal(search.next_cursor, 'opaque-original');
    const changes = await f.service.changes(principal);
    assert.deepEqual(changes.changes, []);
    assert.equal(changes.cursor, 11);
});

for (const [status, code] of [[401, 'invalid_token'], [403, 'integration_grant_required'], [404, 'record_not_found'],
    [409, 'integration_cursor_invalid'], [503, 'integration_runtime_unavailable']]) {
    test(`${status} ${code} clears availability instead of manufacturing a tombstone or a cached grant`, async () => {
        const f = fixture();
        await f.service.search(principal);
        f.mutate((path, payload) => path.endsWith('/search') ? Response.json({ error: { code, message: 'do not echo a remote secret' } }, { status }) : payload);
        await assert.rejects(f.service.search(principal), { code, status });
    });
}

test('local session/binding revocation during an in-flight read supersedes its prior successful central result', async () => {
    for (const revoke of ['local', 'binding']) {
        const f = fixture();
        f.mutate((path, payload) => {
            if (path.endsWith('/search')) {
                if (revoke === 'local') f.setValid(false); else f.bindings.revoke(principal);
            }
            return payload;
        });
        await assert.rejects(f.service.search(principal), { code: 'shared_product_read_session_required' });
    }
});

test('foreign scope, actor, account and authorization revision changes fail closed', async () => {
    for (const changed of [
        { scope: { ...scope, activity_id: 'foreign' } }, { actor_id: 'foreign-actor' },
        { consumer_account_id: 'foreign-account' }, { consumer_platform: 'catalog' },
        { valid_until: '2026-11-17T09:00:00Z' }, { permissions: [] },
    ]) {
        const f = fixture();
        f.mutate((path, payload) => path.endsWith('/search') ? { ...payload, context: { ...payload.context, ...changed } } : payload);
        await assert.rejects(f.service.search(principal), { code: 'shared_product_response_scope_invalid' });
    }
    const f = fixture();
    f.mutate((path, payload) => path.endsWith('/search') ? { ...payload, context: { ...payload.context, authorization_revision: 'b'.repeat(64) } } : payload);
    await assert.rejects(f.service.search(principal), { code: 'integration_authorization_changed' });
});

test('unsafe cursors/versions and malformed lifecycle or provenance are never rounded, persisted or made usable', async () => {
    const f = fixture();
    await assert.rejects(f.service.changes(principal, { after: 9223372036854775807 }), { code: 'integration_request_invalid' });
    assert.equal(f.calls.length, 0);
    for (const changed of [{ version: 9223372036854775807 }, { state: 'deleted' },
        { source: { local_entity_id: 'native-id', entity_type: 'product' } }, { data: null }]) {
        const f = fixture();
        f.mutate((path, payload) => path.endsWith('/search') ? { ...payload, records: [product(changed)] } : payload);
        await assert.rejects(f.service.search(principal), { code: 'shared_product_response_invalid' });
    }
});

test('timeout and malformed successful responses never fall back to an earlier read', async () => {
    const f = fixture();
    await f.service.search(principal);
    f.mutate((path, payload) => { if (path.endsWith('/search')) throw new Error('synthetic timeout'); return payload; });
    await assert.rejects(f.service.search(principal), { code: 'shared_product_verification_unavailable' });
    f.mutate((path, payload) => path.endsWith('/search') ? Response.json(payload) : payload);
    await assert.rejects(f.service.search(principal), { code: 'shared_product_response_invalid' });
});

test('actual WA read routes reject browser scope/readiness/token injection and return no-store failures', async t => {
    const f = fixture();
    const app = express();
    app.use((req, res, next) => { req.user = { id: 1, tenant_id: 2, jti: principal.sessionId, auth_version: 3, role: 'tenant', exp: principal.sessionExpiresAt }; next(); });
    app.use('/portal/integrations', createSharedProductReadsRouter({ service: f.service }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/portal/integrations`;
    for (const query of ['organization_id=foreign', 'activity_id=foreign', 'execution_ready=true',
        'access_token=browser-secret', 'q[foreign]=1', 'after=9223372036854775807', 'limit=1.5']) {
        const path = query.startsWith('after') ? '/shared-product-changes' : '/shared-products';
        const response = await fetch(`${base}${path}?${query}`);
        assert.equal(response.status, 422);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const body = await response.json();
        assert.equal(body.clear_previous, true);
        assert.equal(body.execution_ready, false);
        assert.equal(JSON.stringify(body).includes('browser-secret'), false);
    }
    assert.equal(f.calls.length, 0);
    const response = await fetch(`${base}/shared-products`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).records[0].entity_id, 'shared-product');
});

test('unexpected public metadata cannot forward debug/token/foreign record fields outside the granted fragment', async () => {
    for (const mutate of [
        payload => ({ ...payload, access_token: 'must-never-reach-browser' }),
        payload => ({ ...payload, record: { private_note: 'foreign top-level payload' } }),
        payload => ({ ...payload, context: { ...payload.context, access_token: 'must-never-reach-browser' } }),
        payload => ({ ...payload, records: [{ ...product(), private_note: 'outside allowed data' }] }),
        payload => ({ ...payload, records: [product({ source: { ...product().source, debug: 'outside provenance' } })] }),
    ]) {
        const f = fixture();
        f.mutate((path, payload) => path.endsWith('/search') ? mutate(payload) : payload);
        await assert.rejects(f.service.search(principal), { code: 'shared_product_response_invalid' });
    }
});

test('delegated credentials require HTTPS or narrow server/owned-fixture HTTP exceptions', () => {
    for (const baseUrl of ['http://public.example.test', 'http://savana-connect:9999', 'http://127.0.0.1:5000']) {
        assert.throws(() => new CentralProductReadService({ enabled: true, baseUrl, platformToken: 'secret' }));
    }
    for (const baseUrl of ['https://connect.example.test', 'http://savana-connect:8010']) {
        assert.doesNotThrow(() => new CentralProductReadService({ enabled: true, baseUrl, platformToken: 'secret' }));
    }
});

test('local JWT expiry during a central read supersedes the longer delegated read binding', async () => {
    const f = fixture();
    f.mutate((path, payload) => {
        if (path.endsWith('/search')) f.setClock(now + 20_000);
        return payload;
    });
    await assert.rejects(f.service.search({ ...principal, sessionExpiresAt: now / 1000 + 10 }), {
        code: 'shared_product_read_session_required',
    });
});

test('central product identity preserves a source offering namespace without adopting it as a WA product', async () => {
    const f = fixture();
    f.mutate((path, payload) => path.endsWith('/search') ? { ...payload,
        records: [product({ source: { ...product().source, entity_type: 'offering' } })],
    } : payload);
    const result = await f.service.search(principal);
    assert.equal(result.records[0].source.entity_type, 'offering');
    assert.equal(result.records[0].entity_id, 'shared-product');
    assert.equal(result.records[0].source.local_entity_id, 'native-offering');
});

test('the current SQLite local identity and signed JWT expiry cannot be replaced by an old read binding', () => {
    const database = new Database(':memory:');
    try {
        database.exec(`
            CREATE TABLE tenants (id INTEGER PRIMARY KEY, status TEXT);
            CREATE TABLE users (id INTEGER PRIMARY KEY, tenant_id INTEGER, role TEXT, is_active INTEGER, auth_version INTEGER, tokens_revoked_at TEXT);
            CREATE TABLE revoked_tokens (jti TEXT PRIMARY KEY);
            INSERT INTO tenants VALUES (2, 'Active');
            INSERT INTO users VALUES (1, 2, 'tenant', 1, 3, NULL);
        `);
        const live = { ...principal, issuedAt: Math.floor(Date.now() / 1000), sessionExpiresAt: Math.floor(Date.now() / 1000) + 60 };
        const verify = createSqliteReadPrincipalVerifier(database);
        assert.equal(verify(live), true);
        assert.equal(verify({ ...live, sessionExpiresAt: live.issuedAt - 1 }), false);
        assert.equal(verify({ ...live, authVersion: 2 }), false);
        assert.equal(verify({ ...live, tenantId: 999 }), false);
        database.exec("UPDATE tenants SET status = 'Suspended'");
        assert.equal(verify(live), false);
        database.exec("UPDATE tenants SET status = 'Active'; UPDATE users SET is_active = 0");
        assert.equal(verify(live), false);
        database.exec('UPDATE users SET is_active = 1');
        database.prepare('INSERT INTO revoked_tokens VALUES (?)').run(live.sessionId);
        assert.equal(verify(live), false);
    } finally { database.close(); }
});
