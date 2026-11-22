import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { WorkspaceSharedResourceReader } from '../services/workspaceSharedResourceReader.js';

// Synthetic closed DTO/component evidence; not a live source or joint journey.
const at = Date.parse('2026-11-22T12:00:00Z');
const scope = { organization_id: 'synthetic-org', activity_id: 'synthetic-activity', branch_id: null, warehouse_id: null };
const deadline = offset => new Date(at + offset).toISOString();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const fixture = (kind = 'product') => {
    let now = at, loadCalls = 0, loadHook = () => {}, transportHook = () => {};
    const sourceInstallationId = kind === 'offering' ? 'synthetic-service-installation' : 'synthetic-goods-installation';
    const provider = { provider_ref: 'synthetic-provider', activity_id: scope.activity_id, platform: 'catalog',
        external_tenant_id: 'catalog:synthetic-tenant', sourceInstallationId };
    const source = { platform: provider.platform, installation_id: sourceInstallationId, external_tenant_id: provider.external_tenant_id };
    const activity = { activity_id: scope.activity_id, scope };
    const identity = { actorId: 'synthetic-actor', organizationId: scope.organization_id, nativeAccountId: 'wa_savana:tenant:1',
        coreAccountId: 'synthetic-wa-provider', generation: 'synthetic-identity-generation', expiresAt: deadline(60000) };
    const readGrant = fields => ({ type: 'read', active: true, expired: false, scope, expires_at: deadline(60000),
        source_installation_id: sourceInstallationId, consumer_installation_id: 'synthetic-consumer', fields,
        policy: { fields, reader_account_ids: [identity.actorId] } });
    const serviceGrant = fields => ({ person_ref: identity.actorId, provider_ref: provider.provider_ref, capability_code: 'offerings.manage',
        actions: ['read'], allowed_fields: fields, resource_policy: 'activity', resource_refs: [], expires_at: deadline(60000), version: 1 });
    const context = { identity, actorId: identity.actorId, revision: 'synthetic-context-revision', validUntil: deadline(60000),
        consumerInstallationId: 'synthetic-consumer', selection: { scope, account: { provider_ref: identity.coreAccountId, platform: 'wa_savana' },
            consumer_installation_id: 'synthetic-consumer' },
        raw: { activities: [{ ...activity, capability_grants: [serviceGrant(['name', 'description']), serviceGrant(['kind', 'status'])] }],
            providers: [{ ...provider, installations: [{ installation_id: 'synthetic-goods-installation', activity_id: scope.activity_id }] }],
            service_registrations: [{ authority_domain: 'native.service_namespace', state: 'active', scope, provider_ref: provider.provider_ref,
                platform: provider.platform, external_tenant_id: provider.external_tenant_id, source_installation_id: 'synthetic-service-installation',
                expires_at: deadline(60000) }], existing: { grants: [readGrant(['name', 'media']), readGrant(['base_unit', 'price'])] } } };
    const expectedRecord = { entity_id: 'synthetic-core-product', version: 7, scope,
        source: { installation_id: sourceInstallationId, local_entity_id: 'synthetic-source-product', entity_type: 'product' }, source_revision: 1 };
    const media = { asset_id: 'synthetic-asset', parent_source_local_id: expectedRecord.source.local_entity_id,
        access_reference: 'opaque-source-access', rights_reference: 'opaque-source-rights' };
    const data = { name: 'Synthetic live product', description: 'Synthetic current source description', sku: 'SYN-1', barcodes: ['SYN0001'],
        base_unit: { code: 'kilogram', metadata_version: 3 }, variant_ref: null,
        price_options: [{ option_ref: 'synthetic-commercial-option', parent_source_local_id: expectedRecord.source.local_entity_id,
            code: 'current-purchase', process: 'purchase', pricing_model: 'fixed', amount: '12.500', currency: 'LYD', unit: 'kilogram' }], media: [media] };
    const offeringRef = '7e45049f-7877-4bfa-9c2c-3587dec0fa44';
    const authorization = fields => ({ scope, provider_ref: provider.provider_ref, source_platform: provider.platform,
        source_installation_id: sourceInstallationId, principal_kind: 'native_oidc', consumer_installation_id: context.consumerInstallationId,
        consumer_platform: 'wa_savana', allowed_fields: fields, authorization_revision: 'c'.repeat(64), valid_until: deadline(5000) });
    const descriptor = { asset_id: media.asset_id, rights_reference: media.rights_reference, fetch_mode: 'authenticated_json_base64',
        href: `/v1/integration/workspace/resources/${expectedRecord.entity_id}/media/${media.asset_id}/preview?${new URLSearchParams({
            activity_id: scope.activity_id, provider_ref: provider.provider_ref, resource_kind: 'product', ticket: 'opaque-core-ticket' })}`,
        valid_until: deadline(2000), content_types: ['image/png'] };
    const readView = (fields, resourceKind = kind) => ({ spec_version: '1.0', resource_kind: resourceKind,
        resource_ref: resourceKind === 'product' ? expectedRecord.entity_id : offeringRef, authorization: authorization(fields),
        record: { scope, source, source_local_id: resourceKind === 'product' ? expectedRecord.source.local_entity_id : offeringRef,
            native_revision: 9, observed_at: deadline(-10), resource_kind: resourceKind,
            data: Object.fromEntries(fields.map(field => [field, resourceKind === 'product' ? data[field]
                : { name: 'Synthetic service', description: 'Synthetic current service', kind: 'service', status: 'active' }[field]])) },
        media_previews: fields.includes('media') ? [structuredClone(descriptor)] : [] });
    const previewView = (detail = readView(['media'])) => ({ spec_version: '1.0', resource_ref: expectedRecord.entity_id,
        authorization: authorization(['media']), source, preview: { spec_version: '1.0', context_fingerprint: 'd'.repeat(64), state: 'available',
            source_local_id: detail.record.source_local_id, source_revision: detail.record.native_revision, asset_id: media.asset_id,
            access_reference: media.access_reference, rights_reference: media.rights_reference, content_type: 'image/png', byte_length: png.length,
            content_sha256: crypto.createHash('sha256').update(png).digest('hex'), content_base64: png.toString('base64'),
            checked_at: deadline(0), valid_until: deadline(5000), rights_active: true } });
    let payload = readView(['name']);
    const calls = [];
    let current = structuredClone(context);
    const gateway = { now: () => now, loadContext: async () => { await loadHook(++loadCalls); return structuredClone(current); },
        transport: { request: async (_principal, input) => { calls.push(structuredClone(input)); await transportHook(); return { payload: structuredClone(payload) }; } } };
    return { reader: new WorkspaceSharedResourceReader({ gateway }), gateway, context, activity, provider, expectedRecord, source, media, descriptor,
        offeringRef, authorization, readView, previewView, calls, current: () => current, change: value => { current = value; },
        payload: value => { payload = value; }, clock: value => { now = value; }, onLoad: fn => { loadHook = fn; }, onTransport: fn => { transportHook = fn; } };
};
const record = (f, fields = ['name'], options = {}) => f.reader.record({}, f.context, f.activity, f.provider,
    { resourceKind: 'product', resourceRef: f.expectedRecord.entity_id, fields, expectedRecord: f.expectedRecord, ...options });
const preview = (f, detail = f.readView(['media']), descriptor = detail.media_previews[0]) => f.reader.preview({}, f.context, f.activity, f.provider, { detail, descriptor });

test('offering search uses exact explicit fields/current namespace and one fixed Core GET per call without a cache', async () => {
    const f = fixture('offering'), view = f.readView(['name', 'kind']);
    f.payload({ spec_version: '1.0', resource_kind: 'offering', authorization: view.authorization, records: [view.record], next_cursor: 'opaque-next' });
    for (let i = 0; i < 2; i++) {
        const result = await f.reader.search({}, f.context, f.activity, f.provider, { fields: ['name', 'kind'], q: 'Synthetic service', cursor: 'opaque-cursor' });
        assert.equal(result.records[0].data.kind, 'service'); assert.equal(result.next_cursor, 'opaque-next');
    }
    assert.equal(f.calls.length, 2);
    const request = f.calls[0], url = new URL(request.path, 'https://fixed-core.invalid');
    assert.equal(url.pathname, '/v1/integration/workspace/resources');
    assert.deepEqual(Object.fromEntries(url.searchParams), { activity_id: scope.activity_id, provider_ref: f.provider.provider_ref,
        resource_kind: 'offering', fields: 'name,kind', q: 'Synthetic service', cursor: 'opaque-cursor' });
    assert.equal(request.sharedResourceModel, 'SharedResourceSearchView');
    assert.equal(request.consumerInstallation, f.context.consumerInstallationId); assert.deepEqual(request.expectedIdentity, f.context.identity);
    assert.equal(request.method, undefined); assert.equal(request.body, undefined);
});

test('published search character bounds preserve Unicode query and opaque cursor values without truncation', async () => {
    const f = fixture('offering'), view = f.readView(['name']);
    f.payload({ authorization: view.authorization, records: [view.record] });
    const q = '📦'.repeat(200), cursor = '📄'.repeat(8192);
    await f.reader.search({}, f.context, f.activity, f.provider, { fields: ['name'], q, cursor });
    const url = new URL(f.calls[0].path, 'https://fixed-core.invalid');
    assert.equal(url.searchParams.get('q'), q); assert.equal(url.searchParams.get('cursor'), cursor);
    await assert.rejects(f.reader.search({}, f.context, f.activity, f.provider, { fields: ['name'], q: q + '📦' }), { code: 'workspace_request_invalid' });
    await assert.rejects(f.reader.search({}, f.context, f.activity, f.provider, { fields: ['name'], cursor: cursor + '📄' }), { code: 'workspace_request_invalid' });
    assert.equal(f.calls.length, 1);
});

test('product live detail binds genuine canonical/source identity and grants without equating native revision with an older projection', async () => {
    const f = fixture(), fields = ['name', 'base_unit', 'price_options', 'variant_ref']; f.payload(f.readView(fields));
    const value = await record(f, fields);
    assert.equal(value.resource_ref, f.expectedRecord.entity_id); assert.equal(value.record.native_revision, 9);
    assert.equal(f.expectedRecord.version, 7); assert.equal(f.expectedRecord.source_revision, 1);
    assert.equal(value.record.data.base_unit.metadata_version, 3); assert.equal(value.record.data.price_options[0].code, 'current-purchase');
    const request = f.calls[0], url = new URL(request.path, 'https://fixed-core.invalid');
    assert.equal(url.pathname, '/v1/integration/workspace/resources/synthetic-core-product');
    assert.deepEqual(Object.fromEntries(url.searchParams), { activity_id: scope.activity_id, provider_ref: f.provider.provider_ref,
        resource_kind: 'product', fields: fields.join(',') });
    assert.equal(request.sharedResourceModel, 'SharedResourceReadView');
    const bad = f.readView(fields); bad.record.source_local_id = 'foreign-source-product'; f.payload(bad);
    await assert.rejects(record(f, fields), { code: 'workspace_resource_scope_invalid' });
});

test('empty/duplicate/unknown fields and ungranted actor/source/consumer masks reject before dispatch', async () => {
    for (const fields of [[], ['name', 'name'], ['is_visible'], ['price']]) {
        const f = fixture(); await assert.rejects(record(f, fields), { code: 'workspace_request_invalid' }); assert.equal(f.calls.length, 0);
    }
    for (const alter of [grant => { grant.source_installation_id = 'foreign-source'; }, grant => { grant.consumer_installation_id = 'foreign-consumer'; },
        grant => { grant.policy.reader_account_ids = ['foreign-actor']; }, grant => { grant.active = false; },
        grant => { grant.expired = true; }, grant => { grant.expires_at = deadline(0); }, grant => { grant.scope = { ...grant.scope, activity_id: 'foreign-activity' }; }]) {
        const f = fixture(); alter(f.context.raw.existing.grants[1]); f.change(structuredClone(f.context));
        await assert.rejects(record(f, ['price_options']), { code: 'workspace_read_grant_required' }); assert.equal(f.calls.length, 0);
    }
});

test('offering fields union only current actor/provider read grants and genuine active source namespaces', async () => {
    const f = fixture('offering'); f.payload(f.readView(['name', 'kind']));
    assert.equal((await f.reader.record({}, f.context, f.activity, f.provider, { resourceKind: 'offering', resourceRef: f.offeringRef,
        fields: ['name', 'kind'] })).record.data.kind, 'service');
    for (const alter of [context => { context.raw.activities[0].capability_grants[1].actions = ['request']; },
        context => { context.raw.activities[0].capability_grants[1].person_ref = 'foreign-actor'; },
        context => { context.raw.activities[0].capability_grants[1].resource_policy = 'selected'; context.raw.activities[0].capability_grants[1].resource_refs = ['foreign-resource']; },
        context => { context.raw.service_registrations[0].state = 'revoked'; }]) {
        const g = fixture('offering'); alter(g.context); g.change(structuredClone(g.context));
        await assert.rejects(g.reader.record({}, g.context, g.activity, g.provider, { resourceKind: 'offering', resourceRef: g.offeringRef, fields: ['kind'] }));
        assert.equal(g.calls.length, 0);
    }
});

test('current identity/selection/grants are compared before and after I/O even if a stale revision label is retained', async () => {
    for (const alter of [context => { context.identity.coreAccountId = 'rebound-provider'; },
        context => { context.selection.consumer_installation_id = 'changed-consumer'; },
        context => { context.raw.existing.grants[0].active = false; }, context => { context.revision = 'changed-revision'; }]) {
        for (const boundary of ['before', 'after']) {
            const f = fixture();
            f.onLoad(n => { if (n === (boundary === 'before' ? 1 : 2)) { const changed = structuredClone(f.context); alter(changed); f.change(changed); } });
            await assert.rejects(record(f), { code: 'workspace_context_changed' });
            assert.equal(f.calls.length, boundary === 'before' ? 0 : 1);
        }
    }
});

test('preview fetches only a detail-authorized fixed Core path and returns validated bytes bounded by its descriptor deadline', async () => {
    const f = fixture(), detail = f.readView(['media']); f.payload(f.previewView(detail));
    const result = await preview(f, detail);
    assert.deepEqual(result.bytes, png); assert.equal(result.contentType, 'image/png'); assert.equal(result.validUntil, f.descriptor.valid_until);
    assert.equal(f.calls.length, 1);
    const request = f.calls[0], url = new URL(request.path, 'https://fixed-core.invalid');
    assert.equal(url.pathname, '/v1/integration/workspace/resources/synthetic-core-product/media/synthetic-asset/preview');
    assert.deepEqual(Object.fromEntries(url.searchParams), { activity_id: scope.activity_id, provider_ref: f.provider.provider_ref,
        resource_kind: 'product', ticket: 'opaque-core-ticket' });
    assert.equal(request.sharedResourceModel, 'SharedMediaPreviewView'); assert.equal(request.consumerInstallation, f.context.consumerInstallationId);
});

test('draft2 raw colon product and asset identities remain exact safe path segments', async () => {
    const f = fixture(), detail = f.readView(['media']);
    detail.resource_ref = 'core:product:1'; detail.record.data.media[0].asset_id = 'catalog:asset:1';
    detail.media_previews[0].asset_id = 'catalog:asset:1';
    detail.media_previews[0].href = detail.media_previews[0].href.replace('synthetic-core-product/media/synthetic-asset', 'core:product:1/media/catalog:asset:1');
    const response = f.previewView(detail); response.resource_ref = detail.resource_ref; response.preview.asset_id = 'catalog:asset:1';
    f.payload(response); assert.deepEqual((await preview(f, detail)).bytes, png);
    assert.match(f.calls[0].path, /^\/v1\/integration\/workspace\/resources\/core:product:1\/media\/catalog:asset:1\/preview\?/);
    assert.equal(f.calls[0].path.includes('%3A'), false);
});

test('arbitrary preview URLs, duplicate or extra selectors, wrong scope and unrelated descriptors never dispatch', async () => {
    const original = fixture().descriptor.href;
    for (const href of ['https://foreign.invalid' + original, '//foreign.invalid' + original,
        original + '&provider_ref=foreign', original + '&consumer_installation_id=foreign', original.replace('synthetic-provider', 'foreign-provider'),
        original.replace('synthetic-core-product/media', 'foreign-product/media'), original.replace('ticket=opaque-core-ticket', 'ticket='),
        original + '#fragment', original.replace('/preview?', '/%2e%2e/preview?')]) {
        const f = fixture(), detail = f.readView(['media']); detail.media_previews[0].href = href;
        await assert.rejects(preview(f, detail)); assert.equal(f.calls.length, 0);
    }
    const f = fixture(), detail = f.readView(['media']);
    await assert.rejects(preview(f, detail, { ...detail.media_previews[0], rights_reference: 'unrelated-rights' })); assert.equal(f.calls.length, 0);
});

test('preview native revision/full source/rights binding is strict and withdrawn previews return no bytes', async () => {
    for (const alter of [view => { view.preview.source_revision++; }, view => { view.preview.access_reference = 'foreign-access'; },
        view => { view.preview.rights_reference = 'foreign-rights'; }, view => { view.source.external_tenant_id = 'foreign-tenant'; }]) {
        const f = fixture(), value = structuredClone(f.previewView()); alter(value); f.payload(value);
        await assert.rejects(preview(f), { code: 'workspace_resource_scope_invalid' }); assert.equal(f.calls.length, 1);
    }
    const f = fixture(), value = f.previewView(); value.preview.state = 'withdrawn'; value.preview.rights_active = false;
    for (const key of ['content_type', 'byte_length', 'content_sha256', 'content_base64']) value.preview[key] = null;
    f.payload(value); const result = await preview(f);
    assert.equal(result.bytes, null); assert.equal(result.contentType, null); assert.equal(result.value.preview.state, 'withdrawn');
});

test('preview uses its actual current granted mask and revision without assuming detail authorization equality', async () => {
    const f = fixture(), value = f.previewView(); value.authorization.allowed_fields = ['name', 'media'];
    value.authorization.authorization_revision = 'e'.repeat(64); f.payload(value);
    assert.deepEqual((await preview(f)).bytes, png);
    const g = fixture(), foreign = g.previewView(); foreign.authorization.allowed_fields = ['sku', 'media']; g.payload(foreign);
    await assert.rejects(preview(g), { code: 'workspace_read_grant_required' });
});

test('expiry during response/context awaits discards all data and errors never retry or fall back', async () => {
    const f = fixture(); f.onLoad(n => { if (n === 2) f.clock(at + 5000); });
    await assert.rejects(record(f), { code: 'workspace_resource_read_expired' }); assert.equal(f.calls.length, 1);
    const g = fixture(); g.payload(g.previewView()); g.onLoad(n => { if (n === 2) g.clock(at + 2000); });
    await assert.rejects(preview(g), { code: 'workspace_resource_read_expired' }); assert.equal(g.calls.length, 1);
    const h = fixture(); h.onTransport(() => { throw Object.assign(new Error('Synthetic unavailable source'), { code: 'workspace_unavailable' }); });
    await assert.rejects(record(h), { code: 'workspace_unavailable' }); assert.equal(h.calls.length, 1);
});

test('retained v2: detail preserves actual older field provenance separately from the current read lease', async () => {
    const f = fixture(), value = f.readView(['name', 'base_unit']);
    value.central_publication = { source_watermark: 9, field_versions: { name: 2, base_unit: 4 },
        field_observed_at: { name: '2026-10-01T10:00:00Z', base_unit: '2026-11-01T08:30:00Z' } };
    f.payload(value); const result = await record(f, ['name', 'base_unit']);
    assert.deepEqual(result.central_publication, value.central_publication);
    assert.equal(result.record.observed_at, value.record.observed_at);
    assert.equal(result.authorization.valid_until, value.authorization.valid_until);
    f.onLoad(n => { if (n === 4) f.clock(at + 5000); });
    await assert.rejects(record(f, ['name', 'base_unit']), { code: 'workspace_resource_read_expired' });
});

test('retained v2: offering search binds each provenance entry to an actually returned source-local record', async () => {
    const f = fixture('offering'), view = f.readView(['name', 'kind']);
    const provenance = { source_watermark: 9, field_versions: { name: 2 }, field_observed_at: { name: '2026-09-12T09:00:00Z' } };
    f.payload({ spec_version: '1.0', resource_kind: 'offering', authorization: view.authorization, records: [view.record], next_cursor: null,
        central_publications: { [view.record.source_local_id]: provenance } });
    const result = await f.reader.search({}, f.context, f.activity, f.provider, { fields: ['name', 'kind'] });
    assert.deepEqual(result.central_publications, { [view.record.source_local_id]: provenance });
    f.payload({ ...result, central_publications: { 'foreign-source-local-id': provenance } });
    await assert.rejects(f.reader.search({}, f.context, f.activity, f.provider, { fields: ['name', 'kind'] }), { code: 'workspace_resource_scope_invalid' });
});
