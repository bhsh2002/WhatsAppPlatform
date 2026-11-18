import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalWorkspaceDecimal, clearWorkspaceProductField, emptyWorkspaceProductDraft, updateWorkspaceProductDraft, workspaceDecimalIsValid, workspaceProductDraftErrors, workspaceProductSelection } from './workspaceProductPresentation.js';

const fields = [
    { key: 'name', label: 'اسم المنتج', enabled: true, required: true },
    { key: 'description', label: 'الوصف', enabled: true, clearable: true },
    { key: 'sku', label: 'رمز المنتج', enabled: true, clearable: true },
    { key: 'barcodes', label: 'الباركود', enabled: true, clearable: true },
    { key: 'base_unit', label: 'الوحدة', enabled: true, clearable: true },
    { key: 'price', label: 'السعر', enabled: true, clearable: true },
    { key: 'media', label: 'الصور', enabled: true, clearable: true },
];
const units = [{ value: 'opaque-unit-token', label: 'عبوة', enabled: true }];
const priceChoices = [{ value: 'opaque-price-token', label: 'سعر المتجر · دينار ليبي لكل عبوة', enabled: true }];
const mediaChoices = [{ value: 'opaque-media-token', label: 'الصورة الأمامية للعبوة', enabled: true }];
const draft = { ...emptyWorkspaceProductDraft(), name: 'قهوة المدينة', description: 'وصف سابق', sku: 'COFFEE-1',
    base_unit: units[0].value, price: { amount: '25.500', choice: priceChoices[0].value }, media: [mediaChoices[0].value] };
const options = { draft, fields, units, priceChoices, mediaChoices };

test('published decimal precision is enforced without floating point conversion or guessed separators', () => {
    for (const value of ['0', '0.000', '25', '25.500', '١٢٫٥٠٠', '۱۲.۵۰']) assert.equal(workspaceDecimalIsValid(value), true, value);
    for (const value of ['', '-1', '1e3', 'NaN', 'Infinity', '1,500', '01.5', '.5', '25.5001', '9'.repeat(31), 25.5]) assert.equal(workspaceDecimalIsValid(value), false, String(value));
    assert.equal(canonicalWorkspaceDecimal('١٢٫٥٠٠'), '12.500');
});

test('new product review uses named allowed unit, price and media choices without accepting manual references', () => {
    assert.deepEqual(workspaceProductDraftErrors(options), {});
    for (const change of [
        { base_unit: 'manual-unit-id' }, { price: { amount: '25', choice: 'manual-price-list-id' } }, { media: ['manual-asset-id'] },
    ]) assert.ok(Object.keys(workspaceProductDraftErrors({ ...options, draft: { ...draft, ...change } })).length > 0);
    const review = workspaceProductSelection(options);
    assert.equal(review.values.price.amount, '25.500');
    assert.equal(review.values.price.choice, 'opaque-price-token');
    const visible = JSON.stringify(review.summary);
    assert.ok(visible.includes('دينار ليبي لكل عبوة'));
    for (const value of ['opaque-unit-token', 'opaque-price-token', 'opaque-media-token']) assert.equal(visible.includes(value), false);
});

test('an absent optional price stays absent while a partial price is rejected', () => {
    const noPrice = { ...draft, price: { amount: '', choice: '' } };
    assert.equal(workspaceProductSelection({ ...options, draft: noPrice }).values.price, undefined);
    assert.ok(workspaceProductDraftErrors({ ...options, draft: { ...draft, price: { amount: '25', choice: '' } } }).price);
    assert.ok(workspaceProductDraftErrors({ ...options, draft: { ...draft, price: { amount: '', choice: priceChoices[0].value } } }).price);
    const zero = workspaceProductSelection({ ...options, draft: { ...draft, price: { amount: '0', choice: priceChoices[0].value } } });
    assert.equal(zero.values.price.amount, '0');
});

test('editing one field preserves other source fields and explicit clearing is separate from blank input', () => {
    const changed = updateWorkspaceProductDraft(draft, 'description', 'وصف جديد');
    const review = workspaceProductSelection({ ...options, mode: 'change', draft: changed });
    assert.deepEqual(review.values, { description: 'وصف جديد' });
    assert.deepEqual(review.clearFields, []);
    assert.deepEqual(review.changedFields, ['description']);
    const blank = updateWorkspaceProductDraft(draft, 'description', '');
    assert.ok(workspaceProductDraftErrors({ ...options, mode: 'change', draft: blank }).description);
    assert.equal(workspaceProductSelection({ ...options, mode: 'change', draft: blank }), null);
    const cleared = clearWorkspaceProductField(draft, 'description', true);
    const clearReview = workspaceProductSelection({ ...options, mode: 'change', draft: cleared });
    assert.deepEqual(clearReview.values, {});
    assert.deepEqual(clearReview.clearFields, ['description']);
    assert.equal(draft.description, 'وصف سابق');
});

test('changed permissions and required-field clearing invalidate a product review', () => {
    const changed = updateWorkspaceProductDraft(draft, 'price', { amount: '30', choice: priceChoices[0].value });
    const withdrawn = fields.map(field => field.key === 'price' ? { ...field, enabled: false } : field);
    assert.ok(workspaceProductDraftErrors({ ...options, mode: 'change', draft: changed, fields: withdrawn }).price);
    assert.equal(workspaceProductSelection({ ...options, mode: 'change', draft: changed, fields: withdrawn }), null);
    assert.equal(workspaceProductSelection({ ...options, mode: 'change' }), null);
    const forbidden = { ...draft, changedFields: ['name'], clearFields: ['name'] };
    assert.ok(workspaceProductDraftErrors({ ...options, mode: 'change', draft: forbidden }).name);
});

test('barcodes and media use bounded unique selections from the current source', () => {
    const duplicate = { ...draft, barcodes: '123\n123' };
    assert.ok(workspaceProductDraftErrors({ ...options, draft: duplicate }).barcodes);
    const parsed = workspaceProductSelection({ ...options, draft: { ...draft, barcodes: '123\n456،789' } });
    assert.deepEqual(parsed.values.barcodes, ['123', '456', '789']);
    const mediaWithdrawn = mediaChoices.map(choice => ({ ...choice, enabled: false }));
    assert.ok(workspaceProductDraftErrors({ ...options, mediaChoices: mediaWithdrawn }).media);
});
