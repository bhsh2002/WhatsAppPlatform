import crypto from 'node:crypto';
import { CollaborativeExecutionError } from './collaborativeExecution.js';
import { nativeCommandJson } from './nativeCommandProtocol.js';
import { validateNativeCommandModel } from './nativeCommandModels.js';
import { createNativeContact,changeNativeContact,removeNativeContact,readNativeContact,NativeContactError } from './nativeContacts.js';
import { normalizeContactCreate,normalizeContactUpdate,InvalidContactError } from './contactValidation.js';
import { readNativeMessageAnalytics } from './nativeMessageAnalytics.js';

const hash=value=>crypto.createHash('sha256').update(nativeCommandJson(value)).digest('hex');
const fail=(code,status=422)=>{throw new CollaborativeExecutionError(code,status);};
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const contactId=ref=>{if(!/^native_contact:[1-9][0-9]*$/.test(ref||'')||!Number.isSafeInteger(Number(ref.slice(15))))fail('native_contact_selection_required');return Number(ref.slice(15));};
const clean=p=>{const value={...p};delete value.resource_fingerprint;return value;};
const common=['channel','account_ref','purpose','evidence_reference','resource_fingerprint'];
const contactInput=(normalizer,value)=>{try{return normalizer(value);}catch(error){if(error instanceof InvalidContactError)fail('native_contact_parameters_invalid');throw error;}};
const ownedContact=(database,tenantId,id)=>{try{return readNativeContact(database,tenantId,id);}catch(error){if(error instanceof NativeContactError)fail(error.code,error.status);throw error;}};
export const NATIVE_BUSINESS_ACTIONS=Object.freeze({
    'customers.manage':Object.freeze(['contacts.create','contacts.change','contacts.remove','contacts.read']),
    'measurement.read':Object.freeze(['measurement.summary']),
    'measurement.export':Object.freeze(['measurement.export']),
    'owner.operations':Object.freeze(['owner.operation_status']),
});
export const nativeBusinessAccount=capability=>capability==='customers.manage'?'native_contacts':capability==='owner.operations'?'native_operations':'native_messages';
export const nativeOperationRef=row=>`native_command:${Buffer.from(nativeCommandJson([row.command_id,row.version])).toString('base64url')}`;
export const readNativeOperation=(database,tenantId,scope,ref)=>{
    let tuple;try{tuple=JSON.parse(Buffer.from(String(ref||'').replace(/^native_command:/,''),'base64url').toString());}catch{fail('native_operation_selection_required');}
    if(!Array.isArray(tuple)||tuple.length!==2||!text(tuple[0],128)||!Number.isSafeInteger(tuple[1])||tuple[1]<1
        ||nativeOperationRef({command_id:tuple[0],version:tuple[1]})!==ref)fail('native_operation_selection_required');
    const row=database.prepare('SELECT * FROM savana_collaborative_command_receipts WHERE command_id=? AND version=? AND tenant_id=?').get(...tuple,tenantId);
    if(!row)fail('native_operation_not_found',404);
    const command=JSON.parse(row.command_json);validateNativeCommandModel('AdapterCommand',command);
    if(nativeCommandJson(command.scope)!==nativeCommandJson(scope))fail('native_operation_scope_required',403);
    return {row,command};
};
export const NATIVE_BUSINESS_FIELDS=Object.freeze({
    'customers.manage':Object.freeze([...common.filter(key=>key!=='resource_fingerprint'),'contact_ref','consent_ref','expected_revision','phone','profile_name','label','notes',
        'contact.phone','contact.profile_name','contact.label','contact.notes','contact.revision','contact.state','result.status','result.receipt']),
    'measurement.read':Object.freeze([...common.filter(key=>key!=='resource_fingerprint'),'measurement.total','measurement.sent','measurement.received',
        'measurement.failed','measurement.daily','measurement.types','result.status','result.receipt']),
    'measurement.export':Object.freeze([...common.filter(key=>key!=='resource_fingerprint'),'measurement.total','measurement.sent','measurement.received',
        'measurement.failed','measurement.daily','measurement.types','result.status','result.receipt']),
    'owner.operations':Object.freeze([...common.filter(key=>key!=='resource_fingerprint'),'command_ref','operation.status','operation.counts','operation.receipt','result.status','result.receipt']),
});
export const NATIVE_BUSINESS_LABELS=Object.freeze({phone:'رقم جهة الاتصال',profile_name:'اسم جهة الاتصال',label:'التصنيف',notes:'الملاحظات',
    contact_ref:'جهة الاتصال',consent_ref:'سجل الموافقة على استخدام البيانات',expected_revision:'نسخة بيانات جهة الاتصال',purpose:'غرض استخدام البيانات',evidence_reference:'مرجع العمل',
    'contact.phone':'هاتف جهة الاتصال','contact.profile_name':'اسم جهة الاتصال','contact.label':'التصنيف','contact.notes':'الملاحظات',
    'contact.revision':'نسخة البيانات','contact.state':'حالة جهة الاتصال','measurement.total':'إجمالي الرسائل','measurement.sent':'الرسائل الصادرة',
    'measurement.received':'الرسائل الواردة','measurement.failed':'الرسائل الفاشلة','measurement.daily':'النشاط اليومي','measurement.types':'أنواع الرسائل',
    command_ref:'العملية الأصلية','operation.status':'حالة العملية الأصلية','operation.counts':'عدد النتائج المثبتة','operation.receipt':'مرجع النتيجة الأصلية'});

const payloadFor=(capability,payload,action)=>{
    validateNativeCommandModel('NativeActionPayload',payload);
    if(!NATIVE_BUSINESS_ACTIONS[capability]?.includes(action))fail('native_action_unsupported');
    const p=payload.parameters;const contacts=capability==='customers.manage';
    const keys=contacts?[...common,'contact_ref','consent_ref','expected_revision',...(action==='contacts.create'?['phone','profile_name','label','notes']:action==='contacts.change'?['label','notes']:[])]:capability==='owner.operations'?[...common,'command_ref']:common;
    if(!exact(p,keys)||p.channel!=='native'||p.account_ref!==nativeBusinessAccount(capability)
        ||!['customer_service','business_record','correction'].includes(p.purpose)||!text(p.evidence_reference,1000)
        ||(p.resource_fingerprint!==undefined&&!/^[a-f0-9]{64}$/.test(p.resource_fingerprint)))fail('native_business_parameters_invalid');
    const normalized={...p};
    if(contacts){
        if(action==='contacts.create'){
            if(p.contact_ref!==undefined||p.consent_ref!==undefined||p.expected_revision!==undefined||payload.expected_source_revision!=null)fail('native_contact_create_revision_invalid');
            const contact=contactInput(normalizeContactCreate,p);
            Object.assign(normalized,{phone:contact.phone,...(p.profile_name!==undefined?{profile_name:contact.profileName}:{}),
                ...(p.label!==undefined?{label:contact.label}:{}),...(p.notes!==undefined?{notes:contact.notes}:{})});
        }else{
            contactId(p.contact_ref);
            if(!/^consent:[a-f0-9-]{36}$/.test(p.consent_ref||''))fail('consent_current_record_required',409);
            if(action!=='contacts.read'&&(!Number.isSafeInteger(p.expected_revision)||p.expected_revision<1))fail('native_contact_revision_required');
            if(payload.expected_source_revision!=null&&payload.expected_source_revision!==p.expected_revision)fail('native_contact_revision_conflict',409);
            if(action==='contacts.change')Object.assign(normalized,Object.fromEntries(Object.entries(contactInput(normalizeContactUpdate,p)).filter(([,value])=>value!==undefined)));
        }
    }else if(payload.expected_source_revision!=null)fail('native_measurement_revision_invalid');
    if(capability==='owner.operations'&&(!text(p.command_ref,255)||!p.command_ref.startsWith('native_command:')))fail('native_operation_selection_required');
    const refs=[p.account_ref,p.contact_ref,p.consent_ref,p.command_ref].filter(Boolean);
    if((payload.resource_ref!=null&&!refs.includes(payload.resource_ref))||(payload.resource_refs||[]).some(ref=>!refs.includes(ref)))fail('native_payload_resource_mismatch');
    return {...payload,payload_type:'native_action',parameters:normalized};
};
const contactView=row=>({resource_ref:`native_contact:${row.id}`,phone:row.phone,profile_name:row.profile_name,
    label:row.label,notes:row.notes,source_revision:row.source_revision,state:'current'});

export const createCollaborativeNativeBusinessAdapters=({database,encryption,consents,now=()=>Date.now()})=>{
    if(!database||typeof encryption?.encrypt!=='function'||typeof encryption?.decrypt!=='function'||typeof consents?.current!=='function')throw new TypeError('Native business adapters require owned DB, encryption and scoped evidence');
    const active=tenantId=>{if(!['Active','Warning'].includes(database.prepare('SELECT status FROM tenants WHERE id=?').get(tenantId)?.status))fail('native_account_inactive',403);};
    const schemaReady=()=>Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='savana_native_action_facts'").get())
        && database.prepare('PRAGMA table_info(contacts)').all().some(column=>column.name==='source_revision');
    const assertCurrent=prepared=>{
        active(prepared.tenantId);
        if(prepared.operation){const current=readNativeOperation(database,prepared.tenantId,prepared.scope,prepared.parameters.command_ref);
            if(current.row.command_json!==prepared.operation.row.command_json)fail('native_operation_changed',409);}
        if(prepared.contact){const row=ownedContact(database,prepared.tenantId,prepared.contact.id);
            if(hash(row)!==prepared.contactHash)fail('native_contact_revision_conflict',409);
            const current=consents.current({tenantId:prepared.tenantId,scope:prepared.scope,channel:'native',accountRef:'native_contacts',
                recipientRef:prepared.parameters.contact_ref,purpose:prepared.parameters.purpose,consentRef:prepared.parameters.consent_ref});
            if(current.record.version!==prepared.consentVersion||current.evidenceHash!==prepared.evidenceHash)fail('consent_resource_changed',409);}
        if(prepared.action==='contacts.create'&&database.prepare('SELECT 1 FROM contacts WHERE tenant_id=? AND phone=?').get(prepared.tenantId,prepared.parameters.phone))fail('native_contact_exists',409);
    };
    const decode=fact=>{
        const result=JSON.parse(encryption.decrypt(fact.encrypted_result));
        if(result.fact_id!==fact.id||result.tenant_id!==fact.tenant_id||result.action!==fact.action||result.resource_ref!==fact.resource_ref)fail('native_source_fact_invalid',503);
        return result;
    };
    const receipt=fact=>({accepted:true,native_kind:fact.action.startsWith('contacts.')?'native_contact':fact.action==='owner.operation_status'?'native_operation_snapshot':'native_measurement',native_id:fact.resource_ref,
        fact_id:fact.id,source_revision:fact.source_revision});
    const adapters={};
    for(const capability of Object.keys(NATIVE_BUSINESS_ACTIONS)){
        const adapter={qualified:true,actions:NATIVE_BUSINESS_ACTIONS[capability],fields:NATIVE_BUSINESS_FIELDS[capability],
            resultFields:NATIVE_BUSINESS_FIELDS[capability].filter(field=>field.startsWith('contact.')||field.startsWith('measurement.')||field.startsWith('operation.')),
            resourcePolicies:capability==='customers.manage'?['new_only','selected','activity']:['selected','activity'],
            validatorVersion:'wa-native-business-v1',cancellationSupported:false,
            configured:({tenantId})=>{active(tenantId);return schemaReady();},configurationReason:()=>schemaReady()?null:'native_business_schema_required',validate:(payload,action)=>payloadFor(capability,payload,action),
            readPolicy:({tenantId,parameters})=>{active(tenantId);return {channel:'native',nativeAccountRef:parameters.account_ref};},
            prepare:async({tenantId,scope,parameters,command,preview=false})=>{
                active(tenantId);const action=command.action;const p=clean(parameters);let contact=null;let operation=null;
                if(capability==='customers.manage'&&action!=='contacts.create'){
                    contact=ownedContact(database,tenantId,contactId(p.contact_ref));
                    if(action!=='contacts.read'&&contact.source_revision!==p.expected_revision)fail('native_contact_revision_conflict',409);
                }
                if(capability==='owner.operations')operation=readNativeOperation(database,tenantId,scope,p.command_ref);
                const evidence=contact?consents.current({tenantId,scope,channel:'native',accountRef:'native_contacts',recipientRef:p.contact_ref,purpose:p.purpose,consentRef:p.consent_ref}):null;
                const selection={channel:'native',nativeAccountRef:p.account_ref,recipients:contact?[{ref:p.contact_ref,fingerprint:hash(contact),consent_ref:p.consent_ref,
                    consent_version:evidence.record.version,evidence_hash:evidence.evidenceHash}]:operation?[{ref:p.command_ref,fingerprint:hash(operation.row.command_json)}]:[],
                    contentRef:null};
                const resourceFingerprint=hash({tenantId,scope,action,parameters:p,resources:selection});
                if(!preview&&parameters.resource_fingerprint!==resourceFingerprint)fail('native_resource_preview_changed',409);
                const prepared={tenantId,scope,action,parameters:{...p,resource_fingerprint:resourceFingerprint},resourceFingerprint,resourceSelection:selection,
                    account:{ref:p.account_ref,label:capability==='customers.manage'?'جهات الاتصال':capability==='owner.operations'?'نتائج العمليات الأصلية':'نشاط رسائل WhatsApp المحلي'},contact,contactHash:contact?hash(contact):null,operation,
                    consentVersion:evidence?.record.version,evidenceHash:evidence?.evidenceHash,
                    quote:{total_credits:0,within_budget:true,currency_label:'بدون إرسال خارجي'}};
                assertCurrent(prepared);return prepared;
            },
            execute:async({command,tenantId,scope,prepared,effect})=>{
                const key=prepared.parameters.contact_ref||prepared.parameters.command_ref||prepared.parameters.account_ref;
                return effect({key,kind:capability==='customers.manage'?'native_contact':capability==='owner.operations'?'native_operation_snapshot':'native_measurement',run:({idempotencyKey,assertEffectLease})=>{
                    try {return database.transaction(()=>{
                    const requestHash=hash(command);const old=database.prepare('SELECT * FROM savana_native_action_facts WHERE native_idempotency_key=?').get(idempotencyKey);
                    if(old){if(old.tenant_id!==tenantId||old.request_sha256!==requestHash)fail('native_source_fact_conflict',409);decode(old);return receipt(old);}
                    assertEffectLease();assertCurrent(prepared);let data;let ref;let revision=null;const p=prepared.parameters;
                    if(capability==='customers.manage'){
                        let row;
                        if(command.action==='contacts.create')row=createNativeContact(database,{tenantId,body:p});
                        else if(command.action==='contacts.change')row=changeNativeContact(database,{tenantId,contactId:contactId(p.contact_ref),body:p,expectedRevision:p.expected_revision});
                        else if(command.action==='contacts.remove')row=removeNativeContact(database,{tenantId,contactId:contactId(p.contact_ref),expectedRevision:p.expected_revision});
                        else row=readNativeContact(database,tenantId,contactId(p.contact_ref));
                        data=contactView(row);if(command.action==='contacts.remove'){data.state='removed';data.source_revision++;}
                        ref=data.resource_ref;revision=data.source_revision;
                    }else if(capability==='owner.operations'){
                        const current=readNativeOperation(database,tenantId,scope,p.command_ref);const result=current.row.receipt_json?JSON.parse(current.row.receipt_json):null;
                        const counts=Object.fromEntries(database.prepare('SELECT state,COUNT(*) count FROM savana_collaborative_effects WHERE execution_id=? GROUP BY state').all(current.row.execution_id).map(row=>[row.state,row.count]));
                        data={state:current.row.state,counts,receipt:result?.source_result?.result_reference||null,command_ref:p.command_ref};ref=`native_operation_snapshot:${crypto.randomUUID()}`;
                    }else{data=readNativeMessageAnalytics({database,tenantId});ref=`native_measurement:${crypto.randomUUID()}`;}
                    const id=crypto.randomUUID();const result={fact_id:id,tenant_id:tenantId,action:command.action,resource_ref:ref,data};
                    const fact={id,tenant_id:tenantId,action:command.action,resource_ref:ref,source_revision:revision};
                    database.prepare(`INSERT INTO savana_native_action_facts(id,tenant_id,native_idempotency_key,request_sha256,action,resource_ref,source_revision,scope_json,encrypted_result,created_at)
                        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,tenantId,idempotencyKey,requestHash,command.action,ref,revision,nativeCommandJson(scope),encryption.encrypt(nativeCommandJson(result)),new Date(now()).toISOString());
                    return receipt(fact);
                    }).immediate();}catch(error){
                        if(database.prepare('SELECT 1 FROM savana_native_action_facts WHERE native_idempotency_key=?').get(idempotencyKey))error.deliveryUncertain=true;
                        else error.dispatched=false;
                        throw error;
                    }
                }});
            },
            reconcile:async({tenantId,command,effect})=>{
                const fact=database.prepare('SELECT * FROM savana_native_action_facts WHERE native_idempotency_key=? AND tenant_id=?').get(effect.native_idempotency_key,tenantId);
                if(!fact||fact.request_sha256!==hash(command))return {definitive:false};decode(fact);
                return {definitive:true,state:'accepted',receipt:receipt(fact)};
            },
            projectResult:({tenantId,command,effects,viewer})=>{
                const fields=new Set(viewer.allowedFields||[]);const refs=new Set(viewer.resourceRefs||[]);
                const records=[];
                for(const effect of effects){
                    const fact=database.prepare('SELECT * FROM savana_native_action_facts WHERE native_idempotency_key=? AND tenant_id=?').get(effect.native_idempotency_key,tenantId);
                    if(!fact||fact.request_sha256!==hash(command))continue;
                    const stored=decode(fact);const output={};
                    if(capability==='customers.manage'){
                        if(viewer.resourcePolicy==='selected'&&!refs.has(fact.resource_ref))continue;
                        const parameters=command.payload.parameters;
                        consents.current({tenantId,scope:command.scope,channel:'native',accountRef:'native_contacts',recipientRef:fact.resource_ref,
                            purpose:parameters.purpose,consentRef:parameters.consent_ref});
                        for(const [field,key]of [['contact.phone','phone'],['contact.profile_name','profile_name'],['contact.label','label'],['contact.notes','notes'],['contact.revision','source_revision'],['contact.state','state']]){
                            if(fields.has(field))output[key]=stored.data[key];
                        }
                    }else if(capability==='owner.operations'){
                        if(viewer.resourcePolicy==='new_only')fail('native_result_resource_scope_required',403);
                        if(viewer.resourcePolicy==='selected'&&!refs.has(stored.data.command_ref))continue;
                        for(const [field,key]of [['operation.status','state'],['operation.counts','counts'],['operation.receipt','receipt']])if(fields.has(field))output[key]=stored.data[key];
                    }else for(const [field,key]of [['measurement.total','totalMessages'],['measurement.sent','sentMessages'],['measurement.received','receivedMessages'],['measurement.failed','failedMessages'],['measurement.daily','dailyBreakdown'],['measurement.types','typeDistribution']]){
                        if(fields.has(field))output[key]=stored.data[key];
                    }
                    if(Object.keys(output).length)records.push(output);
                }
                return {records};
            }};
        adapters[`${capability}:native`]=adapter;
    }
    return adapters;
};
