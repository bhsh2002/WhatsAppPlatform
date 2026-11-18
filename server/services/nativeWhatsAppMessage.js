import {
    buildRichTemplateContent, normalizeTemplateComponents, parseTemplateShortcut,
} from './messageTemplateContent.js';
import {
    countTemplateBodyVariables, InvalidWhatsAppMessageError, normalizeMessageText,
    normalizeMessageType, normalizeTemplateLanguage, normalizeTemplateName, normalizeWhatsAppRecipient,
} from './whatsappMessageValidation.js';
import { getWhatsAppConversationWindow } from './whatsappConversationWindow.js';
import { assertEgressAvailable } from '../runtime/egressMaintenance.js';

export class NativeWhatsAppMessageError extends Error {
    constructor(code, status = 400, message = code) { super(message); this.code = code; this.status = status; this.dispatched = false; }
}
const components = raw => {
    if (raw != null && !Array.isArray(raw)) throw new InvalidWhatsAppMessageError('template_params must be an array');
    const result = normalizeTemplateComponents(raw || []);
    if (result.length > 20 || Buffer.byteLength(JSON.stringify(result), 'utf8') > 64 * 1024) {
        throw new InvalidWhatsAppMessageError('template_params are too large');
    }
    return result;
};

// Extracted from the native API text/template send path. It is also the
// collaborative preview, so both entry points use the same account/window/template rules.
export const prepareNativeWhatsAppMessage = async ({ database, credentialResolver, tenantId: rawTenantId,
    phoneNumberId = null, body = {}, now = () => Date.now() }) => {
    const tenantId = Number(rawTenantId);
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new NativeWhatsAppMessageError('INVALID_TENANT_CONTEXT', 401);
    const recipient = normalizeWhatsAppRecipient(body.recipient);
    const shortcut = parseTemplateShortcut(body.message);
    const rawTemplateName = body.template_name || body.templateName || body.template || shortcut?.name;
    const messageType = normalizeMessageType(body.type, Boolean(rawTemplateName));
    const credentials = await credentialResolver(tenantId, phoneNumberId);
    if (credentials?.suspended || credentials?.tenant?.status === 'Suspended') throw new NativeWhatsAppMessageError('TENANT_SUSPENDED', 403);
    if (credentials?.error) throw new NativeWhatsAppMessageError(credentials.code || 'WHATSAPP_CONTEXT_REQUIRED', credentials.status || 400, credentials.error);
    if (!credentials?.tenant || !credentials.phoneNumberId || !credentials.accessToken) throw new NativeWhatsAppMessageError('WHATSAPP_CREDENTIALS_REQUIRED', 400, 'WhatsApp API credentials not configured');
    if (String(credentials.tenant.id) !== String(tenantId)) throw new NativeWhatsAppMessageError('WHATSAPP_CONTEXT_MISMATCH', 403);
    const context = { tenantId, tenant: credentials.tenant, phoneNumberId: String(credentials.phoneNumberId), accessToken: String(credentials.accessToken) };
    let template = null; let templateName = null; let payload; let storedContent;
    if (messageType === 'template') {
        templateName = normalizeTemplateName(rawTemplateName);
        template = database.prepare(`SELECT id, tenant_id, name, language, category, header_type,
            header_content, body, footer, buttons, variables FROM templates
            WHERE tenant_id = ? AND name = ? AND status = 'approved'`).get(tenantId, templateName);
        if (!template) throw new NativeWhatsAppMessageError('TEMPLATE_NOT_APPROVED', 404);
        const language = normalizeTemplateLanguage(body.template_language || body.templateLanguage || shortcut?.language || template.language || 'en');
        const raw = body.template_components ?? body.templateComponents ?? body.components ?? body.template_params
            ?? body.templateParams ?? body.params ?? shortcut?.params ?? [];
        const normalized = components(raw); const expected = countTemplateBodyVariables(template.body);
        const supplied = normalized.find(c => c?.type?.toLowerCase?.() === 'body')?.parameters?.length || 0;
        if (expected > 0 && supplied !== expected) throw new InvalidWhatsAppMessageError(
            `Template requires ${expected} body parameters; received ${supplied}`,
            { code: 'TEMPLATE_PARAM_MISMATCH', expected, provided: supplied });
        payload = { messaging_product: 'whatsapp', to: recipient, type: 'template',
            template: { name: templateName, language: { code: language }, ...(normalized.length ? { components: normalized } : {}) } };
        storedContent = buildRichTemplateContent(template, normalized) || JSON.stringify({ template: templateName, params: raw });
    } else {
        const message = normalizeMessageText(body.message, 'message', 4096);
        const window = getWhatsAppConversationWindow(database, tenantId, recipient, now(), context.phoneNumberId);
        if (!window.isOpen) {
            const error = new NativeWhatsAppMessageError('OUTSIDE_WINDOW', 400); error.windowClosedAt = window.closesAt; throw error;
        }
        payload = { messaging_product: 'whatsapp', to: recipient, type: 'text', text: { body: message } };
        storedContent = message;
    }
    return { context, recipient, messageType, template, templateName, payload, storedContent,
        billingMetadata: { recipient, message_type: messageType, template_name: templateName, template_category: template?.category || null } };
};

export const createNativeWhatsAppMessageCommand = ({ database, credentialResolver, billing, fetchImpl,
    parseMetaResponse, apiBase, callbackSender = () => undefined, logger = console, now = () => Date.now() }) => async input => {
    let prepared;
    try { prepared = await prepareNativeWhatsAppMessage({ database, credentialResolver, ...input, now }); }
    catch (error) { error.dispatched = false; throw error; }
    const { context, recipient, messageType, payload, storedContent, templateName, billingMetadata } = prepared;
    let reservation = null; let settled = false; let attempted = false; let accepted = false;
    const warnings = [];
    try {
        assertEgressAvailable();
        const operationKey = input.operationKey || (messageType === 'template' ? billing.operations.WHATSAPP_TEMPLATE : billing.operations.WHATSAPP_TEXT);
        reservation = billing.reserve({ tenantId: context.tenantId, operationKey, quantity: 1,
            referenceType: input.referenceType || 'api_message', idempotencyKey: input.idempotencyKey || null,
            metadata: { ...billingMetadata, api_version: 'v1' } });
        if (input.maxCostCredits !== undefined && (!Number.isSafeInteger(reservation.total_credits)
            || reservation.total_credits > input.maxCostCredits)) throw new NativeWhatsAppMessageError('APPROVED_BUDGET_EXCEEDED', 409);
        if (input.createEffectCorrelation) payload.biz_opaque_callback_data = input.createEffectCorrelation({
            tenantId: context.tenantId, channel: 'whatsapp', recipient, nativePayload: structuredClone(payload),
            nativeRecord: { messageType, content: storedContent }, billingUsageId: reservation?.id || null });
        if (input.beforeDispatch && input.beforeDispatch() !== true) throw new NativeWhatsAppMessageError('NATIVE_RESOURCES_CHANGED', 409);
        attempted = true;
        const response = await fetchImpl(`${apiBase}/${encodeURIComponent(context.phoneNumberId)}/messages`, {
            method: 'POST', headers: { Authorization: `Bearer ${context.accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const metaResult = await parseMetaResponse(response);
        const messageId = metaResult.data?.messages?.[0]?.id || null;
        accepted = metaResult.ok;
        if (input.retainUncertainBudget === true && !metaResult.ok && metaResult.status >= 500) {
            const error = new Error('Native provider outcome requires reconciliation'); error.deliveryUncertain = true; throw error;
        }
        if (accepted && input.retainUncertainBudget === true && !messageId) {
            const error = new Error('Native provider receipt is missing'); error.deliveryUncertain = true; throw error;
        }
        let localId = null;
        try {
            const recovered = input.retainUncertainBudget && messageId ? database.prepare(`SELECT id,tenant_id,sender,recipient,content FROM messages WHERE wamid=? ORDER BY id LIMIT 1`).get(messageId) : null;
            if (recovered && (recovered.tenant_id !== context.tenantId || recovered.sender !== context.phoneNumberId
                || recovered.recipient !== recipient || recovered.content !== storedContent)) throw new Error('Native receipt conflict');
            localId = recovered?.id || database.prepare(`INSERT INTO messages (tenant_id, direction, sender, recipient, message_type,
                content, status, wamid, error_message, media_url, media_id, media_mime_type)
                VALUES (?, 'outgoing', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`).run(context.tenantId,
                context.phoneNumberId, recipient, messageType, storedContent, metaResult.ok ? 'sent' : 'failed', messageId,
                metaResult.error?.message || null).lastInsertRowid;
        } catch (error) {
            if (input.retainUncertainBudget === true && metaResult.ok) { error.deliveryUncertain = true; throw error; }
            warnings.push('local_message_store_failed'); logger.error('[ApiV1Messaging] Local message store failed:', error);
        }
        try {
            database.prepare(`INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'api_message_sent', ?, ?)`).run(context.tenantId, context.tenant.name || 'Unknown',
                'إرسال رسالة عبر API', metaResult.ok ? 'success' : 'error');
        } catch (error) { warnings.push('activity_log_store_failed'); logger.error('[ApiV1Messaging] Activity log failed:', error); }
        settled = true;
        try {
            if (metaResult.ok) billing.commit(reservation, { referenceId: messageId,
                description: messageType === 'template' ? `خصم إرسال قالب WhatsApp عبر API: ${templateName}` : 'خصم إرسال رسالة WhatsApp نصية عبر API' });
            else billing.release(reservation, metaResult.error?.message || 'Meta send failed');
        } catch (error) { warnings.push(metaResult.ok ? 'billing_commit_failed' : 'billing_release_failed'); logger.error('[ApiV1Messaging] Billing settlement failed:', error); }
        if (metaResult.ok) {
            try { await callbackSender(context.tenantId, 'message_sent', { message_id: messageId,
                phone_number_id: context.phoneNumberId, recipient, type: messageType, status: 'sent' }); }
            catch (error) { warnings.push('callback_failed'); logger.error('[ApiV1Messaging] Callback failed:', error); }
        }
        return { metaResult, warnings, receipt: { native_kind: 'whatsapp_message', native_id: String(localId || messageId || ''),
            provider_id: messageId, accepted: metaResult.ok, local_store_confirmed: localId != null, billing_usage_id: reservation?.id || null },
        response: { success: true, message_id: messageId, recipient, ...(warnings.length ? { warnings } : {}) } };
    } catch (error) {
        if (!attempted) error.dispatched = false;
        else if (input.retainUncertainBudget === true) { error.dispatched = true; error.deliveryUncertain = true; }
        if (reservation && !settled && !(input.retainUncertainBudget === true && error.deliveryUncertain)) {
            try { billing.release(reservation, error.message); }
            catch (releaseError) { logger.error('[ApiV1Messaging] Billing release failed:', releaseError); }
        }
        throw error;
    }
};
