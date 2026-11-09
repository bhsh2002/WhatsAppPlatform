import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';

import {
    centralCheckoutQuotesMatch,
    centralAnnualPlanSavings,
    centralPlanCheckoutSelection,
    centralPlanOfferState,
    currentCentralOffer,
    formatCentralOfferPrice,
    formatCentralQuoteAmount,
    isCentralCheckoutQuote,
    selectCentralPlanPrice,
} from './centralOfferPresentation.js';

const pricePlan = (monthly = 8000, yearly = 80000) => ({
    id: 'wa-standard',
    prices: [
        { id: 'monthly', active: true, amount_minor: monthly, currency: 'LYD', billing_period: 'monthly' },
        { id: 'yearly', active: true, amount_minor: yearly, currency: 'LYD', billing_period: 'yearly' },
    ],
});

test('yearly saving compares the real yearly price with twelve months of the same plan', () => {
    const plan = pricePlan();
    const yearly = selectCentralPlanPrice(plan, 'yearly');
    assert.deepEqual(centralAnnualPlanSavings(plan, yearly), {
        original_amount_minor: 96000, savings_minor: 16000, percent: 16, currency: 'LYD',
    });
    assert.equal(formatCentralOfferPrice(yearly, 'en'), '800 LYD / سنة');
    assert.equal(centralAnnualPlanSavings(plan, selectCentralPlanPrice(plan, 'monthly')), null);
});

test('changing to yearly keeps the exact catalog price id for preview and checkout', () => {
    const plan = pricePlan();
    assert.deepEqual(centralPlanCheckoutSelection(plan, 'monthly'), { plan_id: plan.id, price_id: 'monthly' });
    assert.deepEqual(centralPlanCheckoutSelection(plan, 'yearly'), { plan_id: plan.id, price_id: 'yearly' });
    plan.prices[1].active = false;
    assert.equal(selectCentralPlanPrice(plan, 'yearly'), null);
    assert.throws(() => centralPlanCheckoutSelection(plan, 'yearly'), /السعر المختار غير متاح/);
    assert.throws(() => centralPlanCheckoutSelection(plan, 'foreign-price'), /السعر المختار غير متاح/);
});

test('missing, inactive or different-currency terms do not invent an annual discount', () => {
    const monthlyOnly = pricePlan();
    monthlyOnly.prices.pop();
    assert.equal(centralAnnualPlanSavings(monthlyOnly, { id: 'yearly' }), null);
    const yearlyOnly = pricePlan();
    yearlyOnly.prices.shift();
    assert.equal(centralAnnualPlanSavings(yearlyOnly, yearlyOnly.prices[0]), null);
    for (const change of [
        prices => { prices[0].active = false; },
        prices => { prices[1].active = false; },
        prices => { prices[0].currency = 'USD'; },
        prices => { prices[0].amount_minor = 0; },
    ]) {
        const plan = pricePlan();
        change(plan.prices);
        assert.equal(centralAnnualPlanSavings(plan, plan.prices[1]), null);
    }
});

test('equal or more expensive yearly prices have no discount', () => {
    for (const amount of [96000, 100000]) {
        const plan = pricePlan(8000, amount);
        assert.equal(centralAnnualPlanSavings(plan, plan.prices[1]), null);
    }
});

test('uses the cheapest comparable monthly price and never rounds the percentage up', () => {
    const plan = pricePlan(8000, 80000);
    plan.prices.push({ ...plan.prices[0], id: 'monthly-expensive', amount_minor: 10000 });
    plan.prices.unshift({ ...plan.prices[0], id: 'monthly-old', amount_minor: 20000, active: false });
    assert.equal(centralAnnualPlanSavings(plan, selectCentralPlanPrice(plan, 'yearly')).original_amount_minor, 96000);
    const tinySaving = pricePlan(100, 1199);
    assert.deepEqual(centralAnnualPlanSavings(tinySaving, tinySaving.prices[1]), {
        original_amount_minor: 1200, savings_minor: 1, percent: 0, currency: 'LYD',
    });
});

test('free real annual prices save 100 percent while unsafe or malformed money is excluded', () => {
    const freeYear = pricePlan(8000, 0);
    assert.equal(centralAnnualPlanSavings(freeYear, freeYear.prices[1]).percent, 100);
    for (const monthly of [Number.MAX_SAFE_INTEGER, -1, 1.2, '8000', null, Infinity]) {
        const plan = pricePlan(monthly, 0);
        assert.equal(centralAnnualPlanSavings(plan, plan.prices[1]), null);
    }
    const nearLimit = pricePlan(750599937895082, 1);
    const saving = centralAnnualPlanSavings(nearLimit, nearLimit.prices[1]);
    assert.equal(saving.percent, 99);
    assert.equal(saving.savings_minor, saving.original_amount_minor - 1);
});

test('the actual price card renders the annual comparison only for a real cheaper yearly term', async () => {
    const bundle = await build({
        configFile: false,
        logLevel: 'silent',
        build: {
            ssr: fileURLToPath(new URL('./CentralPlanPricing.jsx', import.meta.url)),
            write: false,
            rollupOptions: { output: { format: 'cjs' } },
        },
    });
    const componentModule = { exports: {} };
    new Function('require', 'module', 'exports', bundle.output.find(item => item.type === 'chunk').code)(
        createRequire(import.meta.url), componentModule, componentModule.exports,
    );
    const { CentralAnnualSaving, default: CentralPlanPricing } = componentModule.exports;
    const plan = pricePlan();
    const html = renderToStaticMarkup(React.createElement(CentralPlanPricing, {
        plan, price: plan.prices[1], locale: 'en', onPriceChange() {},
    }));
    assert.match(html, /دورة الاشتراك/);
    assert.match(html, /800 LYD \/ سنة/);
    assert.match(html, /تكلفة 12 شهرًا بالسعر الشهري/);
    assert.match(html, /<del[^>]*>960 LYD<\/del>/);
    assert.match(html, /توفير 160 LYD سنويًا · 16٪/);
    const renderSaving = (offer, price) => renderToStaticMarkup(React.createElement(CentralAnnualSaving, {
        plan: offer, price, locale: 'en', includeNote: true,
    }));
    assert.match(renderSaving(plan, plan.prices[1]), /السعر السنوي يتضمن هذا التوفير بالفعل/);
    assert.equal(renderSaving(plan, plan.prices[0]), '');
    assert.equal(renderSaving({ ...plan, prices: [plan.prices[0]] }, plan.prices[1]), '');
    const tinySaving = pricePlan(100, 1199);
    const smallHtml = renderSaving(tinySaving, tinySaving.prices[1]);
    assert.match(smallHtml, /توفير 0\.01 LYD سنويًا/);
    assert.doesNotMatch(smallHtml, /0٪/);
});

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

test('an explicitly available revised offer is not hidden by a matching current plan id', () => {
    const plan = { id: 'wa', is_current: true, is_subscribed: true,
        checkout_state: 'available', checkout_available: true };
    const context = { current_offer: { kind: 'plan', id: 'wa' } };
    assert.equal(centralPlanOfferState(plan, context), 'available');
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
    assert.equal(centralCheckoutQuotesMatch(
        { ...quote, catalog_fingerprint: 'a'.repeat(64) },
        { ...quote, catalog_fingerprint: 'b'.repeat(64) },
    ), false);
    assert.equal(centralCheckoutQuotesMatch(quote, { ...quote, catalog_fingerprint: 'a'.repeat(64) }), false);
});
