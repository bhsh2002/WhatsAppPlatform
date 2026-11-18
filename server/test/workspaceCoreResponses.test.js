import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { decodeWorkspaceContext, decodeWorkspaceSelection, decodeWorkspaceRequest, decodeWorkspaceBinding,
    decodeWorkspaceNamespace, decodeWorkspaceActivity, decodeWorkspaceProviderPrepare, decodeWorkspaceProviderConfirmation, decodeWorkspaceAvailability,
    decodeWorkspaceCommandOption, decodeWorkspaceCapabilityGrantOption, decodeWorkspaceCurrentCapabilityGrant, decodeWorkspaceServiceShare, decodeWorkspaceServiceShareOption, decodeWorkspaceNativeCommandOption,
    WORKSPACE_RESPONSE_OPTIONS_SHA256, WORKSPACE_PROVIDER_CONFIRMATION_SHA256 } from '../services/workspaceCoreResponses.js';

// Exact readonly actual HTTP v4 bytes:190dd989b4aa5ffc227fd7dfc8b3f34dca0e0eee027bd386fbc4e6de53bb07c9.
// Native namespace excerpt: published 2d057d36810e8ad9c1fac305dc8e8df6fd6da7933ef1cd41629d9fafa645e6ae.
// Rich contexts contain deliberately redacted states and are NEGATIVE fixtures.
const actualBytes = fs.readFileSync(new URL('../test-fixtures/peer-owner-workspace-responses-v4.json', import.meta.url));
const actual = JSON.parse(actualBytes);
// Exact separately published owned Core/Portal + signed native HTTP boundary
// receipt, not a synthetic rewrite of the V4 all-empty sharing arrays.
const serviceBytes = fs.readFileSync(new URL('../test-fixtures/peer-service-sharing-http-responses-v1.json', import.meta.url));
const serviceActual = JSON.parse(serviceBytes);
const serviceExamples = serviceActual.examples;
const serviceIdentity = { actorId: serviceExamples.context_populated_service_share_options.actor.account_id,
    organizationId: serviceExamples.context_populated_service_share_options.organization.id };
const nativeBytes = fs.readFileSync(new URL('../test-fixtures/peer-native-command-options-http-v1.json', import.meta.url));
const nativeActual = JSON.parse(nativeBytes);
const nativeExamples = nativeActual.examples;
const nativeIdentity = value => ({ actorId: value.actor.account_id, organizationId: value.organization.id });
const nativePolicy = { allowLoopback: true, allowedOrigins: ['https://core.owned.example'] };
const namespaceExample = {"authority_domain": "native.service_namespace", "enrollment_id": "synthetic-enrollment-id", "enrollment_version": 1, "expires_at": "2030-01-01T00:00:00Z", "external_tenant_id": "synthetic-native-service-account", "grants_created": false, "label": "حساب خدمات Catalog فقط", "namespace_id": "synthetic-namespace-id", "native_authority_revision": "actual-owned-service-owner-revision-1", "organization_id": "synthetic-org", "ownership_epoch": 1, "platform": "catalog", "product_credentials_created": false, "provider_ref": "synthetic-provider-ref", "resource_authority_created": false, "scope": {"activity_id": "synthetic-activity", "branch_id": null, "organization_id": "synthetic-org", "warehouse_id": null}, "source_installation_id": "synthetic-service-installation", "spec_version": "1.0", "state": "active", "version": 1};
const examples = { ...actual.examples, namespace: namespaceExample };
const copy = value => structuredClone(value);
const identity = {actorId:examples.context_initial.actor.account_id,organizationId:examples.context_initial.organization.id,
    nativeAccountId:examples.selection_saw_registered.account.external_tenant_id};
const policy = {allowLoopback:true};
const invalid = {code:'workspace_response_invalid',status:502};

test('published v3 nonempty service share responses preserve both independent approvals without becoming selectable authority',()=>{
    // Synthetic response shape against the exact published v3 schema, not
    // native sharing acceptance or an inferred service_share_options shape.
    const row={share_id:'owned-share',activity_id:'owned-activity',version:1,state:'pending',source_provider_ref:'source-provider',
        consumer_provider_ref:'consumer-provider',capability_code:'messaging.send',people_refs:['owner-person'],actions:['request'],
        allowed_fields:['body'],resource_policy:'selected',resource_refs:['owned-account'],expires_at:'2030-01-01T00:00:00Z',
        source_label:'مصدر الرسائل',consumer_label:'حساب الاستهلاك',people:[{person_ref:'owner-person',label:'المالك'}],
        source_approved:true,consumer_approved:false,effective:false,reason_code:'consumer_approval_required',grants_created:false,
        product_credentials_created:false,can_cancel:true};
    assert.deepEqual(decodeWorkspaceServiceShare(row),row);
    for(const malformed of [{...row,effective:true},{...row,people:[{person_ref:'foreign',label:'شخص آخر'}]},
        {...row,resource_refs:[]},{...row,grants_created:true},{...row,product_credentials_created:true},{...row,actor_id:'supplied'}]) {
        assert.throws(()=>decodeWorkspaceServiceShare(malformed),invalid);
    }
});

test('actual initial HTTP context is direct, closed, cloned and correlated to fresh Core identity',()=>{
    const raw=copy(examples.context_initial); const decoded=decodeWorkspaceContext(raw,identity,policy);
    assert.deepEqual(decoded,raw); assert.notEqual(decoded,raw); assert.notEqual(decoded.policies,raw.policies);
    for(const malformed of [{data:raw},{...raw,organization:{...raw.organization,id:'foreign'}},{...raw,actor:{...raw.actor,account_id:'foreign'}},
        {...raw,access_token:'must-not-leak'}, {...raw,activities:null}]) assert.throws(()=>decodeWorkspaceContext(malformed,identity,policy),invalid);
});

test('actual selection does not create a grant and correlates organization/activity/native account with exact fields',()=>{
    const raw=copy(examples.selection_saw_registered); assert.deepEqual(decodeWorkspaceSelection(raw,identity,policy),raw);
    for(const malformed of [{...raw,grants_created:true},{...raw,account:{...raw.account,account_id:raw.account.provider_ref}},
        {...raw,scope:{...raw.scope,activity_id:'different'}},{...raw,version:'1'}]) assert.throws(()=>decodeWorkspaceSelection(malformed,identity,policy),invalid);
    assert.throws(()=>decodeWorkspaceSelection(raw,{...identity,nativeAccountId:'different'},policy),invalid);
    assert.throws(()=>decodeWorkspaceSelection(raw,identity,{...policy,scope:{...raw.scope,warehouse_id:'different'}}),invalid);
});

test('actual source/read requests retain lifecycle versions, exact scope and endpoint-specific effective resources',()=>{
    for(const raw of [examples.operational_source_registration_approved,examples.operational_read_sharing_pending,examples.operational_read_sharing_approved]) {
        assert.deepEqual(decodeWorkspaceRequest(raw,identity,{scope:raw.scope}),raw);
        assert.throws(()=>decodeWorkspaceRequest({...raw,organization_id:'foreign'},identity),invalid);
        assert.throws(()=>decodeWorkspaceRequest({...raw,scope:{...raw.scope,organization_id:'foreign'}},identity),invalid);
        assert.throws(()=>decodeWorkspaceRequest({...raw,version:1.5},identity),invalid);
        assert.throws(()=>decodeWorkspaceRequest({...raw,effective_resource:{...raw.effective_resource,password:'hidden'}},identity),invalid);
    }
    const approved=copy(examples.operational_read_sharing_approved);
    assert.throws(()=>decodeWorkspaceRequest({...approved,effective_version:2},identity),invalid);
    const tampered=copy(approved);tampered.effective_resource.reader_account_ids=['foreign-reader'];
    assert.throws(()=>decodeWorkspaceRequest(tampered,identity),invalid);
    const pending=copy(examples.operational_read_sharing_pending);
    assert.throws(()=>decodeWorkspaceRequest({...pending,effective_resource:approved.effective_resource},identity),invalid);
});

test('actual named overview requests/grants/origin can be decoded without inventing state from redacted capability evidence',()=>{
    const rich=copy(examples.context_rich_catalog);
    assert.throws(()=>decodeWorkspaceContext(rich,identity,policy),invalid);
    // Narrow structural consumer test only. Removing deliberately redacted
    // provider/capability entries never claims the original HTTP state was ready.
    rich.providers=[];rich.capabilities=[];rich.command_options=[];rich.capability_grant_options=[];
    const result=decodeWorkspaceContext(rich,identity,policy);
    assert.equal(result.existing.requests.length,4);assert.equal(result.existing.grants.length,2);assert.equal(result.existing.origin_evidence.length,1);
});

test('pending edited proposal retains independently typed prior effective policy without granting its new fields or readers',()=>{
    const approved=copy(examples.operational_read_sharing_approved);
    const pending={...approved,version:2,state:'pending',reviewed_by:null,effective_version:1,
        proposal:{...approved.proposal,fields:['description'],reader_account_ids:['new-reader']}};
    const result=decodeWorkspaceRequest(pending,identity);
    assert.deepEqual(result.proposal.fields,['description']);
    assert.deepEqual(result.effective_resource.fields,['name']);
    assert.equal(result.effective_version,1);assert.equal(result.version,2);
    assert.throws(()=>decodeWorkspaceRequest({...pending,effective_version:2},identity),invalid);
    assert.throws(()=>decodeWorkspaceRequest({...pending,effective_version:3},identity),invalid);
    assert.throws(()=>decodeWorkspaceRequest({...pending,effective_resource:{...pending.effective_resource,grant_all:true}},identity),invalid);
    assert.throws(()=>decodeWorkspaceRequest({...pending,state:'approved',reviewed_by:identity.actorId,effective_version:2},identity),invalid);
});

test('actual binding start/lookup/status are direct DTOs with same actor/org/external tenant and operator URL policy',()=>{
    const p={...identity,nativeAccountId:examples.binding_request_pending.external_tenant_id};
    for(const raw of [examples.binding_request_pending,examples.binding_lookup_approved,examples.binding_status_approved]) {
        const options={...policy,platformCode:'catalog'};
        assert.deepEqual(decodeWorkspaceBinding(raw,p,options),raw);
        assert.throws(()=>decodeWorkspaceBinding({...raw,external_tenant_id:'foreign'},p,options),invalid);
        assert.throws(()=>decodeWorkspaceBinding({...raw,organization_id:'foreign'},p,options),invalid);
    }
    const raw=copy(examples.binding_request_pending);
    assert.throws(()=>decodeWorkspaceBinding({...raw,created_by_actor:'foreign'},p,{...policy,platformCode:'catalog'}),invalid);
    assert.throws(()=>decodeWorkspaceBinding(raw,p,{...policy,platformCode:'catalog',allowedOrigins:['https://trusted.example.test']}),invalid);
});

test('genuine namespace response is separate from product grants and uses exact current scope/version/native authority fields',()=>{
    const raw=copy(examples.namespace);const p={organizationId:raw.organization_id};
    assert.deepEqual(decodeWorkspaceNamespace(raw,p,{providerRef:raw.provider_ref,scope:raw.scope}),raw);
    for(const malformed of [{...raw,grants_created:true},{...raw,product_credentials_created:true},{...raw,authority_domain:'product.core'},
        {...raw,ownership_epoch:0},{...raw,native_authority_revision:null}]) assert.throws(()=>decodeWorkspaceNamespace(malformed,p),invalid);
    assert.throws(()=>decodeWorkspaceNamespace(raw,p,{externalTenantId:'foreign'}),invalid);
});

test('closed activity and actual v4 full provider prepare/extension/confirmation retain exact scoped enrollment without grants',()=>{
    const activity={activity_id:'synthetic-activity',label:'نشاط تجريبي',version:1,grants_created:false,next_action:{label:'الأشخاص',href:'/?workspace=shared'}};
    assert.deepEqual(decodeWorkspaceActivity(activity,identity),activity);
    assert.throws(()=>decodeWorkspaceActivity({...activity,grants_created:true},identity),invalid);
    for(const name of ['provider_prepare_product_scope','provider_confirmation_product_scope','provider_prepare_scope_extension','provider_readonly_lost_ack_confirmation']) {
        const prepare=examples[name];const options={providerRef:prepare.provider_ref,activityId:prepare.activity_id,scope:prepare.scope,
            platformCode:'catalog',externalTenantId:prepare.enrollment.external_tenant_id,enrollmentId:prepare.enrollment.enrollment_id,
            enrollmentVersion:prepare.enrollment_version,publicKeyFingerprint:prepare.enrollment.public_key_fingerprint,
            acceptedScopes:prepare.enrollment.accepted_scopes,status:prepare.status};
        assert.deepEqual(decodeWorkspaceProviderPrepare(prepare,identity,options),prepare);
        assert.deepEqual(decodeWorkspaceProviderConfirmation(prepare,identity,options),prepare);
        for(const malformed of [{...prepare,profile:{ready:true}},{...prepare,enrollment_version:prepare.enrollment_version+1},
            {...prepare,scope:{...prepare.scope,activity_id:'foreign'}},{...prepare,enrollment:{...prepare.enrollment,organization_id:'foreign'}},
            {...prepare,grants_created:true},{...prepare,enrollment:{...prepare.enrollment,private_key:'hidden'}}]) {
            assert.throws(()=>decodeWorkspaceProviderPrepare(malformed,identity,options),invalid);
        }
        assert.throws(()=>decodeWorkspaceProviderPrepare(prepare,identity,{providerRef:'foreign'}),invalid);
        assert.throws(()=>decodeWorkspaceProviderPrepare(prepare,identity,{externalTenantId:identity.nativeAccountId}),invalid);
    }
    assert.throws(()=>decodeWorkspaceProviderPrepare({provider_ref:'legacy',activity_id:'activity',label:'قديم',enrollment_version:1,status:'prepared',grants_created:false},identity),invalid);
});

test('exact published closed schemas and actual v4 HTTP fixture bytes are pinned without a sibling runtime dependency',()=>{
    const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha(actualBytes),'190dd989b4aa5ffc227fd7dfc8b3f34dca0e0eee027bd386fbc4e6de53bb07c9');
    assert.equal(sha(fs.readFileSync(new URL('../config/peer-owner-workspace-response-options-v3.schema.json',import.meta.url))),WORKSPACE_RESPONSE_OPTIONS_SHA256);
    assert.equal(sha(fs.readFileSync(new URL('../config/workspace-provider-confirmation-v1.schema.json',import.meta.url))),WORKSPACE_PROVIDER_CONFIRMATION_SHA256);
    assert.equal(actual.http_observations.length,29);
});

test('actual nonempty v4 product/current-grant metadata is closed and enforces every published conditional',()=>{
    const context=examples.context_catalog_selected_command_options;
    const raw=context.command_options[0];assert.deepEqual(decodeWorkspaceCommandOption(raw),raw);
    assert.deepEqual(decodeWorkspaceCapabilityGrantOption(context.capability_grant_options[0]),context.capability_grant_options[0]);
    const grant=context.activities[0].capability_grants[0];assert.deepEqual(decodeWorkspaceCurrentCapabilityGrant(grant),grant);
    for(const malformed of [{...raw,authorization_revision:null},{...raw,source_installation_id:null},{...raw,allowed_fields:[]},
        {...raw,reason_code:'still_denied'},{...raw,execute:true},{...raw,authorization_revision:'invalid-hash'}]) assert.throws(()=>decodeWorkspaceCommandOption(malformed),invalid);
    const old=copy(raw);delete old.authorization_revision;assert.throws(()=>decodeWorkspaceCommandOption(old),invalid);
    const change={...raw,action:'product.change'};assert.throws(()=>decodeWorkspaceCommandOption(change),invalid);
    const bound={...change,record_ref:'current-source-record',record_version:7};assert.deepEqual(decodeWorkspaceCommandOption(bound),bound);
    assert.throws(()=>decodeWorkspaceCommandOption({...bound,record_version:null}),invalid);
    const unavailable={...raw,available:false,authorization_revision:null,source_installation_id:null,reason_code:'current_grant_required'};
    assert.deepEqual(decodeWorkspaceCommandOption(unavailable),unavailable);
    assert.throws(()=>decodeWorkspaceCommandOption({...unavailable,authorization_revision:raw.authorization_revision}),invalid);
    assert.throws(()=>decodeWorkspaceCurrentCapabilityGrant(examples.current_capability_grant_saved),invalid); // write echo includes non-current request-only fields
});

test('v4 populated option tuples remain associated with the actual current provider installation and activity',()=>{
    const value=copy(examples.context_catalog_selected_command_options);
    for(const provider of value.providers) provider.availability.state='configuration_required';
    for(const capability of value.capabilities) capability.availability.state='configuration_required';
    // Explicit source-shape control: the export's redacted states are not an
    // authority fact or an actual unredacted HTTP acceptance observation.
    const result=decodeWorkspaceContext(value,identity,policy);
    assert.deepEqual(result.command_options,value.command_options);
    const foreign=copy(value);foreign.command_options[0].source_installation_id='foreign-installation';
    assert.throws(()=>decodeWorkspaceContext(foreign,identity,policy),invalid);
});

test('explicit nullable authority choices remain unknown and cannot broaden a resource or become a fabricated epoch',()=>{
    const value=copy(examples.context_catalog_selected_command_options.capability_grant_options[0]);
    Object.assign(value,{current_authority_epoch:null,current_authority_label:null});
    Object.assign(value.resources[0],{scope:null,authority_epoch:null,authority_matches_provider:null,authority_assignable:null,authority_source_label:null});
    assert.deepEqual(decodeWorkspaceCapabilityGrantOption(value),value);
    assert.equal(decodeWorkspaceCapabilityGrantOption(value).resources[0].authority_assignable,null);
    for(const malformed of [{...value,current_authority_epoch:-1},{...value,grant_all:true},
        {...value,resources:[{...value.resources[0],scope:{organization_id:'org'}}]},
        {...value,resources:[{...value.resources[0],authority_assignable:'true'}]}]) assert.throws(()=>decodeWorkspaceCapabilityGrantOption(malformed),invalid);
});

test('v4 pre-activity provider account view needs no invented scope and malformed sharing items are refused',()=>{
    const value=copy(examples.context_bound_account_before_first_activity);
    assert.throws(()=>decodeWorkspaceContext(value,identity,policy),invalid); // actual availability remains redacted in HTTP export
    value.providers[0].availability.state='configuration_required'; // explicitly synthetic canonical state, never an HTTP acceptance claim
    assert.deepEqual(decodeWorkspaceContext(value,identity,policy),value);
    assert.equal(decodeWorkspaceContext(value,identity,policy).providers[0].activity_id,null);
    assert.throws(()=>decodeWorkspaceContext({...value,service_shares:[{approved:true}]},identity,policy),invalid);
    const legacy=copy(value);delete legacy.service_share_options;assert.throws(()=>decodeWorkspaceContext(legacy,identity,policy),invalid);
});

test('exact V2 adds only three closed sharing definitions and preserves every V1 definition without relaxing product/current grants',()=>{
    const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
    const oldBytes=fs.readFileSync(new URL('../config/peer-owner-workspace-response-options-v1.schema.json',import.meta.url));
    const newBytes=fs.readFileSync(new URL('../config/peer-owner-workspace-response-options-v2.schema.json',import.meta.url));
    assert.equal(sha(oldBytes),'92c53f32a2405dd4d60b78b9937e55a687adb61c20054d874041e1ce728671dc');
    assert.equal(sha(newBytes),'e86263898731227c8e28ee721b874004da46d980621acad30d9f6a8e5364eac7');
    const before=JSON.parse(oldBytes).$defs, after=JSON.parse(newBytes).$defs;
    assert.equal(Object.keys(before).length,6);
    for(const [name,value]of Object.entries(before)) assert.equal(JSON.stringify(after[name]),JSON.stringify(value),name);
    assert.deepEqual(Object.keys(after).filter(name=>!Object.hasOwn(before,name)),['WorkspaceServiceShareConsumerChoice','WorkspaceServiceShareOption','WorkspaceServiceSharePersonChoice']);
    for(const name of ['WorkspaceServiceShareConsumerChoice','WorkspaceServiceShareOption','WorkspaceServiceSharePersonChoice']) assert.equal(after[name].additionalProperties,false);
    assert.equal(sha(serviceBytes),'da714a1a4f907d7115ce85cf6cab772c2699e614666d7f0687420fd2bc97ba3b');
    assert.equal(serviceActual.http_observations.length,11);
    assert.equal(serviceActual.closed_option_validation_counts.service_share_options,3);
    assert.equal(serviceActual.source_changed_during_capture,false);
});

test('three actual populated sharing HTTP contexts decode unchanged with current named people/resources and independent share state',()=>{
    let options=0;
    for(const name of ['context_populated_service_share_options','context_service_share_options_and_active_share','context_after_share_withdrawal']) {
        const raw=serviceExamples[name];
        assert.ok(raw.service_share_options.length>0);
        const decoded=decodeWorkspaceContext(raw,serviceIdentity,policy);
        assert.deepEqual(decoded,raw);
        assert.notEqual(decoded.service_share_options,raw.service_share_options);
        for(const option of raw.service_share_options) {
            assert.deepEqual(decodeWorkspaceServiceShareOption(option),option); options+=1;
            assert.equal(Object.hasOwn(option,'effective'),false);
            assert.equal(Object.hasOwn(option,'source_approved'),false);
        }
    }
    assert.equal(options,3);
    const before=decodeWorkspaceContext(serviceExamples.context_populated_service_share_options,serviceIdentity,policy);
    const active=decodeWorkspaceContext(serviceExamples.context_service_share_options_and_active_share,serviceIdentity,policy);
    const withdrawn=decodeWorkspaceContext(serviceExamples.context_after_share_withdrawal,serviceIdentity,policy);
    assert.equal(before.service_shares.length,0);
    assert.equal(active.service_shares[0].effective,true);
    assert.equal(withdrawn.service_shares[0].effective,false);
    assert.equal(withdrawn.service_shares[0].state,'revoked');
    assert.deepEqual(withdrawn.service_share_options,before.service_share_options); // selectable metadata is not current effect authority
});

test('actual sharing receipts retain pending, independent-side approval, original lookup, withdrawal and pending cancellation without DTO coercion',()=>{
    let count=0;
    for(const observation of serviceActual.http_observations) {
        const raw=serviceExamples[observation.example];
        if(raw.share_id) { assert.deepEqual(decodeWorkspaceServiceShare(raw),raw);count+=1; }
        else if(raw.service_shares&&!raw.activities) { for(const share of raw.service_shares) assert.deepEqual(decodeWorkspaceServiceShare(share),share);count+=1; }
    }
    assert.equal(count,8);
    assert.deepEqual(serviceExamples.share_requested_pending,serviceExamples.share_readonly_original_lookup);
    assert.equal(decodeWorkspaceServiceShare(serviceExamples.share_source_side_approved).effective,false);
    assert.equal(decodeWorkspaceServiceShare(serviceExamples.share_both_distinct_native_sides_approved).effective,true);
    assert.equal(decodeWorkspaceServiceShare(serviceExamples.share_pending_cancelled).can_cancel,false);
    assert.equal(decodeWorkspaceServiceShare(serviceExamples.share_pending_cancelled).source_approved,false);
});

test('closed sharing option rejects optimistic authority, unknown nested members, duplicates and unbound parent references',()=>{
    const raw=serviceExamples.context_populated_service_share_options;
    const option=raw.service_share_options[0];
    for(const malformed of [{...option,available:true},{...option,source_approved:true},{...option,effective:true},
        {...option,fields:[{...option.fields[0],permission:'execute'}]},
        {...option,resources:[{...option.resources[0],provider_token:'hidden'}]},
        {...option,people:[{...option.people[0],can_execute:true}]},
        {...option,consumers:[{...option.consumers[0],approved:true}]},
        {...option,people:[{...option.people[0],actions:['*']}]},
        {...option,people:[option.people[0],option.people[0]]},
        {...option,consumers:[...option.consumers,...option.consumers]},
        {...option,consumers:[{...option.consumers[0],provider_ref:option.source_provider_ref}]}]) {
        assert.throws(()=>decodeWorkspaceServiceShareOption(malformed),invalid);
    }
    for(const mutate of [
        value=>{value.service_share_options[0].activity_id='foreign-activity';},
        value=>{value.service_share_options[0].source_provider_ref='foreign-source';},
        value=>{value.service_share_options[0].consumers[0].provider_ref='foreign-consumer';},
        value=>{value.service_share_options[0].people[0].person_ref='foreign-person';},
        value=>{value.service_share_options.push(copy(value.service_share_options[0]));},
        value=>{value.service_share_options[0].resources[0].scope={...value.activities[0].scope,organization_id:'foreign-org'};},
        value=>{value.service_share_options[0].resources[0].scope={...value.activities[0].scope,activity_id:'foreign-activity'};},
    ]) { const malformed=copy(raw);mutate(malformed);assert.throws(()=>decodeWorkspaceContext(malformed,serviceIdentity,policy),invalid); }
    assert.throws(()=>decodeWorkspaceContext(raw,{...serviceIdentity,actorId:'foreign-owner'},policy),invalid);
    assert.throws(()=>decodeWorkspaceContext(raw,{...serviceIdentity,organizationId:'foreign-org'},policy),invalid);
});

test('native response schema is exact V3, preserves all V2 closed definitions and consumes its separately pinned owned HTTP receipt',()=>{
    const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
    const previous=JSON.parse(fs.readFileSync(new URL('../config/peer-owner-workspace-response-options-v2.schema.json',import.meta.url))).$defs;
    const bytes=fs.readFileSync(new URL('../config/peer-owner-workspace-response-options-v3.schema.json',import.meta.url));
    const current=JSON.parse(bytes).$defs;
    assert.equal(sha(bytes),'279a8a48322652f5a1ac19f66b0e7ccafb5ebc996d09860453904c50a516b76c');
    assert.equal(Object.keys(previous).length,9);
    for(const [name,value]of Object.entries(previous)) assert.equal(JSON.stringify(current[name]),JSON.stringify(value),name);
    assert.equal(current.WorkspaceNativeCommandOption.additionalProperties,false);
    assert.equal(current.WorkspaceNativeResourceChoice.additionalProperties,false);
    assert.equal(sha(nativeBytes),'bf8dd5d4cac00dd7ad22ed74966d07c7d42d0a8b90adf9e17f1d5049e5c08c82');
    assert.equal(nativeActual.http_observations.length,3);
    assert.equal(nativeActual.actual_closed_native_options_validated,5);
    assert.equal(nativeActual.native_business_validation_or_effect_RPC_during_metadata_GET,0);
    assert.equal(nativeActual.new_durable_command_or_native_business_effects,0);
});

test('all five actual native HTTP options decode under Core-only base origin policy using exact trusted declared owner origins',()=>{
    let count=0;
    for(const observation of nativeActual.http_observations) {
        const raw=nativeExamples[observation.example], principal=nativeIdentity(raw);
        assert.equal(nativePolicy.allowedOrigins.includes(raw.owner_action_origins[0]),false);
        const result=decodeWorkspaceContext(raw,principal,nativePolicy);
        assert.deepEqual(result,raw);
        assert.deepEqual(result.command_options,raw.command_options);
        for(const option of raw.native_command_options) {
            assert.deepEqual(decodeWorkspaceNativeCommandOption(option,principal,{...nativePolicy,ownerActionOrigins:raw.owner_action_origins}),option);
            count+=1;
        }
    }
    assert.equal(count,5);
    const original=decodeWorkspaceContext(nativeExamples.service_actual_nonempty_native_options,nativeIdentity(nativeExamples.service_actual_nonempty_native_options),nativePolicy);
    const withdrawn=decodeWorkspaceContext(nativeExamples.service_after_actual_permission_withdrawal,nativeIdentity(nativeExamples.service_after_actual_permission_withdrawal),nativePolicy);
    assert.equal(original.native_command_options[0].availability.state,'review_available');
    assert.equal(withdrawn.native_command_options[0].availability.state,'permission_required');
    assert.deepEqual(withdrawn.native_command_options[0].fields,[]);assert.deepEqual(withdrawn.native_command_options[0].resources,[]);
    assert.equal(withdrawn.native_command_options[0].owner_action_url,null);
});

test('optional native key preserves older contexts while present native/product options stay separate and recursively closed',()=>{
    const legacy=copy(examples.context_initial);
    assert.equal(Object.hasOwn(decodeWorkspaceContext(legacy,identity,policy),'native_command_options'),false);
    assert.deepEqual(decodeWorkspaceContext({...legacy,native_command_options:[]},identity,policy).native_command_options,[]);
    assert.throws(()=>decodeWorkspaceContext({...legacy,native_command_options:{}},identity,policy),invalid);
    const raw=nativeExamples.service_actual_nonempty_native_options, principal=nativeIdentity(raw);
    for(const mutate of [
        value=>{value.native_command_options[0].capability='products.write';},
        value=>{value.native_command_options[0].payload_schema={type:'object'};},
        value=>{value.native_command_options[0].fields[0].can_execute=true;},
        value=>{value.native_command_options[0].resources[0].authority_assignable=true;},
        value=>{value.native_command_options[0].permission_contract='unchecked_json';},
        value=>{value.native_command_options.push(copy(value.native_command_options[0]));},
        value=>{value.command_options=[copy(value.native_command_options[0])];},
    ]){const malformed=copy(raw);mutate(malformed);assert.throws(()=>decodeWorkspaceContext(malformed,principal,nativePolicy),invalid);}
});

test('ready native proofs correlate exact actor grant revision, source installation, scope and named permission subsets',()=>{
    const raw=nativeExamples.service_actual_nonempty_native_options,principal=nativeIdentity(raw);
    for(const mutate of [
        value=>{value.native_command_options[0].authorization_revision=null;},
        value=>{value.native_command_options[0].source_installation_id=value.providers[1].installations[0].installation_id;},
        value=>{value.native_command_options[0].capability_grant_revision=2;},
        value=>{value.native_command_options[0].resource_policy=null;},
        value=>{value.native_command_options[0].provider_ref=value.providers[1].provider_ref;},
        value=>{value.native_command_options[0].activity_id='another-activity';},
        value=>{value.native_command_options[0].fields.push({value:'not-permitted',label:'حقل غير مسموح'});},
        value=>{value.native_command_options[0].resource_refs.push('foreign-resource');},
        value=>{value.native_command_options[0].resources[0].scope={...value.activities[0].scope,organization_id:'foreign-org'};},
        value=>{value.native_command_options[0].resources[0].scope={...value.activities[0].scope,activity_id:'foreign-activity'};},
        value=>{value.activities[0].capability_grants[0].actions=['read'];},
        value=>{value.activities[0].capability_grants[0].person_ref='another-person';},
        value=>{value.activities[0].capability_grants.push(copy(value.activities[0].capability_grants[0]));},
        value=>{value.activities[0].my_actions=value.activities[0].my_actions.filter(action=>action!=='commands.request');},
    ]){const malformed=copy(raw);mutate(malformed);assert.throws(()=>decodeWorkspaceContext(malformed,principal,nativePolicy),invalid);}
    const warehouse=copy(raw);Object.assign(warehouse.native_command_options[0].resources[0],{resource_kind:'warehouse',scope:warehouse.activities[0].scope,authority_epoch:1,authority_matches_provider:true});
    assert.deepEqual(decodeWorkspaceContext(warehouse,principal,nativePolicy),warehouse); // explicit synthetic scope-proof control, not a new owned-HTTP warehouse claim
    for(const proof of [{authority_epoch:0},{authority_epoch:null},{authority_matches_provider:false},{scope:null}]){
        const malformed=copy(warehouse);Object.assign(malformed.native_command_options[0].resources[0],proof);assert.throws(()=>decodeWorkspaceContext(malformed,principal,nativePolicy),invalid);
    }
});

test('blocked native options cannot retain private choices, resource policy, authorizations or a former owner URL',()=>{
    const raw=nativeExamples.service_after_actual_permission_withdrawal,principal=nativeIdentity(raw);
    const prior=nativeExamples.service_actual_nonempty_native_options.native_command_options[0];
    for(const property of ['fields','resources','resource_refs','resource_policy','authorization_revision','source_installation_id','capability_grant_revision','owner_action_url']) {
        const malformed=copy(raw);malformed.native_command_options[0][property]=copy(prior[property]);
        assert.throws(()=>decodeWorkspaceContext(malformed,principal,nativePolicy),invalid,property);
    }
});

test('declared native origins are exact safe source origins, not browser allow claims or unrestricted repair destinations',()=>{
    const raw=nativeExamples.service_actual_nonempty_native_options,principal=nativeIdentity(raw);
    for(const origin of ['javascript:alert(1)','//outside.invalid','/relative','http://outside.invalid','https://user:password@outside.invalid',
        'https://outside.invalid/path','https://outside.invalid?query=value','https://outside.invalid#fragment','http://localhost:12345']) {
        const malformed=copy(raw);malformed.owner_action_origins=[origin];assert.throws(()=>decodeWorkspaceContext(malformed,principal,nativePolicy),invalid);
    }
    for(const mutate of [
        value=>{value.owner_action_origins=[];},
        value=>{value.owner_action_origins=[...value.owner_action_origins,...value.owner_action_origins];},
        value=>{value.browser_origin='https://outside.invalid';},
        value=>{value.native_command_options[0].availability.next_action.href='https://outside.invalid/form';},
        value=>{value.native_command_options[0].owner_action_url='https://core.owned.example/form';value.native_command_options[0].availability.next_action.href='https://core.owned.example/form';},
        value=>{value.native_command_options[0].owner_action_url+='/different';},
        value=>{value.capabilities.find(row=>row.code==='services.reserve').availability.next_action.href='https://outside.invalid/form';},
    ]){const malformed=copy(raw);mutate(malformed);assert.throws(()=>decodeWorkspaceContext(malformed,principal,nativePolicy),invalid);}
    assert.throws(()=>decodeWorkspaceContext(raw,principal,{...nativePolicy,allowLoopback:false}),invalid);
    const https=copy(raw),origin='https://catalog.owner.example';https.owner_action_origins=[origin];
    const before=https.native_command_options[0].owner_action_url;
    const target=origin+new URL(before).pathname;
    https.native_command_options[0].owner_action_url=target;https.native_command_options[0].availability.next_action.href=target;
    https.capabilities.find(row=>row.code==='services.reserve').availability.next_action.href=target;
    assert.deepEqual(decodeWorkspaceContext(https,principal,{allowedOrigins:nativePolicy.allowedOrigins}),https); // synthetic safe HTTPS policy control
});

test('canonical availability rejects redaction, unknown state and unsafe repair URL without inventing a legacy mapping',()=>{
    const value={state:'permission_required',reason_code:'current_scope_required',message:'اختر صلاحية النشاط',next_action:{code:'manage_permissions',label:'إدارة الصلاحيات',href:'/?workspace=shared'}};
    assert.deepEqual(decodeWorkspaceAvailability(value),value);
    const legacy={...value,state:'setup_required'};
    assert.throws(()=>decodeWorkspaceAvailability(legacy),invalid);
    assert.deepEqual(decodeWorkspaceAvailability(legacy,{allowLegacyProviderSetup:true}),legacy);
    for(const state of ['[REDACTED_AUTHENTICATION_VALUE]','ready','not_a_state']) assert.throws(()=>decodeWorkspaceAvailability({...value,state}),invalid);
    for(const href of ['javascript:alert(1)','//evil.example','http://evil.example/path','https://user:password@trusted.example/path','/path?x=%0d'])
        assert.throws(()=>decodeWorkspaceAvailability({...value,next_action:{...value.next_action,href}}),invalid);
});

test('finite bounded JSON rejects accessors without invoking them, prototype pollution, sparse arrays and oversize labels',()=>{
    let invoked=false;const raw=copy(examples.context_initial);Object.defineProperty(raw,'steal',{enumerable:true,get(){invoked=true;return 'private';}});
    assert.throws(()=>decodeWorkspaceContext(raw,identity),invalid);assert.equal(invoked,false);
    for(const malformed of [Object.assign(Object.create({role:'owner'}),examples.context_initial),{...examples.context_initial,people:new Array(2)},
        {...examples.context_initial,can_create_activity:NaN},{...examples.context_initial,organization:{id:identity.organizationId,name:'x'.repeat(1001)}},
        {...examples.context_initial,approval_policy:'x'.repeat(1_048_577)}]) assert.throws(()=>decodeWorkspaceContext(malformed,identity),invalid);
});

test('synthetic populated registry metadata stays closed and activity/provider scoped; metadata grants no execute permission',()=>{
    // Additional native-code metadata shape; actual product metadata is tested separately below.
    const c=copy(examples.context_initial);const s={organization_id:identity.organizationId,activity_id:'synthetic-activity',branch_id:null,warehouse_id:null};
    c.activities=[{activity_id:s.activity_id,label:'نشاط تجريبي',scope:s,version:1,my_actions:[],can_manage_people:false,permissions:[],capability_grants:[]}];
    const availability={state:'configuration_required',reason_code:'provider_setup_required',message:'أكمل الإعداد',next_action:{code:'prepare_provider',label:'إعداد الحساب',href:'/?workspace=shared'}};
    c.providers=[{provider_ref:'synthetic-provider',tenant_ref:'synthetic-provider',external_tenant_id:'wa_savana:tenant:1',platform:'wa_savana',label:'حساب تجريبي',activity_id:s.activity_id,availability,installations:[],policy_choices:{}}];
    c.command_options=[{activity_id:s.activity_id,provider_ref:'synthetic-provider',capability:'products.write',action:'product.create',available:false,allowed_fields:[],authorization_revision:null,source_installation_id:null,reason_code:'current_grant_required',message:'راجع التفويض'}];
    c.capability_grant_options=[{activity_id:s.activity_id,provider_ref:'synthetic-provider',capability_code:'messaging.send',label:'إرسال رسالة',fields:[{value:'message',label:'النص'}],resources:[],resource_policies:['new_only'],source_authority_required:false}];
    const result=decodeWorkspaceContext(c,identity);assert.equal(result.command_options[0].available,false);
    assert.equal(result.activities[0].capability_grants.length,0);
    const unknown=copy(c);unknown.command_options[0].execute=true;assert.throws(()=>decodeWorkspaceContext(unknown,identity),invalid);
    const optimistic=copy(c);optimistic.command_options[0].available=true;optimistic.command_options[0].reason_code=null;
    assert.throws(()=>decodeWorkspaceContext(optimistic,identity),invalid);
    const duplicate=copy(c);duplicate.command_options.push(copy(duplicate.command_options[0]));assert.throws(()=>decodeWorkspaceContext(duplicate,identity),invalid);
    const foreign=copy(c);foreign.capability_grant_options[0].activity_id='different';assert.throws(()=>decodeWorkspaceContext(foreign,identity),invalid);
    const injected=copy(c);injected.capability_grant_options[0].resources=[{resource_ref:'native:1',label:'مورد',credential_secret:'hidden'}];
    assert.throws(()=>decodeWorkspaceContext(injected,identity),invalid);
});
