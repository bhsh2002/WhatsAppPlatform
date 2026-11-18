import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';
import { runMigrationsSync } from '../db/migrator.js';
import { WorkspaceIntentStore } from '../services/workspaceIntents.js';
import { CollaborativeExecutionService } from '../services/collaborativeExecution.js';
import { createCollaborativeNativeReviewAdapters } from '../services/collaborativeNativeReviews.js';
import { createCollaborativeNativeBusinessAdapters } from '../services/collaborativeNativeBusiness.js';
import { nativeCommandJson } from '../services/nativeCommandProtocol.js';
import { createOwnerJourneyCapabilityProofs } from '../test-support/ownerJourneyCapabilityProofs.js';

// Component evidence fixtures, not an owner journey or a Core/provider proof.
const at = Date.parse('2026-11-18T12:00:00Z');
const scope = { organization_id: 'synthetic-org', activity_id: 'synthetic-activity', branch_id: null, warehouse_id: null };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const principal = { tenantId: 1, userId: 1, sessionId: 'synthetic-session', authVersion: 0, role: 'tenant', sessionExpiresAt: at / 1000 + 300 };
const identity = { actorId: 'synthetic-actor', organizationId: scope.organization_id, nativeAccountId: 'synthetic-native-account',
    generation: 'synthetic-generation', expiresAt: new Date(at + 300000).toISOString() };
const fixture = async (t, { measurement = false, unknown = false, review = true } = {}) => {
    const database = new Database(':memory:'); runMigrationsSync(database); t.after(() => database.close());
    database.exec("INSERT INTO tenants(id,name,phone,status) VALUES(1,'Synthetic tenant','218910000071','Active'); INSERT INTO users(id,username,password_hash,role,tenant_id) VALUES(1,'synthetic','synthetic-fixture-hash','tenant',1)");
    const key = crypto.randomBytes(32);
    const encryption = { encrypt(raw) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const data = Buffer.concat([cipher.update(raw), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64'); },
    decrypt(raw) { const data = Buffer.from(raw, 'base64'), cipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
        cipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(); } };
    let ready = true; let readFields = ['result.status', 'result.receipt', 'measurement.total'];
    const base = { qualified: true, actions: ['messaging.send'], configured: () => ready, assertCurrent: () => true,
        validate: value => value, prepare: ({ parameters }) => ({ parameters, resourceFingerprint: 'b'.repeat(64),
            resourceSelection: { channel: 'sms', nativeAccountRef: 'synthetic-account', recipients: [] }, account: { ref: 'synthetic-account' } }) };
    const adapters = measurement ? createCollaborativeNativeBusinessAdapters({ database, encryption, consents: { current: () => assert.fail('measurement cannot create or infer consent') }, now: () => at })
        : createCollaborativeNativeReviewAdapters({ database, encryption, nativeAdapters: { 'messaging.send:sms': base }, now: () => at });
    const capability = measurement ? 'measurement.read' : 'messaging.review';
    const action = measurement ? 'measurement.summary' : capability; const channel = measurement ? 'native' : 'sms';
    const adapter = adapters[`${capability}:${channel}`];
    if (unknown) adapter.execute = ({ effect }) => effect({ key: 'synthetic-account', kind: 'native_review_draft', run: () => {
        const error = new Error('Synthetic lost source acknowledgement'); error.deliveryUncertain = true; throw error;
    } });
    const delegation = { grant_approved_by: identity.actorId, native_authority_revision: 'synthetic-owner-revision', capability_grant_revision: 1,
        allowed_fields: ['channel', 'account_ref'], resource_policy: 'activity', resource_refs: [], scope_epochs: [] };
    const command = { command_id: crypto.randomUUID(), version: 1, fingerprint: 'a'.repeat(64), attempt_id: crypto.randomUUID(),
        capability, action, scope, actor_id: identity.actorId, external_tenant_id: 'wa_savana:tenant:1', provider_ref: 'synthetic-provider',
        provider_installation_id: 'synthetic-installation', authorization_revision: 'synthetic-revision', ...delegation,
        validation_revision: 'b'.repeat(64), validation_valid_until: new Date(at + 30000).toISOString(), payload: { payload_type: 'native_action', parameters: {
            channel, account_ref: measurement ? 'native_messages' : 'synthetic-account',
            ...(measurement ? { purpose: 'business_record', evidence_reference: 'Synthetic owner business review' } : {}) } } };
    const prepared = await adapter.prepare({ tenantId: 1, scope, parameters: command.payload.parameters, command, preview: true });
    command.payload.parameters = prepared.parameters; command.validation_revision = prepared.resourceFingerprint;
    const service = new CollaborativeExecutionService({ database, nativeAdapters: adapters, now: () => at,
        verifyNativeContext: async ({ command: cmd, action: mode }) => ({ verified: true, localPolicyVerified: true, nativeTenantId: 1,
            ...(mode === 'execute' ? { executionContext: { actor_id: cmd.actor_id, scope, provider_ref: cmd.provider_ref, provider_platform: 'wa_savana',
                provider_installation_id: cmd.provider_installation_id, external_tenant_id: cmd.external_tenant_id, authorization_revision: cmd.authorization_revision,
                valid_until: new Date(at + 5000).toISOString(), ...delegation } } : { viewer: { actorId: identity.actorId, scope,
                allowedFields: readFields, resourcePolicy: 'activity', resourceRefs: [], validUntil: new Date(at + 30000).toISOString() } }) }),
        authorizeEffect: async cmd => ({ command_id: cmd.command_id, version: cmd.version, fingerprint: cmd.fingerprint, attempt_id: cmd.attempt_id,
            authorization_revision: cmd.authorization_revision, valid_until: new Date(at + 5000).toISOString(), ...delegation }) });
    const store = new WorkspaceIntentStore({ database, encryption, verifyLocalPrincipal: () => true, now: () => at });
    const requestBody = { activity_id: scope.activity_id, provider_ref: command.provider_ref, capability, action, payload: command.payload };
    if (review) store.registerReview(principal, identity, { idempotencyKey: 'synthetic-original-review', operation: 'command_create', inputHash: 'c'.repeat(64), contextRevision: 'synthetic-context', reviewExpiresAt: at + 30000 });
    const intent = store.prepare(principal, identity, { operation: 'command_create', idempotencyKey: 'synthetic-original-review', inputHash: 'c'.repeat(64),
        request: { method: 'POST', path: '/v1/integration/workspace/commands', body: requestBody } });
    const response = { command_id: command.command_id, organization_id: scope.organization_id, activity_id: scope.activity_id,
        provider_ref: command.provider_ref, capability, action, payload: command.payload, version: 1, state: 'pending_review', requested_by: identity.actorId,
        projection_state: 'not_applied', available_actions: [], updated_at: new Date(at).toISOString() };
    store.finish(principal, identity, intent.intent.id, { state: 'completed', result: response });
    const receipt = await service.execute(command, {});
    const discovery = async ({ tenantId, command: cmd, context }) => {
        assert.equal(tenantId, 1); assert.equal(context.organization_id, scope.organization_id); assert.equal(context.actor_id, identity.actorId);
        assert.equal(Object.hasOwn(context, 'scope'), false); assert.equal(Object.hasOwn(context, 'session_version'), false);
        return { platform: 'wa_savana', providers: [{ organization_id: scope.organization_id, external_tenant_id: cmd.external_tenant_id,
            display_name: 'Synthetic native account', actor_access: true, subscription_active: true, native_authority_revision: delegation.native_authority_revision,
            capabilities: [{ capability, actions: [action], validator_version: '1.0', handler_registered: true, configured: true }] }] };
    };
    const make = (decrypt = encryption.decrypt) => createOwnerJourneyCapabilityProofs({ database, decrypt, nativeAdapters: adapters, readDiscovery: discovery }).collect;
    return { database, encryption, command, receipt, service, make, collect: make(), intentId: intent.intent.id,
        setReady: value => { ready = value; }, fields: value => { readFields = value; } };
};

test('real encrypted reviewed intent + native durable review draft + exact result produce only bounded aggregate proof', async t => {
    const f = await fixture(t); assert.equal(f.receipt.outcome, 'applied');
    const result = await f.service.result(f.command.command_id, {});
    const proofs = await f.collect({ resultFetchRows: [{ id: 1, status: 200, result }, { id: 1, status: 200, result }] });
    assert.deepEqual(proofs, [{ capability_code: 'messaging.review', operation: 'messaging.review', service: 'wa_savana', handler_registered: true,
        configured: true, owner_form_requests: 1, confirmed_native_results: 1, result_fetches: 1 }]);
    assert.equal(JSON.stringify(proofs).includes(f.command.command_id), false);
    assert.deepEqual(await f.collect({ resultFetchRows: [{ id: 1, status: 200, result }] }), proofs);
    f.setReady(false); assert.equal((await f.collect({ resultFetchRows: [] }))[0].configured, false);
});

test('unknown execution and its status GET never become a confirmed native business result', async t => {
    const f = await fixture(t, { unknown: true }); assert.equal(f.receipt.outcome, 'unknown');
    const proof = (await f.collect({ resultFetchRows: [{ id: 1, status: 200, result: await f.service.result(f.command.command_id, {}) }] }))[0];
    assert.equal(proof.owner_form_requests, 1); assert.equal(proof.confirmed_native_results, 0); assert.equal(proof.result_fetches, 1);
});

test('unreviewed or undecryptable owner hints cannot be named owner form requests', async t => {
    const f = await fixture(t, { review: false });
    assert.equal((await f.collect({ resultFetchRows: [] }))[0].owner_form_requests, 0);
    const reviewed = await fixture(t);
    const encrypted = reviewed.database.prepare('SELECT encrypted_result FROM savana_workspace_intents WHERE id=?').get(reviewed.intentId).encrypted_result;
    const collect = reviewed.make(value => { if (value === encrypted) throw new Error('Synthetic lost owner envelope'); return reviewed.encryption.decrypt(value); });
    const proof = (await collect({ resultFetchRows: [] }))[0]; assert.equal(proof.owner_form_requests, 0); assert.equal(proof.confirmed_native_results, 1);
});

test('wrong fingerprint/provider/version/scope/hash and non200 generic fetch observations prove no same-identity fetch', async t => {
    const f = await fixture(t); const result = await f.service.result(f.command.command_id, {});
    const changes = [{ fingerprint: 'd'.repeat(64) }, { version: 2 }, { provider_ref: 'foreign-provider' },
        { scope: { ...scope, activity_id: 'foreign' } }, { data: { secret: 'Synthetic unverified result' } }];
    const rows = changes.map((change, id) => ({ id, status: 200, result: { ...result, ...change } }));
    rows.push({ id: 10, status: 403, result }, { id: 11, status: 200 });
    assert.equal((await f.collect({ resultFetchRows: rows }))[0].result_fetches, 0);
});

test('actual scoped measurement facts require actual returned business data, not a status-only acknowledgement', async t => {
    const f = await fixture(t, { measurement: true }); assert.equal(f.receipt.outcome, 'applied');
    assert.equal((await f.collect({ resultFetchRows: [] }))[0].confirmed_native_results, 0);
    f.fields(['result.status']); const status = await f.service.result(f.command.command_id, {});
    assert.equal((await f.collect({ resultFetchRows: [{ id: 1, status: 200, result: status }] }))[0].confirmed_native_results, 0);
    f.fields(['measurement.total']); const data = await f.service.result(f.command.command_id, {});
    assert.deepEqual(data.data.records, [{ totalMessages: 0 }]);
    const proof = (await f.collect({ resultFetchRows: [{ id: 2, status: 200, result: data }] }))[0];
    assert.equal(proof.confirmed_native_results, 1); assert.equal(proof.result_fetches, 1);
});

test('unmeasured result observation or incomplete owned schema omits proof rows instead of inventing zeros', async t => {
    const f = await fixture(t); assert.deepEqual(await f.collect(), []);
    const database = new Database(':memory:'); t.after(() => database.close());
    const collect = createOwnerJourneyCapabilityProofs({ database, decrypt: value => value, nativeAdapters: {}, readDiscovery: () => assert.fail('no unqualified lookup') }).collect;
    assert.deepEqual(await collect({ resultFetchRows: [] }), []);
});
