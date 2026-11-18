import crypto from 'node:crypto';
import { nativeCommandJson, NativeCommandProtocolError } from './nativeCommandProtocol.js';
import { verifyMetaWebhookSignature } from '../security/webhookSignature.js';
import { resolveCollaborativeAccount } from './collaborativeNativeResources.js';
import { insertMessengerMessage, normalizeMessengerTimestamp } from './messengerMessages.js';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const equal = (a,b) => typeof a==='string' && typeof b==='string' && a.length===b.length
    && crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fail = code => { throw new NativeCommandProtocolError(code,409); };
const normalizeRecipient = (channel,value) => channel==='whatsapp' ? String(value||'').replace(/\+/g,'').replace(/\s/g,'') : String(value||'').trim();
const statusPriority = {sent:1,delivered:2,read:3,failed:1};

export class CollaborativeEffectEvidence {
    constructor({database,encryption,billing,settleWhatsAppStatus=null,appSecret,appId=null,now=()=>Date.now()}) {
        if(!database||typeof encryption?.encrypt!=='function'||typeof encryption?.decrypt!=='function'
            ||typeof billing?.commit!=='function'||typeof appSecret!=='string'||!appSecret)throw new TypeError('Provider evidence requires owned DB/cipher/billing and actual Meta app signature secret');
        this.db=database;this.cipher=encryption;this.billing=billing;this.settleWhatsAppStatus=settleWhatsAppStatus;
        this.appSecret=appSecret;this.appId=appId;this.now=now;
    }
    ready(channel) { return channel==='whatsapp' ? typeof this.settleWhatsAppStatus==='function'
        : channel==='messenger' && typeof this.appId==='string' && Boolean(this.appId); }
    #material(capture) { return nativeCommandJson({effect_id:capture.effectId,execution_id:capture.executionId,
        command_hash:capture.commandHash,tenant_id:capture.tenantId,channel:capture.channel,account_ref:capture.accountRef,
        account_fingerprint:capture.accountFingerprint,recipient_sha256:capture.recipientHash,payload_sha256:capture.payloadHash,
        native_idempotency_key:capture.nativeIdempotencyKey}); }
    #token(capture,key) { return `wae1.${capture.effectId.replaceAll('-','')}.${crypto.createHmac('sha256',key).update(this.#material(capture)).digest('hex').slice(0,32)}`; }
    prepare({effectId,channel,tenantId,accountRef,recipient,nativePayload,nativeRecord,billingUsageId=null}) {
        if(!this.ready(channel)||typeof effectId!=='string')fail('native_provider_evidence_configuration_required');
        const effect=this.db.prepare(`SELECT effect.*,execution.tenant_id,execution.request_hash FROM savana_collaborative_effects effect
            JOIN savana_collaborative_executions execution ON execution.id=effect.execution_id WHERE effect.id=?`).get(effectId);
        if(!effect||effect.state!=='dispatching'||effect.tenant_id!==tenantId)fail('native_effect_capture_not_active');
        const account=resolveCollaborativeAccount(this.db,tenantId,channel,accountRef);
        const normalized=normalizeRecipient(channel,recipient);
        if(!normalized||!nativePayload||!nativeRecord)fail('native_effect_capture_invalid');
        const usage=billingUsageId==null?null:this.db.prepare('SELECT * FROM billing_usage_events WHERE id=? AND tenant_id=?').get(billingUsageId,tenantId);
        if(billingUsageId!=null&&(!usage||usage.status!=='reserved'||usage.idempotency_key!==effect.native_idempotency_key))fail('native_effect_billing_capture_invalid');
        const capture={effectId,executionId:effect.execution_id,commandHash:effect.request_hash,tenantId,channel,accountRef,
            accountFingerprint:account.fingerprint,recipient:normalized,recipientHash:sha(normalized),
            providerAccountId:channel==='whatsapp'?String(account.row.phone_number_id):String(account.row.page_id),
            payloadHash:sha(nativeCommandJson(nativePayload)),nativeIdempotencyKey:effect.native_idempotency_key,nativeRecord,nativePayload};
        return this.db.transaction(()=>{
            const old=this.db.prepare('SELECT * FROM savana_collaborative_correlations WHERE effect_id=?').get(effectId);
            if(old){
                if(old.payload_sha256!==capture.payloadHash||old.account_fingerprint!==account.fingerprint
                    ||old.recipient_sha256!==capture.recipientHash||old.billing_usage_id!==billingUsageId)fail('native_effect_capture_conflict');
                const saved=JSON.parse(this.cipher.decrypt(old.encrypted_capture));const key=JSON.parse(this.cipher.decrypt(old.encrypted_mac_key));
                if(key.purpose!=='wa-native-effect-mac'||key.effect_id!==effectId)fail('native_effect_capture_key_invalid');
                return this.#token(saved,Buffer.from(key.key,'hex'));
            }
            const key=crypto.randomBytes(32);const token=this.#token(capture,key);
            this.db.prepare(`INSERT INTO savana_collaborative_correlations(effect_id,channel,tenant_id,account_ref,account_fingerprint,
                recipient_sha256,payload_sha256,token_sha256,encrypted_mac_key,encrypted_capture,billing_usage_id,created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(effectId,channel,tenantId,accountRef,account.fingerprint,capture.recipientHash,
                    capture.payloadHash,sha(token),this.cipher.encrypt(nativeCommandJson({purpose:'wa-native-effect-mac',effect_id:effectId,key:key.toString('hex')})),
                    this.cipher.encrypt(nativeCommandJson(capture)),billingUsageId,new Date(this.now()).toISOString());
            this.db.prepare('UPDATE savana_collaborative_effects SET billing_usage_id=? WHERE id=? AND state=\'dispatching\'').run(billingUsageId,effectId);
            return token;
        }).immediate();
    }
    #find(channel,token,providerAccountId,recipient) {
        if(typeof token!=='string'||!/^wae1\.[a-f0-9]{32}\.[a-f0-9]{32}$/.test(token))return null;
        const row=this.db.prepare(`SELECT correlation.*,effect.execution_id,effect.native_idempotency_key,effect.state,
            execution.request_hash FROM savana_collaborative_correlations correlation
            JOIN savana_collaborative_effects effect ON effect.id=correlation.effect_id
            JOIN savana_collaborative_executions execution ON execution.id=effect.execution_id WHERE correlation.token_sha256=?`).get(sha(token));
        if(!row||row.channel!==channel||!['dispatching','unknown','accepted'].includes(row.state))return null;
        let capture;let key;
        try{capture=JSON.parse(this.cipher.decrypt(row.encrypted_capture));key=JSON.parse(this.cipher.decrypt(row.encrypted_mac_key));}catch{return null;}
        if(key.purpose!=='wa-native-effect-mac'||key.effect_id!==row.effect_id||capture.effectId!==row.effect_id
            ||capture.executionId!==row.execution_id||capture.commandHash!==row.request_hash||capture.tenantId!==row.tenant_id
            ||capture.nativeIdempotencyKey!==row.native_idempotency_key||capture.payloadHash!==row.payload_sha256
            ||sha(nativeCommandJson(capture.nativePayload))!==row.payload_sha256
            ||String(providerAccountId)!==capture.providerAccountId||sha(normalizeRecipient(channel,recipient))!==row.recipient_sha256
            ||!equal(this.#token(capture,Buffer.from(key.key,'hex')),token))return null;
        let account;try{account=resolveCollaborativeAccount(this.db,row.tenant_id,channel,row.account_ref);}catch{return null;}
        if(account.fingerprint!==row.account_fingerprint)return null;
        return {row,capture,account};
    }
    #persist(found,providerId,providerStatus,rawHash,occurredAt) {
        if(typeof providerId!=='string'||!providerId||providerId.length>255)return false;
        const {row,capture}=found;const evidenceId=sha(nativeCommandJson([row.effect_id,providerId,providerStatus]));
        return this.db.transaction(()=>{
            const existing=this.db.prepare('SELECT provider_id FROM savana_collaborative_provider_evidence WHERE effect_id=? LIMIT 1').get(row.effect_id);
            if(existing&&existing.provider_id!==providerId)fail('native_provider_receipt_conflict');
            if(this.db.prepare('SELECT 1 FROM savana_collaborative_provider_evidence WHERE id=?').get(evidenceId))return true;
            let nativeId;
            if(capture.channel==='whatsapp') {
                const old=this.db.prepare('SELECT * FROM messages WHERE wamid=? ORDER BY id LIMIT 1').get(providerId);
                if(old&&(old.tenant_id!==row.tenant_id||old.sender!==capture.providerAccountId||old.recipient!==capture.recipient
                    ||old.content!==capture.nativeRecord.content))fail('native_provider_message_conflict');
                if(old){nativeId=old.id;if((statusPriority[providerStatus]||0)>=(statusPriority[old.status]||0))this.db.prepare('UPDATE messages SET status=? WHERE id=?').run(providerStatus,old.id);}
                else nativeId=this.db.prepare(`INSERT INTO messages(tenant_id,direction,sender,recipient,message_type,content,status,wamid)
                    VALUES(?,'outgoing',?,?,?,?,?,?)`).run(row.tenant_id,capture.providerAccountId,capture.recipient,
                        capture.nativeRecord.messageType,capture.nativeRecord.content,providerStatus,providerId).lastInsertRowid;
            } else {
                const conversation=this.db.prepare('SELECT * FROM fb_conversations WHERE id=? AND tenant_id=? AND linked_page_id=? AND user_psid=?')
                    .get(capture.nativeRecord.conversationId,row.tenant_id,found.account.row.id,capture.recipient);
                if(!conversation)fail('native_provider_conversation_changed');
                const old=this.db.prepare('SELECT * FROM fb_messages WHERE mid=?').get(providerId);
                if(old&&(old.tenant_id!==row.tenant_id||old.conversation_id!==conversation.id||old.direction!=='outgoing'
                    ||old.message_text!==capture.nativeRecord.content))fail('native_provider_message_conflict');
                if(!old)insertMessengerMessage(this.db,{conversationId:conversation.id,tenantId:row.tenant_id,mid:providerId,direction:'outgoing',
                    senderId:capture.providerAccountId,senderName:found.account.label,messageText:capture.nativeRecord.content,
                    createdAt:normalizeMessengerTimestamp(occurredAt||this.now())});
                nativeId=this.db.prepare('SELECT id FROM fb_messages WHERE mid=? AND tenant_id=?').get(providerId,row.tenant_id).id;
            }
            const usage=row.billing_usage_id==null?null:this.db.prepare('SELECT * FROM billing_usage_events WHERE id=? AND tenant_id=?').get(row.billing_usage_id,row.tenant_id);
            if(usage?.status==='reserved')this.billing.commit(usage,{referenceId:providerId,description:'تأكيد أثر أصلي من إشعار المزوّد المتحقق'});
            if(capture.channel==='whatsapp')this.settleWhatsAppStatus({tenantId:row.tenant_id,wamid:providerId,status:providerStatus,
                pricing:found.pricing||null,timestamp:found.timestamp||null});
            this.db.prepare(`INSERT INTO savana_collaborative_provider_evidence(id,effect_id,provider_id,provider_status,webhook_sha256,received_at)
                VALUES(?,?,?,?,?,?)`).run(evidenceId,row.effect_id,providerId,providerStatus,rawHash,new Date(this.now()).toISOString());
            const previous=this.db.prepare('SELECT receipt_json FROM savana_collaborative_effects WHERE id=?').get(row.effect_id);
            const oldReceipt=previous.receipt_json?JSON.parse(previous.receipt_json):null;
            const status=capture.channel==='whatsapp'&&(statusPriority[oldReceipt?.provider_status]||0)>(statusPriority[providerStatus]||0)?oldReceipt.provider_status:providerStatus;
            const receipt={native_kind:capture.channel==='whatsapp'?'whatsapp_message':'messenger_message',native_id:String(nativeId),
                provider_id:providerId,accepted:true,provider_status:status,local_store_confirmed:true,billing_usage_id:row.billing_usage_id,
                evidence_kind:'verified_provider_webhook'};
            this.db.prepare(`UPDATE savana_collaborative_effects SET state='accepted',native_id=?,receipt_json=?,error_code=NULL,updated_at=?
                WHERE id=? AND state IN ('dispatching','unknown','accepted')`).run(String(nativeId),nativeCommandJson(receipt),new Date(this.now()).toISOString(),row.effect_id);
            return true;
        }).immediate();
    }
    ingest({rawBody,signature}) {
        if(!Buffer.isBuffer(rawBody)||!verifyMetaWebhookSignature({appSecret:this.appSecret,signature,rawBody}))fail('native_provider_signature_required');
        let body;try{body=JSON.parse(rawBody.toString('utf8'));}catch{fail('native_provider_payload_invalid');}
        const rawHash=sha(rawBody);const result={whatsapp:[],messenger:[]};
        if(body.object==='whatsapp_business_account')for(const entry of body.entry||[])for(const change of entry.changes||[]) {
            const value=change.value;for(const status of value?.statuses||[]) {
                if(!['sent','delivered','read','failed'].includes(status.status))continue;
                const found=this.#find('whatsapp',status.biz_opaque_callback_data,value.metadata?.phone_number_id,status.recipient_id);
                if(found&&String(entry.id)===String(found.account.row.waba_id)&&this.ready('whatsapp')){found.pricing=status.pricing;found.timestamp=status.timestamp;
                    if(this.#persist(found,status.id,status.status,rawHash,Number(status.timestamp)*1000))result.whatsapp.push({tenantId:found.row.tenant_id,providerId:status.id});}
            }
        }
        if(body.object==='page'&&this.ready('messenger'))for(const entry of body.entry||[])for(const event of entry.messaging||[]) {
            const message=event.message;if(message?.is_echo!==true||String(message.app_id)!==this.appId||String(event.sender?.id)!==String(entry.id))continue;
            const found=this.#find('messenger',message.metadata,entry.id,event.recipient?.id);
            if(found&&message.text===found.capture.nativeRecord.content&&this.#persist(found,message.mid,'accepted',rawHash,event.timestamp))result.messenger.push({tenantId:found.row.tenant_id,providerId:message.mid});
        }
        return result;
    }
}
