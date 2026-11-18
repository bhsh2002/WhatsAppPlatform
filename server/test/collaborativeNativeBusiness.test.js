import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import {runMigrationsSync} from '../db/migrator.js';
import {CollaborativeExecutionService} from '../services/collaborativeExecution.js';
import {createCollaborativeNativeBusinessAdapters,NATIVE_BUSINESS_FIELDS,nativeBusinessAccount,nativeOperationRef} from '../services/collaborativeNativeBusiness.js';
import {createCollaborativeNativePolicy} from '../services/collaborativeNativeAdapters.js';
import {CollaborativeNativeBusinessOwnerService} from '../services/collaborativeNativeBusinessOwner.js';
import {CollaborativeConsentService} from '../services/collaborativeConsents.js';
import {changeNativeContact} from '../services/nativeContacts.js';
import {readNativeMessageAnalytics} from '../services/nativeMessageAnalytics.js';
import {createCollaborativeNativeDiscovery} from '../services/collaborativeNativeDiscovery.js';

const at=Date.parse('2026-11-18T12:00:00Z');
const scope={organization_id:'synthetic-org',activity_id:'synthetic-activity',branch_id:null,warehouse_id:null};
const principal={tenantId:1,userId:1};
const fixture=async t=>{
    const db=new Database(':memory:');runMigrationsSync(db);t.after(()=>db.close());
    db.exec(`INSERT INTO tenants(id,name,phone,status) VALUES(1,'Synthetic owner','218910000001','Active'),(2,'Other owner','218910000002','Active');
        INSERT INTO users(id,username,password_hash,role,tenant_id,is_active) VALUES(1,'synthetic-owner','unused','tenant',1,1);
        INSERT INTO contacts(id,tenant_id,phone,profile_name,label,notes) VALUES(1,1,'218910000021','Synthetic Contact','customer','Private synthetic note'),(2,2,'218910000022','Foreign Contact','other','Foreign note');
        INSERT INTO messages(tenant_id,wamid,direction,status,message_type) VALUES(1,'synthetic-one','outgoing','sent','text'),(1,'synthetic-two','incoming','received','text'),(2,'synthetic-foreign','outgoing','failed','image');`);
    const key=crypto.randomBytes(32);const encryption={encrypt:value=>{
        const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
        return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');},decrypt:value=>{
        const bytes=Buffer.from(value,'base64');const decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));
        return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString();}};
    let clock=at;let ownerActive=true;let onAuthorize=null;let readFields=['contact.profile_name','contact.revision','result.status'];let policy='activity';let refs=[];
    const local=p=>ownerActive&&p.tenantId===1&&p.userId===1;
    const owner=async()=>({verified:true,canManageConsent:true,nativeTenantId:1,nativeUserId:1,actorId:'synthetic-owner',scope,validUntil:new Date(clock+30000).toISOString()});
    const consents=new CollaborativeConsentService({database:db,verifyOwnerAuthority:owner,verifyLocalPrincipal:local,now:()=>clock});
    const consent=await consents.record(principal,{activity_ref:'synthetic-activity-choice',channel:'native',account_ref:'native_contacts',recipient_ref:'native_contact:1',purpose:'customer_service',
        evidence:{kind:'owner_recorded',reference:'synthetic-explicit-record',note:'Synthetic explicit permission for customer service data use only.',recorded_at:new Date(at-1000).toISOString()},
        valid_until:new Date(at+3600000).toISOString(),idempotency_key:'synthetic-consent-key'});
    const adapters=createCollaborativeNativeBusinessAdapters({database:db,encryption,consents,now:()=>clock});
    const fields=[...new Set(Object.values(NATIVE_BUSINESS_FIELDS).flat())];
    const delegation={grant_approved_by:'synthetic-owner',native_authority_revision:'synthetic-source-owner',capability_grant_revision:2,
        allowed_fields:fields,resource_policy:'activity',resource_refs:[],scope_epochs:[]};
    const getPolicy=createCollaborativeNativePolicy({database:db,nativeAdapters:adapters,now:()=>clock,getNativeAuthority:async()=>({verified:true,nativeTenantId:1,
        nativeAuthorityRevision:'synthetic-source-owner',grantApprovedBy:'synthetic-owner',validUntil:new Date(clock+30000).toISOString()})});
    const authorization=cmd=>({command_id:cmd.command_id,version:cmd.version,fingerprint:cmd.fingerprint,attempt_id:cmd.attempt_id,
        authorization_revision:cmd.authorization_revision,valid_until:new Date(clock+5000).toISOString(),...delegation});
    const service=new CollaborativeExecutionService({database:db,nativeAdapters:adapters,now:()=>clock,
        verifyNativeContext:async({command,action})=>({verified:true,localPolicyVerified:true,nativeTenantId:1,
            ...(action==='execute'?{executionContext:{actor_id:command.actor_id,scope,provider_ref:command.provider_ref,provider_platform:'wa_savana',provider_installation_id:command.provider_installation_id,
                external_tenant_id:command.external_tenant_id,authorization_revision:command.authorization_revision,valid_until:new Date(clock+5000).toISOString(),ownership_epoch:null,...delegation}}
                :{viewer:{scope,actorId:'synthetic-actor',allowedFields:readFields,resourcePolicy:policy,resourceRefs:refs,validUntil:new Date(clock+30000).toISOString()}})}),
        authorizeEffect:async cmd=>{if(onAuthorize)await onAuthorize(cmd);return authorization(cmd);}});
    const make=async(action,parameters,capability='customers.manage')=>{
        const payload={payload_type:'native_action',parameters:{channel:'native',account_ref:nativeBusinessAccount(capability),purpose:'customer_service',evidence_reference:'synthetic-work-reference',...parameters}};
        const adapter=adapters[`${capability}:native`];const checked=adapter.validate(payload,action);
        const prepared=await adapter.prepare({tenantId:1,scope,parameters:checked.parameters,command:{capability,action,payload},preview:true});
        return {spec_version:'1.0',command_id:crypto.randomUUID(),version:1,fingerprint:'a'.repeat(64),attempt_id:crypto.randomUUID(),capability,action,scope,
            actor_id:'synthetic-actor',provider_ref:'synthetic-wa-provider',provider_installation_id:'synthetic-wa-installation',external_tenant_id:'wa_savana:tenant:1',
            authorization_revision:'synthetic-core-revision',ownership_epoch:null,...delegation,validation_revision:prepared.resourceFingerprint,
            validation_valid_until:new Date(clock+30000).toISOString(),payload:{...payload,parameters:prepared.parameters}};
    };
    const ownerContext=async()=>({verified:true,localPolicyVerified:true,nativeTenantId:1,nativeUserId:1,canManageConsent:true,
        viewer:{scope,actorId:'synthetic-actor',allowedFields:fields,resourcePolicy:policy,resourceRefs:refs,validUntil:new Date(clock+30000).toISOString()}});
    return {db,adapters,service,consents,consent,make,getPolicy,delegation,ownerContext,local,
        setAuthorize:fn=>{onAuthorize=fn;},setFields:value=>{readFields=value;},setPolicy:(value,values=[])=>{policy=value;refs=values;},setOwner:value=>{ownerActive=value;},tick:ms=>{clock+=ms;}};
};
const contact=(f,extra={})=>({contact_ref:'native_contact:1',consent_ref:f.consent.value,...extra});

test('native CRM creation, change and source revision use actual shared commands and durable duplicate receipt without consent creation',async t=>{
    const f=await fixture(t);const create=await f.make('contacts.create',{phone:'218910000099',profile_name:'New synthetic customer'});
    const applied=await f.service.execute(create,{});assert.equal(applied.outcome,'applied');assert.equal(applied.source_result.source_revision,1);
    assert.deepEqual(await f.service.execute(create,{}),applied);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM contacts WHERE tenant_id=1').get().n,2);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_collaborative_consents').get().n,1);
    const change=await f.make('contacts.change',contact(f,{expected_revision:1,label:'updated'}));
    assert.equal((await f.service.execute(change,{})).source_result.source_revision,2);
    assert.equal(f.db.prepare('SELECT source_revision,label FROM contacts WHERE id=1').get().source_revision,2);
    changeNativeContact(f.db,{tenantId:1,contactId:1,body:{notes:'Changed by ordinary native command'}});
    assert.equal(f.db.prepare('SELECT source_revision FROM contacts WHERE id=1').get().source_revision,3);
    assert.throws(()=>changeNativeContact(f.db,{tenantId:1,contactId:1,body:{label:'stale'},expectedRevision:2}),{code:'native_contact_revision_conflict'});
    const fact=f.db.prepare('SELECT * FROM savana_native_action_facts LIMIT 1').get();assert.doesNotMatch(fact.encrypted_result,/218910000099|New synthetic customer/);
    assert.throws(()=>f.db.prepare('UPDATE savana_native_action_facts SET action=? WHERE id=?').run('changed',fact.id),/native_action_fact_immutable/);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM billing_usage_events').get().n,0);
});

test('current source policy enforces exact delegated CRM fields, selected resources and new-only semantics',async t=>{
    const f=await fixture(t);const cmd=await f.make('contacts.change',contact(f,{expected_revision:1,label:'Synthetic change'}));
    await f.getPolicy({command:cmd,nativeTenantId:1,scope,action:'execute'});
    await assert.rejects(f.getPolicy({command:{...cmd,allowed_fields:['channel']},nativeTenantId:1,scope,action:'execute'}),{code:'native_parameter_delegation_required'});
    await assert.rejects(f.getPolicy({command:{...cmd,resource_policy:'selected',resource_refs:['native_contacts','native_contact:1']},nativeTenantId:1,scope,action:'execute'}),{code:'native_resource_delegation_required'});
    await assert.rejects(f.getPolicy({command:{...cmd,resource_policy:'new_only'},nativeTenantId:1,scope,action:'execute'}),{code:'native_resource_delegation_required'});
    await assert.rejects(f.getPolicy({command:{...cmd,authority_domain:'products.goods',ownership_epoch:1},nativeTenantId:1,scope,action:'execute'}),{code:'native_authority_domain_unsupported'});
    await assert.rejects(f.make('contacts.read',{contact_ref:'native_contact:2',consent_ref:f.consent.value}),{code:'native_contact_not_found'});
    await assert.rejects(f.make('contacts.create',{phone:'invalid'}),{code:'native_contact_parameters_invalid',status:422});
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_native_action_facts').get().n,0);
});

test('CRM source changes and purpose withdrawal during the real effect checkpoint prevent any local mutation',async t=>{
    const f=await fixture(t);const cmd=await f.make('contacts.change',contact(f,{expected_revision:1,label:'must not apply'}));
    f.setAuthorize(async()=>f.consents.revoke(principal,f.consent.value,{activity_ref:'synthetic-activity-choice',expected_version:1}));
    const result=await f.service.execute(cmd,{});assert.equal(result.outcome,'not_applied');assert.equal(result.no_effect_proof.execution_fenced,true);
    assert.equal(f.db.prepare('SELECT label FROM contacts WHERE id=1').get().label,'customer');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_native_action_facts').get().n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_collaborative_effects').get().n,0);
});

test('an interrupted local acknowledgement recovers the original encrypted fact without another mutation',async t=>{
    const f=await fixture(t);const adapter=f.adapters['customers.manage:native'];const execute=adapter.execute;
    adapter.execute=input=>execute({...input,effect:spec=>input.effect({...spec,run:async args=>{await spec.run(args);const error=new Error('Synthetic lost local reply');error.deliveryUncertain=true;throw error;}})});
    const cmd=await f.make('contacts.change',contact(f,{expected_revision:1,label:'once'}));
    assert.equal((await f.service.execute(cmd,{})).outcome,'unknown');
    assert.equal(f.db.prepare('SELECT source_revision FROM contacts WHERE id=1').get().source_revision,2);
    assert.equal((await f.service.reconcile(cmd,{})).outcome,'applied');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_native_action_facts').get().n,1);
    assert.equal(f.db.prepare('SELECT source_revision FROM contacts WHERE id=1').get().source_revision,2);
});

test('authorized customer snapshot contains only current permitted fields and purpose withdrawal denies subsequent data reads',async t=>{
    const f=await fixture(t);const cmd=await f.make('contacts.read',contact(f));await f.service.execute(cmd,{});
    const result=await f.service.result(cmd.command_id,{});assert.deepEqual(result.data.records,[{profile_name:'Synthetic Contact',source_revision:1}]);
    assert.doesNotMatch(JSON.stringify(result),/218910000021|Private synthetic note|Foreign Contact/);
    f.setFields(['contact.notes']);const notes=await f.service.result(cmd.command_id,{});assert.deepEqual(notes.data.records,[{notes:'Private synthetic note'}]);
    await f.consents.revoke(principal,f.consent.value,{activity_ref:'synthetic-activity-choice',expected_version:1});
    await assert.rejects(f.service.result(cmd.command_id,{}),{code:'consent_current_record_required'});
    f.setFields(['result.status']);assert.equal((await f.service.result(cmd.command_id,{})).data.outcome,'applied');
});

test('measurement snapshots use native dashboard aggregates, retain exact original facts and export only permitted measures',async t=>{
    const f=await fixture(t);const cmd=await f.make('measurement.export',{},'measurement.export');
    f.setFields(['measurement.total','measurement.sent']);await f.service.execute(cmd,{});
    const native=readNativeMessageAnalytics({database:f.db,tenantId:1});assert.equal(native.totalMessages,2);
    f.db.exec("INSERT INTO messages(tenant_id,wamid,direction,status,message_type) VALUES(1,'synthetic-later','outgoing','sent','image')");
    const result=await f.service.result(cmd.command_id,{});assert.deepEqual(result.data.records,[{totalMessages:2,sentMessages:1}]);
    assert.equal(result.data.outcome,undefined);assert.doesNotMatch(JSON.stringify(result),/Foreign|phone|profile_name|failedMessages|typeDistribution/);
    const csv=await f.service.result(cmd.command_id,{}, {format:'csv'});assert.match(csv.text,/totalMessages/);assert.doesNotMatch(csv.text,/failedMessages/);
    f.setFields([]);await assert.rejects(f.service.result(cmd.command_id,{}),{code:'native_result_field_permission_required'});
});

test('business choices and preview require actual field/resource authority and retain named current consent without writes',async t=>{
    const f=await fixture(t);const owner=new CollaborativeNativeBusinessOwnerService({database:f.db,nativeAdapters:f.adapters,consents:f.consents,verifyOwnerContext:f.ownerContext,verifyLocalPrincipal:f.local,now:()=>at});
    const options=await owner.options(principal,{activity_ref:'synthetic-choice',capability:'customers.manage'});
    assert.deepEqual(options.contacts,[{value:'native_contact:1',label:'Synthetic Contact',source_revision:1,available:true}]);
    assert.equal(options.consent_evidence[0].value,f.consent.value);assert.equal(options.consent_management.can_record,true);
    const cmd=await f.make('contacts.read',contact(f));const preview=await owner.preview(principal,{activity_ref:'synthetic-choice',capability:'customers.manage',action:'contacts.read',parameters:cmd.payload.parameters});
    assert.equal(preview.availability.state,'review_available');assert.equal(preview.resource_fingerprint.length,64);assert.equal(preview.normalized_parameters.resource_fingerprint,undefined);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_native_action_facts').get().n,0);
    f.setPolicy('selected',['native_contacts']);const limited=await owner.options(principal,{activity_ref:'synthetic-choice',capability:'customers.manage'});assert.equal(limited.contacts.length,0);
    f.setOwner(false);await assert.rejects(owner.options(principal,{activity_ref:'synthetic-choice',capability:'customers.manage'}),{code:'native_owner_session_required'});
});

test('consent lookup recovers only the original current native user, Core actor, scope and exact resource operation',async t=>{
    const f=await fixture(t);const input={activity_ref:'synthetic-activity-choice',channel:'native',account_ref:'native_contacts',recipient_ref:'native_contact:1',purpose:'customer_service',idempotency_key:'synthetic-consent-key'};
    assert.equal((await f.consents.lookup(principal,input)).record.value,f.consent.value);
    assert.equal((await f.consents.lookup(principal,{activity_ref:input.activity_ref,idempotency_key:input.idempotency_key})).record.value,f.consent.value);
    assert.equal((await f.consents.lookup(principal,{activity_ref:'synthetic-opaque-activity:'+ 'a'.repeat(1500),idempotency_key:input.idempotency_key})).record.value,f.consent.value);
    await assert.rejects(f.consents.lookup(principal,{...input,idempotency_key:'synthetic-missing-key'}),{code:'consent_lookup_unresolved',status:404});
    await assert.rejects(f.consents.lookup(principal,{...input,purpose:'correction'}),{code:'consent_lookup_unresolved',status:404});
    await f.consents.revoke(principal,f.consent.value,{activity_ref:'synthetic-activity-choice',expected_version:1});
    assert.equal((await f.consents.lookup(principal,input)).record.revoked,true);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_collaborative_consents').get().n,1);
});

test('owner operations exposes an actual permitted native command snapshot without reconciling or repeating the original effect',async t=>{
    const f=await fixture(t);const original=await f.make('contacts.read',contact(f));await f.service.execute(original,{});
    const ref=nativeOperationRef({command_id:original.command_id,version:original.version});
    const status=await f.make('owner.operation_status',{command_ref:ref},'owner.operations');
    f.setFields(['operation.status','operation.counts']);await f.service.execute(status,{});
    const result=await f.service.result(status.command_id,{});assert.deepEqual(result.data.records,[{state:'applied',counts:{accepted:1}}]);
    assert.doesNotMatch(JSON.stringify(result.data),/218910000021|Synthetic Contact|Private synthetic note|native_contact:1|result_reference/);
    const before=f.db.prepare('SELECT COUNT(*) n FROM savana_collaborative_effects').get().n;
    assert.equal((await f.service.reconcile(status,{})).outcome,'applied');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_collaborative_effects').get().n,before);
    f.setPolicy('selected',['native_operations']);assert.deepEqual((await f.service.result(status.command_id,{})).data.records,[]);
    f.setPolicy('activity');const owner=new CollaborativeNativeBusinessOwnerService({database:f.db,nativeAdapters:f.adapters,consents:f.consents,verifyOwnerContext:f.ownerContext,verifyLocalPrincipal:f.local,now:()=>at});
    const choices=await owner.options(principal,{activity_ref:'synthetic-choice',capability:'owner.operations'});assert.ok(choices.operations.some(row=>row.value===ref));
    assert.equal(choices.accounts[0].value,'native_operations');
});

test('delegated signed discovery does not expose native choices or field names beyond its exact policy',async t=>{
    const f=await fixture(t);const discovery=createCollaborativeNativeDiscovery({database:f.db,nativeAdapters:f.adapters,consents:f.consents,now:()=>at,
        getNativeAuthority:async()=>({verified:true,nativeTenantId:1,grantApprovedBy:'synthetic-owner',nativeAuthorityRevision:'synthetic-native-owner-revision',validUntil:new Date(at+30000).toISOString()}),
        loadSubscriptionFacts:async()=>({verified:true,bound:true,entitled:true,validUntil:new Date(at+30000).toISOString()})});
    const context={actor_id:'synthetic-delegated-reader',grant_approved_by:'synthetic-owner',organization_id:scope.organization_id,activity_id:scope.activity_id,external_tenant_id:'wa_savana:tenant:1'};
    await assert.rejects(discovery.discovery(context),{code:'native_discovery_delegation_required'});
    const selected={...context,native_authority_revision:'synthetic-native-owner-revision',authorization_revision:'synthetic-central-revision',capability_grant_revision:2,
        allowed_fields:['contact.profile_name'],resource_policy:'selected',resource_refs:['native_contacts','native_contact:1'],scope_epochs:[]};
    const result=await discovery.discovery(selected);const customers=result.providers[0].capabilities.find(row=>row.capability==='customers.manage');
    assert.deepEqual(customers.allowed_fields.map(row=>row.value),['contact.profile_name']);
    assert.deepEqual(customers.resources.map(row=>row.resource_ref),['native_contacts','native_contact:1']);
    assert.equal(customers.configured,false);assert.doesNotMatch(JSON.stringify(result),/Foreign Contact|Private synthetic note|218910000021/);
    const newOnly=await discovery.discovery({...selected,resource_policy:'new_only',resource_refs:[]});
    assert.ok(newOnly.providers[0].capabilities.every(row=>row.resources.length===0));
});
