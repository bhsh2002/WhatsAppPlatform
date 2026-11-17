import assert from 'node:assert/strict';
import test from 'node:test';
import { savanaIntegrationMethods } from '../../api/savanaIntegrations.js';
import { sharedProductDisplayValue, sharedProductRecordIsValid, sharedProductRecordKey, sharedProductTitle, sharedProductVisibleFields, sharedReadErrorMessage, sharedReadResponseIsValid } from './sharedProductReadPresentation.js';

const now = Date.parse('2026-11-17T12:00:00Z');
const record = (overrides = {}) => ({
    scope: { organization_id: 'synthetic-org', activity_id: 'synthetic-activity' },
    entity_type: 'product', entity_id: 'central-product-1', domain: 'product.core',
    source: { installation_id: 'catalog-source-1', entity_type: 'product', local_entity_id: 'native-catalog-1' },
    version: 3, ownership_epoch: 1, expected_version: 2, source_revision: 'catalog-revision-3',
    observed_at: '2026-11-17T11:59:00Z', received_at: '2026-11-17T11:59:01Z',
    state: 'active', freshness: 'current', field_visibility: 'explicit_grants_only',
    data: { name: 'Synthetic product', online_price: null, sku: 'SAME-LEGACY-SKU' },
    ...overrides,
});
const response = overrides => ({
    spec_version: '1.0', enabled: true, read_only: true, execution_ready: false, pricing_use_allowed: false,
    context: { consumer_platform: 'wa_savana', scope: { organization_id: 'synthetic-org', activity_id: 'synthetic-activity' }, authorization_revision: 'a'.repeat(64), checked_at: '2026-11-17T12:00:00Z', valid_until: '2026-11-17T12:05:00Z' },
    records: [record()], has_more: false, next_cursor: null,
    ...overrides,
});

test('read-only response requires verified scope, provenance and unexpired authorization', () => {
    assert.equal(sharedReadResponseIsValid(response(), 'records', now), true);
    for (const mutation of [
        { enabled: false }, { read_only: false }, { execution_ready: true }, { pricing_use_allowed: true },
        { records: [record({ field_visibility: null })] }, { records: [record({ source: { installation_id: 'source' } })] },
        { records: [record({ scope: { organization_id: 'other-org', activity_id: 'synthetic-activity' } })] },
        { records: [record({ version: 0 })] }, { records: [record({ state: 'deleted-because-unreachable' })] },
        { records: [record({ observed_at: 'invalid' })] },
    ]) assert.equal(sharedReadResponseIsValid(response(mutation), 'records', now), false);
    assert.equal(sharedReadResponseIsValid(response(), 'records', now + 300_001), false);
    assert.equal(sharedProductRecordIsValid(record({ entity_type: 'customer' })), false);
    assert.equal(sharedProductRecordIsValid(record({ domain: 'customer.private' })), false);
    assert.equal(sharedProductRecordIsValid(record({ source: { ...record().source, entity_type: 'offering' } })), true);
});

test('explicit archive and tombstone remain distinct from inaccessible or empty observations', () => {
    const archived = record({ state: 'archived' });
    const tombstone = record({ state: 'tombstone', data: { name: 'Old data must not reappear' } });
    assert.equal(sharedProductRecordIsValid(archived), true);
    assert.deepEqual(sharedProductVisibleFields(archived), Object.entries(archived.data));
    assert.equal(sharedProductRecordIsValid(tombstone), true);
    assert.deepEqual(sharedProductVisibleFields(tombstone), []);
    assert.equal(sharedProductTitle(tombstone), tombstone.entity_id);
    assert.equal(sharedProductTitle(record({ data: { name: { unsupported: 'object title' } } })), 'central-product-1');
    assert.equal(sharedReadResponseIsValid(response({ records: [] }), 'records', now), true);
    for (const status of [401, 403, 404, 409, 503]) {
        const message = sharedReadErrorMessage({ status }, 'en');
        assert.equal(typeof message, 'string');
        assert.equal(message.includes('Old data must not reappear'), false);
    }
    assert.ok(sharedReadErrorMessage({ status: 404 }, 'en').includes('not converted into deletion'));
    assert.ok(sharedReadErrorMessage({ status: 403 }, 'en').includes('does not mean'));
    assert.ok(sharedReadErrorMessage({ status: 503 }, 'en').includes('no source deletion was inferred'));
});

test('same SKU or barcode cannot establish the shared product identity', () => {
    const first = record();
    const second = record({ entity_id: 'central-product-2', source: { ...first.source, installation_id: 'catalog-source-2' } });
    assert.notEqual(sharedProductRecordKey(first), sharedProductRecordKey(second));
    assert.equal(first.data.sku, second.data.sku);
    assert.equal(first.data.online_price, null);
    assert.equal(sharedProductDisplayValue(null, 'en'), 'Not specified by the source');
    assert.equal(sharedProductDisplayValue('12.125', 'en'), '12.125');
    assert.deepEqual(sharedProductVisibleFields(first).map(([key]) => key), ['name', 'online_price', 'sku']);
    assert.equal(JSON.stringify(sharedProductVisibleFields(first)).includes('LYD'), false);
});

test('changes are typed observations with safe cursors and do not masquerade as current records', () => {
    const document = response({ changes: [{ cursor: 5, record: record({ state: 'archived', version: 4 }) }], cursor: 5 });
    assert.equal(sharedReadResponseIsValid(document, 'changes', now), true);
    assert.equal(sharedReadResponseIsValid({ ...document, cursor: Number.MAX_SAFE_INTEGER + 1 }, 'changes', now), false);
    assert.equal(sharedReadResponseIsValid({ ...document, changes: [{ cursor: 6, record: record({ state: 'unknown' }) }] }, 'changes', now), false);
});

test('local read API sends only query/cursor selectors and never browser grants or source credentials', async () => {
    const requests = [];
    const client = { request: async (...args) => { requests.push(args); return {}; } };
    await savanaIntegrationMethods.getPortalSharedProducts.call(client, { q: 'Synthetic', limit: 15, cursor: 'opaque-cursor', organization_id: 'injected-org', access_token: 'browser-secret', permissions: ['write'] });
    await savanaIntegrationMethods.getPortalSharedProductChanges.call(client, 12, 15);
    assert.equal(requests.length, 2);
    const search = new URL(requests[0][0], 'https://synthetic.invalid');
    assert.equal(search.pathname, '/api/portal/integrations/shared-products');
    assert.deepEqual([...search.searchParams.keys()], ['q', 'limit', 'cursor']);
    assert.equal(requests[0].length, 1);
    assert.equal(requests[1][0], '/api/portal/integrations/shared-product-changes?after=12&limit=15');
    assert.equal(JSON.stringify(requests).includes('browser-secret'), false);
});
