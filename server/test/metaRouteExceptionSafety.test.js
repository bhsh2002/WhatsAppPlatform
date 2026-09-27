import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createTenantFacebookMessagingRouter } from '../routes/tenantFacebookMessaging.js';

const invokeRoute = (router, method, routePath, request) => new Promise((resolve, reject) => {
    const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
    const res = {
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            resolve(this);
            return this;
        },
    };
    Promise.resolve(layer.route.stack[0].handle(request, res)).catch(reject);
});

const createTestRouter = ({ requestMeta, releases = [] }) => createTenantFacebookMessagingRouter({
    database: {
        prepare(sql) {
            if (sql.includes('FROM tenant_pages')) {
                return { get: () => ({
                    id: 1,
                    tenant_id: 1,
                    page_id: 'page-1',
                    page_name: 'Test page',
                    page_access_token_encrypted: 'encrypted',
                    webhook_subscribed: 1,
                }) };
            }
            if (sql.includes('FROM fb_conversations')) {
                return { get: () => ({
                    id: 2,
                    tenant_id: 1,
                    linked_page_id: 1,
                    page_id: 'page-1',
                    user_psid: 'psid-1',
                }) };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        },
    },
    decryptToken: () => 'private-page-token',
    requestMeta,
    billing: {
        operations: { MESSENGER_UTILITY: 'messenger.utility' },
        reserve: () => ({ id: 1 }),
        release: (_reservation, reason) => releases.push(reason),
        handleError: () => false,
    },
});

test('tenant Meta routes do not expose a token-bearing fetch exception in response, logs or billing', async (t) => {
    const secret = 'private-token-in-upstream-url';
    const url = `https://graph.facebook.com/v23.0/page-1?access_token=${secret}`;
    const logs = [];
    t.mock.method(console, 'error', (...args) => logs.push(args));
    const releases = [];
    const router = createTestRouter({
        requestMeta: async () => { throw new TypeError(`fetch failed: ${url}`); },
        releases,
    });

    const subscription = await invokeRoute(router, 'get', '/pages/:id/subscription-status', {
        user: { tenant_id: 1 }, params: { id: '1' }, body: {}, query: {},
    });
    assert.equal(subscription.statusCode, 500);
    assert.deepEqual(subscription.body, { error: 'فشل جلب حالة الاشتراك' });

    const utility = await invokeRoute(router, 'post', '/fb-messenger/:linkedPageId/conversations/:convId/utility-message', {
        user: { tenant_id: 1 },
        params: { linkedPageId: '1', convId: '2' },
        body: { message: 'Hello', tag: 'HUMAN_AGENT' },
        query: {},
    });
    assert.equal(utility.statusCode, 500);
    assert.deepEqual(utility.body, { error: 'فشل إرسال الرسالة' });
    assert.deepEqual(releases, ['Messenger utility message failed']);
    assert.doesNotMatch(JSON.stringify({ logs, releases, subscription: subscription.body, utility: utility.body }),
        /private-token-in-upstream-url|access_token=/);
    assert.equal(logs[0][1].name, 'TypeError');
});

test('Facebook route exception paths do not echo raw transport errors', () => {
    for (const route of [
        'fbContent.js',
        'fbInsights.js',
        'fbMessenger.js',
        'tenantFacebookMessaging.js',
        'partnerSolutions.js',
    ]) {
        const source = readFileSync(new URL(`../routes/${route}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*(?:error|err|e|releaseError)\s*\)/,
            `${route} must not log raw exception objects`);
        assert.doesNotMatch(source, /(?:releaseBilling|billing\.release)\(billingReservation,\s*error\.message\)/,
            `${route} must not persist raw exception messages as billing reasons`);
    }
    const insights = readFileSync(new URL('../routes/fbInsights.js', import.meta.url), 'utf8');
    assert.doesNotMatch(insights, /postEntry\.insights_error\s*=\s*e\.message/);
});
