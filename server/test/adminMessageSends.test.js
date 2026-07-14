import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createMessageSendsRouter } from '../routes/messageSends.js';

const NOW = Date.parse('2026-07-14T13:00:00.000Z');

function createDatabase() {
    const database = new Database(':memory:');
    database.exec(`
        CREATE TABLE contacts (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            phone TEXT,
            last_customer_message_at DATETIME,
            UNIQUE (tenant_id, phone)
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
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            direction TEXT,
            sender TEXT,
            recipient TEXT,
            message_type TEXT,
            content TEXT,
            status TEXT,
            wamid TEXT,
            error_message TEXT
        );
        CREATE TABLE activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            tenant_name TEXT,
            event_type TEXT,
            description TEXT,
            status TEXT
        );
        INSERT INTO contacts VALUES
            (1, 1, '218910000001', '2026-07-14T12:00:00.000Z'),
            (2, 1, '218910000009', '2026-07-12T12:00:00.000Z');
        INSERT INTO templates VALUES
            (1, 1, 'repeat_template', 'ar', 'UTILITY', 'none', NULL,
             'Hello {{1}}, again {{1}}', 'Footer', '[]', NULL),
            (2, 1, 'two_variables', 'ar', 'MARKETING', 'none', NULL,
             'Hello {{1}} and {{2}}', NULL, '[]', NULL);
    `);
    return database;
}

function createBilling() {
    const calls = { reserves: [], commits: [], releases: [] };
    return {
        calls,
        operations: {
            WHATSAPP_TEXT: 'whatsapp.text',
            WHATSAPP_TEMPLATE: 'whatsapp.template',
            WHATSAPP_INTERACTIVE: 'whatsapp.interactive',
        },
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
            phoneNumberId: null,
            accessToken: null,
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

test('admin sends reject invalid payloads, tenant states and closed text windows before billing', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const billing = createBilling();
    const requests = [];
    const router = createMessageSendsRouter({
        database,
        credentialResolver: credentialsFor,
        requestMeta: async (...args) => { requests.push(args); return { ok: true, status: 200, data: {} }; },
        billing,
        now: () => NOW,
    });
    const cases = [
        { body: { tenant_id: 1, recipient: 'not-a-phone', type: 'text', message: 'Hi' }, status: 400 },
        { body: { tenant_id: 1, recipient: '218910000001', type: 'image', message: 'Hi' }, status: 400 },
        { body: { tenant_id: 1, recipient: '218910000001', type: 'text', message: ' ' }, status: 400 },
        { body: { tenant_id: '1junk', recipient: '218910000001', type: 'text', message: 'Hi' }, status: 400 },
        { body: { tenant_id: 999, recipient: '218910000001', type: 'text', message: 'Hi' }, status: 404 },
        { body: { tenant_id: 3, recipient: '218910000001', type: 'text', message: 'Hi' }, status: 403 },
        { body: { tenant_id: 2, recipient: '218910000001', type: 'text', message: 'Hi' }, status: 400 },
        { body: { tenant_id: 1, recipient: '218910000009', type: 'text', message: 'Hi' }, status: 400, code: 'OUTSIDE_WINDOW' },
    ];
    for (const entry of cases) {
        const result = await invokeRoute(router, 'post', '/send', { body: entry.body });
        assert.equal(result.statusCode, entry.status);
        if (entry.code) assert.equal(result.body.code, entry.code);
    }
    assert.equal(billing.calls.reserves.length, 0);
    assert.equal(requests.length, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 0);
});

test('admin text sends normalize Meta requests and settle success and failure once', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const billing = createBilling();
    const requests = [];
    const responses = [
        { ok: true, status: 200, data: { messages: [{ id: 'wa-text-ok' }] } },
        { ok: false, status: 503, data: null, error: { message: 'Meta unavailable', code: 2 } },
    ];
    const router = createMessageSendsRouter({
        database,
        credentialResolver: credentialsFor,
        requestMeta: async (url, init) => {
            requests.push({ url, init });
            return responses.shift();
        },
        billing,
        now: () => NOW,
        apiBase: 'https://graph.test/v25.0',
    });

    const success = await invokeRoute(router, 'post', '/send', {
        body: {
            tenant_id: '1', recipient: '+218 91 000 0001', type: 'text', message: '  Hello  ',
        },
    });
    assert.equal(success.statusCode, 200);
    assert.equal(success.body.message_id, 'wa-text-ok');
    assert.match(requests[0].url, /\/phone%2FA\/messages$/);
    assert.equal(requests[0].init.headers.Authorization, 'Bearer token-a');
    assert.deepEqual(JSON.parse(requests[0].init.body), {
        messaging_product: 'whatsapp',
        to: '218910000001',
        type: 'text',
        text: { body: 'Hello' },
    });
    assert.equal(billing.calls.commits.length, 1);
    assert.equal(billing.calls.releases.length, 0);
    assert.equal(database.prepare("SELECT status FROM messages WHERE wamid = 'wa-text-ok'").get().status, 'sent');
    assert.equal(database.prepare('SELECT status FROM activity_logs ORDER BY id LIMIT 1').get().status, 'success');

    const failure = await invokeRoute(router, 'post', '/send', {
        body: { tenant_id: 1, recipient: '218910000001', type: 'text', message: 'Again' },
    });
    assert.equal(failure.statusCode, 503);
    assert.equal(failure.body.error, 'Meta unavailable');
    assert.equal(billing.calls.commits.length, 1);
    assert.equal(billing.calls.releases.length, 1);
    assert.equal(database.prepare("SELECT status FROM messages WHERE content = 'Again'").get().status, 'failed');
    assert.equal(database.prepare("SELECT error_message FROM messages WHERE content = 'Again'").get().error_message, 'Meta unavailable');
});

test('admin template sends handle repeated placeholders and reject true parameter mismatches', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const billing = createBilling();
    const requests = [];
    const router = createMessageSendsRouter({
        database,
        credentialResolver: credentialsFor,
        requestMeta: async (url, init) => {
            requests.push({ url, init });
            return { ok: true, status: 200, data: { messages: [{ id: `wa-template-${requests.length}` }] } };
        },
        billing,
        now: () => NOW,
    });
    const repeated = await invokeRoute(router, 'post', '/send', {
        body: {
            tenant_id: 1,
            recipient: '218910000009',
            type: 'template',
            templateName: 'repeat_template',
            templateLanguage: 'ar',
            templateParams: [{
                type: 'body',
                parameters: [{ type: 'text', text: 'Savana' }],
            }],
        },
    });
    assert.equal(repeated.statusCode, 200, 'templates must bypass the closed customer-service window');
    assert.equal(JSON.parse(requests[0].init.body).template.name, 'repeat_template');
    assert.equal(billing.calls.reserves[0].metadata.template_category, 'UTILITY');
    assert.equal(billing.calls.commits.length, 1);
    assert.match(database.prepare("SELECT content FROM messages WHERE wamid = 'wa-template-1'").get().content, /Hello Savana, again Savana/);

    const mismatch = await invokeRoute(router, 'post', '/send', {
        body: {
            tenant_id: 1,
            recipient: '218910000001',
            type: 'template',
            templateName: 'two_variables',
            templateParams: [{ type: 'body', parameters: [{ type: 'text', text: 'Only one' }] }],
        },
    });
    assert.equal(mismatch.statusCode, 400);
    assert.equal(mismatch.body.code, 'TEMPLATE_PARAM_MISMATCH');
    assert.equal(mismatch.body.expected, 2);
    assert.equal(mismatch.body.provided, 1);
    assert.equal(requests.length, 1);
    assert.equal(billing.calls.reserves.length, 1);
});

test('admin interactive sends validate structures, enforce the window and settle Meta outcomes', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const billing = createBilling();
    const requests = [];
    const responses = [
        { ok: true, status: 200, data: { messages: [{ id: 'wa-button' }] } },
        { ok: false, status: 400, error: { message: 'List rejected', code: 131009 } },
    ];
    const router = createMessageSendsRouter({
        database,
        credentialResolver: credentialsFor,
        requestMeta: async (url, init) => {
            requests.push({ url, init });
            return responses.shift();
        },
        billing,
        now: () => NOW,
    });
    const invalid = await invokeRoute(router, 'post', '/send-interactive', {
        body: {
            tenant_id: 1, recipient: '218910000001', interactive_type: 'button',
            body_text: 'Choose', buttons: [],
        },
    });
    assert.equal(invalid.statusCode, 400);
    const closed = await invokeRoute(router, 'post', '/send-interactive', {
        body: {
            tenant_id: 1, recipient: '218910000009', interactive_type: 'button',
            body_text: 'Choose', buttons: [{ id: 'yes', title: 'Yes' }],
        },
    });
    assert.equal(closed.statusCode, 400);
    assert.equal(closed.body.code, 'OUTSIDE_WINDOW');
    assert.equal(billing.calls.reserves.length, 0);
    assert.equal(requests.length, 0);

    const button = await invokeRoute(router, 'post', '/send-interactive', {
        body: {
            tenant_id: 1, recipient: '218910000001', interactive_type: 'button',
            body_text: ' Choose ', header_text: ' Header ',
            buttons: [{ id: 'yes', title: ' Yes ' }],
        },
    });
    assert.equal(button.statusCode, 200);
    const buttonPayload = JSON.parse(requests[0].init.body);
    assert.equal(buttonPayload.interactive.body.text, 'Choose');
    assert.equal(buttonPayload.interactive.action.buttons[0].reply.title, 'Yes');
    assert.equal(billing.calls.commits.length, 1);

    const list = await invokeRoute(router, 'post', '/send-interactive', {
        body: {
            tenant_id: 1,
            recipient: '218910000001',
            interactive_type: 'list',
            body_text: 'Pick one',
            list_button_text: 'Options',
            sections: [{
                title: 'Main',
                rows: [{ id: 'row-1', title: 'First', description: 'Description' }],
            }],
        },
    });
    assert.equal(list.statusCode, 400);
    assert.equal(list.body.error, 'List rejected');
    assert.equal(billing.calls.commits.length, 1);
    assert.equal(billing.calls.releases.length, 1);
    assert.equal(database.prepare("SELECT status FROM messages WHERE content LIKE '%Pick one%'").get().status, 'failed');
});

test('admin sends preserve explicit tenantless credentials without charging a tenant', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const billing = createBilling();
    const requests = [];
    const router = createMessageSendsRouter({
        database,
        credentialResolver: credentialsFor,
        requestMeta: async (url) => {
            requests.push(url);
            return { ok: true, status: 200, data: { messages: [{ id: 'wa-global' }] } };
        },
        billing,
    });
    const result = await invokeRoute(router, 'post', '/send', {
        body: {
            recipient: '218910000099',
            type: 'text',
            message: 'Global send',
            phone_number_id: 'global/phone',
            access_token: 'global-token',
        },
    });
    assert.equal(result.statusCode, 200);
    assert.match(requests[0], /\/global%2Fphone\/messages$/);
    assert.equal(billing.calls.reserves[0].tenantId, null);
    assert.equal(billing.calls.commits.length, 0);
    assert.equal(database.prepare("SELECT tenant_id FROM messages WHERE wamid = 'wa-global'").get().tenant_id, null);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM activity_logs').get().count, 0);
});

test('admin text sends use the production clock dependency by default', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    database.prepare(`
        UPDATE contacts SET last_customer_message_at = datetime('now')
        WHERE tenant_id = 1 AND phone = '218910000001'
    `).run();
    const billing = createBilling();
    const router = createMessageSendsRouter({
        database,
        credentialResolver: credentialsFor,
        requestMeta: async () => ({
            ok: true,
            status: 200,
            data: { messages: [{ id: 'wa-default-clock' }] },
        }),
        billing,
    });
    const result = await invokeRoute(router, 'post', '/send', {
        body: {
            tenant_id: 1,
            recipient: '218910000001',
            type: 'text',
            message: 'Default clock',
        },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(billing.calls.commits.length, 1);
});
