import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createMessageQueriesRouter } from '../routes/messageQueries.js';

const NOW = Date.parse('2026-07-14T13:00:00.000Z');

function createDatabase() {
    const database = new Database(':memory:');
    database.exec(`
        CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT);
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
            variables TEXT,
            updated_at DATETIME
        );
        CREATE TABLE contacts (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            phone TEXT,
            profile_name TEXT,
            profile_picture_url TEXT,
            last_customer_message_at DATETIME,
            last_ctwa_clid TEXT,
            last_ctwa_source_id TEXT,
            last_ctwa_source_type TEXT,
            last_ctwa_source_url TEXT,
            last_ctwa_received_at DATETIME,
            UNIQUE (tenant_id, phone)
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            direction TEXT,
            recipient TEXT,
            sender TEXT,
            message_type TEXT,
            content TEXT,
            status TEXT,
            wamid TEXT,
            error_message TEXT,
            media_id TEXT,
            media_url TEXT,
            media_mime_type TEXT,
            referral_ctwa_clid TEXT,
            referral_source_id TEXT,
            referral_source_type TEXT,
            referral_source_url TEXT,
            created_at DATETIME
        );
        CREATE TABLE webhook_logs (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            event_type TEXT,
            payload TEXT,
            processed INTEGER,
            created_at DATETIME
        );

        INSERT INTO tenants VALUES (1, 'Tenant A'), (2, 'Tenant B');
        INSERT INTO templates VALUES (
            1, 1, 'injected_welcome_rare', 'ar', 'UTILITY', 'none', NULL,
            'Rich content from injected database', 'Footer', '[]', NULL,
            '2026-07-14T10:00:00.000Z'
        );
        INSERT INTO contacts VALUES
            (1, 1, '218910000001', 'Contact A', NULL, '2026-07-14T12:00:00.000Z', NULL, NULL, NULL, NULL, NULL),
            (2, 2, '218910000001', 'Contact B', NULL, '2026-07-12T12:00:00.000Z', NULL, NULL, NULL, NULL, NULL),
            (3, NULL, '218910000099', 'Global Contact', NULL, '2026-07-14T11:00:00.000Z', NULL, NULL, NULL, NULL, NULL);
        INSERT INTO messages VALUES
            (1, 1, 'incoming', 'phone-a', '218910000001', 'text', 'Tenant A incoming', 'received', 'wa-1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-14T10:00:00.000Z'),
            (2, 1, 'outgoing', '218910000001', 'phone-a', 'template', '[Template: injected_welcome_rare]', 'sent', 'wa-2', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-14T11:00:00.000Z'),
            (3, 2, 'incoming', 'phone-b', '218910000001', 'text', 'Tenant B incoming', 'received', 'wa-3', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-14T12:00:00.000Z'),
            (4, NULL, 'incoming', 'global-phone', '218910000099', 'text', 'Global incoming', 'received', 'wa-4', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-14T09:00:00.000Z');
        INSERT INTO webhook_logs VALUES
            (1, 1, 'messages', '{"id":1}', 1, '2026-07-14T10:00:00.000Z'),
            (2, 2, 'statuses', '{"id":2}', 0, '2026-07-14T11:00:00.000Z');
    `);
    return database;
}

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

test('admin message logs validate filters, paginate and enrich templates from the injected database', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const router = createMessageQueriesRouter({ database, now: () => NOW });

    const logs = await invokeRoute(router, 'get', '/logs', {
        query: { tenant_id: '1', limit: '1', offset: '1' },
    });
    assert.equal(logs.statusCode, 200);
    assert.equal(logs.body.total, 2);
    assert.equal(logs.body.limit, 1);
    assert.equal(logs.body.offset, 1);
    assert.equal(logs.body.messages[0].id, 1);
    assert.equal(logs.body.messages[0].tenant_name, 'Tenant A');

    const templateLog = await invokeRoute(router, 'get', '/logs', {
        query: { tenant_id: '1', limit: '1' },
    });
    assert.match(templateLog.body.messages[0].content, /Rich content from injected database/);
    assert.doesNotMatch(templateLog.body.messages[0].content, /^\[Template:/);

    const incoming = await invokeRoute(router, 'get', '/logs', {
        query: { tenant_id: '1', direction: 'incoming' },
    });
    assert.deepEqual(incoming.body.messages.map(message => message.id), [1]);
    const malformedTenant = await invokeRoute(router, 'get', '/logs', {
        query: { tenant_id: '1junk' },
    });
    assert.equal(malformedTenant.statusCode, 400);
    const malformedDirection = await invokeRoute(router, 'get', '/logs', {
        query: { direction: 'sideways' },
    });
    assert.equal(malformedDirection.statusCode, 400);
});

test('admin webhook logs are bounded and ordered without implicit columns', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const router = createMessageQueriesRouter({ database });
    const result = await invokeRoute(router, 'get', '/webhook-logs', {
        query: { limit: '1' },
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.map(log => log.id), [2]);
    assert.deepEqual(Object.keys(result.body[0]).sort(), [
        'created_at', 'event_type', 'id', 'payload', 'processed', 'tenant_id',
    ]);
});

test('admin conversations preserve tenant partitions and isolate read side effects', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const router = createMessageQueriesRouter({ database });

    const all = await invokeRoute(router, 'get', '/conversations');
    assert.equal(all.statusCode, 200);
    assert.equal(all.body.length, 3);
    assert.equal(all.body.filter(row => row.contact === '218910000001').length, 2);
    const tenantAConversation = all.body.find(row => row.tenant_id === 1);
    assert.equal(tenantAConversation.profile_name, 'Contact A');
    assert.equal(tenantAConversation.unread_count, 1);
    assert.match(tenantAConversation.last_message, /Rich content from injected database/);

    const tenantOnly = await invokeRoute(router, 'get', '/conversations', {
        query: { tenant_id: '2' },
    });
    assert.deepEqual(tenantOnly.body.map(row => row.tenant_id), [2]);

    const thread = await invokeRoute(router, 'get', '/conversations/:number/messages', {
        params: { number: '+218 910000001' },
        query: { tenant_id: '1' },
    });
    assert.equal(thread.statusCode, 200);
    assert.deepEqual(thread.body.map(message => message.id), [1, 2]);
    assert.match(thread.body[1].content, /Rich content from injected database/);
    assert.equal(database.prepare('SELECT status FROM messages WHERE id = 1').get().status, 'read');
    assert.equal(database.prepare('SELECT status FROM messages WHERE id = 3').get().status, 'received');
    assert.equal(database.prepare('SELECT status FROM messages WHERE id = 4').get().status, 'received');

    const globalThread = await invokeRoute(router, 'get', '/conversations/:number/messages', {
        params: { number: '218910000099' },
        query: { tenant_id: 'null' },
    });
    assert.deepEqual(globalThread.body.map(message => message.id), [4]);
    assert.equal(database.prepare('SELECT status FROM messages WHERE id = 4').get().status, 'read');

    const malformedPhone = await invokeRoute(router, 'get', '/conversations/:number/messages', {
        params: { number: 'not-a-phone' },
    });
    assert.equal(malformedPhone.statusCode, 400);
    const malformedTenant = await invokeRoute(router, 'get', '/conversations/:number/messages', {
        params: { number: '218910000001' },
        query: { tenant_id: '2junk' },
    });
    assert.equal(malformedTenant.statusCode, 400);
});

test('admin window status is deterministic, tenant-scoped and false for missing contacts', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const router = createMessageQueriesRouter({ database, now: () => NOW });
    const defaultClockRouter = createMessageQueriesRouter({ database });

    const tenantWindow = await invokeRoute(router, 'get', '/window-status/:phone', {
        params: { phone: '+218 910000001' },
        query: { tenant_id: '1' },
    });
    assert.equal(tenantWindow.statusCode, 200);
    assert.equal(tenantWindow.body.is_open, true);
    assert.equal(tenantWindow.body.last_customer_message_at, '2026-07-14T12:00:00.000Z');
    assert.equal(tenantWindow.body.window_closes_at, '2026-07-15T12:00:00.000Z');

    const oldWindow = await invokeRoute(router, 'get', '/window-status/:phone', {
        params: { phone: '218910000001' },
        query: { tenant_id: '2' },
    });
    assert.equal(oldWindow.body.is_open, false);
    const missingGlobal = await invokeRoute(router, 'get', '/window-status/:phone', {
        params: { phone: '218910000001' },
    });
    assert.deepEqual(missingGlobal.body, {
        is_open: false,
        last_customer_message_at: null,
        window_closes_at: null,
    });
    const defaultClock = await invokeRoute(defaultClockRouter, 'get', '/window-status/:phone', {
        params: { phone: '218910000099' },
    });
    assert.equal(typeof defaultClock.body.is_open, 'boolean');
    const invalid = await invokeRoute(router, 'get', '/window-status/:phone', {
        params: { phone: 'invalid' },
        query: { tenant_id: '1' },
    });
    assert.equal(invalid.statusCode, 400);
});
