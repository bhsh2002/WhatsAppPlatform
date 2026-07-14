import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createTenantBroadcastsRouter } from '../routes/tenantBroadcasts.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE tenants (
            id INTEGER PRIMARY KEY,
            name TEXT,
            phone_number_id TEXT,
            status TEXT
        );
        CREATE TABLE templates (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            name TEXT,
            language TEXT,
            category TEXT,
            header_type TEXT,
            header_content TEXT,
            body TEXT,
            footer TEXT,
            buttons TEXT,
            variables TEXT
        );
        CREATE TABLE contacts (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            phone TEXT,
            profile_name TEXT,
            label TEXT,
            notes TEXT
        );
        CREATE TABLE broadcast_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            status TEXT DEFAULT 'pending',
            template_name TEXT,
            template_language TEXT,
            total_recipients INTEGER DEFAULT 0,
            sent_count INTEGER DEFAULT 0,
            failed_count INTEGER DEFAULT 0,
            progress_pct REAL DEFAULT 0,
            results TEXT,
            error TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            direction TEXT,
            sender TEXT,
            recipient TEXT,
            message_type TEXT,
            content TEXT,
            status TEXT,
            wamid TEXT
        );
        CREATE TABLE activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            tenant_name TEXT,
            event_type TEXT,
            description TEXT,
            status TEXT
        );
        INSERT INTO tenants VALUES
            (1, 'Tenant A', 'phone-number-a', 'Active'),
            (2, 'Tenant B', 'phone-number-b', 'Active'),
            (3, 'Suspended', 'phone-number-c', 'Suspended');
        INSERT INTO templates VALUES
            (1, 1, 'welcome', 'ar', 'UTILITY', 'none', NULL, 'Welcome', NULL, NULL, NULL),
            (2, 2, 'welcome', 'ar', 'UTILITY', 'none', NULL, 'Tenant B', NULL, NULL, NULL),
            (3, 3, 'welcome', 'ar', 'UTILITY', 'none', NULL, 'Suspended', NULL, NULL, NULL);
    `);
    return db;
}

function createBilling(pricingModel = 'credits') {
    const calls = { reserves: [], commits: [], releases: [], defers: [], resolves: [] };
    return {
        calls,
        operations: { WHATSAPP_BROADCAST_RECIPIENT: 'whatsapp.broadcast_recipient' },
        resolveLocalQuantity(options) {
            calls.resolves.push(options);
            return { quantity: options.fallbackQuantity, summary: { source: 'test' }, pricing_model: pricingModel };
        },
        summarizeCountries: recipients => ({ LY: recipients.length }),
        reserve(options) {
            const reservation = { id: calls.reserves.length + 1, ...options };
            calls.reserves.push(reservation);
            return reservation;
        },
        commit(reservation, options) {
            calls.commits.push({ reservation, options });
        },
        release(reservation, reason) {
            calls.releases.push({ reservation, reason });
        },
        deferUntilStatuses(reservation, options) {
            calls.defers.push({ reservation, options });
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
    const next = error => {
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

test('tenant broadcasts validate recipients, credentials, suspension and template ownership before billing', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const billing = createBilling();
    const scheduled = [];
    const router = createTenantBroadcastsRouter({
        database: db,
        accessTokenForTenant: tenantId => tenantId === 1 ? 'token-a' : tenantId === 3 ? 'token-c' : null,
        billing,
        recordMessageCost: () => undefined,
        schedule: callback => scheduled.push(callback),
    });

    const invalid = await invokeRoute(router, 'post', '/broadcast', {
        user: { tenant_id: 1 },
        body: { recipients: ['not-a-phone'], template_name: 'welcome' },
    });
    assert.equal(invalid.statusCode, 400);
    const missingCredentials = await invokeRoute(router, 'post', '/broadcast', {
        user: { tenant_id: 2 },
        body: { recipients: ['218910000002'], template_name: 'welcome' },
    });
    assert.equal(missingCredentials.statusCode, 400);
    const suspended = await invokeRoute(router, 'post', '/broadcast', {
        user: { tenant_id: 3 },
        body: { recipients: ['218910000003'], template_name: 'welcome' },
    });
    assert.equal(suspended.statusCode, 403);
    const otherTemplate = await invokeRoute(router, 'post', '/broadcast', {
        user: { tenant_id: 1 },
        body: { recipients: ['218910000001'], template_name: 'tenant-b-only' },
    });
    assert.equal(otherTemplate.statusCode, 400);
    assert.equal(billing.calls.reserves.length, 0);
    assert.equal(scheduled.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM broadcast_jobs').get().count, 0);
});

test('broadcast processing charges only successful recipients and records isolated progress', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const billing = createBilling();
    const scheduled = [];
    const broadcasts = [];
    const costRecords = [];
    const requests = [];
    const responses = [
        { ok: true, status: 200, data: { messages: [{ id: 'wamid-1' }] } },
        { ok: false, status: 400, error: { message: 'Recipient rejected' } },
    ];
    const router = createTenantBroadcastsRouter({
        database: db,
        accessTokenForTenant: () => 'token-a',
        requestMeta: async (url, init) => {
            requests.push({ url, init });
            return responses.shift();
        },
        billing,
        recordMessageCost: value => costRecords.push(value),
        broadcast: (channel, event, data) => broadcasts.push({ channel, event, data }),
        schedule: callback => scheduled.push(callback),
        wait: async () => undefined,
    });

    const accepted = await invokeRoute(router, 'post', '/broadcast', {
        user: { tenant_id: 1 },
        body: {
            recipients: ['+218 910000001', '218910000002', '218910000002'],
            template_name: ' welcome ',
            template_language: 'ar',
        },
    });
    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.body.total, 2);
    assert.equal(scheduled.length, 1);
    assert.equal(billing.calls.reserves[0].quantity, 2);
    await scheduled[0]();

    const job = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ?').get(accepted.body.job_id);
    assert.equal(job.tenant_id, 1);
    assert.equal(job.status, 'completed');
    assert.equal(job.sent_count, 1);
    assert.equal(job.failed_count, 1);
    assert.equal(job.progress_pct, 100);
    assert.equal(JSON.parse(job.results)[1].error, 'Recipient rejected');
    assert.equal(billing.calls.commits.length, 1);
    assert.equal(billing.calls.commits[0].options.quantity, 1);
    assert.equal(billing.calls.releases.length, 0);
    assert.equal(costRecords.length, 1);
    assert.equal(costRecords[0].tenantId, 1);
    assert.equal(db.prepare('SELECT tenant_id FROM messages').get().tenant_id, 1);
    assert.equal(db.prepare('SELECT recipient FROM messages').get().recipient, '218910000001');
    assert.equal(requests[0].init.headers.Authorization, 'Bearer token-a');
    assert.match(requests[0].url, /\/phone-number-a\/messages$/);
    assert.ok(broadcasts.every(event => event.channel === 'tenant:1'));
    assert.equal(broadcasts.at(-1).event, 'broadcast:complete');
});

test('broadcast jobs are paginated and inaccessible across tenants while all-failed jobs release billing', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const billing = createBilling();
    const scheduled = [];
    const router = createTenantBroadcastsRouter({
        database: db,
        accessTokenForTenant: () => 'token-a',
        requestMeta: async () => ({ ok: false, status: 503, error: { message: 'Meta unavailable' } }),
        billing,
        recordMessageCost: () => undefined,
        schedule: callback => scheduled.push(callback),
        wait: async () => undefined,
    });
    const accepted = await invokeRoute(router, 'post', '/broadcast', {
        user: { tenant_id: 1 },
        body: { recipients: ['218910000001'], template_name: 'welcome' },
    });
    await scheduled[0]();
    assert.equal(billing.calls.commits.length, 0);
    assert.equal(billing.calls.releases.length, 1);
    assert.equal(db.prepare('SELECT status FROM broadcast_jobs WHERE id = ?').get(accepted.body.job_id).status, 'completed');

    db.prepare(`
        INSERT INTO broadcast_jobs (tenant_id, status, template_name, total_recipients)
        VALUES (2, 'completed', 'welcome', 99)
    `).run();
    const list = await invokeRoute(router, 'get', '/broadcast-jobs', {
        user: { tenant_id: 1 },
        query: { limit: '10' },
    });
    assert.equal(list.body.total, 1);
    assert.ok(list.body.jobs.every(job => job.tenant_id === 1));
    const otherTenant = await invokeRoute(router, 'get', '/broadcast-jobs/:id', {
        user: { tenant_id: 2 },
        params: { id: String(accepted.body.job_id) },
    });
    assert.equal(otherTenant.statusCode, 404);
    const malformed = await invokeRoute(router, 'get', '/broadcast-jobs/:id', {
        user: { tenant_id: 1 },
        params: { id: '1junk' },
    });
    assert.equal(malformed.statusCode, 400);
});
