import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';
import { runMigrationsSync } from '../db/migrator.js';
import { CollaborativeExecutionService } from '../services/collaborativeExecution.js';

const at = Date.parse('2026-11-18T10:00:00Z');
const scope = { organization_id: 'synthetic-org', activity_id: 'synthetic-activity', branch_id: null, warehouse_id: null };
const delegation = { grant_approved_by: 'synthetic-owner', native_authority_revision: 'synthetic-owner-revision',
    capability_grant_revision: 3, allowed_fields: ['channel', 'message'], resource_policy: 'new_only', resource_refs: [], scope_epochs: [] };
const command = (changes = {}) => ({ spec_version: '1.0', command_id: crypto.randomUUID(), version: 1,
    fingerprint: 'a'.repeat(64), attempt_id: crypto.randomUUID(), capability: 'messaging.send', action: 'messaging.send',
    scope, actor_id: 'synthetic-actor', provider_ref: 'synthetic-provider', provider_installation_id: 'synthetic-installation',
    external_tenant_id: 'wa_savana:tenant:1', authorization_revision: 'synthetic-grants', ownership_epoch: null,
    ...delegation, validation_revision: 'a'.repeat(64), validation_valid_until: new Date(at + 30000).toISOString(),
    payload: { payload_type: 'native_action', parameters: { channel: 'sms', message: 'Synthetic owned message' } }, ...changes });
const fixture = (t, overrides = {}) => {
    const db = new Database(':memory:'); runMigrationsSync(db); t.after(() => db.close());
    db.exec(`INSERT INTO tenants(id,name,phone,status) VALUES(1,'Synthetic native tenant','218910000021','Active');
        CREATE TABLE owned_provider_receipts(id TEXT PRIMARY KEY,native_id TEXT);`);
    const counters = { sent: 0, authorize: 0, bindings: 0, reconciled: 0 }; let resource = 'a'.repeat(64);
    const adapter = { qualified: true, configured: () => true, validate: payload => payload,
        prepare: ({ parameters }) => ({ parameters, resourceFingerprint: resource, resourceSelection: { channel: 'sms',
            nativeAccountRef: 'synthetic-account', recipients: [{ ref: 'synthetic-recipient', deliveryFingerprint: 'd'.repeat(64) }], contentRef: null } }),
        execute: async ({ effect }) => effect({ key: 'synthetic-recipient', kind: 'sms_message', run: async () => {
            counters.sent++; return { accepted: true, native_kind: 'sms_message', native_id: 'synthetic-native-message', provider_id: 'synthetic-provider-receipt' };
        } }),
        reconcile: async () => { counters.reconciled++; return { definitive: false }; }, ...overrides.adapter };
    const binding = async ({ command: cmd, action }) => {
        counters.bindings++;
        if (overrides.binding) return overrides.binding({ command: cmd, action, counters });
        return { verified: true, localPolicyVerified: true, nativeTenantId: 1,
            ...(action === 'execute' ? { executionContext: { actor_id: cmd.actor_id, scope: cmd.scope,
                provider_ref: cmd.provider_ref, provider_platform: 'wa_savana', provider_installation_id: cmd.provider_installation_id,
                external_tenant_id: cmd.external_tenant_id, authorization_revision: cmd.authorization_revision,
                valid_until: new Date(at + 5000).toISOString(), ownership_epoch: cmd.ownership_epoch, ...delegation } }
                : { viewer: { actorId: 'synthetic-current-reader', scope: cmd.scope || scope, allowedFields: ['result.status', 'result.receipt'], resourcePolicy: 'activity', resourceRefs: [], validUntil: new Date(at + 30000).toISOString() } }) };
    };
    const authorize = async cmd => {
        counters.authorize++;
        if (overrides.authorize) return overrides.authorize(cmd);
        return { command_id: cmd.command_id, version: cmd.version, fingerprint: cmd.fingerprint, attempt_id: cmd.attempt_id,
            authorization_revision: cmd.authorization_revision, valid_until: new Date(at + 5000).toISOString(), ...delegation };
    };
    const service = new CollaborativeExecutionService({ database: db, nativeAdapters: { 'messaging.send:sms': adapter },
        verifyNativeContext: binding, authorizeEffect: authorize, now: () => at });
    return { db, service, counters, adapter, changeResource: () => { resource = 'b'.repeat(64); } };
};

test('actual native receipt and per-effect truth persist once and export actual JSON/CSV without a second send', async t => {
    const { db, service, counters } = fixture(t); const cmd = command();
    const first = await service.execute(cmd, {});
    assert.equal(first.outcome, 'applied'); assert.equal(first.source_result.local_entity_id, 'synthetic-native-message');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM savana_collaborative_effects').get().n, 1);
    assert.deepEqual(await service.execute(cmd, {}), first); assert.equal(counters.sent, 1);
    const json = await service.result(cmd.command_id, {}, { version: 1, fingerprint: cmd.fingerprint });
    assert.equal(json.data.effects[0].receipt.provider_id, 'synthetic-provider-receipt');
    assert.equal(json.content_sha256.length, 64);
    const csv = await service.result(cmd.command_id, {}, { format: 'csv' });
    assert.match(csv.text, /synthetic-native-message/); assert.equal(csv.data, null);
    assert.equal(counters.sent, 1);
});

test('overlapping executions and reconciliation cannot claim or close another live effect', async t => {
    let release; let started;
    const entered = new Promise(resolve => { started = resolve; }); const wait = new Promise(resolve => { release = resolve; });
    const f = fixture(t, { adapter: { execute: async ({ effect }) => effect({ key: 'one', kind: 'sms_message', run: async () => {
        f.counters.sent++; started(); await wait;
        return { accepted: true, native_kind: 'sms_message', native_id: 'owned-one' };
    } }) } });
    const cmd = command(); const first = f.service.execute(cmd, {}); await entered;
    assert.equal((await f.service.execute(cmd, {})).outcome, 'unknown');
    assert.equal((await f.service.reconcile(cmd, {})).outcome, 'unknown');
    release(); assert.equal((await first).outcome, 'applied'); assert.equal(f.counters.sent, 1);
});

test('lost provider acknowledgement holds same command and all new versions; reconciliation is status-only', async t => {
    const f = fixture(t, { adapter: { execute: async ({ effect }) => effect({ key: 'one', kind: 'sms_message', run: async () => {
        f.counters.sent++; const error = new Error('Synthetic lost response'); error.deliveryUncertain = true; throw error;
    } }), reconcile: async ({ effect }) => {
        const row = f.db.prepare('SELECT native_id FROM owned_provider_receipts WHERE id=?').get(effect.native_idempotency_key);
        return row ? { definitive: true, state: 'accepted', receipt: { native_kind: 'sms_message', native_id: row.native_id, accepted: true } }
            : { definitive: false };
    } } });
    const cmd = command(); assert.equal((await f.service.execute(cmd, {})).outcome, 'unknown');
    assert.equal((await f.service.execute(cmd, {})).outcome, 'unknown');
    await assert.rejects(f.service.execute({ ...cmd, version: 2 }, {}), { code: 'native_command_previous_effect_unresolved' });
    assert.equal((await f.service.reconcile(cmd, {})).outcome, 'unknown');
    const effect = f.db.prepare('SELECT * FROM savana_collaborative_effects').get();
    f.db.prepare('INSERT INTO owned_provider_receipts VALUES(?,?)').run(effect.native_idempotency_key, 'reconciled-native-message');
    assert.equal((await f.service.reconcile(cmd, {})).outcome, 'applied'); assert.equal(f.counters.sent, 1);
});

test('same fingerprint cannot conceal changed command body or recipient content', async t => {
    const f = fixture(t); const cmd = command(); await f.service.execute(cmd, {});
    await assert.rejects(f.service.execute({ ...cmd, payload: { ...cmd.payload,
        parameters: { ...cmd.payload.parameters, message: 'Changed after approval' } } }, {}), { code: 'native_command_identity_conflict' });
    assert.equal(f.counters.sent, 1);
});

test('central denial before an effect produces definitive not_applied without provider or effect claims', async t => {
    const f = fixture(t, { authorize: () => { throw new Error('Synthetic current grant withdrawn'); } });
    const result = await f.service.execute(command(), {});
    assert.equal(result.outcome, 'not_applied'); assert.equal(result.source_result, null);
    assert.equal(f.counters.sent, 0); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_collaborative_effects').get().n, 0);
});

test('native resources changing while the effect checkpoint is awaited prevent any send', async t => {
    const f = fixture(t, { authorize: cmd => { f.changeResource(); return { command_id: cmd.command_id, version: cmd.version,
        fingerprint: cmd.fingerprint, attempt_id: cmd.attempt_id, authorization_revision: cmd.authorization_revision,
        valid_until: new Date(at + 5000).toISOString(), ...delegation }; } });
    assert.equal((await f.service.execute(command(), {})).outcome, 'not_applied'); assert.equal(f.counters.sent, 0);
});

test('truthful result remains readable after execute permission withdrawal and selectors cannot cross command identity', async t => {
    const f = fixture(t); const cmd = command(); await f.service.execute(cmd, {});
    let read = 0; f.service.verifyContext = async ({ command: stored, action }) => {
        assert.equal(action, 'result'); read++;
        return { verified: true, localPolicyVerified: true, nativeTenantId: 1,
            viewer: { scope: stored.scope, actorId: 'synthetic-new-reader', allowedFields: ['result.status', 'result.receipt'], resourcePolicy: 'activity', resourceRefs: [], validUntil: new Date(at + 5000).toISOString() } };
    };
    const before = f.counters.authorize;
    assert.equal((await f.service.result(cmd.command_id, {})).data.outcome, 'applied');
    assert.equal(read, 1); assert.equal(f.counters.authorize, before);
    await assert.rejects(f.service.result(cmd.command_id, {}, { fingerprint: 'b'.repeat(64) }), { code: 'native_command_identity_conflict' });
});

test('handler registration is per selected channel and missing implementation cannot execute', async t => {
    const f = fixture(t); assert.deepEqual(f.service.getRegistry()[0].channels, ['sms']);
    await assert.rejects(f.service.execute(command({ payload: { payload_type: 'native_action', parameters: { channel: 'whatsapp' } } }), {}),
        { code: 'collaborative_channel_unavailable' });
    assert.equal(f.counters.sent, 0);
});

test('unresolved native outcome blocks a new command/provider identity in its family with a durable no-effect receipt', async t => {
    const f = fixture(t, { adapter: { execute: async ({ effect }) => effect({ key: 'one', kind: 'sms_message', run: async () => {
        f.counters.sent++; const error = new Error('Synthetic lost acknowledgement'); error.deliveryUncertain = true; throw error;
    } }) } });
    const first = command(); assert.equal((await f.service.execute(first, {})).outcome, 'unknown');
    const fresh = command({ provider_ref: 'synthetic-other-provider', provider_installation_id: 'synthetic-other-installation' });
    const blocked = await f.service.execute(fresh, {});
    assert.equal(blocked.outcome, 'not_applied'); assert.equal(blocked.reason_code, 'native_previous_outcome_unresolved');
    assert.equal(blocked.source_result, null); assert.equal(f.counters.sent, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_collaborative_command_receipts').get().n, 2);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_collaborative_effects').get().n, 1);
    assert.deepEqual(await f.service.execute(fresh, {}), blocked);
});

test('immutable persisted command and effect identities cannot be overwritten by a later reconciliation', async t => {
    const f = fixture(t); const cmd = command(); await f.service.execute(cmd, {});
    assert.throws(() => f.db.prepare("UPDATE savana_collaborative_command_receipts SET command_json='{}' WHERE command_id=?").run(cmd.command_id),
        /collaborative_command_identity_immutable/);
    assert.throws(() => f.db.prepare("UPDATE savana_collaborative_effects SET native_idempotency_key='new-key'").run(),
        /collaborative_effect_identity_immutable/);
    assert.equal(f.counters.sent, 1);
});

test('current result field/resource grants filter actual JSON and CSV without exposing recipient or receipt metadata', async t => {
    const f=fixture(t);const cmd=command();await f.service.execute(cmd,{});
    let fields=[];let policy='activity';let refs=[];let actor=cmd.actor_id;
    f.service.verifyContext=async({command:stored,action})=>{
        assert.equal(action,'result');return {verified:true,localPolicyVerified:true,nativeTenantId:1,
            viewer:{scope:stored.scope,actorId:actor,validUntil:new Date(at+30000).toISOString(),allowedFields:fields,resourcePolicy:policy,resourceRefs:refs}};
    };
    await assert.rejects(f.service.result(cmd.command_id,{}),{code:'native_result_field_permission_required'});
    fields=['result.status'];const status=await f.service.result(cmd.command_id,{});
    assert.equal(status.data.effect_counts.accepted,1);assert.equal(status.data.effects[0].state,'accepted');
    assert.equal(JSON.stringify(status.data).includes('synthetic-recipient'),false);
    assert.equal(JSON.stringify(status.data).includes('synthetic-provider-receipt'),false);
    assert.equal(status.data.effects[0].receipt,undefined);
    const csv=await f.service.result(cmd.command_id,{}, {format:'csv'});assert.equal(csv.text.split('\r\n')[0],'effect_index,state');
    fields=['result.status','result.receipt'];policy='selected';refs=['synthetic-account'];
    assert.deepEqual((await f.service.result(cmd.command_id,{})).data.effects,[]);
    refs.push('synthetic-recipient');assert.equal((await f.service.result(cmd.command_id,{})).data.effects[0].receipt.provider_id,'synthetic-provider-receipt');
    refs=[];await assert.rejects(f.service.result(cmd.command_id,{}),{code:'native_result_resource_scope_required'});
    policy='new_only';actor='another-current-actor';await assert.rejects(f.service.result(cmd.command_id,{}),{code:'native_result_resource_scope_required'});
});


test('parameter-based native execution rejects semantic claims without a ledger mutation or effect', async t => {
    const f = fixture(t);
    await assert.rejects(f.service.execute(command({ effect_fields: ['message'], effect_resources: [], creates_resource: false }), {}),
        { code: 'native_permission_contract_unsupported' });
    assert.deepEqual(f.counters, { sent: 0, authorize: 0, bindings: 0, reconciled: 0 });
    for (const table of ['savana_collaborative_command_receipts', 'savana_collaborative_effects', 'savana_collaborative_executions']) {
        assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
    }
});
