import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { runMigrationsSync } from '../db/migrator.js';
import { createFacebookContentAiRouter } from '../routes/facebookContentAi.js';
import { createFacebookContentLibraryRouter } from '../routes/facebookContentLibrary.js';
import { createFacebookContentSettingsRouter } from '../routes/facebookContentSettings.js';
import { createFacebookContentStudioRouter } from '../routes/facebookContentStudio.js';
import {
    buildFacebookContentPrompt,
    extractStructuredFacebookContent,
    requestFacebookContent,
} from '../services/facebookContentAi.js';

const createDatabase = () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    runMigrationsSync(database);
    database.exec(`
        INSERT INTO tenants (id, name, phone, credits)
        VALUES (1, 'Tenant A', '218910000001', 1000),
               (2, 'Tenant B', '218910000002', 1000);
        INSERT INTO users (id, username, password_hash, name, role, tenant_id)
        VALUES (1, 'tenant-a', 'hash', 'Tenant A user', 'tenant', 1),
               (2, 'tenant-b', 'hash', 'Tenant B user', 'tenant', 2);
        INSERT INTO tenant_pages (id, tenant_id, page_id, page_name, is_active)
        VALUES (11, 1, 'page-a', 'Page A', 1),
               (22, 2, 'page-b', 'Page B', 1);
        INSERT INTO bot_products (
            id, tenant_id, sku, name, description, price, currency,
            image_url, product_url, category, availability, is_active
        ) VALUES
            (101, 1, 'A-101', 'منتج ألف', 'وصف موثوق', 25, 'LYD',
             'https://cdn.test/a.jpg', 'https://shop.test/a', 'تجريبي', 'available', 1),
            (202, 2, 'B-202', 'منتج باء', 'خاص بعميل آخر', 50, 'LYD',
             NULL, NULL, 'آخر', 'available', 1);
        INSERT INTO bot_product_images (
            tenant_id, product_id, image_url, alt_text, sort_order, is_primary
        ) VALUES (1, 101, 'https://cdn.test/primary.jpg', 'Primary', 0, 1);
    `);
    return database;
};

const findHandlers = (router, method, routePath) => {
    const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.map(item => item.handle);
};

const invoke = (router, method, routePath, request = {}) => new Promise((resolve, reject) => {
    const req = {
        user: { id: 1, tenant_id: 1, role: 'tenant' },
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

const collectEndpoints = router => {
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
};

test('Content Studio facade composes settings, shared products, library and AI routes', () => {
    const database = createDatabase();
    const router = createFacebookContentStudioRouter({
        database,
        settings: { aiConfigured: () => true },
        ai: {
            generate: async () => ({ variants: [], model: 'test', usage: {}, prompt_version: 'test' }),
            billing: { reserve: () => ({}), commit: () => ({}), release: () => ({}) },
        },
    });
    assert.deepEqual(collectEndpoints(router), [
        'DELETE /items/:id',
        'DELETE /settings/pages/:linkedPageId',
        'GET /ai/history',
        'GET /items',
        'GET /products',
        'GET /readiness',
        'GET /settings',
        'PATCH /items/:id',
        'POST /ai/generate',
        'POST /items',
        'POST /items/:id/approve',
        'POST /items/from-product/:productId',
        'PUT /settings',
    ]);
    database.close();
});

test('content settings support tenant defaults and page-specific overrides', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const router = createFacebookContentSettingsRouter({
        database,
        aiConfigured: () => true,
        aiModel: 'test-model',
    });

    const defaults = await invoke(router, 'get', '/settings');
    assert.equal(defaults.body.settings.timezone, 'Africa/Tripoli');
    assert.equal(defaults.body.settings.approval_mode, 'manual');

    const saved = await invoke(router, 'put', '/settings', {
        body: {
            tone: 'ودود وواضح',
            brand_voice: 'ليبية، مباشرة، بلا مبالغة',
            banned_terms: ['الأفضل مطلقاً'],
            hashtags: ['سافانا'],
            allowed_days: [0, 2, 4],
            approval_mode: 'approved_only',
        },
    });
    assert.equal(saved.body.settings.tone, 'ودود وواضح');
    assert.deepEqual(saved.body.settings.allowed_days, [0, 2, 4]);

    const pageSaved = await invoke(router, 'put', '/settings', {
        body: {
            linked_page_id: 11,
            tone: 'تعليمي',
            approval_mode: 'automatic',
        },
    });
    assert.equal(pageSaved.body.is_page_override, true);
    assert.equal(pageSaved.body.settings.tone, 'تعليمي');
    assert.equal(pageSaved.body.settings.brand_voice, 'ليبية، مباشرة، بلا مبالغة');

    const pageSettings = await invoke(router, 'get', '/settings', {
        query: { linked_page_id: '11' },
    });
    assert.equal(pageSettings.body.is_page_override, true);
    assert.equal(pageSettings.body.settings.approval_mode, 'automatic');

    const crossTenantPage = await invoke(router, 'put', '/settings', {
        body: { linked_page_id: 22, tone: 'غير مسموح' },
    });
    assert.equal(crossTenantPage.statusCode, 404);

    const readiness = await invoke(router, 'get', '/readiness');
    assert.equal(readiness.body.linked_pages, 1);
    assert.equal(readiness.body.products, 1);
    assert.deepEqual(readiness.body.ai, { configured: true, model: 'test-model' });
});

test('shared products create reusable Facebook content without crossing tenants', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const router = createFacebookContentLibraryRouter({ database });

    const products = await invoke(router, 'get', '/products');
    assert.equal(products.body.total, 1);
    assert.equal(products.body.products[0].id, 101);
    assert.equal(products.body.products[0].image_url, 'https://cdn.test/primary.jpg');

    const created = await invoke(router, 'post', '/items/from-product/:productId', {
        params: { productId: '101' },
        body: {
            linked_page_id: 11,
            template: '{name}\n{description}\nالسعر: {price} {currency}\n{url}',
            tags: ['منتج', 'عرض'],
        },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.kind, 'product');
    assert.match(created.body.body, /منتج ألف/);
    assert.match(created.body.body, /25/);
    assert.equal(created.body.media_url, 'https://cdn.test/primary.jpg');

    const approved = await invoke(router, 'post', '/items/:id/approve', {
        params: { id: String(created.body.id) },
    });
    assert.equal(approved.body.status, 'approved');

    const edited = await invoke(router, 'patch', '/items/:id', {
        params: { id: String(created.body.id) },
        body: { body: 'صياغة جديدة' },
    });
    assert.equal(edited.body.status, 'draft');
    assert.equal(edited.body.approved_at, null);

    const crossProduct = await invoke(router, 'post', '/items/from-product/:productId', {
        params: { productId: '202' },
        body: {},
    });
    assert.equal(crossProduct.statusCode, 404);

    const items = await invoke(router, 'get', '/items');
    assert.equal(items.body.total, 1);
    assert.equal(items.body.items[0].product_name, 'منتج ألف');

    const archived = await invoke(router, 'delete', '/items/:id', {
        params: { id: String(created.body.id) },
    });
    assert.equal(archived.body.success, true);
});

test('AI service sends a Responses API structured-output request and enforces banned terms', async () => {
    let captured;
    const fetchImpl = async (url, init) => {
        captured = { url, init, body: JSON.parse(init.body) };
        return new Response(JSON.stringify({
            id: 'resp_test',
            model: 'gpt-5.6-luna',
            output: [{
                type: 'message',
                content: [{
                    type: 'output_text',
                    text: JSON.stringify({
                        variants: [{
                            title: 'عنوان طبيعي',
                            body: 'نص واضح عن المنتج',
                            hashtags: ['منتج'],
                            cta: 'تواصل معنا',
                        }],
                    }),
                }],
            }],
            usage: { input_tokens: 120, output_tokens: 40 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const result = await requestFacebookContent({
        action: 'generate',
        inputText: 'اكتب منشوراً',
        settings: { language: 'ar', banned_terms: [] },
        fetchImpl,
        apiKey: 'test-key',
        model: 'gpt-5.6-luna',
        baseUrl: 'https://api.openai.test/v1/',
    });
    assert.equal(captured.url, 'https://api.openai.test/v1/responses');
    assert.equal(captured.init.headers.Authorization, 'Bearer test-key');
    assert.equal(captured.body.text.format.type, 'json_schema');
    assert.equal(captured.body.text.format.strict, true);
    assert.equal(result.variants[0].title, 'عنوان طبيعي');
    assert.deepEqual(result.usage, { input_tokens: 120, output_tokens: 40 });

    await assert.rejects(
        () => requestFacebookContent({
            action: 'generate',
            inputText: 'اكتب منشوراً',
            settings: { banned_terms: ['واضح'] },
            fetchImpl,
            apiKey: 'test-key',
        }),
        error => error.code === 'AI_POLICY_VIOLATION',
    );
});

test('AI prompt keeps product facts explicit and response parsing handles refusals', () => {
    const prompt = buildFacebookContentPrompt({
        action: 'rewrite',
        inputText: 'نص قديم',
        product: { name: 'منتج', price: 12, currency: 'LYD' },
        settings: { language: 'ar', tone: 'ودود' },
        variants: 2,
    });
    assert.match(prompt.instructions, /لا تخترع أسعاراً/);
    assert.match(prompt.input, /"price":12/);
    assert.throws(
        () => extractStructuredFacebookContent({
            output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'غير مسموح' }] }],
        }),
        error => error.code === 'AI_REFUSAL' && error.refused === true,
    );
});

test('AI route records generation, billing and optionally creates review items', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const billingEvents = [];
    const router = createFacebookContentAiRouter({
        database,
        generate: async () => ({
            variants: [{
                title: 'عنوان مولد',
                body: 'محتوى مولد',
                hashtags: ['سافانا'],
                cta: 'اكتب لنا',
            }],
            model: 'test-model',
            usage: { input_tokens: 20, output_tokens: 10 },
            prompt_version: 'test-v1',
        }),
        billing: {
            reserve: options => {
                billingEvents.push(['reserve', options]);
                return { id: 77 };
            },
            commit: (reservation, options) => billingEvents.push(['commit', reservation, options]),
            release: (reservation, message) => billingEvents.push(['release', reservation, message]),
        },
    });

    const generated = await invoke(router, 'post', '/ai/generate', {
        body: {
            linked_page_id: 11,
            product_id: 101,
            action: 'variants',
            variants: 3,
            create_items: true,
        },
    });
    assert.equal(generated.statusCode, 200);
    assert.equal(generated.body.variants[0].title, 'عنوان مولد');
    assert.equal(generated.body.created_item_ids.length, 1);
    assert.equal(billingEvents[0][0], 'reserve');
    assert.equal(billingEvents[1][0], 'commit');
    assert.equal(database.prepare(`
        SELECT status, model, input_tokens, output_tokens
        FROM facebook_content_ai_generations
        WHERE id = ?
    `).get(generated.body.generation_id).status, 'completed');
    const item = database.prepare(`
        SELECT kind, status, body FROM facebook_content_items WHERE id = ?
    `).get(generated.body.created_item_ids[0]);
    assert.equal(item.kind, 'ai');
    assert.equal(item.status, 'review');
    assert.match(item.body, /#سافانا/);
});
