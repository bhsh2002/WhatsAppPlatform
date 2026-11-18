import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import Database from 'better-sqlite3';
import {runMigrationsSync} from '../db/migrator.js';
import {CollaborativeNativeMediaService,NATIVE_MEDIA_FIELDS} from '../services/collaborativeNativeMedia.js';
import {createNativeWhatsAppMediaTransport} from '../services/nativeWhatsAppMediaTransport.js';
import {CollaborativeExecutionService} from '../services/collaborativeExecution.js';
import {createCollaborativeNativePolicy} from '../services/collaborativeNativeAdapters.js';
import {createCollaborativeNativeRouter} from '../routes/collaborativeNative.js';
import express from 'express';
import {createCollaborativeNativeDiscovery} from '../services/collaborativeNativeDiscovery.js';

const at=Date.parse('2026-11-18T14:00:00Z');
const scope={organization_id:'synthetic-org',activity_id:'synthetic-activity',branch_id:null,warehouse_id:null};
const activity='synthetic-opaque-activity:'+ 'a'.repeat(1500);
const principal={tenantId:1,userId:1};
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7XcAAAAASUVORK5CYII=','base64');
const fixture=async t=>{
    const db=new Database(':memory:');runMigrationsSync(db);t.after(()=>db.close());
    db.exec(`INSERT INTO tenants(id,name,phone,status) VALUES(1,'Synthetic media owner','218910000001','Active'),(2,'Foreign owner','218910000002','Active');
        INSERT INTO users(id,username,password_hash,role,tenant_id,is_active) VALUES(1,'synthetic-owner','unused','tenant',1,1);
        INSERT INTO tenant_whatsapp_numbers(id,tenant_id,phone_number_id,waba_id,is_active,is_default) VALUES(1,1,'synthetic-phone','synthetic-waba',1,1),(2,2,'foreign-phone','foreign-waba',1,1);`);
    const key=crypto.randomBytes(32);const encryption={encrypt:value=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');},
        decrypt:value=>{const bytes=Buffer.from(value,'base64'),cipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString();}};
    let clock=at;let ownerActive=true;let policy='activity';let resourceRefs=[];let readFields=['media.filename','media.state','media.receipt','result.status'];let afterAuthorize=()=>{};
    let fault=null;let posts=0;let gets=0;const received=[];const media=new Map();let origin;
    const server=http.createServer(async(req,res)=>{
        const url=new URL(req.url,origin);assert.equal(req.headers.authorization,'Bearer synthetic-held-media-token');assert.equal(url.searchParams.has('access_token'),false);
        if(req.method==='POST'){
            assert.equal(url.pathname,'/graph/synthetic-phone/media');posts++;const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);received.push(bytes);
            assert.ok(bytes.includes(image));assert.match(bytes.toString('latin1'),/name="messaging_product"\r\n\r\nwhatsapp/);assert.match(bytes.toString('latin1'),/name="type"\r\n\r\nimage\/png/);
            if(fault==='reject'){res.statusCode=400;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:{code:100,type:'GraphAPIException',message:'Synthetic invalid media'}}));return;}
            const id=`synthetic-media-${posts}`;media.set(id,{id});if(fault==='lost'){req.socket.destroy();return;}
            res.setHeader('content-type','application/json');res.end(fault==='malformed'?'{bad':JSON.stringify({id}));return;
        }
        gets++;const id=decodeURIComponent(url.pathname.slice('/graph/'.length));res.setHeader('content-type','application/json');
        res.end(JSON.stringify(media.get(id)||{error:{code:100,type:'GraphAPIException',message:'Synthetic unknown media'}}));
    });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));origin=`http://127.0.0.1:${server.address().port}`;
    const local=p=>ownerActive&&p.tenantId===1&&p.userId===1;
    const verifyOwnerContext=async({principal:p,activityRef,capabilityId})=>{
        assert.equal(activityRef,activity);assert.equal(capabilityId,'media.manage');return {verified:ownerActive,localPolicyVerified:ownerActive,nativeTenantId:p.tenantId,nativeUserId:p.userId,
            viewer:{scope,actorId:'synthetic-actor',allowedFields:NATIVE_MEDIA_FIELDS,resourcePolicy:policy,resourceRefs,validUntil:new Date(clock+30000).toISOString()}};};
    const credentials=async tenantId=>({tenant:db.prepare('SELECT id,status FROM tenants WHERE id=?').get(tenantId),phoneNumberId:'synthetic-phone',accessToken:'synthetic-held-media-token'});
    const service=new CollaborativeNativeMediaService({database:db,encryption,credentials,transport:createNativeWhatsAppMediaTransport({apiBase:origin+'/graph',fetchImpl:fetch}),verifyOwnerContext,verifyLocalPrincipal:local,now:()=>clock});
    const adapter=service.adapter();const adapters={'media.manage:whatsapp':adapter};
    const delegation=cmd=>({grant_approved_by:'synthetic-native-owner',native_authority_revision:'synthetic-current-native-owner',capability_grant_revision:2,
        allowed_fields:NATIVE_MEDIA_FIELDS,resource_policy:cmd?.resource_policy||'activity',resource_refs:cmd?.resource_refs||[],scope_epochs:[]});
    const execution=new CollaborativeExecutionService({database:db,nativeAdapters:adapters,now:()=>clock,
        verifyNativeContext:async({command,action})=>({verified:true,localPolicyVerified:true,nativeTenantId:1,...(action==='execute'?{executionContext:{actor_id:command.actor_id,scope,
            provider_ref:command.provider_ref,provider_platform:'wa_savana',provider_installation_id:command.provider_installation_id,external_tenant_id:command.external_tenant_id,
            authorization_revision:command.authorization_revision,valid_until:new Date(clock+5000).toISOString(),ownership_epoch:null,...delegation(command)}}:
            {viewer:{scope,actorId:'synthetic-actor',allowedFields:readFields,resourcePolicy:policy,resourceRefs,validUntil:new Date(clock+30000).toISOString()}})}),
        authorizeEffect:async cmd=>{await afterAuthorize(cmd);return {command_id:cmd.command_id,version:cmd.version,fingerprint:cmd.fingerprint,attempt_id:cmd.attempt_id,
            authorization_revision:cmd.authorization_revision,valid_until:new Date(clock+5000).toISOString(),...delegation(cmd)};}});
    const stageInput=(key=crypto.randomUUID())=>({activity_ref:activity,channel:'whatsapp',account_ref:'whatsapp_number:1',purpose:'channel_content',evidence_reference:'synthetic-owned-channel-record',
        rights_note:'Synthetic owner-recorded rights for this exact business image and native channel.',rights_recorded_at:new Date(at-1000).toISOString(),rights_valid_until:new Date(at+3600000).toISOString(),idempotency_key:key});
    const file={buffer:image,mimetype:'image/png',originalname:'../synthetic-image.png'};
    const stage=async key=>service.stage(principal,stageInput(key),file);
    const make=async(asset,action='media.asset.upload',extra={})=>{
        const parameters={channel:'whatsapp',account_ref:'whatsapp_number:1',asset_ref:asset.value,expected_revision:asset.source_revision,purpose:asset.purpose,evidence_reference:asset.evidence_reference};
        const payload=service.validate({payload_type:'native_action',parameters},action);const prepared=await service.prepare({tenantId:1,scope,parameters,command:{action},preview:true});
        return {spec_version:'1.0',command_id:crypto.randomUUID(),version:1,fingerprint:'a'.repeat(64),attempt_id:crypto.randomUUID(),capability:'media.manage',action,scope,actor_id:'synthetic-actor',
            provider_ref:'synthetic-provider',provider_installation_id:'synthetic-installation',external_tenant_id:'wa_savana:tenant:1',authorization_revision:'synthetic-central-authority',ownership_epoch:null,
            ...delegation(),validation_revision:prepared.resourceFingerprint,validation_valid_until:new Date(clock+30000).toISOString(),payload:{...payload,parameters:prepared.parameters},...extra};
    };
    return {db,encryption,service,adapter,adapters,execution,credentials,origin,stageInput,file,stage,make,local,
        counters:()=>({posts,gets}),fault:value=>{fault=value;},setOwner:value=>{ownerActive=value;},setPolicy:(value,refs=[])=>{policy=value;resourceRefs=refs;},
        setFields:value=>{readFields=value;},afterAuthorize:fn=>{afterAuthorize=fn;},tick:ms=>{clock+=ms;},received};
};

test('real typed local staging accepts long opaque activity, verifies actual bytes/provenance and recovers exact same key without provider traffic',async t=>{
    const f=await fixture(t);const input=f.stageInput();const first=await f.service.stage(principal,input,f.file);const duplicate=await f.service.stage(principal,input,f.file);
    assert.equal(first.asset.value,duplicate.asset.value);assert.equal(first.asset.filename,'synthetic-image.png');assert.equal(first.asset.evidence_reference,input.evidence_reference);
    assert.deepEqual(f.counters(),{posts:0,gets:0});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_native_media_assets').get().n,1);
    assert.equal((await f.service.lookupStage(principal,{activity_ref:activity,idempotency_key:input.idempotency_key})).asset.value,first.asset.value);
    const stored=f.db.prepare('SELECT encrypted_payload FROM savana_native_media_assets').get().encrypted_payload;assert.doesNotMatch(stored,/Synthetic owner-recorded|iVBOR/);
    await assert.rejects(f.service.stage(principal,{...input,rights_note:'Different actual provenance note long enough for validation.'},f.file),{code:'native_media_stage_conflict'});
    await assert.rejects(f.service.stage(principal,f.stageInput(),{...f.file,buffer:Buffer.from([0,1,2,3])}),{code:'native_media_content_invalid'});
    await assert.rejects(f.service.lookupStage(principal,{activity_ref:activity,idempotency_key:'missing-synthetic-key'}),{code:'native_media_stage_unresolved'});
});

test('actual shared native multipart upload records one provider receipt and source revision, and inspection is only a known-ID GET',async t=>{
    const f=await fixture(t);const staged=await f.stage();const command=await f.make(staged.asset);const applied=await f.execution.execute(command,{});
    assert.equal(applied.outcome,'applied');assert.equal(applied.source_result.source_revision,3);assert.deepEqual(await f.execution.execute(command,{}),applied);
    const row=f.service.row(1,staged.asset.value);assert.equal(row.state,'uploaded');assert.equal(row.provider_media_id,'synthetic-media-1');assert.equal(row.provider_receipt_sha256.length,64);
    assert.deepEqual(f.counters(),{posts:1,gets:0});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM messages').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM billing_usage_events').get().n,0);
    const inspected=await f.make(f.service.public(row,NATIVE_MEDIA_FIELDS),'media.asset.inspect');assert.equal((await f.execution.execute(inspected,{})).outcome,'applied');
    assert.deepEqual(f.counters(),{posts:1,gets:1});assert.equal(f.db.prepare("SELECT COUNT(*) n FROM savana_native_action_facts WHERE action='media.asset.inspect'").get().n,1);
    const result=await f.execution.result(command.command_id,{});assert.deepEqual(result.data.records,[{filename:'synthetic-image.png',state:'uploaded',provider_media_id:'synthetic-media-1'}]);
    assert.doesNotMatch(JSON.stringify(result),/iVBOR|synthetic-held-media-token|owner-recorded rights/);
});

test('lost upload acknowledgement stays unknown and fences new command IDs/assets without a second POST or guessed lookup',async t=>{
    const f=await fixture(t);const staged=await f.stage();const command=await f.make(staged.asset);f.fault('lost');
    assert.equal((await f.execution.execute(command,{})).outcome,'unknown');assert.equal(f.service.row(1,staged.asset.value).state,'unknown');
    assert.equal((await f.execution.reconcile(command,{})).outcome,'unknown');assert.deepEqual(f.counters(),{posts:1,gets:0});
    const next=await f.stage();const nextCommand=await f.make(next.asset);assert.equal((await f.execution.execute(nextCommand,{})).reason_code,'native_previous_outcome_unresolved');
    assert.deepEqual(f.counters(),{posts:1,gets:0});assert.equal(f.service.row(1,next.asset.value).state,'staged');
    const preview=await f.service.preview(principal,{activity_ref:activity,capability:'media.manage',action:'media.asset.upload',parameters:nextCommand.payload.parameters});
    assert.equal(preview.availability.state,'outcome_unknown');assert.equal(preview.resource_fingerprint,null);
});

test('malformed successful upload reply is unknown while an actual Graph rejection permits only a fresh explicitly reviewed attempt',async t=>{
    const ambiguous=await fixture(t);const first=await ambiguous.stage();const unknown=await ambiguous.make(first.asset);ambiguous.fault('malformed');
    assert.equal((await ambiguous.execution.execute(unknown,{})).outcome,'unknown');assert.equal(ambiguous.service.row(1,first.asset.value).provider_media_id,null);
    assert.deepEqual(ambiguous.counters(),{posts:1,gets:0});
    const rejected=await fixture(t);const second=await rejected.stage();const denied=await rejected.make(second.asset);rejected.fault('reject');
    const result=await rejected.execution.execute(denied,{});assert.equal(result.outcome,'not_applied');assert.equal(result.no_effect_proof.execution_fenced,true);
    assert.equal(rejected.service.row(1,second.asset.value).state,'rejected');assert.deepEqual(rejected.counters(),{posts:1,gets:0});
    rejected.fault(null);const reviewedAgain=await rejected.make(rejected.service.public(rejected.service.row(1,second.asset.value),NATIVE_MEDIA_FIELDS));
    const accepted=await rejected.execution.execute(reviewedAgain,{});assert.equal(accepted.outcome,'applied');assert.equal(accepted.source_result.source_revision,5);
    assert.deepEqual(rejected.counters(),{posts:2,gets:0});
});

test('a known persisted upload ACK reconciles a lost local reply using only its original owned media ID',async t=>{
    const f=await fixture(t);const original=f.adapter.execute;f.adapter.execute=input=>original({...input,effect:spec=>input.effect({...spec,run:async args=>{
        await spec.run(args);const error=new Error('Synthetic local reply lost');error.deliveryUncertain=true;throw error;}})});
    const staged=await f.stage();const command=await f.make(staged.asset);assert.equal((await f.execution.execute(command,{})).outcome,'unknown');
    assert.equal(f.service.row(1,staged.asset.value).state,'uploaded');assert.equal((await f.execution.reconcile(command,{})).outcome,'applied');
    assert.deepEqual(f.counters(),{posts:1,gets:1});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_collaborative_effects').get().n,1);
});

test('current permission/account/rights withdrawal before dispatch prevents media upload and cannot be bypassed with a stale revision',async t=>{
    const f=await fixture(t);const staged=await f.stage();const command=await f.make(staged.asset);f.afterAuthorize(()=>f.tick(3600001));
    assert.equal((await f.execution.execute(command,{})).outcome,'not_applied');assert.deepEqual(f.counters(),{posts:0,gets:0});assert.equal(f.service.row(1,staged.asset.value).state,'staged');
    f.setOwner(false);await assert.rejects(f.service.options(principal,{activity_ref:activity,account_ref:'whatsapp_number:1'}),{code:'native_owner_session_required'});
});

test('source policy and result projection enforce selected asset, actual creator for new-only, and current explicit output fields',async t=>{
    const f=await fixture(t);const staged=await f.stage();const command=await f.make(staged.asset);
    const policy=createCollaborativeNativePolicy({database:f.db,nativeAdapters:f.adapters,now:()=>at,getNativeAuthority:async()=>({verified:true,nativeTenantId:1,
        grantApprovedBy:'synthetic-native-owner',nativeAuthorityRevision:'synthetic-current-native-owner',validUntil:new Date(at+30000).toISOString()})});
    await assert.rejects(policy({command:{...command,resource_policy:'selected',resource_refs:['whatsapp_number:1']},nativeTenantId:1,scope,action:'execute'}),{code:'native_resource_delegation_required'});
    await assert.rejects(policy({command:{...command,actor_id:'other-actor',resource_policy:'new_only'},nativeTenantId:1,scope,actorId:'other-actor',action:'execute'}),{code:'native_resource_delegation_required'});
    await f.execution.execute(command,{});f.setFields(['media.byte_size']);const bytes=await f.execution.result(command.command_id,{});assert.deepEqual(bytes.data.records,[{byte_size:image.length}]);
    assert.equal(bytes.data.effects[0].receipt,undefined);f.setPolicy('selected',['whatsapp_number:1']);assert.deepEqual((await f.execution.result(command.command_id,{})).data.records,[]);
});

test('ordinary local multipart staging route uses actual source service, fixed intent header and no file path or provider command bytes',async t=>{
    const f=await fixture(t);const app=express();app.use((req,_res,next)=>{req.user={id:1,tenant_id:1,role:'tenant',auth_version:0};next();});
    app.use('/api/portal/integrations',createCollaborativeNativeRouter({service:{},mediaService:f.service,appOrigin:'http://127.0.0.1'}));
    const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
    const form=new FormData();for(const [key,value]of Object.entries(f.stageInput()))form.append(key,value);form.append('file',new Blob([image],{type:'image/png'}),'synthetic.png');
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/portal/integrations/collaborative/media/assets`,{method:'POST',headers:{'X-Savana-Owner-Intent':'connections-data-v1'},body:form});
    assert.equal(response.status,200);const result=await response.json();assert.match(result.asset.value,/^native_media:/);assert.equal(result.asset.byte_size,image.length);assert.deepEqual(f.counters(),{posts:0,gets:0});
    assert.doesNotMatch(JSON.stringify(result),/encrypted_payload|iVBOR|file\.path|synthetic-held-media-token/);
});

test('signed discovery names only the media account and its actual staged file, with no unrelated recipient/template grants',async t=>{
    const f=await fixture(t);const staged=await f.stage();
    const source=createCollaborativeNativeDiscovery({database:f.db,nativeAdapters:f.adapters,consents:{current:()=>assert.fail('Media discovery must not read recipient consent')},now:()=>at,
        getNativeAuthority:async()=>({verified:true,nativeTenantId:1,grantApprovedBy:'synthetic-owner',nativeAuthorityRevision:'synthetic-source-owner-revision',validUntil:new Date(at+30000).toISOString()}),
        loadSubscriptionFacts:async()=>({verified:true,bound:true,entitled:true,validUntil:new Date(at+30000).toISOString()}),
        ownerActions:{'media.manage':{registered:true,contractVersion:'1.0',path:'/portal/integrations?workspace=shared&action=media.manage'}}});
    const result=await source.discovery({actor_id:'synthetic-owner',organization_id:scope.organization_id,activity_id:scope.activity_id,external_tenant_id:'wa_savana:tenant:1'});
    const cap=result.providers[0].capabilities.find(row=>row.capability==='media.manage');assert.equal(cap.handler_registered,true);assert.equal(cap.configured,true);
    assert.deepEqual(cap.actions,['media.asset.upload','media.asset.inspect']);assert.deepEqual(cap.resources.map(row=>row.resource_ref),['whatsapp_number:1',staged.asset.value]);
    assert.equal(cap.cancellation_supported,false);assert.equal(cap.allowed_fields.find(row=>row.value==='asset.provenance').label,'سجل حق استخدام الملف');
    assert.doesNotMatch(JSON.stringify(result),/synthetic-held-media-token|iVBOR|rights_note/);
});
