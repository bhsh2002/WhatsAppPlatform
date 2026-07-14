import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createTenantWhatsAppMessagingRouter } from '../routes/tenantWhatsAppMessaging.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT, phone_number_id TEXT, status TEXT);
        CREATE TABLE contacts (
            tenant_id INTEGER, phone TEXT, profile_name TEXT, profile_picture_url TEXT,
            last_customer_message_at DATETIME, last_ctwa_clid TEXT,
            last_ctwa_source_id TEXT, last_ctwa_source_type TEXT,
            last_ctwa_source_url TEXT, last_ctwa_received_at DATETIME
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, direction TEXT,
            recipient TEXT, sender TEXT, message_type TEXT, content TEXT, status TEXT,
            wamid TEXT, error_message TEXT, media_id TEXT, media_url TEXT,
            media_mime_type TEXT, referral_ctwa_clid TEXT, referral_source_id TEXT,
            referral_source_type TEXT, referral_source_url TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE templates (
            id INTEGER PRIMARY KEY, tenant_id INTEGER, name TEXT, language TEXT,
            category TEXT, header_type TEXT, header_content TEXT, body TEXT, footer TEXT,
            buttons TEXT, variables TEXT, status TEXT, meta_template_id TEXT,
            quality_score TEXT, parameter_format TEXT
        );
        CREATE TABLE activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, tenant_name TEXT,
            event_type TEXT, description TEXT, status TEXT
        );
        INSERT INTO tenants VALUES
            (1, 'Tenant A', 'phone/A', 'Active'),
            (2, 'Tenant B', 'phone-B', 'Active'),
            (3, 'Suspended', 'phone-C', 'Suspended');
        INSERT INTO contacts VALUES
            (1, '218910000001', 'Contact A', NULL, datetime('now'), NULL, NULL, NULL, NULL, NULL),
            (2, '218910000002', 'Contact B', NULL, datetime('now'), NULL, NULL, NULL, NULL, NULL);
        INSERT INTO messages (
            id, tenant_id, direction, recipient, sender, message_type, content, status, created_at
        ) VALUES
            (1, 1, 'incoming', 'phone/A', '218910000001', 'text', 'Tenant A incoming', 'received', '2026-07-14 10:00:00'),
            (2, 2, 'incoming', 'phone-B', '218910000002', 'text', 'Tenant B incoming', 'received', '2026-07-14 11:00:00');
        INSERT INTO templates VALUES
            (1, 1, 'hello', 'ar', 'UTILITY', 'none', NULL, 'Hello {{1}}', NULL, NULL, NULL, 'approved', 'meta-a', 'GREEN', 'positional'),
            (2, 2, 'hello', 'ar', 'UTILITY', 'none', NULL, 'Other tenant', NULL, NULL, NULL, 'approved', 'meta-b', 'GREEN', 'positional');
    `);
    return db;
}

function createBilling() {
    const calls = { reserves: [], commits: [], releases: [] };
    return {
        calls,
        operations: {
            WHATSAPP_TEXT: 'whatsapp.text',
            WHATSAPP_TEMPLATE: 'whatsapp.template',
            WHATSAPP_MEDIA: 'whatsapp.media',
            WHATSAPP_INTERACTIVE: 'whatsapp.interactive',
        },
        reserve(options) { const value = { id: calls.reserves.length + 1, ...options }; calls.reserves.push(value); return value; },
        commit(reservation, options) { calls.commits.push({ reservation, options }); },
        release(reservation, reason) { calls.releases.push({ reservation, reason }); },
        handleError: () => false,
    };
}

const findHandlers = (router, method, routePath) => {
    const findLayer = stack => {
        for (const item of stack) {
            if (item.route?.path === routePath && item.route.methods?.[method]) return item;
            const nested = item.handle?.stack ? findLayer(item.handle.stack) : null;
            if (nested) return nested;
        }
        return null;
    };
    const layer = findLayer(router.stack);
    assert.ok(layer, `Missing ${method} ${routePath}`);
    return layer.route.stack.map(item => item.handle);
};

const invoke = (router, method, routePath, request = {}, { routeHandlerOnly = false } = {}) => new Promise((resolve, reject) => {
    const req = { user: { tenant_id: 1 }, body: {}, query: {}, params: {}, ...request };
    const res = {
        statusCode: 200,
        body: undefined,
        headersSent: false,
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; resolve(this); return this; },
    };
    const allHandlers = findHandlers(router, method, routePath);
    const handlers = routeHandlerOnly ? [allHandlers.at(-1)] : allHandlers;
    let index = 0;
    const next = error => {
        if (error) return reject(error);
        if (index >= handlers.length) return resolve(res);
        Promise.resolve(handlers[index++](req, res, next)).catch(reject);
    };
    next();
});

function createRouter(db, overrides = {}) {
    const billing = overrides.billing || createBilling();
    return {
        billing,
        router: createTenantWhatsAppMessagingRouter({
            database: db,
            accessTokenForTenant: tenantId => `token-${tenantId}`,
            billing,
            fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }),
            ...overrides,
        }),
    };
}

test('WhatsApp conversation and window reads are validated, paginated and tenant-scoped', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const { router } = createRouter(db);
    const conversations = await invoke(router, 'get', '/conversations');
    assert.equal(conversations.statusCode, 200);
    assert.deepEqual(conversations.body.map(row => row.contact), ['218910000001']);
    assert.doesNotMatch(JSON.stringify(conversations.body), /Tenant B/);
    const invalidThread = await invoke(router, 'get', '/conversations/:phone/messages', {
        params: { phone: 'not-phone' },
    });
    assert.equal(invalidThread.statusCode, 400);
    const thread = await invoke(router, 'get', '/conversations/:phone/messages', {
        params: { phone: '218910000001' },
    });
    assert.deepEqual(thread.body.map(row => row.id), [1]);
    assert.equal(db.prepare('SELECT status FROM messages WHERE id = 1').get().status, 'read');
    assert.equal(db.prepare('SELECT status FROM messages WHERE id = 2').get().status, 'received');
    const window = await invoke(router, 'get', '/messages/window/:phone', {
        params: { phone: '+218 910000001' },
    });
    assert.equal(window.body.is_open, true);
});

test('text and template sends enforce the conversation window, tenant template and billing lifecycle', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const requests = [];
    const emitted = [];
    const responses = [
        new Response(JSON.stringify({ messages: [{ id: 'wa-text' }] }), { status: 200 }),
        new Response(JSON.stringify({ messages: [{ id: 'wa-template' }] }), { status: 200 }),
    ];
    const { router, billing } = createRouter(db, {
        fetchImpl: async (url, init) => { requests.push({ url, init }); return responses.shift(); },
        emitNewMessage: value => emitted.push(value),
        emitConversationUpdate: value => emitted.push({ update: value }),
    });
    const invalidType = await invoke(router, 'post', '/messages/send', {
        body: { recipient: '218910000001', type: 'image', message: 'No' },
    });
    assert.equal(invalidType.statusCode, 400);
    const outside = await invoke(router, 'post', '/messages/send', {
        body: { recipient: '218910009999', type: 'text', message: 'Closed' },
    });
    assert.equal(outside.statusCode, 400);
    assert.equal(outside.body.code, 'OUTSIDE_WINDOW');
    const textResult = await invoke(router, 'post', '/messages/send', {
        body: { recipient: '+218 910000001', type: 'text', message: '  Hello  ' },
    });
    assert.equal(textResult.statusCode, 200);
    assert.equal(JSON.parse(requests[0].init.body).text.body, 'Hello');
    assert.equal(billing.calls.commits.length, 1);
    assert.equal(db.prepare("SELECT tenant_id FROM messages WHERE wamid = 'wa-text'").get().tenant_id, 1);
    assert.equal(emitted[0].tenant_id, 1);

    const crossTenantTemplate = await invoke(router, 'post', '/messages/send', {
        body: { recipient: '218910000001', type: 'template', templateId: 2, components: [] },
    });
    assert.equal(crossTenantTemplate.statusCode, 404);
    const templateResult = await invoke(router, 'post', '/messages/send', {
        body: {
            recipient: '218910000001', type: 'template', templateId: 1,
            components: [{ type: 'body', parameters: [{ type: 'text', text: 'World' }] }],
        },
    });
    assert.equal(templateResult.statusCode, 200);
    assert.equal(JSON.parse(requests[1].init.body).template.name, 'hello');
    assert.equal(billing.calls.commits.length, 2);
});

test('interactive messages validate payload and settle billing on Meta success or failure', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const responses = [
        new Response(JSON.stringify({ messages: [{ id: 'wa-interactive' }] }), { status: 200 }),
        new Response(JSON.stringify({ error: { message: 'Meta down', code: 2 } }), { status: 503 }),
    ];
    const { router, billing } = createRouter(db, {
        fetchImpl: async () => responses.shift(),
    });
    const invalid = await invoke(router, 'post', '/messages/send-interactive', {
        body: { recipient: '218910000001', interactive_type: 'button', body_text: 'Choose', buttons: [] },
    });
    assert.equal(invalid.statusCode, 400);
    const outsideWindow = await invoke(router, 'post', '/messages/send-interactive', {
        body: {
            recipient: '218910009999', interactive_type: 'button', body_text: 'Closed',
            buttons: [{ id: 'yes', title: 'Yes' }],
        },
    });
    assert.equal(outsideWindow.statusCode, 400);
    assert.equal(outsideWindow.body.code, 'OUTSIDE_WINDOW');
    assert.equal(billing.calls.reserves.length, 0);
    const success = await invoke(router, 'post', '/messages/send-interactive', {
        body: {
            recipient: '218910000001', interactive_type: 'button', body_text: 'Choose',
            buttons: [{ id: 'yes', title: 'Yes' }],
        },
    });
    assert.equal(success.statusCode, 200);
    assert.equal(billing.calls.commits.length, 1);
    const failure = await invoke(router, 'post', '/messages/send-interactive', {
        body: {
            recipient: '218910000001', interactive_type: 'button', body_text: 'Again',
            buttons: [{ id: 'yes', title: 'Yes' }],
        },
    });
    assert.equal(failure.statusCode, 503);
    assert.equal(billing.calls.releases.length, 1);
    assert.equal(db.prepare("SELECT status FROM messages WHERE content LIKE '%Again%'").get().status, 'failed');
});

test('media routes clean rejected uploads and refuse untrusted download URLs before forwarding tokens', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-media-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'upload.pdf');
    fs.writeFileSync(filePath, '%PDF-1.4 test');
    const calls = [];
    const { router } = createRouter(db, {
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return new Response(JSON.stringify({ url: 'https://attacker.test/media', mime_type: 'image/jpeg' }), { status: 200 });
        },
    });
    const rejectedUpload = await invoke(router, 'post', '/messages/send-document', {
        body: { recipient: 'invalid' },
        file: { path: filePath, originalname: 'test.pdf', mimetype: 'application/pdf' },
    }, { routeHandlerOnly: true });
    assert.equal(rejectedUpload.statusCode, 400);
    assert.equal(fs.existsSync(filePath), false);

    const download = await invoke(router, 'get', '/media/:mediaId/download', {
        params: { mediaId: 'media-1' },
    });
    assert.equal(download.statusCode, 502);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/media-1$/);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer token-1');
});
