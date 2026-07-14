import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createApiV1EventsRouter } from '../routes/api/v1Events.js';

const NOW = Date.parse('2026-07-14T13:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW / 1000);

function createDatabase() {
    const database = new Database(':memory:');
    database.exec(`
        CREATE TABLE tenants (
            id INTEGER PRIMARY KEY, name TEXT, status TEXT, dataset_id TEXT, waba_id TEXT
        );
        CREATE TABLE contacts (
            tenant_id INTEGER, phone TEXT, last_ctwa_clid TEXT,
            last_ctwa_source_id TEXT, last_ctwa_source_type TEXT,
            last_ctwa_source_url TEXT, last_ctwa_received_at DATETIME
        );
        CREATE TABLE conversion_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, dataset_id TEXT,
            event_name TEXT, event_time DATETIME, phone TEXT, wamid TEXT,
            custom_data TEXT, status TEXT, meta_response TEXT, ctwa_clid TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO tenants VALUES
            (1, 'Tenant A', 'Active', 'dataset/A', 'waba-A'),
            (2, 'No Dataset', 'Active', NULL, 'waba-B'),
            (3, 'Suspended', 'Suspended', 'dataset-C', 'waba-C'),
            (4, 'No Token', 'Active', 'dataset-D', 'waba-D');
        INSERT INTO contacts VALUES (
            1, '218910000001', 'stored-clid', 'source-1', 'ad', 'https://example.com',
            '2026-07-14 12:00:00'
        );
    `);
    return database;
}

function createBilling() {
    const calls = { reserves: [], commits: [], releases: [] };
    return {
        calls,
        operations: { WHATSAPP_EVENT_CONVERSION: 'whatsapp.event' },
        reserve(options) {
            const reservation = { id: calls.reserves.length + 1, ...options };
            calls.reserves.push(reservation);
            return reservation;
        },
        commit(reservation, options) { calls.commits.push({ reservation, options }); },
        release(reservation, reason) { calls.releases.push({ reservation, reason }); },
        handleError: () => false,
    };
}

const findHandler = (router, method, routePath) => {
    const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.at(-1).handle;
};

const invoke = async (router, method, routePath, request = {}) => {
    const req = { tenantId: 1, body: {}, params: {}, query: {}, ...request };
    const res = {
        statusCode: 200,
        body: undefined,
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; return this; },
    };
    await findHandler(router, method, routePath)(req, res);
    return res;
};

function createHarness({ responses = [], billing: billingOverride } = {}) {
    const database = createDatabase();
    const billing = billingOverride || createBilling();
    const requests = [];
    const errors = [];
    const router = createApiV1EventsRouter({
        database,
        accessTokenForTenant: tenantId => tenantId === 4 ? null : `token-${tenantId}`,
        billing,
        fetchImpl: async (url, init = {}) => {
            requests.push({ url, init });
            const response = responses.shift();
            if (response instanceof Error) throw response;
            return response;
        },
        parseMetaResponse: async response => response,
        logger: { error: (...args) => errors.push(args) },
        now: () => NOW,
        apiBase: 'https://graph.test/v25.0',
    });
    return { database, billing, requests, errors, router };
}

const purchase = (overrides = {}) => ({
    event_name: 'Purchase',
    phone: '218910000001',
    event_time: NOW_SECONDS,
    custom_data: { currency: 'LYD', value: 20 },
    ...overrides,
});

test('API v1 events reject tenant, configuration and payload errors before Meta or billing', async (t) => {
    const h = createHarness();
    t.after(() => h.database.close());

    const cases = [
        { request: { tenantId: 0, body: { events: [purchase()] } }, status: 401 },
        { request: { tenantId: 99, body: { events: [purchase()] } }, status: 404 },
        { request: { tenantId: 2, body: { events: [purchase()] } }, status: 400 },
        { request: { tenantId: 3, body: { events: [purchase()] } }, status: 403 },
        { request: { tenantId: 4, body: { events: [purchase()] } }, status: 400 },
        { request: { body: { events: [] } }, status: 400 },
        { request: { body: { events: Array.from({ length: 101 }, () => purchase()) } }, status: 400 },
        { request: { body: { events: [purchase({ event_name: 'Unknown' })] } }, status: 400 },
        { request: { body: { events: [purchase({ custom_data: [] })] } }, status: 400 },
        {
            request: {
                body: { events: [purchase({ phone: '218910000009', ctwa_clid: undefined })] },
            },
            status: 400,
        },
    ];
    for (const entry of cases) {
        const result = await invoke(h.router, 'post', '/events', entry.request);
        assert.equal(result.statusCode, entry.status);
    }
    assert.equal(h.requests.length, 0);
    assert.equal(h.billing.calls.reserves.length, 0);
});

test('API v1 events normalize attribution, encode datasets, persist batches and commit once', async (t) => {
    const h = createHarness({ responses: [{
        ok: true,
        status: 200,
        data: { events_received: 2, fbtrace_id: 'trace-public' },
    }] });
    t.after(() => h.database.close());

    const result = await invoke(h.router, 'post', '/events', {
        body: {
            events: [
                purchase({ phone: '+218 91 000 0001', wamid: ' wa-1 ' }),
                purchase({
                    event_name: 'LeadSubmitted',
                    phone: undefined,
                    ctwa_clid: ' explicit-clid ',
                    custom_data: { source: 'api' },
                }),
            ],
        },
    });

    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, {
        success: true,
        events_received: 2,
        fbtrace_id: 'trace-public',
    });
    assert.match(h.requests[0].url, /\/dataset%2FA\/events$/);
    assert.equal(h.requests[0].init.headers.Authorization, 'Bearer token-1');
    const payload = JSON.parse(h.requests[0].init.body);
    assert.equal(payload.data[0].user_data.ctwa_clid, 'stored-clid');
    assert.equal(payload.data[1].user_data.ctwa_clid, 'explicit-clid');
    assert.equal(payload.data[0].user_data.whatsapp_business_account_id, 'waba-A');
    assert.equal(h.billing.calls.reserves.length, 1);
    assert.equal(h.billing.calls.commits.length, 1);
    assert.equal(h.billing.calls.releases.length, 0);
    assert.deepEqual(
        h.database.prepare('SELECT event_name, phone, wamid, status FROM conversion_events ORDER BY id').all(),
        [
            { event_name: 'Purchase', phone: '218910000001', wamid: 'wa-1', status: 'sent' },
            { event_name: 'LeadSubmitted', phone: null, wamid: null, status: 'sent' },
        ],
    );
});

test('API v1 events persist normalized Meta failures and release transport failures exactly once', async (t) => {
    const h = createHarness({ responses: [
        { ok: false, status: 429, error: { message: 'Rate limited', code: 4 } },
        new Error('network down'),
    ] });
    t.after(() => h.database.close());

    const metaFailure = await invoke(h.router, 'post', '/events', {
        body: { events: [purchase()] },
    });
    assert.equal(metaFailure.statusCode, 429);
    assert.equal(metaFailure.body.error, 'Rate limited');

    const transportFailure = await invoke(h.router, 'post', '/events', {
        body: { events: [purchase()] },
    });
    assert.equal(transportFailure.statusCode, 500);
    assert.equal(transportFailure.body.error, 'Failed to send conversion events');

    assert.equal(h.billing.calls.reserves.length, 2);
    assert.equal(h.billing.calls.commits.length, 0);
    assert.equal(h.billing.calls.releases.length, 2);
    assert.equal(h.database.prepare('SELECT COUNT(*) AS count FROM conversion_events').get().count, 1);
    const stored = h.database.prepare('SELECT status, meta_response FROM conversion_events').get();
    assert.equal(stored.status, 'failed');
    assert.deepEqual(JSON.parse(stored.meta_response), {
        error: { message: 'Rate limited', code: 4 },
    });
});

test('API v1 event history is paginated, tenant-scoped and sanitizes legacy Meta payloads', async (t) => {
    const h = createHarness();
    t.after(() => h.database.close());
    const insert = h.database.prepare(`
        INSERT INTO conversion_events (
            tenant_id, dataset_id, event_name, event_time, phone, status,
            meta_response, ctwa_clid, created_at
        ) VALUES (?, ?, 'Purchase', '2026-07-14T12:00:00.000Z', ?, 'failed', ?, ?, ?)
    `);
    insert.run(1, 'dataset/A', '218910000001', JSON.stringify({
        error: {
            message: 'Rejected',
            code: 100,
            fbtrace_id: 'private-trace',
            error_data: { secret: 'private' },
        },
    }), 'clid-a', '2026-07-14 12:00:00');
    insert.run(2, 'dataset/B', '218910000002', JSON.stringify({ error: { message: 'Other' } }), 'clid-b', '2026-07-14 13:00:00');

    const result = await invoke(h.router, 'get', '/events/history', {
        query: { limit: '1', offset: '0' },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.total, 1);
    assert.equal(result.body.events.length, 1);
    assert.equal(result.body.events[0].tenant_id, 1);
    const safeMeta = JSON.parse(result.body.events[0].meta_response);
    assert.equal(safeMeta.error.message, 'Rejected');
    assert.equal(safeMeta.error.code, 100);
    assert.doesNotMatch(JSON.stringify(safeMeta), /private-trace|error_data|secret/);

    const invalidTenant = await invoke(h.router, 'get', '/events/history', { tenantId: 0 });
    assert.equal(invalidTenant.statusCode, 401);
});
