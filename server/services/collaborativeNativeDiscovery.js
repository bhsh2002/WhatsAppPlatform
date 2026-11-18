import { validateNativeCommandModel } from './nativeCommandModels.js';
import { CollaborativeExecutionError, COLLABORATIVE_CAPABILITIES } from './collaborativeExecution.js';
import { listCollaborativeAccounts, listCollaborativeRecipients, resolveCollaborativeAccount } from './collaborativeNativeResources.js';
import { loadCollaborativeTemplate, loadCollaborativeContent } from './collaborativeNativeAdapters.js';
import {NATIVE_BUSINESS_FIELDS,NATIVE_BUSINESS_LABELS,nativeBusinessAccount,nativeOperationRef,readNativeOperation} from './collaborativeNativeBusiness.js';
import {NATIVE_REVIEW_CAPABILITIES} from './collaborativeNativeReviews.js';
import {NATIVE_MEDIA_FIELDS} from './collaborativeNativeMedia.js';
import {nativeCommandJson} from './nativeCommandProtocol.js';

const fields = Object.freeze({
    channel: 'القناة', account_ref: 'حساب التنفيذ', recipient_ref: 'المستلم', consent_ref: 'سجل الموافقة',
    purpose: 'غرض التواصل', message: 'نص الرسالة', template_ref: 'القالب المعتمد', template_values: 'حقول القالب',
    recipients: 'مستلمو الحملة وموافقاتهم', content_ref: 'المحتوى المعتمد', max_cost_credits: 'الحد الأقصى للتكلفة',
    'result.status': 'حالة العملية', 'result.receipt': 'مرجع النتيجة الموثقة',
    'consent.purpose':'غرض استخدام البيانات المصرح به','consent.evidence':'دليل الموافقة ومصدره','consent.valid_until':'مدة صلاحية الموافقة',
    asset_ref:'الملف المحدد','asset.file':'ملف يرفعه النشاط','asset.purpose':'غرض استخدام الملف','asset.provenance':'سجل حق استخدام الملف',
    'media.filename':'اسم الملف','media.mime_type':'نوع الملف','media.byte_size':'حجم الملف','media.state':'حالة الملف','media.receipt':'مرجع الرفع المثبت',
});
export const COLLABORATIVE_NATIVE_FIELDS = Object.freeze({
    'messaging.send': Object.freeze(['channel', 'account_ref', 'recipient_ref', 'consent_ref', 'purpose', 'message', 'template_ref', 'template_values', 'max_cost_credits']),
    'campaigns.execute': Object.freeze(['channel', 'account_ref', 'recipients', 'purpose', 'template_ref', 'template_values', 'max_cost_credits']),
    'content.publish': Object.freeze(['channel', 'account_ref', 'content_ref', 'max_cost_credits']),
});
const fail = (code, status = 403) => { throw new CollaborativeExecutionError(code, status); };
const trustedOwnerAction = (ownerActions, capability) => {
    const action = ownerActions[capability];
    if (action?.registered !== true || action.contractVersion !== '1.0' || typeof action.path !== 'string') return null;
    try {
        const url = new URL(action.path, 'https://native.invalid');
        return action.path.startsWith('/') && !action.path.startsWith('//') && url.origin === 'https://native.invalid'
            && url.pathname === '/portal/integrations' && url.searchParams.get('workspace') === 'shared'
            && url.searchParams.get('action') === capability && !url.hash ? action.path : null;
    } catch { return null; }
};

export const createCollaborativeNativeDiscovery = ({ database, nativeAdapters, consents, getNativeAuthority,
    loadSubscriptionFacts, ownerActions = {}, now = () => Date.now() }) => {
    if (!database || !nativeAdapters || typeof consents?.current !== 'function' || typeof getNativeAuthority !== 'function' || typeof loadSubscriptionFacts !== 'function') {
        throw new TypeError('Native discovery requires current source owner, configured handlers and actual subscription facts');
    }
    const identity = async context => {
        if (!context || !/^wa_savana:tenant:[1-9][0-9]*$/.test(context.external_tenant_id || '')
            || typeof context.organization_id !== 'string' || !context.organization_id
            || typeof context.activity_id !== 'string' || !context.activity_id || typeof context.actor_id !== 'string' || !context.actor_id) fail('native_discovery_context_invalid');
        const tenantId = Number(context.external_tenant_id.slice('wa_savana:tenant:'.length));
        if (!Number.isSafeInteger(tenantId)) fail('native_discovery_context_invalid');
        const scope = { organization_id: context.organization_id, activity_id: context.activity_id,
            branch_id: context.branch_id || null, warehouse_id: context.warehouse_id || null };
        const approver = context.grant_approved_by || context.actor_id;
        const delegated=approver!==context.actor_id;
        if(delegated&&(!context.native_authority_revision||typeof context.authorization_revision!=='string'||!context.authorization_revision
            ||!Number.isSafeInteger(context.capability_grant_revision)||context.capability_grant_revision<1
            ||!Array.isArray(context.allowed_fields)||context.allowed_fields.length>100||context.allowed_fields.some(field=>typeof field!=='string'||!field)
            ||!['new_only','selected','activity'].includes(context.resource_policy)||!Array.isArray(context.resource_refs)
            ||context.resource_refs.length>500||context.resource_refs.some(ref=>typeof ref!=='string'||!ref)))fail('native_discovery_delegation_required');
        const authority = await getNativeAuthority({ nativeTenantId: tenantId, scope, grantApprovedBy: approver, action: 'discovery' });
        if (!authority?.verified || authority.nativeTenantId !== tenantId || authority.grantApprovedBy !== approver
            || typeof authority.nativeAuthorityRevision !== 'string' || !authority.nativeAuthorityRevision
            || !Number.isFinite(Date.parse(authority.validUntil)) || Date.parse(authority.validUntil) <= now()
            || (context.native_authority_revision && context.native_authority_revision !== authority.nativeAuthorityRevision)) fail('native_discovery_owner_unverified');
        const tenant = database.prepare('SELECT id,name,status FROM tenants WHERE id=?').get(tenantId);
        if (!['Active', 'Warning'].includes(tenant?.status)) fail('native_account_inactive');
        return { tenant, tenantId, scope, authority,delegated };
    };
    const registered = adapter => adapter?.qualified === true && ['validate', 'prepare', 'execute', 'reconcile', 'configured'].every(key => typeof adapter[key] === 'function');
    return {
        discovery: async context => {
            const { tenant, tenantId, scope, authority,delegated } = await identity(context);
            let subscription;
            try { subscription = await loadSubscriptionFacts({ nativeTenantId: tenantId, organizationId: context.organization_id }); }
            catch { subscription = null; }
            const subscribed = subscription?.verified === true && subscription.bound === true && subscription.entitled === true
                && Number.isFinite(Date.parse(subscription.validUntil)) && Date.parse(subscription.validUntil) > now();
            const capabilities = [];
            for (const cap of COLLABORATIVE_CAPABILITIES) {
                const resources = []; const actions = new Set(); let configured = false; let handler = false;
                const ownerPath = trustedOwnerAction(ownerActions, cap.capability_code);
                for (const [key, adapter] of Object.entries(nativeAdapters)) {
                    if (!key.startsWith(`${cap.capability_code}:`) || !registered(adapter)) continue;
                    handler = true; const channel = key.slice(cap.capability_code.length + 1);
                    for (const action of adapter.actions || [cap.capability_code]) actions.add(action);
                    if(channel === 'native') {
                        if(await adapter.configured({tenantId,parameters:{}}) === true) {
                            configured=true; const contacts=cap.capability_code==='customers.manage';
                            resources.push({resource_ref:nativeBusinessAccount(cap.capability_code),label:contacts?'جهات الاتصال':cap.capability_code==='owner.operations'?'نتائج العمليات الأصلية':'نشاط رسائل WhatsApp المحلي',resource_kind:'account',scope});
                            if(cap.capability_code==='owner.operations')for(const row of database.prepare('SELECT command_id,version FROM savana_collaborative_command_receipts WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100').all(tenantId)){
                                const ref=nativeOperationRef(row);if(ref.length>255)continue;
                                try{readNativeOperation(database,tenantId,scope,ref);resources.push({resource_ref:ref,label:'نتيجة عملية أصلية',resource_kind:'operation',scope});}catch{/* Other activities are not delegable in this scope. */}
                            }
                            if(contacts) for(const contact of database.prepare('SELECT id,profile_name FROM contacts WHERE tenant_id=? ORDER BY id LIMIT 100').all(tenantId)) {
                                resources.push({resource_ref:`native_contact:${contact.id}`,label:(contact.profile_name||'جهة اتصال').slice(0,255),resource_kind:'contact',scope});
                            }
                            if(contacts)for(const record of database.prepare(`SELECT id,recipient_ref,purpose FROM savana_collaborative_consents WHERE tenant_id=?
                                AND organization_id=? AND activity_id=? AND channel='native' AND account_ref='native_contacts' AND revoked_at IS NULL AND valid_until>?
                                ORDER BY created_at DESC LIMIT 300`).all(tenantId,scope.organization_id,scope.activity_id,new Date(now()).toISOString())){
                                try{const evidence=consents.current({tenantId,scope,channel:'native',accountRef:'native_contacts',recipientRef:record.recipient_ref,
                                    purpose:record.purpose,consentRef:`consent:${record.id}`});resources.push({resource_ref:evidence.record.value,label:evidence.record.label,resource_kind:'consent',scope});}
                                catch{/* Only current exact contact/purpose evidence is delegable. */}
                            }
                        }
                        continue;
                    }
                    for (const choice of listCollaborativeAccounts(database, tenantId, channel)) {
                        if (!choice.available || await adapter.configured({ tenantId, parameters: { account_ref: choice.value } }) !== true) continue;
                        configured = true;
                        resources.push({ resource_ref: choice.value, label: `${choice.label} (${channel})`, resource_kind: 'account', scope });
                        if(cap.capability_code==='media.manage'){
                            const account=resolveCollaborativeAccount(database,tenantId,channel,choice.value);
                            for(const asset of database.prepare('SELECT id,filename,account_fingerprint FROM savana_native_media_assets WHERE tenant_id=? AND account_ref=? AND scope_json=? ORDER BY created_at DESC LIMIT 100')
                                .all(tenantId,choice.value,nativeCommandJson(scope))){if(asset.account_fingerprint===account.fingerprint)resources.push({resource_ref:`native_media:${asset.id}`,label:asset.filename,resource_kind:'media',scope});}
                            continue;
                        }
                        if (channel !== 'facebook') {
                            const account = resolveCollaborativeAccount(database, tenantId, channel, choice.value);
                            for (const recipient of listCollaborativeRecipients(database, tenantId, account)) resources.push({ resource_ref: recipient.value,
                                label: recipient.label, resource_kind: 'recipient', scope });
                            const evidence = database.prepare(`SELECT id,purpose,recipient_ref FROM savana_collaborative_consents
                                WHERE tenant_id=? AND organization_id=? AND activity_id=? AND channel=? AND account_ref=?
                                AND revoked_at IS NULL AND valid_until>? ORDER BY created_at DESC LIMIT 300`)
                                .all(tenantId, scope.organization_id, scope.activity_id, channel, choice.value, new Date(now()).toISOString());
                            for (const record of evidence) {
                                try { const current = consents.current({ tenantId, scope, channel, accountRef: choice.value,
                                    recipientRef: record.recipient_ref, purpose: record.purpose, consentRef: `consent:${record.id}` });
                                    resources.push({ resource_ref: current.record.value, label: current.record.label, resource_kind: 'consent', scope }); }
                                catch { /* Expired, foreign-scope or changed evidence is not a delegable resource. */ }
                            }
                        }
                        if (channel === 'whatsapp') for (const template of database.prepare(`SELECT id,name FROM templates
                            WHERE tenant_id=? AND status='approved' ORDER BY id LIMIT 100`).all(tenantId)) {
                            try { loadCollaborativeTemplate(database, tenantId, `native_template:${template.id}`);
                                resources.push({ resource_ref: `native_template:${template.id}`, label: template.name, resource_kind: 'template', scope }); }
                            catch { /* Approved templates requiring unsupported media inputs are not executable here. */ }
                        }
                        if (channel === 'facebook') for (const content of database.prepare(`SELECT id,title FROM facebook_content_items
                            WHERE tenant_id=? AND status='approved' AND (linked_page_id IS NULL OR linked_page_id=?) ORDER BY id LIMIT 100`)
                            .all(tenantId, resolveCollaborativeAccount(database, tenantId, channel, choice.value).row.id)) {
                            try { loadCollaborativeContent(database, tenantId, resolveCollaborativeAccount(database, tenantId, channel, choice.value), `native_content:${content.id}`);
                                resources.push({ resource_ref: `native_content:${content.id}`, label: content.title, resource_kind: 'content', scope }); }
                            catch { /* A foreign/shared product cache is never native publishing authority. */ }
                        }
                    }
                }
                capabilities.push({ capability: cap.capability_code, actions: [...actions], cancellation_supported:false,
                    permission_contract: 'parameters_v1',
                    handler_version: '1.0', validator_version: 'wa-native-business-v1', handler_registered: handler,
                    configured: configured && Boolean(ownerPath), reason_code: !handler ? 'implementation_missing'
                        : !ownerPath ? 'owner_action_configuration_required' : !configured ? 'provider_configuration_required'
                            : !subscription?.verified ? 'subscription_verification_unavailable' : null,
                    owner_action_path: ownerPath, allowed_fields: [...(cap.capability_code==='media.manage'?NATIVE_MEDIA_FIELDS:NATIVE_BUSINESS_FIELDS[cap.capability_code] || [...COLLABORATIVE_NATIVE_FIELDS[NATIVE_REVIEW_CAPABILITIES[cap.capability_code] || cap.capability_code], 'result.status', 'result.receipt']),
                        ...(cap.capability_code==='customers.manage'?['consent.purpose','consent.evidence','consent.valid_until']:[])]
                        .filter(value=>!delegated||context.allowed_fields.includes(value))
                        .map(value => ({ value, label: NATIVE_BUSINESS_LABELS[value] || fields[value] || value })),
                    resource_policies: ['measurement.read','measurement.export','owner.operations'].includes(cap.capability_code)?['selected','activity']:['new_only', 'selected', 'activity'], resources: resources.filter((row, index, all) =>
                        (!delegated||(context.resource_policy==='activity'||context.resource_policy==='selected'&&context.resource_refs.includes(row.resource_ref)))
                        &&all.findIndex(other => other.resource_ref === row.resource_ref) === index) });
            }
            // Awaited provider/subscription readers cannot outlive source-owner proof.
            const final = await identity(context);
            if (final.authority.nativeAuthorityRevision !== authority.nativeAuthorityRevision) fail('native_discovery_owner_changed');
            return validateNativeCommandModel('AdapterDiscovery', { spec_version: '1.0', platform: 'wa_savana', providers: [{
                organization_id: context.organization_id, external_tenant_id: context.external_tenant_id, display_name: tenant.name,
                actor_access: true, subscription_active: subscribed && Date.parse(subscription.validUntil) > now(), native_authority_revision: authority.nativeAuthorityRevision,
                capabilities, supported_product_fields: [], policy_choices: { channels: [
                    { value: 'sms', label: 'SMS' }, { value: 'whatsapp', label: 'WhatsApp' },
                    { value: 'messenger', label: 'Messenger' }, { value: 'facebook', label: 'Facebook' },{value:'native',label:'بيانات المؤسسة المحلية'}]
                    .filter(choice => Object.entries(nativeAdapters).some(([key, adapter]) => key.endsWith(`:${choice.value}`) && registered(adapter))),
                unit_codes: [], currencies: [], price_lists: [] } }] });
        },
        products: async context => {
            await identity(context);
            // WA shared product projections are consumers, never authoritative
            // writable source goods. Catalog owns their product commands.
            return validateNativeCommandModel('AdapterProducts', { spec_version: '1.0', platform: 'wa_savana',
                organization_id: context.organization_id, external_tenant_id: context.external_tenant_id, products: [], next_cursor: null });
        },
    };
};
