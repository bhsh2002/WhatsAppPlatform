import { META_API_BASE } from '../config/index.js';
import { insertMessengerMessage, normalizeMessengerTimestamp } from './messengerMessages.js';
import { assertEgressAvailable } from '../runtime/egressMaintenance.js';

export class NativeMessengerMessageError extends Error {
    constructor(code, status = 400, message = code) { super(message); this.code = code; this.status = status; this.dispatched = false; }
}
const text = (value, max) => typeof value === 'string' && value.trim() && value.trim().length <= max
    && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;

export const prepareNativeMessengerMessage = ({ database, decryptToken, tenantId: rawTenantId, linkedPageId: rawPageId,
    recipient, message, requireConversation = false, requireOpenWindow = false, now = Date.now() }) => {
    const tenantId = Number(rawTenantId); const linkedPageId = Number(rawPageId);
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new NativeMessengerMessageError('INVALID_TENANT_CONTEXT', 401);
    if (!Number.isSafeInteger(linkedPageId) || linkedPageId <= 0) throw new NativeMessengerMessageError('PAGE_REQUIRED', 400, 'linked_page_id غير صالح');
    const tenant = database.prepare('SELECT id, name, status FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) throw new NativeMessengerMessageError('TENANT_NOT_FOUND', 404, 'العميل غير موجود');
    if (tenant.status === 'Suspended') throw new NativeMessengerMessageError('TENANT_SUSPENDED', 403, 'حسابك معلّق');
    const normalizedRecipient = text(recipient, 256); const normalizedMessage = text(message, 4096);
    if (!normalizedRecipient || !normalizedMessage) throw new NativeMessengerMessageError('MESSAGE_REQUIRED', 400, 'الرسالة مطلوبة');
    const page = database.prepare(`SELECT id, tenant_id, page_id, page_name, page_access_token_encrypted
        FROM tenant_pages WHERE id = ? AND tenant_id = ? AND is_active = 1`).get(linkedPageId, tenantId);
    if (!page) throw new NativeMessengerMessageError('PAGE_NOT_FOUND', 404, 'الصفحة غير موجودة');
    const accessToken = decryptToken(page.page_access_token_encrypted);
    if (!accessToken) throw new NativeMessengerMessageError('PAGE_TOKEN_REQUIRED', 400, 'رمز الوصول غير متوفر');
    const conversation = database.prepare(`SELECT id, tenant_id, linked_page_id, page_id, user_psid
        FROM fb_conversations WHERE user_psid = ? AND linked_page_id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1`)
        .get(normalizedRecipient, linkedPageId, tenantId);
    if (requireConversation && !conversation) throw new NativeMessengerMessageError('OWNED_CONVERSATION_REQUIRED', 404);
    if (requireOpenWindow) {
        const incoming = conversation && database.prepare(`SELECT created_at FROM fb_messages WHERE tenant_id = ?
            AND conversation_id = ? AND direction = 'incoming' ORDER BY created_at DESC, id DESC LIMIT 1`)
            .get(tenantId, conversation.id);
        const receivedAt = incoming && Date.parse(incoming.created_at);
        if (!Number.isFinite(receivedAt) || receivedAt > now || now - receivedAt >= 24 * 60 * 60 * 1000) {
            throw new NativeMessengerMessageError('OUTSIDE_WINDOW', 403);
        }
    }
    return { tenantId, tenant, linkedPageId, recipient: normalizedRecipient, message: normalizedMessage, page, accessToken, conversation };
};

// Extracted native Messenger reply command, shared by the inbox and approved
// collaborative dispatch. HUMAN_AGENT/utility sending is not silently selected.
export const createNativeMessengerMessageCommand = ({ database, decryptToken, requestMeta, billing,
    markHandoff = () => undefined, broadcast = () => undefined, apiBase = META_API_BASE }) => async input => {
    const prepared = prepareNativeMessengerMessage({ database, decryptToken, ...input });
    const { tenantId, linkedPageId, recipient, message, page, accessToken, conversation } = prepared;
    let reservation = null; let attempted = false; let settled = false;
    try {
        assertEgressAvailable();
        reservation = billing.reserve({ tenantId, operationKey: billing.operations.MESSENGER_REPLY,
            quantity: 1, referenceType: 'messenger_message', idempotencyKey: input.idempotencyKey || null,
            metadata: { linked_page_id: linkedPageId, conversation_id: conversation?.id || null, user_psid: recipient } });
        if (input.maxCostCredits !== undefined && (!Number.isSafeInteger(reservation.total_credits)
            || reservation.total_credits > input.maxCostCredits)) throw new NativeMessengerMessageError('APPROVED_BUDGET_EXCEEDED', 409);
        const nativePayload = { recipient: { id: recipient }, messaging_type: 'RESPONSE', message: { text: message } };
        if (input.createEffectCorrelation) nativePayload.message.metadata = input.createEffectCorrelation({
            tenantId, channel: 'messenger', recipient, nativePayload: structuredClone(nativePayload),
            nativeRecord: { content: message, conversationId: conversation?.id || null }, billingUsageId: reservation?.id || null });
        if (input.beforeDispatch && input.beforeDispatch() !== true) throw new NativeMessengerMessageError('NATIVE_RESOURCES_CHANGED', 409);
        attempted = true;
        const result = await requestMeta(`${apiBase}/${encodeURIComponent(page.page_id)}/messages`, {
            method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(nativePayload),
        });
        if (input.retainUncertainBudget === true && !result.ok && result.status >= 500) {
            const error = new Error('Native provider outcome requires reconciliation'); error.deliveryUncertain = true; throw error;
        }
        if (!result.ok) {
            billing.release(reservation, result.error?.message || 'Meta Messenger send failed'); settled = true;
            return { metaResult: result, receipt: null };
        }
        const messageId = result.data?.message_id || null;
        if (input.retainUncertainBudget === true && !messageId) {
            const error = new Error('Native provider receipt is missing'); error.deliveryUncertain = true; throw error;
        }
        billing.commit(reservation, { referenceId: messageId, description: 'خصم رد Messenger من الرسائل' }); settled = true;
        let localId = null;
        if (conversation) {
            const createdAt = normalizeMessengerTimestamp();
            database.transaction(() => {
                insertMessengerMessage(database, { conversationId: conversation.id, tenantId, mid: messageId,
                    direction: 'outgoing', senderId: page.page_id, senderName: page.page_name, messageText: message, createdAt });
                localId = database.prepare('SELECT id FROM fb_messages WHERE tenant_id = ? AND conversation_id = ? AND mid = ?')
                    .get(tenantId, conversation.id, messageId)?.id || null;
                database.prepare(`UPDATE fb_conversations SET last_message = ?, last_message_time = ?,
                    updated_at = datetime('now', 'localtime') WHERE id = ? AND tenant_id = ?`)
                    .run(message.slice(0, 100), createdAt, conversation.id, tenantId);
            })();
            markHandoff({ tenantId, linkedPageId, conversationId: conversation.id, userPsid: conversation.user_psid,
                reason: 'manual_reply', actor: 'tenant' });
            broadcast(`tenant:${tenantId}`, 'fb_message:new', { tenant_id: tenantId, page_id: page.page_id,
                conversation_id: conversation.id, direction: 'outgoing' });
        }
        return { metaResult: result, response: { success: true, message_id: messageId },
            receipt: { native_kind: 'messenger_message', native_id: String(localId || messageId || ''), provider_id: messageId,
                accepted: true, local_store_confirmed: localId != null, billing_usage_id: reservation?.id || null } };
    } catch (error) {
        if (!attempted) error.dispatched = false;
        else if (input.retainUncertainBudget === true) { error.dispatched = true; error.deliveryUncertain = true; }
        if (reservation && !settled && !error.deliveryUncertain) billing.release(reservation, error.message);
        throw error;
    }
};
