import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { OperationalWorkspaceService } from '../services/operationalWorkspace.js';
import { WorkspaceMutations } from '../services/workspaceMutations.js';
import { WorkspaceCapabilityGrants, workspaceGrantChoices } from '../services/workspaceCapabilityGrants.js';
import { SharedProductReadError } from '../services/centralProductRead.js';

const fixture = async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-grant-owned-http-'));
    const db = new Database(path.join(directory, 'owned.sqlite'));
    db.exec("CREATE TABLE tenants(id INTEGER PRIMARY KEY,name TEXT,status TEXT); CREATE TABLE users(id INTEGER PRIMARY KEY,tenant_id INTEGER); INSERT INTO tenants VALUES(1,'Native account','Active'); INSERT INTO users VALUES(1,1)");
    for (const name of ['062_workspace_intents.sql', '066_workspace_receipts.sql', '067_workspace_review_fences.sql']) {
        db.exec(fs.readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8'));
    }
    let now = Date.now(); let current = true; let generation = 'owned-oidc-generation';
    const principal = { tenantId: 1, userId: 1, role: 'tenant', sessionId: 'owned-native-jti', authVersion: 0,
        issuedAt: Math.floor(now / 1000), sessionExpiresAt: Math.floor(now / 1000) + 3600 };
    const identity = () => ({ actorId: 'owned-core-actor', organizationId: 'owned-org', nativeAccountId: 'wa_savana:tenant:1',
        coreAccountId: 'owned-native-binding', generation, expiresAt: new Date(principal.sessionExpiresAt * 1000).toISOString() });
    const scope = { organization_id: 'owned-org', activity_id: 'owned-activity', branch_id: null, warehouse_id: null };
    const raw = { spec_version: '1.0', organization: { id: 'owned-org', name: 'المؤسسة التجريبية' },
        actor: { account_id: 'owned-core-actor', display_name: 'المالك العادي' },
        activities: [{ activity_id: scope.activity_id, label: 'نشاط المتجر', scope, version: 1, my_actions: [], can_manage_people: true, permissions: [],
            capability_grants: [{ person_ref: 'selected-person', provider_ref: 'catalog-provider', capability_code: 'inventory.facts',
                actions: ['read', 'request'], allowed_fields: ['quantity'], resource_refs: ['warehouse-a'], resource_policy: 'selected',
                expires_at: new Date(now + 3600_000).toISOString(), version: 3 }] }],
        providers: [{ provider_ref: 'catalog-provider', tenant_ref: 'catalog-provider', external_tenant_id: 'catalog:tenant:1', platform: 'catalog',
            label: 'كتالوج المتجر', activity_id: scope.activity_id, availability: { state: 'available', reason_code: 'connected', message: 'حساب حالي',
                next_action: { code: 'review', label: 'مراجعة الصلاحيات', href: '/portal/integrations' } }, enrollment_id: 'actual-enrollment', enrollment_version: 1,
            installations: [], policy_choices: {} }],
        people: [{ person_ref: 'selected-person', display_name: 'سارة' }, { person_ref: 'owned-core-actor', display_name: 'المالك العادي' }], can_create_activity: false,
        policies: { fields: [], operations: [], unit_codes: [], currencies: [], price_lists: [], channels: [] },
        command_options: [], capability_grant_options: [{ activity_id: scope.activity_id, provider_ref: 'catalog-provider', capability_code: 'inventory.facts',
            label: 'تسجيل حقائق المخزون', fields: [{ value: 'quantity', label: 'الكمية' }, { value: 'movement', label: 'الحركة' }],
            resources: [{ resource_ref: 'warehouse-a', label: 'المخزن الرئيسي', resource_kind: 'warehouse', scope, authority_epoch: 0,
                authority_assignable: true, authority_matches_provider: false, authority_source_label: null },
            { resource_ref: 'warehouse-b', label: 'مخزن يحتاج تحققًا', resource_kind: 'warehouse', scope, authority_epoch: null,
                authority_assignable: true, authority_matches_provider: null, authority_source_label: null }],
            resource_policies: ['selected', 'new_only', 'activity'], source_authority_required: true, current_authority_epoch: null, current_authority_label: null }],
        service_registrations: [], service_shares: [], service_share_options: [], owner_action_origins: [], capabilities: [],
        existing: { requests: [], grants: [], origin_evidence: [] }, selection_revision: 'a'.repeat(64), approval_policy: 'Actual explicit scoped actions' };
    let drop = false; let transform = value => value; const calls = [];
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/v1/integration/workspace/discovery') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(raw)); return; }
        if (req.method !== 'PUT' || !url.pathname.includes('/capability-grants/')) { res.writeHead(404).end('{}'); return; }
        let bytes = ''; for await (const chunk of req) bytes += chunk;
        const body = JSON.parse(bytes); const person = decodeURIComponent(url.pathname.split('/').at(-1));
        calls.push({ method: req.method, path: url.pathname, body, consumer: req.headers['x-savana-consumer-installation'] });
        const grant = { person_ref: person, provider_ref: body.provider_ref, capability_code: body.capability_code,
            actions: body.actions, allowed_fields: body.allowed_fields, resource_refs: body.resource_refs, resource_policy: body.resource_policy,
            expires_at: body.expires_at, version: body.expected_version + 1 };
        raw.activities[0].capability_grants = [grant];
        const response = { ...grant, assign_source_authority: body.assign_source_authority,
            expected_authority_epoch: body.expected_authority_epoch ?? 0, expected_authority_epochs: body.expected_authority_epochs };
        if (drop) { req.socket.destroy(); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(transform(response)));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const key = crypto.randomBytes(32);
    const encryption = { encrypt(value) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const bytes = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64'); },
    decrypt(value) { const bytes = Buffer.from(value, 'base64'); const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(); } };
    const verify = p => current && p.tenantId === 1 && p.userId === 1 && p.sessionId === principal.sessionId && p.authVersion === 0 && p.sessionExpiresAt * 1000 > now;
    const setup = { config: { enabled: true, centerOrigin: origin, oidcIssuer: origin, platformToken: 'owned-test-platform-token', allowLoopback: true }, appOrigin: origin,
        assertLocal: p => { if (!verify(p)) throw new SharedProductReadError('workspace_context_changed', 403); },
        identity: async p => { setup.assertLocal(p); return { ...identity(), accessToken: 'owned-test-oidc-token' }; },
        nativeAccount: async () => ({ id: identity().coreAccountId, organization_id: 'owned-org', platform_code: 'wa_savana', status: 'active', external_tenant_id: identity().nativeAccountId }),
        store: { ownerCurrent: (p, owner) => verify(p) && owner.generation === generation, ownerSession: () => ({}), load: () => null } };
    const gateway = new OperationalWorkspaceService({ database: db, encryption, setupService: setup, nativeOwnerProofs: { capture: async () => ({}) },
        verifyLocalPrincipal: verify, now: () => now });
    const actualLoad = gateway.loadContext.bind(gateway);
    gateway.loadContext = async p => { const value = await actualLoad(p); Object.assign(value.choices, workspaceGrantChoices(value.raw, value.revision));
        value.consumerInstallationId = 'unrelated-previous-consumer'; return value; };
    const service = new WorkspaceCapabilityGrants({ gateway });
    gateway.mutations = new WorkspaceMutations({ choices: gateway.choices, transport: gateway.transport, intents: gateway.intents,
        planners: { capability_grant: service.planner() } });
    gateway.intents.loadOutcome = async input => service.recover(input, service.expected(input.principal, input.identity, input.idempotencyKey),
        { intentId: input.intentId, inputHash: input.inputHash, requestHash: input.requestHash, actorId: input.identity.actorId,
            organizationId: input.identity.organizationId, nativeAccountId: input.identity.nativeAccountId });
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(directory, { recursive: true }); });
    const view = async () => { const context = await gateway.loadContext(principal); const activity = gateway.issue(principal, context, 'activities', context.choices.activities[0]);
        const first = await service.options(principal, { activity });
        const options = await service.options(principal, { activity, grant: first.choices.grants[0].value, person: first.choices.people[0].value });
        return { context, activity, options }; };
    const input = view => ({ activity: view.activity, grant: view.options.selection.grant, person: view.options.selection.person,
        actions: ['read', 'request'], fields: [view.options.editor.fields[0].value], resources: [view.options.editor.resources[0].value],
        resourcePolicy: 'selected', expiresAt: new Date(now + 7200_000).toISOString(), assignSourceAuthority: false });
    return { db, raw, principal, identity, gateway, service, calls, view, input, drop: () => { drop = true; }, transform: fn => { transform = fn; },
        current: value => { current = value; }, nextGeneration: () => { generation = 'changed-oidc-generation'; }, tick: ms => { now += ms; } };
};

test('fresh named options keep supplied grant/person and field/resource references stable without authority or duration defaults', async t => {
    const f = await fixture(t); const a = await f.view(); const again = await f.service.options(f.principal, { activity: a.activity, ...a.options.selection });
    assert.deepEqual(again, a.options); assert.equal(again.editor.currentSelection.assignSourceAuthority, false);
    assert.equal(again.editor.sourceAuthority.enabled, true); assert.deepEqual(again.editor.resources.map(row => row.sourceAuthorityAvailable), [true, false]);
    for (const secret of ['catalog-provider', 'selected-person', 'warehouse-a', 'owned-test-oidc-token', f.principal.sessionId]) assert.equal(JSON.stringify(again).includes(secret), false);
    f.raw.activities[0].capability_grants = [];
    const fresh = await f.view(); assert.deepEqual(fresh.options.editor.currentSelection.actions, []);
    assert.equal(fresh.options.editor.currentSelection.resourcePolicy, ''); assert.equal(fresh.options.editor.currentSelection.expiresAt, '');
});

test('current can_manage_people is required even for the ordinary owner and withdrawn source choices invalidate old inputs', async t => {
    const f = await fixture(t); const a = await f.view(); const input = f.input(a);
    f.raw.activities[0].can_manage_people = false;
    await assert.rejects(f.service.options(f.principal, { activity: a.activity }), error => [403, 409].includes(error.status));
    await assert.rejects(f.service.review(f.principal, input), error => [403, 409].includes(error.status)); assert.equal(f.calls.length, 0);
    f.raw.activities[0].can_manage_people = true; const b = await f.view(); f.raw.capability_grant_options[0].fields = [];
    await assert.rejects(f.service.review(f.principal, f.input(b)), { code: 'workspace_grant_choice_changed' }); assert.equal(f.calls.length, 0);
});

test('review shows named before/after/removal details and Core PUT contains only the exact grant body with actual current version', async t => {
    const f = await fixture(t); const a = await f.view(); const input = { ...f.input(a), actions: ['read'], fields: [], resources: [] };
    const review = await f.service.review(f.principal, { ...input, actions: [] });
    assert.ok(review.review.summary.some(row => row.label === 'الحقول المسحوبة' && row.value === 'الكمية'));
    assert.ok(review.review.summary.some(row => row.label === 'الموارد المسحوبة' && row.value === 'المخزن الرئيسي'));
    assert.equal(JSON.stringify(review.review.summary).includes('warehouse-a'), false);
    const result = await f.gateway.mutations.submit(f.principal, { review: review.review.key }); assert.equal(result.intent.state, 'completed');
    assert.equal(f.calls.length, 1); const call = f.calls[0];
    assert.equal(call.path, '/v1/integration/workspace/activities/owned-activity/capability-grants/selected-person');
    assert.equal(call.consumer, undefined); assert.equal(call.body.expected_version, 3);
    assert.equal(Object.hasOwn(call.body, 'activity_id'), false); assert.equal(Object.hasOwn(call.body, 'person_ref'), false);
    assert.equal(Object.hasOwn(call.body, 'expected_authority_epoch'), false);
    assert.deepEqual(call.body.actions, []); assert.deepEqual(call.body.allowed_fields, []); assert.deepEqual(call.body.resource_refs, []);
});

test('explicit source assignment uses every actual selected epoch including zero but never converts unknown null to zero', async t => {
    const f = await fixture(t); const a = await f.view(); const input = { ...f.input(a), assignSourceAuthority: true };
    await assert.rejects(f.service.review(f.principal, { ...input, resources: a.options.editor.resources.map(row => row.value) }), { code: 'workspace_source_authority_unverified' });
    const review = await f.service.review(f.principal, input);
    const resolved = await f.gateway.choices.resolveReview(f.principal, review.review.key, 'capability_grant');
    assert.deepEqual(resolved.payload.expected_authority_epochs, { 'warehouse-a': 0 }); assert.equal(Object.hasOwn(resolved.payload, 'expected_authority_epoch'), false);
    const expected = f.service.expected(f.principal, resolved.context.identity, resolved.idempotencyKey);
    assert.equal(expected.before.authority_resources[1].authority_epoch, null);
    const result = await f.gateway.mutations.submit(f.principal, { review: review.review.key }); assert.equal(result.intent.state, 'completed');
    assert.deepEqual(f.calls[0].body.expected_authority_epochs, { 'warehouse-a': 0 });
});

test('forged epochs, actor fields, unsupported actions, duplicate refs and undeclared resource policies fail before claim', async t => {
    const f = await fixture(t); const a = await f.view(); const input = f.input(a);
    for (const changed of [{ ...input, expected_version: 100 }, { ...input, actor_id: 'forged' }, { ...input, actions: ['admin'] },
        { ...input, fields: [input.fields[0], input.fields[0]] }, { ...input, resources: ['manual-resource-id'] },
        { ...input, resourcePolicy: 'global' }, { ...input, resourcePolicy: 'activity' }, { ...input, expiresAt: '2099-02-30T00:00:00Z' }]) {
        await assert.rejects(f.service.review(f.principal, changed));
    }
    assert.equal(f.calls.length, 0); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_workspace_intents').get().n, 0);
});

test('correctly shaped but wrong ACK version cannot complete the immutable outgoing intent', async t => {
    const f = await fixture(t); const a = await f.view();
    const review = await f.service.review(f.principal, f.input(a)); f.transform(reply => ({ ...reply, version: reply.version + 1 }));
    await assert.rejects(f.gateway.mutations.submit(f.principal, { review: review.review.key }), { code: 'workspace_response_invalid' });
    assert.equal(f.db.prepare('SELECT state FROM savana_workspace_intents').get().state, 'unknown'); assert.equal(f.calls.length, 1);
});

test('a lost grant ACK resolves by exact fresh tuple only and never sends a second PUT or a replacement key', async t => {
    const f = await fixture(t); const a = await f.view(); const review = await f.service.review(f.principal, f.input(a)); f.drop();
    await assert.rejects(f.gateway.mutations.submit(f.principal, { review: review.review.key }), { code: 'workspace_outcome_unknown' });
    const row = f.db.prepare('SELECT * FROM savana_workspace_intents').get(); assert.equal(row.state, 'unknown');
    const b = await f.view(); const replacement = await f.service.review(f.principal, f.input(b));
    await assert.rejects(f.gateway.mutations.submit(f.principal, { review: replacement.review.key })); assert.equal(f.calls.length, 1);
    const result = await f.gateway.intents.reconcile(f.principal, f.identity(), row.id); assert.equal(result.intent.state, 'completed'); assert.equal(result.result, null);
    assert.equal(f.calls.length, 1);
});

test('source assignment lost ACK remains unknown without a published exact authority transition proof', async t => {
    const f = await fixture(t); const a = await f.view(); const review = await f.service.review(f.principal, { ...f.input(a), assignSourceAuthority: true }); f.drop();
    await assert.rejects(f.gateway.mutations.submit(f.principal, { review: review.review.key }));
    const row = f.db.prepare('SELECT * FROM savana_workspace_intents').get();
    assert.equal((await f.gateway.intents.reconcile(f.principal, f.identity(), row.id)).intent.state, 'unknown'); assert.equal(f.calls.length, 1);
});

test('later versions, altered fields or a different person cannot prove the original lost ordinary-grant outcome', async t => {
    const f = await fixture(t); const a = await f.view(); const review = await f.service.review(f.principal, f.input(a)); f.drop();
    await assert.rejects(f.gateway.mutations.submit(f.principal, { review: review.review.key }));
    const row = f.db.prepare('SELECT * FROM savana_workspace_intents').get(); const actual = structuredClone(f.raw.activities[0].capability_grants[0]);
    for (const change of [{ version: actual.version + 1 }, { allowed_fields: ['movement'] }, { person_ref: 'owned-core-actor' }]) {
        f.raw.activities[0].capability_grants = [{ ...actual, ...change }];
        assert.equal((await f.gateway.intents.reconcile(f.principal, f.identity(), row.id)).intent.state, 'unknown');
    }
    assert.equal(f.calls.length, 1);
});

test('native revocation, new OIDC generation and changed grant version reject a sealed review before any effect', async t => {
    const f = await fixture(t); const a = await f.view(); const review = await f.service.review(f.principal, f.input(a));
    f.nextGeneration(); await assert.rejects(f.gateway.mutations.submit(f.principal, { review: review.review.key })); assert.equal(f.calls.length, 0);
    const b = await f.view(); const next = await f.service.review(f.principal, f.input(b)); f.current(false);
    await assert.rejects(f.gateway.mutations.submit(f.principal, { review: next.review.key })); assert.equal(f.calls.length, 0);
    f.current(true); const c = await f.view(); const changed = await f.service.review(f.principal, f.input(c));
    f.raw.activities[0].capability_grants[0].version += 1;
    await assert.rejects(f.gateway.mutations.submit(f.principal, { review: changed.review.key })); assert.equal(f.calls.length, 0);
});
