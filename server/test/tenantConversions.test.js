import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createTenantConversionsRouter } from '../routes/tenantConversions.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE tenants (
            id INTEGER PRIMARY KEY,
            name TEXT,
            status TEXT,
            phone_number_id TEXT,
            waba_id TEXT,
            business_id TEXT,
            dataset_id TEXT,
            access_token TEXT,
            access_token_encrypted TEXT,
            updated_at DATETIME
        );
        CREATE TABLE activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            tenant_name TEXT,
            event_type TEXT,
            description TEXT,
            status TEXT
        );
        CREATE TABLE contacts (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            phone TEXT,
            last_ctwa_clid TEXT,
            last_ctwa_source_id TEXT,
            last_ctwa_source_type TEXT,
            last_ctwa_source_url TEXT,
            last_ctwa_received_at DATETIME
        );
        CREATE TABLE conversion_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            phone_number_id TEXT,
            dataset_id TEXT NOT NULL,
            event_name TEXT NOT NULL,
            event_time DATETIME NOT NULL,
            phone TEXT,
            wamid TEXT,
            custom_data TEXT,
            status TEXT,
            meta_response TEXT,
            ctwa_clid TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        );
        INSERT INTO tenants (
            id, name, waba_id, dataset_id, access_token, access_token_encrypted
        ) VALUES
            (1, 'Tenant A', 'waba/A', 'dataset-a', NULL, 'encrypted-a'),
            (2, 'Tenant B', 'waba-b', 'dataset-b', 'legacy-b', NULL),
            (3, 'Tenant Local', 'waba-local', NULL, NULL, NULL);
    `);
    return db;
}

function enableMultipleWhatsAppNumbers(db) {
    db.exec(`
        CREATE TABLE tenant_whatsapp_numbers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            phone_number_id TEXT NOT NULL UNIQUE,
            waba_id TEXT,
            business_id TEXT,
            dataset_id TEXT,
            display_phone_number TEXT,
            verified_name TEXT,
            label TEXT,
            quality_rating TEXT,
            platform_status TEXT,
            access_token_encrypted TEXT,
            is_default INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (tenant_id, phone_number_id)
        );
        CREATE UNIQUE INDEX one_conversion_default_number
            ON tenant_whatsapp_numbers(tenant_id) WHERE is_default = 1;
        UPDATE tenants
        SET status = 'Active', phone_number_id = 'phone-a', business_id = 'business-a'
        WHERE id = 1;
        INSERT INTO tenant_whatsapp_numbers (
            tenant_id, phone_number_id, waba_id, business_id, dataset_id,
            access_token_encrypted, is_default, is_active
        ) VALUES
            (1, 'phone-a', 'waba/A', 'business-a', 'dataset-a', 'invalid-a', 1, 1),
            (1, 'phone-a-2', 'waba/A2', 'business-a', 'dataset-a2', 'invalid-a2', 0, 1),
            (2, 'phone-b', 'waba-b', 'business-b', 'dataset-b', 'invalid-b', 1, 1);
    `);
}

function createBilling() {
    const calls = { reserves: [], commits: [], releases: [] };
    return {
        calls,
        operations: { WHATSAPP_EVENT_CONVERSION: 'whatsapp.event_conversion' },
        reserve(options) {
            const reservation = { id: calls.reserves.length + 1, ...options };
            calls.reserves.push(reservation);
            return reservation;
        },
        commit(reservation, options) {
            calls.commits.push({ reservation, options });
            return { ...reservation, status: 'committed' };
        },
        release(reservation, reason) {
            calls.releases.push({ reservation, reason });
            return { ...reservation, status: 'released' };
        },
        handleError: () => false,
    };
}

const findRouteHandlers = (router, method, routePath) => {
    const layer = router.stack.find((item) => item.route?.path === routePath && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.map((item) => item.handle);
};

const invokeRoute = (router, method, routePath, request = {}) => new Promise((resolve, reject) => {
    const req = { body: {}, headers: {}, params: {}, query: {}, ...request };
    const res = {
        statusCode: 200,
        body: undefined,
        status(value) {
            this.statusCode = value;
            return this;
        },
        json(value) {
            this.body = value;
            resolve(this);
            return this;
        },
    };
    const handlers = findRouteHandlers(router, method, routePath);
    let index = 0;
    const next = (error) => {
        if (error) return reject(error);
        if (index >= handlers.length) return resolve(res);
        try {
            Promise.resolve(handlers[index++](req, res, next)).catch(reject);
        } catch (handlerError) {
            reject(handlerError);
        }
    };
    next();
});

test('conversion dataset discovery and settings are tenant-scoped and validated', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const calls = [];
    const router = createTenantConversionsRouter({
        database: db,
        accessTokenForTenant: (tenantId) => tenantId === 1 ? 'token-a' : tenantId === 2 ? 'token-b' : null,
        billing: createBilling(),
        requestMeta: async (url, init) => {
            calls.push({ url, init });
            return { ok: true, status: 200, data: { data: [{ id: 'dataset-a2' }] } };
        },
    });

    const datasets = await invokeRoute(router, 'get', '/conversions/datasets', {
        user: { tenant_id: 1 },
    });
    assert.equal(datasets.statusCode, 200);
    assert.equal(datasets.body.waba_id, 'waba/A');
    assert.deepEqual(datasets.body.datasets, [{ id: 'dataset-a2' }]);
    assert.match(calls[0].url, /\/waba%2FA\/dataset$/);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer token-a');

    const updated = await invokeRoute(router, 'patch', '/meta-settings', {
        user: { tenant_id: 1 },
        body: { dataset_id: '  dataset-new  ' },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.body.dataset_id, 'dataset-new');
    assert.equal(db.prepare('SELECT dataset_id FROM tenants WHERE id = 1').get().dataset_id, 'dataset-new');
    assert.equal(db.prepare('SELECT dataset_id FROM tenants WHERE id = 2').get().dataset_id, 'dataset-b');
    assert.equal(db.prepare('SELECT tenant_id FROM activity_logs').get().tenant_id, 1);

    const invalid = await invokeRoute(router, 'patch', '/meta-settings', {
        user: { tenant_id: 1 },
        body: { dataset_id: { nested: true } },
    });
    assert.equal(invalid.statusCode, 400);
    const missingTenant = await invokeRoute(router, 'get', '/conversions/datasets', {
        user: { tenant_id: 99 },
    });
    assert.equal(missingTenant.statusCode, 404);
});

test('conversion history is paginated, sanitized and isolated with aggregate stats', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    db.exec(`
        INSERT INTO conversion_events (
            id, tenant_id, dataset_id, event_name, event_time, status, meta_response, created_at
        ) VALUES
            (1, 1, 'dataset-a', 'Purchase', '2026-07-01', 'sent',
             '{"events_received":1,"fbtrace_id":"trace-a","access_token":"secret"}', '2026-07-01 10:00:00'),
            (2, 1, 'dataset-a', 'LeadSubmitted', '2026-07-02', 'failed',
             '{"error":{"message":"Denied","code":200,"error_subcode":33,"debug":"secret"}}', '2026-07-02 10:00:00'),
            (3, 1, 'local', 'Purchase', '2026-07-03', 'local_only', NULL, '2026-07-03 10:00:00'),
            (4, 2, 'dataset-b', 'OrderCreated', '2026-07-04', 'sent',
             '{"events_received":99,"fbtrace_id":"trace-b"}', '2026-07-04 10:00:00');
    `);
    const router = createTenantConversionsRouter({
        database: db,
        accessTokenForTenant: (tenantId) => tenantId === 1 ? 'token-a' : 'token-b',
        billing: createBilling(),
        requestMeta: async () => assert.fail('History must not call Meta'),
    });

    const history = await invokeRoute(router, 'get', '/conversions/history', {
        user: { tenant_id: 1 },
        query: { limit: '2', offset: '0' },
    });
    assert.equal(history.statusCode, 200);
    assert.equal(history.body.total, 3);
    assert.equal(history.body.events.length, 2);
    assert.ok(history.body.events.every((event) => event.tenant_id === 1));
    assert.doesNotMatch(history.body.events.map((event) => event.meta_response).join(''), /secret/);
    assert.deepEqual({
        total: history.body.stats.totalEvents,
        sent: history.body.stats.sentEvents,
        failed: history.body.stats.failedEvents,
        local: history.body.stats.localOnlyEvents,
    }, { total: 3, sent: 1, failed: 1, local: 1 });
    assert.equal(history.body.last_success.fbtrace_id, 'trace-a');
    assert.equal(history.body.last_failure.error_message, 'Denied');
    assert.equal(history.body.last_failure.error_subcode, 33);
    assert.equal(history.body.events_api_ready, true);
    assert.equal(history.body.tenant_whatsapp_token_present, true);

    const missing = await invokeRoute(router, 'get', '/conversions/history', {
        user: { tenant_id: 99 },
    });
    assert.equal(missing.statusCode, 404);
});

test('conversion settings and history are isolated by the selected WhatsApp number', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    enableMultipleWhatsAppNumbers(db);
    db.exec(`
        INSERT INTO conversion_events (
            tenant_id, phone_number_id, dataset_id, event_name, event_time, status
        ) VALUES
            (1, 'phone-a', 'dataset-a', 'Purchase', '2026-07-01', 'sent'),
            (1, 'phone-a-2', 'dataset-a2', 'LeadSubmitted', '2026-07-02', 'failed');
    `);
    const metaCalls = [];
    const router = createTenantConversionsRouter({
        database: db,
        accessTokenForTenant: () => 'fallback-token-a',
        billing: createBilling(),
        requestMeta: async (url) => {
            metaCalls.push(url);
            return { ok: true, status: 200, data: { data: [{ id: 'dataset-a2' }] } };
        },
    });
    const selected = { 'x-whatsapp-phone-number-id': 'phone-a-2' };

    const history = await invokeRoute(router, 'get', '/conversions/history', {
        user: { tenant_id: 1 },
        headers: selected,
    });
    assert.equal(history.statusCode, 200);
    assert.equal(history.body.total, 1);
    assert.equal(history.body.phone_number_id, 'phone-a-2');
    assert.equal(history.body.events[0].phone_number_id, 'phone-a-2');
    assert.equal(history.body.dataset_id, 'dataset-a2');

    const updated = await invokeRoute(router, 'patch', '/meta-settings', {
        user: { tenant_id: 1 },
        headers: selected,
        body: { dataset_id: 'dataset-a2-new' },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(
        db.prepare("SELECT dataset_id FROM tenant_whatsapp_numbers WHERE phone_number_id = 'phone-a-2'").get().dataset_id,
        'dataset-a2-new',
    );
    assert.equal(db.prepare('SELECT dataset_id FROM tenants WHERE id = 1').get().dataset_id, 'dataset-a');

    const datasets = await invokeRoute(router, 'get', '/conversions/datasets', {
        user: { tenant_id: 1 },
        headers: selected,
    });
    assert.equal(datasets.statusCode, 200);
    assert.match(metaCalls[0], /\/waba%2FA2\/dataset$/);

    const crossTenant = await invokeRoute(router, 'get', '/conversions/history', {
        user: { tenant_id: 1 },
        headers: { 'x-whatsapp-phone-number-id': 'phone-b' },
    });
    assert.equal(crossTenant.statusCode, 404);
});

test('conversion events remain local without a dataset or Meta token', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const billing = createBilling();
    let metaCalls = 0;
    const router = createTenantConversionsRouter({
        database: db,
        accessTokenForTenant: () => null,
        billing,
        requestMeta: async () => {
            metaCalls += 1;
            return { ok: true, status: 200, data: {} };
        },
    });

    const local = await invokeRoute(router, 'post', '/conversions/log-event', {
        user: { tenant_id: 3 },
        body: { event_name: 'Purchase', phone: '+218 91 000 0000', custom_data: { value: 10 } },
    });
    assert.equal(local.statusCode, 200);
    assert.equal(local.body.status, 'local_only');
    const stored = db.prepare('SELECT * FROM conversion_events WHERE tenant_id = 3').get();
    assert.equal(stored.dataset_id, 'local');
    assert.equal(stored.status, 'local_only');
    assert.equal(metaCalls, 0);
    assert.equal(billing.calls.reserves.length, 0);

    const unsupported = await invokeRoute(router, 'post', '/conversions/log-event', {
        user: { tenant_id: 3 },
        body: { event_name: 'ArbitraryEvent' },
    });
    assert.equal(unsupported.statusCode, 400);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM conversion_events WHERE tenant_id = 3').get().count, 1);
});

test('remote conversion delivery uses stored attribution and settles billing on success or failure', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    db.prepare(`
        INSERT INTO contacts (
            id, tenant_id, phone, last_ctwa_clid, last_ctwa_received_at
        ) VALUES (1, 1, '218910000000', 'stored-clid', datetime('now'))
    `).run();
    const billing = createBilling();
    const requests = [];
    const results = [
        { ok: true, status: 200, data: { events_received: 1, fbtrace_id: 'trace-success' } },
        { ok: false, status: 503, error: { message: 'Meta unavailable', code: 2, retryable: true } },
    ];
    const router = createTenantConversionsRouter({
        database: db,
        accessTokenForTenant: () => 'token-a',
        billing,
        requestMeta: async (url, init) => {
            requests.push({ url, init });
            return results.shift();
        },
    });

    const sent = await invokeRoute(router, 'post', '/conversions/log-event', {
        user: { tenant_id: 1 },
        body: {
            event_name: 'Purchase',
            phone: '+218 91 000 0000',
            custom_data: { value: 20, currency: 'LYD' },
        },
    });
    assert.equal(sent.statusCode, 200);
    assert.equal(sent.body.fbtrace_id, 'trace-success');
    const payload = JSON.parse(requests[0].init.body).data[0];
    assert.equal(payload.user_data.ctwa_clid, 'stored-clid');
    assert.equal(payload.user_data.whatsapp_business_account_id, 'waba/A');
    assert.equal(billing.calls.reserves.length, 1);
    assert.equal(billing.calls.commits.length, 1);
    assert.equal(db.prepare("SELECT status FROM conversion_events WHERE tenant_id = 1 ORDER BY id DESC").get().status, 'sent');

    const failed = await invokeRoute(router, 'post', '/conversions/log-event', {
        user: { tenant_id: 1 },
        body: { event_name: 'LeadSubmitted', ctwa_clid: 'explicit-clid' },
    });
    assert.equal(failed.statusCode, 503);
    assert.equal(failed.body.error, 'Meta unavailable');
    assert.equal(failed.body.permission_required, 'whatsapp_business_manage_events');
    assert.equal(failed.body.dataset_id, 'dataset-a');
    assert.equal(billing.calls.releases.length, 1);
    assert.equal(db.prepare("SELECT status FROM conversion_events WHERE tenant_id = 1 ORDER BY id DESC").get().status, 'failed');

    const localValidation = await invokeRoute(router, 'post', '/conversions/log-event', {
        user: { tenant_id: 1 },
        body: { event_name: 'ViewContent', phone: '218999999999' },
    });
    assert.equal(localValidation.statusCode, 400);
    assert.equal(localValidation.body.details.code, 'missing_ctwa_clid');
    assert.equal(billing.calls.reserves.length, 2);
    assert.equal(requests.length, 2);
});
