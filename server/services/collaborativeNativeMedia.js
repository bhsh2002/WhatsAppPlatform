import crypto from 'node:crypto';
import path from 'node:path';
import {MAX_FILE_SIZE,ALLOWED_MEDIA_MIMES} from '../config/index.js';
import {validateUploadContent} from '../security/fileContent.js';
import {normalizeFilename} from './filenames.js';
import {createSqliteReadPrincipalVerifier} from './centralProductRead.js';
import {CollaborativeExecutionError} from './collaborativeExecution.js';
import {nativeCommandJson} from './nativeCommandProtocol.js';
import {validateNativeCommandModel} from './nativeCommandModels.js';
import {resolveCollaborativeAccount,listCollaborativeAccounts} from './collaborativeNativeResources.js';
import {collaborativeBlocker} from './collaborativeNativeOwner.js';

const hash=value=>crypto.createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:nativeCommandJson(value)).digest('hex');
const fail=(code,status=422)=>{throw new CollaborativeExecutionError(code,status);};
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const refId=ref=>{if(!/^native_media:[a-f0-9-]{36}$/.test(ref||''))fail('native_media_selection_required');return ref.slice(13);};
const fields=['channel','account_ref','asset_ref','expected_revision','purpose','evidence_reference'];
export const NATIVE_MEDIA_FIELDS=Object.freeze([...fields,'asset.file','asset.purpose','asset.provenance','media.filename','media.mime_type','media.byte_size','media.state','media.receipt','result.status','result.receipt']);
export const NATIVE_MEDIA_ACTIONS=Object.freeze(['media.asset.upload','media.asset.inspect']);
const mediaScope=value=>nativeCommandJson(value);
const metadataColumns='id,tenant_id,organization_id,scope_json,account_ref,account_fingerprint,created_by_actor,created_by_user,stage_key,stage_sha256,filename,mime_type,byte_size,content_sha256,purpose,rights_reference,rights_valid_until,source_revision,state,upload_effect_id,provider_media_id,provider_receipt_sha256,created_at,updated_at';
const immutable=row=>Object.fromEntries(['id','tenant_id','organization_id','scope_json','account_ref','account_fingerprint','filename','mime_type','byte_size','content_sha256','purpose','rights_reference','rights_valid_until'].map(key=>[key,row[key]]));
const ownerIdentity=context=>nativeCommandJson({actor:context.viewer.actorId,scope:context.viewer.scope,fields:context.viewer.allowedFields,policy:context.viewer.resourcePolicy,refs:context.viewer.resourceRefs});

export class CollaborativeNativeMediaService {
    constructor({database,encryption,credentials,transport,verifyOwnerContext=null,verifyLocalPrincipal=createSqliteReadPrincipalVerifier(database),now=()=>Date.now()}){
        if(!database||typeof encryption?.encrypt!=='function'||typeof encryption?.decrypt!=='function'||typeof credentials!=='function'
            ||typeof transport?.upload!=='function'||typeof transport?.read!=='function'||(verifyOwnerContext!==null&&typeof verifyOwnerContext!=='function'))throw new TypeError('Native media requires actual source DB, credentials and native transport');
        this.db=database;this.encryption=encryption;this.credentials=credentials;this.transport=transport;this.verifyOwner=verifyOwnerContext;this.verifyLocal=verifyLocalPrincipal;this.now=now;
    }
    row(tenantId,ref,includePayload=false){const row=this.db.prepare(`SELECT ${includePayload?'*':metadataColumns} FROM savana_native_media_assets WHERE id=? AND tenant_id=?`).get(refId(ref),tenantId);if(!row)fail('native_media_not_found',404);return row;}
    public(row,allowedFields=[]){return {value:`native_media:${row.id}`,label:row.filename,filename:row.filename,mime_type:row.mime_type,byte_size:row.byte_size,
        ...(allowedFields.includes('evidence_reference')||allowedFields.includes('asset.provenance')?{evidence_reference:row.rights_reference}:{}),
        source_revision:row.source_revision,state:row.state,purpose:row.purpose,rights_valid_until:row.rights_valid_until,
        available:row.state==='uploaded'||['staged','rejected'].includes(row.state)&&Date.parse(row.rights_valid_until)>this.now(),
        actions:[{value:'media.asset.upload',available:['staged','rejected'].includes(row.state)&&Date.parse(row.rights_valid_until)>this.now()},
            {value:'media.asset.inspect',available:row.state==='uploaded'&&Boolean(row.provider_media_id)}],
        reason:row.state==='unknown'||row.state==='uploading'?'راجع نتيجة محاولة الرفع الأصلية قبل أي محاولة أخرى.':Date.parse(row.rights_valid_until)<=this.now()&&row.state!=='uploaded'?'انتهت صلاحية سجل حق استخدام الملف.':null};}
    async lookupStage(principal,{activity_ref:activityRef,idempotency_key:key}={}){
        if(!/^[A-Za-z0-9._:-]{8,128}$/.test(key||''))fail('native_media_stage_invalid');
        const context=await this.owner(principal,activityRef);
        if(!['asset.file','asset.purpose','asset.provenance'].every(field=>context.viewer.allowedFields.includes(field)))fail('native_parameter_delegation_required',403);
        const row=this.db.prepare(`SELECT ${metadataColumns} FROM savana_native_media_assets WHERE tenant_id=? AND created_by_user=? AND stage_key=?`).get(principal.tenantId,principal.userId,key);
        if(!row||row.created_by_actor!==context.viewer.actorId||row.scope_json!==mediaScope(context.viewer.scope)||!this.allows(context,[row.account_ref]))fail('native_media_stage_unresolved',404);
        const account=resolveCollaborativeAccount(this.db,principal.tenantId,'whatsapp',row.account_ref);if(account.fingerprint!==row.account_fingerprint)fail('native_media_stage_unresolved',404);
        return {...this.stamp(context),asset:this.public(row,context.viewer.allowedFields),operation_key:key};
    }
    async owner(principal,activityRef){
        if(!this.verifyOwner)fail('native_owner_api_configuration_required',503);
        if(this.verifyLocal(principal)!==true||!text(activityRef,16384))fail('native_owner_session_required',403);
        const context=await this.verifyOwner({principal,activityRef,action:'media.manage',capabilityId:'media.manage'});
        if(this.verifyLocal(principal)!==true||context?.verified!==true||context.localPolicyVerified!==true||context.nativeTenantId!==principal.tenantId||context.nativeUserId!==principal.userId
            ||!context.viewer?.actorId||!context.viewer.scope?.organization_id||!context.viewer.scope.activity_id||!Array.isArray(context.viewer.allowedFields)
            ||!['new_only','selected','activity'].includes(context.viewer.resourcePolicy)||!Array.isArray(context.viewer.resourceRefs)
            ||!Number.isFinite(Date.parse(context.viewer.validUntil))||Date.parse(context.viewer.validUntil)<=this.now())fail('native_owner_authority_unverified',403);
        return context;
    }
    allows(context,refs){return context.viewer.resourcePolicy!=='selected'||refs.every(ref=>context.viewer.resourceRefs.includes(ref));}
    outcomeHold(tenantId){return Boolean(this.db.prepare("SELECT 1 FROM savana_collaborative_executions WHERE tenant_id=? AND capability_code='media.manage' AND state='unknown' LIMIT 1").get(tenantId));}
    stamp(context){return {checked_at:new Date(this.now()).toISOString(),valid_until:new Date(Math.min(this.now()+30000,Date.parse(context.viewer.validUntil))).toISOString()};}
    async fresh(principal,activityRef,before){const current=await this.owner(principal,activityRef);if(ownerIdentity(current)!==ownerIdentity(before))fail('native_owner_authority_changed',403);return current;}
    async stage(principal,input,file){
        if(!exact(input,['activity_ref','channel','account_ref','purpose','evidence_reference','rights_note','rights_recorded_at','rights_valid_until','idempotency_key'])
            ||input.channel!=='whatsapp'||input.purpose!=='channel_content'||!text(input.evidence_reference,1000)||!text(input.rights_note,2000)||input.rights_note.trim().length<20
            ||!Number.isFinite(Date.parse(input.rights_recorded_at))||Date.parse(input.rights_recorded_at)>this.now()
            ||!Number.isFinite(Date.parse(input.rights_valid_until))||Date.parse(input.rights_valid_until)<=this.now()
            ||!/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotency_key||'')||!Buffer.isBuffer(file?.buffer)||file.buffer.length<1||file.buffer.length>MAX_FILE_SIZE)fail('native_media_stage_invalid');
        const context=await this.owner(principal,input.activity_ref);
        if(!['channel','account_ref','asset.file','asset.purpose','asset.provenance'].every(field=>context.viewer.allowedFields.includes(field))||!this.allows(context,[input.account_ref]))fail('native_parameter_delegation_required',403);
        const account=resolveCollaborativeAccount(this.db,principal.tenantId,'whatsapp',input.account_ref);if(!account.ready)fail('native_account_inactive',403);
        let verified;try{verified=await validateUploadContent(file.buffer,{policy:'media',declaredMime:file.mimetype});}catch{fail('native_media_content_invalid');}
        const filename=normalizeFilename(path.basename(typeof file.originalname==='string'?file.originalname.replace(/\\/g,'/'):'media'),'media')
            .replace(/[\u0000-\u001f\u007f]/g,'').slice(0,180)||'media';
        const digest=hash(file.buffer);const before=ownerIdentity(context);
        const current=await this.fresh(principal,input.activity_ref,context);if(before!==ownerIdentity(current))fail('native_owner_authority_changed',403);
        const stageHash=hash({input:{...input},filename,mime:verified.mime,bytes:digest,scope:context.viewer.scope,actor:context.viewer.actorId});
        const row=this.db.transaction(()=>{
            if(this.verifyLocal(principal)!==true||Date.parse(current.viewer.validUntil)<=this.now()||Date.parse(input.rights_valid_until)<=this.now())fail('native_owner_authority_changed',403);
            const latest=resolveCollaborativeAccount(this.db,principal.tenantId,'whatsapp',input.account_ref);if(!latest.ready||latest.fingerprint!==account.fingerprint)fail('native_resource_preview_changed',409);
            const old=this.db.prepare(`SELECT ${metadataColumns} FROM savana_native_media_assets WHERE tenant_id=? AND created_by_user=? AND stage_key=?`).get(principal.tenantId,principal.userId,input.idempotency_key);
            if(old){if(old.stage_sha256!==stageHash||old.created_by_actor!==current.viewer.actorId)fail('native_media_stage_conflict',409);return old;}
            const id=crypto.randomUUID();const at=new Date(this.now()).toISOString();const encrypted=this.encryption.encrypt(nativeCommandJson({purpose:'wa_native_media_asset',id,tenantId:principal.tenantId,
                scope:context.viewer.scope,accountRef:account.ref,sha256:digest,bytes:file.buffer.toString('base64'),rights:{kind:'owner_recorded',reference:input.evidence_reference,note:input.rights_note,
                    recorded_at:input.rights_recorded_at,recorded_by_actor:context.viewer.actorId,valid_until:input.rights_valid_until}}));
            this.db.prepare(`INSERT INTO savana_native_media_assets(id,tenant_id,organization_id,scope_json,account_ref,account_fingerprint,created_by_actor,created_by_user,stage_key,stage_sha256,
                filename,mime_type,byte_size,content_sha256,purpose,rights_reference,rights_valid_until,encrypted_payload,state,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'staged',?,?)`).run(id,principal.tenantId,context.viewer.scope.organization_id,mediaScope(context.viewer.scope),account.ref,account.fingerprint,
                    context.viewer.actorId,principal.userId,input.idempotency_key,stageHash,filename,verified.mime,file.buffer.length,digest,input.purpose,input.evidence_reference,input.rights_valid_until,encrypted,at,at);
            return this.row(principal.tenantId,`native_media:${id}`);
        }).immediate();
        return {...this.stamp(current),asset:this.public(row,current.viewer.allowedFields),operation_key:input.idempotency_key};
    }
    async options(principal,{activity_ref:activityRef,account_ref:accountRef=null}={}){
        const context=await this.owner(principal,activityRef);
        if(!['channel','account_ref','asset_ref'].every(field=>context.viewer.allowedFields.includes(field)))fail('native_parameter_delegation_required',403);
        const accounts=listCollaborativeAccounts(this.db,principal.tenantId,'whatsapp').filter(choice=>this.allows(context,[choice.value]));let assets=[];
        if(accountRef){if(!this.allows(context,[accountRef]))fail('native_resource_delegation_required',403);
            const account=resolveCollaborativeAccount(this.db,principal.tenantId,'whatsapp',accountRef);
            assets=this.db.prepare(`SELECT ${metadataColumns} FROM savana_native_media_assets WHERE tenant_id=? AND account_ref=? AND scope_json=? ORDER BY created_at DESC LIMIT 100`)
                .all(principal.tenantId,accountRef,mediaScope(context.viewer.scope)).filter(row=>row.account_fingerprint===account.fingerprint
                    &&this.allows(context,[accountRef,`native_media:${row.id}`])&&(context.viewer.resourcePolicy!=='new_only'||row.created_by_actor===context.viewer.actorId)).map(row=>this.public(row,context.viewer.allowedFields));}
        const current=await this.fresh(principal,activityRef,context);
        return {...this.stamp(current),capability:'media.manage',channels:[{value:'whatsapp',label:'WhatsApp',available:true}],accounts,assets,
            actions:[{value:'media.asset.upload',label:'رفع الملف إلى مكتبة WhatsApp'},{value:'media.asset.inspect',label:'عرض حالة الملف المرفوع'}],
            capabilities:[{action:'media.manage',availability:this.outcomeHold(principal.tenantId)?collaborativeBlocker('native_previous_outcome_unresolved','media.manage'):
                {state:'approval_required',reason_code:'preview_required',message:'اختر ملفًا وحسابًا ثم راجع المتطلبات الحالية.',next_action:{code:'preview',label:'معاينة الملف',href:'/portal/integrations?workspace=shared&action=media.manage'}}}],
            purposes:[{value:'channel_content',label:'محتوى يملك النشاط حق استخدامه على القناة'}],
            can_stage:['asset.file','asset.purpose','asset.provenance'].every(field=>current.viewer.allowedFields.includes(field)),max_file_bytes:MAX_FILE_SIZE,accepted_mime_types:[...ALLOWED_MEDIA_MIMES],
            provenance_notice:'يرتبط الملف بسجل حق استخدام موثق لدى النشاط. حفظ الملف محليًا يسبق مراجعة طلب رفعه إلى القناة.'};
    }
    validate(payload,action){
        validateNativeCommandModel('NativeActionPayload',payload);const p=payload.parameters;
        if(!NATIVE_MEDIA_ACTIONS.includes(action)||!exact(p,[...fields,'resource_fingerprint'])||p.channel!=='whatsapp'||!text(p.account_ref,255)
            ||p.purpose!=='channel_content'||!text(p.evidence_reference,1000)||!Number.isSafeInteger(p.expected_revision)||p.expected_revision<1
            ||p.resource_fingerprint!==undefined&&!/^[a-f0-9]{64}$/.test(p.resource_fingerprint))fail('native_media_parameters_invalid');
        refId(p.asset_ref);if(payload.expected_source_revision!=null&&payload.expected_source_revision!==p.expected_revision)fail('native_media_revision_conflict',409);
        if(payload.resource_ref!=null&&![p.account_ref,p.asset_ref].includes(payload.resource_ref)||(payload.resource_refs||[]).some(ref=>![p.account_ref,p.asset_ref].includes(ref)))fail('native_payload_resource_mismatch');
        return {...payload,payload_type:'native_action',parameters:{...p}};
    }
    async configured({tenantId,parameters}){
        try{if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='savana_native_media_assets'").get())return false;
            const account=resolveCollaborativeAccount(this.db,tenantId,'whatsapp',parameters.account_ref);const credentials=await this.credentials(tenantId,account.row.phone_number_id);
            return account.ready&&String(credentials?.tenant?.id)===String(tenantId)&&String(credentials?.phoneNumberId)===String(account.row.phone_number_id)&&Boolean(credentials?.accessToken)&&!credentials.error;
        }catch{return false;}
    }
    assertCurrent(prepared,effectId=null){
        const row=this.row(prepared.tenantId,prepared.parameters.asset_ref);const account=resolveCollaborativeAccount(this.db,prepared.tenantId,'whatsapp',prepared.parameters.account_ref);
        const tenant=this.db.prepare('SELECT status FROM tenants WHERE id=?').get(prepared.tenantId);
        if(!['Active','Warning'].includes(tenant?.status)||!account.ready||account.fingerprint!==row.account_fingerprint||hash(immutable(row))!==prepared.immutableHash)fail('native_media_revision_conflict',409);
        if(prepared.action==='media.asset.upload'){
            if(row.state==='uploaded')fail('native_media_already_uploaded',409);
            if(Date.parse(row.rights_valid_until)<=this.now())fail('native_media_rights_expired',409);
            if(!(effectId?row.state==='uploading'&&row.upload_effect_id===effectId:['staged','rejected'].includes(row.state)&&row.source_revision===prepared.parameters.expected_revision))fail('native_media_upload_unresolved',409);
        }
        if(prepared.action==='media.asset.inspect'&&(!row.provider_media_id||row.state!=='uploaded'))fail('native_media_receipt_required',409);
        return row;
    }
    async prepare({tenantId,scope,parameters,command,authority=null,preview=false}){
        const row=this.row(tenantId,parameters.asset_ref);const account=resolveCollaborativeAccount(this.db,tenantId,'whatsapp',parameters.account_ref);
        const policy=command.resource_policy||authority?.viewer?.resourcePolicy||authority?.delegation?.resource_policy;
        const actor=command.actor_id||authority?.viewer?.actorId||authority?.actorId;
        if(policy==='new_only'&&row.created_by_actor!==actor)fail('native_resource_delegation_required',403);
        if(row.scope_json!==mediaScope(scope)||row.account_ref!==account.ref||row.account_fingerprint!==account.fingerprint||row.purpose!==parameters.purpose
            ||row.rights_reference!==parameters.evidence_reference||row.source_revision!==parameters.expected_revision)fail('native_media_revision_conflict',409);
        const credentials=await this.credentials(tenantId,account.row.phone_number_id);if(String(credentials?.tenant?.id)!==String(tenantId)||credentials.phoneNumberId!==account.row.phone_number_id||!credentials.accessToken||credentials.error)fail('native_provider_configuration_required',403);
        const p={...parameters};delete p.resource_fingerprint;const resourceSelection={channel:'whatsapp',nativeAccountRef:account.ref,accountFingerprint:account.fingerprint,
            recipients:[{ref:p.asset_ref,fingerprint:hash(immutable(row))}],contentRef:p.asset_ref};
        const resourceFingerprint=hash({tenantId,scope,action:command.action,parameters:p,resources:resourceSelection,sourceRevision:row.source_revision});
        if(!preview&&parameters.resource_fingerprint!==resourceFingerprint)fail('native_resource_preview_changed',409);
        const prepared={tenantId,scope,action:command.action,parameters:{...p,resource_fingerprint:resourceFingerprint},resourceFingerprint,resourceSelection,
            asset:row,immutableHash:hash(immutable(row)),account,credentials,quote:{total_credits:0,within_budget:true,currency_label:'رصيد المنصة'}};
        this.assertCurrent(prepared);return prepared;
    }
    decode(row){let value;try{value=JSON.parse(this.encryption.decrypt(row.encrypted_payload));}catch{fail('native_media_source_unavailable',503);}
        if(value.purpose!=='wa_native_media_asset'||value.id!==row.id||value.tenantId!==row.tenant_id||mediaScope(value.scope)!==row.scope_json||value.accountRef!==row.account_ref
            ||value.sha256!==row.content_sha256||typeof value.bytes!=='string')fail('native_media_source_unavailable',503);
        const bytes=Buffer.from(value.bytes,'base64');if(bytes.length!==row.byte_size||hash(bytes)!==row.content_sha256)fail('native_media_source_unavailable',503);return {value,bytes};}
    receipt(row){return {accepted:true,native_kind:'whatsapp_media_asset',native_id:`native_media:${row.id}`,provider_id:row.provider_media_id,source_revision:row.source_revision};}
    async execute({tenantId,scope,prepared,command,effect}){
        return effect({key:prepared.parameters.asset_ref,kind:'whatsapp_media_asset',run:async({effectId,idempotencyKey,assertEffectLease})=>{
            if(command.action==='media.asset.inspect')return this.inspect({tenantId,scope,command,prepared,idempotencyKey,assertEffectLease});
            let dispatched=false;
            try{const current=this.db.transaction(()=>{assertEffectLease();const row=this.assertCurrent(prepared);
                    const changed=this.db.prepare("UPDATE savana_native_media_assets SET state='uploading',upload_effect_id=?,source_revision=source_revision+1,updated_at=? WHERE id=? AND source_revision=? AND state IN ('staged','rejected')")
                        .run(effectId,new Date(this.now()).toISOString(),row.id,row.source_revision);if(changed.changes!==1)fail('native_media_upload_unresolved',409);return this.row(tenantId,prepared.parameters.asset_ref);}).immediate();
                const {bytes}=this.decode(this.row(tenantId,prepared.parameters.asset_ref,true));const upload=await this.transport.upload({context:prepared.credentials,bytes,mimeType:current.mime_type,filename:current.filename,
                    beforeDispatch:()=>{assertEffectLease();this.assertCurrent(prepared,effectId);dispatched=true;}});
                if(!upload.result?.ok){const error=new Error('Native media provider did not confirm upload');
                    error.confirmedFailure=[400,401,403,404,413,422].includes(upload.result?.status)&&Number.isSafeInteger(upload.result?.error?.code);
                    error.deliveryUncertain=!error.confirmedFailure;throw error;}
                const mediaId=upload.result.data?.id;if(!text(mediaId,255)){const error=new Error('Native media acknowledgement unavailable');error.deliveryUncertain=true;throw error;}
                return this.db.transaction(()=>{
                    const changed=this.db.prepare("UPDATE savana_native_media_assets SET state='uploaded',provider_media_id=?,provider_receipt_sha256=?,source_revision=source_revision+1,updated_at=? WHERE id=? AND state='uploading' AND upload_effect_id=?")
                        .run(mediaId,hash({id:mediaId}),new Date(this.now()).toISOString(),current.id,effectId);if(changed.changes!==1){const error=new Error('Native media receipt store unavailable');error.deliveryUncertain=true;throw error;}
                    return this.receipt(this.row(tenantId,prepared.parameters.asset_ref));
                }).immediate();
            }catch(error){
                const definitive=!dispatched||error.confirmedFailure===true&&!error.deliveryUncertain;
                this.db.prepare("UPDATE savana_native_media_assets SET state=?,source_revision=source_revision+1,updated_at=? WHERE id=? AND state='uploading' AND upload_effect_id=?")
                    .run(definitive?'rejected':'unknown',new Date(this.now()).toISOString(),refId(prepared.parameters.asset_ref),effectId);
                if(definitive)error.dispatched=false;else error.deliveryUncertain=true;throw error;
            }
        }});
    }
    async inspect({tenantId,scope,command,prepared,idempotencyKey,assertEffectLease}){
        const row=this.assertCurrent(prepared);let response;
        try{response=await this.transport.read({context:prepared.credentials,mediaId:row.provider_media_id,beforeDispatch:()=>{assertEffectLease();this.assertCurrent(prepared);}});
            assertEffectLease();this.assertCurrent(prepared);if(!response?.ok||response.data?.id!==row.provider_media_id)fail('native_media_metadata_unverified',409);
            const id=crypto.randomUUID();const data={state:'uploaded',filename:row.filename,mime_type:row.mime_type,byte_size:row.byte_size,provider_media_id:row.provider_media_id,
                verified_at:new Date(this.now()).toISOString()};
            this.db.prepare(`INSERT INTO savana_native_action_facts(id,tenant_id,native_idempotency_key,request_sha256,action,resource_ref,source_revision,scope_json,encrypted_result,created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,tenantId,idempotencyKey,hash(command),command.action,prepared.parameters.asset_ref,row.source_revision,mediaScope(scope),this.encryption.encrypt(nativeCommandJson(data)),new Date(this.now()).toISOString());
            return this.receipt(row);
        }catch(error){error.dispatched=false;throw error;}
    }
    async reconcile({tenantId,command,effect}){
        const row=this.row(tenantId,command.payload.parameters.asset_ref);if(row.scope_json!==mediaScope(command.scope)||row.account_ref!==command.payload.parameters.account_ref)return {definitive:false};
        if(!row.provider_media_id||row.state!=='uploaded'||command.action==='media.asset.upload'&&row.upload_effect_id!==effect.id)return {definitive:false};
        const account=resolveCollaborativeAccount(this.db,tenantId,'whatsapp',row.account_ref);if(!account.ready||account.fingerprint!==row.account_fingerprint)return {definitive:false};
        const credentials=await this.credentials(tenantId,account.row.phone_number_id);if(String(credentials?.tenant?.id)!==String(tenantId)||credentials.phoneNumberId!==account.row.phone_number_id||!credentials.accessToken)return {definitive:false};
        const response=await this.transport.read({context:credentials,mediaId:row.provider_media_id});
        const currentAccount=resolveCollaborativeAccount(this.db,tenantId,'whatsapp',row.account_ref);
        if(!response?.ok||response.data?.id!==row.provider_media_id||!currentAccount.ready||currentAccount.fingerprint!==row.account_fingerprint
            ||this.row(tenantId,`native_media:${row.id}`).provider_media_id!==row.provider_media_id)return {definitive:false};
        return {definitive:true,state:'accepted',receipt:this.receipt(row)};
    }
    readPolicy({tenantId,parameters,command}){const row=this.row(tenantId,parameters.asset_ref);const account=resolveCollaborativeAccount(this.db,tenantId,'whatsapp',row.account_ref);
        if(row.scope_json!==mediaScope(command.scope)||row.account_ref!==parameters.account_ref||account.fingerprint!==row.account_fingerprint)fail('native_media_revision_conflict',403);
        return {channel:'whatsapp',nativeAccountRef:row.account_ref,accountFingerprint:row.account_fingerprint};}
    projectResult({tenantId,command,effects,viewer}){
        const p=command.payload.parameters;const row=this.row(tenantId,p.asset_ref);const refs=new Set(viewer.resourceRefs||[]);const allowed=new Set(viewer.allowedFields||[]);
        if(viewer.resourcePolicy==='selected'&&!refs.has(p.asset_ref))return {records:[]};
        const output={};const accepted=effects.some(effect=>effect.state==='accepted'&&effect.effect_key===p.asset_ref);
        if(!accepted)return {records:[]};
        for(const [field,key]of [['media.filename','filename'],['media.mime_type','mime_type'],['media.byte_size','byte_size'],['media.state','state'],['media.receipt','provider_media_id']])if(allowed.has(field))output[key]=row[key];
        return {records:Object.keys(output).length?[output]:[]};
    }
    adapter(){return {qualified:true,actions:NATIVE_MEDIA_ACTIONS,fields:NATIVE_MEDIA_FIELDS,resultFields:NATIVE_MEDIA_FIELDS.filter(field=>field.startsWith('media.')),
        validatorVersion:'wa-native-media-v1',cancellationSupported:false,configured:this.configured.bind(this),validate:this.validate.bind(this),prepare:this.prepare.bind(this),
        execute:this.execute.bind(this),reconcile:this.reconcile.bind(this),readPolicy:this.readPolicy.bind(this),projectResult:this.projectResult.bind(this)};}
    async preview(principal,{activity_ref:activityRef,capability,action,parameters}={}){
        if(capability!=='media.manage')fail('native_action_unsupported');const context=await this.owner(principal,activityRef);const payload=this.validate({payload_type:'native_action',parameters},action);
        if(Object.keys(parameters).filter(field=>field!=='resource_fingerprint').some(field=>!context.viewer.allowedFields.includes(field))||!this.allows(context,[parameters.account_ref,parameters.asset_ref]))fail('native_parameter_delegation_required',403);
        if(this.outcomeHold(principal.tenantId))return {...this.stamp(context),normalized_parameters:parameters,resource_fingerprint:null,
            quote:{total_credits:0,within_budget:false,currency_label:'رصيد المنصة'},availability:collaborativeBlocker('native_previous_outcome_unresolved','media.manage')};
        let prepared;try{prepared=await this.prepare({tenantId:principal.tenantId,scope:context.viewer.scope,parameters,command:{capability,action,payload},authority:context,preview:true});}
        catch(error){return {...this.stamp(await this.fresh(principal,activityRef,context)),normalized_parameters:parameters,resource_fingerprint:null,quote:{total_credits:0,within_budget:false,currency_label:'رصيد المنصة'},availability:collaborativeBlocker(error.code,'media.manage')};}
        const current=await this.fresh(principal,activityRef,context);this.assertCurrent(prepared);const normalized={...prepared.parameters};delete normalized.resource_fingerprint;
        return {...this.stamp(current),normalized_parameters:normalized,resource_fingerprint:prepared.resourceFingerprint,quote:prepared.quote,
            availability:{state:'review_available',reason_code:'native_media_review_required',message:'راجع الملف وحق استخدامه قبل طلب الرفع أو عرض حالته.',next_action:{code:'review_request',label:'مراجعة الطلب',href:'/portal/integrations?workspace=shared&action=media.manage'}},
            summary:[{label:'العملية',value:action==='media.asset.upload'?'رفع ملف إلى مكتبة WhatsApp':'عرض حالة ملف مرفوع'},{label:'الحساب',value:prepared.account.label},
                {label:'الملف',value:prepared.asset.filename},{label:'الحجم',value:`${prepared.asset.byte_size} بايت`},{label:'الغرض',value:'محتوى يملك النشاط حق استخدامه على القناة'},
                {label:'مرجع حق الاستخدام',value:prepared.asset.rights_reference},{label:'صلاحية سجل الحق',value:prepared.asset.rights_valid_until},{label:'التكلفة على رصيد المنصة',value:'0'}]};
    }
}
