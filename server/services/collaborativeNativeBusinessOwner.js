import {createSqliteReadPrincipalVerifier} from './centralProductRead.js';
import {CollaborativeExecutionError} from './collaborativeExecution.js';
import {NATIVE_BUSINESS_ACTIONS,nativeBusinessAccount,nativeOperationRef,readNativeOperation} from './collaborativeNativeBusiness.js';
import {nativeCommandJson} from './nativeCommandProtocol.js';
import {collaborativeBlocker} from './collaborativeNativeOwner.js';

const fail=(code,status=403)=>{throw new CollaborativeExecutionError(code,status);};
const labels={'contacts.create':'إضافة جهة اتصال','contacts.change':'تعديل جهة اتصال','contacts.remove':'حذف جهة اتصال',
    'contacts.read':'عرض بيانات جهة اتصال','measurement.summary':'عرض نشاط رسائل WhatsApp','measurement.export':'تصدير نشاط رسائل WhatsApp','owner.operation_status':'عرض نتيجة عملية أصلية'};
const account=nativeBusinessAccount;
const identity=context=>nativeCommandJson({actor:context.viewer.actorId,scope:context.viewer.scope,fields:context.viewer.allowedFields,
    policy:context.viewer.resourcePolicy,refs:context.viewer.resourceRefs});
const required=action=>['channel','account_ref','purpose','evidence_reference',...(action==='contacts.create'?['phone']
    :action.startsWith('contacts.')?['contact_ref','consent_ref',...(action==='contacts.read'?[]:['expected_revision'])]:action==='owner.operation_status'?['command_ref']:[])];
const href=capability=>`/portal/integrations?workspace=shared&action=${encodeURIComponent(capability)}`;
const purposeLabels={customer_service:'خدمة العميل',business_record:'سجل عمل موثق',correction:'تصحيح البيانات'};
export class CollaborativeNativeBusinessOwnerService {
    constructor({database,nativeAdapters,consents,verifyOwnerContext,verifyLocalPrincipal=createSqliteReadPrincipalVerifier(database),now=()=>Date.now()}){
        if(!database||!nativeAdapters||!consents||typeof verifyOwnerContext!=='function')throw new TypeError('Native business choices require current owner authority');
        this.db=database;this.adapters=nativeAdapters;this.consents=consents;this.verifyOwner=verifyOwnerContext;this.verifyLocal=verifyLocalPrincipal;this.now=now;
    }
    async owner(principal,activityRef,capability){
        if(!Object.hasOwn(NATIVE_BUSINESS_ACTIONS,capability)||typeof activityRef!=='string'||!activityRef||this.verifyLocal(principal)!==true)fail('native_owner_session_required');
        const context=await this.verifyOwner({principal,activityRef,action:capability,capabilityId:capability});
        if(this.verifyLocal(principal)!==true||!context?.verified||context.localPolicyVerified!==true
            ||context.nativeTenantId!==principal.tenantId||context.nativeUserId!==principal.userId
            ||!context.viewer?.actorId||!context.viewer.scope?.organization_id||!context.viewer.scope.activity_id
            ||!Number.isFinite(Date.parse(context.viewer.validUntil))||Date.parse(context.viewer.validUntil)<=this.now()
            ||!Array.isArray(context.viewer.allowedFields)||!['selected','new_only','activity'].includes(context.viewer.resourcePolicy)
            ||!Array.isArray(context.viewer.resourceRefs))fail('native_owner_field_scope_required');
        if(context.viewer.resourcePolicy==='selected'&&!context.viewer.resourceRefs.includes(account(capability)))fail('native_resource_delegation_required');
        return context;
    }
    async fresh(principal,activityRef,capability,old){const current=await this.owner(principal,activityRef,capability);
        if(identity(old)!==identity(current))fail('native_owner_authority_changed');return current;}
    stamp(context){return {checked_at:new Date(this.now()).toISOString(),valid_until:new Date(Math.min(this.now()+30000,Date.parse(context.viewer.validUntil))).toISOString()};}
    summary(prepared,context,capability,action){
        const p=prepared.parameters;const fields=new Set(context.viewer.allowedFields);const rows=[{label:'العملية',value:labels[action]},
            {label:'الحساب',value:prepared.account.label},{label:'الغرض',value:purposeLabels[p.purpose]},{label:'مرجع العمل',value:p.evidence_reference}];
        if(prepared.contact){
            const label=fields.has('contact.profile_name')||fields.has('profile_name')?prepared.contact.profile_name
                :fields.has('contact.label')||fields.has('label')?prepared.contact.label:null;
            rows.push({label:'جهة الاتصال',value:label||'جهة الاتصال المحددة'});
            const evidence=this.consents.current({tenantId:prepared.tenantId,scope:prepared.scope,channel:'native',accountRef:'native_contacts',
                recipientRef:p.contact_ref,purpose:p.purpose,consentRef:p.consent_ref});
            rows.push({label:'دليل الموافقة',value:evidence.record.label},{label:'مصدر الدليل',value:evidence.record.source_label},
                {label:'صلاحية الموافقة',value:evidence.record.valid_until});
        }
        for(const [key,label]of [['phone','رقم الهاتف'],['profile_name','الاسم'],['label','التصنيف'],['notes','الملاحظات']])if(Object.hasOwn(p,key)){
            if(action==='contacts.change')rows.push({label:`${label} قبل التعديل`,value:fields.has(`contact.${key}`)?prepared.contact[key]||'فارغ':'القيمة الحالية غير متاحة ضمن صلاحيات العرض'});
            rows.push({label:action==='contacts.change'?`${label} بعد التعديل`:label,value:p[key]||'فارغ'});
        }
        if(action==='contacts.create')rows.push({label:'موافقة المراسلة',value:'يلزم سجل موافقة مستقل قبل استخدام البيانات أو مراسلة جهة الاتصال'});
        if(action==='contacts.remove')rows.push({label:'التغيير المطلوب',value:'حذف سجل جهة الاتصال المحددة'});
        if(capability.startsWith('measurement.'))rows.push({label:'النطاق',value:'رسائل WhatsApp المسجلة لحساب المؤسسة المحلي'},
            {label:'التقرير',value:'إجماليات الرسائل المسموح بها، مع النشاط اليومي لآخر 30 يومًا وأنواع الرسائل بحسب الصلاحيات'});
        if(prepared.operation)rows.push({label:'العملية الأصلية',value:`${labels[prepared.operation.command.action]||'عملية أصلية'} — ${prepared.operation.row.created_at}`},
            {label:'النتيجة المطلوبة',value:'عرض الحالة والنتائج المثبتة ضمن صلاحيات العرض الحالية'});
        return rows;
    }
    async options(principal,{activity_ref:activityRef,capability,contact_q:q='',contact_cursor:cursor=null,operation_cursor:operationCursor=null}={}){
        const context=await this.owner(principal,activityRef,capability);const fields=new Set(context.viewer.allowedFields);
        if(typeof q!=='string'||q.length>100||(cursor!=null&&!/^native_contact:[1-9][0-9]*$/.test(cursor)))fail('native_contact_search_invalid',422);
        const contacts=[];let nextCursor=null;
        const operations=[];let operationsNextCursor=null;
        if(capability==='owner.operations'&&context.viewer.resourcePolicy!=='new_only'){
            const previous=operationCursor?readNativeOperation(this.db,principal.tenantId,context.viewer.scope,operationCursor).row:null;
            const rows=this.db.prepare(`SELECT command_id,version,command_json,created_at FROM savana_collaborative_command_receipts WHERE tenant_id=?
                ${previous?'AND (created_at<? OR (created_at=? AND (command_id<? OR (command_id=? AND version<?))))':''}
                ORDER BY created_at DESC,command_id DESC,version DESC LIMIT 101`)
                .all(principal.tenantId,...(previous?[previous.created_at,previous.created_at,previous.command_id,previous.command_id,previous.version]:[]));
            for(const row of rows.slice(0,100)){
                const ref=nativeOperationRef(row);if(ref.length>255||context.viewer.resourcePolicy==='selected'&&!context.viewer.resourceRefs.includes(ref))continue;
                try{const current=readNativeOperation(this.db,principal.tenantId,context.viewer.scope,ref);
                    operations.push({value:ref,label:`${labels[current.command.action]||'عملية أصلية'} — ${row.created_at}`,available:true});}catch{/* Other activities are not selectable. */}
            }
            if(rows.length===101)operationsNextCursor=nativeOperationRef(rows[99]);
        }
        if(capability==='customers.manage'&&context.viewer.resourcePolicy!=='new_only'){
            const rows=this.db.prepare(`SELECT id,profile_name,label,source_revision FROM contacts WHERE tenant_id=? AND id>?
                AND (?='' OR profile_name LIKE ? OR label LIKE ?) ORDER BY id LIMIT 101`)
                .all(principal.tenantId,cursor?Number(cursor.slice(15)):0,q.trim(),`%${q.trim()}%`,`%${q.trim()}%`);
            for(const row of rows){const ref=`native_contact:${row.id}`;
                if(context.viewer.resourcePolicy==='selected'&&!context.viewer.resourceRefs.includes(ref))continue;
                const label=fields.has('contact.profile_name')||fields.has('profile_name')?row.profile_name:fields.has('contact.label')||fields.has('label')?row.label:null;
                // A usable named choice requires permission for its source label.
                if(!label)continue;
                contacts.push({value:ref,label,source_revision:row.source_revision,available:true});
            }
            if(rows.length===101)nextCursor=`native_contact:${rows[99].id}`;
        }
        const actions=NATIVE_BUSINESS_ACTIONS[capability].map(action=>{
            const permitted=required(action).every(field=>fields.has(field))
                &&!(context.viewer.resourcePolicy==='new_only'&&capability!=='customers.manage')
                &&!(context.viewer.resourcePolicy==='new_only'&&['contacts.change','contacts.remove','contacts.read'].includes(action))
                &&(action!=='contacts.change'||fields.has('label')||fields.has('notes'));
            return {value:action,label:labels[action],required_fields:required(action),available:permitted,
                availability:{state:permitted?'review_available':'resource_scope_required',reason_code:permitted?'native_review_required':'native_parameter_delegation_required',
                    message:permitted?'اختر البيانات ثم راجع الطلب. لا ينفّذ العرض أي تغيير.':'تحتاج هذه العملية صلاحيات الحقول والموارد المحددة.',
                    next_action:{code:permitted?'prepare_request':'review_permissions',label:permitted?'إعداد الطلب':'مراجعة الصلاحيات',href:href(capability)}}};
        });
        const evidence=capability==='customers.manage'?this.db.prepare(`SELECT * FROM savana_collaborative_consents WHERE tenant_id=? AND organization_id=? AND activity_id=?
            AND channel='native' AND account_ref='native_contacts' ORDER BY created_at DESC LIMIT 1000`).all(principal.tenantId,context.viewer.scope.organization_id,context.viewer.scope.activity_id)
            .filter(row=>contacts.some(contact=>contact.value===row.recipient_ref))
            .filter(row=>context.viewer.resourcePolicy!=='selected'||context.viewer.resourceRefs.includes(`consent:${row.id}`))
            .map(row=>{let available=false;try{this.consents.current({tenantId:principal.tenantId,scope:context.viewer.scope,channel:'native',accountRef:'native_contacts',recipientRef:row.recipient_ref,purpose:row.purpose,consentRef:`consent:${row.id}`});available=true;}catch{/* Explicit source evidence remains disabled. */}
                return {...this.consents.publicRecord(row),available};}):[];
        const current=await this.fresh(principal,activityRef,capability,context);
        return {...this.stamp(current),capability,accounts:[{value:account(capability),label:capability==='customers.manage'?'جهات الاتصال':capability==='owner.operations'?'نتائج العمليات الأصلية':'نشاط رسائل WhatsApp المحلي',available:true}],
            contacts,contacts_next_cursor:nextCursor,operations,operations_next_cursor:operationsNextCursor,actions,consent_evidence:evidence,
            consent_management:{can_record:current.canManageConsent===true,can_revoke:current.canManageConsent===true},
            purposes:Object.entries(purposeLabels).map(([value,label])=>({value,label})),
            editable_fields:['phone','profile_name','label','notes'].filter(field=>fields.has(field)),
            privacy_notice:'تستخدم البيانات للغرض المحدد فقط. إضافة جهة اتصال لا تنشئ موافقة على إرسال الرسائل.'};
    }
    async preview(principal,{activity_ref:activityRef,capability,action,parameters}={}){
        const context=await this.owner(principal,activityRef,capability);const adapter=this.adapters[`${capability}:native`];
        if(!adapter||!NATIVE_BUSINESS_ACTIONS[capability].includes(action))fail('native_action_unsupported',422);
        const payload=adapter.validate({payload_type:'native_action',parameters},action);
        const used=Object.keys(payload.parameters).filter(key=>key!=='resource_fingerprint');
        if(used.some(key=>!context.viewer.allowedFields.includes(key))
            ||(context.viewer.resourcePolicy==='new_only'&&(capability!=='customers.manage'||['contacts.change','contacts.remove','contacts.read'].includes(action)))
            ||(context.viewer.resourcePolicy==='selected'&&[payload.parameters.contact_ref,payload.parameters.consent_ref,payload.parameters.command_ref].filter(Boolean).some(ref=>!context.viewer.resourceRefs.includes(ref))))fail('native_parameter_delegation_required');
        let prepared;
        try{if(await adapter.configured({tenantId:principal.tenantId,parameters:payload.parameters})!==true)fail(adapter.configurationReason?.()||'native_business_schema_required',503);
            prepared=await adapter.prepare({tenantId:principal.tenantId,scope:context.viewer.scope,parameters:payload.parameters,
            command:{capability,action,payload},preview:true});}
        catch(error){if(error?.code){return {...this.stamp(await this.fresh(principal,activityRef,capability,context)),normalized_parameters:payload.parameters,
            resource_fingerprint:null,quote:{total_credits:0,within_budget:false,currency_label:'بدون إرسال خارجي'},availability:collaborativeBlocker(error.code,capability)};}throw error;}
        const current=await this.fresh(principal,activityRef,capability,context);
        const latest=await adapter.prepare({tenantId:principal.tenantId,scope:current.viewer.scope,parameters:payload.parameters,command:{capability,action,payload},preview:true});
        if(latest.resourceFingerprint!==prepared.resourceFingerprint||this.verifyLocal(principal)!==true||Date.parse(current.viewer.validUntil)<=this.now())fail('native_owner_authority_changed');
        const normalized={...prepared.parameters};delete normalized.resource_fingerprint;
        return {...this.stamp(current),normalized_parameters:normalized,resource_fingerprint:prepared.resourceFingerprint,quote:prepared.quote,
            availability:{state:'review_available',reason_code:'native_review_required',message:'راجع البيانات والغرض قبل طلب الموافقة. لم يُنفّذ أي تغيير.',
                next_action:{code:'review_request',label:'مراجعة الطلب',href:href(capability)}},summary:this.summary(latest,current,capability,action)};
    }
}
