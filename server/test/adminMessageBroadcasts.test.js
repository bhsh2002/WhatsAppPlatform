import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createMessageBroadcastsRouter } from '../routes/messageBroadcasts.js';

function createDatabase() {
    const database = new Database(':memory:');
    database.exec(`
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
            (1, 'Tenant A', 'phone/A', 'Active'),
            (2, 'Tenant B', NULL, 'Active'),
            (3, 'Suspended', 'phone-c', 'Suspended');
        INSERT INTO templates VALUES
            (1, 1, 'welcome', 'ar', 'UTILITY', 'none', NULL, 'Welcome', NULL, NULL, NULL),
            (2, 2, 'welcome', 'ar', 'MARKETING', 'none', NULL, 'Tenant B', NULL, NULL, NULL);
        INSERT INTO contacts VALUES
            (1, 1, '218910000001', 'Tenant contact', 'vip', 'tenant note'),
            (2, NULL, '218910000002', 'Global contact', 'lead', 'global note');
    `);
    return database;
}

function createBilling(pricingModel = 'credits') {
    const calls = { reserves: [], commits: [], releases: [], defers: [], resolves: [] };
    return {
        calls,
        operations: { WHATSAPP_BROADCAST_RECIPIENT: 'whatsapp.broadcast_recipient' },
        resolveLocalQuantity(options) {
            calls.resolves.push(options);
            return {
                quantity: options.fallbackQuantity,
                summary: { source: 'admin-test' },
                pricing_model: pricingModel,
            };
        },
        summarizeCountries: recipients => ({ LY: recipients.length }),
        reserve(options) {
            const reservation = { id: calls.reserves.length + 1, ...options };
            calls.reserves.push(reservation);
            return reservation;
        },
        commit(reservation, options) { calls.commits.push({ reservation, options }); },
        release(reservation, reason) { calls.releases.push({ reservation, reason }); },
        deferUntilStatuses(reservation, options) { calls.defers.push({ reservation, options }); },
        handleError: () => false,
    };
}

const credentialsFor = ({ tenantId, phoneNumberIdOverride, accessTokenOverride }) => {
    if (tenantId === 1) {
        return {
            tenant: { id: 1, name: 'Tenant A' },
            phoneNumberId: 'phone/A',
            accessToken: 'token-a',
            isSuspended: false,
        };
    }
    if (tenantId === 2) {
        return {
            tenant: { id: 2, name: 'Tenant B' },
            phoneNumberId: null,
            accessToken: null,
            isSuspended: false,
        };
    }
    if (tenantId === 3) {
        return {
            tenant: { id: 3, name: 'Suspended' },
            phoneNumberId: 'phone-c',
            accessToken: 'token-c',
            isSuspended: true,
        };
    }
    if (tenantId) return { tenant: null, phoneNumberId: null, accessToken: null };
    return {
        tenant: null,
        phoneNumberId: phoneNumberIdOverride || null,
        accessToken: accessTokenOverride || null,
        isSuspended: false,
    };
};

const findRouteHandlers = (router, method, routePath) => {
    const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.map(item => item.handle);
};

const invokeRoute = (router, method, routePath, request = {}) => new Promise((resolve, reject) => {
    const req = { body: {}, headers: {}, params: {}, query: {}, ...request };
    const res = {
        statusCode: 200,
        body: undefined,
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; resolve(this); return this; },
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

test('admin broadcasts reject malformed input and invalid tenant states before billing', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const billing = createBilling();
    const scheduled = [];
    const router = createMessageBroadcastsRouter({
        database,
        credentialResolver: credentialsFor,
        billing,
        recordMessageCost: () => undefined,
        schedule: callback => scheduled.push(callback),
    });

    const cases = [
        { body: { recipients: ['invalid'], template_name: 'welcome' }, status: 400 },
        { body: { recipients: ['218910000001'], template_name: 'welcome', tenant_id: '1junk' }, status: 400 },
        { body: { recipients: ['218910000001'], template_name: 'welcome', tenant_id: 999 }, status: 404 },
        { body: { recipients: ['218910000001'], template_name: 'welcome', tenant_id: 3 }, status: 403 },
        { body: { recipients: ['218910000001'], template_name: 'welcome', tenant_id: 2 }, status: 400 },
    ];
    for (const entry of cases) {
        const response = await invokeRoute(router, 'post', '/broadcast', { body: entry.body });
        assert.equal(response.statusCode, entry.status);
    }
    assert.equal(billing.calls.reserves.length, 0);
    assert.equal(scheduled.length, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM broadcast_jobs').get().count, 0);
});

test('admin broadcast processing normalizes recipients and charges only successful sends', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const billing = createBilling();
    const credentialCalls = [];
    const scheduled = [];
    const requests = [];
    const costs = [];
    const events = [];
    const metaResponses = [
        { ok: true, status: 200, data: { messages: [{ id: 'wamid-admin-1' }] } },
        { ok: false, status: 400, error: { message: 'Recipient rejected' } },
    ];
    const router = createMessageBroadcastsRouter({
        database,
        credentialResolver: options => {
            credentialCalls.push(options);
            return credentialsFor(options);
        },
        requestMeta: async (url, init) => {
            requests.push({ url, init });
            return metaResponses.shift();
        },
        billing,
        recordMessageCost: value => costs.push(value),
        broadcast: (channel, event, data) => events.push({ channel, event, data }),
        schedule: callback => scheduled.push(callback),
        wait: async () => undefined,
    });

    const accepted = await invokeRoute(router, 'post', '/broadcast', {
        body: {
            tenant_id: '1',
            recipients: ['+218 910000001', '218910000002', '218910000002'],
            template_name: ' welcome ',
            template_language: 'ar',
        },
    });
    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.body.total, 2);
    assert.equal(scheduled.length, 1);
    assert.deepEqual(credentialCalls, [{
        tenantId: 1,
        phoneNumberIdOverride: undefined,
        accessTokenOverride: undefined,
    }]);
    assert.equal(billing.calls.reserves[0].quantity, 2);
    await scheduled[0]();

    const job = database.prepare('SELECT * FROM broadcast_jobs WHERE id = ?').get(accepted.body.job_id);
    assert.equal(job.tenant_id, 1);
    assert.equal(job.status, 'completed');
    assert.equal(job.sent_count, 1);
    assert.equal(job.failed_count, 1);
    assert.equal(job.progress_pct, 100);
    assert.equal(JSON.parse(job.results)[1].error, 'Recipient rejected');
    assert.equal(billing.calls.commits.length, 1);
    assert.equal(billing.calls.commits[0].options.quantity, 1);
    assert.equal(billing.calls.releases.length, 0);
    assert.equal(costs.length, 1);
    assert.equal(costs[0].tenantId, 1);
    assert.match(requests[0].url, /\/phone%2FA\/messages$/);
    assert.equal(requests[0].init.headers.Authorization, 'Bearer token-a');
    assert.equal(database.prepare('SELECT recipient FROM messages').get().recipient, '218910000001');
    assert.equal(database.prepare('SELECT status FROM activity_logs').get().status, 'partial');
    assert.ok(events.every(entry => entry.channel === 'admin'));
    assert.equal(events.at(-1).event, 'broadcast:complete');
});

test('admin job reads are global and all-failed broadcasts release their reservation', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const billing = createBilling();
    const scheduled = [];
    const router = createMessageBroadcastsRouter({
        database,
        credentialResolver: credentialsFor,
        requestMeta: async () => ({
            ok: false,
            status: 503,
            error: { message: 'Meta unavailable' },
        }),
        billing,
        recordMessageCost: () => undefined,
        schedule: callback => scheduled.push(callback),
        wait: async () => undefined,
    });
    const accepted = await invokeRoute(router, 'post', '/broadcast', {
        body: { tenant_id: 1, recipients: ['218910000001'], template_name: 'welcome' },
    });
    await scheduled[0]();
    assert.equal(billing.calls.commits.length, 0);
    assert.equal(billing.calls.releases.length, 1);
    assert.equal(database.prepare('SELECT status FROM broadcast_jobs WHERE id = ?')
        .get(accepted.body.job_id).status, 'completed');

    database.prepare(`
        INSERT INTO broadcast_jobs (tenant_id, status, template_name, total_recipients)
        VALUES (2, 'completed', 'other', 3)
    `).run();
    const list = await invokeRoute(router, 'get', '/broadcast-jobs', {
        query: { limit: '1', offset: '1' },
    });
    assert.equal(list.statusCode, 200);
    assert.equal(list.body.total, 2);
    assert.equal(list.body.jobs.length, 1);
    const job = await invokeRoute(router, 'get', '/broadcast-jobs/:id', {
        params: { id: String(accepted.body.job_id) },
    });
    assert.equal(job.statusCode, 200);
    assert.equal(job.body.tenant_id, 1);
    const malformed = await invokeRoute(router, 'get', '/broadcast-jobs/:id', {
        params: { id: '1junk' },
    });
    assert.equal(malformed.statusCode, 400);
    const missing = await invokeRoute(router, 'get', '/broadcast-jobs/:id', {
        params: { id: '999' },
    });
    assert.equal(missing.statusCode, 404);
});

test('admin broadcasts preserve tenantless sends with explicit credentials', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const billing = createBilling();
    const scheduled = [];
    const requests = [];
    const router = createMessageBroadcastsRouter({
        database,
        credentialResolver: credentialsFor,
        requestMeta: async (url) => {
            requests.push(url);
            return { ok: true, status: 200, data: { messages: [{ id: 'wamid-global' }] } };
        },
        billing,
        recordMessageCost: () => undefined,
        schedule: callback => scheduled.push(callback),
        wait: async () => undefined,
    });
    const accepted = await invokeRoute(router, 'post', '/broadcast', {
        body: {
            recipients: ['218910000099'],
            template_name: 'remote_template',
            phone_number_id: 'global/phone',
            access_token: 'global-token',
        },
    });
    assert.equal(accepted.statusCode, 202);
    await scheduled[0]();
    const job = database.prepare('SELECT * FROM broadcast_jobs WHERE id = ?').get(accepted.body.job_id);
    assert.equal(job.tenant_id, null);
    assert.equal(job.status, 'completed');
    assert.equal(database.prepare('SELECT tenant_id FROM messages').get().tenant_id, null);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM activity_logs').get().count, 0);
    assert.match(requests[0], /\/global%2Fphone\/messages$/);
    assert.equal(billing.calls.commits.length, 1);
});
