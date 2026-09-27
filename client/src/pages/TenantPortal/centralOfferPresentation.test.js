import assert from 'node:assert/strict';
import test from 'node:test';

import {
    centralCheckoutQuotesMatch,
    centralPlanOfferState,
    currentCentralOffer,
    formatCentralOfferPrice,
    formatCentralQuoteAmount,
    isCentralCheckoutQuote,
    selectCentralPlanPrice,
} from './centralOfferPresentation.js';

test('current bundle takes precedence over its included Wa plan', () => {
    const plan = { id: 'wa', name: 'Wa Standard', is_current: true, is_subscribed: true };
    const bundle = { id: 'suite', name: 'Savana Suite', amount_minor: 20000,
        currency: 'LYD', billing_period: 'monthly', price_available: true };
    const context = {
        managed_centrally: true,
        active_plan: plan,
        current_bundle: bundle,
        current_offer: { kind: 'bundle', ...bundle },
    };
    assert.deepEqual(currentCentralOffer(context), context.current_offer);
    assert.equal(centralPlanOfferState(plan, context), 'included');
    assert.equal(centralPlanOfferState({ ...plan, is_subscribed: false }, context), 'included');
    assert.equal(formatCentralOfferPrice(currentCentralOffer(context), 'en'), '200 LYD / شهر');
});

test('older central contexts still show the current bundle before an individual plan', () => {
    const context = {
        managed_centrally: true,
        active_plan: { id: 'wa', name: 'Wa Standard' },
        current_bundle: { id: 'suite', name: 'Savana Suite' },
    };
    assert.equal(currentCentralOffer(context).name, 'Savana Suite');
    assert.equal(formatCentralOfferPrice(currentCentralOffer(context), 'en'), null);
});

test('monthly active plan price is used consistently for display and checkout', () => {
    const plan = { id: 'wa', name: 'Wa Standard', is_current: true, is_subscribed: true,
        prices: [
            { id: 'yearly', active: true, amount_minor: 80000, currency: 'LYD', billing_period: 'yearly' },
            { id: 'monthly', active: true, amount_minor: 8000, currency: 'LYD', billing_period: 'monthly' },
        ] };
    const context = { managed_centrally: true, active_plan: plan };
    assert.equal(selectCentralPlanPrice(plan).id, 'monthly');
    assert.equal(centralPlanOfferState(plan, context), 'current');
    assert.equal(centralPlanOfferState({ ...plan, is_current: false }, {
        ...context, current_offer: { kind: 'plan', id: plan.id, name: plan.name },
    }), 'current');
    assert.equal(formatCentralOfferPrice(currentCentralOffer(context), 'en'), '80 LYD / شهر');
});

test('unavailable or malformed prices are never presented as zero', () => {
    assert.equal(formatCentralOfferPrice({ price_available: false, amount_minor: 0, currency: 'LYD' }, 'en'), null);
    assert.equal(formatCentralOfferPrice({ amount_minor: null, currency: 'LYD' }, 'en'), null);
    assert.equal(formatCentralOfferPrice({ amount_minor: undefined, currency: 'LYD' }, 'en'), null);
    assert.equal(formatCentralOfferPrice({ amount_minor: 1234, currency: 'LYD' }, 'en'), '12.34 LYD');
    assert.equal(currentCentralOffer({ managed_centrally: true, current_offer: null }), null);
});

test('quote amounts use 1/100 LYD and require complete money fields', () => {
    assert.equal(formatCentralQuoteAmount(8000, 'lyd', 'en'), '80 LYD');
    assert.equal(formatCentralQuoteAmount(20000, 'LYD', 'en'), '200 LYD');
    assert.equal(formatCentralQuoteAmount(8050, 'LYD', 'en'), '80.5 LYD');
    assert.equal(formatCentralQuoteAmount(null, 'LYD', 'en'), null);
    const quote = {
        currency: 'LYD',
        billing_period: 'monthly',
        period_days: 30,
        base_amount_minor: 20000,
        upgrade_credit_minor: 8000,
        subtotal_minor: 12000,
        discount_minor: 0,
        tax_minor: 0,
        total_minor: 12000,
        payment_required: true,
        period_starts_after_payment: true,
    };
    assert.equal(isCentralCheckoutQuote(quote), true);
    assert.equal(isCentralCheckoutQuote({ ...quote, total_minor: undefined }), false);
    assert.equal(centralCheckoutQuotesMatch(quote, { ...quote }), true);
    assert.equal(centralCheckoutQuotesMatch(quote, {
        ...quote, upgrade_credit_minor: 7000, total_minor: 13000,
    }), false);
    assert.equal(centralCheckoutQuotesMatch(quote, { ...quote, period_days: 365 }), false);
    assert.equal(centralCheckoutQuotesMatch(quote, { ...quote, payment_required: false }), false);
});
