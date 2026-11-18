import crypto from 'node:crypto';
import {CollaborativeExecutionError} from './collaborativeExecution.js';
import {nativeCommandJson} from './nativeCommandProtocol.js';
import {resolveCollaborativeAccount} from './collaborativeNativeResources.js';

export const NATIVE_REVIEW_CAPABILITIES=Object.freeze({'messaging.review':'messaging.send','campaigns.review':'campaigns.execute','content.review':'content.publish'});
const hash=value=>crypto.createHash('sha256').update(nativeCommandJson(value)).digest('hex');
const fail=(code,status=409)=>{throw new CollaborativeExecutionError(code,status);};
// These are source-owned review drafts, not approval of their proposed effect.
// The original sender/publisher is never invoked by a review handler.
export const createCollaborativeNativeReviewAdapters=({database,encryption,nativeAdapters,now=()=>Date.now()})=>{
    if(!database||typeof encryption?.encrypt!=='function'||typeof encryption?.decrypt!=='function'||!nativeAdapters)throw new TypeError('Native review drafts require source DB, encryption and current typed proposal validators');
    const adapters={};
    for(const [capability,executionCapability]of Object.entries(NATIVE_REVIEW_CAPABILITIES))for(const [key,base]of Object.entries(nativeAdapters)){
        if(!key.startsWith(`${executionCapability}:`)||base.qualified!==true||typeof base.assertCurrent!=='function')continue;
        const channel=key.slice(executionCapability.length+1);
        const nativeReceipt=fact=>({accepted:true,native_kind:'native_review_draft',native_id:fact.resource_ref,source_revision:1,fact_id:fact.id});
        adapters[`${capability}:${channel}`]={qualified:true,actions:[capability],configured:base.configured,fields:base.fields,
            cancellationSupported:false,validatorVersion:'wa-native-review-v1',
            validate:(payload,action)=>{if(action!==capability)fail('native_action_unsupported',422);return base.validate(payload,executionCapability);},
            prepare:input=>base.prepare({...input,command:{...input.command,capability:executionCapability,action:executionCapability}}),
            readPolicy:({tenantId,parameters})=>{const account=resolveCollaborativeAccount(database,tenantId,channel,parameters.account_ref);
                return {channel,nativeAccountRef:account.ref,accountFingerprint:account.fingerprint};},
            execute:({tenantId,scope,prepared,command,effect})=>effect({key:prepared.account.ref,kind:'native_review_draft',run:({idempotencyKey,assertEffectLease})=>{
                try{return database.transaction(()=>{
                    const old=database.prepare('SELECT * FROM savana_native_action_facts WHERE native_idempotency_key=?').get(idempotencyKey);
                    if(old){if(old.tenant_id!==tenantId||old.request_sha256!==hash(command))fail('native_source_fact_conflict');return nativeReceipt(old);}
                    assertEffectLease();base.assertCurrent(prepared);
                    const id=crypto.randomUUID();const ref=`native_review:${id}`;const data={fact_id:id,tenant_id:tenantId,action:capability,
                        resource_ref:ref,state:'recorded',proposed_capability:executionCapability,parameters:prepared.parameters,recorded_by:command.actor_id,
                        execution_authorized:false};
                    database.prepare(`INSERT INTO savana_native_action_facts(id,tenant_id,native_idempotency_key,request_sha256,action,resource_ref,source_revision,scope_json,encrypted_result,created_at)
                        VALUES(?,?,?,?,?,?,1,?,?,?)`).run(id,tenantId,idempotencyKey,hash(command),capability,ref,nativeCommandJson(scope),encryption.encrypt(nativeCommandJson(data)),new Date(now()).toISOString());
                    return nativeReceipt({id,resource_ref:ref});
                }).immediate();}catch(error){if(database.prepare('SELECT 1 FROM savana_native_action_facts WHERE native_idempotency_key=?').get(idempotencyKey))error.deliveryUncertain=true;
                    else error.dispatched=false;throw error;}
            }}),
            reconcile:async({tenantId,command,effect})=>{
                const fact=database.prepare('SELECT * FROM savana_native_action_facts WHERE tenant_id=? AND native_idempotency_key=?').get(tenantId,effect.native_idempotency_key);
                if(!fact||fact.request_sha256!==hash(command))return {definitive:false};
                const data=JSON.parse(encryption.decrypt(fact.encrypted_result));
                if(data.fact_id!==fact.id||data.tenant_id!==tenantId||data.action!==capability||data.execution_authorized!==false)fail('native_source_fact_invalid',503);
                return {definitive:true,state:'accepted',receipt:nativeReceipt(fact)};
            }};
    }
    return adapters;
};
