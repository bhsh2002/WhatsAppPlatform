import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createTenantUnifiedInboxRouter } from '../routes/tenantUnifiedInbox.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT, phone_number_id TEXT, status TEXT);
        CREATE TABLE contacts (
            tenant_id INTEGER, phone TEXT, profile_name TEXT, profile_picture_url TEXT,
            last_ctwa_clid TEXT, last_ctwa_source_id TEXT, last_ctwa_source_type TEXT,
            last_ctwa_source_url TEXT, last_ctwa_received_at DATETIME,
            last_customer_message_at DATETIME
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, direction TEXT,
            recipient TEXT, sender TEXT, message_type TEXT, content TEXT, status TEXT,
            wamid TEXT, error_message TEXT, media_id TEXT, media_url TEXT,
            media_mime_type TEXT, referral_ctwa_clid TEXT, referral_source_id TEXT,
            referral_source_type TEXT, referral_source_url TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE tenant_pages (
            id INTEGER PRIMARY KEY, tenant_id INTEGER, page_id TEXT, page_name TEXT,
            page_access_token_encrypted TEXT, is_active INTEGER
        );
        CREATE TABLE fb_conversations (
            id INTEGER PRIMARY KEY, tenant_id INTEGER, linked_page_id INTEGER, page_id TEXT,
            user_psid TEXT, user_name TEXT, user_profile_pic TEXT, last_message TEXT,
            last_message_time DATETIME, unread_count INTEGER, is_active INTEGER,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE fb_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER, tenant_id INTEGER,
            mid TEXT UNIQUE, direction TEXT, sender_id TEXT, sender_name TEXT,
            message_text TEXT, attachment_type TEXT, attachment_url TEXT, sticker_url TEXT,
            is_read INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO tenants VALUES
            (1, 'Tenant A', 'phone/A', 'Active'),
            (2, 'Tenant B', 'phone-B', 'Active'),
            (3, 'Suspended', 'phone-C', 'Suspended');
        INSERT INTO contacts VALUES
            (1, '218910000001', 'Contact A', NULL, NULL, NULL, NULL, NULL, NULL, datetime('now')),
            (1, '218910000009', 'Contact New', NULL, NULL, NULL, NULL, NULL, NULL, datetime('now')),
            (2, '218910000002', 'Contact B', NULL, NULL, NULL, NULL, NULL, NULL, datetime('now'));
        INSERT INTO messages (
            id, tenant_id, direction, recipient, sender, message_type, content, status, wamid, created_at
        ) VALUES
            (1, 1, 'incoming', 'phone/A', '218910000001', 'text', 'Incoming A', 'received', 'wa-in-a', '2026-07-14 10:00:00'),
            (2, 1, 'outgoing', '218910000001', 'phone/A', 'text', 'Outgoing A', 'sent', 'wa-out-a', '2026-07-14 11:00:00'),
            (3, 2, 'incoming', 'phone-B', '218910000002', 'text', 'Incoming B', 'received', 'wa-in-b', '2026-07-14 12:00:00');
        INSERT INTO tenant_pages VALUES
            (10, 1, 'page/A', 'Page A', 'encrypted-a', 1),
            (20, 2, 'page-B', 'Page B', 'encrypted-b', 1);
        INSERT INTO fb_conversations VALUES
            (100, 1, 10, 'page/A', 'psid-a', 'Messenger A', NULL, 'FB A', '2026-07-14 13:00:00', 1, 1, CURRENT_TIMESTAMP),
            (200, 2, 20, 'page-B', 'psid-b', 'Messenger B', NULL, 'FB B', '2026-07-14 14:00:00', 1, 1, CURRENT_TIMESTAMP);
        INSERT INTO fb_messages (
            conversation_id, tenant_id, mid, direction, sender_id, sender_name,
            message_text, is_read, created_at
        ) VALUES
            (100, 1, 'fb-in-a', 'incoming', 'psid-a', 'Messenger A', 'FB incoming A', 0, '2026-07-14 13:00:00'),
            (200, 2, 'fb-in-b', 'incoming', 'psid-b', 'Messenger B', 'FB incoming B', 0, '2026-07-14 14:00:00');
    `);
    return db;
}

function createBilling() {
    const calls = { reserves: [], commits: [], releases: [] };
    return {
        calls,
        operations: { WHATSAPP_TEXT: 'whatsapp.text', MESSENGER_REPLY: 'messenger.reply' },
        reserve(options) {
            const value = { id: calls.reserves.length + 1, ...options };
            calls.reserves.push(value);
            return value;
        },
        commit(reservation, options) { calls.commits.push({ reservation, options }); },
        release(reservation, reason) { calls.releases.push({ reservation, reason }); },
        handleError: () => false,
    };
}

const findHandlers = (router, method, path) => {
    const layer = router.stack.find(item => item.route?.path === path && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method} ${path}`);
    return layer.route.stack.map(item => item.handle);
};

const invoke = (router, method, path, request = {}) => new Promise((resolve, reject) => {
    const req = { user: { tenant_id: 1 }, body: {}, query: {}, params: {}, ...request };
    const res = {
        statusCode: 200,
        body: undefined,
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; resolve(this); return this; },
    };
    const handlers = findHandlers(router, method, path);
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
        router: createTenantUnifiedInboxRouter({
            database: db,
            accessTokenForTenant: tenantId => `wa-token-${tenantId}`,
            decryptToken: value => value === 'encrypted-a' ? 'page-token-a' : 'page-token-b',
            requestMeta: async () => ({ ok: true, status: 200, data: {} }),
            billing,
            ...overrides,
        }),
    };
}

test('unified conversations validate channel and merge only the current tenant sources', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const { router } = createRouter(db);
    const invalid = await invoke(router, 'get', '/unified/conversations', {
        query: { channel: 'email' },
    });
    assert.equal(invalid.statusCode, 400);
    const all = await invoke(router, 'get', '/unified/conversations');
    assert.equal(all.statusCode, 200);
    assert.deepEqual(new Set(all.body.map(row => row.channel)), new Set(['whatsapp', 'messenger']));
    assert.ok(all.body.every(row => row.tenant_id === 1));
    assert.doesNotMatch(JSON.stringify(all.body), /Incoming B|FB B|Messenger B/);
    const whatsapp = await invoke(router, 'get', '/unified/conversations', {
        query: { channel: 'whatsapp' },
    });
    assert.deepEqual(whatsapp.body.map(row => row.channel), ['whatsapp']);
    assert.equal(whatsapp.body[0].contact_id, '218910000001');
});

test('unified message reads mark only the owned WhatsApp or Messenger conversation as read', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const { router } = createRouter(db);
    const whatsapp = await invoke(router, 'get', '/unified/:channel/:id/messages', {
        params: { channel: 'whatsapp', id: '218910000001' },
    });
    assert.equal(whatsapp.statusCode, 200);
    assert.deepEqual(whatsapp.body.map(row => row.id), [1, 2]);
    assert.equal(db.prepare('SELECT status FROM messages WHERE id = 1').get().status, 'read');
    assert.equal(db.prepare('SELECT status FROM messages WHERE id = 3').get().status, 'received');

    const wrongContact = await invoke(router, 'get', '/unified/:channel/:id/messages', {
        params: { channel: 'messenger', id: 'psid-other' },
        query: { conversation_id: '100' },
    });
    assert.equal(wrongContact.statusCode, 404);
    const messenger = await invoke(router, 'get', '/unified/:channel/:id/messages', {
        params: { channel: 'messenger', id: 'psid-a' },
        query: { conversation_id: '100' },
    });
    assert.equal(messenger.statusCode, 200);
    assert.equal(messenger.body[0].message_text, 'FB incoming A');
    assert.equal(db.prepare("SELECT is_read FROM fb_messages WHERE mid = 'fb-in-a'").get().is_read, 1);
    assert.equal(db.prepare("SELECT is_read FROM fb_messages WHERE mid = 'fb-in-b'").get().is_read, 0);
    assert.equal(db.prepare('SELECT unread_count FROM fb_conversations WHERE id = 100').get().unread_count, 0);
    assert.equal(db.prepare('SELECT unread_count FROM fb_conversations WHERE id = 200').get().unread_count, 1);
});

test('WhatsApp read receipts and unified sends use tenant credentials and settle billing', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const requests = [];
    const emitted = [];
    const responses = [
        { ok: true, status: 200, data: { success: true } },
        { ok: true, status: 200, data: { messages: [{ id: 'wa-new' }] } },
    ];
    const { router, billing } = createRouter(db, {
        requestMeta: async (url, init) => {
            requests.push({ url, init });
            return responses.shift();
        },
        emitNewMessage: value => emitted.push(value),
        emitConversationUpdate: tenantId => emitted.push({ update: tenantId }),
    });
    const read = await invoke(router, 'post', '/mark-read', {
        body: { message_id: 'wa-in-a' },
    });
    assert.equal(read.statusCode, 200);
    assert.match(requests[0].url, /\/phone%2FA\/messages$/);
    assert.equal(requests[0].init.headers.Authorization, 'Bearer wa-token-1');

    const sent = await invoke(router, 'post', '/unified/:channel/:id/send', {
        params: { channel: 'whatsapp', id: '+218 910000009' },
        body: { message: '  New WhatsApp message  ' },
    });
    assert.equal(sent.statusCode, 200);
    assert.equal(sent.body.message_id, 'wa-new');
    assert.equal(JSON.parse(requests[1].init.body).to, '218910000009');
    assert.equal(billing.calls.reserves[0].tenantId, 1);
    assert.equal(billing.calls.commits.length, 1);
    assert.equal(db.prepare("SELECT tenant_id FROM messages WHERE wamid = 'wa-new'").get().tenant_id, 1);
    assert.equal(emitted[0].tenant_id, 1);
    assert.deepEqual(emitted[1], { update: 1 });
});

test('Messenger unified send enforces page ownership and releases billing outside the response window', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const handoffs = [];
    const broadcasts = [];
    const responses = [
        { ok: true, status: 200, data: { message_id: 'fb-new' } },
        { ok: false, status: 400, error: { message: 'Window closed', code: 10 } },
    ];
    const { router, billing } = createRouter(db, {
        requestMeta: async () => responses.shift(),
        markHandoff: value => handoffs.push(value),
        broadcast: (channel, event, data) => broadcasts.push({ channel, event, data }),
    });
    const crossTenant = await invoke(router, 'post', '/unified/:channel/:id/send', {
        params: { channel: 'messenger', id: 'psid-b' },
        body: { message: 'No', linked_page_id: 20 },
    });
    assert.equal(crossTenant.statusCode, 404);
    assert.equal(billing.calls.reserves.length, 0);
    const success = await invoke(router, 'post', '/unified/:channel/:id/send', {
        params: { channel: 'messenger', id: 'psid-a' },
        body: { message: 'Messenger reply', linked_page_id: 10 },
    });
    assert.equal(success.statusCode, 200);
    assert.equal(success.body.message_id, 'fb-new');
    assert.equal(billing.calls.commits.length, 1);
    assert.equal(db.prepare("SELECT tenant_id FROM fb_messages WHERE mid = 'fb-new'").get().tenant_id, 1);
    assert.equal(handoffs[0].tenantId, 1);
    assert.equal(broadcasts[0].channel, 'tenant:1');

    const outsideWindow = await invoke(router, 'post', '/unified/:channel/:id/send', {
        params: { channel: 'messenger', id: 'psid-a' },
        body: { message: 'Late reply', linked_page_id: 10 },
    });
    assert.equal(outsideWindow.statusCode, 403);
    assert.equal(outsideWindow.body.error_code, 'OUTSIDE_WINDOW');
    assert.equal(billing.calls.releases.length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM fb_messages WHERE mid = 'fb-new'").get().count, 1);
});
