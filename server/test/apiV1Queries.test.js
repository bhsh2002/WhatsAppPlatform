import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createApiV1QueriesRouter } from '../routes/api/v1Queries.js';

function createDatabase() {
    const database = new Database(':memory:');
    database.exec(`
        CREATE TABLE tenants (
            id INTEGER PRIMARY KEY, name TEXT, phone_number_id TEXT, status TEXT
        );
        CREATE TABLE contacts (
            id INTEGER PRIMARY KEY, tenant_id INTEGER, phone TEXT, profile_name TEXT
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY, tenant_id INTEGER, direction TEXT, recipient TEXT,
            sender TEXT, message_type TEXT, content TEXT, status TEXT, wamid TEXT,
            error_message TEXT, media_id TEXT, media_url TEXT, media_mime_type TEXT,
            referral_ctwa_clid TEXT, referral_source_id TEXT,
            referral_source_type TEXT, referral_source_url TEXT, created_at DATETIME
        );
        CREATE TABLE templates (
            id INTEGER PRIMARY KEY, tenant_id INTEGER, name TEXT, language TEXT,
            category TEXT, header_type TEXT, header_content TEXT, body TEXT,
            footer TEXT, buttons TEXT, variables TEXT, status TEXT,
            meta_template_id TEXT, quality_score TEXT, parameter_format TEXT,
            created_at DATETIME, updated_at DATETIME
        );
        INSERT INTO tenants VALUES
            (1, 'Tenant A', 'phone-A', 'Active'),
            (2, 'Tenant B', 'phone-B', 'Active');
        INSERT INTO contacts VALUES
            (1, 1, '218910000001', 'Tenant A Contact'),
            (2, 2, '218910000001', 'Tenant B Contact'),
            (3, 1, '218910000002', 'Second Contact');
        INSERT INTO messages VALUES
            (1, 1, 'incoming', 'phone-A', '218910000001', 'text', 'A incoming', 'received', 'a-1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-14 10:00:00'),
            (2, 1, 'outgoing', '218910000001', 'phone-A', 'text', 'A latest', 'sent', 'a-2', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-14 11:00:00'),
            (3, 1, 'incoming', 'phone-A', '218910000002', 'text', 'A second', 'received', 'a-3', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-14 09:00:00'),
            (4, 2, 'incoming', 'phone-B', '218910000001', 'text', 'B newest', 'received', 'b-1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-14 12:00:00');
        INSERT INTO templates VALUES
            (1, 1, 'approved_a', 'en', 'utility', 'none', NULL, 'Approved A', NULL, NULL, NULL, 'approved', 'meta-a', 'GREEN', 'positional', '2026-07-14 10:00:00', '2026-07-14 10:00:00'),
            (2, 1, 'pending_a', 'en', 'utility', 'none', NULL, 'Pending A', NULL, NULL, NULL, 'pending', NULL, 'UNKNOWN', 'positional', '2026-07-14 11:00:00', '2026-07-14 11:00:00'),
            (3, 2, 'approved_b', 'en', 'utility', 'none', NULL, 'Approved B', NULL, NULL, NULL, 'approved', 'meta-b', 'GREEN', 'positional', '2026-07-14 12:00:00', '2026-07-14 12:00:00');
    `);
    return database;
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

test('API v1 conversations isolate latest messages, unread counts and contact profiles by tenant', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const router = createApiV1QueriesRouter({ database, logger: { error: () => undefined } });

    const result = await invoke(router, 'get', '/conversations', { query: { limit: '1' } });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, [{
        contact: '218910000001',
        last_interaction: '2026-07-14 11:00:00',
        last_message: 'A latest',
        last_message_type: 'text',
        profile_name: 'Tenant A Contact',
        unread_count: 1,
    }]);

    const secondPage = await invoke(router, 'get', '/conversations', {
        query: { limit: '1', offset: '1' },
    });
    assert.equal(secondPage.body[0].contact, '218910000002');
    assert.doesNotMatch(JSON.stringify(result.body), /Tenant B|B newest/);

    const invalidTenant = await invoke(router, 'get', '/conversations', { tenantId: 0 });
    assert.equal(invalidTenant.statusCode, 401);
});

test('API v1 conversation messages validate recipients and remain chronological and tenant-scoped', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const router = createApiV1QueriesRouter({ database, logger: { error: () => undefined } });

    const result = await invoke(router, 'get', '/conversations/:phone/messages', {
        params: { phone: '+218 91 000 0001' },
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.map(message => message.content), ['A incoming', 'A latest']);
    assert.ok(result.body.every(message => message.tenant_id === 1));
    assert.ok(result.body.every(message => Object.hasOwn(message, 'referral_ctwa_clid')));

    const invalid = await invoke(router, 'get', '/conversations/:phone/messages', {
        params: { phone: 'not-a-phone' },
    });
    assert.equal(invalid.statusCode, 400);
});

test('API v1 template reads validate filters, ids and ownership without implicit columns', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const router = createApiV1QueriesRouter({ database, logger: { error: () => undefined } });

    const approved = await invoke(router, 'get', '/templates');
    assert.deepEqual(approved.body.map(template => template.name), ['approved_a']);
    assert.equal(approved.body[0].quality_score, 'GREEN');

    const pending = await invoke(router, 'get', '/templates', { query: { status: 'PENDING' } });
    assert.deepEqual(pending.body.map(template => template.name), ['pending_a']);

    const invalidStatus = await invoke(router, 'get', '/templates', { query: { status: 'anything' } });
    assert.equal(invalidStatus.statusCode, 400);

    const ownTemplate = await invoke(router, 'get', '/templates/:id', { params: { id: '1' } });
    assert.equal(ownTemplate.statusCode, 200);
    assert.equal(ownTemplate.body.name, 'approved_a');

    const otherTenant = await invoke(router, 'get', '/templates/:id', { params: { id: '3' } });
    assert.equal(otherTenant.statusCode, 404);

    const invalidId = await invoke(router, 'get', '/templates/:id', { params: { id: '1 OR 1=1' } });
    assert.equal(invalidId.statusCode, 400);
});
