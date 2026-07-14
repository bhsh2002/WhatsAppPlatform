import assert from 'node:assert/strict';
import test from 'node:test';
import {
    BILLING_OPERATIONS,
    BillingError,
    handleBillingError,
    normalizePhoneDigits,
    normalizeStatusPricing,
    parseJson,
    serializeJson,
    toInt,
} from '../services/billingCore.js';

test('billing core preserves operation and normalization contracts', () => {
    assert.equal(Object.isFrozen(BILLING_OPERATIONS), true);
    assert.equal(BILLING_OPERATIONS.WHATSAPP_TEMPLATE, 'whatsapp.template');
    assert.equal(BILLING_OPERATIONS.MESSENGER_BOT_REPLY, 'messenger.bot_reply');
    assert.equal(toInt('17 credits'), 17);
    assert.equal(toInt('invalid', 4), 4);
    assert.equal(normalizePhoneDigits('+218 (91) 234-5678'), '218912345678');
    assert.deepEqual(normalizeStatusPricing({
        model: 'CBP',
        billable: 'false',
        pricing_category: 'UTILITY',
        pricing_type: 'FREE_CUSTOMER_SERVICE',
    }), {
        pricing_model: 'CBP',
        billable: 0,
        category: 'utility',
        type: 'free_customer_service',
    });
    assert.deepEqual(parseJson('{"ok":true}'), { ok: true });
    assert.deepEqual(parseJson('not-json', { fallback: true }), { fallback: true });

    const circular = {};
    circular.self = circular;
    assert.equal(serializeJson(circular), '{"unparseable":true}');
});

test('billing errors retain the public HTTP response contract', () => {
    const error = new BillingError('الرصيد غير كافٍ', {
        status: 409,
        code: 'BALANCE_CONFLICT',
        available_credits: 3,
    });
    let statusCode = null;
    let payload = null;
    const response = {
        status(value) {
            statusCode = value;
            return this;
        },
        json(value) {
            payload = value;
            return value;
        },
    };

    assert.equal(handleBillingError(response, error), payload);
    assert.equal(statusCode, 409);
    assert.deepEqual(payload, {
        success: false,
        error: 'الرصيد غير كافٍ',
        code: 'BALANCE_CONFLICT',
        status: 409,
        available_credits: 3,
    });
    assert.equal(handleBillingError(response, new Error('unexpected')), null);
});
