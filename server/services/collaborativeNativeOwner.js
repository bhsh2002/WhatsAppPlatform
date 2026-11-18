import { createSqliteReadPrincipalVerifier } from './centralProductRead.js';
import { CollaborativeExecutionError } from './collaborativeExecution.js';
import { listCollaborativeAccounts, listCollaborativeRecipients, resolveCollaborativeAccount } from './collaborativeNativeResources.js';
import { NATIVE_PURPOSES, loadCollaborativeTemplate, loadCollaborativeContent, validateCollaborativePayload } from './collaborativeNativeAdapters.js';
import {nativeCommandJson} from './nativeCommandProtocol.js';
import {NATIVE_REVIEW_CAPABILITIES} from './collaborativeNativeReviews.js';

const fail = (code, status = 422) => { throw new CollaborativeExecutionError(code, status); };
const labels = { sms: 'SMS', whatsapp: 'WhatsApp', messenger: 'Messenger', facebook: 'Facebook' };
const actions = ['messaging.send', 'campaigns.execute', 'content.publish',...Object.keys(NATIVE_REVIEW_CAPABILITIES)];
const messages = {
    native_account_inactive: ['الحساب المحدد غير مفعّل حاليًا.', 'open_provider'],
    native_account_not_owned: ['اختر حسابًا متاحًا لهذا النشاط.', 'select_account'],
    native_channel_unavailable: ['قناة التنفيذ هذه غير مكتملة الإعداد.', 'open_provider'],
    native_provider_configuration_required: ['أكمل إعداد القناة المحددة.', 'open_provider'],
    native_provider_evidence_configuration_required: ['يلزم إكمال ربط إشعارات المزوّد للتحقق من نتيجة التنفيذ بأمان.', 'open_provider'],
    native_messenger_echo_subscription_required: ['فعّل إشعارات الرسائل الصادرة للصفحة من إعداد الربط حتى يمكن التحقق من النتيجة.', 'open_provider'],
    native_previous_outcome_unresolved: ['توجد عملية لهذا الحساب لم تُحسم نتيجتها. راجع النتيجة الأصلية قبل تنفيذ عملية أخرى من النوع نفسه.', 'review_results'],
    native_quote_unavailable: ['تعذر تأكيد تكلفة التنفيذ الحالية.', 'confirm_quote'],
    native_approved_budget_insufficient: ['الرصيد أو الحد الذي حددته لا يغطي التكلفة الحالية.', 'confirm_quote'],
    consent_current_record_required: ['يلزم سجل موافقة سارٍ لهذا المستلم والغرض.', 'record_consent'],
    consent_resource_changed: ['تغيرت بيانات المستلم أو الحساب. راجع الموافقة من جديد.', 'record_consent'],
    native_template_not_approved: ['اختر قالبًا معتمدًا حاليًا.', 'select_content'],
    native_content_not_approved: ['اختر محتوى معتمدًا حاليًا.', 'select_content'],
    native_contact_revision_conflict:['تغيرت بيانات جهة الاتصال منذ اختيارها. حدّث البيانات وراجع التغيير من جديد.','refresh'],
    native_contact_not_found:['جهة الاتصال لم تعد متاحة ضمن هذا الحساب. حدّث الاختيارات.','refresh'],
    native_business_schema_required:['تعذر تأكيد جاهزية سجل الحساب الحالي. حدّث الصفحة قبل المتابعة.','refresh'],
    native_contact_parameters_invalid:['تحقق من رقم الهاتف وبيانات جهة الاتصال المقترحة.','edit_content'],
    native_media_revision_conflict:['تغيرت بيانات الملف أو الحساب. حدّث الاختيارات وراجع الملف من جديد.','refresh'],
    native_media_upload_unresolved:['نتيجة محاولة رفع الملف لم تُحسم. راجع المحاولة الأصلية قبل أي رفع جديد.','review_results'],
    native_media_already_uploaded:['هذا الملف مرفوع بالفعل. اختر عرض حالة الملف المرفوع.','inspect_media'],
    native_media_rights_expired:['انتهت صلاحية سجل حق استخدام الملف. جهّز ملفًا بسجل حق سارٍ قبل المراجعة.','prepare_media'],
    native_media_receipt_required:['لم يُؤكد رفع هذا الملف بعد. راجع إجراء الرفع قبل عرض حالته.','review_results'],
    native_media_metadata_unverified:['تعذر تأكيد حالة الملف لدى القناة. راجع ربط الحساب ثم افحص المحاولة الأصلية.','open_provider'],
    native_media_content_invalid:['نوع الملف أو محتواه غير مدعوم. اختر ملفًا من الأنواع المتاحة.','prepare_media'],
    native_template_values_required: ['أكمل قيم حقول القالب المحدد.', 'edit_content'],
    OUTSIDE_WINDOW: ['انتهت نافذة الرد. استخدم قالبًا معتمدًا أو انتظر طلبًا جديدًا.', 'select_content'],
};
const ownerHref = capability => `/portal/integrations?workspace=shared&action=${encodeURIComponent(capability)}`;
export const collaborativeBlocker = (code, capability = 'messaging.send') => {
    const [message, action] = messages[code] || ['يلزم تحديث الاختيارات وإكمال المتطلبات الحالية قبل المراجعة.', 'refresh'];
    const state = /revision_conflict|preview_changed/.test(code)?'authorization_stale':/outcome_unresolved|upload_unresolved/.test(code) ? 'outcome_unknown'
        : /rights_expired|consent|OUTSIDE_WINDOW/.test(code) ? 'consent_required':/media_already_uploaded/.test(code)?'resource_scope_required'
            :/media_content_invalid/.test(code)?'not_supported':/media_metadata_unverified/.test(code)?'provider_unavailable'
        : /budget_insufficient/.test(code) ? 'balance_required' : /quote/.test(code) ? 'quote_required'
            : /account_not_owned|selection_required/.test(code) ? 'provider_selection_required'
                : /scope|delegation/.test(code) ? 'resource_scope_required'
                    : /template|content/.test(code) ? 'approval_required' : 'configuration_required';
    return { state, reason_code: Object.hasOwn(messages, code) ? code : 'native_requirements_unmet',
        message, next_action: { code: action, label: action === 'record_consent' ? 'مراجعة الموافقات' : 'استكمال المتطلبات',
            href: state === 'balance_required' ? '/portal/billing' : ownerHref(capability) } };
};
export class CollaborativeNativeOwnerService {
    constructor({ database, nativeAdapters, consents, verifyOwnerContext,
        verifyLocalPrincipal = createSqliteReadPrincipalVerifier(database), now = () => Date.now() }) {
        if (!database || !nativeAdapters || !consents || typeof verifyOwnerContext !== 'function') throw new TypeError('Native owner choices require actual current owner context');
        this.db = database; this.adapters = nativeAdapters; this.consents = consents;
        this.verifyOwner = verifyOwnerContext; this.verifyLocal = verifyLocalPrincipal; this.now = now;
    }
    async owner(principal, activityRef, action, capabilityId,resourceSelection=null) {
        if (this.verifyLocal(principal) !== true || typeof activityRef !== 'string' || !activityRef) fail('native_owner_session_required', 403);
        const context = await this.verifyOwner({ principal, activityRef, action,capabilityId,...(resourceSelection?{resourceSelection}:{}) });
        if (this.verifyLocal(principal) !== true || context?.verified !== true || context.localPolicyVerified !== true
            || Number(context.nativeTenantId) !== principal.tenantId || context.nativeUserId!==principal.userId || !context.viewer?.scope?.organization_id
            || !context.viewer.scope.activity_id || !context.viewer.actorId
            || !Number.isFinite(Date.parse(context.viewer.validUntil)) || Date.parse(context.viewer.validUntil) <= this.now()
            || !Array.isArray(context.viewer.allowedFields)||!['selected','new_only','activity'].includes(context.viewer.resourcePolicy)
            ||!Array.isArray(context.viewer.resourceRefs)) fail('native_owner_authority_unverified', 403);
        return context;
    }
    allows(context,refs) {return context.viewer.resourcePolicy!=='selected'||refs.filter(Boolean).every(ref=>context.viewer.resourceRefs.includes(ref));}
    async fresh(principal,activityRef,action,capability,old,resourceSelection=null){const current=await this.owner(principal,activityRef,action,capability,resourceSelection);
        const snapshot=c=>nativeCommandJson({actor:c.viewer.actorId,scope:c.viewer.scope,fields:c.viewer.allowedFields,policy:c.viewer.resourcePolicy,refs:c.viewer.resourceRefs});
        if(snapshot(current)!==snapshot(old))fail('native_owner_authority_changed',403);return current;}
    summary(prepared,capability){
        const p=prepared.parameters;const label=capability==='messaging.review'?'حفظ طلب مراجعة للرسالة':capability==='campaigns.review'?'حفظ طلب مراجعة للحملة'
            :capability==='content.review'?'حفظ طلب مراجعة للمحتوى':capability==='messaging.send'?'إرسال رسالة':capability==='campaigns.execute'?'تنفيذ الحملة':'نشر المحتوى';
        const rows=[{label:'العملية',value:label},{label:'الحساب',value:prepared.account.label}];
        if(p.purpose)rows.push({label:'الغرض',value:NATIVE_PURPOSES.find(row=>row.value===p.purpose)?.label||'الغرض المحدد'});
        for(const selected of prepared.selections||[]){
            rows.push({label:'المستلم',value:selected.label});
            const evidence=this.consents.current({tenantId:prepared.tenantId,scope:prepared.scope,channel:p.channel,accountRef:p.account_ref,
                recipientRef:selected.ref,purpose:p.purpose,consentRef:selected.consent_ref}).record;
            rows.push({label:'دليل الموافقة',value:evidence.label},{label:'مصدر الدليل',value:evidence.source_label},{label:'صلاحية الموافقة',value:evidence.valid_until});
        }
        if(p.message)rows.push({label:'نص الرسالة',value:p.message});
        if(prepared.template){rows.push({label:'القالب',value:prepared.template.name},{label:'نص القالب',value:prepared.template.body});
            for(const [index,value]of (p.template_values||[]).entries())rows.push({label:`قيمة الحقل ${index+1}`,value});}
        if(prepared.content)rows.push({label:'المحتوى',value:prepared.content.title},{label:'نص المنشور',value:prepared.content.body},
            ...(prepared.content.link_url?[{label:'الرابط',value:prepared.content.link_url}]:[]),...(prepared.content.media_url?[{label:'الوسائط المعتمدة',value:prepared.content.media_url}]:[]));
        rows.push({label:'التكلفة الحالية للعملية المقترحة',value:`${prepared.quote.total_credits} رصيد`},{label:'الحد الأقصى الذي اخترته',value:`${p.max_cost_credits} رصيد`});
        return rows;
    }
    stamp(context) { return { checked_at: new Date(this.now()).toISOString(),
        valid_until: new Date(Math.min(this.now() + 30000, Date.parse(context.viewer.validUntil))).toISOString() }; }
    outcomeHold(tenantId, capability) {
        const family = Object.hasOwn(NATIVE_REVIEW_CAPABILITIES,capability) ? [capability]
            : capability === 'content.publish' ? ['content.publish'] : ['messaging.send','campaigns.execute'];
        return Boolean(this.db.prepare(`SELECT 1 FROM savana_collaborative_executions WHERE tenant_id=? AND state='unknown'
            AND capability_code IN (${family.map(() => '?').join(',')}) LIMIT 1`).get(tenantId,...family));
    }
    async options(principal, { activity_ref: activityRef, capability,channel = null, account_ref: accountRef = null,
        recipient_q: recipientQuery = '', recipient_cursor: recipientCursor = null } = {}) {
        if(!actions.includes(capability))fail('native_capability_selection_required');
        const context = await this.owner(principal, activityRef, 'collaborative.options',capability);
        if(!['channel','account_ref'].every(field=>context.viewer.allowedFields.includes(field)))fail('native_parameter_delegation_required',403);
        if (channel != null && !Object.hasOwn(labels, channel)) fail('native_channel_unsupported');
        const channels = Object.keys(labels).map(value => ({ value, label: labels[value],
            available: Object.keys(this.adapters).some(key => key.endsWith(`:${value}`)),
            reason_code: Object.keys(this.adapters).some(key => key.endsWith(`:${value}`)) ? null : 'native_channel_unavailable',
            reason: Object.keys(this.adapters).some(key => key.endsWith(`:${value}`)) ? null : 'إعداد هذه القناة غير مكتمل.' }));
        const accounts = (channel ? [channel] : Object.keys(labels)).flatMap(value => listCollaborativeAccounts(this.db, principal.tenantId, value))
            .filter(account=>this.allows(context,[account.value]))
            .map(account => ({ ...account, reason: account.available ? null : 'الحساب غير مفعّل حاليًا.' }));
        let recipients = []; let templates = []; let contents = []; let evidence = []; let nextCursor = null;
        if (accountRef) {
            if (!channel) fail('native_channel_selection_required');
            if(!this.allows(context,[accountRef]))fail('native_resource_delegation_required',403);
            const account = resolveCollaborativeAccount(this.db, principal.tenantId, channel, accountRef);
            if (channel !== 'facebook') {
                const page = listCollaborativeRecipients(this.db, principal.tenantId, account,
                    { limit: 101, q: recipientQuery, cursor: recipientCursor });
                if (page.length > 100) nextCursor = page[99].value;
                recipients = page.slice(0, 100).filter(recipient=>this.allows(context,[recipient.value])).map(recipient => ({ ...recipient,
                    available: true, reason_code: null, reason: null, purposes: [] }));
                const rows = this.db.prepare(`SELECT * FROM savana_collaborative_consents WHERE tenant_id = ? AND organization_id = ?
                    AND activity_id = ? AND channel = ? AND account_ref = ? ORDER BY created_at DESC LIMIT 1000`)
                    .all(principal.tenantId, context.viewer.scope.organization_id, context.viewer.scope.activity_id, channel, accountRef);
                evidence = rows.filter(row=>this.allows(context,[row.recipient_ref,`consent:${row.id}`])).map(row => {
                    const record = this.consents.publicRecord(row); let available = false;
                    try { this.consents.current({ tenantId: principal.tenantId, scope: context.viewer.scope, channel,
                        accountRef, recipientRef: row.recipient_ref, purpose: row.purpose, consentRef: record.value }); available = true; } catch { /* Explicitly disabled below. */ }
                    return { ...record, available, reason_code: available ? null : 'consent_current_record_required',
                        reason: available ? null : 'السجل منتهي أو ملغى أو تغيرت البيانات المرتبطة به.' };
                });
                for (const recipient of recipients) recipient.purposes = NATIVE_PURPOSES.map(purpose => {
                    const record = evidence.find(row => row.recipient_ref === recipient.value && row.purpose === purpose.value && row.available);
                    return { ...purpose, consent_ref: record?.value || null, consent_version: record?.version || null,
                        valid_until: record?.valid_until || null, available: Boolean(record),
                        reason_code: record ? null : 'consent_current_record_required', reason: record ? null : 'يلزم سجل موافقة سارٍ لهذا الغرض.' };
                });
            }
            if (channel === 'whatsapp') templates = this.db.prepare(`SELECT id FROM templates WHERE tenant_id = ? AND status = 'approved' ORDER BY name,id LIMIT 100`)
                .all(principal.tenantId).flatMap(row => {
                    try { const template = loadCollaborativeTemplate(this.db, principal.tenantId, `native_template:${row.id}`);
                        if(!this.allows(context,[`native_template:${row.id}`]))return [];
                        const keys = [...template.body.matchAll(/\{\{([0-9]+)\}\}/g)].map(match => Number(match[1]));
                        return [{ value: `native_template:${row.id}`, label: template.name, language: template.language,
                            body_preview: template.body.slice(0, 2000), fields: [...new Set(keys)].sort((a, b) => a - b)
                                .map(key => ({ key: String(key), label: `الحقل ${key}` })), available: true, reason_code: null, reason: null }];
                    } catch { return []; }
                });
            if (channel === 'facebook') contents = this.db.prepare(`SELECT id,title,body,updated_at FROM facebook_content_items
                WHERE tenant_id = ? AND status = 'approved' AND (linked_page_id IS NULL OR linked_page_id = ?)
                ORDER BY id DESC LIMIT 100`).all(principal.tenantId, account.row.id).flatMap(row => {
                    try { if(!this.allows(context,[`native_content:${row.id}`]))return [];loadCollaborativeContent(this.db, principal.tenantId, account, `native_content:${row.id}`);
                        return [{ value: `native_content:${row.id}`, label: row.title, preview: row.body.slice(0, 2000),
                            source_revision: row.updated_at, available: true, reason_code: null, reason: null }]; }
                    catch { return []; }
                });
        }
        if (this.verifyLocal(principal) !== true || Date.parse(context.viewer.validUntil) <= this.now()) fail('native_owner_authority_unverified', 403);
        return { ...this.stamp(context), channels, accounts, recipients, recipients_next_cursor: nextCursor, templates, contents,
            consent_management:{can_record:context.canManageConsent===true,can_revoke:context.canManageConsent===true},
            purposes: NATIVE_PURPOSES, consent_evidence: evidence,
            capabilities: [capability].map(action => ({ action, availability: this.outcomeHold(principal.tenantId,action)
                ? collaborativeBlocker('native_previous_outcome_unresolved',action) : !channel || !accountRef
                ? { state: 'provider_selection_required', reason_code: 'account_selection_required', message: 'اختر القناة والحساب ثم راجع المتطلبات الحالية.',
                    next_action: { code: 'select_account', label: 'اختيار الحساب', href: ownerHref(action) } }
                : this.adapters[`${action}:${channel}`] ? { state: 'approval_required', reason_code: 'preview_required', message: 'أكمل التفاصيل وافحص المعاينة قبل المراجعة.',
                    next_action: { code: 'preview', label: 'معاينة التفاصيل', href: ownerHref(action) } }
                    : collaborativeBlocker('native_channel_unavailable', action) })) };
    }
    async preview(principal, { activity_ref: activityRef, capability, action, parameters } = {}) {
        const context = await this.owner(principal, activityRef, 'collaborative.preview',capability);
        const validationCapability=NATIVE_REVIEW_CAPABILITIES[capability]||capability;
        if(action!==capability)fail('native_action_unsupported');
        const payload = validateCollaborativePayload(validationCapability, { payload_type: 'native_action', parameters },validationCapability);
        const used=Object.keys(payload.parameters).filter(field=>field!=='resource_fingerprint');
        if(used.some(field=>!context.viewer.allowedFields.includes(field))||!this.allows(context,[parameters.account_ref,parameters.recipient_ref,parameters.consent_ref,parameters.template_ref,parameters.content_ref,
            ...(parameters.recipients||[]).flatMap(row=>[row.recipient_ref,row.consent_ref])]))fail('native_parameter_delegation_required',403);
        const normalized = { ...payload.parameters }; delete normalized.resource_fingerprint;
        const base = { ...this.stamp(context), normalized_parameters: normalized, resource_fingerprint: null,
            quote: { total_credits: null, within_budget: null, currency_label: 'رصيد' } };
        if (this.outcomeHold(principal.tenantId,capability)) return { ...base, availability: collaborativeBlocker('native_previous_outcome_unresolved',capability) };
        try {
            const adapter = this.adapters[`${capability}:${parameters.channel}`];
            if (!adapter) fail('native_channel_unavailable');
            if (await adapter.configured({ tenantId: principal.tenantId, parameters }) !== true) {
                fail(adapter.configurationReason?.({ tenantId: principal.tenantId, parameters }) || 'native_provider_configuration_required');
            }
            const prepared = await adapter.prepare({ tenantId: principal.tenantId, scope: context.viewer.scope,
                parameters: normalized, preview: true, command: { capability, action, payload } });
            await this.fresh(principal,activityRef,'collaborative.preview',capability,context);
            const latest=await adapter.prepare({tenantId:principal.tenantId,scope:context.viewer.scope,parameters:normalized,preview:true,command:{capability,action,payload}});
            if(latest.resourceFingerprint!==prepared.resourceFingerprint)fail('native_resource_preview_changed',409);
            if (this.verifyLocal(principal) !== true || Date.parse(context.viewer.validUntil) <= this.now()) fail('native_owner_authority_unverified', 403);
            return { ...base, resource_fingerprint: prepared.resourceFingerprint, quote: prepared.quote,
                summary: this.summary(latest,capability),
                availability: { state: 'review_available', reason_code: 'native_review_ready', message: 'التفاصيل الحالية جاهزة للمراجعة. يلزم اعتماد الأمر قبل التنفيذ.',
                    next_action: { code: 'request_review', label: 'مراجعة التفاصيل', href: ownerHref(capability) } } };
        } catch (error) {
            if (error.status === 403 && error.code?.startsWith('native_owner_')) throw error;
            await this.fresh(principal,activityRef,'collaborative.preview',capability,context);
            return { ...base, ...(error.nativeQuote ? { quote: error.nativeQuote } : {}), availability: collaborativeBlocker(error.code, capability) };
        }
    }
    async listConsents(principal, input) {
        const selected=this.consents.selection(principal.tenantId,{...input,purpose:input.purpose||(input.channel==='native'?'customer_service':'service_response')});
        const selection={channel:input.channel,accountRef:selected.account.ref,recipientRef:selected.recipient.ref,accountFingerprint:selected.account.fingerprint,
            recipientFingerprint:selected.recipient.fingerprint,purpose:input.purpose||(input.channel==='native'?'customer_service':'service_response')};
        const context = await this.owner(principal, input?.activity_ref, 'consent.read','customers.manage',selection);
        const records = await this.consents.list(principal, input);
        const fresh=await this.fresh(principal,input.activity_ref,'consent.read','customers.manage',context,selection);
        return { ...this.stamp(fresh), records };
    }
    recordConsent(principal, input) { return this.consents.record(principal, input); }
    lookupConsent(principal,input) {return this.consents.lookup(principal,input);}
    revokeConsent(principal, ref, input) { return this.consents.revoke(principal, ref, input); }
}
