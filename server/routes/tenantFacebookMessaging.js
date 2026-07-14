import express from 'express';

import { META_API_BASE } from '../config/index.js';
import { insertMessengerMessage, normalizeMessengerTimestamp } from '../services/messengerMessages.js';
import { requestMetaJson, sendMetaFailure } from '../services/metaHttp.js';
import { parseListPagination } from '../services/pagination.js';

const VALID_MESSAGE_TAGS = Object.freeze(['HUMAN_AGENT']);

const parsePositiveId = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 && String(parsed) === String(value).trim() ? parsed : null;
};

const resolveTenantPage = (database, decryptToken, linkedPageId, tenantId) => {
    const pageId = parsePositiveId(linkedPageId);
    if (!pageId) return { error: 'معرّف الصفحة غير صالح', status: 400 };
    const page = database.prepare(`
        SELECT id, tenant_id, page_id, page_name, page_access_token_encrypted,
               webhook_subscribed, is_active
        FROM tenant_pages
        WHERE id = ? AND tenant_id = ? AND is_active = 1
    `).get(pageId, tenantId);
    if (!page) return { error: 'الصفحة غير موجودة أو غير مفعلة', status: 404 };
    const accessToken = decryptToken(page.page_access_token_encrypted);
    if (!accessToken) return { error: 'رمز الوصول غير متوفر أو غير صالح', status: 400 };
    return { page, accessToken };
};

export function createTenantFacebookMessagingRouter({
    database,
    decryptToken,
    requestMeta = requestMetaJson,
    billing,
    markHandoff = () => null,
    broadcast = () => undefined,
} = {}) {
    if (!database || typeof decryptToken !== 'function' || !billing) {
        throw new TypeError('Tenant Facebook messaging router requires database, decryption and billing');
    }
    const router = express.Router();

    router.get('/pages', (req, res) => {
        try {
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 100,
                maxLimit: 200,
            });
            const pages = database.prepare(`
                SELECT id, tenant_id, platform, page_id, page_name, page_category,
                       page_picture_url, is_active, subscribed_fields,
                       webhook_subscribed, created_at, updated_at
                FROM tenant_pages
                WHERE tenant_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT ? OFFSET ?
            `).all(req.user.tenant_id, limit, offset);
            return res.json(pages);
        } catch (error) {
            console.error('[TenantFacebookMessaging] Pages list error:', error);
            return res.status(500).json({ error: 'فشل جلب صفحات فيسبوك' });
        }
    });

    router.get('/pages/:id/subscription-status', async (req, res) => {
        try {
            const { page, accessToken, error, status } = resolveTenantPage(
                database,
                decryptToken,
                req.params.id,
                req.user.tenant_id
            );
            if (error) return res.status(status).json({ error });
            const result = await requestMeta(
                `${META_API_BASE}/${encodeURIComponent(page.page_id)}/subscribed_apps`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (!result.ok) return sendMetaFailure(res, result, 'فشل جلب حالة الاشتراك');
            return res.json({
                page_id: page.page_id,
                page_name: page.page_name,
                webhook_subscribed_in_db: !!page.webhook_subscribed,
                meta_response: result.data || {},
            });
        } catch (error) {
            console.error('[TenantFacebookMessaging] Subscription status error:', error);
            return res.status(500).json({ error: 'فشل جلب حالة الاشتراك' });
        }
    });

    router.get('/fb-messenger/message-tags', (_req, res) => res.json({
        tags: [{
            value: 'HUMAN_AGENT',
            label: 'رد وكيل بشري (يتطلب مراجعة التطبيق)',
            description: 'Send a response to a user within 7 days of their last message (requires App Review)',
        }],
    }));

    router.post('/fb-messenger/:linkedPageId/conversations/:convId/utility-message', async (req, res) => {
        let billingReservation = null;
        try {
            const tenantId = req.user.tenant_id;
            const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
            const tag = typeof req.body?.tag === 'string' ? req.body.tag.trim() : '';
            if (!message || !tag) {
                return res.status(400).json({ error: 'نص الرسالة ونوع العلامة مطلوبان' });
            }
            if (!VALID_MESSAGE_TAGS.includes(tag)) {
                return res.status(400).json({ error: `علامة غير صالحة: ${tag}`, valid_tags: VALID_MESSAGE_TAGS });
            }

            const linkedPageId = parsePositiveId(req.params.linkedPageId);
            const conversationId = parsePositiveId(req.params.convId);
            if (!linkedPageId || !conversationId) {
                return res.status(400).json({ error: 'معرّف الصفحة أو المحادثة غير صالح' });
            }
            const { page, accessToken, error, status } = resolveTenantPage(
                database,
                decryptToken,
                linkedPageId,
                tenantId
            );
            if (error) return res.status(status).json({ error });
            const conversation = database.prepare(`
                SELECT id, tenant_id, linked_page_id, page_id, user_psid
                FROM fb_conversations
                WHERE id = ? AND linked_page_id = ? AND tenant_id = ?
            `).get(conversationId, linkedPageId, tenantId);
            if (!conversation) return res.status(404).json({ error: 'المحادثة غير موجودة' });

            billingReservation = billing.reserve({
                tenantId,
                operationKey: billing.operations.MESSENGER_UTILITY,
                quantity: 1,
                referenceType: 'messenger_message',
                metadata: {
                    linked_page_id: linkedPageId,
                    conversation_id: conversationId,
                    user_psid: conversation.user_psid,
                    tag,
                },
            });
            const result = await requestMeta(
                `${META_API_BASE}/${encodeURIComponent(page.page_id)}/messages`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        recipient: { id: conversation.user_psid },
                        messaging_type: 'MESSAGE_TAG',
                        tag,
                        message: { text: message },
                    }),
                }
            );
            if (!result.ok) {
                billing.release(billingReservation, result.error?.message || 'Meta Messenger utility failed');
                return sendMetaFailure(res, result, 'فشل إرسال الرسالة');
            }

            const mid = result.data?.message_id || null;
            billing.commit(billingReservation, {
                referenceId: mid,
                description: `خصم رسالة Messenger موسومة: ${tag}`,
            });
            const createdAt = normalizeMessengerTimestamp();
            database.transaction(() => {
                insertMessengerMessage(database, {
                    conversationId: conversation.id,
                    tenantId,
                    mid,
                    direction: 'outgoing',
                    senderId: page.page_id,
                    senderName: page.page_name,
                    messageText: `[${tag}] ${message}`,
                    createdAt,
                });
                database.prepare(`
                    UPDATE fb_conversations
                    SET last_message = ?, last_message_time = ?,
                        updated_at = datetime('now', 'localtime')
                    WHERE id = ? AND tenant_id = ?
                `).run(message.slice(0, 100), createdAt, conversation.id, tenantId);
            })();
            markHandoff({
                tenantId,
                linkedPageId,
                conversationId: conversation.id,
                userPsid: conversation.user_psid,
                reason: 'manual_utility_message',
                actor: 'tenant',
            });
            broadcast(`tenant:${tenantId}`, 'fb_message:new', {
                tenant_id: tenantId,
                page_id: conversation.page_id,
                conversation_id: conversation.id,
                direction: 'outgoing',
                sender_id: page.page_id,
                sender_name: page.page_name,
                message: `[${tag}] ${message}`,
                tag,
            });
            return res.status(201).json({ id: mid, conversation_id: conversation.id, tag });
        } catch (error) {
            if (billingReservation) {
                try {
                    billing.release(billingReservation, error.message);
                } catch (releaseError) {
                    console.error('[TenantFacebookMessaging] Billing release error:', releaseError);
                }
            }
            if (billing.handleError(res, error)) return undefined;
            console.error('[TenantFacebookMessaging] Utility message error:', error);
            return res.status(500).json({ error: 'فشل إرسال الرسالة' });
        }
    });

    return router;
}

export default createTenantFacebookMessagingRouter;
