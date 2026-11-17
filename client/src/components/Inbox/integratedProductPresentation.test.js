import assert from 'node:assert/strict';
import test from 'node:test';
import { integratedProductCanPrepareMessage, integratedProductMessage, integratedProductPricing } from './integratedProductPresentation.js';

const translate = (key, values) => `${key}:${JSON.stringify(values || {})}`;
test('incomplete and malformed prices never fabricate a currency or prepare a draft', () => {
  for (const product of [
    { price: '12' }, { currency: 'USD' }, { price: null, currency: 'USD' },
    { price: '', currency: 'USD' }, { price: 'abc', currency: 'USD' },
    { price: '1e2', currency: 'USD' }, { price: '.5', currency: 'USD' },
    { price: '01', currency: 'USD' }, { price: '-1', currency: 'USD' },
    { price: '1.1234', currency: 'USD' }, { price: '12', currency: 'usd' },
    { price: '12', currency: 'LYD ' }, { price: true, currency: 'USD' },
    { price: '12', currency: 'USD', pricing_ready: false },
    { price: '9'.repeat(310), currency: 'USD' },
  ]) {
    assert.equal(integratedProductPricing(product).ready, false);
    assert.equal(integratedProductMessage(product, translate), null);
  }
});
test('an explicit valid price including zero is presented in its stated currency', () => {
  for (const price of ['0', '0.000', '12.125', 0]) {
    const product = { is_active: true, can_prepare_product_message: true, name: 'Synthetic product', price, currency: 'USD', quantity_available: '-1', shelf_code: 'A' };
    const pricing = integratedProductPricing(product);
    assert.deepEqual(pricing, { ready: true, price: String(price), currency: 'USD' });
    const draft = integratedProductMessage(product, translate);
    assert.ok(draft.includes('"currency":"USD"'));
    assert.ok(draft.includes('"quantity":"-1"'));
    assert.equal(draft.includes('LYD'), false);
  }
});

test('valid pricing alone cannot enable an archived, quarantined or unverified copy', () => {
  for (const flags of [
    {}, { is_active: true }, { can_prepare_product_message: true },
    { is_active: false, can_prepare_product_message: true },
    { is_active: true, can_prepare_product_message: false },
    { is_active: true, can_prepare_product_message: true, pricing_ready: false },
    { is_active: 1, can_prepare_product_message: true },
  ]) {
    const product = { price: '12', currency: 'USD', ...flags };
    assert.equal(integratedProductCanPrepareMessage(product), false);
    assert.equal(integratedProductMessage(product, translate), null);
  }
});
