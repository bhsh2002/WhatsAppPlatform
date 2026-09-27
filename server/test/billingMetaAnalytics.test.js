import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildWabaFieldUrl,
    fetchWabaField,
    sumConversationAnalytics,
    sumMessageAnalytics,
    sumPricingAnalytics,
} from '../services/billingMetaAnalytics.js';

test('Meta message and conversation points aggregate across response groups', () => {
    assert.deepEqual(sumMessageAnalytics({
        analytics: {
            data_points: [
                { sent: '2', delivered: 1 },
                { sent: 3, delivered: '4' },
                { sent: 'invalid', delivered: null },
            ],
        },
    }), { sent: 5, delivered: 5 });

    assert.deepEqual(sumConversationAnalytics({
        conversation_analytics: {
            data: [
                { data_points: [{ conversation: '2', cost: '0.25', currency: 'USD' }] },
                { data_points: [{ conversation: 3, cost: 0.5, currency: 'USD' }] },
                { ignored: true },
            ],
        },
    }), { conversations: 5, cost: 0.75, currency: 'USD' });
    assert.deepEqual(sumConversationAnalytics(null), {
        conversations: 0,
        cost: 0,
        currency: null,
    });
});

test('Meta pricing analytics accepts flat and grouped shapes with stable breakdowns', () => {
    const flat = sumPricingAnalytics({
        pricing_analytics: {
            data_points: [
                {
                    volume: '2',
                    cost: '0.25',
                    pricing_category: 'MARKETING',
                    pricing_type: 'REGULAR',
                    currency: 'USD',
                },
                {
                    volume: 3,
                    cost: 0.5,
                    category: 'marketing',
                    type: 'regular',
                    currency: 'USD',
                },
                {
                    volume: 1,
                    cost: 0,
                    pricing_category: 'UTILITY',
                    pricing_type: 'FREE',
                    currency: 'USD',
                },
            ],
        },
    });

    assert.equal(flat.volume, 6);
    assert.equal(flat.cost, 0.75);
    assert.equal(flat.currency, 'USD');
    assert.deepEqual(flat.by_category_type, [
        {
            pricing_category: 'marketing',
            pricing_type: 'regular',
            volume: 5,
            cost: 0.75,
            currency: 'USD',
        },
        {
            pricing_category: 'utility',
            pricing_type: 'free',
            volume: 1,
            cost: 0,
            currency: 'USD',
        },
    ]);

    const grouped = sumPricingAnalytics({
        pricing_analytics: {
            data: [
                { data_points: [{ volume: 4, cost: 1, category: 'service', type: 'free', currency: 'EUR' }] },
                { volume: 2, cost: 0.5, category: 'service', type: 'paid', currency: 'EUR' },
            ],
        },
    });
    assert.equal(grouped.volume, 6);
    assert.equal(grouped.cost, 1.5);
    assert.equal(grouped.by_category_type.length, 2);
});

test('Meta analytics gateway encodes Graph fields and exposes only normalized errors', async () => {
    const field = 'analytics.start(1).end(2).granularity(DAY)';
    const builtUrl = new URL(buildWabaFieldUrl('waba-123', field, 'token-value'));
    assert.equal(builtUrl.pathname.endsWith('/waba-123'), true);
    assert.equal(builtUrl.searchParams.get('fields'), field);
    assert.equal(builtUrl.searchParams.has('access_token'), false);
    assert.doesNotMatch(builtUrl.toString(), /token-value/);

    let requestedUrl = null;
    let requestedInit = null;
    await assert.rejects(
        () => fetchWabaField('waba-123', field, 'token-value', async (url, init) => {
            requestedUrl = url;
            requestedInit = init;
            return new Response(JSON.stringify({
                error: {
                    message: 'Invalid token',
                    code: 190,
                    fbtrace_id: 'private-trace',
                    error_data: { access_token: 'private-token' },
                },
            }), { status: 401 });
        }),
        (error) => {
            assert.equal(error.message, 'Meta access token is invalid or expired');
            assert.equal(error.status, 401);
            assert.deepEqual(error.data, {
                message: 'Meta access token is invalid or expired',
                type: null,
                code: 190,
                subcode: null,
                status: 401,
                retryable: false,
            });
            assert.equal(JSON.stringify(error.data).includes('private-trace'), false);
            assert.equal(JSON.stringify(error.data).includes('private-token'), false);
            return true;
        }
    );
    assert.equal(requestedUrl, buildWabaFieldUrl('waba-123', field, 'token-value'));
    assert.equal(requestedInit.headers.Authorization, 'Bearer token-value');
    assert.doesNotMatch(requestedUrl, /token-value|access_token/);

    const success = await fetchWabaField('waba-123', field, 'token-value', async () => (
        new Response(JSON.stringify({ analytics: { data_points: [] } }), { status: 200 })
    ));
    assert.deepEqual(success, { analytics: { data_points: [] } });
});

test('Meta analytics transport exceptions cannot expose request credentials', async () => {
    await assert.rejects(
        () => fetchWabaField('waba-123', 'analytics', 'private-access-token', async () => {
            throw new TypeError('request failed: access_token=private-access-token');
        }),
        (error) => {
            assert.equal(error.status, 503);
            assert.equal(error.message, 'Meta service is temporarily unavailable');
            assert.equal(error.data.retryable, true);
            assert.doesNotMatch(JSON.stringify({ message: error.message, data: error.data }),
                /private-access-token|access_token/);
            return true;
        }
    );
});
