import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import test from 'node:test';
import { SharedProductReadError } from '../services/centralProductRead.js';
import { SHARED_RESOURCE_PRODUCER_MODELS_SHA256, SHARED_MEDIA_MAX_BYTES,
    validateSharedResourceModel, decodeSharedResourceRead, decodeSharedResourceSearch,
    decodeSharedMediaPreview } from '../services/workspaceSharedResourceModels.js';

// Exact published consumer fixtures only; no live producer, Core, grants or runtime.
const NOW = Date.parse('2026-11-22T00:00:00Z');
const at = offset => new Date(NOW + offset).toISOString();
const clone = value => JSON.parse(JSON.stringify(value));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const scope = { organization_id: 'organization', activity_id: 'activity', branch_id: null, warehouse_id: null };
const source = { platform: 'catalog', installation_id: 'source-installation', external_tenant_id: 'catalog:tenant:1' };
const productFields = ['name', 'description', 'sku', 'barcodes', 'base_unit', 'price_options', 'media', 'variant_ref'];
const offeringFields = ['name', 'kind', 'status', 'attributes'];
const parent = '11111111-1111-4111-8111-111111111111';
const offeringId = '22222222-2222-4222-8222-222222222222';
const resourceRef = 'canonical-product';
const media = { asset_id: 'asset-1', access_reference: 'opaque-source-access', rights_reference: 'opaque-source-rights', parent_source_local_id: parent };
const price = { option_ref: 'actual-option', parent_source_local_id: parent, code: 'retail', process: 'purchase',
    pricing_model: 'fixed', amount: '12.500', currency: 'LYD', unit: 'each' };
const expected = (resourceKind = 'product', fields = productFields) => ({ scope: clone(scope), providerRef: 'source-provider',
    sourcePlatform: source.platform, sourceInstallationId: source.installation_id, sourceExternalTenantId: source.external_tenant_id,
    principalKind: 'native_oidc', consumerInstallationId: 'consumer-installation', consumerPlatform: 'wa_savana',
    resourceKind, allowedFields: [...fields], ...(resourceKind === 'product' ? { resourceRef, sourceLocalId: parent } : {}) });
const authorization = (fields = productFields) => ({ scope: clone(scope), provider_ref: 'source-provider', source_platform: source.platform,
    source_installation_id: source.installation_id, principal_kind: 'native_oidc', consumer_installation_id: 'consumer-installation',
    consumer_platform: 'wa_savana', allowed_fields: [...fields], authorization_revision: 'a'.repeat(64), valid_until: at(5000) });
const descriptor = () => ({ asset_id: media.asset_id, rights_reference: media.rights_reference,
    href: `/v1/integration/workspace/resources/${resourceRef}/media/${media.asset_id}/preview?activity_id=activity&provider_ref=source-provider&resource_kind=product&ticket=opaque-ticket`,
    fetch_mode: 'authenticated_json_base64', valid_until: at(3000), content_types: ['image/jpeg', 'image/png', 'image/webp'] });
const productView = () => ({ spec_version: '1.0', resource_kind: 'product', resource_ref: resourceRef,
    authorization: authorization(), record: { scope: clone(scope), source: clone(source), source_local_id: parent,
        native_revision: 8, observed_at: at(-1000), resource_kind: 'product', data: { name: 'قهوة المصدر', description: null,
            sku: 'REAL-SKU', barcodes: ['12345'], base_unit: { code: 'each', metadata_version: 4 },
            price_options: [clone(price)], media: [clone(media)], variant_ref: null } }, media_previews: [descriptor()] });
const offeringRecord = () => ({ scope: clone(scope), source: clone(source), source_local_id: offeringId,
    native_revision: 3, observed_at: at(-1000), resource_kind: 'offering',
    data: { name: 'خدمة المصدر', kind: 'service', status: 'active', attributes: { duration: 2, tags: ['current', true, null] } } });
const offeringView = () => ({ spec_version: '1.0', resource_kind: 'offering', resource_ref: offeringId,
    authorization: authorization(offeringFields), record: offeringRecord(), media_previews: [] });
const offeringExpected = () => ({ ...expected('offering', offeringFields), resourceRef: offeringId });
const publication = (fields = ['name']) => ({ source_watermark: 8,
    field_versions: Object.fromEntries(fields.map(field => [field, 2])),
    field_observed_at: Object.fromEntries(fields.map(field => [field, at(-86_400_000)])) });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+n/ZYAAAAASUVORK5CYII=', 'base64');
const previewView = (bytes = png, contentType = 'image/png') => ({ spec_version: '1.0', resource_ref: resourceRef,
    authorization: authorization(['media']), source: clone(source), preview: { spec_version: '1.0', context_fingerprint: 'b'.repeat(64),
        state: 'available', source_local_id: parent, source_revision: 8, asset_id: media.asset_id,
        access_reference: media.access_reference, rights_reference: media.rights_reference,
        content_type: contentType, byte_length: bytes.length, content_sha256: sha(bytes), content_base64: bytes.toString('base64'),
        checked_at: at(-100), valid_until: at(4000), rights_active: true } });
const previewExpected = () => ({ ...expected('product', ['media']), nativeRevision: 8, assetId: media.asset_id,
    accessReference: media.access_reference, rightsReference: media.rights_reference, validUntil: at(2000) });
const rejects = (call, code = undefined) => assert.throws(call, error => error instanceof SharedProductReadError && (!code || error.code === code));

test('the consumer locks the exact24-definition retained schema and preserves the original models', () => {
    const bytes = fs.readFileSync(new URL('../config/shared-resource-producer-models-v2-retained.schema.json', import.meta.url));
    assert.equal(sha(bytes), SHARED_RESOURCE_PRODUCER_MODELS_SHA256);
    const schema = JSON.parse(bytes);
    assert.equal(Object.keys(schema.$defs).length, 24);
    const originalBytes = fs.readFileSync(new URL('../config/shared-resource-producer-models-v1.schema.json', import.meta.url));
    assert.equal(sha(originalBytes), '66ab2146f7a34af30373b16d0783f8f55f5913d63bd9c7947478abc195aceb12');
    const original = JSON.parse(originalBytes);
    for (const [name, definition] of Object.entries(original.$defs)) {
        if (['SharedResourceReadView', 'SharedResourceSearchView'].includes(name)) continue;
        assert.deepEqual(schema.$defs[name], definition, name);
    }
    const value = productView();
    const decoded = validateSharedResourceModel('SharedResourceReadView', value);
    decoded.record.data.name = 'Only this clone';
    assert.equal(value.record.data.name, 'قهوة المصدر');
    rejects(() => validateSharedResourceModel('UnpublishedModel', value));
    rejects(() => validateSharedResourceModel('SharedResourceReadView', { ...value, authorization_header: 'not-a-public-field' }));
});

test('retained provenance is a closed typed shape with exact dates and safe positive versions', () => {
    const value = publication();
    assert.deepEqual(validateSharedResourceModel('CentralPublicationProvenance', value), value);
    for (const change of [{ source_watermark: 0 }, { source_watermark: Number.MAX_SAFE_INTEGER + 1 },
        { field_versions: { name: 1.5 } }, { field_versions: { name: 0 } },
        { field_versions: { name: Number.MAX_SAFE_INTEGER + 1 } }, { field_versions: {} },
        { field_observed_at: {} }, { field_observed_at: { name: '2026-02-30T00:00:00Z' } },
        { field_observed_at: { name: at(-1), private: null } }, { source_scope: scope },
        { field_versions: Object.fromEntries(Array.from({ length: 33 }, (_, index) => ['field' + index, 1])) }]) {
        rejects(() => validateSharedResourceModel('CentralPublicationProvenance', { ...value, ...change }));
    }
    const badRead = productView(); badRead.central_publication = 'not-provenance';
    rejects(() => decodeSharedResourceRead(badRead, expected(), { now: NOW }));
});

test('retained product reads preserve actual older per-field observations without filling absent fields', () => {
    const value = productView(); value.central_publication = publication(['name', 'price_options', 'media']);
    value.central_publication.field_observed_at.name = '2026-11-20T17:01:02.123+02:00';
    const decoded = decodeSharedResourceRead(value, expected(), { now: NOW });
    assert.deepEqual(decoded, value);
    assert.notEqual(decoded.central_publication, value.central_publication);
    assert.equal(decoded.central_publication.field_observed_at.name, '2026-11-20T17:01:02.123+02:00');
    assert.notEqual(decoded.central_publication.field_observed_at.name, decoded.record.observed_at);
    const partial = productView(); partial.record.data = { name: partial.record.data.name };
    partial.authorization = authorization(['name']); partial.media_previews = []; partial.central_publication = publication();
    const narrow = decodeSharedResourceRead(partial, expected('product', ['name']), { now: NOW });
    assert.deepEqual(narrow.record.data, { name: 'قهوة المصدر' });
    assert.equal(Object.hasOwn(narrow.record.data, 'description'), false);
    const live = productView();
    assert.equal(Object.hasOwn(decodeSharedResourceRead(live, expected(), { now: NOW }), 'central_publication'), false);
    live.central_publication = null;
    assert.equal(decodeSharedResourceRead(live, expected(), { now: NOW }).central_publication, null);
});

test('retained detail provenance binds paired keys to actual returned permitted fields and exact scope', () => {
    const base = productView(); base.central_publication = publication();
    for (const update of [item => { delete item.record.data.name; },
        item => { item.central_publication.field_versions.private = 2; item.central_publication.field_observed_at.private = at(-100); },
        item => { item.central_publication.field_observed_at = { description: at(-100) }; },
        item => { item.central_publication.field_versions.description = 2; },
        item => { item.record.scope.activity_id = 'foreign'; },
        item => { item.authorization.scope.organization_id = 'foreign'; },
        item => { item.central_publication.authorization = clone(item.authorization); }]) {
        const bad = clone(base); update(bad);
        rejects(() => decodeSharedResourceRead(bad, expected(), { now: NOW }));
    }
    const hidden = offeringView(); hidden.central_publication = publication(['description']);
    rejects(() => decodeSharedResourceRead(hidden, offeringExpected(), { now: NOW }), 'workspace_resource_scope_invalid');
    const changedMask = clone(base); changedMask.authorization.allowed_fields = ['name'];
    rejects(() => decodeSharedResourceRead(changedMask, expected(), { now: NOW }), 'workspace_resource_scope_invalid');
});

test('retained search provenance belongs only to exact returned source-local records and visible fields', () => {
    const provenance = { ...publication(['name', 'status']), source_watermark: 3 };
    const value = { spec_version: '1.0', resource_kind: 'offering', authorization: authorization(offeringFields),
        records: [offeringRecord()], next_cursor: null, central_publications: { [offeringId]: provenance } };
    const binding = expected('offering', offeringFields);
    const decoded = decodeSharedResourceSearch(value, binding, { now: NOW });
    assert.deepEqual(decoded, value);
    assert.notEqual(decoded.central_publications[offeringId], provenance);
    for (const update of [item => { item.central_publications['foreign-source-record'] = clone(provenance); },
        item => { item.central_publications[resourceRef] = item.central_publications[offeringId]; delete item.central_publications[offeringId]; },
        item => { item.records = []; },
        item => { item.central_publications[offeringId] = publication(['description']); },
        item => { item.central_publications[offeringId].field_observed_at = { status: at(-100) }; },
        item => { item.central_publications[offeringId] = null; },
        item => { item.central_publications = null; },
        item => { item.records[0].source.external_tenant_id = 'foreign-source'; }]) {
        const bad = clone(value); update(bad);
        rejects(() => decodeSharedResourceSearch(bad, binding, { now: NOW }));
    }
    const noMetadata = clone(value); delete noMetadata.central_publications;
    assert.equal(Object.hasOwn(decodeSharedResourceSearch(noMetadata, binding, { now: NOW }), 'central_publications'), false);
    assert.deepEqual(decodeSharedResourceSearch({ ...value, central_publications: {} }, binding, { now: NOW }).central_publications, {});
});

test('closed authorization enforces paired consumers and mandatory native consumers without invoking getters', () => {
    for (const change of [{ consumer_platform: null }, { consumer_installation_id: null },
        { consumer_platform: null, consumer_installation_id: null }, { access_token: 'private' }, { valid_until: '2026-02-30T00:00:00Z' }]) {
        rejects(() => validateSharedResourceModel('SharedReadAuthorization', { ...authorization(), ...change }));
    }
    const portal = { ...authorization(), principal_kind: 'portal_owner', consumer_installation_id: null, consumer_platform: null };
    assert.deepEqual(validateSharedResourceModel('SharedReadAuthorization', portal), portal);
    let reads = 0;
    const getter = { ...authorization() };
    Object.defineProperty(getter, 'provider_ref', { enumerable: true, get() { reads += 1; return 'source-provider'; } });
    rejects(() => validateSharedResourceModel('SharedReadAuthorization', getter));
    assert.equal(reads, 0);
    const sparse = authorization(); sparse.allowed_fields = new Array(1);
    rejects(() => validateSharedResourceModel('SharedReadAuthorization', sparse));
});

test('conditional price models and actual nonphysical field shapes stay exact', () => {
    assert.deepEqual(validateSharedResourceModel('PriceOption', price), price);
    for (const bad of [{ pricing_model: 'fixed', amount: null }, { pricing_model: 'quote', amount: '1' },
        { pricing_model: 'negotiated', amount: '1' }, { pricing_model: 'free', amount: '1' },
        { price_list_id: 'invented-list' }, { channel: 'invented-channel' }, { amount: '1e2' }]) {
        rejects(() => validateSharedResourceModel('PriceOption', { ...price, ...bad }));
    }
    assert.equal(validateSharedResourceModel('PriceOption', { ...price, pricing_model: 'quote', amount: null }).amount, null);
    for (const amount of [null, '0', '0.0', '0.00', '0.000']) {
        assert.equal(validateSharedResourceModel('PriceOption', { ...price, pricing_model: 'free', amount }).amount, amount);
    }
    for (const change of [{ kind: 'physical_good' }, { base_unit: 'each' }, { attributes: { '': true } },
        { attributes: Object.fromEntries(Array.from({ length: 101 }, (_, index) => ['key' + index, index])) }]) {
        rejects(() => validateSharedResourceModel('OfferingFields', { ...offeringRecord().data, ...change }));
    }
    rejects(() => validateSharedResourceModel('ProductContextFields', { variant_ref: 'invented-variant' }));
    rejects(() => validateSharedResourceModel('BaseUnitRelation', { code: 'each', metadata_version: 0 }));
    rejects(() => validateSharedResourceModel('OfferingFields', { attributes: { rounded: Number.MAX_SAFE_INTEGER + 1 } }));
});

test('product reads bind the source,parent relations and requested projection mask while preserving a newer native revision', () => {
    const value = productView();
    const decoded = decodeSharedResourceRead(value, expected(), { now: NOW });
    assert.deepEqual(decoded, value);
    assert.notEqual(decoded.record, value.record);
    assert.equal(decoded.record.native_revision, 8);
    assert.equal(decoded.record.source_local_id, parent);
    assert.notEqual(decoded.resource_ref, decoded.record.source_local_id);
    for (const update of [item => { item.record.scope.activity_id = 'foreign'; },
        item => { item.record.source.external_tenant_id = 'catalog:tenant:2'; },
        item => { item.authorization.consumer_platform = 'sawemly'; },
        item => { item.authorization.provider_ref = 'foreign'; },
        item => { item.record.data.price_options[0].parent_source_local_id = 'foreign'; },
        item => { item.record.data.media[0].parent_source_local_id = 'foreign'; },
        item => { item.record.data.price_options.push(clone(price)); },
        item => { item.record.data.media.push(clone(media)); },
        item => { item.authorization.allowed_fields.push('name'); }]) {
        const bad = productView(); update(bad);
        rejects(() => decodeSharedResourceRead(bad, expected(), { now: NOW }));
    }
    rejects(() => decodeSharedResourceRead(value, { ...expected(), allowedFields: ['name'] }, { now: NOW }));
    rejects(() => decodeSharedResourceRead(value, { ...expected(), nativeRevision: 7 }, { now: NOW }));
    const emptyUnit = productView(); emptyUnit.record.data.base_unit = null;
    assert.equal(decodeSharedResourceRead(emptyUnit, expected(), { now: NOW }).record.data.base_unit, null);
});

test('read descriptors must match actual authorized media and cannot renew the Core deadline', () => {
    for (const update of [item => { item.media_previews[0].asset_id = 'foreign'; },
        item => { item.media_previews[0].rights_reference = 'foreign'; },
        item => { item.media_previews[0].valid_until = at(5001); },
        item => { item.media_previews[0].content_types.push('image/png'); },
        item => { item.media_previews.push(descriptor()); }]) {
        const value = productView(); update(value);
        rejects(() => decodeSharedResourceRead(value, expected(), { now: NOW }));
    }
    const shortOwnerWindow = { ...expected(), validUntil: at(1000) };
    const value = productView();
    assert.deepEqual(decodeSharedResourceRead(value, shortOwnerWindow, { now: NOW }), value);
    rejects(() => decodeSharedResourceRead(value, { ...expected(), validUntil: at(0) }, { now: NOW }), 'workspace_resource_read_expired');
});

test('offering search/detail remain source-native, scoped and nonphysical', () => {
    const view = offeringView(), binding = offeringExpected();
    assert.deepEqual(decodeSharedResourceRead(view, binding, { now: NOW }), view);
    const search = { spec_version: '1.0', resource_kind: 'offering', authorization: authorization(offeringFields), records: [offeringRecord()], next_cursor: null };
    assert.deepEqual(decodeSharedResourceSearch(search, expected('offering', offeringFields), { now: NOW }), search);
    const wrongPublicId = offeringView(); wrongPublicId.resource_ref = 'invented-canonical-offering';
    rejects(() => decodeSharedResourceRead(wrongPublicId, { ...binding, resourceRef: wrongPublicId.resource_ref }, { now: NOW }));
    const duplicate = clone(search); duplicate.records.push(offeringRecord());
    rejects(() => decodeSharedResourceSearch(duplicate, expected('offering', offeringFields), { now: NOW }));
    const foreign = clone(search); foreign.records[0].source.installation_id = 'other-source';
    rejects(() => decodeSharedResourceSearch(foreign, expected('offering', offeringFields), { now: NOW }));
    const hidden = clone(search); hidden.records[0].data.description = 'not in the selected field mask';
    rejects(() => decodeSharedResourceSearch(hidden, expected('offering', offeringFields), { now: NOW }));
    rejects(() => decodeSharedResourceSearch(search, { ...expected('offering', offeringFields), allowedFields: undefined }, { now: NOW }));
});

test('preview returns the actual bounded bytes and earliest access deadline for each supported MIME signature', () => {
    const signatures = [[png, 'image/png'], [Buffer.from([255,216,255,224,0,0,255,217]), 'image/jpeg'],
        [Buffer.from('RIFF\u0004\u0000\u0000\u0000WEBP', 'binary'), 'image/webp']];
    for (const [bytes, type] of signatures) {
        const input = previewView(bytes, type);
        const result = decodeSharedMediaPreview(input, previewExpected(), { now: NOW });
        assert.ok(Buffer.isBuffer(result.bytes)); assert.deepEqual(result.bytes, bytes);
        assert.equal(result.contentType, type); assert.equal(result.validUntil, at(2000));
        assert.deepEqual(result.value, input); assert.notEqual(result.value, input);
    }
    const binding = previewExpected(); delete binding.allowedFields;
    assert.equal(decodeSharedMediaPreview(previewView(), binding, { now: NOW }).contentType, 'image/png');
    const noMedia = previewView(); noMedia.authorization.allowed_fields = ['name'];
    rejects(() => decodeSharedMediaPreview(noMedia, binding, { now: NOW }));
    const duplicate = previewView(); duplicate.authorization.allowed_fields = ['media', 'media'];
    rejects(() => decodeSharedMediaPreview(duplicate, binding, { now: NOW }));
});

test('preview rejects changed media/source tuples and native revisions without treating references as URLs', () => {
    for (const change of [item => { item.resource_ref = 'foreign'; }, item => { item.source.external_tenant_id = 'foreign'; },
        item => { item.preview.source_local_id = 'foreign'; }, item => { item.preview.source_revision = 9; },
        item => { item.preview.asset_id = 'foreign'; }, item => { item.preview.access_reference = 'foreign'; },
        item => { item.preview.rights_reference = 'foreign'; }]) {
        const value = previewView(); change(value);
        rejects(() => decodeSharedMediaPreview(value, previewExpected(), { now: NOW }), 'workspace_resource_scope_invalid');
    }
    const value = previewView(), binding = previewExpected();
    value.preview.access_reference = binding.accessReference = 'https://example.invalid/opaque-reference';
    assert.equal(decodeSharedMediaPreview(value, binding, { now: NOW }).value.preview.access_reference, binding.accessReference);
    rejects(() => decodeSharedMediaPreview(value, { ...binding, nativeRevision: undefined }, { now: NOW }));
});

test('preview validates canonical base64, exact byte length/SHA, MIME magic and the524288 byte ceiling', () => {
    for (const update of [item => { item.preview.content_base64 += '\n'; },
        item => { item.preview.content_base64 = item.preview.content_base64.replace('+', '-').replace('/', '_'); },
        item => { item.preview.content_sha256 = '0'.repeat(64); },
        item => { item.preview.byte_length += 1; },
        item => { item.preview.content_type = 'image/jpeg'; },
        item => { item.preview.content_type = 'image/svg+xml'; }]) {
        const value = previewView(); update(value);
        rejects(() => decodeSharedMediaPreview(value, previewExpected(), { now: NOW }));
    }
    const noncanonical = previewView(Buffer.from([0]));
    noncanonical.preview.content_base64 = 'AB==';
    rejects(() => decodeSharedMediaPreview(noncanonical, previewExpected(), { now: NOW }), 'workspace_resource_media_invalid');
    const maximum = Buffer.alloc(SHARED_MEDIA_MAX_BYTES); png.subarray(0, 8).copy(maximum);
    assert.equal(decodeSharedMediaPreview(previewView(maximum), previewExpected(), { now: NOW }).bytes.length, SHARED_MEDIA_MAX_BYTES);
    const excessive = Buffer.concat([maximum, Buffer.from([0])]);
    rejects(() => decodeSharedMediaPreview(previewView(excessive), previewExpected(), { now: NOW }));
});

test('withdrawn/missing responses contain no bytes or active rights and leases cannot be extended', () => {
    for (const state of ['withdrawn', 'missing']) {
        const value = previewView();
        Object.assign(value.preview, { state, source_revision: null, content_type: null, content_base64: null,
            content_sha256: null, byte_length: null, rights_active: false });
        const result = decodeSharedMediaPreview(value, previewExpected(), { now: NOW });
        assert.equal(result.bytes, null); assert.equal(result.contentType, null); assert.equal(result.value.preview.state, state);
        rejects(() => decodeSharedMediaPreview({ ...value, preview: { ...value.preview, content_base64: png.toString('base64') } }, previewExpected(), { now: NOW }));
        rejects(() => decodeSharedMediaPreview({ ...value, preview: { ...value.preview, rights_active: true } }, previewExpected(), { now: NOW }));
    }
    for (const change of [item => { item.preview.valid_until = at(0); },
        item => { item.preview.valid_until = at(5001); }, item => { item.preview.checked_at = at(1); },
        item => { item.authorization.valid_until = at(3000); }, item => { item.authorization.valid_until = at(0); }]) {
        const value = previewView(); change(value);
        rejects(() => decodeSharedMediaPreview(value, previewExpected(), { now: NOW }), 'workspace_resource_read_expired');
    }
    rejects(() => decodeSharedMediaPreview(previewView(), { ...previewExpected(), validUntil: at(0) }, { now: NOW }), 'workspace_resource_read_expired');
});
