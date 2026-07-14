import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createTenantFacebookMessagingRouter } from '../routes/tenantFacebookMessaging.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE tenant_pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            platform TEXT NOT NULL DEFAULT 'facebook',
            page_id TEXT NOT NULL,
            page_name TEXT,
            page_access_token_encrypted TEXT,
            page_category TEXT,
            page_picture_url TEXT,
            is_active INTEGER DEFAULT 1,
            subscribed_fields TEXT,
            webhook_subscribed INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE fb_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            linked_page_id INTEGER NOT NULL,
            page_id TEXT NOT NULL,
            user_psid TEXT NOT NULL,
            last_message TEXT,
            last_message_time DATETIME,
            is_active INTEGER DEFAULT 1,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE fb_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            tenant_id INTEGER NOT NULL,
            mid TEXT UNIQUE,
            direction TEXT NOT NULL DEFAULT 'incoming',
            sender_id TEXT,
            sender_name TEXT,
            message_text TEXT,
            attachment_type TEXT,
            attachment_url TEXT,
            sticker_url TEXT,
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO tenant_pages (
            id, tenant_id, page_id, page_name, page_access_token_encrypted,
            page_category, is_active, subscribed_fields, webhook_subscribed, created_at
        ) VALUES
            (1, 1, 'page/A', 'Page A', 'encrypted-a', 'Business', 1, '["messages"]', 1, '2026-07-02'),
            (2, 2, 'page-B', 'Page B', 'encrypted-b', 'Community', 1, '["messages"]', 0, '2026-07-03'),
            (3, 1, 'page-inactive', 'Inactive', 'encrypted-inactive', NULL, 0, '[]', 0, '2026-07-01');
        INSERT INTO fb_conversations (
            id, tenant_id, linked_page_id, page_id, user_psid, last_message
        ) VALUES
            (11, 1, 1, 'page/A', 'psid-a', 'Previous A'),
            (22, 2, 2, 'page-B', 'psid-b', 'Previous B');
    `);
    return db;
}

function createBilling() {
    const calls = { reserves: [], commits: [], releases: [] };
    return {
        calls,
        operations: { MESSENGER_UTILITY: 'messenger.utility' },
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

function createDependencies(overrides = {}) {
    const billing = overrides.billing || createBilling();
    return {
        billing,
        decryptToken: value => ({
            'encrypted-a': 'token-a',
            'encrypted-b': 'token-b',
            'encrypted-inactive': 'token-inactive',
        })[value] || null,
        requestMeta: async () => ({ ok: true, status: 200, data: {} }),
        ...overrides,
        billing,
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

test('tenant Facebook page listings are paginated, isolated and never expose access tokens', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const router = createTenantFacebookMessagingRouter({ database: db, ...createDependencies() });

    const tenantOne = await invokeRoute(router, 'get', '/pages', {
        user: { tenant_id: 1 },
        query: { limit: '1', offset: '0' },
    });
    assert.equal(tenantOne.statusCode, 200);
    assert.equal(tenantOne.body.length, 1);
    assert.equal(tenantOne.body[0].tenant_id, 1);
    assert.equal(tenantOne.body[0].id, 1);
    assert.ok(!Object.hasOwn(tenantOne.body[0], 'page_access_token_encrypted'));

    const tenantTwo = await invokeRoute(router, 'get', '/pages', {
        user: { tenant_id: 2 },
    });
    assert.deepEqual(tenantTwo.body.map(page => page.id), [2]);
    assert.doesNotMatch(JSON.stringify(tenantTwo.body), /encrypted-|token-/);
});

test('page subscription status enforces ownership and sends the token only in authorization', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const calls = [];
    const router = createTenantFacebookMessagingRouter({
        database: db,
        ...createDependencies({
            requestMeta: async (url, init) => {
                calls.push({ url, init });
                return { ok: true, status: 200, data: { data: [{ id: 'app-1' }] } };
            },
        }),
    });

    const result = await invokeRoute(router, 'get', '/pages/:id/subscription-status', {
        user: { tenant_id: 1 },
        params: { id: '1' },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.page_id, 'page/A');
    assert.match(calls[0].url, /\/page%2FA\/subscribed_apps$/);
    assert.doesNotMatch(calls[0].url, /token-a|access_token/);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer token-a');

    const otherTenant = await invokeRoute(router, 'get', '/pages/:id/subscription-status', {
        user: { tenant_id: 1 },
        params: { id: '2' },
    });
    assert.equal(otherTenant.statusCode, 404);
    const malformed = await invokeRoute(router, 'get', '/pages/:id/subscription-status', {
        user: { tenant_id: 1 },
        params: { id: '1junk' },
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(calls.length, 1);
});

test('tenant Messenger exposes only the reviewed human-agent message tag', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const router = createTenantFacebookMessagingRouter({ database: db, ...createDependencies() });

    const result = await invokeRoute(router, 'get', '/fb-messenger/message-tags', {
        user: { tenant_id: 1 },
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.tags.map(tag => tag.value), ['HUMAN_AGENT']);
});

test('utility messages validate tenant ownership and settle billing on Meta success or failure', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const billing = createBilling();
    const requests = [];
    const handoffs = [];
    const broadcasts = [];
    const results = [
        { ok: true, status: 200, data: { message_id: 'mid-success' } },
        { ok: false, status: 503, error: { message: 'Meta unavailable', code: 2, retryable: true } },
    ];
    const router = createTenantFacebookMessagingRouter({
        database: db,
        ...createDependencies({
            billing,
            requestMeta: async (url, init) => {
                requests.push({ url, init });
                return results.shift();
            },
            markHandoff: value => handoffs.push(value),
            broadcast: (channel, event, data) => broadcasts.push({ channel, event, data }),
        }),
    });

    const invalid = await invokeRoute(router, 'post', '/fb-messenger/:linkedPageId/conversations/:convId/utility-message', {
        user: { tenant_id: 1 },
        params: { linkedPageId: '1', convId: '11' },
        body: { message: 'Hello', tag: 'ACCOUNT_UPDATE' },
    });
    assert.equal(invalid.statusCode, 400);
    const crossTenantPage = await invokeRoute(router, 'post', '/fb-messenger/:linkedPageId/conversations/:convId/utility-message', {
        user: { tenant_id: 1 },
        params: { linkedPageId: '2', convId: '22' },
        body: { message: 'Hello', tag: 'HUMAN_AGENT' },
    });
    assert.equal(crossTenantPage.statusCode, 404);
    const crossTenantConversation = await invokeRoute(router, 'post', '/fb-messenger/:linkedPageId/conversations/:convId/utility-message', {
        user: { tenant_id: 1 },
        params: { linkedPageId: '1', convId: '22' },
        body: { message: 'Hello', tag: 'HUMAN_AGENT' },
    });
    assert.equal(crossTenantConversation.statusCode, 404);
    assert.equal(requests.length, 0);
    assert.equal(billing.calls.reserves.length, 0);

    const success = await invokeRoute(router, 'post', '/fb-messenger/:linkedPageId/conversations/:convId/utility-message', {
        user: { tenant_id: 1 },
        params: { linkedPageId: '1', convId: '11' },
        body: { message: '  Utility hello  ', tag: 'HUMAN_AGENT' },
    });
    assert.equal(success.statusCode, 201);
    assert.deepEqual(success.body, { id: 'mid-success', conversation_id: 11, tag: 'HUMAN_AGENT' });
    assert.match(requests[0].url, /\/page%2FA\/messages$/);
    assert.equal(requests[0].init.headers.Authorization, 'Bearer token-a');
    assert.deepEqual(JSON.parse(requests[0].init.body), {
        recipient: { id: 'psid-a' },
        messaging_type: 'MESSAGE_TAG',
        tag: 'HUMAN_AGENT',
        message: { text: 'Utility hello' },
    });
    assert.equal(billing.calls.reserves[0].tenantId, 1);
    assert.equal(billing.calls.reserves[0].operationKey, 'messenger.utility');
    assert.equal(billing.calls.commits.length, 1);
    assert.equal(billing.calls.commits[0].options.referenceId, 'mid-success');
    const stored = db.prepare('SELECT * FROM fb_messages WHERE mid = ?').get('mid-success');
    assert.equal(stored.tenant_id, 1);
    assert.equal(stored.conversation_id, 11);
    assert.equal(stored.message_text, '[HUMAN_AGENT] Utility hello');
    assert.equal(db.prepare('SELECT last_message FROM fb_conversations WHERE id = 11').get().last_message, 'Utility hello');
    assert.equal(db.prepare('SELECT last_message FROM fb_conversations WHERE id = 22').get().last_message, 'Previous B');
    assert.equal(handoffs[0].tenantId, 1);
    assert.equal(broadcasts[0].channel, 'tenant:1');
    assert.equal(broadcasts[0].data.tenant_id, 1);

    const failure = await invokeRoute(router, 'post', '/fb-messenger/:linkedPageId/conversations/:convId/utility-message', {
        user: { tenant_id: 1 },
        params: { linkedPageId: '1', convId: '11' },
        body: { message: 'Second message', tag: 'HUMAN_AGENT' },
    });
    assert.equal(failure.statusCode, 503);
    assert.equal(failure.body.error, 'Meta unavailable');
    assert.equal(failure.body.details.code, 2);
    assert.equal(billing.calls.reserves.length, 2);
    assert.equal(billing.calls.commits.length, 1);
    assert.equal(billing.calls.releases.length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM fb_messages').get().count, 1);
    assert.equal(handoffs.length, 1);
    assert.equal(broadcasts.length, 1);
});
