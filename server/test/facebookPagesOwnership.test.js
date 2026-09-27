import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import db from '../db/database.js';
import router from '../routes/facebookPages.js';
import { decrypt, encrypt, initEncryption } from '../services/encryption.js';

before(() => {
    process.env.CRYPTO_KEY = 'a'.repeat(64);
    initEncryption();
});
after(() => db.close());

const findRouteHandlers = (method, routePath) => {
    const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack.map(item => item.handle);
};

const invokeRoute = (method, routePath, request = {}) => new Promise((resolve, reject) => {
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
    const handlers = findRouteHandlers(method, routePath);
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

test('admin page linking rejects a page owned by another tenant without disclosing its owner', async () => {
    db.exec(`
        DELETE FROM tenant_pages;
        DELETE FROM tenants;
        INSERT INTO tenants (id, name) VALUES
            (901, 'Private owner'),
            (902, 'Requesting tenant');
        INSERT INTO tenant_pages (tenant_id, page_id, page_name)
        VALUES (901, 'globally-owned-page', 'Secret page');
    `);

    const response = await invokeRoute('post', '/tenant/:tenantId', {
        params: { tenantId: '902' },
        body: {
            page_id: 'globally-owned-page',
            page_access_token: 'token-that-must-not-be-used',
        },
    });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.body, { error: 'هذه الصفحة غير متاحة للربط' });
    assert.doesNotMatch(JSON.stringify(response.body), /Private owner|901|Secret page/);
    assert.deepEqual(
        db.prepare('SELECT tenant_id, page_name FROM tenant_pages WHERE page_id = ?')
            .get('globally-owned-page'),
        { tenant_id: 901, page_name: 'Secret page' }
    );

    db.prepare('UPDATE tenant_pages SET is_active = 0 WHERE page_id = ?').run('globally-owned-page');
    const inactiveResponse = await invokeRoute('post', '/tenant/:tenantId', {
        params: { tenantId: '902' },
        body: {
            page_id: 'globally-owned-page',
            page_access_token: 'token-that-must-not-be-used',
        },
    });
    assert.equal(inactiveResponse.statusCode, 409);
    assert.deepEqual(inactiveResponse.body, { error: 'هذه الصفحة غير متاحة للربط' });
});

test('admin disconnect preserves Messenger and Content Studio records and reactivation keeps the same page id', async (t) => {
    db.exec(`
        INSERT INTO tenants (id, name) VALUES (903, 'Tenant with history');
        INSERT INTO tenant_pages (
            id, tenant_id, page_id, page_name, page_access_token_encrypted,
            is_active, webhook_subscribed, token_status
        ) VALUES (903, 903, 'page-with-history', 'Old name', NULL, 1, 1, 'valid');
        INSERT INTO fb_conversations (id, tenant_id, linked_page_id, page_id, user_psid)
        VALUES (903, 903, 903, 'page-with-history', 'visitor-903');
        INSERT INTO fb_messages (id, conversation_id, tenant_id, direction, message_text)
        VALUES (903, 903, 903, 'incoming', 'Historical message');
        INSERT INTO facebook_content_items (id, tenant_id, linked_page_id, title, body)
        VALUES (903, 903, 903, 'Historical item', 'Historical content');
        INSERT INTO facebook_content_campaigns (id, tenant_id, linked_page_id, name, status)
        VALUES (903, 903, 903, 'Historical campaign', 'active');
        INSERT INTO facebook_content_publications (
            id, tenant_id, linked_page_id, campaign_id, content_item_id,
            scheduled_for, idempotency_key, status
        ) VALUES (
            903, 903, 903, 903, 903,
            '2026-09-28T09:00:00.000Z', 'admin-unlink-preserve-903', 'pending'
        );
    `);
    db.prepare('UPDATE tenant_pages SET page_access_token_encrypted = ? WHERE id = ?')
        .run(encrypt('old-page-token'), 903);

    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (init.method === 'DELETE') {
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        if (init.method === 'POST') {
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        return new Response(JSON.stringify({
            id: 'page-with-history',
            name: 'Updated name',
            category: 'Services',
        }), { status: 200 });
    };
    t.after(() => { globalThis.fetch = originalFetch; });

    const disconnected = await invokeRoute('delete', '/:id', { params: { id: '903' } });
    assert.equal(disconnected.statusCode, 200);
    assert.equal(disconnected.body.success, true);
    assert.equal(disconnected.body.data_preserved, true);
    assert.equal(disconnected.body.paused_campaigns, 1);
    assert.equal(disconnected.body.cancelled_publications, 1);
    assert.match(calls[0].url, /\/page-with-history\/subscribed_apps$/);
    assert.doesNotMatch(calls[0].url, /access_token/);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer old-page-token');

    const inactive = db.prepare(`
        SELECT is_active, webhook_subscribed, page_access_token_encrypted,
               token_status, subscribed_fields
        FROM tenant_pages WHERE id = 903
    `).get();
    assert.deepEqual(inactive, {
        is_active: 0,
        webhook_subscribed: 0,
        page_access_token_encrypted: null,
        token_status: 'unchecked',
        subscribed_fields: '[]',
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM fb_messages WHERE id = 903').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM facebook_content_items WHERE id = 903').get().count, 1);
    assert.equal(db.prepare('SELECT status FROM facebook_content_campaigns WHERE id = 903').get().status, 'paused');
    assert.equal(db.prepare('SELECT status FROM facebook_content_publications WHERE id = 903').get().status, 'cancelled');
    const inactiveList = await invokeRoute('get', '/tenant/:tenantId', { params: { tenantId: '903' } });
    assert.equal(inactiveList.body[0].page_access_token_present, 0);
    assert.equal(Object.hasOwn(inactiveList.body[0], 'page_access_token_encrypted'), false);
    const invalidActivation = await invokeRoute('put', '/:id', {
        params: { id: '903' },
        body: { is_active: true },
    });
    assert.equal(invalidActivation.statusCode, 409);
    assert.equal(db.prepare('SELECT is_active FROM tenant_pages WHERE id = 903').get().is_active, 0);

    const reactivated = await invokeRoute('post', '/tenant/:tenantId', {
        params: { tenantId: '903' },
        body: { page_id: 'page-with-history', page_access_token: 'new-page-token' },
    });
    assert.equal(reactivated.statusCode, 200);
    assert.equal(reactivated.body.id, 903);
    assert.equal(reactivated.body.page_name, 'Updated name');
    assert.equal(reactivated.body.is_active, 1);
    assert.equal(reactivated.body._webhook_subscribed, true);
    assert.equal(
        decrypt(db.prepare('SELECT page_access_token_encrypted FROM tenant_pages WHERE id = 903').get().page_access_token_encrypted),
        'new-page-token'
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM fb_messages WHERE id = 903').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM facebook_content_items WHERE id = 903').get().count, 1);
    assert.equal(db.prepare('SELECT status FROM facebook_content_campaigns WHERE id = 903').get().status, 'paused');
    assert.equal(db.prepare('SELECT status FROM facebook_content_publications WHERE id = 903').get().status, 'cancelled');
    const activeList = await invokeRoute('get', '/tenant/:tenantId', { params: { tenantId: '903' } });
    assert.equal(activeList.body[0].page_access_token_present, 1);
});

test('admin disconnect reports partial success if Meta rejects unsubscribe, while clearing local credentials', async (t) => {
    db.exec(`
        INSERT INTO tenants (id, name) VALUES (904, 'Tenant with Meta failure');
        INSERT INTO tenant_pages (id, tenant_id, page_id, page_name, is_active, webhook_subscribed)
        VALUES (904, 904, 'page-meta-failure', 'Page', 1, 1);
    `);
    db.prepare('UPDATE tenant_pages SET page_access_token_encrypted = ? WHERE id = ?')
        .run(encrypt('failing-page-token'), 904);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
        error: { message: 'Token expired', code: 190 },
    }), { status: 400 });
    t.after(() => { globalThis.fetch = originalFetch; });

    const response = await invokeRoute('delete', '/:id', { params: { id: '904' } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, false);
    assert.equal(response.body.partial_success, true);
    assert.equal(response.body.local_disconnected, true);
    assert.equal(response.body.webhook_unsubscribed, false);
    assert.equal(response.body.data_preserved, true);
    assert.equal(response.body.webhook_error, 'تعذر إلغاء اشتراك Webhook لدى Meta');
    assert.deepEqual(
        db.prepare('SELECT is_active, page_access_token_encrypted FROM tenant_pages WHERE id = 904').get(),
        { is_active: 0, page_access_token_encrypted: null }
    );
    const invalidToken = await invokeRoute('put', '/:id', {
        params: { id: '904' },
        body: { is_active: true, page_access_token: '  ' },
    });
    assert.equal(invalidToken.statusCode, 400);
    const reactivatedWithToken = await invokeRoute('put', '/:id', {
        params: { id: '904' },
        body: { is_active: true, page_access_token: 'new-token-904' },
    });
    assert.equal(reactivatedWithToken.statusCode, 200);
    assert.equal(reactivatedWithToken.body.is_active, 1);
    assert.equal(reactivatedWithToken.body.webhook_subscribed, 0);
    assert.equal(
        decrypt(db.prepare('SELECT page_access_token_encrypted FROM tenant_pages WHERE id = 904').get().page_access_token_encrypted),
        'new-token-904'
    );
});
