import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createMessengerBotRouter } from '../routes/messengerBot.js';
import { createMessengerBotFlowsRouter } from '../routes/messengerBotFlows.js';
import {
    createMessengerBotProductsRouter,
    parseProductsCsv,
} from '../routes/messengerBotProducts.js';
import { createMessengerBotSessionsRouter } from '../routes/messengerBotSessions.js';
import { createMessengerBotSummaryRouter } from '../routes/messengerBotSummary.js';

function createDatabase() {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec(`
        CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE tenant_pages (
            id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, page_id TEXT,
            page_name TEXT, is_active INTEGER DEFAULT 1,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );
        CREATE TABLE fb_conversations (
            id INTEGER PRIMARY KEY, user_name TEXT, user_psid TEXT,
            user_profile_pic TEXT, last_message TEXT, last_message_time DATETIME
        );
        CREATE TABLE bot_products (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL,
            sku TEXT, name TEXT NOT NULL, description TEXT, price REAL DEFAULT 0,
            currency TEXT DEFAULT 'LYD', image_url TEXT, product_url TEXT,
            category TEXT, availability TEXT DEFAULT 'available', is_active INTEGER DEFAULT 1,
            approval_status TEXT DEFAULT 'approved',
            source_linked_page_id INTEGER, source_post_id TEXT, source_post_url TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX idx_bot_products_sku
            ON bot_products(tenant_id, sku) WHERE sku IS NOT NULL AND sku != '';
        CREATE TABLE bot_product_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL, image_url TEXT NOT NULL, alt_text TEXT,
            sort_order INTEGER DEFAULT 0, is_primary INTEGER DEFAULT 0,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES bot_products(id) ON DELETE CASCADE
        );
        CREATE TABLE bot_flows (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL,
            linked_page_id INTEGER, name TEXT NOT NULL, trigger_type TEXT NOT NULL DEFAULT 'keyword',
            trigger_value TEXT, priority INTEGER DEFAULT 100, status TEXT DEFAULT 'draft',
            description TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
            FOREIGN KEY (linked_page_id) REFERENCES tenant_pages(id) ON DELETE SET NULL
        );
        CREATE TABLE bot_flow_nodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT, flow_id INTEGER NOT NULL,
            node_key TEXT NOT NULL DEFAULT 'start', node_type TEXT NOT NULL DEFAULT 'text',
            title TEXT, body TEXT, config_json TEXT, sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (flow_id) REFERENCES bot_flows(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX idx_bot_flow_nodes_key ON bot_flow_nodes(flow_id, node_key);
        CREATE TABLE bot_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL,
            linked_page_id INTEGER NOT NULL, conversation_id INTEGER, user_psid TEXT NOT NULL,
            active_flow_id INTEGER, current_node_key TEXT, status TEXT DEFAULT 'active',
            context_json TEXT, last_user_message_at DATETIME, last_bot_message_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
            FOREIGN KEY (linked_page_id) REFERENCES tenant_pages(id) ON DELETE CASCADE,
            FOREIGN KEY (conversation_id) REFERENCES fb_conversations(id) ON DELETE SET NULL,
            FOREIGN KEY (active_flow_id) REFERENCES bot_flows(id) ON DELETE SET NULL
        );
        CREATE TABLE bot_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL,
            linked_page_id INTEGER, conversation_id INTEGER, session_id INTEGER,
            event_type TEXT NOT NULL, direction TEXT, payload_json TEXT,
            status TEXT DEFAULT 'info', error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );

        INSERT INTO tenants VALUES (1, 'Tenant A'), (2, 'Tenant B');
        INSERT INTO tenant_pages VALUES
            (1, 1, 'page-a', 'Page A', 1),
            (2, 2, 'page-b', 'Page B', 1);
        INSERT INTO fb_conversations VALUES
            (1, 'User A', 'psid-a', NULL, 'A', CURRENT_TIMESTAMP),
            (2, 'User B', 'psid-b', NULL, 'B', CURRENT_TIMESTAMP);
        INSERT INTO bot_products (
            id, tenant_id, sku, name, description, price, currency, category, availability, is_active
        ) VALUES
            (1, 1, 'A-1', 'Tenant A product', 'A', 10, 'LYD', 'food', 'available', 1),
            (2, 2, 'B-1', 'Tenant B product', 'B', 20, 'USD', 'other', 'available', 1);
        INSERT INTO bot_product_images (tenant_id, product_id, image_url, sort_order, is_primary)
        VALUES (1, 1, 'https://images.test/a.jpg', 0, 1);
        INSERT INTO bot_flows (
            id, tenant_id, linked_page_id, name, trigger_type, trigger_value, priority, status
        ) VALUES
            (1, 1, 1, 'Flow A', 'keyword', 'hello', 10, 'active'),
            (2, 2, 2, 'Flow B', 'keyword', 'other', 10, 'active');
        INSERT INTO bot_flow_nodes (flow_id, node_key, node_type, body, config_json)
        VALUES (1, 'start', 'text', 'Hello A', '{}'), (2, 'start', 'text', 'Hello B', '{}');
        INSERT INTO bot_sessions (
            id, tenant_id, linked_page_id, conversation_id, user_psid, active_flow_id, status
        ) VALUES
            (1, 1, 1, 1, 'psid-a', 1, 'active'),
            (2, 2, 2, 2, 'psid-b', 2, 'active');
        INSERT INTO bot_events (tenant_id, linked_page_id, conversation_id, session_id, event_type, payload_json, status)
        VALUES
            (1, 1, 1, 1, 'flow_matched', '{"flow_id":1,"flow_name":"Flow A"}', 'success'),
            (2, 2, 2, 2, 'send_failed', '{"flow_id":2}', 'error');
    `);
    return database;
}

const findHandlers = (router, method, routePath) => {
    const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.map(item => item.handle);
};

const invoke = (router, method, routePath, request = {}, { routeHandlerOnly = false } = {}) => new Promise((resolve, reject) => {
    const req = {
        user: { tenant_id: 1, role: 'tenant' },
        body: {},
        query: {},
        params: {},
        ...request,
    };
    const res = {
        statusCode: 200,
        body: undefined,
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; resolve(this); return this; },
    };
    const allHandlers = findHandlers(router, method, routePath);
    const handlers = routeHandlerOnly ? [allHandlers.at(-1)] : allHandlers;
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

function collectEndpoints(router) {
    const endpoints = [];
    const visit = stack => {
        for (const layer of stack || []) {
            if (layer.route) {
                for (const method of Object.keys(layer.route.methods)) {
                    endpoints.push(`${method.toUpperCase()} ${layer.route.path}`);
                }
            } else if (layer.handle?.stack) {
                visit(layer.handle.stack);
            }
        }
    };
    visit(router.stack);
    return endpoints.sort();
}

test('Messenger bot facade composes the complete route surface', (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const router = createMessengerBotRouter({
        database,
        products: {
            csvUploadMiddleware: (req, res, next) => next(),
            imageUploadMiddleware: (req, res, next) => next(),
        },
        flows: { previewBuilder: () => ({ ok: true }) },
    });

    assert.deepEqual(collectEndpoints(router), [
        'DELETE /flows/:id',
        'DELETE /products/:id',
        'GET /flows',
        'GET /flows/:id',
        'GET /flows/:id/events',
        'GET /products',
        'GET /sessions',
        'GET /summary',
        'PATCH /flows/:id/toggle',
        'PATCH /products/:id',
        'PATCH /sessions/:id',
        'POST /assets/upload',
        'POST /flows',
        'POST /flows/:id/test',
        'POST /products',
        'POST /products/import',
        'PUT /flows/:id',
    ]);
});

test('product CRUD preserves galleries and enforces tenant ownership for tenants and admins', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const router = createMessengerBotProductsRouter({ database });

    const list = await invoke(router, 'get', '/products');
    assert.deepEqual(list.body.map(product => product.id), [1]);
    assert.deepEqual(list.body[0].images.map(image => image.image_url), ['https://images.test/a.jpg']);

    const missingAdminTenant = await invoke(router, 'get', '/products', {
        user: { role: 'admin' },
    });
    assert.equal(missingAdminTenant.statusCode, 400);
    const adminList = await invoke(router, 'get', '/products', {
        user: { role: 'admin' },
        query: { tenant_id: '2' },
    });
    assert.deepEqual(adminList.body.map(product => product.id), [2]);

    const created = await invoke(router, 'post', '/products', {
        body: {
            sku: 'A-2',
            name: '  New product  ',
            price: '12.5',
            currency: 'usd',
            images: [
                { image_url: 'https://images.test/one.jpg', alt_text: 'One' },
                'https://images.test/two.jpg',
                'https://images.test/one.jpg',
            ],
        },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.tenant_id, 1);
    assert.equal(created.body.name, 'New product');
    assert.equal(created.body.currency, 'USD');
    assert.equal(created.body.images.length, 2);
    assert.equal(created.body.images[0].is_primary, 1);

    const draftFromPost = await invoke(router, 'post', '/products', {
        body: {
            name: 'Draft from post',
            approval_status: 'draft',
            source_linked_page_id: 1,
            source_post_id: 'page-a_post-1',
            source_post_url: 'https://facebook.test/post-1',
        },
    });
    assert.equal(draftFromPost.statusCode, 201);
    assert.equal(draftFromPost.body.approval_status, 'draft');
    assert.equal(draftFromPost.body.is_active, 0);

    const incompleteApproval = await invoke(router, 'patch', '/products/:id', {
        params: { id: String(draftFromPost.body.id) },
        body: { is_active: true },
    });
    assert.equal(incompleteApproval.statusCode, 400);
    assert.equal(incompleteApproval.body.code, 'PRODUCT_APPROVAL_FIELDS_REQUIRED');

    const approvedFromPost = await invoke(router, 'patch', '/products/:id', {
        params: { id: String(draftFromPost.body.id) },
        body: {
            sku: 'POST-1',
            price: 35,
            category: 'phones',
            is_active: true,
        },
    });
    assert.equal(approvedFromPost.statusCode, 200);
    assert.equal(approvedFromPost.body.approval_status, 'approved');
    assert.equal(approvedFromPost.body.is_active, 1);

    const updated = await invoke(router, 'patch', '/products/:id', {
        params: { id: String(created.body.id) },
        body: { name: 'Renamed' },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.body.name, 'Renamed');
    assert.deepEqual(updated.body.images.map(image => image.image_url), [
        'https://images.test/one.jpg',
        'https://images.test/two.jpg',
    ]);

    const crossUpdate = await invoke(router, 'patch', '/products/:id', {
        params: { id: '2' },
        body: { name: 'Stolen' },
    });
    assert.equal(crossUpdate.statusCode, 404);
    const crossDelete = await invoke(router, 'delete', '/products/:id', { params: { id: '2' } });
    assert.equal(crossDelete.statusCode, 404);
    assert.equal(database.prepare('SELECT name FROM bot_products WHERE id = 2').get().name, 'Tenant B product');
});

test('CSV import handles quoting, upserts within one tenant and always cleans the temporary upload', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'messenger-products-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'products.csv');
    const csv = [
        'sku,name,description,price,currency,category',
        'A-1,"Updated, product","Uses ""quoted"" text",15.25,usd,food',
        'A-3,Third product,Fresh,8,lyd,new',
    ].join('\n');
    fs.writeFileSync(filePath, csv);

    const parsed = parseProductsCsv(csv);
    assert.equal(parsed[0].name, 'Updated, product');
    assert.equal(parsed[0].description, 'Uses "quoted" text');
    assert.equal(parsed[0].currency, 'USD');

    const cleaned = [];
    const router = createMessengerBotProductsRouter({
        database,
        cleanupUploadedFile: value => { cleaned.push(value); fs.rmSync(value, { force: true }); },
    });
    const imported = await invoke(router, 'post', '/products/import', {
        file: { path: filePath },
    }, { routeHandlerOnly: true });
    assert.equal(imported.statusCode, 200);
    assert.deepEqual(imported.body, { success: true, imported: 2, skipped: 0 });
    assert.deepEqual(cleaned, [filePath]);
    assert.equal(fs.existsSync(filePath), false);
    assert.equal(database.prepare("SELECT name FROM bot_products WHERE tenant_id = 1 AND sku = 'A-1'").get().name, 'Updated, product');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM bot_products WHERE tenant_id = 1 AND sku = 'A-3'").get().count, 1);
    assert.equal(database.prepare("SELECT name FROM bot_products WHERE tenant_id = 2 AND sku = 'B-1'").get().name, 'Tenant B product');
});

test('flow CRUD validates activation and linked-page ownership while preserving tenant isolation', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const previews = [];
    const router = createMessengerBotFlowsRouter({
        database,
        previewBuilder: (node, tenantId) => { previews.push({ node, tenantId }); return { body: node.body }; },
    });

    const crossTenant = await invoke(router, 'get', '/flows/:id', { params: { id: '2' } });
    assert.equal(crossTenant.statusCode, 404);
    const invalidPage = await invoke(router, 'post', '/flows', {
        body: { name: 'Bad page', linked_page_id: 2, status: 'draft' },
    });
    assert.equal(invalidPage.statusCode, 400);
    const invalidActive = await invoke(router, 'post', '/flows', {
        body: { name: 'No keyword', trigger_type: 'keyword', status: 'active' },
    });
    assert.equal(invalidActive.statusCode, 400);

    const created = await invoke(router, 'post', '/flows', {
        body: {
            name: 'Draft flow',
            linked_page_id: 1,
            trigger_type: 'keyword',
            trigger_value: 'new',
            status: 'draft',
            nodes: [{ node_key: 'first', node_type: 'text', body: 'Welcome' }],
        },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.tenant_id, 1);
    assert.equal(created.body.node.node_key, 'start');

    const toggled = await invoke(router, 'patch', '/flows/:id/toggle', {
        params: { id: String(created.body.id) },
    });
    assert.equal(toggled.statusCode, 200);
    assert.equal(toggled.body.status, 'active');
    const preview = await invoke(router, 'post', '/flows/:id/test', {
        params: { id: String(created.body.id) },
    });
    assert.deepEqual(preview.body.preview, { body: 'Welcome' });
    assert.equal(previews[0].tenantId, 1);
});

test('session and summary routes expose only the authenticated tenant state', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const sessionsRouter = createMessengerBotSessionsRouter({ database });
    const summaryRouter = createMessengerBotSummaryRouter({ database });

    const sessions = await invoke(sessionsRouter, 'get', '/sessions');
    assert.deepEqual(sessions.body.map(session => session.id), [1]);
    const invalid = await invoke(sessionsRouter, 'patch', '/sessions/:id', {
        params: { id: '1' },
        body: { status: 'invalid' },
    });
    assert.equal(invalid.statusCode, 400);
    const crossTenant = await invoke(sessionsRouter, 'patch', '/sessions/:id', {
        params: { id: '2' },
        body: { status: 'closed' },
    });
    assert.equal(crossTenant.statusCode, 404);
    const closed = await invoke(sessionsRouter, 'patch', '/sessions/:id', {
        params: { id: '1' },
        body: { status: 'closed' },
    });
    assert.equal(closed.body.status, 'closed');

    const summary = await invoke(summaryRouter, 'get', '/summary');
    assert.equal(summary.statusCode, 200);
    assert.equal(summary.body.tenant.id, 1);
    assert.deepEqual(summary.body.products, { total: 1, active: 1 });
    assert.deepEqual(summary.body.flows, { total: 1, active: 1 });
    assert.deepEqual(summary.body.sessions, [{ status: 'closed', count: 1 }]);
    assert.equal(summary.body.performance.top_flows[0].flow_name, 'Flow A');
    assert.equal(summary.body.performance.failed_sends, 0);
});
