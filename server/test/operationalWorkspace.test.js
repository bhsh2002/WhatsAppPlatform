import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { OperationalWorkspaceService } from '../services/operationalWorkspace.js';

const NOW = Date.parse('2026-11-18T12:00:01Z');
const principal = { tenantId: 1, userId: 1, role: 'tenant', authVersion: 0, sessionId: 'native-real-jwt-test', sessionExpiresAt: NOW / 1000 + 3600 };
const owner = { actorId: 'core-owner', organizationId: 'core-organization', generation: 'oidc-generation',
    accessToken: 'held-only-on-server', expiresAt: new Date(NOW + 900_000).toISOString() };
const initial = () => ({ spec_version: '1.0', organization: { id: owner.organizationId, name: 'المؤسسة التجريبية' },
    actor: { account_id: owner.actorId, display_name: 'المالك التجريبي' }, activities: [], providers: [],
    people: [{ person_ref: owner.actorId, display_name: 'المالك التجريبي' }], can_create_activity: true,
    command_options: [], capability_grant_options: [], service_registrations: [], service_shares: [], service_share_options: [], owner_action_origins: [], capabilities: [],
    policies: { fields: [{ value: 'name', label: 'اسم المنتج' }], operations: [], unit_codes: [], currencies: [], price_lists: [], channels: [] },
    existing: { requests: [], grants: [], origin_evidence: [] }, selection_revision: 'a'.repeat(64), approval_policy: 'Explicit current scoped actions' });
const fixture = (t, { sharedResourceReadsEnabled = false, useFinalReadDefault = false } = {}) => {
    const database = new Database(':memory:'); database.pragma('foreign_keys=ON');
    database.exec("CREATE TABLE tenants(id INTEGER PRIMARY KEY,name TEXT,status TEXT); CREATE TABLE users(id INTEGER PRIMARY KEY,tenant_id INTEGER); INSERT INTO tenants VALUES(1,'الحساب التجريبي','Active'); INSERT INTO users VALUES(1,1)");
    for (const migration of ['062_workspace_intents.sql', '066_workspace_receipts.sql', '067_workspace_review_fences.sql']) database.exec(fs.readFileSync(new URL(`../db/migrations/${migration}`, import.meta.url), 'utf8'));
    t.after(() => database.close());
    const key = crypto.randomBytes(32);
    const encryption = { encrypt(raw) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
        return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString('base64'); },
    decrypt(raw) { const bytes = Buffer.from(raw, 'base64'); const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        decipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString(); } };
    let current = true; let connected = true; let nativeBound = true; let rawContext = initial(); let dropBinding = false; let receipt = null;
    let clock = NOW; let currentOwner = structuredClone(owner); let bindingId = 'core-wa-account';
    let rawCommand = null, rawRecord = null; let resultHook = async () => {};
    let commandReadStatus = 200;
    let transformMutation = value => value, dropMutation = false;
    let captureHook = async () => {};
    let previewHook = value => value;
    let bindingLookupHook = async value => value;
    let selectedReceipt = null, selectionStatus = 200, providerReceipt = null;
    const mutationResponse = value => { if (dropMutation) throw new Error('Synthetic lost mutation acknowledgement after commit'); return Response.json(transformMutation(structuredClone(value))); };
    const calls = [];
    const setupService = { config: { enabled: true, centerOrigin: 'http://127.0.0.1:19502', platformToken: 'owned-platform-token', allowLoopback: true, oidcIssuer: 'http://127.0.0.1:19502' },
        appOrigin: 'http://127.0.0.1:19506', assertLocal() { if (!current) throw Object.assign(new Error(), { status: 403 }); },
        identity: async () => structuredClone(currentOwner), nativeAccount: async (_p, _o, { allowUnbound = false } = {}) => {
            if (!nativeBound && allowUnbound) return null;
            assert.equal(nativeBound, true); return { id: bindingId, organization_id: currentOwner.organizationId, platform_code: 'wa_savana', external_tenant_id: 'wa_savana:tenant:1', status: 'active' };
        }, store: { ownerSession: () => connected ? currentOwner : null, ownerCurrent: () => current,
            load: () => ({ consumerInstallationId: 'consumer-installation', scope: { organization_id: owner.organizationId, activity_id: 'shop-activity', branch_id: null, warehouse_id: null } }) } };
    const fetchImpl = async (url, options) => {
        const target = new URL(url); calls.push({ path: target.pathname, query: target.search, method: options.method, body: options.body, headers: { ...options.headers } });
        assert.equal(target.origin, 'http://127.0.0.1:19502'); assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, `Bearer ${currentOwner.accessToken}`);
        if (target.pathname.endsWith('/discovery')) return Response.json(structuredClone(rawContext));
        if (/\/workspace\/records(?:\/[^/]+)?$/.test(target.pathname)) {
            assert.equal(options.headers['X-Savana-Consumer-Installation'], 'consumer-installation');
            assert.equal(target.searchParams.get('activity_id'), rawRecord.scope.activity_id);
            const value = { domain: 'product.core', ownership_epoch: 1, expected_version: 0, source_revision: '1',
                entity_type: 'product', field_visibility: 'explicit_grants_only', observed_at: new Date(NOW).toISOString(), received_at: new Date(NOW).toISOString(), ...structuredClone(rawRecord),
                source: { entity_type: 'product', local_entity_id: 'catalog-native-product', ...rawRecord.source }, record_ref: rawRecord.entity_id, label: rawRecord.data.name };
            value.fields = Object.entries(value.data).map(([key, data]) => ({ key, label: key === 'name' ? 'اسم المنتج' : 'بيان المنتج', value: data,
                source_label: 'كتالوج المتجر', authoritative: true, observed_at: value.observed_at, received_at: value.received_at, freshness: value.freshness }));
            const optionsForRecord = rawContext.command_options.filter(row => row.action === 'product.change' && row.available).map(row => ({ ...row,
                record_ref: value.entity_id, record_version: value.version, source_installation_id: value.source.installation_id }));
            const readContext = { scope: value.scope, actor_id: currentOwner.actorId, consumer_platform: 'wa_savana', consumer_account_id: bindingId,
                consumer_installation_id: 'consumer-installation', checked_at: new Date(clock).toISOString(), valid_until: new Date(clock + 30_000).toISOString(),
                authorization_revision: 'd'.repeat(64), permissions: ['data.read'], freshness_max_age_seconds: 300 };
            return Response.json({ spec_version: '1.0', context: readContext, ...(target.pathname.endsWith('/records')
                ? { records: [value], has_more: false, next_cursor: null } : { record: { ...value, available_actions: optionsForRecord } }) });
        }
        if (target.pathname.endsWith('/selection/lookup')) return Response.json(selectionStatus === 200 ? selectedReceipt : { detail: { code: 'selection_changed' } }, { status: selectionStatus });
        if (target.pathname.endsWith('/selection')) {
            const body = JSON.parse(options.body), activity = rawContext.activities.find(row => row.activity_id === body.activity_id), provider = rawContext.providers.find(row => row.provider_ref === body.provider_ref);
            selectedReceipt = { spec_version: '1.0', selection_id: 'selection-receipt', selection_revision: rawContext.selection_revision, version: 1,
                organization: rawContext.organization, activity: { activity_id: activity.activity_id, label: activity.label }, scope: activity.scope,
                account: { provider_ref: provider.provider_ref, platform: provider.platform, label: provider.label, external_tenant_id: provider.external_tenant_id },
                consumer_installation_id: provider.installations[0]?.installation_id ?? null, current_scoped_actions: activity.my_actions, grants_created: false,
                next_action: { label: 'مراجعة الربط', href: '/?workspace=shared' } };
            return mutationResponse(selectedReceipt);
        }
        if (/\/providers\/[^/]+\/refresh$/.test(target.pathname)) {
            const providerRef = target.pathname.split('/').at(-2), provider = rawContext.providers.find(row => row.provider_ref === providerRef);
            return mutationResponse({ provider_ref: providerRef, activity_id: provider.activity_id,
                scope: rawContext.activities.find(row => row.activity_id === provider.activity_id).scope,
                enrollment_version: provider.enrollment_version, profile_version: 2, checked_at: new Date(clock).toISOString(),
                status: 'refreshed', grants_created: false });
        }
        if (/\/providers\/[^/]+\/(?:prepare|enrollment)$/.test(target.pathname)) {
            const providerRef = target.pathname.split('/').at(-2), provider = rawContext.providers.find(row => row.provider_ref === providerRef), activity = rawContext.activities.find(row => row.activity_id === provider.activity_id);
            providerReceipt ??= { provider_ref: providerRef, activity_id: activity.activity_id, scope: activity.scope, label: provider.label,
                enrollment_version: 2, enrollment: { enrollment_id: provider.enrollment_id, organization_id: currentOwner.organizationId,
                    platform: provider.platform, external_tenant_id: provider.external_tenant_id, display_name: 'الحساب التجريبي', version: 2,
                    accepted_scopes: ['savana.products.sync', 'savana.collaboration.v1'], public_key_fingerprint: 'f'.repeat(64) }, grants_created: false };
            const value = { ...providerReceipt, status: options.method === 'POST' ? 'prepared' : 'confirmed' };
            return options.method === 'POST' ? mutationResponse(value) : Response.json(value);
        }
        if (/\/commands\/[^/]+\/result$/.test(target.pathname)) {
            const bytes = Buffer.from(target.searchParams.get('format') === 'csv' ? 'status\naccepted\n' : '{"status":"accepted"}');
            await resultHook();
            return new Response(bytes, { headers: { 'Content-Type': target.searchParams.get('format') === 'csv' ? 'text/csv' : 'application/json',
                'X-Savana-Result-Sha256': crypto.createHash('sha256').update(bytes).digest('hex') } });
        }
        if (target.pathname.endsWith('/commands') && options.method === 'GET') return Response.json({ commands: rawCommand ? [structuredClone(rawCommand)] : [] });
        if (target.pathname.endsWith('/commands/preview')) {
            const body = JSON.parse(options.body);
            return Response.json(await previewHook({ spec_version: '1.0', valid: true, errors: [], normalized_payload: body.payload,
                validation_revision: 'owned-typed-product-preview', valid_until: new Date(clock + 120_000).toISOString(),
                allowed_fields: rawContext.command_options.find(row => row.action === body.action)?.allowed_fields || [], summary: [],
                capability: body.capability, action: body.action, action_label: 'طلب منتج' }));
        }
        if (/\/commands\/[^/]+$/.test(target.pathname) && options.method === 'GET') return Response.json(commandReadStatus === 200
            ? structuredClone(rawCommand) : { detail: { code: 'current_read_withdrawn' } }, { status: commandReadStatus });
        if (/\/commands\/[^/]+\/approve$/.test(target.pathname)) {
            assert.equal(JSON.parse(options.body).expected_version, rawCommand.version);
            rawCommand = { ...rawCommand, state: 'approved', reviewed_by: currentOwner.actorId, available_actions: [] };
            return mutationResponse(rawCommand);
        }
        if (/\/commands\/[^/]+$/.test(target.pathname) && options.method === 'PATCH') {
            const body = JSON.parse(options.body); assert.equal(body.expected_version, rawCommand.version);
            rawCommand = { ...rawCommand, version: rawCommand.version + 1, payload: body.payload, state: 'pending_review', reviewed_by: null, approval_fingerprint: null, source_result: null };
            return mutationResponse(rawCommand);
        }
        if (/\/commands\/[^/]+\/reject$/.test(target.pathname)) {
            rawCommand = { ...rawCommand, state: 'rejected', reviewed_by: currentOwner.actorId }; return mutationResponse(rawCommand);
        }
        if (/\/commands\/[^/]+\/reconcile$/.test(target.pathname)) return mutationResponse(rawCommand);
        if (/\/commands\/[^/]+\/dispatch$/.test(target.pathname)) {
            assert.equal(JSON.parse(options.body).expected_version, rawCommand.version);
            rawCommand = { ...rawCommand, state: 'source_pending', available_actions: ['reconcile', 'cancel'] };
            return mutationResponse(rawCommand);
        }
        if (/\/commands\/[^/]+\/cancel$/.test(target.pathname)) {
            assert.equal(JSON.parse(options.body).expected_version, rawCommand.version);
            rawCommand = { ...rawCommand, state: 'cancel_requested', available_actions: ['reconcile'] };
            return mutationResponse(rawCommand);
        }
        if (/\/requests\/[^/]+\/approve$/.test(target.pathname)) {
            const prior = rawContext.existing.requests[0]; assert.equal(JSON.parse(options.body).expected_version, prior.version);
            const approved = { ...prior, state: 'approved', reviewed_by: currentOwner.actorId, effective_version: prior.version,
                effective_resource: { ...prior.proposal, read_grant_id: 'read-grant', revision: 1, active: true } };
            rawContext.existing.requests[0] = approved; return mutationResponse(approved);
        }
        if (/\/requests\/[^/]+$/.test(target.pathname) && options.method === 'PATCH') {
            const body = JSON.parse(options.body), prior = rawContext.existing.requests[0];
            const updated = { ...prior, version: prior.version + 1, state: 'pending', reviewed_by: null,
                proposal: { source_installation_id: body.source_installation_ref, consumer_installation_id: body.consumer_installation_ref,
                    fields: body.fields, reader_account_ids: body.people_refs, expires_at: body.expires_at } };
            rawContext.existing.requests[0] = updated; return mutationResponse(updated);
        }
        if (/\/requests\/[^/]+\/reject$/.test(target.pathname)) {
            const prior = rawContext.existing.requests[0], rejected = { ...prior, state: 'rejected', reviewed_by: currentOwner.actorId, reason: JSON.parse(options.body).reason };
            rawContext.existing.requests[0] = rejected; return mutationResponse(rejected);
        }
        if (target.pathname.endsWith('/activities')) return Response.json({ activity_id: 'new-activity', label: JSON.parse(options.body).name, version: 1, grants_created: false, next_action: { label: 'اختيار النشاط', href: '/?workspace=shared' } });
        if (target.pathname.endsWith('/binding-requests/lookup')) {
            const value = await bindingLookupHook(structuredClone(receipt));
            return Response.json(value || {}, { status: value ? 200 : 404 });
        }
        if (target.pathname.endsWith('/binding-requests')) {
            const body = JSON.parse(options.body);
            receipt = { id: 'binding-request', platform_code: 'wa_savana', external_tenant_id: body.external_tenant_id,
                display_name: body.display_name, redirect_uri: body.redirect_uri, status: 'pending', organization_id: owner.organizationId,
                created_by_actor: owner.actorId, decided_by_actor: null, created_at: new Date(NOW).toISOString(), expires_at: new Date(NOW + 600_000).toISOString(),
                decided_at: null, organization_name: 'المؤسسة التجريبية', authorization_url: 'http://127.0.0.1:19502/?authorization_request=binding-request' };
            if (dropBinding) throw new Error('Owned synthetic connection lost after commit');
            return Response.json(receipt);
        }
        assert.fail(`Unimplemented test peer route ${target.pathname}`);
    };
    const service = new OperationalWorkspaceService({ database, encryption, setupService,
        readService: { record: async (_p, { entityId }) => { assert.equal(entityId, rawRecord.entity_id); return { record: structuredClone(rawRecord) }; } },
        nativeOwnerProofs: { capture: async () => { await captureHook(); return { recorded: true }; } }, verifyLocalPrincipal: () => current, fetchImpl, now: () => clock,
        ...(useFinalReadDefault ? {} : { sharedResourceReadsEnabled }) });
    return { service, database, calls, disconnect: () => { connected = false; }, unbind: () => { nativeBound = false; }, bind: () => { nativeBound = true; },
        changeContext: update => { rawContext = update(rawContext); }, dropBinding: () => { dropBinding = true; }, revoke: () => { current = false; },
        changeOwner: update => { currentOwner = { ...currentOwner, ...update }; }, changeBinding: value => { bindingId = value; },
        setCommand: value => { rawCommand = structuredClone(value); }, setRecord: value => { rawRecord = structuredClone(value); },
        command: () => structuredClone(rawCommand), setClock: value => { clock = value; }, resultHook: value => { resultHook = value; },
        commandReadStatus: value => { commandReadStatus = value; },
        transformMutation: value => { transformMutation = value; }, dropMutation: () => { dropMutation = true; },
        selectionStatus: value => { selectionStatus = value; }, selectionReceipt: update => { selectedReceipt = update(selectedReceipt); },
        providerReceipt: update => { providerReceipt = update(providerReceipt); }, captureHook: value => { captureHook = value; },
        previewHook: value => { previewHook = value; }, bindingReceipt: update => { receipt = update(structuredClone(receipt)); },
        bindingLookupHook: hook => { bindingLookupHook = hook; } };
};

test('disconnected owner view makes no peer call and never exposes a manual authority selector', async t => {
    const f = fixture(t); f.disconnect(); const result = await f.service.overview(principal);
    assert.equal(result.context.verified, false); assert.equal(result.held, true); assert.equal(f.calls.length, 0);
    assert.deepEqual(result.connection.choices.activities, []); assert.equal(JSON.stringify(result).includes(owner.accessToken), false);
});
test('actual Core actor/org can review native binding before any native Core account exists', async t => {
    const f = fixture(t); f.unbind(); const overview = await f.service.overview(principal);
    assert.equal(overview.context.verified, true); assert.equal(overview.context.connect.code, 'native_binding_required');
    const result = await f.service.reviewBinding(principal);
    assert.equal(result.review.canSubmit, true); assert.notEqual(result.review.intentKey, result.review.key);
    const submitted = await f.service.submit(principal, { review: result.review.key });
    assert.equal(submitted.state, 'completed'); assert.match(submitted.authorization_url, /^http:\/\/127\.0\.0\.1:19502\//);
    const mutation = f.calls.find(call => call.path.endsWith('/binding-requests'));
    assert.equal(JSON.parse(mutation.body).external_tenant_id, 'wa_savana:tenant:1');
    assert.equal((await f.service.intent(principal, { intent: result.review.intentKey })).intent.state, 'completed');
});

test('fresh OIDC owner can explicitly create the first permitted activity before native account binding without gaining grants', async t => {
    const f = fixture(t); f.unbind(); const overview = await f.service.overview(principal);
    assert.equal(overview.actions.find(row => row.key === 'activity.create').enabled, true);
    const result = await f.service.reviewActivity(principal, { name: 'نشاط أول' });
    assert.equal(f.calls.some(row => row.method === 'POST'), false);
    assert.deepEqual(await f.service.submit(principal, { review: result.review.key }), { state: 'completed' });
    assert.equal(f.calls.filter(row => row.method === 'POST').length, 1);
    assert.equal(f.service.receipts.list(principal, (await f.service.loadContext(principal)).identity, 'namespace').length, 0);
});
test('lost binding ACK is recovered by original readonly lookup with one POST across duplicate submits', async t => {
    const f = fixture(t); f.unbind(); f.dropBinding();
    const result = await f.service.reviewBinding(principal);
    await assert.rejects(f.service.submit(principal, { review: result.review.key }), { code: 'workspace_outcome_unknown' });
    assert.equal((await f.service.intent(principal, { intent: result.review.intentKey })).intent.state, 'completed');
    await f.service.submit(principal, { review: result.review.key });
    assert.equal(f.calls.filter(call => call.path.endsWith('/binding-requests')).length, 1);
    assert.equal(f.calls.filter(call => call.path.endsWith('/binding-requests/lookup')).length, 1);
});

test('binding authorization: completed original attempt resumes only from a fresh authenticated Core lookup', async t => {
    const f = fixture(t); f.unbind();
    const review = await f.service.reviewBinding(principal), submitted = await f.service.submit(principal, { review: review.review.key });
    const freshUrl = 'http://127.0.0.1:19502/?authorization_request=binding-request&navigation=current';
    f.bindingReceipt(value => ({ ...value, authorization_url: freshUrl }));
    const result = await f.service.bindingAuthorization(principal, { intent: review.review.intentKey });
    assert.equal(result.authorization_url, freshUrl); assert.notEqual(result.authorization_url, submitted.authorization_url);
    assert.deepEqual(result.intent, { key: review.review.intentKey, state: 'completed' }); assert.equal(result.binding_status, 'pending');
    const overview = await f.service.overview(principal);
    assert.equal(result.viewKey, overview.context.viewKey); assert.equal(result.native_reference, overview.context.native_reference);
    assert.ok(Date.parse(result.valid_until) > NOW); assert.ok(Date.parse(result.valid_until) <= Date.parse(overview.context.valid_until));
    assert.deepEqual(await f.service.intent(principal, { intent: review.review.intentKey }), { intent: { key: review.review.intentKey, state: 'completed' } });
    const post = f.calls.find(call => call.path.endsWith('/binding-requests')), lookup = f.calls.find(call => call.path.endsWith('/binding-requests/lookup'));
    assert.deepEqual(Object.fromEntries(new URLSearchParams(lookup.query)), { external_tenant_id: 'wa_savana:tenant:1', state: JSON.parse(post.body).state });
    assert.equal(lookup.method, 'GET'); assert.equal(lookup.headers.Authorization, `Bearer ${owner.accessToken}`);
    assert.equal(f.calls.filter(call => call.path.endsWith('/binding-requests')).length, 1);
    const before = f.calls.length;
    await assert.rejects(f.service.transport.request(principal, { path: '/v1/integration/workspace/commands' }), { status: 403 });
    assert.equal(f.calls.length, before);
});

test('binding authorization: lost ACK reconciles the same request and returns current navigation with only one POST', async t => {
    const f = fixture(t); f.unbind(); f.dropBinding();
    const review = await f.service.reviewBinding(principal);
    await assert.rejects(f.service.submit(principal, { review: review.review.key }), { code: 'workspace_outcome_unknown' });
    f.bindingReceipt(value => ({ ...value, authorization_url: 'http://127.0.0.1:19502/?authorization_request=binding-request&navigation=recovered' }));
    const result = await f.service.bindingAuthorization(principal, { intent: review.review.intentKey });
    assert.equal(result.intent.state, 'completed'); assert.match(result.authorization_url, /navigation=recovered$/);
    assert.equal(f.calls.filter(call => call.path.endsWith('/binding-requests')).length, 1);
    assert.equal(f.calls.filter(call => call.path.endsWith('/binding-requests/lookup')).length, 2);
    await f.service.bindingAuthorization(principal, { intent: review.review.intentKey });
    assert.equal(f.calls.filter(call => call.path.endsWith('/binding-requests')).length, 1);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_workspace_intents').get().n, 1);
});

test('binding authorization: unresolved Core lookup withholds navigation and never invents a completed attempt', async t => {
    const f = fixture(t); f.unbind(); f.dropBinding(); const review = await f.service.reviewBinding(principal);
    await assert.rejects(f.service.submit(principal, { review: review.review.key }), { code: 'workspace_outcome_unknown' });
    f.bindingLookupHook(() => null);
    await assert.rejects(f.service.bindingAuthorization(principal, { intent: review.review.intentKey }), { code: 'workspace_binding_authorization_unavailable', status: 409 });
    assert.equal(f.database.prepare('SELECT state FROM savana_workspace_intents').get().state, 'unknown');
    assert.equal(f.calls.filter(call => call.path.endsWith('/binding-requests')).length, 1);
});

test('binding authorization: rejection, expiry and approved/bound status never replay the original URL', async t => {
    for (const status of ['rejected', 'expired', 'approved']) {
        const f = fixture(t); f.unbind(); const review = await f.service.reviewBinding(principal);
        const original = await f.service.submit(principal, { review: review.review.key }); assert.ok(original.authorization_url);
        f.bindingReceipt(value => ({ ...value, status, expires_at: status === 'expired' ? new Date(NOW - 1).toISOString() : value.expires_at }));
        if (status === 'approved') f.bind();
        const result = await f.service.bindingAuthorization(principal, { intent: review.review.intentKey });
        assert.equal(result.binding_status, status); assert.equal(result.authorization_url, null); assert.equal(result.intent.state, 'completed');
    }
    const f = fixture(t); f.unbind(); const review = await f.service.reviewBinding(principal);
    await f.service.submit(principal, { review: review.review.key });
    f.bindingReceipt(value => ({ ...value, expires_at: new Date(NOW).toISOString() }));
    await assert.rejects(f.service.bindingAuthorization(principal, { intent: review.review.intentKey }), { code: 'workspace_binding_authorization_unavailable', status: 409 });
});

test('binding authorization: fresh lookup identity/request mismatches cannot supply navigation', async t => {
    for (const update of [{ id: 'foreign-binding-request' }, { external_tenant_id: 'foreign-native' }, { organization_id: 'foreign-org' }, { created_by_actor: 'foreign-actor' },
        { display_name: 'A different request' }, { redirect_uri: 'http://127.0.0.1:19506/different-callback' }, { authorization_url: 'https://foreign.invalid/authorize' }]) {
        const f = fixture(t); f.unbind(); const review = await f.service.reviewBinding(principal);
        await f.service.submit(principal, { review: review.review.key }); f.bindingReceipt(value => ({ ...value, ...update }));
        await assert.rejects(f.service.bindingAuthorization(principal, { intent: review.review.intentKey }), { status: 502 });
        assert.equal(f.calls.filter(call => call.path.endsWith('/binding-requests')).length, 1);
    }
});

test('binding authorization: changed identity, context or deadline after lookup withholds the fresh URL', async t => {
    for (const change of [f => f.changeOwner({ generation: 'new-owner-generation' }), f => f.revoke(),
        f => f.changeContext(value => ({ ...value, can_create_activity: false }))]) {
        const f = fixture(t); f.unbind(); const review = await f.service.reviewBinding(principal);
        await f.service.submit(principal, { review: review.review.key });
        f.bindingLookupHook(value => { change(f); return value; });
        await assert.rejects(f.service.bindingAuthorization(principal, { intent: review.review.intentKey }), { status: 403 });
    }
    const f = fixture(t); f.unbind(); const review = await f.service.reviewBinding(principal);
    await f.service.submit(principal, { review: review.review.key }); f.bindingReceipt(value => ({ ...value, expires_at: new Date(NOW + 1000).toISOString() }));
    f.bindingLookupHook(value => { f.setClock(NOW + 1000); return value; });
    await assert.rejects(f.service.bindingAuthorization(principal, { intent: review.review.intentKey }), { code: 'workspace_binding_authorization_unavailable', status: 409 });
});

test('binding authorization: absent/nonbinding/corrupted original attempts never query a substitute request', async t => {
    const f = fixture(t); f.unbind(); const context = await f.service.loadContext(principal);
    const missing = f.service.refs.issue(principal, context.identity, { type: 'intent', key: 'missing-original-attempt' });
    await assert.rejects(f.service.bindingAuthorization(principal, { intent: missing }), { code: 'workspace_intent_not_found', status: 404 });
    const activity = await f.service.reviewActivity(principal, { name: 'نشاط من الواجهة' }); await f.service.submit(principal, { review: activity.review.key });
    await assert.rejects(f.service.bindingAuthorization(principal, { intent: activity.review.intentKey }), { code: 'workspace_binding_authorization_not_applicable', status: 422 });
    const g = fixture(t); g.unbind(); const review = await g.service.reviewBinding(principal); await g.service.submit(principal, { review: review.review.key });
    const cipher = g.service.intents.cipher;
    g.service.intents.cipher = { ...cipher, decrypt(value) {
        const envelope = JSON.parse(cipher.decrypt(value));
        if (envelope.purpose === 'workspace_request') envelope.payload.bodyJson = JSON.stringify({ ...JSON.parse(envelope.payload.bodyJson), state: 'corrupted-original-state' });
        return JSON.stringify(envelope);
    } };
    await assert.rejects(g.service.bindingAuthorization(principal, { intent: review.review.intentKey }), { code: 'workspace_reconciliation_unverified', status: 409 });
    assert.equal(f.calls.filter(call => call.path.endsWith('/binding-requests/lookup')).length, 0);
    assert.equal(g.calls.filter(call => call.path.endsWith('/binding-requests/lookup')).length, 0);
});

test('nonbinding recovery: lost browser ACK for prebinding activity creation has explicit not-applicable proof and exact terminal metadata', async t => {
    const f = fixture(t); f.unbind(); const review = await f.service.reviewActivity(principal, { name: 'نشاط أُنشئ من الواجهة' });
    await f.service.submit(principal, { review: review.review.key }); // Server completed; the browser may miss this response.
    await assert.rejects(f.service.bindingAuthorization(principal, { intent: review.review.intentKey }),
        { code: 'workspace_binding_authorization_not_applicable', status: 422 });
    assert.deepEqual(await f.service.intent(principal, { intent: review.review.intentKey }),
        { intent: { key: review.review.intentKey, state: 'completed' } });
    assert.equal(f.calls.filter(call => call.path.endsWith('/activities') && call.method === 'POST').length, 1);
    assert.equal(f.calls.filter(call => call.path.endsWith('/binding-requests/lookup')).length, 0);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_workspace_intents').get().n, 1);
    f.changeOwner({ generation: 'different-current-identity' });
    await assert.rejects(f.service.bindingAuthorization(principal, { intent: review.review.intentKey }), { status: 403 });
});
test('changed current Core policy invalidates the immutable activity review before a mutation', async t => {
    const f = fixture(t); const result = await f.service.reviewActivity(principal, { name: 'نشاط تجريبي' });
    f.changeContext(context => ({ ...context, can_create_activity: false }));
    await assert.rejects(f.service.submit(principal, { review: result.review.key }), { code: 'workspace_choice_changed' });
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_workspace_intents').get().n, 0);
});
test('duplicate reviewed activity submit claims exactly once and never returns server credentials', async t => {
    const f = fixture(t); const result = await f.service.reviewActivity(principal, { name: 'نشاط تجريبي' });
    const first = await f.service.submit(principal, { review: result.review.key });
    const second = await f.service.submit(principal, { review: result.review.key });
    assert.deepEqual(first, { state: 'completed' }); assert.deepEqual(second, first);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(JSON.stringify([result, first, second]).includes(owner.accessToken), false);
});

const shopScope = () => ({ organization_id: owner.organizationId, activity_id: 'shop-activity', branch_id: null, warehouse_id: null });
const readPolicy = () => ({ source_installation_id: 'catalog-installation', consumer_installation_id: 'consumer-installation',
    fields: ['name'], reader_account_ids: [owner.actorId], expires_at: '2026-12-18T12:00:00Z' });
const sharingRequest = () => ({ request_id: 'sharing-request', organization_id: owner.organizationId, scope: shopScope(), version: 2, kind: 'read_sharing',
    state: 'pending', requested_by: owner.actorId, reviewed_by: null, effective_version: 1, reason: null,
    updated_at: new Date(NOW).toISOString(), approval_policy: 'Explicit scoped review', proposal: readPolicy(),
    effective_resource: { ...readPolicy(), fields: ['name', 'price'], reader_account_ids: [owner.actorId, 'other-reader'], read_grant_id: 'read-grant', revision: 1, active: true } });
const price = () => ({ amount: '10.125', currency: 'LYD', unit_code: 'bottle', price_list_id: 'retail-list', channel: 'store' });
const productCommand = extra => ({ command_id: 'product-command', organization_id: owner.organizationId, activity_id: 'shop-activity',
    provider_ref: 'catalog-account', capability: 'products.write', action: 'product.create', version: 4, state: 'pending_review', requested_by: owner.actorId,
    projection_state: 'not_applied', available_actions: ['edit', 'approve', 'reject'], updated_at: new Date(NOW).toISOString(),
    payload: { kind: 'goods', fields: { name: 'زيت مقترح', description: 'الوصف المقترح', sku: 'PENDING-CODE', base_unit: 'bottle', price: price() }, clear_fields: [] }, ...extra });
const sourceRecord = () => ({ entity_id: 'catalog-product', version: 6, scope: shopScope(), source: { installation_id: 'catalog-installation' },
    state: 'active', freshness: 'current', data: { name: 'اسم المصدر الحالي', description: 'وصف المصدر الحالي', sku: 'SOURCE-CODE', base_unit: 'bottle', price: price() } });
const configureShop = f => f.changeContext(base => ({ ...base,
    activities: [{ activity_id: 'shop-activity', label: 'متجر المدينة', scope: shopScope(), version: 1,
        my_actions: ['read.request', 'read.approve', 'read.manage', 'reviews.read', 'commands.read', 'commands.request', 'commands.approve', 'commands.reconcile'],
        can_manage_people: false, permissions: [], capability_grants: [] }],
    people: [...base.people, { person_ref: 'other-reader', display_name: 'سارة' }],
    providers: [{ provider_ref: 'catalog-account', tenant_ref: 'catalog-account', external_tenant_id: 'catalog:tenant:1', platform: 'catalog', label: 'كتالوج المتجر', activity_id: 'shop-activity',
        availability: { state: 'available', reason_code: 'configured', message: 'الخدمة متحققة', next_action: { code: 'review', label: 'مراجعة الطلب', href: '/portal/integrations' } },
        enrollment_id: 'catalog-enrollment', enrollment_version: 1, installations: [{ installation_id: 'catalog-installation', activity_id: 'shop-activity', label: 'منتجات المتجر' }],
        policy_choices: { unit_codes: [{ value: 'bottle', label: 'زجاجة' }], currencies: [{ value: 'LYD', label: 'دينار ليبي' }],
            price_lists: [{ value: 'retail-list', label: 'التجزئة' }], channels: [{ value: 'store', label: 'المتجر' }] } },
    { provider_ref: 'core-wa-account', tenant_ref: 'core-wa-account', external_tenant_id: 'wa_savana:tenant:1', platform: 'wa_savana', label: 'رسائل المتجر', activity_id: 'shop-activity',
        availability: { state: 'available', reason_code: 'configured', message: 'الخدمة متحققة', next_action: { code: 'review', label: 'مراجعة الطلب', href: '/portal/integrations' } },
        enrollment_id: 'wa-enrollment', enrollment_version: 1, installations: [{ installation_id: 'consumer-installation', activity_id: 'shop-activity', label: 'قراءة فريق الرسائل' }], policy_choices: {} }],
    policies: { ...base.policies, fields: [...base.policies.fields, { value: 'price', label: 'السعر' }], unit_codes: [{ value: 'bottle', label: 'زجاجة' }] },
    command_options: ['product.create', 'product.change'].map(action => ({ activity_id: 'shop-activity', provider_ref: 'catalog-account', capability: 'products.write', action,
        available: true, allowed_fields: ['name', 'description', 'sku', 'barcodes', 'base_unit', 'price', 'media'], reason_code: null, message: 'متاح للمراجعة',
        authorization_revision: 'a'.repeat(64), source_installation_id: 'catalog-installation',
        ...(action === 'product.change' ? { record_ref: 'catalog-product', record_version: 6 } : {}) })),
    existing: { ...base.existing, requests: [sharingRequest()], grants: [{ id: 'read-grant', grant_ref: 'read-grant', read_grant_id: 'read-grant', request_id: 'sharing-request',
        scope: shopScope(), revision: 1, active: true, expired: false, expires_at: readPolicy().expires_at, policy: readPolicy(), type: 'read', activity_id: 'shop-activity',
        source_label: 'كتالوج المتجر', consumer_label: 'رسائل المتجر', fields: ['name'], source_installation_id: 'catalog-installation', consumer_installation_id: 'consumer-installation' }] } }));
const firstCommand = async f => {
    const overview = await f.service.overview(principal);
    return (await f.service.commands(principal, { activity: overview.connection.selection.activity })).commands[0];
};
const selectedProductReadView = async f => {
    configureShop(f);
    f.setRecord({ ...sourceRecord(), data: { name: 'اسم المصدر المسموح' } });
    const initialView = await f.service.overview(principal);
    const selection = await f.service.reviewSelection(principal, { activity: initialView.connection.selection.activity });
    await f.service.submit(principal, { review: selection.review.key });
    return f.service.overview(principal);
};

test('final consumer overview uses the published default and explicit opt-out without inventing an offering grant', async t => {
    const disabled = fixture(t); configureShop(disabled);
    assert.equal(Object.hasOwn(await disabled.service.overview(principal), 'sharedResources'), false);
    await assert.rejects(disabled.service.resourceOfferings(principal, {}), { code: 'workspace_resource_contract_unavailable', status: 503 });
    const enabled = fixture(t, { useFinalReadDefault: true }); configureShop(enabled);
    const view = await enabled.service.overview(principal);
    const { sharedResourceOptionsIsValid } = await import('../../client/src/pages/TenantPortal/sharedResourceReadPresentation.js');
    assert.equal(sharedResourceOptionsIsValid(view.sharedResources), true);
    assert.equal(view.sharedResources.browseAction.enabled, false);
    assert.deepEqual(view.sharedResources.providers, []);
    assert.equal(enabled.calls.some(call => call.path.includes('/resources')), false);
});

test('provider readiness refresh is an explicit sealed operation with its original enrollment and no consumer override', async t => {
    const f = fixture(t); configureShop(f);
    const view = await f.service.overview(principal);
    const provider = view.connection.choices.providers.find(row => row.label.includes('كتالوج'));
    assert.equal(f.calls.some(row => row.path.endsWith('/refresh')), false);
    const review = await f.service.reviewProviderRefresh(principal, { provider: provider.value });
    assert.equal(f.calls.some(row => row.method === 'POST'), false);
    assert.deepEqual(await f.service.submit(principal, { review: review.review.key }), { state: 'completed' });
    assert.deepEqual(await f.service.submit(principal, { review: review.review.key }), { state: 'completed' });
    const requests = f.calls.filter(row => row.path.endsWith('/refresh'));
    assert.equal(requests.length, 1); assert.equal(requests[0].method, 'POST');
    assert.deepEqual(JSON.parse(requests[0].body), { activity_id: 'shop-activity' });
    assert.equal(requests[0].headers['X-Savana-Consumer-Installation'], undefined);
    assert.equal(f.service.receipts.list(principal, (await f.service.loadContext(principal)).identity, 'namespace').length, 0);
});

test('foreign or stale readiness acknowledgements cannot confirm the selected provider and never cause a retry', async t => {
    for (const mutation of [raw => ({ ...raw, provider_ref: 'other-provider' }), raw => ({ ...raw, enrollment_version: raw.enrollment_version + 1 }),
        raw => ({ ...raw, checked_at: new Date(NOW + 1).toISOString() })]) await t.test('unverified response', async child => {
        const f = fixture(child); configureShop(f); const view = await f.service.overview(principal);
        const provider = view.connection.choices.providers.find(row => row.label.includes('كتالوج'));
        const review = await f.service.reviewProviderRefresh(principal, { provider: provider.value });
        f.transformMutation(mutation);
        await assert.rejects(f.service.submit(principal, { review: review.review.key }), { code: 'workspace_response_invalid' });
        assert.equal((await f.service.intent(principal, { intent: review.review.intentKey })).intent.state, 'unknown');
        assert.equal(f.calls.filter(row => row.path.endsWith('/refresh')).length, 1);
    });
});

test('lost technical refresh acknowledgement stays unknown without a published original-operation proof or another POST', async t => {
    const f = fixture(t); configureShop(f); const view = await f.service.overview(principal);
    const provider = view.connection.choices.providers.find(row => row.label.includes('كتالوج'));
    const review = await f.service.reviewProviderRefresh(principal, { provider: provider.value }); f.dropMutation();
    await assert.rejects(f.service.submit(principal, { review: review.review.key }), { code: 'workspace_outcome_unknown' });
    assert.equal((await f.service.intent(principal, { intent: review.review.intentKey })).intent.state, 'unknown');
    await f.service.submit(principal, { review: review.review.key });
    assert.equal(f.calls.filter(row => row.path.endsWith('/refresh')).length, 1);
});

test('product review seals actual source-normalized preview and clips its review lifetime before any durable command', async t => {
    const f = fixture(t); configureShop(f); const view = await f.service.overview(principal);
    const provider = view.connection.choices.providers.find(row => row.label.includes('كتالوج'));
    f.previewHook(raw => ({ ...raw, normalized_payload: { ...raw.normalized_payload, fields: { name: 'اسم المصدر المنسّق' } },
        valid_until: new Date(NOW + 15_000).toISOString() }));
    const result = await f.service.reviewProduct(principal, { activity: view.connection.selection.activity, provider: provider.value, fields: { name: 'اسم مبدئي' } });
    const sealed = await f.service.choices.resolveReview(principal, result.review.key, 'command_create');
    assert.equal(sealed.payload.payload.fields.name, 'اسم المصدر المنسّق');
    assert.equal(result.review.valid_until, new Date(NOW + 15_000).toISOString());
    assert.equal(result.review.summary.some(row => row.value === 'اسم المصدر المنسّق'), true);
    assert.equal(f.calls.filter(row => row.method === 'POST' && !row.path.endsWith('/commands/preview')).length, 0);
    assert.equal(f.calls.find(row => row.path.endsWith('/commands/preview')).headers['X-Savana-Idempotency-Key'], undefined);
});

test('invalid, expired, mismatched or newly unauthorized previews expose no human review or durable operation', async t => {
    for (const mutate of [raw => ({ ...raw, valid: false }), raw => ({ ...raw, valid_until: new Date(NOW).toISOString() }),
        raw => ({ ...raw, action: 'product.change' }), raw => ({ ...raw, capability: 'customers.manage' }),
        raw => ({ ...raw, allowed_fields: [] }),
        raw => ({ ...raw, normalized_payload: { ...raw.normalized_payload, fields: { name: 'الاسم', sku: 'SOURCE-ADDED' } }, allowed_fields: ['name'] })])
        await t.test('preview rejected', async child => {
            const f = fixture(child); configureShop(f); const view = await f.service.overview(principal);
            const provider = view.connection.choices.providers.find(row => row.label.includes('كتالوج')); f.previewHook(mutate);
            const priorReviews = f.database.prepare('SELECT COUNT(*) AS n FROM savana_workspace_review_fences').get().n;
            await assert.rejects(f.service.reviewProduct(principal, { activity: view.connection.selection.activity, provider: provider.value, fields: { name: 'اسم' } }));
            assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM savana_workspace_review_fences').get().n, priorReviews);
            assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM savana_workspace_intents').get().n, 0);
            assert.equal(f.calls.some(row => row.method === 'POST' && !row.path.endsWith('/commands/preview')), false);
        });
});

test('source preview cannot switch a changed record or survive a withdrawal during the preview', async t => {
    const f = fixture(t); configureShop(f);
    const context = await f.service.loadContext(principal), activity = context.raw.activities[0], provider = context.raw.providers[0];
    const record = { ...sourceRecord(), available_actions: context.raw.command_options.filter(row => row.action === 'product.change') };
    const payload = { kind: 'goods', entity_id: record.entity_id, expected_record_version: record.version, fields: { name: 'اسم مراجع' }, clear_fields: [] };
    f.previewHook(raw => ({ ...raw, normalized_payload: { ...raw.normalized_payload, entity_id: 'other-record' } }));
    await assert.rejects(f.service.previewProduct(principal, context, activity, provider, payload, record), { code: 'workspace_product_preview_changed' });
    f.previewHook(raw => { f.changeContext(base => ({ ...base, command_options: [] })); return raw; });
    await assert.rejects(f.service.previewProduct(principal, context, activity, provider, payload, record), { code: 'workspace_product_preview_changed' });
    assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM savana_workspace_intents').get().n, 0);
});

test('historical command reads use actual current command permission after product write options disappear', async t => {
    const f = fixture(t); configureShop(f);
    f.setCommand(productCommand({ state: 'rejected', available_actions: [] }));
    f.changeContext(base => ({ ...base, command_options: [] }));
    const row = await firstCommand(f);
    assert.equal(row.state, 'rejected'); assert.ok(row.summary.some(value => value.value === 'زيت مقترح'));
    assert.equal(row.actions.every(action => action.enabled === false), true);
    assert.equal(f.calls.some(call => call.path.includes('/workspace/records')), false);
    f.commandReadStatus(403);
    await assert.rejects(f.service.command(principal, { command: row.key }), { code: 'workspace_rejected', status: 403 });
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
});

test('a source-filtered command read withdrawn during result fetch discards returned bytes without cached fallback', async t => {
    const f = fixture(t); configureShop(f);
    f.setCommand(productCommand({ state: 'source_applied', available_actions: [], projection_state: 'current',
        source_result: { local_entity_id: 'native-source-product', result_reference: 'source-receipt', source_revision: 6 } }));
    f.changeContext(base => ({ ...base, command_options: [] }));
    const row = await firstCommand(f);
    f.resultHook(async () => f.commandReadStatus(403));
    await assert.rejects(f.service.result(principal, { command: row.key, format: 'json' }), { code: 'workspace_rejected', status: 403 });
    assert.equal(f.calls.filter(call => call.path.endsWith('/result')).length, 1);
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
});

test('authorized product media metadata is visible by count without converting source references into image access', async t => {
    const f = fixture(t); configureShop(f);
    f.setCommand(productCommand({ state: 'rejected', available_actions: [], payload: { kind: 'goods', clear_fields: [],
        fields: { name: 'منتج بملف معتمد', media: [{ asset_id: 'source-asset-private', access_reference: 'source-access-private', rights_reference: 'source-rights-private' }] } } }));
    f.changeContext(base => ({ ...base, command_options: [] }));
    const row = await firstCommand(f), media = row.summary.find(item => item.label === 'صور المنتج');
    assert.match(media.value, /ملفات مرفقة مشتركة: 1/); assert.match(media.value, /عرض المحتوى غير متاح/);
    assert.equal(JSON.stringify(row).includes('source-asset-private'), false);
    assert.equal(JSON.stringify(row).includes('source-access-private'), false);
    assert.equal(JSON.stringify(row).includes('source-rights-private'), false);
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
});

for (const [scenario, elapsed, deadline] of [
    ['actual Core read expires before the owner view', 0, NOW + 30_000],
    ['existing owner view expires before a fresh Core read', 295_000, NOW + 300_000],
]) test(`shared product read expiry: list and detail preserve the earliest deadline when ${scenario}`, async t => {
    const f = fixture(t), view = await selectedProductReadView(f);
    assert.equal(view.context.valid_until, new Date(NOW + 300_000).toISOString());
    f.setClock(NOW + elapsed);
    const list = await f.service.records(principal, { activity: view.connection.selection.activity });
    const detail = await f.service.record(principal, { activity: view.connection.selection.activity, record: list.records[0].key });
    for (const response of [list, detail]) {
        assert.equal(response.valid_until, new Date(deadline).toISOString());
        assert.equal(response.viewKey, view.context.viewKey);
        assert.ok(Date.parse(response.valid_until) <= NOW + elapsed + 30_000);
        assert.ok(Date.parse(response.valid_until) <= Date.parse(view.context.valid_until));
    }
    assert.equal(list.records[0].label, 'اسم المصدر المسموح');
    assert.equal(detail.record.label, 'اسم المصدر المسموح');
});

test('shared product read expiry: an async list presentation cannot return expired source rows or a prior cached page', async t => {
    const f = fixture(t), view = await selectedProductReadView(f);
    const input = { activity: view.connection.selection.activity };
    const previous = await f.service.records(principal, input);
    assert.equal(previous.records[0].label, 'اسم المصدر المسموح');
    const present = f.service.presentRecord.bind(f.service);
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    f.service.presentRecord = async (...args) => {
        const record = await present(...args);
        enter();
        await blocked;
        return record;
    };
    const pending = f.service.records(principal, input);
    await entered;
    f.setClock(NOW + 30_001);
    release();
    await assert.rejects(pending, { code: 'workspace_context_changed', status: 403 });
    assert.equal(f.calls.filter(call => call.path.endsWith('/workspace/records')).length, 2);
    f.service.presentRecord = present;
    f.setRecord({ ...sourceRecord(), data: { name: 'قراءة مصدر جديدة بعد الانتهاء' } });
    const fresh = await f.service.records(principal, input);
    assert.equal(fresh.records[0].label, 'قراءة مصدر جديدة بعد الانتهاء');
    assert.equal(fresh.valid_until, new Date(NOW + 60_001).toISOString());
});

test('shared product read expiry: an async detail editor cannot expose expired record bytes or a prior cached detail', async t => {
    const f = fixture(t), view = await selectedProductReadView(f);
    const list = await f.service.records(principal, { activity: view.connection.selection.activity });
    const input = { activity: view.connection.selection.activity, record: list.records[0].key };
    const previous = await f.service.record(principal, input);
    assert.equal(previous.record.label, 'اسم المصدر المسموح');
    const productEditor = f.service.productEditor.bind(f.service);
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    f.service.productEditor = async (...args) => {
        const editor = await productEditor(...args);
        enter();
        await blocked;
        return editor;
    };
    const pending = f.service.record(principal, input);
    await entered;
    f.setClock(NOW + 30_001);
    release();
    await assert.rejects(pending, { code: 'workspace_context_changed', status: 403 });
    assert.equal(f.calls.filter(call => call.path.endsWith('/workspace/records/catalog-product')).length, 2);
    f.service.productEditor = productEditor;
    f.setRecord({ ...sourceRecord(), data: { name: 'تفاصيل مصدر جديدة بعد الانتهاء' } });
    const fresh = await f.service.record(principal, input);
    assert.equal(fresh.record.label, 'تفاصيل مصدر جديدة بعد الانتهاء');
    assert.equal(fresh.valid_until, new Date(NOW + 60_001).toISOString());
});

test('native setup stays available without a goods read grant and never advertises automatic browsing', async t => {
    const f = fixture(t); configureShop(f);
    f.changeContext(raw => ({ ...raw, existing: { ...raw.existing, grants: [] } }));
    const overview = await f.service.overview(principal);
    assert.equal(overview.context.verified, true); assert.equal(overview.sharedData.browseAction.enabled, false);
    assert.match(overview.sharedData.browseAction.reason, /إذن القراءة/);
    assert.equal(overview.actions.find(row => row.key === 'activity.select').enabled, true);
    await assert.rejects(f.service.records(principal, { activity: overview.connection.selection.activity }), { code: 'workspace_read_grant_required' });
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
});

test('approved unclaimed dispatch needs explicit review and recovers lost ACK through original command without another dispatch', async t => {
    const f = fixture(t); configureShop(f);
    f.changeContext(raw => ({ ...raw, activities: raw.activities.map(row => ({ ...row, my_actions: [...row.my_actions, 'commands.execute'] })) }));
    f.setCommand(productCommand({ state: 'approved', reviewed_by: owner.actorId, approval_fingerprint: 'b'.repeat(64), available_actions: ['dispatch', 'cancel'] }));
    const initial = await f.service.overview(principal);
    const selection = await f.service.reviewSelection(principal, { activity: initial.connection.selection.activity });
    await f.service.submit(principal, { review: selection.review.key });
    const command = await firstCommand(f);
    assert.equal(command.actions.find(row => row.key === 'dispatch').enabled, true);
    const review = await f.service.reviewCommandDispatch(principal, { command: command.key });
    assert.equal(f.calls.some(row => row.path.endsWith('/dispatch')), false); f.dropMutation();
    await assert.rejects(f.service.submit(principal, { review: review.review.key }), { code: 'workspace_outcome_unknown' });
    assert.equal((await f.service.intent(principal, { intent: review.review.intentKey })).intent.state, 'completed');
    assert.equal(f.calls.findLast(row => /\/commands\/[^/]+$/.test(row.path) && row.method === 'GET').headers['X-Savana-Consumer-Installation'], 'consumer-installation');
    assert.equal(f.calls.filter(row => row.path.endsWith('/dispatch')).length, 1);
    await assert.rejects(f.service.reviewCommandDispatch(principal, { command: command.key }), { code: 'workspace_dispatch_forbidden' });
    assert.equal(f.calls.filter(row => row.path.endsWith('/dispatch')).length, 1);
});

test('source-pending cancellation is reviewed, current-requester scoped and remains cancel_requested until actual no-effect proof', async t => {
    const f = fixture(t); configureShop(f);
    f.setCommand(productCommand({ state: 'source_pending', reviewed_by: owner.actorId, approval_fingerprint: 'b'.repeat(64), available_actions: ['cancel', 'reconcile'] }));
    const command = await firstCommand(f);
    const review = await f.service.reviewCommandCancel(principal, { command: command.key, reason: 'ألغى العميل الطلب' });
    assert.equal(f.calls.some(row => row.method === 'POST'), false);
    assert.deepEqual(await f.service.submit(principal, { review: review.review.key }), { state: 'completed' });
    const detail = await f.service.command(principal, { command: command.key });
    assert.equal(detail.command.state, 'cancel_requested'); assert.equal(detail.command.source_result.confirmed, false);
    assert.equal(f.calls.filter(row => row.path.endsWith('/cancel')).length, 1);
    f.setCommand(productCommand({ requested_by: 'another-owner', state: 'approved', available_actions: ['cancel'] }));
    const other = await firstCommand(f);
    await assert.rejects(f.service.reviewCommandCancel(principal, { command: other.key, reason: 'طلب آخر' }), { code: 'workspace_cancel_forbidden' });
    assert.equal(f.calls.filter(row => row.path.endsWith('/cancel')).length, 1);
});

test('explicit reviewed selection uses fresh Core lookup before private consumer header and withdraws it on current conflict', async t => {
    const f = fixture(t); configureShop(f);
    const overview = await f.service.overview(principal);
    assert.equal(overview.sharedData.browseAction.enabled, false);
    assert.equal(f.calls.some(call => call.headers['X-Savana-Consumer-Installation']), false);
    const review = await f.service.reviewSelection(principal, { activity: overview.connection.selection.activity });
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
    await f.service.submit(principal, { review: review.review.key });
    const current = await f.service.overview(principal);
    assert.equal(current.context.verified, true);
    assert.equal(current.sharedData.browseAction.enabled, true);
    const lookup = f.calls.findLast(call => call.path.endsWith('/selection/lookup'));
    const discovery = f.calls.findLast(call => call.path.endsWith('/discovery'));
    assert.match(lookup.query, /idempotency_key=/);
    assert.equal(lookup.headers['X-Savana-Consumer-Installation'], undefined);
    assert.equal(discovery.headers['X-Savana-Consumer-Installation'], 'consumer-installation');
    assert.equal(JSON.stringify(current).includes('consumer-installation'), false);
    f.selectionStatus(409);
    await f.service.overview(principal);
    assert.equal(f.calls.findLast(call => call.path.endsWith('/discovery')).headers['X-Savana-Consumer-Installation'], undefined);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
});

test('lost selection ACK recovers the original key once; a foreign returned account cannot provide a selector', async t => {
    const f = fixture(t); configureShop(f); f.dropMutation();
    const overview = await f.service.overview(principal);
    const review = await f.service.reviewSelection(principal, { activity: overview.connection.selection.activity });
    await assert.rejects(f.service.submit(principal, { review: review.review.key }), { code: 'workspace_outcome_unknown' });
    assert.equal((await f.service.intent(principal, { intent: review.review.intentKey })).intent.state, 'completed');
    await f.service.overview(principal);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
    f.selectionReceipt(row => ({ ...row, account: { ...row.account, provider_ref: 'foreign-account' } }));
    const count = f.calls.filter(call => call.path.endsWith('/discovery')).length;
    await assert.rejects(f.service.overview(principal), { code: 'workspace_context_changed' });
    assert.equal(f.calls.filter(call => call.path.endsWith('/discovery')).length, count);
});

test('Catalog provider confirmation is checked against its selected external account rather than the WA tenant', async t => {
    const f = fixture(t); configureShop(f); const overview = await f.service.overview(principal);
    const provider = overview.connection.choices.providers.find(row => row.label.includes('كتالوج'));
    const review = await f.service.reviewProvider(principal, { provider: provider.value });
    assert.deepEqual(await f.service.submit(principal, { review: review.review.key }), { state: 'completed' });
    const stored = f.database.prepare('SELECT state FROM savana_workspace_intents').get();
    assert.equal(stored.state, 'completed'); assert.equal(f.calls.filter(row => row.method === 'POST').length, 1);
});

test('lost native provider ACK accepts full readonly enrollment confirmation without another prepare or key replacement', async t => {
    const f = fixture(t); configureShop(f); const confirmations = [];
    f.service.setNativeEnrollmentService({ read: async context => {
        assert.equal(context.external_tenant_id, 'wa_savana:tenant:1');
        return { enrollments: [{ organization_id: owner.organizationId, external_tenant_id: context.external_tenant_id, enrollment_version: 1 }] };
    }, acceptVerifiedRegistration: async (context, options) => { confirmations.push({ context, options }); } });
    const overview = await f.service.overview(principal), provider = overview.connection.choices.providers.find(row => row.label.includes('رسائل'));
    const review = await f.service.reviewProvider(principal, { provider: provider.value }); f.dropMutation();
    await assert.rejects(f.service.submit(principal, { review: review.review.key }), { code: 'workspace_outcome_unknown' });
    assert.equal((await f.service.intent(principal, { intent: review.review.intentKey })).intent.state, 'completed');
    assert.equal(confirmations.length, 1); assert.equal(confirmations[0].options.expectedEnrollmentVersion, 1);
    assert.equal(confirmations[0].options.registration.version, 2);
    assert.equal(confirmations[0].context.actor_id, owner.actorId); assert.deepEqual(confirmations[0].context.activity_id, 'shop-activity');
    assert.equal(f.calls.filter(row => row.path.endsWith('/prepare')).length, 1);
    assert.equal(f.calls.filter(row => row.path.endsWith('/enrollment') && row.method === 'GET').length, 1);
    assert.equal((await f.service.intent(principal, { intent: review.review.intentKey })).intent.state, 'completed');
    assert.equal(confirmations.length, 1);
});

test('OIDC replacement during retained enrollment read prevents any old-session registration acceptance', async t => {
    const f = fixture(t); configureShop(f); let accepts = 0;
    f.service.setNativeEnrollmentService({ read: async () => {
        f.changeOwner({ generation: 'replacement-OIDC-session' });
        return { enrollments: [{ organization_id: owner.organizationId, external_tenant_id: 'wa_savana:tenant:1', enrollment_version: 1 }] };
    }, acceptVerifiedRegistration: async () => { accepts++; } });
    const overview = await f.service.overview(principal), provider = overview.connection.choices.providers.find(row => row.label.includes('رسائل'));
    const review = await f.service.reviewProvider(principal, { provider: provider.value });
    await assert.rejects(f.service.submit(principal, { review: review.review.key }), { code: 'workspace_context_changed' });
    assert.equal(accepts, 0); assert.equal(f.database.prepare('SELECT state FROM savana_workspace_intents').get().state, 'unknown');
    assert.equal(f.calls.filter(row => row.method === 'POST').length, 1);
});

test('mismatched readonly provider scope cannot close an unknown prepare or persist its enrollment', async t => {
    const f = fixture(t); configureShop(f); const overview = await f.service.overview(principal);
    const provider = overview.connection.choices.providers.find(row => row.label.includes('كتالوج'));
    const review = await f.service.reviewProvider(principal, { provider: provider.value }); f.dropMutation();
    await assert.rejects(f.service.submit(principal, { review: review.review.key }), { code: 'workspace_outcome_unknown' });
    f.providerReceipt(row => ({ ...row, scope: { ...row.scope, branch_id: 'foreign-branch' } }));
    assert.equal((await f.service.intent(principal, { intent: review.review.intentKey })).intent.state, 'unknown');
    assert.equal(f.calls.filter(row => row.method === 'POST').length, 1);
});

test('current request GETs, including concurrent GETs, retain one reviewed intent and full prior/proposed named access', async t => {
    const f = fixture(t); configureShop(f);
    const views = await Promise.all([f.service.overview(principal), f.service.overview(principal)]);
    const first = views[0].connection.requests[0], second = views[1].connection.requests[0];
    assert.equal(first.actions.find(action => action.key === 'approve').intentKey, second.actions.find(action => action.key === 'approve').intentKey);
    const detail = await f.service.request(principal, { request: first.key });
    assert.equal(detail.request.actions.find(action => action.key === 'approve').intentKey, first.actions.find(action => action.key === 'approve').intentKey);
    assert.equal(first.proposedSummary.find(row => row.label === 'البيانات').value, 'اسم المنتج');
    assert.equal(first.effectiveSummary.find(row => row.label === 'البيانات').value, 'اسم المنتج، السعر');
    assert.deepEqual(first.removedPeople, ['سارة']); assert.deepEqual(first.removedFields, ['السعر']);
    assert.equal(first.selection.people.length, 1); assert.equal(JSON.stringify(first).includes('other-reader'), false);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM savana_workspace_receipts WHERE kind='approval'").get().n, 1);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_workspace_intents').get().n, 0);
});

test('request approval dispatches only its exact preissued intent; a different operation cannot substitute', async t => {
    const f = fixture(t); configureShop(f);
    const overview = await f.service.overview(principal); const row = overview.connection.requests[0];
    const other = await f.service.reviewActivity(principal, { name: 'نشاط آخر' });
    await assert.rejects(f.service.approveRequest(principal, { request: row.key, intent: other.review.intentKey }));
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
    const intent = row.actions.find(action => action.key === 'approve').intentKey;
    await f.service.approveRequest(principal, { request: row.key, intent });
    assert.equal(f.calls.filter(call => /\/requests\/[^/]+\/approve$/.test(call.path)).length, 1);
    assert.equal((await f.service.intent(principal, { intent })).intent.state, 'completed');
});

test('same request version in changed context issues a distinct review and fences the earlier unsent intent', async t => {
    const f = fixture(t); configureShop(f);
    const first = (await f.service.overview(principal)).connection.requests[0]; const oldIntent = first.actions.find(action => action.key === 'approve').intentKey;
    f.changeContext(base => ({ ...base, activities: base.activities.map(row => ({ ...row, label: 'اسم النشاط الحالي' })) }));
    const next = (await f.service.overview(principal)).connection.requests[0]; const newIntent = next.actions.find(action => action.key === 'approve').intentKey;
    assert.notEqual(oldIntent, newIntent);
    await assert.rejects(f.service.approveRequest(principal, { request: first.key, intent: oldIntent }));
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
    assert.equal((await f.service.intent(principal, { intent: oldIntent })).intent.state, 'failed');
    assert.equal((await f.service.intent(principal, { intent: newIntent })).intent.state, 'reviewed');
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM savana_workspace_receipts WHERE kind='approval'").get().n, 2);
});

test('same actor/org and command version cannot use an approval reviewed under a different native Core binding', async t => {
    const f = fixture(t); configureShop(f); f.setCommand(productCommand());
    const old = await firstCommand(f); const oldIntent = old.actions.find(action => action.key === 'approve').intentKey;
    f.changeBinding('different-current-core-account');
    const next = await firstCommand(f); assert.notEqual(next.actions.find(action => action.key === 'approve').intentKey, oldIntent);
    await assert.rejects(f.service.approve(principal, { command: old.key, intent: oldIntent }));
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
});

test('typed pending product creation editor uses proposal values and preserves unmodified fields in the exact reviewed replacement', async t => {
    const f = fixture(t); configureShop(f); f.setCommand(productCommand());
    const row = await firstCommand(f); const detail = await f.service.command(principal, { command: row.key });
    assert.equal(detail.command.actions.find(action => action.key === 'approve').intentKey, row.actions.find(action => action.key === 'approve').intentKey);
    assert.equal(detail.productEditor.mode, 'change'); assert.equal(detail.productEditor.draft.name, 'زيت مقترح');
    assert.notEqual(detail.productEditor.draft.base_unit, 'bottle'); assert.equal(detail.productEditor.draft.price.amount, '10.125');
    const result = await f.service.reviewCommandEdit(principal, { command: row.key, fields: { description: 'وصف معدّل' }, clearFields: ['sku'] });
    const sealed = await f.service.choices.resolveReview(principal, result.review.key, 'command_edit');
    assert.deepEqual(sealed.payload.payload.fields, { name: 'زيت مقترح', description: 'وصف معدّل', base_unit: 'bottle', price: price() });
    assert.deepEqual(sealed.payload.payload.clear_fields, []); assert.equal(sealed.payload.expected_version, 4);
    assert.equal(result.review.summary.find(item => item.label === 'قبل التعديل: الوصف').value, 'الوصف المقترح');
    assert.equal(result.review.summary.find(item => item.label === 'بعد التعديل: الوصف').value, 'وصف معدّل');
    assert.ok(result.review.summary.some(item => item.label === 'بعد التعديل: السعر' && item.value.includes('10.125 دينار ليبي / زجاجة / التجزئة / المتجر')));
    assert.equal(f.calls.some(call => call.method === 'POST' && !call.path.endsWith('/commands/preview')), false);
});

test('pending product change merge retains old clears and fields, replaces explicit values and checks current source base', async t => {
    const f = fixture(t); configureShop(f); f.setRecord(sourceRecord());
    const view = await f.service.overview(principal);
    const selected = await f.service.reviewSelection(principal, { activity: view.connection.selection.activity });
    await f.service.submit(principal, { review: selected.review.key });
    f.setCommand(productCommand({ action: 'product.change', payload: { kind: 'goods', entity_id: 'catalog-product', expected_record_version: 6,
        fields: { name: 'اسم مقترح', description: 'وصف مقترح', sku: 'PENDING-CODE' }, clear_fields: ['price', 'barcodes'] } }));
    const row = await firstCommand(f); const detail = await f.service.command(principal, { command: row.key });
    assert.equal(detail.productEditor.draft.name, 'اسم مقترح'); assert.equal(detail.productEditor.draft.sku, 'PENDING-CODE');
    assert.equal(Object.hasOwn(detail.productEditor.draft, 'price'), false);
    const result = await f.service.reviewCommandEdit(principal, { command: row.key,
        fields: { description: 'وصف نهائي', price: { amount: '8.125', choice: detail.productEditor.priceChoices[0].value } }, clearFields: ['sku'] });
    const sealed = await f.service.choices.resolveReview(principal, result.review.key, 'command_edit');
    assert.deepEqual(sealed.payload.payload, { kind: 'goods', entity_id: 'catalog-product', expected_record_version: 6,
        fields: { name: 'اسم مقترح', description: 'وصف نهائي', price: { ...price(), amount: '8.125' } }, clear_fields: ['barcodes', 'sku'] });
    assert.ok(result.review.summary.some(item => item.label === 'بعد التعديل: الباركود' && item.value.includes('مسح')));
    f.setRecord({ ...sourceRecord(), version: 7 });
    await assert.rejects(f.service.reviewCommandEdit(principal, { command: row.key, fields: { description: 'تغيير قديم' } }), { code: 'workspace_product_base_changed' });
    assert.equal(f.calls.filter(call => call.method === 'POST' && !call.path.endsWith('/commands/preview')).length, 1); // Explicit activity selection only.
    assert.equal(f.calls.some(call => call.path.includes('/v1/integration/data/')), false);
});

test('changed field authority or malformed replacement cannot silently drop or clear pending fields', async t => {
    const f = fixture(t); configureShop(f); f.setCommand(productCommand()); const row = await firstCommand(f);
    await assert.rejects(f.service.reviewCommandEdit(principal, { command: row.key, fields: {}, clearFields: [] }), { code: 'workspace_product_invalid' });
    await assert.rejects(f.service.reviewCommandEdit(principal, { command: row.key, fields: { description: 'value' }, clearFields: ['description'] }), { code: 'workspace_product_invalid' });
    f.changeContext(base => ({ ...base, command_options: base.command_options.map(option => ({ ...option, allowed_fields: ['name'] })) }));
    await assert.rejects(f.service.reviewCommandEdit(principal, { command: row.key, fields: { name: 'اسم آخر' } }), { code: 'workspace_product_invalid' });
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
});

test('actual confirmed result links use opaque command refs and download bytes are discarded after permission changes', async t => {
    const f = fixture(t); configureShop(f); f.setCommand(productCommand({ state: 'source_applied', available_actions: [], projection_state: 'current',
        source_result: { local_entity_id: 'catalog-product', result_reference: 'source-receipt', source_revision: 6 } }));
    const row = await firstCommand(f); assert.deepEqual(row.resultActions.map(item => item.format), ['json', 'csv']);
    assert.equal(row.resultActions.some(item => item.href.includes('product-command')), false);
    const result = await f.service.result(principal, { command: row.key, format: 'csv' });
    assert.equal(result.contentType, 'text/csv'); assert.equal(result.bytes.toString(), 'status\naccepted\n');
    f.resultHook(async () => f.changeContext(base => ({ ...base, activities: base.activities.map(item => ({ ...item, my_actions: [] })) })));
    await assert.rejects(f.service.result(principal, { command: row.key, format: 'json' }), { code: 'workspace_command_read_forbidden' });
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
});

test('review-only status is not an active intent and missing unregistered keys remain unknown rather than fake no-effect', async t => {
    const f = fixture(t); const review = await f.service.reviewActivity(principal, { name: 'نشاط مراجع' });
    assert.equal((await f.service.intent(principal, { intent: review.review.intentKey })).intent.state, 'reviewed');
    assert.equal((await f.service.overview(principal)).held, false);
    const identity = await f.service.transport.currentIdentity(principal);
    const missing = f.service.refs.issue(principal, identity, { type: 'intent', key: 'never-registered-key' });
    await assert.rejects(f.service.intent(principal, { intent: missing }), { code: 'workspace_intent_not_found', status: 404 });
    f.setClock(NOW + 300_000);
    assert.equal((await f.service.intent(principal, { intent: review.review.intentKey })).intent.state, 'failed');
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
});

test('owner view survives the old late thirty-second boundary, renews only at actual expiry and invalidates on source changes', async t => {
    const f = fixture(t); const first = await f.service.overview(principal);
    const review = await f.service.reviewActivity(principal, { name: 'نشاط يحتاج مراجعة' });
    assert.equal(first.context.valid_until, new Date(NOW + 300_000).toISOString());
    f.setClock(NOW + 29_500);
    const boundary = await f.service.overview(principal);
    assert.equal(boundary.context.viewKey, first.context.viewKey); assert.equal(boundary.context.valid_until, first.context.valid_until);
    assert.equal((await f.service.choices.resolveReview(principal, review.review.key, 'activity')).payload.name, 'نشاط يحتاج مراجعة');
    f.setClock(NOW + 300_000);
    const renewed = await f.service.overview(principal);
    assert.notEqual(renewed.context.viewKey, first.context.viewKey); assert.equal(renewed.context.valid_until, new Date(NOW + 600_000).toISOString());
    assert.equal((await f.service.intent(principal, { intent: review.review.intentKey })).intent.state, 'failed');
    const current = await f.service.reviewActivity(principal, { name: 'نشاط حالي' });
    f.changeContext(base => ({ ...base, can_create_activity: false }));
    const withdrawn = await f.service.overview(principal); assert.notEqual(withdrawn.context.viewKey, renewed.context.viewKey);
    await assert.rejects(f.service.submit(principal, { review: current.review.key }), { code: 'workspace_choice_changed' });
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
});

const prepareMutation = async (f, operation) => {
    if (operation.startsWith('command_')) {
        const row = await firstCommand(f);
        if (operation === 'command_approve') {
            const intent = row.actions.find(action => action.key === 'approve').intentKey;
            return { intent, dispatch: () => f.service.approve(principal, { command: row.key, intent }) };
        }
        const reviewed = operation === 'command_edit'
            ? await f.service.reviewCommandEdit(principal, { command: row.key, fields: { description: 'التعديل المراجع' } })
            : await f.service.reviewCommandReject(principal, { command: row.key, reason: 'الغرض غير مناسب' });
        return { intent: reviewed.review.intentKey, dispatch: () => f.service.submit(principal, { review: reviewed.review.key }) };
    }
    const row = (await f.service.overview(principal)).connection.requests[0];
    if (operation === 'request_approve') {
        const intent = row.actions.find(action => action.key === 'approve').intentKey;
        return { intent, dispatch: () => f.service.approveRequest(principal, { request: row.key, intent }) };
    }
    const reviewed = operation === 'request_edit' ? await f.service.reviewRequestEdit(principal, { request: row.key, ...row.selection })
        : await f.service.reviewRequestReject(principal, { request: row.key, reason: 'الغرض غير مناسب' });
    return { intent: reviewed.review.intentKey, dispatch: () => f.service.submit(principal, { review: reviewed.review.key }) };
};

test('schema-valid same-org foreign targets and stale versions remain UNKNOWN across versioned mutable command/request families', async t => {
    for (const operation of ['command_approve', 'command_edit', 'command_reject', 'request_approve', 'request_edit', 'request_reject']) {
        for (const mismatch of ['target', 'version']) await t.test(`${operation}:${mismatch}`, async child => {
            const f = fixture(child); configureShop(f); f.setCommand(productCommand());
            const prepared = await prepareMutation(f, operation);
            f.transformMutation(raw => {
                if (mismatch === 'target') return { ...raw, [operation.startsWith('command_') ? 'command_id' : 'request_id']: 'same-org-other-resource' };
                const result = { ...raw, version: raw.version - 1 };
                if (operation === 'request_approve') result.effective_version = result.version;
                if (operation === 'request_reject') { result.effective_version = null; result.effective_resource = null; }
                return result;
            });
            await assert.rejects(prepared.dispatch(), { code: 'workspace_response_invalid' });
            const rows = f.database.prepare('SELECT state,operation FROM savana_workspace_intents').all();
            assert.deepEqual(rows, [{ state: 'unknown', operation }]);
            assert.equal(f.calls.filter(call => ['POST', 'PATCH'].includes(call.method) && !call.path.endsWith('/commands/preview')).length, 1);
        });
    }
});

test('lost versioned acknowledgements reconcile exact current target/version/payload/actor by readonly proof without replay', async t => {
    for (const operation of ['command_approve', 'command_edit', 'command_reject', 'request_approve', 'request_edit', 'request_reject']) await t.test(operation, async child => {
        const f = fixture(child); configureShop(f); f.setCommand(productCommand());
        const prepared = await prepareMutation(f, operation); f.dropMutation();
        await assert.rejects(prepared.dispatch(), { code: 'workspace_outcome_unknown' });
        assert.equal(f.database.prepare('SELECT state FROM savana_workspace_intents').get().state, 'unknown');
        assert.equal((await f.service.intent(principal, { intent: prepared.intent })).intent.state, 'completed');
        assert.equal(f.calls.filter(call => ['POST', 'PATCH'].includes(call.method) && !call.path.endsWith('/commands/preview')).length, 1);
    });
});

test('later command versions with changed payload cannot fabricate the historical lost edit outcome', async t => {
    const f = fixture(t); configureShop(f); f.setCommand(productCommand());
    const prepared = await prepareMutation(f, 'command_edit'); f.dropMutation();
    await assert.rejects(prepared.dispatch(), { code: 'workspace_outcome_unknown' });
    const actual = f.command();
    f.setCommand({ ...actual, version: actual.version + 1, payload: { ...actual.payload, fields: { ...actual.payload.fields, name: 'تعديل لاحق مستقل' } } });
    assert.equal((await f.service.intent(principal, { intent: prepared.intent })).intent.state, 'unknown');
    assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
});

test('namespace and selection receipts bind reviewed activity/provider/account/enrollment before they can be persisted', async t => {
    const f = fixture(t); configureShop(f); const context = await f.service.loadContext(principal);
    const expiry = '2026-12-18T12:00:00Z';
    const payload = { activity_id: 'shop-activity', provider_ref: 'core-wa-account', expected_enrollment_version: 1, expected_version: 0, expires_at: expiry };
    const reviewed = await f.service.review(principal, context, 'namespace', payload, [{ label: 'الخدمة', value: 'رسائل المتجر' }]);
    const reference = await f.service.refs.resolve(principal, reviewed.review.intentKey, 'intent');
    const namespace = { spec_version: '1.0', namespace_id: 'namespace-one', organization_id: owner.organizationId, scope: shopScope(), provider_ref: 'core-wa-account',
        platform: 'wa_savana', external_tenant_id: 'wa_savana:tenant:1', label: 'رسائل المتجر', source_installation_id: 'native-installation',
        enrollment_id: 'wa-enrollment', enrollment_version: 1, authority_domain: 'native.service_namespace', ownership_epoch: 1, version: 1, state: 'active',
        expires_at: expiry, native_authority_revision: 'native-owner-revision', grants_created: false, product_credentials_created: false, resource_authority_created: false };
    assert.equal(f.service.assertCorrelatedResult(principal, context.identity, 'namespace', reference.key, namespace), namespace);
    const equivalent = { ...namespace, expires_at: new Date(payload.expires_at).toISOString().replace('Z', '+00:00') };
    assert.equal(f.service.assertCorrelatedResult(principal, context.identity, 'namespace', reference.key, equivalent), equivalent);
    for (const change of [{ provider_ref: 'other-wa-account' }, { enrollment_id: 'other-enrollment' }, { enrollment_version: 2 },
        { version: 2 }, { expires_at: '2026-12-19T12:00:00Z' }, { scope: { ...shopScope(), branch_id: 'other-branch' } }]) {
        assert.throws(() => f.service.assertCorrelatedResult(principal, context.identity, 'namespace', reference.key, { ...namespace, ...change }), { code: 'workspace_response_invalid' });
    }
    const selected = await f.service.review(principal, context, 'selection', { activity_id: 'shop-activity', provider_ref: 'core-wa-account',
        external_tenant_id: 'wa_savana:tenant:1', expected_selection_revision: context.raw.selection_revision }, [{ label: 'النشاط', value: 'متجر المدينة' }]);
    const selector = await f.service.refs.resolve(principal, selected.review.intentKey, 'intent');
    const response = { scope: shopScope(), activity: { activity_id: 'shop-activity' }, account: { provider_ref: 'core-wa-account', external_tenant_id: 'wa_savana:tenant:1', platform: 'wa_savana' } };
    assert.equal(f.service.assertCorrelatedResult(principal, context.identity, 'selection', selector.key, response), response);
    assert.throws(() => f.service.assertCorrelatedResult(principal, context.identity, 'selection', selector.key,
        { ...response, account: { ...response.account, provider_ref: 'other-same-org-account' } }), { code: 'workspace_response_invalid' });
    assert.equal(f.service.receipts.list(principal, context.identity, 'namespace').length, 0);
    assert.equal(f.service.receipts.list(principal, context.identity, 'selection').length, 0);
});

test('CRM-only current grant supplies literal fields/resources with no communication prerequisite or cross-grant union', async t => {
    const f = fixture(t); configureShop(f);
    const grant = { person_ref: owner.actorId, provider_ref: 'core-wa-account', capability_code: 'customers.manage', actions: ['request'],
        allowed_fields: ['phone', 'profile_name'], resource_refs: ['native_contacts', 'native_contact:1'], resource_policy: 'selected', expires_at: '2026-11-18T12:02:00Z', version: 1 };
    f.changeContext(base => ({ ...base, activities: base.activities.map(row => ({ ...row, capability_grants: [grant] })) }));
    const activityRef = (await f.service.overview(principal)).connection.selection.activity;
    const actual = await f.service.verifyOwnerContext({ principal, activityRef, action: 'customers.manage', capabilityId: 'customers.manage' });
    assert.deepEqual(actual.viewer.allowedFields, grant.allowed_fields); assert.deepEqual(actual.viewer.resourceRefs, grant.resource_refs);
    assert.equal(actual.viewer.resourcePolicy, 'selected'); assert.equal(Date.parse(actual.viewer.validUntil), Date.parse(grant.expires_at));
    f.changeContext(base => ({ ...base, activities: base.activities.map(row => ({ ...row, capability_grants: [grant, { ...grant, allowed_fields: ['notes'] }] })) }));
    const ambiguous = (await f.service.overview(principal)).connection.selection.activity;
    await assert.rejects(f.service.verifyOwnerContext({ principal, activityRef: ambiguous, action: 'customers.manage', capabilityId: 'customers.manage' }),
        { code: 'workspace_native_grant_selection_required' });
});

test('consent prerequisite requires its own exact fields and both selected account/contact, without a message or command-request grant', async t => {
    const f = fixture(t); configureShop(f);
    const grant = { person_ref: owner.actorId, provider_ref: 'core-wa-account', capability_code: 'customers.manage', actions: ['execute'],
        allowed_fields: ['consent.purpose', 'consent.evidence', 'consent.valid_until'], resource_refs: ['native_contacts', 'native_contact:1'],
        resource_policy: 'selected', expires_at: '2026-12-18T12:00:00Z', version: 1 };
    const configure = value => f.changeContext(base => ({ ...base, activities: base.activities.map(row => ({ ...row,
        my_actions: row.my_actions.filter(action => action !== 'commands.request'), capability_grants: [value] })) }));
    configure(grant);
    const get = async resourceSelection => f.service.verifyOwnerContext({ principal, activityRef: (await f.service.overview(principal)).connection.selection.activity,
        capabilityId: 'customers.manage', action: 'consent.record', resourceSelection });
    assert.equal((await get({ accountRef: 'native_contacts', recipientRef: 'native_contact:1' })).canManageConsent, true);
    await assert.rejects(get({ accountRef: 'native_contacts', recipientRef: 'native_contact:2' }), { code: 'workspace_native_permission_required' });
    await assert.rejects(get(), { code: 'workspace_native_resource_scope_required' });
    configure({ ...grant, resource_policy: 'new_only' });
    await assert.rejects(get({ accountRef: 'native_contacts', recipientRef: 'native_contact:1' }), { code: 'workspace_native_permission_required' });
    configure({ ...grant, allowed_fields: ['phone', 'profile_name'] });
    await assert.rejects(get({ accountRef: 'native_contacts', recipientRef: 'native_contact:1' }), { code: 'workspace_native_permission_required' });
});

test('actual native business and review forms receive named current account/activity descriptors without changing authority', async t => {
    const f = fixture(t); configureShop(f);
    for (const capability of ['customers.manage', 'measurement.read', 'measurement.export', 'owner.operations']) {
        const view = await f.service.overview(principal, { action: capability });
        assert.equal(view.businessEditor.capability, capability); assert.equal(view.nativeEditor, undefined);
        assert.equal(view.businessEditor.activity, view.connection.selection.activity);
        assert.notEqual(view.businessEditor.provider, 'core-wa-account');
    }
    for (const capability of ['messaging.review', 'campaigns.review', 'content.review']) {
        const view = await f.service.overview(principal, { action: capability });
        assert.equal(view.nativeEditor.capability, capability); assert.equal(view.nativeEditor.action, capability);
    }
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
});

test('media draft selection fingerprint survives opaque choice reissue only within the same actual owner activity/account', async t => {
    const f = fixture(t); configureShop(f);
    const first = await f.service.overview(principal, { action: 'media.manage' }), second = await f.service.overview(principal, { action: 'media.manage' });
    assert.notEqual(first.mediaEditor.activity, second.mediaEditor.activity); assert.notEqual(first.mediaEditor.provider, second.mediaEditor.provider);
    assert.equal(first.mediaEditor.selectionKey, second.mediaEditor.selectionKey); assert.equal(first.context.viewKey, second.context.viewKey);
    assert.match(first.mediaEditor.selectionKey, /^[a-f0-9]{64}$/);
    f.changeOwner({ generation: 'new-owner-consent-generation' });
    const changed = await f.service.overview(principal, { action: 'media.manage' });
    assert.notEqual(changed.mediaEditor.selectionKey, first.mediaEditor.selectionKey);
    assert.equal(f.calls.some(row => row.method === 'POST'), false);
});

test('media owner options require their own exact request grant and seal only the two source-supported actions', async t => {
    const f = fixture(t); configureShop(f);
    const grant = { person_ref: owner.actorId, provider_ref: 'core-wa-account', capability_code: 'media.manage', actions: ['request'],
        allowed_fields: ['channel', 'account_ref', 'asset_ref'], resource_refs: ['whatsapp_account:1', 'native_media:owned'], resource_policy: 'selected',
        expires_at: '2026-12-18T12:00:00Z', version: 1 };
    f.changeContext(raw => ({ ...raw, activities: raw.activities.map(row => ({ ...row, capability_grants: [grant] })) }));
    const view = await f.service.overview(principal, { action: 'media.manage' });
    const verifiedOwner = await f.service.verifyOwnerContext({ principal, activityRef: view.mediaEditor.activity, action: 'media.manage', capabilityId: 'media.manage' });
    assert.deepEqual(verifiedOwner.viewer.allowedFields, grant.allowed_fields); assert.deepEqual(verifiedOwner.viewer.resourceRefs, grant.resource_refs);
    f.captureHook(async () => { f.changeOwner({ generation: 'replacement-during-source-capture' }); });
    await assert.rejects(f.service.verifyOwnerContext({ principal, activityRef: view.mediaEditor.activity, action: 'media.manage', capabilityId: 'media.manage' }),
        { code: 'workspace_context_changed' });
    f.changeOwner({ generation: owner.generation }); f.captureHook(async () => {});
    const parameters = { channel: 'whatsapp', resource_fingerprint: 'c'.repeat(64) };
    f.service.setNativeOwnerService({ preview: async () => ({ availability: { state: 'review_available' }, resource_fingerprint: 'c'.repeat(64),
        normalized_parameters: { ...parameters, asset_ref: 'native_media:owned' }, summary: [{ label: 'الملف', value: 'صورة المنتج الموثقة' }],
        quote: { total_credits: 0, currency_label: 'بدون تكلفة إرسال' } }) });
    const input = { activity: view.mediaEditor.activity, provider: view.mediaEditor.provider, capability: 'media.manage', action: 'media.asset.upload', parameters };
    const reviewed = await f.service.reviewAction(principal, input);
    assert.equal((await f.service.choices.resolveReview(principal, reviewed.review.key, 'command_create')).payload.action, 'media.asset.upload');
    await assert.rejects(f.service.reviewAction(principal, { ...input, action: 'media.asset.delete' }), { code: 'workspace_native_action_unavailable' });
    assert.equal(f.calls.some(row => row.method === 'POST'), false);
});

test('a typed native business review seals only source-validated current named parameters and can never use a Catalog account', async t => {
    const f = fixture(t); configureShop(f); let previews = 0;
    f.service.setNativeBusinessOwnerService({ preview: async (_principal, input) => {
        previews++; assert.equal(input.capability, 'customers.manage'); assert.equal(input.action, 'contacts.create');
        return { availability: { state: 'review_available' }, resource_fingerprint: 'b'.repeat(64), normalized_parameters: {
            channel: 'native', account_ref: 'native_contacts', purpose: 'business_record', evidence_reference: 'طلب العميل الأصلي', phone: '218911234567', profile_name: 'عميل تجريبي' },
        summary: [{ label: 'العملية', value: 'إضافة جهة اتصال دون إنشاء موافقة مراسلة' }, { label: 'الاسم', value: 'عميل تجريبي' }],
        quote: { total_credits: 0, within_budget: true, currency_label: 'بدون إرسال خارجي' } };
    } });
    const view = await f.service.overview(principal, { action: 'customers.manage' });
    const parameters = { channel: 'native', account_ref: 'native_contacts', resource_fingerprint: 'b'.repeat(64) };
    const result = await f.service.reviewAction(principal, { activity: view.businessEditor.activity, provider: view.businessEditor.provider,
        capability: 'customers.manage', action: 'contacts.create', parameters });
    const sealed = await f.service.choices.resolveReview(principal, result.review.key, 'command_create');
    assert.equal(sealed.payload.action, 'contacts.create'); assert.equal(sealed.payload.provider_ref, 'core-wa-account');
    assert.equal(sealed.payload.payload.parameters.phone, '218911234567'); assert.equal(f.calls.some(call => call.method === 'POST'), false);
    const catalog = view.connection.choices.providers.find(row => row.label.includes('كتالوج'));
    await assert.rejects(f.service.reviewAction(principal, { activity: view.businessEditor.activity, provider: catalog.value,
        capability: 'customers.manage', action: 'contacts.create', parameters }), { code: 'workspace_native_action_unavailable', status: 403 });
    assert.equal(previews, 1);
});

test('withdrawal during a native preview invalidates the human review before an operation identity can be exposed', async t => {
    const f = fixture(t); configureShop(f);
    f.service.setNativeBusinessOwnerService({ preview: async () => {
        f.changeContext(base => ({ ...base, activities: base.activities.map(row => ({ ...row, my_actions: [] })) }));
        return { availability: { state: 'review_available' }, resource_fingerprint: 'b'.repeat(64), normalized_parameters: {},
            summary: [{ label: 'العملية', value: 'عرض نشاط الرسائل' }], quote: { total_credits: 0, within_budget: true, currency_label: 'بدون إرسال خارجي' } };
    } });
    const view = await f.service.overview(principal, { action: 'measurement.read' });
    await assert.rejects(f.service.reviewAction(principal, { activity: view.businessEditor.activity, provider: view.businessEditor.provider,
        capability: 'measurement.read', action: 'measurement.summary', parameters: { resource_fingerprint: 'b'.repeat(64) } }),
    { code: 'workspace_native_preview_changed', status: 409 });
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM savana_workspace_review_fences').get().n, 1); // Existing read-request approval review only.
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
});
