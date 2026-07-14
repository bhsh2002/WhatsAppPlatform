import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createTenantTemplatesRouter } from '../routes/tenantTemplates.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE tenants (
            id INTEGER PRIMARY KEY,
            name TEXT,
            waba_id TEXT,
            phone_number_id TEXT
        );
        CREATE TABLE templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            language TEXT DEFAULT 'ar',
            category TEXT DEFAULT 'UTILITY',
            header_type TEXT DEFAULT 'none',
            header_content TEXT,
            body TEXT NOT NULL,
            footer TEXT,
            buttons TEXT,
            variables TEXT,
            status TEXT DEFAULT 'draft',
            meta_template_id TEXT,
            quality_score TEXT DEFAULT 'UNKNOWN',
            parameter_format TEXT DEFAULT 'positional',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (tenant_id, name, language)
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
            (1, 'Tenant A', 'waba/A', 'phone-a'),
            (2, 'Tenant B', 'waba-b', 'phone-b');
        INSERT INTO templates (
            id, tenant_id, name, language, category, header_type,
            header_content, body, footer, buttons, variables, status
        ) VALUES
            (1, 1, 'welcome', 'ar', 'UTILITY', 'text', 'Header A', 'Old A', 'Footer A', '[]', '{}', 'draft'),
            (2, 2, 'welcome', 'ar', 'UTILITY', 'none', NULL, 'Tenant B', NULL, NULL, NULL, 'approved');
    `);
    return db;
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

function createRouter(db, overrides = {}) {
    return createTenantTemplatesRouter({
        database: db,
        accessTokenForTenant: tenantId => `token-${tenantId}`,
        requestMeta: async () => ({ ok: true, status: 200, data: {} }),
        apiBase: 'https://graph.test/v25.0',
        ...overrides,
    });
}

test('local template CRUD validates fields, preserves omitted values and enforces tenant ownership', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const router = createRouter(db);
    const deletePaths = router.stack
        .filter(layer => layer.route?.methods?.delete)
        .map(layer => layer.route.path);
    assert.ok(deletePaths.indexOf('/templates/delete-meta') < deletePaths.indexOf('/templates/:id'));

    const list = await invokeRoute(router, 'get', '/templates', {
        user: { tenant_id: 1 },
    });
    assert.deepEqual(list.body.map(template => template.id), [1]);
    const otherTenant = await invokeRoute(router, 'get', '/templates/:id', {
        user: { tenant_id: 1 },
        params: { id: '2' },
    });
    assert.equal(otherTenant.statusCode, 404);
    const malformed = await invokeRoute(router, 'get', '/templates/:id', {
        user: { tenant_id: 1 },
        params: { id: '1junk' },
    });
    assert.equal(malformed.statusCode, 400);

    const invalid = await invokeRoute(router, 'post', '/templates', {
        user: { tenant_id: 1 },
        body: { name: 'bad', body: 'Body', category: 'NOT_REAL' },
    });
    assert.equal(invalid.statusCode, 400);
    const created = await invokeRoute(router, 'post', '/templates', {
        user: { tenant_id: 1 },
        body: {
            name: 'new_template',
            body: 'New body',
            category: 'marketing',
            buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }],
        },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.tenant_id, 1);
    assert.equal(created.body.category, 'MARKETING');
    const duplicate = await invokeRoute(router, 'post', '/templates', {
        user: { tenant_id: 1 },
        body: { name: 'new_template', body: 'Again' },
    });
    assert.equal(duplicate.statusCode, 409);

    const updated = await invokeRoute(router, 'put', '/templates/:id', {
        user: { tenant_id: 1 },
        params: { id: '1' },
        body: { body: 'Updated only' },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.body.body, 'Updated only');
    assert.equal(updated.body.header_content, 'Header A');
    assert.equal(updated.body.footer, 'Footer A');
    assert.equal(updated.body.buttons, '[]');
    const crossDelete = await invokeRoute(router, 'delete', '/templates/:id', {
        user: { tenant_id: 1 },
        params: { id: '2' },
    });
    assert.equal(crossDelete.statusCode, 404);
    assert.equal(db.prepare('SELECT body FROM templates WHERE id = 2').get().body, 'Tenant B');
});

test('template sync follows only same-origin Meta pagination and upserts within the tenant', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const calls = [];
    const responses = [
        {
            ok: true,
            status: 200,
            data: {
                data: [{
                    id: 'meta-1',
                    name: 'welcome',
                    language: 'ar',
                    category: 'UTILITY',
                    status: 'APPROVED',
                    components: [{ type: 'BODY', text: 'Updated from Meta' }],
                    quality_score: { score: 'GREEN' },
                    parameter_format: 'named',
                }],
                paging: { next: 'https://graph.test/v25.0/page-2' },
            },
        },
        {
            ok: true,
            status: 200,
            data: {
                data: [{
                    id: 'meta-2',
                    name: 'new_meta',
                    language: 'en_US',
                    category: 'MARKETING',
                    status: 'PENDING',
                    components: [
                        { type: 'HEADER', format: 'TEXT', text: 'Hello' },
                        { type: 'BODY', text: 'Meta body' },
                        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Open' }] },
                    ],
                }],
            },
        },
    ];
    const router = createRouter(db, {
        requestMeta: async (url, init) => {
            calls.push({ url, init });
            return responses.shift();
        },
    });
    const result = await invokeRoute(router, 'post', '/templates/sync', {
        user: { tenant_id: 1 },
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual({
        synced: result.body.synced,
        created: result.body.created,
        updated: result.body.updated,
        unchanged: result.body.unchanged,
    }, { synced: 2, created: 1, updated: 1, unchanged: 0 });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, 'https://graph.test/v25.0/page-2');
    assert.ok(calls.every(call => call.init.headers.Authorization === 'Bearer token-1'));
    assert.equal(db.prepare("SELECT body FROM templates WHERE tenant_id = 1 AND name = 'welcome'").get().body, 'Updated from Meta');
    assert.equal(db.prepare("SELECT quality_score FROM templates WHERE tenant_id = 1 AND name = 'welcome'").get().quality_score, 'GREEN');
    assert.equal(db.prepare("SELECT body FROM templates WHERE tenant_id = 2 AND name = 'welcome'").get().body, 'Tenant B');

    const unsafeRouter = createRouter(db, {
        requestMeta: async () => ({
            ok: true,
            status: 200,
            data: { data: [], paging: { next: 'https://attacker.test/steal' } },
        }),
    });
    const unsafe = await invokeRoute(unsafeRouter, 'post', '/templates/sync', {
        user: { tenant_id: 2 },
    });
    assert.equal(unsafe.statusCode, 502);
    assert.match(unsafe.body.error, /invalid pagination URL/);
});

test('template import parses Meta components and rejects tenant-local duplicates', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const router = createRouter(db);
    const imported = await invokeRoute(router, 'post', '/templates/import', {
        user: { tenant_id: 1 },
        body: {
            name: 'imported',
            language: 'en_US',
            category: 'UTILITY',
            status: 'APPROVED',
            components: [
                { type: 'HEADER', format: 'TEXT', text: 'Imported header' },
                { type: 'BODY', text: 'Imported body' },
                { type: 'FOOTER', text: 'Imported footer' },
                { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Visit', url: 'https://example.test' }] },
            ],
        },
    });
    assert.equal(imported.statusCode, 201);
    assert.equal(imported.body.tenant_id, 1);
    assert.equal(imported.body.header_type, 'text');
    assert.equal(imported.body.header_content, 'Imported header');
    assert.equal(imported.body.body, 'Imported body');
    assert.equal(JSON.parse(imported.body.buttons)[0].type, 'URL');
    const duplicate = await invokeRoute(router, 'post', '/templates/import', {
        user: { tenant_id: 1 },
        body: { name: 'imported', language: 'en_US', category: 'UTILITY' },
    });
    assert.equal(duplicate.statusCode, 409);
});

test('Meta template create and literal delete use tenant credentials without cross-tenant deletion', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const calls = [];
    const router = createRouter(db, {
        requestMeta: async (url, init) => {
            calls.push({ url, init });
            return { ok: true, status: 200, data: { id: 'meta-created', success: true } };
        },
    });
    const created = await invokeRoute(router, 'post', '/templates/create-meta', {
        user: { tenant_id: 1 },
        body: {
            name: 'meta_new',
            language: 'ar',
            category: 'UTILITY',
            components: [{ type: 'BODY', text: 'Body' }],
            parameter_format: 'positional',
        },
    });
    assert.equal(created.statusCode, 200);
    assert.match(calls[0].url, /\/waba%2FA\/message_templates$/);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer token-1');
    assert.equal(JSON.parse(calls[0].init.body).name, 'meta_new');

    const deleted = await invokeRoute(router, 'delete', '/templates/delete-meta', {
        user: { tenant_id: 1 },
        query: { name: 'welcome' },
    });
    assert.equal(deleted.statusCode, 200);
    assert.match(calls[1].url, /\/waba%2FA\/message_templates\?name=welcome$/);
    assert.equal(calls[1].init.headers.Authorization, 'Bearer token-1');
    assert.equal(db.prepare("SELECT COUNT(*) count FROM templates WHERE tenant_id = 1 AND name = 'welcome'").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM templates WHERE tenant_id = 2 AND name = 'welcome'").get().count, 1);
    assert.equal(db.prepare("SELECT tenant_id FROM activity_logs WHERE event_type = 'template_deleted_meta'").get().tenant_id, 1);
});
