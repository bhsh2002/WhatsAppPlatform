import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { runMigrationsSync } from '../db/migrator.js';
import { createFacebookContentAiRouter } from '../routes/facebookContentAi.js';
import { createFacebookContentCampaignsRouter } from '../routes/facebookContentCampaigns.js';
import { createFacebookContentLibraryRouter } from '../routes/facebookContentLibrary.js';
import { createFacebookContentPublicationsRouter } from '../routes/facebookContentPublications.js';
import { createFacebookContentSettingsRouter } from '../routes/facebookContentSettings.js';
import { createFacebookContentStudioRouter } from '../routes/facebookContentStudio.js';
import {
    buildFacebookContentPrompt,
    extractStructuredFacebookContent,
    extractStructuredGeminiContent,
    requestGeminiFacebookContent,
    requestFacebookContent,
    requestOpenAiFacebookContent,
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
        'DELETE /campaigns/:id',
        'DELETE /items/:id',
        'DELETE /publications/:id',
        'DELETE /settings/pages/:linkedPageId',
        'GET /ai/history',
        'GET /campaigns',
        'GET /items',
        'GET /products',
        'GET /publications',
        'GET /readiness',
        'GET /settings',
        'PATCH /campaigns/:id',
        'PATCH /items/:id',
        'POST /ai/generate',
        'POST /campaigns',
        'POST /campaigns/:id/run-now',
        'POST /campaigns/:id/toggle',
        'POST /items',
        'POST /items/:id/approve',
        'POST /items/from-product/:productId',
        'POST /publications',
        'POST /publications/:id/publish-now',
        'POST /publications/:id/retry',
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
    assert.deepEqual(readiness.body.ai, { configured: true });
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

test('OpenAI adapter sends a Responses API structured-output request and enforces banned terms', async () => {
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
    const result = await requestOpenAiFacebookContent({
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
        () => requestOpenAiFacebookContent({
            action: 'generate',
            inputText: 'اكتب منشوراً',
            settings: { banned_terms: ['واضح'] },
            fetchImpl,
            apiKey: 'test-key',
        }),
        error => error.code === 'AI_POLICY_VIOLATION',
    );
});

test('Gemini adapter uses native structured output without exposing its key', async () => {
    let captured;
    const fetchImpl = async (url, init) => {
        captured = { url, init, body: JSON.parse(init.body) };
        return new Response(JSON.stringify({
            candidates: [{
                finishReason: 'STOP',
                content: {
                    parts: [{
                        text: JSON.stringify({
                            variants: [{
                                title: 'عنوان عربي',
                                body: 'محتوى طبيعي',
                                hashtags: ['سافانا'],
                                cta: 'تواصل معنا',
                            }],
                        }),
                    }],
                },
            }],
            usageMetadata: {
                promptTokenCount: 90,
                candidatesTokenCount: 30,
                thoughtsTokenCount: 10,
            },
            modelVersion: 'gemini-test',
            responseId: 'gemini-response',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const result = await requestGeminiFacebookContent({
        action: 'generate',
        inputText: 'اكتب منشوراً',
        settings: { language: 'ar', banned_terms: [] },
        fetchImpl,
        apiKey: 'gemini-secret',
        model: 'gemini-test',
        baseUrl: 'https://gemini.test/v1beta/',
    });
    assert.equal(
        captured.url,
        'https://gemini.test/v1beta/models/gemini-test:generateContent',
    );
    assert.equal(captured.init.headers['x-goog-api-key'], 'gemini-secret');
    assert.equal(captured.init.headers.Authorization, undefined);
    assert.equal(captured.body.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(
        captured.body.generationConfig.responseJsonSchema.required,
        ['variants'],
    );
    assert.equal(
        captured.body.generationConfig.responseJsonSchema
            .properties.variants.items.properties.title.maxLength,
        undefined,
    );
    assert.equal(captured.body.generationConfig.thinkingConfig.thinkingLevel, 'low');
    assert.equal(result.variants[0].title, 'عنوان عربي');
    assert.deepEqual(result.usage, { input_tokens: 90, output_tokens: 40 });
    assert.equal(result.model, 'gemini-test');

    assert.throws(
        () => extractStructuredGeminiContent({
            candidates: [{ finishReason: 'SAFETY', finishMessage: 'blocked' }],
        }),
        error => error.code === 'AI_REQUEST_REFUSED' && error.refused === true,
    );
});

test('AI provider orchestration falls back on provider failure but not on refusal', async () => {
    const calls = [];
    const logEvents = [];
    const providerConfig = {
        gemini: { apiKey: 'gemini-key' },
        openai: { apiKey: 'openai-key' },
    };
    const result = await requestFacebookContent({
        action: 'generate',
        inputText: 'فكرة',
        settings: {},
        primaryProvider: 'gemini',
        fallbackProvider: 'openai',
        providerConfig,
        providerRequests: {
            gemini: async () => {
                calls.push('gemini');
                const error = new Error('quota from upstream');
                error.status = 429;
                error.code = 'RESOURCE_EXHAUSTED';
                throw error;
            },
            openai: async () => {
                calls.push('openai');
                return {
                    variants: [{ title: 'بديل', body: 'محتوى', hashtags: [], cta: '' }],
                    model: 'internal-model',
                    usage: { input_tokens: 1, output_tokens: 1 },
                    prompt_version: 'test',
                };
            },
        },
        logger: {
            warn: (...args) => logEvents.push(args),
            error: (...args) => logEvents.push(args),
        },
    });
    assert.deepEqual(calls, ['gemini', 'openai']);
    assert.equal(result.provider, 'openai');
    assert.equal(result.fallback_used, true);
    assert.equal(logEvents.length, 1);
    assert.equal(logEvents[0][1].provider, 'gemini');
    assert.equal(logEvents[0][1].next_provider, 'openai');

    calls.length = 0;
    await assert.rejects(
        () => requestFacebookContent({
            action: 'generate',
            inputText: 'فكرة',
            settings: {},
            primaryProvider: 'gemini',
            fallbackProvider: 'openai',
            providerConfig,
            providerRequests: {
                gemini: async () => {
                    calls.push('gemini');
                    const error = new Error('رفض داخلي');
                    error.code = 'AI_REQUEST_REFUSED';
                    error.status = 422;
                    error.refused = true;
                    throw error;
                },
                openai: async () => {
                    calls.push('openai');
                    return {};
                },
            },
            logger: { warn() {}, error() {} },
        }),
        error => error.code === 'AI_REQUEST_REFUSED',
    );
    assert.deepEqual(calls, ['gemini']);
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
        error => error.code === 'AI_REQUEST_REFUSED' && error.refused === true,
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
    assert.equal('model' in generated.body, false);
    assert.equal('provider' in generated.body, false);
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

    const history = await invoke(router, 'get', '/ai/history');
    assert.equal('model' in history.body[0], false);
});

test('AI route replaces upstream provider errors with a neutral client message', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const router = createFacebookContentAiRouter({
        database,
        generate: async () => {
            const error = new Error('OpenAI quota: https://provider.example/billing');
            error.status = 429;
            error.code = 'AI_CAPACITY_EXCEEDED';
            error.providerFailure = true;
            throw error;
        },
        billing: {
            reserve: () => ({ id: 88 }),
            commit: () => {},
            release: () => {},
        },
    });
    const response = await invoke(router, 'post', '/ai/generate', {
        body: {
            linked_page_id: 11,
            input_text: 'اكتب منشوراً',
            action: 'generate',
        },
    });
    assert.equal(response.statusCode, 429);
    assert.equal(response.body.code, 'AI_CAPACITY_EXCEEDED');
    assert.doesNotMatch(response.body.error, /openai|gemini|https?:/i);
    const row = database.prepare(`
        SELECT error_code, error_message
        FROM facebook_content_ai_generations
        ORDER BY id DESC LIMIT 1
    `).get();
    assert.equal(row.error_code, 'AI_CAPACITY_EXCEEDED');
    assert.doesNotMatch(row.error_message, /openai|gemini|https?:/i);
});

test('campaign and publication APIs preserve approval, page and tenant boundaries', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    database.prepare(`
        INSERT INTO facebook_content_items (
            id, tenant_id, linked_page_id, kind, title, body, status, created_by
        ) VALUES (301, 1, 11, 'manual', 'محتوى معتمد', 'نص جاهز للنشر', 'approved', 1)
    `).run();
    const campaigns = createFacebookContentCampaignsRouter({ database });
    const publications = createFacebookContentPublicationsRouter({ database });

    const createdCampaign = await invoke(campaigns, 'post', '/campaigns', {
        body: {
            linked_page_id: 11,
            name: 'حملة صباحية',
            source_mode: 'mixed',
            rotation_mode: 'sequential',
            allowed_days: [0, 1, 2, 3, 4, 5, 6],
            schedule_times: ['09:00', '18:00'],
            content_item_ids: [301],
            status: 'active',
        },
    });
    assert.equal(createdCampaign.statusCode, 201);
    assert.equal(createdCampaign.body.status, 'active');
    assert.deepEqual(createdCampaign.body.content_item_ids, [301]);
    assert.ok(createdCampaign.body.next_run_at);

    const runNow = await invoke(campaigns, 'post', '/campaigns/:id/run-now', {
        params: { id: String(createdCampaign.body.id) },
    });
    assert.equal(runNow.statusCode, 201);
    assert.equal(runNow.body.content_item_id, 301);

    const manual = await invoke(publications, 'post', '/publications', {
        body: {
            linked_page_id: 11,
            content_item_id: 301,
            scheduled_for: '2026-07-20T10:00:00.000Z',
        },
    });
    assert.equal(manual.statusCode, 201);
    assert.equal(manual.body.status, 'pending');

    database.prepare(`
        INSERT INTO facebook_content_items (
            id, tenant_id, linked_page_id, kind, title, body, status, created_by
        ) VALUES (302, 1, 11, 'manual', 'مسودة', 'غير معتمدة', 'draft', 1)
    `).run();
    const unapproved = await invoke(publications, 'post', '/publications', {
        body: { linked_page_id: 11, content_item_id: 302 },
    });
    assert.equal(unapproved.statusCode, 409);
    assert.equal(unapproved.body.code, 'CONTENT_APPROVAL_REQUIRED');

    const list = await invoke(publications, 'get', '/publications');
    assert.equal(list.body.total, 2);
    assert.equal(list.body.summary.pending, 2);

    const crossTenant = await invoke(campaigns, 'post', '/campaigns', {
        body: { linked_page_id: 22, name: 'مرفوضة' },
    });
    assert.equal(crossTenant.statusCode, 404);
});

test('settings, library and AI routes cover overrides, filters and recoverable failures', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const settings = createFacebookContentSettingsRouter({ database });
    const library = createFacebookContentLibraryRouter({ database });
    const billingEvents = [];
    const ai = createFacebookContentAiRouter({
        database,
        generate: async () => {
            throw Object.assign(new Error('provider unavailable'), {
                code: 'AI_SERVICE_UNAVAILABLE',
                status: 502,
                providerFailure: true,
            });
        },
        billing: {
            reserve: () => ({ id: 9 }),
            commit: () => assert.fail('failed generations cannot commit'),
            release: (reservation, message) => billingEvents.push([reservation.id, message]),
        },
    });

    await invoke(settings, 'put', '/settings', {
        body: {
            linked_page_id: 11,
            tone: 'أول',
            allowed_days: [1, 2],
        },
    });
    const updated = await invoke(settings, 'put', '/settings', {
        body: {
            linked_page_id: 11,
            tone: 'محدث',
            ai_enabled: false,
            allowed_days: [2, 3],
        },
    });
    assert.equal(updated.body.settings.tone, 'محدث');
    assert.equal(updated.body.settings.ai_enabled, false);

    const disabled = await invoke(ai, 'post', '/ai/generate', {
        body: { linked_page_id: 11, input_text: 'فكرة' },
    });
    assert.equal(disabled.statusCode, 403);
    assert.equal(disabled.body.code, 'AI_DISABLED');

    const reset = await invoke(settings, 'delete', '/settings/pages/:linkedPageId', {
        params: { linkedPageId: '11' },
    });
    assert.equal(reset.body.success, true);
    assert.equal(reset.body.settings.linked_page_id, 11);

    const missingInput = await invoke(ai, 'post', '/ai/generate', { body: {} });
    assert.equal(missingInput.statusCode, 400);
    assert.equal(missingInput.body.code, 'AI_INPUT_REQUIRED');

    const failed = await invoke(ai, 'post', '/ai/generate', {
        body: { input_text: 'اكتب نصاً', variants: 2 },
    });
    assert.equal(failed.statusCode, 502);
    assert.deepEqual(billingEvents, [[9, 'خدمة مساعد الكتابة غير متاحة حالياً. حاول مرة أخرى لاحقاً.']]);
    const history = await invoke(ai, 'get', '/ai/history', { query: { limit: '5' } });
    assert.equal(history.body.length, 1);
    assert.equal(history.body[0].status, 'failed');
    assert.equal(history.body[0].error_code, 'AI_SERVICE_UNAVAILABLE');

    const created = await invoke(library, 'post', '/items', {
        body: {
            title: 'محتوى يدوي',
            body: 'نص طويل قابل للمراجعة',
            kind: 'manual',
            status: 'review',
            tags: ['تجربة'],
        },
    });
    assert.equal(created.statusCode, 201);
    const filteredItems = await invoke(library, 'get', '/items', {
        query: {
            status: 'review',
            kind: 'manual',
            linked_page_id: '11',
            search: 'طويل',
        },
    });
    assert.equal(filteredItems.body.total, 1);
    const filteredProducts = await invoke(library, 'get', '/products', {
        query: {
            search: 'ألف',
            category: 'تجريبي',
            available: 'false',
        },
    });
    assert.equal(filteredProducts.body.total, 1);

    const invalidStatus = await invoke(library, 'get', '/items', {
        query: { status: 'invalid' },
    });
    assert.equal(invalidStatus.statusCode, 400);
    const missingItem = await invoke(library, 'post', '/items/:id/approve', {
        params: { id: '9999' },
    });
    assert.equal(missingItem.statusCode, 404);
});

test('campaign and publication lifecycle supports filters, edits and recovery actions', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    database.exec(`
        INSERT INTO facebook_content_items (
            id, tenant_id, linked_page_id, kind, title, body, status, created_by
        ) VALUES (401, 1, 11, 'manual', 'جاهز', 'منشور دورة الحياة', 'approved', 1);
    `);
    const campaigns = createFacebookContentCampaignsRouter({ database });
    const publications = createFacebookContentPublicationsRouter({ database });

    const created = await invoke(campaigns, 'post', '/campaigns', {
        body: {
            linked_page_id: 11,
            name: 'دورة حياة',
            source_mode: 'library',
            rotation_mode: 'random',
            content_item_ids: [401],
            allowed_days: [0, 1, 2, 3, 4, 5, 6],
            schedule_times: ['08:30'],
            status: 'draft',
        },
    });
    assert.equal(created.statusCode, 201);

    const listing = await invoke(campaigns, 'get', '/campaigns', {
        query: { status: 'draft', linked_page_id: '11' },
    });
    assert.equal(listing.body.total, 1);
    const invalidListing = await invoke(campaigns, 'get', '/campaigns', {
        query: { status: 'invalid' },
    });
    assert.equal(invalidListing.statusCode, 400);

    const edited = await invoke(campaigns, 'patch', '/campaigns/:id', {
        params: { id: String(created.body.id) },
        body: {
            name: 'دورة حياة محدثة',
            status: 'paused',
            rotation_mode: 'sequential',
            content_item_ids: [401],
        },
    });
    assert.equal(edited.body.name, 'دورة حياة محدثة');
    assert.equal(edited.body.status, 'paused');
    const activated = await invoke(campaigns, 'post', '/campaigns/:id/toggle', {
        params: { id: String(created.body.id) },
    });
    assert.equal(activated.body.status, 'active');
    const paused = await invoke(campaigns, 'post', '/campaigns/:id/toggle', {
        params: { id: String(created.body.id) },
    });
    assert.equal(paused.body.status, 'paused');

    const invalidTimezone = await invoke(campaigns, 'patch', '/campaigns/:id', {
        params: { id: String(created.body.id) },
        body: { timezone: 'Invalid/Zone' },
    });
    assert.equal(invalidTimezone.statusCode, 400);

    const productPublication = await invoke(publications, 'post', '/publications', {
        body: {
            linked_page_id: 11,
            product_id: 101,
            message_override: 'نص منتج مخصص',
        },
    });
    assert.equal(productPublication.statusCode, 201);
    const publishNow = await invoke(publications, 'post', '/publications/:id/publish-now', {
        params: { id: String(productPublication.body.id) },
    });
    assert.equal(publishNow.body.status, 'pending');
    const cancelled = await invoke(publications, 'delete', '/publications/:id', {
        params: { id: String(productPublication.body.id) },
    });
    assert.equal(cancelled.body.success, true);
    const cancelAgain = await invoke(publications, 'delete', '/publications/:id', {
        params: { id: String(productPublication.body.id) },
    });
    assert.equal(cancelAgain.statusCode, 409);

    const failedPublication = database.prepare(`
        INSERT INTO facebook_content_publications (
            tenant_id, linked_page_id, content_item_id, status, scheduled_for,
            next_attempt_at, idempotency_key, rendered_message, error_message
        ) VALUES (1, 11, 401, 'failed', datetime('now'), datetime('now'),
                  'failed-lifecycle', 'فشل سابق', 'مؤقت')
    `).run();
    const retried = await invoke(publications, 'post', '/publications/:id/retry', {
        params: { id: String(failedPublication.lastInsertRowid) },
    });
    assert.equal(retried.body.status, 'pending');
    const retryAgain = await invoke(publications, 'post', '/publications/:id/retry', {
        params: { id: String(failedPublication.lastInsertRowid) },
    });
    assert.equal(retryAgain.statusCode, 409);

    const filtered = await invoke(publications, 'get', '/publications', {
        query: {
            status: 'pending',
            linked_page_id: '11',
            start: '2026-01-01T00:00:00.000Z',
            end: '2030-01-01T00:00:00.000Z',
        },
    });
    assert.equal(filtered.body.total, 1);
    const invalidDate = await invoke(publications, 'get', '/publications', {
        query: { start: 'not-a-date' },
    });
    assert.equal(invalidDate.statusCode, 400);
    const missingSource = await invoke(publications, 'post', '/publications', {
        body: { linked_page_id: 11 },
    });
    assert.equal(missingSource.statusCode, 400);

    const completed = await invoke(campaigns, 'delete', '/campaigns/:id', {
        params: { id: String(created.body.id) },
    });
    assert.equal(completed.body.success, true);
    const missingCampaign = await invoke(campaigns, 'delete', '/campaigns/:id', {
        params: { id: '9999' },
    });
    assert.equal(missingCampaign.statusCode, 404);
});
