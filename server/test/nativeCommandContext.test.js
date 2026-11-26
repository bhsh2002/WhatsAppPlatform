import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';
import { runMigrationsSync } from '../db/migrator.js';
import { seedSavanaUpgrade } from '../test-support/savanaMigrationFixture.js';
import { createNativeCommandContextVerifier } from '../services/nativeCommandContext.js';

const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const sha = raw => crypto.createHash('sha256').update(raw).digest('hex');
const fixture = (t, { namespaceReader = null, acceptedScopes = namespaceReader ? ['savana.collaboration.v1'] : ['savana.products.sync'] } = {}) => {
    const database = new Database(':memory:'); seedSavanaUpgrade(database); runMigrationsSync(database);
    t.after(() => database.close());
    let clock = Date.parse('2026-11-18T12:00:00Z'); const secret = crypto.randomBytes(32);
    const encryption = { encrypt(raw) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
        const bytes = Buffer.concat([cipher.update(raw), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64'); },
    decrypt(raw) { const bytes = Buffer.from(raw, 'base64'), cipher = crypto.createDecipheriv('aes-256-gcm', secret, bytes.subarray(0, 12));
        cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(); } };
    const request = JSON.stringify({ organization_id: 'org', external_tenant_id: 'wa_savana:tenant:1',
        display_name: 'حساب واتساب', public_key_pem: pair.publicKey, accepted_scopes: acceptedScopes });
    const encrypted = encryption.encrypt(JSON.stringify({ purpose: 'wa_consumer_enrollment_key', enrollment_id: 'local-enrollment',
        tenant_id: 1, organization_id: 'org', private_key_pem: pair.privateKey }));
    const response = JSON.stringify({ enrollment_id: 'actual-core-enrollment', organization_id: 'org', platform: 'wa_savana',
        external_tenant_id: 'wa_savana:tenant:1', display_name: 'حساب واتساب', version: 1, accepted_scopes: acceptedScopes, public_key_fingerprint: sha(pair.publicKey) });
    database.prepare(`INSERT INTO savana_operational_consumer_enrollments
        (id,tenant_id,organization_id,external_tenant_id,center_origin,encrypted_private_key,request_json,request_sha256,
        public_key_fingerprint,state,response_json,created_at,updated_at) VALUES(?,1,?,?,?,?,?,?,?,'completed',?,?,?)`)
        .run('local-enrollment', 'org', 'wa_savana:tenant:1', 'https://core.invalid', encrypted, request, sha(request), sha(pair.publicKey), response,
            new Date(clock).toISOString(), new Date(clock).toISOString());
    const command = { spec_version: '1.0', command_id: 'command', version: 1, fingerprint: 'a'.repeat(64), attempt_id: 'attempt',
        capability: 'messaging.send', action: 'messaging.send', scope: { organization_id: 'org', activity_id: 'activity', branch_id: null, warehouse_id: null },
        actor_id: 'reviewer', provider_ref: 'provider', provider_installation_id: 'actual-core-installation', external_tenant_id: 'wa_savana:tenant:1',
        authorization_revision: 'current-scoped-revision', ownership_epoch: null, payload: { payload_type: 'native_action', parameters: { channel: 'sms' } } };
    const delegation = { grant_approved_by: 'actual-native-owner', native_authority_revision: 'actual-owner-snapshot',
        capability_grant_revision: 2, allowed_fields: ['channel'], resource_policy: 'activity', resource_refs: [], scope_epochs: [] };
    Object.assign(command, delegation, { validation_revision: 'b'.repeat(64), validation_valid_until: new Date(clock + 30_000).toISOString() });
    const context = { organization_id: 'org', activity_id: 'activity', external_tenant_id: 'wa_savana:tenant:1', actor_id: 'reviewer', authorization_revision: command.authorization_revision, ...delegation };
    let bindingCalls = 0; let authCalls = 0; let afterBinding = () => {}; let afterAuth = () => {};
    let nativePolicy = async ({ nativeTenantId, action }) => ({ verified: true, nativeTenantId,
        nativeAuthorityRevision: delegation.native_authority_revision,
        resourceFingerprint: ['execute', 'validate'].includes(action) ? 'b'.repeat(64) : null, validUntil: new Date(clock + 30_000).toISOString() });
    const client = { origin: 'https://core.invalid', async authorize(value) {
        authCalls++; const proof = { command_id: value.command_id, version: value.version, fingerprint: value.fingerprint,
            attempt_id: value.attempt_id, authorization_revision: value.authorization_revision, valid_until: new Date(clock + 5000).toISOString(),
            authority_domain:value.authority_domain??null,ownership_epoch:value.ownership_epoch??null,...delegation };
        afterAuth(proof); return proof;
    } };
    const verify = createNativeCommandContextVerifier({ database, encryption, authorizationClient: client, platformToken: 'synthetic-service-token',
        resolveNativeNamespace: namespaceReader,
        now: () => clock, getNativePolicy: args => nativePolicy(args), fetchImpl: async (url, options) => {
            assert.equal(new URL(url).pathname, '/v1/platform-bindings');
            assert.equal(options.headers['X-Savana-Platform-Token'], 'synthetic-service-token');
            assert.equal(options.headers.Authorization, undefined); assert.equal(options.redirect, 'error');
            const value = { id: 'actual-binding', platform_code: 'wa_savana', external_tenant_id: 'wa_savana:tenant:1', organization_id: 'org', status: 'active' };
            afterBinding(++bindingCalls, value); return Response.json([value]);
        } });
    return { database, verify, command, context, client, encryption, clock: () => clock, advance: value => { clock += value; },
        authCalls: () => authCalls, bindingCalls: () => bindingCalls, policy: value => { nativePolicy = value; },
        onBinding: value => { afterBinding = value; }, onAuthorize: value => { afterAuth = value; } };
};

const scopedNamespace = f => {
    const pins={namespace_installation_id:'actual-service-installation',namespace_epoch:4,namespace_version:7};
    Object.assign(f.command,pins,{ownership_epoch:null,authority_domain:'native.service_namespace'});Object.assign(f.context,pins,{authority_domain:'native.service_namespace'});f.onAuthorize(proof=>Object.assign(proof,pins));
    return {spec_version:'1.0',namespace_id:'actual-namespace-id',organization_id:'org',scope:f.command.scope,provider_ref:f.command.provider_ref,
        platform:'wa_savana',external_tenant_id:f.command.external_tenant_id,label:'Actual synthetic service namespace',source_installation_id:pins.namespace_installation_id,
        enrollment_id:'actual-core-enrollment',enrollment_version:1,authority_domain:'native.service_namespace',ownership_epoch:4,version:7,state:'active',
        expires_at:new Date(f.clock()+60000).toISOString(),native_authority_revision:f.command.native_authority_revision,
        grants_created:false,product_credentials_created:false,resource_authority_created:false};
};

test('native execution uses actual account/enrollment/policy and signed Core checkpoint without manufacturing a WA JWT', async t => {
    const f = fixture(t);
    const result = await f.verify({ command: f.command, context: f.context, action: 'execute' });
    assert.equal(result.nativeTenantId, 1); assert.equal(result.executionContext.actor_id, 'reviewer');
    assert.equal(result.executionContext.provider_installation_id, 'actual-core-installation');
    assert.equal(result.localPolicyVerified, true); assert.equal(f.authCalls(), 1); assert.equal(f.bindingCalls(), 2);
    assert.equal(Object.hasOwn(result, 'userId'), false); assert.equal(Object.hasOwn(result, 'sessionId'), false);
    assert.equal(Object.hasOwn(result.executionContext, 'consumer_authorization_revision'), false);
});

test('a foreign organization/account or native inactive state cannot reach effect authorization', async t => {
    for (const mutate of [f => { f.context.organization_id = 'foreign'; },
        f => f.onBinding((_n, row) => { row.organization_id = 'foreign'; }),
        f => f.database.prepare("UPDATE tenants SET status='Suspended' WHERE id=1").run()]) {
        const f = fixture(t); mutate(f);
        await assert.rejects(f.verify({ command: f.command, context: f.context, action: 'execute' }));
        assert.equal(f.authCalls(), 0);
    }
});

test('broken retained key, mismatched enrollment evidence and unverified native policy fail closed', async t => {
    for (const mutate of [f => f.database.prepare("UPDATE savana_operational_consumer_enrollments SET response_json='{}'").run(),
        f => { f.encryption.decrypt = () => null; },
        f => f.policy(async () => ({ verified: false }))]) {
        const f = fixture(t); mutate(f);
        await assert.rejects(f.verify({ command: f.command, context: f.context, action: 'execute' }));
        assert.equal(f.authCalls(), 0);
    }
});

test('current read/reconciliation can show truthful outcome after execute permission expires', async t => {
    const f = fixture(t); f.context.actor_id = 'current-reader';
    f.onAuthorize(() => assert.fail('reading an outcome must not require execution authority'));
    const result = await f.verify({ command: f.command, context: f.context, action: 'reconcile' });
    assert.equal(result.viewer.actorId, 'current-reader'); assert.deepEqual(result.viewer.scope, f.command.scope);
    assert.equal(Object.hasOwn(result, 'executionContext'), false); assert.equal(f.authCalls(), 0);
});

test('preview has a verified viewer and no invented command/installation/grant identity', async t => {
    const f = fixture(t); const command = { capability: 'messaging.send', action: 'messaging.send', payload: f.command.payload };
    const result = await f.verify({ command, context: f.context, action: 'validate' });
    assert.equal(result.viewer.scope.activity_id, 'activity'); assert.equal(Object.hasOwn(result, 'executionContext'), false);
    assert.equal(f.authCalls(), 0);
});

test('withdrawal, expired policy and mismatched authorization during awaits cannot leave a current execution context', async t => {
    for (const mutate of [f => f.onAuthorize(() => f.database.prepare("UPDATE tenants SET status='Suspended' WHERE id=1").run()),
        f => f.onAuthorize(() => f.advance(30_000)), f => f.onAuthorize(proof => { proof.fingerprint = 'c'.repeat(64); }),
        f => f.onAuthorize(proof => { proof.authority_domain='products.goods'; }),f => f.onAuthorize(proof=>{proof.ownership_epoch=1;}),
        f => f.onBinding((n, row) => { if (n === 2) row.id = 'rebound'; }),
        f => f.onBinding(() => { f.context.actor_id = 'changed-during-await'; })]) {
        const f = fixture(t); mutate(f);
        await assert.rejects(f.verify({ command: f.command, context: f.context, action: 'execute' }));
    }
});

test('actual service namespace resolves a distinct namespace ID and binds exact pins without inventing product or warehouse authority',async t=>{
    let current;let lookups=0;const f=fixture(t,{namespaceReader:async input=>{
        lookups++;assert.equal(input.namespaceInstallationId,'actual-service-installation');assert.equal(input.enrollmentId,'actual-core-enrollment');
        assert.equal(input.enrollmentVersion,1);assert.equal(input.providerRef,'provider');assert.equal(input.nativeBindingId,'actual-binding');
        return structuredClone(current);
    }});current=scopedNamespace(f);
    const result=await f.verify({command:f.command,context:f.context,action:'execute'});
    assert.equal(lookups,2);assert.equal(result.executionContext.namespace_installation_id,'actual-service-installation');
    assert.equal(result.executionContext.namespace_epoch,4);assert.equal(result.executionContext.namespace_version,7);
    assert.equal(result.executionContext.ownership_epoch,null);assert.deepEqual(result.executionContext.scope_epochs,[]);
    assert.equal(result.executionContext.authority_domain,'native.service_namespace');
});

test('audited product reception accepts the new enrollment while collaboration still requires a current namespace', async t => {
    let current;
    const f = fixture(t, { namespaceReader: async input => {
        assert.equal(input.enrollmentId, 'actual-core-enrollment');
        assert.equal(input.enrollmentVersion, retainedVersion);
        return structuredClone(current);
    } });
    let retainedVersion = 1;
    current = scopedNamespace(f);
    await f.verify({ command: f.command, context: f.context, action: 'execute' });
    const row = f.database.prepare('SELECT * FROM savana_operational_consumer_enrollments WHERE tenant_id=1').get();
    const extended = { ...JSON.parse(row.response_json), version: 2, accepted_scopes: ['savana.collaboration.v1', 'savana.products.sync'] };
    f.database.prepare('UPDATE savana_operational_consumer_enrollments SET response_json=? WHERE id=?').run(JSON.stringify(extended), row.id);
    retainedVersion = 2;
    await assert.rejects(f.verify({ command: f.command, context: f.context, action: 'execute' }), { code: 'native_enrollment_key_unavailable' });
    assert.equal(f.authCalls(), 1);

    f.database.prepare('INSERT INTO savana_native_enrollment_service_audit'
        + ' (enrollment_id,tenant_id,organization_id,central_actor_id,authority_revision,action,state,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(row.id, 1, 'org', 'actual-native-owner', 'actual-owner-snapshot', 'registration_extended', 'completed', new Date(f.clock()).toISOString());
    await assert.rejects(f.verify({ command: f.command, context: f.context, action: 'execute' }), { code: 'native_namespace_execution_stale' });
    assert.equal(f.authCalls(), 1);

    // Core's separate reviewed namespace renewal returns current enrollment and
    // scope versions. A freshly reviewed command uses those new pins.
    Object.assign(current, { enrollment_version: 2, ownership_epoch: 5, version: 8 });
    const newPins = { namespace_installation_id: current.source_installation_id, namespace_epoch: 5, namespace_version: 8 };
    Object.assign(f.command, newPins, { command_id: 'after-namespace-renewal' });
    Object.assign(f.context, newPins);
    f.onAuthorize(proof => Object.assign(proof, newPins));
    const result = await f.verify({ command: f.command, context: f.context, action: 'execute' });
    assert.equal(result.executionContext.namespace_installation_id, f.command.namespace_installation_id);
    assert.equal(result.executionContext.authorization_revision, f.command.authorization_revision);
    assert.equal(f.authCalls(), 2);
});

test('namespace missing resolver, partial pins, wrong identity/scope/key/version, revoked or expired effect proof fail closed',async t=>{
    const without=fixture(t,{acceptedScopes:['savana.collaboration.v1']});scopedNamespace(without);
    await assert.rejects(without.verify({command:without.command,context:without.context,action:'execute'}),{code:'native_namespace_lookup_required'});
    for(const change of [row=>{row.source_installation_id='foreign-installation';},row=>{row.provider_ref='foreign-provider';},
        row=>{row.external_tenant_id='wa_savana:tenant:9';},row=>{row.scope={...row.scope,activity_id:'foreign'};},
        row=>{row.enrollment_id='foreign-key-enrollment';},row=>{row.enrollment_version=2;},row=>{row.ownership_epoch=5;},
        row=>{row.version=8;},row=>{row.state='revoked';},row=>{row.expires_at='2020-01-01T00:00:00Z';},
        row=>{row.native_authority_revision='unproven-current-owner';}]) {
        let current;const f=fixture(t,{namespaceReader:async()=>structuredClone(current)});current=scopedNamespace(f);change(current);
        await assert.rejects(f.verify({command:f.command,context:f.context,action:'execute'}));assert.equal(f.authCalls(),0);
    }
    const partial=fixture(t);partial.command.namespace_installation_id='some-installation';
    await assert.rejects(partial.verify({command:partial.command,context:partial.context,action:'execute'}),{code:'native_namespace_proof_invalid'});
});

test('namespace changes or expiry during effect authorization cannot leave a live source execution proof',async t=>{
    for(const mutate of [(f,row)=>{row.version++;},(f,row)=>{row.ownership_epoch++;},(f,row)=>{row.state='revoked';},
        (f,row)=>{row.namespace_id='replaced-namespace-id';},(f,row)=>{f.advance(60001);}]) {
        let current;const f=fixture(t,{namespaceReader:async()=>current});current=scopedNamespace(f);
        f.onAuthorize(proof=>{Object.assign(proof,{namespace_installation_id:f.command.namespace_installation_id,namespace_epoch:4,namespace_version:7});mutate(f,current);});
        await assert.rejects(f.verify({command:f.command,context:f.context,action:'execute'}));
    }
});

test('read-only reconciliation sees actual revoked/expired lifecycle without reviving old execute epochs or requiring execute rights',async t=>{
    let current;const f=fixture(t,{namespaceReader:async input=>{assert.equal(input.action,'reconcile');return structuredClone(current);}});current=scopedNamespace(f);
    current.state='revoked';current.version=8;current.ownership_epoch=5;current.expires_at='2020-01-01T00:00:00Z';
    f.context.namespace_version=8;f.context.namespace_epoch=5;f.context.actor_id='actual-current-reader';
    f.onAuthorize(()=>assert.fail('historical read cannot require execution grant'));
    const result=await f.verify({command:f.command,context:f.context,action:'reconcile'});
    assert.equal(result.viewer.actorId,'actual-current-reader');assert.equal(f.authCalls(),0);assert.equal(Object.hasOwn(result,'executionContext'),false);
});


test('V2 validation rejects owner-session and Core-internal claims before any native policy or effect call', async t => {
    for (const extra of [{ session_version: 1 }, { provider_ref: 'core-private-provider' },
        { consumer_authorization_revision: 'd'.repeat(64) }, { allowed_value_contexts: {} }, { scope: { organization_id: 'org', activity_id: 'activity' } }]) {
        const f = fixture(t); const command = { capability: f.command.capability, action: f.command.action, payload: f.command.payload };
        await assert.rejects(f.verify({ command, context: { ...f.context, ...extra }, action: 'validate' }), { code: 'native_command_model_invalid' });
        assert.equal(f.authCalls(), 0); assert.equal(f.bindingCalls(), 0);
    }
    const f = fixture(t);
    await assert.rejects(f.verify({ command: f.command, context: { ...f.context, consumer_authorization_revision: 'd'.repeat(64) }, action: 'execute' }), { code: 'native_viewer_context_invalid' });
    assert.equal(f.authCalls(), 0);
});

test('V2 branch validation takes its full scope only from the fresh exact namespace response', async t => {
    let current; let calls = 0; const scopes = [];
    const f = fixture(t, { namespaceReader: async input => {
        calls++; assert.equal(input.validationOnly, true); assert.equal(input.action, 'validate');
        assert.equal(input.scope.branch_id, null); assert.equal(input.scope.warehouse_id, null);
        return structuredClone(current);
    } });
    current = scopedNamespace(f); current.scope = { ...current.scope, branch_id: 'actual-branch', warehouse_id: 'actual-warehouse' };
    f.policy(async input => { scopes.push(input.scope); return { verified: true, nativeTenantId: 1,
        nativeAuthorityRevision: f.command.native_authority_revision, resourceFingerprint: 'b'.repeat(64), validUntil: new Date(f.clock() + 30000).toISOString() }; });
    const command = { capability: f.command.capability, action: f.command.action, payload: f.command.payload };
    const result = await f.verify({ command, context: f.context, action: 'validate' });
    assert.equal(calls, 3); assert.deepEqual(result.viewer.scope, current.scope); assert.deepEqual(scopes, [current.scope]);
    assert.equal(f.authCalls(), 0); assert.equal(Object.hasOwn(result, 'executionContext'), false);
    current.state = 'revoked';
    await assert.rejects(f.verify({ command, context: f.context, action: 'validate' }), { code: 'native_namespace_execution_stale' });
});

test('V2 parameter handlers reject semantic proof before authorization and namespace scope races never validate', async t => {
    const plain = fixture(t);
    await assert.rejects(plain.verify({ command: { ...plain.command, effect_fields: ['message'], effect_resources: [], creates_resource: false },
        context: plain.context, action: 'execute' }), { code: 'native_permission_contract_unsupported' });
    assert.equal(plain.bindingCalls(), 0); assert.equal(plain.authCalls(), 0);
    let current; let reads = 0;
    const f = fixture(t, { namespaceReader: async () => { const result = structuredClone(current); if (++reads === 2) result.scope.branch_id = 'changed'; return result; } });
    current = scopedNamespace(f);
    await assert.rejects(f.verify({ command: { capability: f.command.capability, action: f.command.action, payload: f.command.payload },
        context: f.context, action: 'validate' }), { code: 'native_namespace_changed_during_authorization' });
});
