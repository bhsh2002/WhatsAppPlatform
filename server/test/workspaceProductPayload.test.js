import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWorkspaceProductPayload } from '../services/workspaceProductPayload.js';

const allowedFields = ['name', 'description', 'sku', 'barcodes', 'base_unit', 'price', 'media'];
const options = { mode: 'create', allowedFields };
const product = () => ({ fields: { name: 'قهوة', base_unit: 'unit-verified', price: {
    amount: '12.350', currency: 'LYD', unit_code: 'unit-verified', price_list_id: 'price-context-verified', channel: 'retail' } } });

test('outgoing product proposal preserves decimal precision and creates no identity/version/authority', () => {
    const source = product();
    const proposal = validateWorkspaceProductPayload(source, options);
    assert.equal(proposal.fields.price.amount, '12.350');
    assert.equal(proposal.kind, 'goods');
    assert.equal(Object.hasOwn(proposal, 'entity_id'), false);
    assert.equal(Object.hasOwn(proposal, 'expected_record_version'), false);
    assert.notEqual(proposal.fields, source.fields);
    assert.equal(JSON.stringify(proposal).includes('approved'), false);
});

test('malformed, numeric, negative and non-finite price amounts cannot enter a review proposal', () => {
    for (const amount of ['', ' 12', '12 ', '12e2', '-1', '01', '1.2345', '.5', '1.', 'NaN', Infinity, NaN, 12.35, null]) {
        const payload = product(); payload.fields.price.amount = amount;
        assert.throws(() => validateWorkspaceProductPayload(payload, options), { code: 'workspace_product_invalid' });
    }
    for (const amount of ['0', '0.001', '12', '12.35']) {
        const payload = product(); payload.fields.price.amount = amount;
        assert.equal(validateWorkspaceProductPayload(payload, options).fields.price.amount, amount);
    }
});

test('proposed and cleared fields require exact currently offered field rights', () => {
    assert.throws(() => validateWorkspaceProductPayload(product(), { ...options, allowedFields: ['name'] }), { code: 'workspace_product_invalid' });
    const change = { entity_id: 'existing-product', expected_record_version: 9, fields: {}, clear_fields: ['price'] };
    assert.equal(validateWorkspaceProductPayload(change, { mode: 'change', allowedFields }).expected_record_version, 9);
    assert.throws(() => validateWorkspaceProductPayload(change, { mode: 'change', allowedFields: ['name'] }), { code: 'workspace_product_invalid' });
    for (const clear_fields of [['name'], ['price', 'price'], ['not_a_field']]) {
        assert.throws(() => validateWorkspaceProductPayload({ ...change, clear_fields }, { mode: 'change', allowedFields }), { code: 'workspace_product_invalid' });
    }
    assert.throws(() => validateWorkspaceProductPayload({ ...change, fields: { price: product().fields.price } }, { mode: 'change', allowedFields }), { code: 'workspace_product_invalid' });
});

test('changes require an existing record and version; create cannot smuggle source identity or approval', () => {
    for (const payload of [{ ...product(), entity_id: 'browser-chosen' }, { ...product(), expected_record_version: 8 },
        { ...product(), approved: true }, { ...product(), fields: { name: 'قهوة', source_installation_id: 'fake' } }]) {
        assert.throws(() => validateWorkspaceProductPayload(payload, options), { code: 'workspace_product_invalid' });
    }
    for (const payload of [product(), { ...product(), entity_id: 'existing', expected_record_version: 0 },
        { entity_id: 'existing', expected_record_version: 1, fields: {} }]) {
        assert.throws(() => validateWorkspaceProductPayload(payload, { mode: 'change', allowedFields }), { code: 'workspace_product_invalid' });
    }
});

test('media needs access and rights references; unknown metadata, nulls and duplicate barcodes are rejected', () => {
    for (const fields of [{ name: 'قهوة', media: [{ asset_id: 'asset' }] }, { name: null },
        { name: 'قهوة', barcodes: ['123', '123'] }, { name: 'قهوة', price: { ...product().fields.price, currency: 'lyd' } },
        { name: 'قهوة', price: { ...product().fields.price, approved: true } }]) {
        assert.throws(() => validateWorkspaceProductPayload({ fields }, options), { code: 'workspace_product_invalid' });
    }
    const fields = { name: 'قهوة', media: [{ asset_id: 'asset', access_reference: 'current-access', rights_reference: 'current-rights' }] };
    assert.deepEqual(validateWorkspaceProductPayload({ fields }, options).fields, fields);
});
