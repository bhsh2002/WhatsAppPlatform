import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createMessageContactsRouter } from '../routes/messageContacts.js';
import { createMessageReadReceiptsRouter } from '../routes/messageReadReceipts.js';

function createDatabase() {
    const database = new Database(':memory:');
    database.exec(`
        CREATE TABLE tenants (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT DEFAULT 'Active'
        );
        CREATE TABLE contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
            phone TEXT NOT NULL, profile_name TEXT, profile_picture_url TEXT,
            label TEXT, notes TEXT, last_customer_message_at DATETIME,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (tenant_id, phone)
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
            direction TEXT, sender TEXT, recipient TEXT, message_type TEXT,
            content TEXT, status TEXT, wamid TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
            name TEXT, language TEXT, category TEXT, status TEXT,
            header_type TEXT, header_content TEXT, body TEXT, footer TEXT, buttons TEXT
        );
        INSERT INTO tenants VALUES (1, 'Tenant A', 'Active'), (2, 'Tenant B', 'Active');
        INSERT INTO contacts (id, tenant_id, phone, profile_name, label, notes) VALUES
            (1, 1, '218910000001', 'Contact A', 'vip', 'A notes'),
            (2, 2, '218910000002', 'Contact B', 'other', 'B notes'),
            (3, NULL, '218910000003', 'Global', NULL, NULL);
        INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status) VALUES
            (1, 'incoming', '218910000001', 'phone-a', 'text', 'A1', 'received'),
            (1, 'outgoing', 'phone-a', '218910000001', 'text', 'A2', 'sent'),
            (2, 'incoming', '218910000002', 'phone-b', 'text', 'B1', 'received');
        INSERT INTO templates (
            tenant_id, name, language, category, status,
            header_type, header_content, body, footer, buttons
        ) VALUES
            (1, 'verify_a', 'ar', 'UTILITY', 'approved', 'text', 'Header', 'Hello', 'Footer', '[]'),
            (2, 'verify_b', 'en_US', 'MARKETING', 'approved', 'none', NULL, 'Other', NULL, NULL);
    `);
    return database;
}

function createBilling() {
    const calls = { reserves: [], commits: [], releases: [] };
    return {
        calls,
        operations: { WHATSAPP_CONTACT_VERIFICATION_TEMPLATE: 'whatsapp.contact.verify' },
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

const findHandlers = (router, method, routePath) => {
    const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.map(item => item.handle);
};

const invoke = (router, method, routePath, request = {}) => new Promise((resolve, reject) => {
    const req = { body: {}, query: {}, params: {}, ...request };
    const res = {
        statusCode: 200,
        body: undefined,
        headers: {},
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; resolve(this); return this; },
        set(values) { Object.assign(this.headers, values); return this; },
        send(value) { this.body = value; resolve(this); return this; },
    };
    const handlers = findHandlers(router, method, routePath);
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

test('admin contact CSV import requires a tenant and export keeps tenant context', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-contact-import-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'contacts.csv');
    fs.writeFileSync(filePath, [
        'phone,profile_name,label,notes',
        '218910000001,Updated A,VIP,Updated notes',
        '218910000099,Imported A,Lead,New contact',
        '123,Invalid,Lead,Bad phone',
    ].join('\n'));
    const cleaned = [];
    const router = createMessageContactsRouter({
        database,
        csvUploadMiddleware: (req, res, next) => next(),
        cleanupUploadedFile: value => cleaned.push(value),
    });

    const missingTenant = await invoke(router, 'post', '/contacts/import', {
        body: {},
        file: { path: filePath },
    });
    assert.equal(missingTenant.statusCode, 400);

    const imported = await invoke(router, 'post', '/contacts/import', {
        body: { tenant_id: '1' },
        file: { path: filePath },
    });
    assert.equal(imported.statusCode, 200);
    assert.deepEqual(imported.body, {
        imported: 2,
        created: 1,
        updated: 1,
        failed: 1,
        errors: [{ row: 4, error: 'رقم الهاتف يجب أن يحتوي بين 7 و15 رقمًا' }],
    });
    assert.equal(database.prepare("SELECT profile_name FROM contacts WHERE tenant_id = 1 AND phone = '218910000001'").get().profile_name, 'Updated A');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM contacts WHERE tenant_id = 2").get().count, 1);
    assert.deepEqual(cleaned, [filePath, filePath]);

    const exported = await invoke(router, 'get', '/contacts/export', {
        query: { tenant_id: '1' },
    });
    assert.equal(exported.statusCode, 200);
    assert.match(exported.headers['Content-Type'], /text\/csv/);
    assert.match(exported.body, /Imported A/);
    assert.doesNotMatch(exported.body, /Contact B/);
});

test('admin contact listing validates filters, paginates and scopes message counts by tenant', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const router = createMessageContactsRouter({ database });

    const tenantList = await invoke(router, 'get', '/contacts', {
        query: { tenant_id: '1', search: 'Contact', label: 'vip', limit: '500' },
    });
    assert.equal(tenantList.statusCode, 200);
    assert.equal(tenantList.body.limit, 200);
    assert.equal(tenantList.body.total, 1);
    assert.deepEqual(tenantList.body.contacts.map(contact => contact.id), [1]);
    assert.equal(tenantList.body.contacts[0].message_count, 2);
    assert.equal(tenantList.body.contacts[0].tenant_name, 'Tenant A');

    const malformedTenant = await invoke(router, 'get', '/contacts', {
        query: { tenant_id: '1junk' },
    });
    assert.equal(malformedTenant.statusCode, 400);
    const oversizedSearch = await invoke(router, 'get', '/contacts', {
        query: { search: 'x'.repeat(201) },
    });
    assert.equal(oversizedSearch.statusCode, 400);
});

test('manual contact CRUD normalizes fields, permits explicit clears and rejects malformed identifiers', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const router = createMessageContactsRouter({ database });

    const invalid = await invoke(router, 'post', '/contacts', {
        body: { tenant_id: 1, phone: '1234567890123456' },
    });
    assert.equal(invalid.statusCode, 400);
    const missingTenant = await invoke(router, 'post', '/contacts', {
        body: { tenant_id: 999, phone: '218910000099' },
    });
    assert.equal(missingTenant.statusCode, 404);
    const created = await invoke(router, 'post', '/contacts', {
        body: {
            tenant_id: '1',
            phone: '+218 91 000 0004',
            profile_name: '  New Contact  ',
            label: '  lead  ',
            notes: '  Call later  ',
        },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.phone, '218910000004');
    assert.equal(created.body.profile_name, 'New Contact');
    assert.equal(created.body.label, 'lead');

    const duplicate = await invoke(router, 'post', '/contacts', {
        body: { tenant_id: 1, phone: '218910000004' },
    });
    assert.equal(duplicate.statusCode, 409);
    const updated = await invoke(router, 'put', '/contacts/:id', {
        params: { id: String(created.body.id) },
        body: { profile_name: ' Renamed ', label: null, notes: null },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.body.profile_name, 'Renamed');
    assert.equal(updated.body.label, null);
    assert.equal(updated.body.notes, null);

    const emptyUpdate = await invoke(router, 'put', '/contacts/:id', {
        params: { id: String(created.body.id) },
        body: {},
    });
    assert.equal(emptyUpdate.statusCode, 400);
    const malformedDelete = await invoke(router, 'delete', '/contacts/:id', {
        params: { id: `${created.body.id}junk` },
    });
    assert.equal(malformedDelete.statusCode, 400);
    const deleted = await invoke(router, 'delete', '/contacts/:id', {
        params: { id: String(created.body.id) },
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM contacts WHERE id = ?').get(created.body.id).count, 0);
});

test('verified contact creation uses the selected tenant credentials and settles billing on Meta success', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const credentials = [];
    const requests = [];
    const emitted = [];
    const billing = createBilling();
    const router = createMessageContactsRouter({
        database,
        credentialResolver: options => {
            credentials.push(options);
            return { accessToken: 'tenant-a-token', phoneNumberId: 'phone/A', isSuspended: false };
        },
        fetchImpl: async (url, init) => { requests.push({ url, init }); return { response: true }; },
        parseMetaResponse: async () => ({
            ok: true,
            status: 200,
            data: { contacts: [{ wa_id: '218910000010' }], messages: [{ id: 'wamid-verify' }] },
        }),
        billing,
        events: {
            emitNewMessage: value => emitted.push(value),
            emitConversationUpdate: value => emitted.push({ tenant: value }),
        },
        apiBase: 'https://graph.test/v25.0',
    });

    const result = await invoke(router, 'post', '/contacts', {
        body: {
            tenant_id: 1,
            phone: '+218 91 000 0010',
            profile_name: 'Verified',
            verify: true,
        },
    });
    assert.equal(result.statusCode, 201);
    assert.equal(result.body.template_sent, true);
    assert.equal(result.body.contact.tenant_id, 1);
    assert.deepEqual(credentials, [{ tenantId: 1 }]);
    assert.match(requests[0].url, /\/phone%2FA\/messages$/);
    assert.equal(requests[0].init.headers.Authorization, 'Bearer tenant-a-token');
    assert.equal(JSON.parse(requests[0].init.body).template.name, 'verify_a');
    assert.equal(billing.calls.reserves[0].tenantId, 1);
    assert.equal(billing.calls.commits.length, 1);
    assert.equal(billing.calls.releases.length, 0);
    assert.equal(database.prepare("SELECT tenant_id FROM messages WHERE wamid = 'wamid-verify'").get().tenant_id, 1);
    assert.equal(emitted[0].tenant_id, 1);
});

test('failed contact verification releases billing and does not create local state', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const billing = createBilling();
    const router = createMessageContactsRouter({
        database,
        credentialResolver: () => ({ accessToken: 'token', phoneNumberId: 'phone-a', isSuspended: false }),
        fetchImpl: async () => ({}),
        parseMetaResponse: async () => ({
            ok: false,
            status: 400,
            error: { message: 'recipient not found', code: 131026 },
        }),
        billing,
    });

    const result = await invoke(router, 'post', '/contacts', {
        body: { tenant_id: 1, phone: '218910000011', verify: true },
    });
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.error, 'Number not found on WhatsApp');
    assert.equal(billing.calls.commits.length, 0);
    assert.equal(billing.calls.releases.length, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM contacts WHERE phone = '218910000011'").get().count, 0);
});

test('mark-read validates credentials and sends a tenant-selected Meta receipt without exposing tokens', async () => {
    const credentialCalls = [];
    const requests = [];
    const router = createMessageReadReceiptsRouter({
        credentialResolver: options => {
            credentialCalls.push(options);
            return { phoneNumberId: 'phone/A', accessToken: 'secret-token', isSuspended: false };
        },
        fetchImpl: async (url, init) => { requests.push({ url, init }); return {}; },
        parseMetaResponse: async () => ({ ok: true, status: 200, data: {} }),
        apiBase: 'https://graph.test/v25.0',
    });

    const missing = await invoke(router, 'post', '/mark-read');
    assert.equal(missing.statusCode, 400);
    const sent = await invoke(router, 'post', '/mark-read', {
        body: {
            message_id: 'wamid-1',
            tenant_id: 1,
            phone_number_id: 'override-phone',
            access_token: 'override-token',
        },
    });
    assert.deepEqual(sent.body, { success: true });
    assert.deepEqual(credentialCalls, [{
        tenantId: 1,
        phoneNumberIdOverride: 'override-phone',
        accessTokenOverride: 'override-token',
    }]);
    assert.match(requests[0].url, /\/phone%2FA\/messages$/);
    assert.equal(requests[0].init.headers.Authorization, 'Bearer secret-token');
    assert.deepEqual(JSON.parse(requests[0].init.body), {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: 'wamid-1',
    });
});
