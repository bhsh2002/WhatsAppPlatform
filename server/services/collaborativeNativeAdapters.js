import crypto from 'node:crypto';
import { nativeCommandJson } from './nativeCommandProtocol.js';
import { CollaborativeExecutionError } from './collaborativeExecution.js';
import { resolveCollaborativeAccount, resolveCollaborativeRecipient } from './collaborativeNativeResources.js';
import { countTemplateBodyVariables } from './whatsappMessageValidation.js';
import { createContentPublication } from './nativeContentPublication.js';
import { assertFacebookContentPublishingPolicy } from './facebookContentPolicy.js';
import { SmsApiRequestStore, smsApiRequestHash, reconcileSmsMessageBilling } from './smsApiRequests.js';

const hash = value => crypto.createHash('sha256').update(nativeCommandJson(value)).digest('hex');
const fail = (code, status = 422) => { throw new CollaborativeExecutionError(code, status); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key));
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
const refId = (ref, prefix) => {
    const raw = typeof ref === 'string' && ref.startsWith(prefix) ? ref.slice(prefix.length) : '';
    if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) fail('native_resource_selection_required');
    return Number(raw);
};
export const NATIVE_PURPOSES = Object.freeze([
    { value: 'service_response', label: 'رد على طلب خدمة' },
    { value: 'transactional', label: 'إشعار متعلق بمعاملة' },
    { value: 'marketing', label: 'تواصل تسويقي بموافقة موثقة' },
]);
export const validateCollaborativePayload = (capability, payload, action) => {
    if (action !== capability || !exact(payload, ['payload_type', 'parameters', 'resource_ref', 'resource_refs', 'expected_source_revision'])
        || (payload.payload_type != null && payload.payload_type !== 'native_action')) fail('native_action_invalid');
    const p = payload.parameters;
    if (payload.expected_source_revision != null) fail('native_source_revision_not_supported');
    const common = ['channel', 'account_ref', 'max_cost_credits', 'resource_fingerprint'];
    const keys = capability === 'content.publish' ? [...common, 'content_ref']
        : [...common, 'purpose', 'message', 'template_ref', 'template_values', ...(capability === 'campaigns.execute' ? ['recipients'] : ['recipient_ref', 'consent_ref'])];
    if (!exact(p, keys) || !text(p.account_ref, 255)
        || !Number.isSafeInteger(p.max_cost_credits) || p.max_cost_credits < 0
        || (p.resource_fingerprint != null && !/^[a-f0-9]{64}$/.test(p.resource_fingerprint))) fail('native_parameters_invalid');
    if (capability === 'content.publish') {
        if (p.channel !== 'facebook' || !text(p.content_ref, 255)) fail('native_content_selection_required');
    } else {
        if (!NATIVE_PURPOSES.some(purpose => purpose.value === p.purpose)) fail('native_purpose_required');
        if (capability === 'campaigns.execute') {
            if (p.channel !== 'whatsapp' || p.message != null || !text(p.template_ref, 255)
                || !Array.isArray(p.recipients) || p.recipients.length < 1 || p.recipients.length > 100
                || p.recipients.some(recipient => !exact(recipient, ['recipient_ref', 'consent_ref'])
                    || !text(recipient.recipient_ref, 255) || !text(recipient.consent_ref, 255))
                || new Set(p.recipients.map(recipient => recipient.recipient_ref)).size !== p.recipients.length) fail('native_campaign_selection_invalid');
        } else if (!['sms', 'whatsapp', 'messenger'].includes(p.channel) || !text(p.recipient_ref, 255)
            || !text(p.consent_ref, 255)) fail('native_recipient_selection_required');
        if (p.template_ref != null) {
            if (p.channel !== 'whatsapp' || p.message != null || !text(p.template_ref, 255)
                || !Array.isArray(p.template_values || []) || (p.template_values || []).length > 20
                || (p.template_values || []).some(value => !text(value, 1024))) fail('native_template_parameters_invalid');
        } else if (!text(p.message, p.channel === 'sms' ? 1600 : 4096) || p.template_values != null) fail('native_message_required');
    }
    const actualRefs = [p.account_ref,p.recipient_ref,p.consent_ref,p.template_ref,p.content_ref,
        ...(p.recipients || []).flatMap(recipient => [recipient.recipient_ref,recipient.consent_ref])].filter(Boolean);
    if ((payload.resource_ref != null && !actualRefs.includes(payload.resource_ref))
        || (payload.resource_refs !== undefined && (!Array.isArray(payload.resource_refs) || payload.resource_refs.length > 500
            || new Set(payload.resource_refs).size !== payload.resource_refs.length || payload.resource_refs.some(ref => !actualRefs.includes(ref))))) fail('native_payload_resource_mismatch');
    return { ...payload, payload_type: 'native_action', parameters: { ...p } };
};

// Native quote may lazily synchronize a billing account. A read-only preview
// runs the actual synchronous quote in a rollback-only savepoint.
export const quoteCollaborativeNative = (database, billing, input) => {
    const savepoint = `collaborative_quote_${crypto.randomBytes(8).toString('hex')}`;
    database.exec(`SAVEPOINT ${savepoint}`);
    try {
        const quote = billing.quote(input);
        if (!quote || typeof quote.then === 'function' || !quote.price_item || quote.price_item.is_active !== 1
            || !Number.isSafeInteger(quote.price_item.unit_price_credits) || quote.price_item.unit_price_credits < 0
            || !Number.isSafeInteger(quote.total_credits)
            || quote.total_credits < 0 || quote.customer_charge_type === 'needs_review'
            || quote.customer_charge_type === 'blocked' || quote.availability?.billing_cycle_blocked === true
            || !Number.isSafeInteger(quote.availability?.available_credits)) fail('native_quote_unavailable', 409);
        return { total_credits: quote.total_credits, available_credits: quote.availability.available_credits,
            rate_fingerprint: hash({ operation: input.operationKey, total: quote.total_credits,
                pricing_model: quote.local_pricing_model || null, price_item: quote.price_item || null }) };
    } finally { database.exec(`ROLLBACK TO ${savepoint}`); database.exec(`RELEASE ${savepoint}`); }
};
export const loadCollaborativeTemplate = (database, tenantId, ref) => {
    const row = database.prepare(`SELECT id,tenant_id,name,language,category,header_type,header_content,body,footer,buttons,
        variables,status,updated_at FROM templates WHERE id = ? AND tenant_id = ? AND status = 'approved'`)
        .get(refId(ref, 'native_template:'), tenantId);
    if (!row || !['NONE', 'TEXT', ''].includes(String(row.header_type || '').toUpperCase())
        || /\{\{[0-9]+\}\}/.test(row.header_content || '')) fail('native_template_not_approved');
    return row;
};
export const loadCollaborativeContent = (database, tenantId, account, ref) => {
    const row = database.prepare(`SELECT id,tenant_id,linked_page_id,product_id,title,body,link_url,media_url,status,updated_at
        FROM facebook_content_items WHERE id = ? AND tenant_id = ? AND status = 'approved'
        AND (linked_page_id IS NULL OR linked_page_id = ?)`).get(refId(ref, 'native_content:'), tenantId, account.row.id);
    if (!row || !text(row.body, 63000)) fail('native_content_not_approved');
    // Shared read caches and foreign product media are never a publishing authority.
    if (row.product_id) {
        const product = database.prepare(`SELECT id,approval_status,is_active,savana_projection_key FROM bot_products WHERE id = ? AND tenant_id = ?`)
            .get(row.product_id, tenantId);
        if (!product || product.savana_projection_key || product.approval_status !== 'approved' || product.is_active !== 1) fail('native_product_content_unavailable');
    }
    return row;
};

export const createCollaborativeNativeAdapters = ({ database, billing, consents,
    smsService = null, smsCommand = null, whatsappCommand = null, prepareWhatsApp = null, whatsappCredentials = null,
    messengerCommand = null, prepareMessenger = null, publishContent = null, contentCredentials = null,
    processBroadcast = null, effectEvidence = null, now = () => Date.now() }) => {
    if (!database || typeof billing?.quote !== 'function' || !billing.operations || typeof consents?.current !== 'function') {
        throw new TypeError('Native collaboration requires real native resource, consent and billing services');
    }
    const adapters = {};
    const configured = async (channel, { tenantId, parameters }) => {
        try {
            const account = resolveCollaborativeAccount(database, tenantId, channel, parameters.account_ref);
            if (!account.ready) return false;
            if (channel === 'sms') return Boolean(smsService.requireCollaborativeConfiguration(tenantId, account.row.id));
            if (channel === 'whatsapp') {
                if (typeof whatsappCredentials !== 'function') return false;
                const current = await whatsappCredentials(tenantId, account.row.phone_number_id);
                return !current?.error && String(current?.tenant?.id) === String(tenantId)
                    && String(current?.phoneNumberId) === String(account.row.phone_number_id) && Boolean(current?.accessToken);
            }
            return typeof contentCredentials === 'function' && Boolean(contentCredentials(database, tenantId, account.row.id)?.accessToken);
        } catch { return false; }
    };
    const assertCurrent = prepared => {
        const { tenantId, scope, parameters: p, account, selections, template, content, operationKey } = prepared;
        const tenant = database.prepare('SELECT status FROM tenants WHERE id=?').get(tenantId);
        const currentAccount = resolveCollaborativeAccount(database, tenantId, p.channel, p.account_ref);
        if (!tenant || tenant.status === 'Suspended' || !currentAccount.ready || currentAccount.fingerprint !== account.fingerprint) fail('native_resource_preview_changed', 409);
        if (template && nativeCommandJson(loadCollaborativeTemplate(database, tenantId, p.template_ref)) !== nativeCommandJson(template)) fail('native_resource_preview_changed', 409);
        if (content && nativeCommandJson(loadCollaborativeContent(database, tenantId, currentAccount, p.content_ref)) !== nativeCommandJson(content)) fail('native_resource_preview_changed', 409);
        for (const selected of selections) {
            const current = consents.current({ tenantId, scope, channel: p.channel, accountRef: p.account_ref,
                recipientRef: selected.ref, purpose: p.purpose, consentRef: selected.consent_ref });
            if (current.recipient.fingerprint !== selected.fingerprint || current.evidenceHash !== selected.evidence_hash
                || current.record.version !== selected.consent_version) fail('native_resource_preview_changed', 409);
        }
        const quotes = content ? [quoteCollaborativeNative(database, billing, { tenantId, operationKey, quantity: 1 })]
            : selections.map(selected => quoteCollaborativeNative(database, billing, { tenantId, operationKey, quantity: 1,
                metadata: { recipient: selected.value, template_name: template?.name || null, template_category: template?.category || null } }));
        if (quotes.some((quote, index) => quote.rate_fingerprint !== prepared.quotes[index].rate_fingerprint)) fail('native_resource_preview_changed', 409);
        return true;
    };
    const prepare = async ({ capability, tenantId, scope, parameters, preview = false, command }) => {
        const p = validateCollaborativePayload(capability, { payload_type: 'native_action', parameters }, capability).parameters;
        const account = resolveCollaborativeAccount(database, tenantId, p.channel, p.account_ref);
        const tenant = database.prepare('SELECT id,status FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant || tenant.status === 'Suspended' || !account.ready) fail('native_account_inactive', 403);
        const selections = []; let template = null; let content = null; let operationKey; let quantity = 1; let metadata = {};
        if (capability === 'content.publish') {
            content = loadCollaborativeContent(database, tenantId, account, p.content_ref);
            contentCredentials(database, tenantId, account.row.id);
            assertFacebookContentPublishingPolicy(database, { tenantId, linkedPageId: account.row.id,
                contentItemId: content.id, productId: content.product_id, renderedMessage: content.body,
                linkUrl: content.link_url, mediaUrl: content.media_url, at: new Date(now()), mode: 'publish' });
            operationKey = content.media_url ? billing.operations.FACEBOOK_PHOTO_POST_CREATE : billing.operations.FACEBOOK_POST_CREATE;
        } else {
            if (p.template_ref) {
                template = loadCollaborativeTemplate(database, tenantId, p.template_ref);
                if (countTemplateBodyVariables(template.body) !== (p.template_values || []).length) fail('native_template_values_required');
            }
            const recipients = capability === 'campaigns.execute' ? p.recipients : [{ recipient_ref: p.recipient_ref, consent_ref: p.consent_ref }];
            for (const selected of recipients) {
                const current = consents.current({ tenantId, scope, channel: p.channel, accountRef: p.account_ref,
                    recipientRef: selected.recipient_ref, purpose: p.purpose, consentRef: selected.consent_ref });
                if (p.channel === 'sms') smsService.requireCollaborativeConfiguration(tenantId, account.row.id);
                if (p.channel === 'whatsapp') await prepareWhatsApp({ tenantId, phoneNumberId: account.row.phone_number_id,
                    body: { recipient: current.recipient.value, ...(template ? { type: 'template', template_name: template.name,
                        template_language: template.language, template_params: p.template_values || [] } : { type: 'text', message: p.message }) } });
                if (p.channel === 'messenger') prepareMessenger({ tenantId, linkedPageId: account.row.id,
                    recipient: current.recipient.value, message: p.message, requireConversation: true, requireOpenWindow: true, now: now() });
                selections.push({ ref: current.recipient.ref, value: current.recipient.value, label: current.recipient.label,
                    fingerprint: current.recipient.fingerprint, consent_ref: current.record.value,
                    consent_version: current.record.version, evidence_hash: current.evidenceHash });
            }
            operationKey = p.channel === 'sms' ? billing.operations.SMS_TEXT : p.channel === 'messenger'
                ? billing.operations.MESSENGER_REPLY : capability === 'campaigns.execute' ? billing.operations.WHATSAPP_BROADCAST_RECIPIENT
                    : template ? billing.operations.WHATSAPP_TEMPLATE : billing.operations.WHATSAPP_TEXT;
            quantity = selections.length;
            metadata = { recipient: selections[0].value, template_name: template?.name || null,
                template_category: template?.category || null };
        }
        // Quote every selected recipient because Meta pricing can vary by country/window.
        const quotes = content ? [quoteCollaborativeNative(database, billing, { tenantId, operationKey, quantity, metadata })]
            : selections.map(selected => quoteCollaborativeNative(database, billing, { tenantId, operationKey, quantity: 1,
                metadata: { ...metadata, recipient: selected.value } }));
        const total = quotes.reduce((sum, quote) => sum + quote.total_credits, 0);
        if (!Number.isSafeInteger(total) || total > p.max_cost_credits || total > Math.min(...quotes.map(quote => quote.available_credits))) {
            const error = new CollaborativeExecutionError('native_approved_budget_insufficient', 402);
            if (Number.isSafeInteger(total)) error.nativeQuote = { total_credits: total, within_budget: false, currency_label: 'رصيد' };
            throw error;
        }
        const fingerprintParameters = { ...p }; delete fingerprintParameters.resource_fingerprint;
        const resourceSelection = { channel: p.channel, nativeAccountRef: account.ref, accountFingerprint: account.fingerprint,
            providerFingerprint: account.providerFingerprint,
            recipients: selections.map(selected => ({ ref: selected.ref, fingerprint: selected.fingerprint,
                deliveryFingerprint: hash({ channel: p.channel, account: account.fingerprint, recipient: selected.value }),
                consent_ref: selected.consent_ref, consent_version: selected.consent_version, evidence_hash: selected.evidence_hash })),
            contentRef: p.content_ref || p.template_ref || null };
        const resourceFingerprint = hash({ tenantId, scope, parameters: fingerprintParameters, resources: resourceSelection,
            template, content, quote: { total, rates: quotes.map(quote => quote.rate_fingerprint) } });
        if (!preview && p.resource_fingerprint !== resourceFingerprint) fail('native_resource_preview_changed', 409);
        const prepared = { tenantId, scope, operationKey, parameters: { ...p, resource_fingerprint: resourceFingerprint }, resourceFingerprint,
            resourceSelection, account, selections, template, content, quotes,
            quote: { total_credits: total, within_budget: true, currency_label: 'رصيد' } };
        assertCurrent(prepared);
        return prepared;
    };
    const messageExecute = async ({ tenantId, prepared, effect }, selected = prepared.selections[0]) => {
        const p = prepared.parameters; const nativeKind = p.channel === 'sms' ? 'sms_message' : `${p.channel}_message`;
        return effect({ key: selected.ref, kind: nativeKind, run: async ({ effectId, idempotencyKey, assertEffectLease }) => {
            const beforeDispatch = () => { assertEffectLease(); return assertCurrent(prepared); };
            const createEffectCorrelation = effectEvidence ? capture => effectEvidence.prepare({ ...capture, effectId, accountRef: prepared.account.ref }) : undefined;
            const maxCostCredits = prepared.quotes[prepared.selections.indexOf(selected)]?.total_credits ?? p.max_cost_credits;
            if (p.channel === 'sms') {
                const result = await smsCommand({ tenantId, accountId: prepared.account.row.id,
                    recipient: selected.value, message: p.message, idempotencyKey, maxCostCredits, retainUncertainBudget: true,
                    beforeDispatch });
                return { native_kind: 'sms_message', native_id: String(result.data.message_id),
                    provider_id: result.data.gateway_message_id, accepted: true };
            }
            if (p.channel === 'whatsapp') {
                const result = await whatsappCommand({ tenantId, phoneNumberId: prepared.account.row.phone_number_id,
                    body: { recipient: selected.value, ...(prepared.template ? { type: 'template', template_name: prepared.template.name,
                        template_language: prepared.template.language, template_params: p.template_values || [] } : { type: 'text', message: p.message }) },
                    idempotencyKey, maxCostCredits, retainUncertainBudget: true,
                    beforeDispatch,
                    createEffectCorrelation,
                    ...(p.recipients ? { operationKey: billing.operations.WHATSAPP_BROADCAST_RECIPIENT, referenceType: 'broadcast_recipient' } : {}) });
                return result.receipt;
            }
            const result = await messengerCommand({ tenantId, linkedPageId: prepared.account.row.id, recipient: selected.value,
                message: p.message, requireConversation: true, requireOpenWindow: true, now: now(),
                idempotencyKey, maxCostCredits, retainUncertainBudget: true, beforeDispatch, createEffectCorrelation });
            return result.receipt || { native_kind: 'messenger_message', native_id: '', accepted: false };
        } });
    };
    const reconcileMessage = async ({ tenantId, command, effect }) => {
        if (effect.native_kind === 'sms_message') {
            const parameters = command.payload.parameters;
            const account = resolveCollaborativeAccount(database, tenantId, 'sms', parameters.account_ref);
            const request = database.prepare(`SELECT * FROM sms_api_requests WHERE tenant_id=? AND sms_account_id=? AND idempotency_key=?`)
                .get(tenantId, account.row.id, effect.native_idempotency_key);
            if (!request) return { definitive: false };
            const matches = message => message && message.direction === 'outgoing'
                && String(message.external_id || '').trim() === effect.native_idempotency_key
                && smsApiRequestHash({ smsAccountSelector: account.row.id, recipient: message.recipient,
                    message: message.content ?? message.message }) === request.request_hash;
            let message = database.prepare(`SELECT * FROM sms_messages WHERE tenant_id=? AND sms_account_id=? AND external_id=?`)
                .get(tenantId, account.row.id, effect.native_idempotency_key);
            if (!matches(message) && typeof smsService.readCollaborativeHistoryPage === 'function') {
                const stored = database.prepare('SELECT resources_json FROM savana_collaborative_executions WHERE id=?').get(effect.execution_id);
                const resources = stored ? JSON.parse(stored.resources_json) : null;
                if (!resources || resources.providerFingerprint !== account.providerFingerprint) return { definitive: false };
                try {
                    const page = await smsService.readCollaborativeHistoryPage(tenantId, account.row.id,
                        { beforeId: effect.reconcile_cursor || null, limit: 100 });
                    const current = resolveCollaborativeAccount(database, tenantId, 'sms', parameters.account_ref);
                    if (current.providerFingerprint !== account.providerFingerprint) return { definitive: false };
                    const candidate = page.messages.find(matches);
                    if (candidate) message = smsService.storeMessage(smsService.requireActiveAccount(tenantId, account.row.id, false), candidate);
                    else {
                        const cursor = page.pagination.has_more && /^[1-9][0-9]*$/.test(String(page.pagination.next_before_id || ''))
                            ? String(page.pagination.next_before_id) : null;
                        database.prepare(`UPDATE savana_collaborative_effects SET reconcile_cursor=? WHERE id=? AND state IN ('unknown','dispatching')`)
                            .run(cursor, effect.id);
                    }
                } catch { return { definitive: false }; }
            }
            if (matches(message)) {
                const reconciled = database.transaction(() => reconcileSmsMessageBilling({ database, billing,
                    requestStore: new SmsApiRequestStore({ database }), message })).immediate();
                if (reconciled.reconciled !== true) return { definitive: false };
                return { definitive: true, state: 'accepted', receipt: { native_kind: 'sms_message', native_id: String(message.id),
                    provider_id: message.gateway_message_id, accepted: true, provider_status: message.status,
                    billing_usage_id: reconciled.billing_usage_id || null, evidence_kind: 'native_gateway_history' } };
            }
        } else {
            const usage = database.prepare(`SELECT reference_id FROM billing_usage_events WHERE tenant_id = ? AND idempotency_key = ?
                AND status = 'committed'`).get(tenantId, effect.native_idempotency_key);
            const native = usage?.reference_id && (effect.native_kind === 'whatsapp_message'
                ? database.prepare(`SELECT id,wamid AS provider_id FROM messages WHERE tenant_id = ? AND wamid = ? AND direction = 'outgoing' AND status IN ('sent','delivered','read')`).get(tenantId, usage.reference_id)
                : database.prepare(`SELECT id,mid AS provider_id FROM fb_messages WHERE tenant_id = ? AND mid = ? AND direction = 'outgoing'`).get(tenantId, usage.reference_id));
            if (native) return { definitive: true, state: 'accepted', receipt: { native_kind: effect.native_kind,
                native_id: String(native.id), provider_id: native.provider_id, accepted: true } };
        }
        return { definitive: false };
    };
    for (const channel of ['sms', 'whatsapp', 'messenger']) {
        const implemented = channel === 'sms' ? typeof smsCommand === 'function' && typeof smsService?.requireCollaborativeConfiguration === 'function'
            : channel === 'whatsapp' ? typeof whatsappCommand === 'function' && typeof prepareWhatsApp === 'function'
                : typeof messengerCommand === 'function' && typeof prepareMessenger === 'function';
        if (!implemented) continue;
        adapters[`messaging.send:${channel}`] = { qualified: true,
            validate: (payload, action) => validateCollaborativePayload('messaging.send', payload, action),
            configured: input => configured(channel, input),
            prepare: input => prepare({ ...input, capability: 'messaging.send' }), assertCurrent,execute: messageExecute, reconcile: reconcileMessage };
    }
    if (adapters['messaging.send:whatsapp'] && typeof processBroadcast === 'function') {
        adapters['campaigns.execute:whatsapp'] = { qualified: true,
            validate: (payload, action) => validateCollaborativePayload('campaigns.execute', payload, action),
            configured: input => configured('whatsapp', input),
            prepare: input => prepare({ ...input, capability: 'campaigns.execute' }),assertCurrent,
            execute: async ({ tenantId, executionId, prepared, effect }) => {
                const job = database.prepare(`INSERT INTO broadcast_jobs (tenant_id,status,template_name,template_language,total_recipients,
                    collaborative_execution_id) VALUES (?,'pending',?,?,?,?)`).run(tenantId, prepared.template.name,
                        prepared.template.language, prepared.selections.length, executionId);
                const jobId = Number(job.lastInsertRowid);
                await processBroadcast(jobId, { tenantId, recipients: prepared.selections.map(selected => ({ ...selected, recipient_ref: selected.ref })),
                    collaboration: { executionId, sendRecipient: selected => messageExecute({ tenantId, prepared, effect },
                        prepared.selections.find(item => item.ref === selected.ref)) } });
                return { local_entity_id: String(jobId) };
            }, reconcile: reconcileMessage };
    }
    if (typeof publishContent === 'function' && typeof contentCredentials === 'function') {
        adapters['content.publish:facebook'] = { qualified: true,
            validate: (payload, action) => validateCollaborativePayload('content.publish', payload, action),
            configured: input => configured('facebook', input),
            prepare: input => prepare({ ...input, capability: 'content.publish' }),assertCurrent,
            execute: async ({ tenantId, executionId, prepared, effect }) => {
                const result = await effect({ key: prepared.parameters.content_ref, kind: 'facebook_publication', run: async ({ assertEffectLease }) => {
                    let publication;
                    try { publication = database.transaction(() => {
                        assertFacebookContentPublishingPolicy(database, { tenantId, linkedPageId: prepared.account.row.id,
                            contentItemId: prepared.content.id, productId: prepared.content.product_id, renderedMessage: prepared.content.body,
                            linkUrl: prepared.content.link_url, mediaUrl: prepared.content.media_url, at: new Date(now()), mode: 'schedule' });
                        const row = createContentPublication(database, { tenantId, linkedPageId: prepared.account.row.id,
                            contentItemId: prepared.content.id, productId: prepared.content.product_id, scheduledFor: new Date(now()),
                            renderedMessage: prepared.content.body, linkUrl: prepared.content.link_url, mediaUrl: prepared.content.media_url,
                            idempotencyKey: `collaborative-publication:${executionId}`, maxAttempts: 1 });
                        database.prepare(`UPDATE facebook_content_publications SET status = 'processing',claimed_by = ?,claimed_at = ?,
                            collaborative_execution_id = ? WHERE id = ? AND status = 'pending'`).run(`collaborative:${executionId}`,
                                new Date(now()).toISOString(), executionId, row.id);
                        return database.prepare('SELECT * FROM facebook_content_publications WHERE id = ?').get(row.id);
                    }).immediate(); } catch (error) { error.dispatched = false; throw error; }
                    try {
                        const result = await publishContent({ database, publication, retainUncertainBudget: true,
                            maxCostCredits: prepared.parameters.max_cost_credits,
                            beforeDispatch: () => { assertEffectLease(); return assertCurrent(prepared); } });
                        database.prepare(`UPDATE facebook_content_publications SET status = 'published',meta_post_id = ?,published_at = ?,
                            updated_at = ? WHERE id = ? AND collaborative_execution_id = ?`).run(result.post_id,
                                new Date(now()).toISOString(), new Date(now()).toISOString(), publication.id, executionId);
                        return { native_kind: 'facebook_publication', native_id: String(publication.id),
                            provider_id: result.post_id, accepted: true, billing_usage_id: result.billing_usage_id || null };
                    } catch (error) {
                        if (error.dispatched === false || error.confirmedFailure === true) database.prepare(`UPDATE facebook_content_publications
                            SET status = 'failed',error_code = 'native_publication_rejected' WHERE id = ?`).run(publication.id);
                        throw error;
                    }
                } });
                return { local_entity_id: result.native_id };
            },
            reconcile: async ({ tenantId, effect }) => {
                const publication = database.prepare(`SELECT id,meta_post_id,status FROM facebook_content_publications
                    WHERE tenant_id = ? AND collaborative_execution_id = ?`).get(tenantId, effect.execution_id);
                if (publication?.status === 'published' && publication.meta_post_id) return { definitive: true, state: 'accepted',
                    receipt: { native_kind: 'facebook_publication', native_id: String(publication.id), provider_id: publication.meta_post_id, accepted: true } };
                if (publication?.status === 'failed') return { definitive: true, state: 'rejected',
                    receipt: { native_kind: 'facebook_publication', native_id: String(publication.id), accepted: false } };
                return { definitive: false };
            } };
    }
    return adapters;
};

export const createCollaborativeNativePolicy = ({ database, nativeAdapters, getNativeAuthority, now = () => Date.now() }) => {
    if (!database || !nativeAdapters || typeof getNativeAuthority !== 'function') {
        throw new TypeError('Native policy requires current source-owner delegation authority');
    }
    return async ({ command, nativeTenantId, action, scope, actorId=command.actor_id,resourceSelection = null, delegation = command }) => {
        if((delegation.authority_domain!=null&&!['native.service_namespace','read_model'].includes(delegation.authority_domain))
            ||delegation.ownership_epoch!=null)fail('native_authority_domain_unsupported',403);
        const adapter = nativeAdapters[`${command.capability}:${command.payload?.parameters?.channel}`];
        if (!adapter || !['validate', 'prepare', 'execute', 'reconcile', 'configured'].every(key => typeof adapter[key] === 'function')) {
            fail('native_channel_unavailable');
        }
        const payload = adapter.validate(command.payload, command.action);
        const authority = await getNativeAuthority({ nativeTenantId, scope, capability: command.capability,
            grantApprovedBy: delegation.grant_approved_by, action, delegation });
        if (!authority || authority.verified !== true || authority.nativeTenantId !== nativeTenantId
            || typeof authority.nativeAuthorityRevision !== 'string' || !authority.nativeAuthorityRevision
            || authority.nativeAuthorityRevision !== delegation.native_authority_revision
            || authority.grantApprovedBy !== delegation.grant_approved_by
            || !Number.isFinite(Date.parse(authority.validUntil)) || Date.parse(authority.validUntil) <= now()) {
            fail('native_owner_delegation_changed', 403);
        }
        const account = typeof adapter.readPolicy === 'function' ? null
            : resolveCollaborativeAccount(database, nativeTenantId, payload.parameters.channel, payload.parameters.account_ref);
        if (['reconcile', 'result'].includes(action)) {
            return { verified: true, nativeTenantId, nativeAuthorityRevision: authority.nativeAuthorityRevision,
                resourceSelection: account ? { channel: account.channel, nativeAccountRef: account.ref, accountFingerprint: account.fingerprint }
                    : await adapter.readPolicy({tenantId:nativeTenantId,parameters:payload.parameters,command,action}),
                validUntil: authority.validUntil };
        }
        if (await adapter.configured({ tenantId: nativeTenantId, parameters: payload.parameters }) !== true) fail('native_provider_configuration_required', 422);
        const prepared = await adapter.prepare({ tenantId: nativeTenantId, scope, parameters: payload.parameters,
            command,authority:{actorId,delegation}, preview: action === 'validate' });
        const used = Object.keys(payload.parameters).filter(key => key !== 'resource_fingerprint');
        if (!Array.isArray(delegation.allowed_fields) || used.some(key => !delegation.allowed_fields.includes(key))) {
            fail('native_parameter_delegation_required', 403);
        }
        const refs = [account?.ref || prepared.resourceSelection.nativeAccountRef,payload.parameters.contact_ref,payload.parameters.consent_ref,payload.parameters.command_ref,payload.parameters.asset_ref, payload.parameters.template_ref, payload.parameters.content_ref,
            ...(prepared.selections || []).flatMap(recipient => [recipient.ref, recipient.consent_ref])].filter(Boolean);
        if (!(adapter.resourcePolicies || ['new_only', 'selected', 'activity']).includes(delegation.resource_policy)
            || !Array.isArray(delegation.resource_refs)
            || (delegation.resource_policy === 'selected' && refs.some(ref => !delegation.resource_refs.includes(ref)))
            || (delegation.resource_policy === 'new_only' && ['contacts.change','contacts.remove','contacts.read'].includes(command.action))) {
            fail('native_resource_delegation_required', 403);
        }
        if (resourceSelection && nativeCommandJson(resourceSelection) !== nativeCommandJson(prepared.resourceSelection)) {
            fail('native_resource_selection_changed', 409);
        }
        return { verified: true, nativeTenantId, nativeAuthorityRevision: authority.nativeAuthorityRevision,
            resourceSelection: prepared.resourceSelection, resourceFingerprint: prepared.resourceFingerprint,
            allowedFields: delegation.allowed_fields, validUntil: new Date(Math.min(now() + 30000, Date.parse(authority.validUntil))).toISOString() };
    };
};
