import express from 'express';

import { META_API_BASE } from '../config/index.js';
import { enrichTemplateFallbackMessages } from '../services/messaging.js';
import {
    insertMessengerMessage,
    normalizeMessengerTimestamp,
    selectMessengerMessages,
} from '../services/messengerMessages.js';
import { requestMetaJson, sendMetaFailure } from '../services/metaHttp.js';
import { parseListPagination } from '../services/pagination.js';

const VALID_CHANNELS = new Set(['whatsapp', 'messenger']);

const normalizeString = (value, maxLength) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized && normalized.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(normalized)
        ? normalized
        : null;
};

const parsePositiveId = value => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 && String(parsed) === String(value).trim() ? parsed : null;
};

const normalizeWhatsAppRecipient = value => {
    const normalized = normalizeString(value, 64)?.replace(/\+/g, '').replace(/\s/g, '');
    return normalized && /^\d{5,20}$/.test(normalized) ? normalized : null;
};

export function createTenantUnifiedInboxRouter({
    database,
    accessTokenForTenant,
    decryptToken,
    requestMeta = requestMetaJson,
    billing,
    emitNewMessage = () => undefined,
    emitConversationUpdate = () => undefined,
    broadcast = () => undefined,
    markHandoff = () => undefined,
} = {}) {
    if (
        !database
        || typeof accessTokenForTenant !== 'function'
        || typeof decryptToken !== 'function'
        || !billing
    ) {
        throw new TypeError('Tenant unified inbox router requires database, credentials and billing');
    }
    const router = express.Router();

    router.post('/mark-read', async (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const messageId = normalizeString(req.body?.message_id, 512);
            if (!messageId) return res.status(400).json({ error: 'message_id is required' });
            const tenant = database.prepare(`
                SELECT id, phone_number_id, status FROM tenants WHERE id = ?
            `).get(tenantId);
            if (!tenant) return res.status(404).json({ error: 'العميل غير موجود' });
            if (tenant.status === 'Suspended') return res.status(403).json({ error: 'الحساب موقوف' });
            const accessToken = accessTokenForTenant(tenantId);
            if (!tenant.phone_number_id || !accessToken) {
                return res.status(400).json({ error: 'بيانات الاعتماد غير مكتملة' });
            }
            const result = await requestMeta(
                `${META_API_BASE}/${encodeURIComponent(tenant.phone_number_id)}/messages`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        status: 'read',
                        message_id: messageId,
                    }),
                }
            );
            if (!result.ok) return sendMetaFailure(res, result, 'فشل تحديد كمقروء');
            return res.json({ success: true });
        } catch (error) {
            console.error('[TenantUnifiedInbox] Mark read error:', error);
            return res.status(500).json({ error: 'فشل تحديد الرسالة كمقروءة' });
        }
    });

    router.get('/unified/conversations', (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const channel = req.query?.channel == null ? null : normalizeString(req.query.channel, 32);
            if (channel && !VALID_CHANNELS.has(channel)) {
                return res.status(400).json({ error: 'القناة غير صالحة' });
            }
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 100,
                maxLimit: 200,
                maxOffset: 5000,
            });
            const sourceWindowSize = limit + offset;
            const whatsapp = [];
            if (!channel || channel === 'whatsapp') {
                whatsapp.push(...enrichTemplateFallbackMessages(database.prepare(`
                    SELECT
                        'whatsapp' AS channel,
                        latest.contact AS contact_id,
                        latest.tenant_id,
                        tenant.name AS tenant_name,
                        latest.created_at AS last_message_time,
                        latest.content AS last_message,
                        latest.message_type AS last_message_type,
                        contact.profile_name AS display_name,
                        contact.profile_picture_url AS avatar_url,
                        contact.last_ctwa_clid,
                        contact.last_ctwa_source_id,
                        contact.last_ctwa_source_type,
                        contact.last_ctwa_source_url,
                        contact.last_ctwa_received_at,
                        (
                            SELECT COUNT(*) FROM messages unread
                            WHERE unread.sender = latest.contact
                              AND unread.direction = 'incoming'
                              AND unread.status = 'received'
                              AND unread.tenant_id = ?
                        ) AS unread_count,
                        NULL AS linked_page_id,
                        NULL AS page_name
                    FROM (
                        SELECT
                            id, content, created_at, message_type, tenant_id,
                            CASE WHEN direction = 'incoming' THEN sender ELSE recipient END AS contact,
                            ROW_NUMBER() OVER (
                                PARTITION BY CASE
                                    WHEN direction = 'incoming' THEN sender ELSE recipient
                                END
                                ORDER BY created_at DESC, id DESC
                            ) AS row_number
                        FROM messages
                        WHERE tenant_id = ?
                    ) latest
                    LEFT JOIN contacts contact
                      ON contact.phone = latest.contact AND contact.tenant_id = ?
                    LEFT JOIN tenants tenant ON tenant.id = latest.tenant_id
                    WHERE latest.row_number = 1
                    ORDER BY last_message_time DESC
                    LIMIT ?
                `).all(tenantId, tenantId, tenantId, sourceWindowSize), 'last_message', database));
            }

            const messenger = [];
            if (!channel || channel === 'messenger') {
                messenger.push(...database.prepare(`
                    SELECT
                        'messenger' AS channel,
                        conversation.user_psid AS contact_id,
                        conversation.tenant_id,
                        tenant.name AS tenant_name,
                        CASE
                            WHEN conversation.last_message_time GLOB '????-??-??T??:??:??*'
                                THEN datetime(substr(replace(conversation.last_message_time, 'T', ' '), 1, 19), 'localtime')
                            ELSE conversation.last_message_time
                        END AS last_message_time,
                        conversation.last_message,
                        NULL AS last_message_type,
                        conversation.user_name AS display_name,
                        conversation.user_profile_pic AS avatar_url,
                        conversation.unread_count,
                        conversation.linked_page_id,
                        page.page_name,
                        conversation.id AS conversation_id,
                        conversation.page_id
                    FROM fb_conversations conversation
                    LEFT JOIN tenants tenant ON tenant.id = conversation.tenant_id
                    LEFT JOIN tenant_pages page
                      ON page.id = conversation.linked_page_id AND page.tenant_id = conversation.tenant_id
                    WHERE conversation.is_active = 1 AND conversation.tenant_id = ?
                    ORDER BY last_message_time DESC NULLS LAST
                    LIMIT ?
                `).all(tenantId, sourceWindowSize));
            }

            return res.json([...whatsapp, ...messenger]
                .sort((left, right) => (
                    new Date(right.last_message_time || 0) - new Date(left.last_message_time || 0)
                ))
                .slice(offset, offset + limit));
        } catch (error) {
            console.error('[TenantUnifiedInbox] Conversations error:', error);
            return res.status(500).json({ error: 'فشل جلب المحادثات' });
        }
    });

    router.get('/unified/:channel/:id/messages', (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const channel = normalizeString(req.params.channel, 32);
            const contactId = normalizeString(req.params.id, 256);
            if (!VALID_CHANNELS.has(channel) || !contactId) {
                return res.status(400).json({ error: 'القناة أو جهة الاتصال غير صالحة' });
            }
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 100,
                maxLimit: 200,
                maxOffset: 5000,
            });

            if (channel === 'whatsapp') {
                const messages = enrichTemplateFallbackMessages(database.prepare(`
                    SELECT * FROM (
                        SELECT
                            id, tenant_id, direction, recipient, sender, message_type,
                            content, status, wamid, error_message, media_id, media_url,
                            media_mime_type, referral_ctwa_clid, referral_source_id,
                            referral_source_type, referral_source_url, created_at
                        FROM messages
                        WHERE (sender = ? OR recipient = ?) AND tenant_id = ?
                        ORDER BY created_at DESC, id DESC
                        LIMIT ? OFFSET ?
                    ) page
                    ORDER BY created_at ASC, id ASC
                `).all(contactId, contactId, tenantId, limit, offset), 'content', database);
                database.prepare(`
                    UPDATE messages SET status = 'read'
                    WHERE sender = ? AND direction = 'incoming'
                      AND status = 'received' AND tenant_id = ?
                `).run(contactId, tenantId);
                return res.json(messages);
            }

            const conversationId = parsePositiveId(req.query?.conversation_id);
            if (!conversationId) return res.status(400).json({ error: 'conversation_id غير صالح' });
            const conversation = database.prepare(`
                SELECT id FROM fb_conversations
                WHERE id = ? AND tenant_id = ? AND user_psid = ? AND is_active = 1
            `).get(conversationId, tenantId, contactId);
            if (!conversation) return res.status(404).json({ error: 'المحادثة غير موجودة' });
            database.transaction(() => {
                database.prepare(`
                    UPDATE fb_messages SET is_read = 1
                    WHERE conversation_id = ? AND tenant_id = ?
                      AND direction = 'incoming' AND is_read = 0
                `).run(conversationId, tenantId);
                database.prepare(`
                    UPDATE fb_conversations
                    SET unread_count = 0, updated_at = datetime('now', 'localtime')
                    WHERE id = ? AND tenant_id = ?
                `).run(conversationId, tenantId);
            })();
            return res.json(selectMessengerMessages(database, {
                conversationId,
                tenantId,
                limit,
                offset,
                unified: true,
                newestFirst: true,
            }).reverse());
        } catch (error) {
            console.error('[TenantUnifiedInbox] Messages error:', error);
            return res.status(500).json({ error: 'فشل جلب الرسائل' });
        }
    });

    router.post('/unified/:channel/:id/send', async (req, res) => {
        let reservation = null;
        try {
            const tenantId = req.user.tenant_id;
            const channel = normalizeString(req.params.channel, 32);
            const contactId = normalizeString(req.params.id, 256);
            const message = normalizeString(req.body?.message, 4096);
            if (!VALID_CHANNELS.has(channel) || !contactId) {
                return res.status(400).json({ error: 'القناة أو جهة الاتصال غير صالحة' });
            }
            if (!message) return res.status(400).json({ error: 'الرسالة مطلوبة' });
            const tenant = database.prepare(`
                SELECT id, name, phone_number_id, status FROM tenants WHERE id = ?
            `).get(tenantId);
            if (!tenant) return res.status(404).json({ error: 'العميل غير موجود' });
            if (tenant.status === 'Suspended') return res.status(403).json({ error: 'حسابك معلّق' });

            if (channel === 'whatsapp') {
                const recipient = normalizeWhatsAppRecipient(contactId);
                const accessToken = accessTokenForTenant(tenantId);
                if (!recipient) return res.status(400).json({ error: 'رقم WhatsApp غير صالح' });
                if (!tenant.phone_number_id || !accessToken) {
                    return res.status(400).json({ error: 'إعدادات WhatsApp API غير مكتملة' });
                }
                reservation = billing.reserve({
                    tenantId,
                    operationKey: billing.operations.WHATSAPP_TEXT,
                    quantity: 1,
                    referenceType: 'message',
                    metadata: { channel: 'whatsapp', recipient },
                });
                const result = await requestMeta(
                    `${META_API_BASE}/${encodeURIComponent(tenant.phone_number_id)}/messages`,
                    {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            messaging_product: 'whatsapp',
                            to: recipient,
                            type: 'text',
                            text: { body: message },
                        }),
                    }
                );
                if (!result.ok) {
                    billing.release(reservation, result.error?.message || 'Meta WhatsApp send failed');
                    return sendMetaFailure(res, result, 'فشل إرسال الرسالة');
                }
                const messageId = result.data?.messages?.[0]?.id || null;
                billing.commit(reservation, {
                    referenceId: messageId,
                    description: 'خصم إرسال رسالة WhatsApp من صندوق الوارد',
                });
                database.prepare(`
                    INSERT INTO messages (
                        tenant_id, direction, sender, recipient,
                        message_type, content, status, wamid
                    ) VALUES (?, 'outgoing', ?, ?, 'text', ?, 'sent', ?)
                `).run(tenantId, tenant.phone_number_id, recipient, message, messageId);
                emitNewMessage({
                    tenant_id: tenantId,
                    tenant_name: tenant.name,
                    direction: 'outgoing',
                    sender: tenant.phone_number_id,
                    recipient,
                    content: message,
                    wamid: messageId,
                });
                emitConversationUpdate(tenantId);
                return res.json({ success: true, message_id: messageId });
            }

            const linkedPageId = parsePositiveId(req.body?.linked_page_id);
            if (!linkedPageId) return res.status(400).json({ error: 'linked_page_id غير صالح' });
            const page = database.prepare(`
                SELECT id, tenant_id, page_id, page_name, page_access_token_encrypted
                FROM tenant_pages
                WHERE id = ? AND tenant_id = ? AND is_active = 1
            `).get(linkedPageId, tenantId);
            if (!page) return res.status(404).json({ error: 'الصفحة غير موجودة' });
            const accessToken = decryptToken(page.page_access_token_encrypted);
            if (!accessToken) return res.status(400).json({ error: 'رمز الوصول غير متوفر' });
            const conversation = database.prepare(`
                SELECT id, tenant_id, linked_page_id, page_id, user_psid
                FROM fb_conversations
                WHERE user_psid = ? AND linked_page_id = ? AND tenant_id = ? AND is_active = 1
                LIMIT 1
            `).get(contactId, linkedPageId, tenantId);
            reservation = billing.reserve({
                tenantId,
                operationKey: billing.operations.MESSENGER_REPLY,
                quantity: 1,
                referenceType: 'messenger_message',
                metadata: {
                    linked_page_id: linkedPageId,
                    conversation_id: conversation?.id || null,
                    user_psid: contactId,
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
                        recipient: { id: contactId },
                        messaging_type: 'RESPONSE',
                        message: { text: message },
                    }),
                }
            );
            if (!result.ok) {
                billing.release(reservation, result.error?.message || 'Meta Messenger send failed');
                if (result.error?.code === 10) {
                    return res.status(403).json({
                        error: 'انتهت نافذة الـ 24 ساعة للرد. استخدم "رسالة خدمية" للتواصل خارج هذه النافذة.',
                        error_code: 'OUTSIDE_WINDOW',
                    });
                }
                return sendMetaFailure(res, result, 'فشل إرسال الرسالة');
            }
            const messageId = result.data?.message_id || null;
            billing.commit(reservation, {
                referenceId: messageId,
                description: 'خصم رد Messenger من صندوق الوارد',
            });
            if (conversation) {
                const createdAt = normalizeMessengerTimestamp();
                database.transaction(() => {
                    insertMessengerMessage(database, {
                        conversationId: conversation.id,
                        tenantId,
                        mid: messageId,
                        direction: 'outgoing',
                        senderId: page.page_id,
                        senderName: page.page_name,
                        messageText: message,
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
                    reason: 'manual_reply',
                    actor: 'tenant',
                });
                broadcast(`tenant:${tenantId}`, 'fb_message:new', {
                    tenant_id: tenantId,
                    page_id: page.page_id,
                    conversation_id: conversation.id,
                    direction: 'outgoing',
                });
            }
            return res.json({ success: true, message_id: messageId });
        } catch (error) {
            if (reservation) {
                try {
                    billing.release(reservation, error.message);
                } catch (releaseError) {
                    console.error('[TenantUnifiedInbox] Billing release error:', releaseError);
                }
            }
            if (billing.handleError(res, error)) return undefined;
            console.error('[TenantUnifiedInbox] Send error:', error);
            return res.status(500).json({ error: 'فشل إرسال الرسالة' });
        }
    });

    return router;
}

export default createTenantUnifiedInboxRouter;
