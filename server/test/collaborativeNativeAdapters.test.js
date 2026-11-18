import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';
import { runMigrationsSync } from '../db/migrator.js';
import { encrypt, decrypt, initEncryption } from '../services/encryption.js';
import { quote } from '../services/billingQuote.js';
import { reserveBillingUsage, commitBillingUsage, releaseBillingUsage } from '../services/billingUsage.js';
import { getBillingSettings } from '../services/billingSettings.js';
import { BILLING_OPERATIONS } from '../services/billingCore.js';
import { SmsGatewayService } from '../services/smsGateway.js';
import { processDuePublications } from '../services/facebookContentScheduler.js';
import { CollaborativeConsentService } from '../services/collaborativeConsents.js';
import { CollaborativeExecutionService } from '../services/collaborativeExecution.js';
import { createCollaborativeNativeAdapters, createCollaborativeNativePolicy, quoteCollaborativeNative,
    validateCollaborativePayload } from '../services/collaborativeNativeAdapters.js';
import { CollaborativeNativeOwnerService } from '../services/collaborativeNativeOwner.js';
import { createNativeCollaborativeDependencies } from '../services/nativeCollaborativeDependencies.js';
import {createCollaborativeNativeReviewAdapters} from '../services/collaborativeNativeReviews.js';
import http from 'node:http';
import { CollaborativeEffectEvidence } from '../services/collaborativeEffectEvidence.js';

const now = Date.parse('2026-11-18T12:00:00Z');
const scope = { organization_id: 'synthetic-org', activity_id: 'synthetic-activity', branch_id: null, warehouse_id: null };
const principal = { tenantId: 1, userId: 1, sessionId: 'synthetic-session', authVersion: 0, role: 'tenant', sessionExpiresAt: now / 1000 + 3600 };
const fixture = async t => {
    const db = new Database(':memory:'); runMigrationsSync(db); t.after(() => db.close());
    const prior = process.env.CRYPTO_KEY; process.env.CRYPTO_KEY = crypto.randomBytes(32).toString('hex'); initEncryption();
    t.after(() => { if (prior == null) delete process.env.CRYPTO_KEY; else process.env.CRYPTO_KEY = prior; });
    db.exec(`INSERT INTO tenants(id,name,phone,status,credits) VALUES(1,'Synthetic native','218910000001','Active',1000);
        INSERT INTO users(id,username,password_hash,role,tenant_id,is_active) VALUES(1,'synthetic-owner','unused','tenant',1,1);
        INSERT INTO contacts(id,tenant_id,phone,profile_name) VALUES(1,1,'218910000021','Contact one'),(2,1,'218910000022','Contact two'),(3,1,'218910000023','Contact three');
        INSERT INTO templates(id,tenant_id,name,body,status,language,header_type) VALUES(1,1,'synthetic_template','Hello {{1}}','approved','ar','none');
        INSERT INTO tenant_whatsapp_numbers(id,tenant_id,phone_number_id,waba_id,is_active,is_default) VALUES(1,1,'synthetic-phone','synthetic-waba',1,1);
        INSERT INTO facebook_content_items(id,tenant_id,linked_page_id,title,body,status) VALUES(1,1,1,'Synthetic approved post','Synthetic publication body','approved');
        UPDATE billing_price_items SET local_pricing_model='fixed',is_active=1,is_billable=1,unit_price_credits=2;` .replace("        INSERT INTO facebook_content_items(id,tenant_id,linked_page_id,title,body,status) VALUES(1,1,1,'Synthetic approved post','Synthetic publication body','approved');",''));
    db.prepare(`INSERT INTO sms_gateway_accounts(id,tenant_id,name,base_url,api_key_encrypted,credential_fingerprint,
        webhook_secret_encrypted,webhook_key,status) VALUES(1,1,'Synthetic SMS','https://synthetic-provider.invalid',?,'synthetic-fingerprint',?,'synthetic-hook','active')`)
        .run(encrypt('synthetic-provider-fixture'),encrypt('synthetic-webhook-fixture'));
    db.prepare(`INSERT INTO tenant_pages(id,tenant_id,page_id,page_name,is_active,page_access_token_encrypted) VALUES(1,1,'synthetic-page','Synthetic page',1,?)`)
        .run(encrypt('synthetic-page-fixture'));
    db.exec(`INSERT INTO facebook_content_items(id,tenant_id,linked_page_id,title,body,status) VALUES(1,1,1,'Synthetic approved post','Synthetic publication body','approved');
        INSERT INTO fb_conversations(id,tenant_id,linked_page_id,page_id,user_psid,user_name,is_active) VALUES(1,1,1,'synthetic-page','synthetic-psid','Synthetic Messenger contact',1);`);
    db.prepare(`INSERT INTO fb_messages(conversation_id,tenant_id,mid,direction,created_at) VALUES(1,1,'synthetic-inbound','incoming',?)`).run(new Date(now-1000).toISOString());
    const local = p => db.prepare('SELECT is_active FROM users WHERE id=? AND tenant_id=?').get(p.userId,p.tenantId)?.is_active === 1;
    const ownerAuthority = async ({ principal:p }) => ({ verified:true,canManageConsent:true,nativeTenantId:p.tenantId,nativeUserId:p.userId,
        actorId:'synthetic-owner',scope,validUntil:new Date(now+30000).toISOString() });
    const consents = new CollaborativeConsentService({database:db,verifyOwnerAuthority:ownerAuthority,verifyLocalPrincipal:local,now:()=>now});
    const record = async (channel,recipientRef='native_contact:1') => consents.record(principal,{activity_ref:'synthetic-activity-choice',channel,
        account_ref:channel==='sms'?'sms_account:1':channel==='whatsapp'?'whatsapp_number:1':'facebook_page:1',recipient_ref:recipientRef,purpose:'transactional',
        evidence:{kind:'owner_recorded',reference:'synthetic-business-record',note:'Synthetic evidence recorded for the selected contact and transactional purpose.',recorded_at:new Date(now-1000).toISOString()},
        valid_until:new Date(now+3600000).toISOString(),idempotency_key:crypto.randomUUID()});
    const billing = {operations:BILLING_OPERATIONS};
    const settings=()=>getBillingSettings(db).settings;
    billing.quote=input=>quote(db,{summarizeMetaEstimate:()=>({status:'not_applicable',amount:0})},input);
    billing.reserve=input=>reserveBillingUsage(db,{quote:billing.quote,getBillingSettings:settings},input);
    billing.commit=(reservation,input)=>commitBillingUsage(db,{getBillingSettings:settings},reservation,input);
    billing.release=(reservation,input)=>releaseBillingUsage(db,reservation,input);
    const calls=[]; let loseAt=null; let providerImpl=null; let messengerImpl=null; let smsHistory=[]; const historyReads=[]; const appSecret=crypto.randomBytes(32).toString('hex');
    const effectEvidence=new CollaborativeEffectEvidence({database:db,encryption:{encrypt,decrypt},billing,
        settleWhatsAppStatus:()=>undefined,appSecret,appId:'synthetic-meta-app',now:()=>now});
    const smsService = new SmsGatewayService({database:db,gatewayRequest:async(_account,_path,input)=>{
        if(_path.includes('?')){historyReads.push(_path);return {data:{messages:smsHistory,pagination:{has_more:false,next_before_id:null}}};}
        calls.push({channel:'sms',input});if(loseAt===calls.length)throw new Error('Synthetic provider acknowledgement lost');
        return {success:true,data:{message_id:`synthetic-sms-${calls.length}`,recipient:input.body.recipient,message:input.body.message,status:'sent'}};
    }});
    const credentialResolver=async tenantId=>({tenant:db.prepare('SELECT id,name,status FROM tenants WHERE id=?').get(tenantId),phoneNumberId:'synthetic-phone',accessToken:'synthetic-native-fixture'});
    const provider=async(url,input)=>{
        let body=null;try{body=JSON.parse(input.body);}catch{/* Native photo form is validated by the publisher. */}
        const channel=body?.messaging_type?'messenger':url.includes('/messages')?'whatsapp':'facebook';
        calls.push({channel,input});if(loseAt===calls.length)throw new Error('Synthetic provider acknowledgement lost');
        if(channel==='messenger'&&messengerImpl)return messengerImpl(url,input);
        if(providerImpl)return providerImpl(url,input);
        return new Response(JSON.stringify(channel==='messenger'?{message_id:`synthetic-messenger-${calls.length}`}
            :channel==='whatsapp'?{messages:[{id:`synthetic-wa-${calls.length}`}]}:{id:`synthetic-post-${calls.length}`}),{status:200});
    };
    const contentCredentials=(database,tenantId,id)=>{const page=database.prepare('SELECT * FROM tenant_pages WHERE id=? AND tenant_id=? AND is_active=1').get(id,tenantId);
        if(!page)throw new Error('Synthetic account unavailable');return {page,accessToken:decrypt(page.page_access_token_encrypted)};};
    const dependencies=createNativeCollaborativeDependencies({database:db,encryption:{encrypt,decrypt},smsService,billing,
        whatsappCredentials:credentialResolver,contentCredentials,fetchImpl:provider,metaApiBase:'https://synthetic-provider.invalid',now:()=>now});
    const adapters=createCollaborativeNativeAdapters({...dependencies,database:db,consents,effectEvidence,now:()=>now});
    const execution=new CollaborativeExecutionService({database:db,nativeAdapters:adapters,now:()=>now,
        verifyNativeContext:async({command,action})=>({verified:true,localPolicyVerified:true,nativeTenantId:1,
            ...(action==='execute'?{executionContext:{actor_id:command.actor_id,scope,provider_ref:command.provider_ref,provider_platform:'wa_savana',provider_installation_id:command.provider_installation_id,
                external_tenant_id:command.external_tenant_id,authorization_revision:command.authorization_revision,valid_until:new Date(now+5000).toISOString(),...delegation(command)}}
                :{viewer:{actorId:'synthetic-owner',scope,allowedFields:['result.status','result.receipt'],resourcePolicy:'activity',resourceRefs:[],validUntil:new Date(now+30000).toISOString()}})}),
        authorizeEffect:async command=>({command_id:command.command_id,version:command.version,fingerprint:command.fingerprint,attempt_id:command.attempt_id,
            authorization_revision:command.authorization_revision,valid_until:new Date(now+5000).toISOString(),...delegation(command)})});
    const owner=new CollaborativeNativeOwnerService({database:db,nativeAdapters:adapters,consents,verifyLocalPrincipal:local,now:()=>now,
        verifyOwnerContext:async()=>({verified:true,localPolicyVerified:true,nativeTenantId:1,nativeUserId:1,viewer:{scope,actorId:'synthetic-owner',allowedFields:['channel','account_ref','recipient_ref','consent_ref','purpose','message','template_ref','template_values','recipients','content_ref','max_cost_credits'],resourcePolicy:'activity',resourceRefs:[],validUntil:new Date(now+30000).toISOString()}})});
    const prepare=async(capability,parameters)=>adapters[`${capability}:${parameters.channel}`].prepare({tenantId:1,scope,parameters,preview:true});
    const build=async(capability,parameters)=>{const prepared=await prepare(capability,parameters);return {
        spec_version:'1.0',command_id:crypto.randomUUID(),version:1,fingerprint:'a'.repeat(64),attempt_id:crypto.randomUUID(),capability,action:capability,scope,
        actor_id:'synthetic-owner',provider_ref:'synthetic-provider',provider_installation_id:'synthetic-installation',external_tenant_id:'wa_savana:tenant:1',
        authorization_revision:'synthetic-grants',grant_approved_by:'synthetic-owner',native_authority_revision:'synthetic-owner-proof',capability_grant_revision:2,
        allowed_fields:Object.keys(parameters),resource_policy:'activity',resource_refs:[],scope_epochs:[],ownership_epoch:null,
        validation_revision:prepared.resourceFingerprint,validation_valid_until:new Date(now+30000).toISOString(),
        payload:{payload_type:'native_action',parameters:prepared.parameters}};};
    return {db,calls,billing,consents,record,adapters,execution,owner,prepare,build,effectEvidence,appSecret,smsService,historyReads,
        setSmsHistory:value=>{smsHistory=value;},
        setProvider:fn=>{providerImpl=fn;},setMessenger:fn=>{messengerImpl=fn;},loseOn:n=>{loseAt=n;}};
};
const delegation=command=>Object.fromEntries(['grant_approved_by','native_authority_revision','capability_grant_revision','allowed_fields','resource_policy','resource_refs','scope_epochs'].map(key=>[key,command[key]]));
const sms=(consent)=>({channel:'sms',account_ref:'sms_account:1',recipient_ref:'native_contact:1',consent_ref:consent.value,purpose:'transactional',message:'Synthetic native SMS',max_cost_credits:20});

test('canonical messaging, campaign and content review handlers persist actual typed source drafts once without invoking provider effects',async t=>{
    const f=await fixture(t);const smsConsent=await f.record('sms');const waConsent=await f.record('whatsapp');
    Object.assign(f.adapters,createCollaborativeNativeReviewAdapters({database:f.db,encryption:{encrypt,decrypt},nativeAdapters:f.adapters,now:()=>now}));
    for(const [capability,parameters]of [
        ['messaging.review',sms(smsConsent)],
        ['campaigns.review',{channel:'whatsapp',account_ref:'whatsapp_number:1',purpose:'transactional',template_ref:'native_template:1',template_values:['Synthetic'],recipients:[{recipient_ref:'native_contact:1',consent_ref:waConsent.value}],max_cost_credits:20}],
        ['content.review',{channel:'facebook',account_ref:'facebook_page:1',content_ref:'native_content:1',max_cost_credits:20}],
    ]){
        const cmd=await f.build(capability,parameters);const result=await f.execution.execute(cmd,{});
        assert.equal(result.outcome,'applied');assert.equal(result.source_result.source_revision,1);
        assert.deepEqual(await f.execution.execute(cmd,{}),result);
        const row=f.db.prepare('SELECT * FROM savana_native_action_facts WHERE action=?').get(capability);
        const draft=JSON.parse(decrypt(row.encrypted_result));assert.equal(draft.state,'recorded');assert.equal(draft.execution_authorized,false);
        assert.equal(draft.proposed_capability,capability==='messaging.review'?'messaging.send':capability==='campaigns.review'?'campaigns.execute':'content.publish');
        assert.doesNotMatch(JSON.stringify((await f.execution.result(cmd.command_id,{})).data),/Synthetic native SMS|synthetic-owner|parameters/);
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_native_action_facts').get().n,3);
    assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM billing_usage_events').get().n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sms_messages').get().n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM facebook_content_publications').get().n,0);
});

test('native SMS preview rolls back native quote writes, then actual shared SMS command records one receipt and one charge',async t=>{
    const f=await fixture(t);const consent=await f.record('sms');const before=f.db.serialize();
    const p=await f.prepare('messaging.send',sms(consent));assert.equal(p.quote.total_credits,2);assert.deepEqual(f.db.serialize(),before);assert.equal(f.calls.length,0);
    const cmd=await f.build('messaging.send',sms(consent));assert.equal((await f.execution.execute(cmd,{})).outcome,'applied');
    assert.equal((await f.execution.execute(cmd,{})).outcome,'applied');assert.equal(f.calls.length,1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sms_messages').get().n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM billing_usage_events WHERE status='committed'").get().n,1);
});

test('actual selected WhatsApp approved template and Messenger owned open conversation reuse native persistence',async t=>{
    const f=await fixture(t);const wa=await f.record('whatsapp');const messenger=await f.record('messenger','native_conversation:1');
    const waParameters={channel:'whatsapp',account_ref:'whatsapp_number:1',recipient_ref:'native_contact:1',consent_ref:wa.value,purpose:'transactional',template_ref:'native_template:1',template_values:['Synthetic'],max_cost_credits:20};
    const waCommand=await f.build('messaging.send',waParameters);assert.equal((await f.execution.execute(waCommand,{})).outcome,'applied');
    const messengerCommand=await f.build('messaging.send',{channel:'messenger',account_ref:'facebook_page:1',recipient_ref:'native_conversation:1',consent_ref:messenger.value,purpose:'transactional',message:'Synthetic reply',max_cost_credits:20});
    assert.equal((await f.execution.execute(messengerCommand,{})).outcome,'applied');
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM messages WHERE direction='outgoing'").get().n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM fb_messages WHERE direction='outgoing'").get().n,1);assert.equal(f.calls.length,2);
    await assert.rejects(f.prepare('messaging.send',{...waParameters,template_ref:undefined,template_values:undefined,message:'Closed-window free text'}));
});

test('revoked consent, foreign account, missing quote and approved budget deny before native effects',async t=>{
    const f=await fixture(t);const consent=await f.record('sms');const p=sms(consent);
    await assert.rejects(f.prepare('messaging.send',{...p,max_cost_credits:0}),{code:'native_approved_budget_insufficient'});
    await assert.rejects(f.prepare('messaging.send',{...p,account_ref:'sms_account:99'}));
    f.db.prepare("DELETE FROM billing_price_items WHERE operation_key='sms.text'").run();
    assert.throws(()=>quoteCollaborativeNative(f.db,f.billing,{tenantId:1,operationKey:'sms.text'}),{code:'native_quote_unavailable'});
    await f.consents.revoke(principal,consent.value,{activity_ref:'synthetic-activity-choice',expected_version:1});
    await assert.rejects(f.prepare('messaging.send',p),{code:'consent_current_record_required'});assert.equal(f.calls.length,0);
});

test('campaign keeps per-recipient truth and stops after unknown; the same command never replays or releases uncertain charge',async t=>{
    const f=await fixture(t);const a=await f.record('whatsapp');const b=await f.record('whatsapp','native_contact:2');const c=await f.record('whatsapp','native_contact:3');
    const cmd=await f.build('campaigns.execute',{channel:'whatsapp',account_ref:'whatsapp_number:1',purpose:'transactional',recipients:[
        {recipient_ref:'native_contact:1',consent_ref:a.value},{recipient_ref:'native_contact:2',consent_ref:b.value},{recipient_ref:'native_contact:3',consent_ref:c.value}],template_ref:'native_template:1',template_values:['Synthetic'],max_cost_credits:30});
    f.loseOn(2);assert.equal((await f.execution.execute(cmd,{})).outcome,'unknown');assert.equal(f.calls.length,2);
    assert.equal((await f.execution.execute(cmd,{})).outcome,'unknown');assert.equal(f.calls.length,2);
    assert.deepEqual(f.db.prepare('SELECT state FROM savana_collaborative_effects ORDER BY rowid').all().map(row=>row.state),['accepted','unknown']);
    assert.equal(f.db.prepare('SELECT status FROM broadcast_jobs').get().status,'running');
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM billing_usage_events WHERE status='reserved'").get().n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM billing_usage_events WHERE status='committed'").get().n,1);
});

test('actual content publisher stores approved library receipt once and stale collaborative unknown is never scheduler-replayed',async t=>{
    const f=await fixture(t);const p={channel:'facebook',account_ref:'facebook_page:1',content_ref:'native_content:1',max_cost_credits:20};
    const cmd=await f.build('content.publish',p);assert.equal((await f.execution.execute(cmd,{})).outcome,'applied');
    assert.equal(f.db.prepare('SELECT status FROM facebook_content_publications').get().status,'published');assert.equal(f.calls.length,1);
    assert.equal((await f.execution.execute(cmd,{})).outcome,'applied');assert.equal(f.calls.length,1);
    f.db.prepare("INSERT INTO facebook_content_items(id,tenant_id,linked_page_id,title,body,status) VALUES(2,1,1,'Another approved post','Distinct synthetic body','approved')").run();
    const next=await f.build('content.publish',{...p,content_ref:'native_content:2'});f.loseOn(2);
    assert.equal((await f.execution.execute(next,{})).outcome,'unknown');assert.equal(f.calls.length,2);
    await processDuePublications(f.db,{now:new Date(now+3600000),publish:()=>assert.fail('Unknown collaborative publication must not be replayed')});
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM facebook_content_publications WHERE status='processing'").get().n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM billing_usage_events WHERE status='reserved'").get().n,1);
});

test('named owner choices expose actual evidence links and recipient pagination without secret or arbitrary phone identity input',async t=>{
    const f=await fixture(t);const consent=await f.record('sms');
    const insert=f.db.prepare('INSERT INTO contacts(tenant_id,phone,profile_name) VALUES(1,?,?)');for(let i=4;i<=105;i++)insert.run(String(218920000000+i),`Synthetic contact ${i}`);
    const options=await f.owner.options(principal,{activity_ref:'synthetic-choice',capability:'messaging.send',channel:'sms',account_ref:'sms_account:1'});
    assert.equal(options.recipients.length,100);assert.ok(options.recipients_next_cursor);
    const selected=options.recipients[0].purposes.find(row=>row.value==='transactional');assert.equal(selected.consent_ref,consent.value);
    assert.equal(options.consent_evidence.find(row=>row.value===selected.consent_ref).source_label,'سجل النشاط');
    const second=await f.owner.options(principal,{activity_ref:'synthetic-choice',capability:'messaging.send',channel:'sms',account_ref:'sms_account:1',recipient_cursor:options.recipients_next_cursor});
    assert.equal(second.recipients.length,5);assert.equal(second.recipients_next_cursor,null);
    assert.equal(JSON.stringify(options).includes('218910000021'),false);assert.equal(JSON.stringify(options).includes('synthetic-provider-fixture'),false);
    const preview=await f.owner.preview(principal,{activity_ref:'synthetic-choice',capability:'messaging.send',action:'messaging.send',parameters:sms(consent)});
    assert.equal(preview.quote.within_budget,true);assert.equal(preview.normalized_parameters.resource_fingerprint,undefined);assert.ok(preview.resource_fingerprint);
});

test('native final policy checks source-owner revision and exact delegated business fields/resources, never a descriptor',async t=>{
    const f=await fixture(t);const consent=await f.record('sms');const cmd=await f.build('messaging.send',sms(consent));
    const policy=createCollaborativeNativePolicy({database:f.db,nativeAdapters:f.adapters,now:()=>now,getNativeAuthority:async()=>({verified:true,nativeTenantId:1,
        nativeAuthorityRevision:'synthetic-owner-proof',grantApprovedBy:'synthetic-owner',validUntil:new Date(now+30000).toISOString()})});
    assert.equal((await policy({command:cmd,nativeTenantId:1,scope,action:'execute'})).verified,true);
    await assert.rejects(policy({command:{...cmd,allowed_fields:['channel']},nativeTenantId:1,scope,action:'execute'}),{code:'native_parameter_delegation_required'});
    await assert.rejects(policy({command:{...cmd,resource_policy:'selected',resource_refs:['sms_account:1']},nativeTenantId:1,scope,action:'execute'}),{code:'native_resource_delegation_required'});
    await assert.rejects(policy({command:{...cmd,native_authority_revision:'changed'},nativeTenantId:1,scope,action:'execute'}),{code:'native_owner_delegation_changed'});
    await f.consents.revoke(principal,consent.value,{activity_ref:'synthetic-choice',expected_version:1});
    assert.equal((await policy({command:cmd,nativeTenantId:1,scope,action:'result'})).verified,true);
});

test('native business validator rejects raw authority overrides and duplicate campaign recipients',()=>{
    assert.throws(()=>validateCollaborativePayload('messaging.send',{parameters:{...sms({value:'consent:synthetic'}),tenant_id:9}},'messaging.send'));
    assert.throws(()=>validateCollaborativePayload('campaigns.execute',{parameters:{channel:'whatsapp',account_ref:'whatsapp_number:1',purpose:'transactional',max_cost_credits:10,
        template_ref:'native_template:1',recipients:[{recipient_ref:'native_contact:1',consent_ref:'one'},{recipient_ref:'native_contact:1',consent_ref:'two'}]}},'campaigns.execute'));
});

const ownedProviderProbe = async (t,f,channel) => {
    let delivery=null;let sends=0;
    const signature=raw=>'sha256='+crypto.createHmac('sha256',f.appSecret).update(raw).digest('hex');
    const server=http.createServer(async(req,res)=>{
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks);
        if(req.url==='/meta-webhook') {
            try { const result=f.effectEvidence.ingest({rawBody:raw,signature:req.headers['x-hub-signature-256']});
                res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({matched:result.whatsapp.length+result.messenger.length})); }
            catch {res.writeHead(403);res.end();}return;
        }
        if(req.url!=='/native-provider'){res.writeHead(404);res.end();return;}
        sends++;const payload=JSON.parse(raw);
        delivery=channel==='whatsapp'?{object:'whatsapp_business_account',entry:[{id:'synthetic-waba',changes:[{value:{metadata:{phone_number_id:'synthetic-phone'},
            statuses:[{id:'synthetic-lost-wa-receipt',status:'sent',recipient_id:payload.to,biz_opaque_callback_data:payload.biz_opaque_callback_data,timestamp:String(now/1000)}]}}]}]}
            :{object:'page',entry:[{id:'synthetic-page',messaging:[{sender:{id:'synthetic-page'},recipient:{id:payload.recipient.id},timestamp:now,
                message:{is_echo:true,app_id:'synthetic-meta-app',mid:'synthetic-lost-messenger-receipt',text:payload.message.text,metadata:payload.message.metadata}}]}]};
        req.socket.destroy(); // Provider accepted its owned synthetic operation; HTTP ACK was lost.
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
    t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
    const send=(_url,input)=>fetch(origin+'/native-provider',input);
    if(channel==='whatsapp')f.setProvider(send);else f.setMessenger(send);
    return {sends:()=>sends,body:()=>structuredClone(delivery),submit:async(body,{invalidSignature=false}={})=>{
        const raw=Buffer.from(JSON.stringify(body));const response=await fetch(origin+'/meta-webhook',{method:'POST',headers:{'Content-Type':'application/json',
            'X-Hub-Signature-256':invalidSignature?'sha256='+ '0'.repeat(64):signature(raw)},body:raw});
        return {status:response.status,body:response.ok?await response.json():null};
    }};
};

test('owned HTTP WhatsApp lost ACK settles only its signed exact-account/recipient HMAC capture and reconciles without another send',async t=>{
    const f=await fixture(t);const probe=await ownedProviderProbe(t,f,'whatsapp');const consent=await f.record('whatsapp');
    const cmd=await f.build('messaging.send',{channel:'whatsapp',account_ref:'whatsapp_number:1',recipient_ref:'native_contact:1',consent_ref:consent.value,
        purpose:'transactional',template_ref:'native_template:1',template_values:['Synthetic'],max_cost_credits:20});
    assert.equal((await f.execution.execute(cmd,{})).outcome,'unknown');assert.equal(probe.sends(),1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM billing_usage_events WHERE status='reserved'").get().n,1);
    const body=probe.body();assert.match(body.entry[0].changes[0].value.statuses[0].biz_opaque_callback_data,/^wae1\.[a-f0-9]{32}\.[a-f0-9]{32}$/);
    assert.equal((await probe.submit(body,{invalidSignature:true})).status,403);
    for(const alter of [value=>{value.entry[0].id='other-waba';},value=>{value.entry[0].changes[0].value.metadata.phone_number_id='other-phone';},
        value=>{value.entry[0].changes[0].value.statuses[0].recipient_id='218920000000';},
        value=>{value.entry[0].changes[0].value.statuses[0].biz_opaque_callback_data='wae1.'+'0'.repeat(32)+'.'+'0'.repeat(32);}]) {
        const wrong=structuredClone(body);alter(wrong);assert.equal((await probe.submit(wrong)).body.matched,0);
    }
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM messages WHERE direction='outgoing'").get().n,0);
    assert.equal((await probe.submit(body)).body.matched,1);assert.equal((await probe.submit(body)).body.matched,1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM savana_collaborative_provider_evidence').get().n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM messages WHERE direction='outgoing'").get().n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM billing_usage_events WHERE status='committed'").get().n,1);
    assert.equal(f.db.prepare('SELECT state FROM savana_collaborative_executions').get().state,'unknown');
    const receipt=await f.execution.reconcile(cmd,{});assert.equal(receipt.outcome,'applied');assert.equal(probe.sends(),1);
    const result=await f.execution.result(cmd.command_id,{});assert.equal(result.data.effects[0].provider_status,'sent');
    assert.equal(f.db.prepare('SELECT status FROM messages WHERE direction=\'outgoing\'').get().status,'sent');
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM savana_collaborative_correlations').get()).includes('218910000021'),false);
});

test('owned HTTP Messenger lost ACK requires actual app_id/account/recipient/text echo and commits only one native receipt and charge',async t=>{
    const f=await fixture(t);const probe=await ownedProviderProbe(t,f,'messenger');const consent=await f.record('messenger','native_conversation:1');
    const cmd=await f.build('messaging.send',{channel:'messenger',account_ref:'facebook_page:1',recipient_ref:'native_conversation:1',consent_ref:consent.value,
        purpose:'transactional',message:'Synthetic message with scoped echo',max_cost_credits:20});
    assert.equal((await f.execution.execute(cmd,{})).outcome,'unknown');assert.equal(probe.sends(),1);
    const body=probe.body();
    for(const alter of [value=>{value.entry[0].messaging[0].message.app_id='other-app';},value=>{value.entry[0].messaging[0].recipient.id='other-recipient';},
        value=>{value.entry[0].messaging[0].sender.id='other-page';},value=>{value.entry[0].messaging[0].message.text='Different content';}]) {
        const wrong=structuredClone(body);alter(wrong);assert.equal((await probe.submit(wrong)).body.matched,0);
    }
    assert.equal((await probe.submit(body)).body.matched,1);assert.equal((await probe.submit(body)).body.matched,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM fb_messages WHERE direction='outgoing'").get().n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM billing_usage_events WHERE status='committed'").get().n,1);
    assert.equal((await f.execution.reconcile(cmd,{})).outcome,'applied');assert.equal(probe.sends(),1);
});

test('SMS unknown repair uses bounded original history GET and exact native request hash without moving ordinary cursors or callbacks',async t=>{
    const f=await fixture(t);const consent=await f.record('sms');const cmd=await f.build('messaging.send',sms(consent));
    f.db.prepare("UPDATE sms_gateway_accounts SET history_cursor='987',history_backfill_cursor='123' WHERE id=1").run();
    f.smsService.historyMessageHandler=()=>assert.fail('Evidence lookup must not consume ordinary native history events');
    f.loseOn(1);assert.equal((await f.execution.execute(cmd,{})).outcome,'unknown');assert.equal(f.calls.length,1);
    const effect=f.db.prepare('SELECT * FROM savana_collaborative_effects').get();
    const attempted=f.calls[0].input;const candidate={message_id:'synthetic-history-receipt',external_id:effect.native_idempotency_key,
        direction:'outgoing',recipient:attempted.body.recipient,message:attempted.body.message,status:'sent'};
    f.setSmsHistory([{...candidate,recipient:'218920000000',message:'Foreign native payload'}]);
    assert.equal((await f.execution.reconcile(cmd,{})).outcome,'unknown');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sms_messages').get().n,0);
    f.setSmsHistory([candidate]);assert.equal((await f.execution.reconcile(cmd,{})).outcome,'applied');
    assert.equal(f.calls.length,1);assert.equal(f.historyReads.length,2);
    assert.ok(f.historyReads.every(path=>path==='services/v1/messages.php?limit=100&type=sms'));
    assert.deepEqual(f.db.prepare('SELECT history_cursor,history_backfill_cursor FROM sms_gateway_accounts WHERE id=1').get(),{history_cursor:'987',history_backfill_cursor:'123'});
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sms_messages').get().n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM billing_usage_events WHERE status='committed'").get().n,1);
    assert.equal(f.db.prepare('SELECT status FROM sms_api_requests').get().status,'accepted');
});
