import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { WorkspaceReceipts } from '../services/workspaceReceipts.js';
import { WorkspaceReferences } from '../services/workspaceReferences.js';
import { WorkspaceSharedResourceReader } from '../services/workspaceSharedResourceReader.js';
import { WorkspaceSharedResourceViews } from '../services/workspaceSharedResourceViews.js';
import { canonicalWorkspaceJson } from '../services/workspaceIntents.js';

// BFF/closed DTO component tests with real encrypted receipts and typed refs.
// The synthetic Core boundary is not current-source or joint runtime evidence.
const at = Date.parse('2026-11-22T12:00:00Z');
const until = ms => new Date(at + ms).toISOString();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const principal = { tenantId: 1, userId: 1, sessionId: 'synthetic-session', authVersion: 0, role: 'tenant', sessionExpiresAt: at / 1000 + 60 };
const digest = raw => crypto.createHash('sha256').update(raw).digest('hex');
const fixture = t => {
    const db = new Database(':memory:'); t.after(() => db.close());
    db.exec('CREATE TABLE tenants(id INTEGER PRIMARY KEY); CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO tenants VALUES(1); INSERT INTO users VALUES(1);');
    db.exec(fs.readFileSync(new URL('../db/migrations/066_workspace_receipts.sql', import.meta.url), 'utf8'));
    const key = crypto.randomBytes(32);
    const encryption = { encrypt(raw) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        return Buffer.concat([iv, cipher.update(raw), cipher.final(), cipher.getAuthTag()]).toString('base64'); },
    decrypt(raw) { const data = Buffer.from(raw, 'base64'), cipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
        cipher.setAuthTag(data.subarray(-16)); return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString(); } };
    let now = at, loadCount = 0, detailCount = 0, canonicalReads = 0, loadHook = () => {}, wireHook = () => {};
    let previewState = 'available', nativeRevision = 9, mappingVersion = 7;
    const scope = { organization_id: 'private-organization', activity_id: 'private-activity', branch_id: null, warehouse_id: null };
    const identity = { actorId: 'private-actor', organizationId: scope.organization_id, nativeAccountId: 'wa_savana:tenant:1',
        coreAccountId: 'private-consumer-provider', generation: 'private-generation', expiresAt: until(60000) };
    const provider = { provider_ref: 'private-source-provider', activity_id: scope.activity_id, platform: 'catalog',
        external_tenant_id: 'private-source-account', label: 'المصدر المعتمد', installations: [{ installation_id: 'private-goods-installation', activity_id: scope.activity_id }] };
    const serviceFields = ['name', 'description', 'kind', 'status', 'category_key', 'attribute_schema_key', 'attributes'];
    const grantFields = ['name', 'description', 'sku', 'barcodes', 'base_unit', 'price', 'media'];
    const activity = { activity_id: scope.activity_id, scope, capability_grants: [{ person_ref: identity.actorId, provider_ref: provider.provider_ref,
        capability_code: 'offerings.manage', actions: ['read'], allowed_fields: serviceFields, resource_policy: 'activity', resource_refs: [], expires_at: until(60000) }] };
    let context = { identity, actorId: identity.actorId, revision: 'private-context-revision', validUntil: until(60000), consumerInstallationId: 'private-consumer-installation',
        selection: { scope, account: { provider_ref: identity.coreAccountId, platform: 'wa_savana' }, consumer_installation_id: 'private-consumer-installation' },
        raw: { activities: [activity], providers: [provider], service_registrations: [{ authority_domain: 'native.service_namespace', state: 'active', scope,
            provider_ref: provider.provider_ref, platform: provider.platform, external_tenant_id: provider.external_tenant_id,
            source_installation_id: 'private-service-installation', label: 'الخدمات المشتركة', expires_at: until(60000) }],
            existing: { grants: [{ type: 'read', active: true, expired: false, scope, expires_at: until(60000),
                source_installation_id: 'private-goods-installation', consumer_installation_id: 'private-consumer-installation', fields: grantFields,
                policy: { fields: grantFields, reader_account_ids: [identity.actorId] } }] } } };
    const canonicalId = 'private-core-product', localId = 'private-source-product', assetId = 'catalog:asset:1';
    const offeringRef = 'ce38ee02-4c88-42e3-bd4d-a4cb4b017095';
    const media = { asset_id: assetId, parent_source_local_id: localId, access_reference: 'private-access-reference', rights_reference: 'private-rights-reference' };
    const mapping = () => ({ context: { valid_until: until(30000) }, record: { entity_id: canonicalId, version: mappingVersion, scope,
        source: { installation_id: 'private-goods-installation', local_entity_id: localId }, source_revision: 1 } });
    const requests = [];
    const authorization = (kind, fields) => ({ scope, provider_ref: provider.provider_ref, source_platform: provider.platform,
        source_installation_id: kind === 'product' ? 'private-goods-installation' : 'private-service-installation', principal_kind: 'native_oidc',
        consumer_installation_id: context.consumerInstallationId, consumer_platform: 'wa_savana', allowed_fields: fields,
        authorization_revision: 'a'.repeat(64), valid_until: until(5000) });
    const source = kind => ({ platform: provider.platform, installation_id: kind === 'product' ? 'private-goods-installation' : 'private-service-installation',
        external_tenant_id: provider.external_tenant_id });
    const nativeRecord = (kind, fields) => {
        const data = kind === 'product' ? { name: 'منتج حالي من المصدر', description: 'وصف حالي', sku: 'CURRENT-SKU', barcodes: ['CURRENT-BARCODE'],
            base_unit: { code: 'kilogram', metadata_version: 3 }, variant_ref: null, media: [media], price_options: [{ option_ref: 'private-price-option',
                parent_source_local_id: localId, code: 'retail', process: 'purchase', pricing_model: 'fixed', amount: '12.500', currency: 'LYD', unit: 'kilogram' }] }
            : { name: 'خدمة حالية', description: 'وصف الخدمة', kind: 'service', status: 'active', category_key: 'services', attribute_schema_key: null, attributes: { duration: 'hour' } };
        return { scope, source: source(kind), source_local_id: kind === 'product' ? localId : offeringRef, native_revision: nativeRevision,
            observed_at: until(-10), resource_kind: kind, data: Object.fromEntries(fields.map(field => [field, data[field]])) };
    };
    const gateway = { now: () => now,
        metadata: value => ({ viewKey: digest(canonicalWorkspaceJson([value.identity, value.revision, value.selection])), valid_until: value.validUntil }),
        selected: async (_p, input) => { assert.equal(input.activity, 'opaque-activity-choice'); return { context: structuredClone(context), activity: { data: structuredClone(context.raw.activities[0]) } }; },
        loadContext: async () => { await loadHook(++loadCount); return structuredClone(context); },
        products: { record: async (_p, _c, _a, key) => { canonicalReads++; assert.equal(key, canonicalId); return structuredClone(mapping()); } },
        transport: { request: async (_p, input) => {
            requests.push(structuredClone(input)); const url = new URL(input.path, 'https://fixed-core.invalid');
            let payload;
            if (url.pathname.endsWith('/preview')) {
                const available = previewState === 'available';
                payload = { spec_version: '1.0', resource_ref: canonicalId, authorization: authorization('product', ['media']), source: source('product'),
                    preview: { spec_version: '1.0', context_fingerprint: 'b'.repeat(64), state: previewState, source_local_id: localId,
                        source_revision: nativeRevision, asset_id: assetId, access_reference: media.access_reference, rights_reference: media.rights_reference,
                        content_type: available ? 'image/png' : null, byte_length: available ? png.length : null, content_sha256: available ? digest(png) : null,
                        content_base64: available ? png.toString('base64') : null, checked_at: until(0), valid_until: until(5000), rights_active: available } };
            } else {
                const kind = url.searchParams.get('resource_kind'), fields = url.searchParams.get('fields').split(',');
                if (url.pathname === '/v1/integration/workspace/resources') payload = { spec_version: '1.0', resource_kind: 'offering',
                    authorization: authorization('offering', fields), records: [nativeRecord('offering', fields)], next_cursor: 'private-core-cursor' };
                else {
                    detailCount++; payload = { spec_version: '1.0', resource_kind: kind, resource_ref: kind === 'product' ? canonicalId : offeringRef,
                        authorization: authorization(kind, fields), record: nativeRecord(kind, fields), media_previews: kind === 'product' && fields.includes('media')
                            ? [{ asset_id: assetId, rights_reference: media.rights_reference, fetch_mode: 'authenticated_json_base64',
                                href: `/v1/integration/workspace/resources/${canonicalId}/media/${assetId}/preview?${new URLSearchParams({ activity_id: scope.activity_id,
                                    provider_ref: provider.provider_ref, resource_kind: 'product', ticket: `private-ticket-${detailCount}` })}`,
                                valid_until: until(2000), content_types: ['image/png'] }] : [] };
                }
            }
            await wireHook(payload, input); return { payload: structuredClone(payload) };
        } } };
    gateway.receipts = new WorkspaceReceipts({ database: db, encryption, verifyLocalPrincipal: () => true, now: gateway.now });
    gateway.refs = new WorkspaceReferences({ encryption, verifyLocalPrincipal: () => true, currentIdentity: async () => structuredClone(context.identity), now: gateway.now });
    gateway.sharedResourceReader = new WorkspaceSharedResourceReader({ gateway });
    const views = new WorkspaceSharedResourceViews({ gateway, enabled: true });
    const recordRef = gateway.refs.issue(principal, identity, { type: 'record', key: canonicalId, version: 7 });
    const product = () => views.product(principal, { activity: 'opaque-activity-choice', record: recordRef });
    return { db, encryption, gateway, views, product, recordRef, requests, scope,
        context: () => context, activity: () => context.raw.activities[0], canonicalReads: () => canonicalReads,
        change: fn => { context = structuredClone(context); fn(context); }, clock: value => { now = value; },
        onLoad: fn => { loadCount = 0; loadHook = fn; }, onWire: fn => { wireHook = fn; },
        withdraw: () => { previewState = 'withdrawn'; }, revise: () => { nativeRevision++; }, reversion: () => { mappingVersion++; } };
};

test('shared resource views stay disabled by default with no implicit activation or source requests', async t => {
    const f = fixture(t), disabled = new WorkspaceSharedResourceViews({ gateway: f.gateway });
    for (const method of ['offerings', 'offering', 'product', 'preview']) await assert.rejects(disabled[method](principal, {}), { code: 'workspace_resource_contract_unavailable', status: 503 });
    await assert.rejects(disabled.options(principal, f.context(), f.activity()), { code: 'workspace_resource_contract_unavailable', status: 503 });
    assert.equal(f.requests.length, 0);
});

test('offering search preserves the published Unicode query bound through the BFF and actual reader', async t => {
    const f = fixture(t), options = await f.views.options(principal, f.context(), f.activity());
    const q = '📦'.repeat(200), input = { activity: 'opaque-activity-choice', provider: options.providers[0].value, q };
    await f.views.offerings(principal, input);
    assert.equal(new URL(f.requests.at(-1).path, 'https://fixed-core.invalid').searchParams.get('q'), q);
    await assert.rejects(f.views.offerings(principal, { ...input, q: q + '📦' }), { code: 'workspace_request_invalid' });
});

test('product presentation retains actual business relations while hiding native IDs, media tuples, Core hrefs and tickets', async t => {
    const f = fixture(t), value = await f.product();
    assert.equal(value.record.resource_kind, 'product'); assert.equal(value.record.sourceLabel, 'المصدر المعتمد');
    assert.deepEqual(value.record.data.base_unit, { code: 'kilogram', metadata_version: 3 });
    assert.deepEqual(value.record.data.price_options, [{ code: 'retail', process: 'purchase', pricing_model: 'fixed', amount: '12.500', currency: 'LYD', unit: 'kilogram' }]);
    assert.equal(value.mediaCount, 1); assert.equal(value.previews.length, 1); assert.equal(value.previews[0].valid_until, until(2000));
    const publicBytes = JSON.stringify(value);
    for (const privatePart of ['private-', 'catalog:asset:1', 'option_ref', 'parent_source_local_id', 'access_reference', 'rights_reference', 'href', 'ticket', 'content_base64']) {
        assert.equal(publicBytes.includes(privatePart), false, privatePart);
    }
    assert.match(value.record.key, /^wr1\./); assert.match(value.previews[0].key, /^wr1\./);
    assert.equal(Object.hasOwn(value.record.data, 'media'), false);
    const rows = f.db.prepare('SELECT encrypted_payload FROM savana_workspace_receipts').all(); assert.equal(rows.length, 2);
    for (const row of rows) {
        assert.equal(row.encrypted_payload.includes('private-source-product'), false);
        const stored = f.encryption.decrypt(row.encrypted_payload);
        for (const absent of ['content_base64', 'private-ticket-', 'href', 'منتج حالي من المصدر', 'retail']) assert.equal(stored.includes(absent), false);
    }
});

test('offering provider/record/cursor selectors are opaque, scoped, persisted and resolved only as their own roles', async t => {
    const f = fixture(t), options = await f.views.options(principal, f.context(), f.activity());
    assert.equal(options.providers.length, 1); assert.equal(JSON.stringify(options).includes('private-'), false);
    const input = { activity: 'opaque-activity-choice', provider: options.providers[0].value, q: 'خدمة' };
    const list = await f.views.offerings(principal, input); assert.equal(list.records[0].data.kind, 'service');
    assert.equal(JSON.stringify(list).includes('private-core-cursor'), false); assert.match(list.cursor, /^wr1\./);
    const detail = await f.views.offering(principal, { activity: input.activity, resource: list.records[0].key });
    assert.equal(detail.record.data.name, 'خدمة حالية');
    await f.views.offerings(principal, { ...input, cursor: list.cursor });
    assert.equal(new URL(f.requests.at(-1).path, 'https://fixed-core.invalid').searchParams.get('cursor'), 'private-core-cursor');
    await assert.rejects(f.views.offerings(principal, { ...input, q: 'different', cursor: list.cursor }));
    await assert.rejects(f.views.offering(principal, { activity: input.activity, resource: options.providers[0].value }));
    assert.equal(Object.hasOwn(list.records[0].data, 'sku'), false);
});

test('preview reauthorizes canonical version and fresh live detail, uses a new ticket, and persists no image bytes', async t => {
    const f = fixture(t), product = await f.product();
    const value = await f.views.preview(principal, { activity: 'opaque-activity-choice', preview: product.previews[0].key });
    assert.deepEqual(value.bytes, png); assert.equal(value.contentType, 'image/png'); assert.equal(value.sha256, digest(png)); assert.equal(value.validUntil, until(2000));
    assert.equal(f.canonicalReads(), 2);
    const query = new URL(f.requests.at(-1).path, 'https://fixed-core.invalid').searchParams;
    assert.equal(query.get('ticket'), 'private-ticket-2');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_workspace_receipts').get().n, 2);
    for (const row of f.db.prepare('SELECT encrypted_payload FROM savana_workspace_receipts').all()) assert.equal(f.encryption.decrypt(row.encrypted_payload).includes(png.toString('base64')), false);
});

test('withdrawal returns explicit unavailability and never succeeds with old or empty image bytes', async t => {
    const f = fixture(t), product = await f.product(); f.withdraw();
    await assert.rejects(f.views.preview(principal, { activity: 'opaque-activity-choice', preview: product.previews[0].key }),
        { code: 'workspace_resource_media_unavailable', status: 404 });
    assert.equal(f.requests.filter(row => row.path.includes('/preview?')).length, 1);
});

test('expired/withdrawn selectors and changed canonical/native versions cannot reuse prior preview authorization', async t => {
    for (const change of [f => f.clock(at + 2000), f => f.change(context => { context.revision = 'withdrawn-context'; }), f => f.reversion(), f => f.revise()]) {
        const f = fixture(t), product = await f.product(); change(f);
        await assert.rejects(f.views.preview(principal, { activity: 'opaque-activity-choice', preview: product.previews[0].key }));
        assert.equal(f.requests.filter(row => row.path.includes('/preview?')).length, 0);
    }
});

test('final asynchronous expiry or permission withdrawal discards read data and image bytes', async t => {
    const f = fixture(t); f.onLoad(n => { if (n === 3) f.clock(at + 5000); });
    await assert.rejects(f.product(), { code: 'workspace_resource_read_expired' });
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_workspace_receipts').get().n, 0);
    const g = fixture(t), value = await g.product(); g.onLoad(n => { if (n === 5) g.clock(at + 2000); });
    await assert.rejects(g.views.preview(principal, { activity: 'opaque-activity-choice', preview: value.previews[0].key }), { code: 'workspace_resource_read_expired' });
    const h = fixture(t), previous = await h.product();
    h.onWire((_payload, input) => { if (input.path.includes('/preview?')) h.change(context => { context.raw.existing.grants[0].active = false; }); });
    await assert.rejects(h.views.preview(principal, { activity: 'opaque-activity-choice', preview: previous.previews[0].key }), { code: 'workspace_context_changed' });
});

test('retained v2: product exposes exact older per-field provenance including actual media-reference provenance without private tuples', async t => {
    const f = fixture(t), publication = { source_watermark: 9, field_versions: { name: 2, base_unit: 4, media: 1 },
        field_observed_at: { name: '2026-09-01T08:00:00Z', base_unit: '2026-10-10T09:30:00Z', media: '2026-08-07T12:00:00Z' } };
    f.onWire(payload => { payload.central_publication = structuredClone(publication); });
    const result = await f.product();
    assert.deepEqual(result.record.central_publication, publication); assert.equal(result.mediaCount, 1);
    assert.equal(result.record.observed_at, until(-10)); assert.equal(Object.hasOwn(result.record.data, 'media'), false);
    const publicBytes = JSON.stringify(result.record.central_publication);
    assert.equal(publicBytes.includes('private-'), false); assert.equal(publicBytes.includes('source_local_id'), false);
    for (const row of f.db.prepare('SELECT encrypted_payload FROM savana_workspace_receipts').all()) {
        const stored = f.encryption.decrypt(row.encrypted_payload);
        assert.equal(stored.includes('field_observed_at'), false); assert.equal(stored.includes('central_publication'), false);
    }
});

test('retained v2: offering list and detail move only their actual provenance onto opaque public records', async t => {
    const f = fixture(t), publication = { source_watermark: 9, field_versions: { name: 2 }, field_observed_at: { name: '2026-10-01T08:00:00Z' } };
    const options = await f.views.options(principal, f.context(), f.activity());
    f.onWire(payload => {
        if (payload.records) payload.central_publications = { [payload.records[0].source_local_id]: structuredClone(publication) };
        else payload.central_publication = structuredClone(publication);
    });
    const input = { activity: 'opaque-activity-choice', provider: options.providers[0].value };
    const list = await f.views.offerings(principal, input);
    assert.deepEqual(list.records[0].central_publication, publication); assert.equal(Object.hasOwn(list, 'central_publications'), false);
    assert.equal(JSON.stringify(list).includes('ce38ee02-4c88-42e3-bd4d-a4cb4b017095'), false);
    const detail = await f.views.offering(principal, { activity: input.activity, resource: list.records[0].key });
    assert.deepEqual(detail.record.central_publication, publication);
    assert.equal(Object.hasOwn(detail.record.central_publication.field_observed_at, 'description'), false);
});

test('retained v2: partial field replacements and absent provenance never merge prior data or media selectors', async t => {
    const f = fixture(t); let phase = 1;
    f.onWire(payload => {
        if (phase === 1) payload.central_publication = { source_watermark: 9, field_versions: { name: 2, description: 1 },
            field_observed_at: { name: '2026-10-01T08:00:00Z', description: '2026-09-01T08:00:00Z' } };
        else {
            payload.record.data = { name: 'اسم حالي بعد سحب الحقل' }; payload.media_previews = [];
            if (phase === 2) payload.central_publication = { source_watermark: 10, field_versions: { name: 3 }, field_observed_at: { name: '2026-10-20T08:00:00Z' } };
        }
    });
    const original = await f.product(); assert.equal(typeof original.record.data.description, 'string'); assert.equal(original.previews.length, 1);
    phase = 2; f.revise(); const replacement = await f.product();
    assert.deepEqual(replacement.record.data, { name: 'اسم حالي بعد سحب الحقل' });
    assert.deepEqual(replacement.record.central_publication.field_versions, { name: 3 });
    assert.equal(Object.hasOwn(replacement, 'mediaCount'), false); assert.deepEqual(replacement.previews, []);
    phase = 3; const noProvenance = await f.product();
    assert.equal(Object.hasOwn(noProvenance.record, 'central_publication'), false);
    assert.equal(Object.hasOwn(noProvenance.record.data, 'description'), false);
});

test('retained v2: authorized absence or withdrawal replaces prior offering data and has no prior-field fallback', async t => {
    const f = fixture(t), options = await f.views.options(principal, f.context(), f.activity());
    const input = { activity: 'opaque-activity-choice', provider: options.providers[0].value };
    const first = await f.views.offerings(principal, input); assert.equal(first.records.length, 1);
    f.onWire(payload => { payload.records = []; payload.next_cursor = null; payload.central_publications = {}; });
    const empty = await f.views.offerings(principal, input); assert.deepEqual(empty.records, []); assert.equal(empty.cursor, null);
    f.onWire(() => { throw Object.assign(new Error('Synthetic current retained access withdrawn'), { code: 'workspace_rejected', status: 403 }); });
    await assert.rejects(f.views.offerings(principal, input), { code: 'workspace_rejected', status: 403 });
    assert.equal(f.requests.length, 3);
});

test('retained v2: actual field-grant loss removes that field and its provenance from a fresh product view', async t => {
    const f = fixture(t);
    f.onWire(payload => { payload.central_publication = { source_watermark: 9, field_versions: { name: 2 }, field_observed_at: { name: '2026-10-01T08:00:00Z' } }; });
    const original = await f.product(); assert.equal(typeof original.record.data.description, 'string');
    f.change(context => {
        context.revision = 'current-without-description';
        context.raw.existing.grants[0].fields = context.raw.existing.grants[0].fields.filter(field => field !== 'description');
        context.raw.existing.grants[0].policy.fields = context.raw.existing.grants[0].policy.fields.filter(field => field !== 'description');
    });
    const fresh = await f.product();
    assert.equal(Object.hasOwn(fresh.record.data, 'description'), false);
    assert.equal(Object.hasOwn(fresh.record.central_publication.field_versions, 'description'), false);
    assert.equal(new URL(f.requests.at(-1).path, 'https://fixed-core.invalid').searchParams.get('fields').split(',').includes('description'), false);
});

test('retained v2: media-reference provenance never substitutes for current Native image rights', async t => {
    const f = fixture(t);
    f.onWire(payload => { if (payload.record) payload.central_publication = { source_watermark: 9, field_versions: { media: 1 },
        field_observed_at: { media: '2026-08-07T12:00:00Z' } }; });
    const original = await f.product(); assert.equal(original.record.central_publication.field_versions.media, 1);
    f.withdraw();
    await assert.rejects(f.views.preview(principal, { activity: 'opaque-activity-choice', preview: original.previews[0].key }),
        { code: 'workspace_resource_media_unavailable', status: 404 });
    assert.equal(f.requests.filter(row => row.path.includes('/preview?')).length, 1);
});
