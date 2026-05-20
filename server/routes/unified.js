import express from 'express';
import db from '../db/database.js';
import { META_API_BASE } from '../config/index.js';
import { resolveCredentials } from '../services/credentials.js';
import { decryptIfEncrypted } from '../services/encryption.js';
import eventBus from '../services/eventBus.js';
import {
    insertMessengerMessage,
    normalizeMessengerTimestamp,
    selectMessengerMessages,
} from '../services/messengerMessages.js';
import { enrichTemplateFallbackMessages } from '../services/messaging.js';

const router = express.Router();

function resolvePageCredentials(linkedPageId) {
    const page = db.prepare('SELECT * FROM tenant_pages WHERE id = ? AND is_active = 1').get(linkedPageId);
    if (!page) return { error: 'الصفحة غير موجودة أو غير مفعلة', status: 404 };
    const accessToken = page.page_access_token_encrypted
        ? decryptIfEncrypted(page.page_access_token_encrypted)
        : null;
    if (!accessToken) return { error: 'رمز الوصول غير متوفر', status: 400 };
    return { page, accessToken };
}

router.get('/conversations', (req, res) => {
    try {
        const { channel: channelFilter, tenant_id: tenantIdFilter } = req.query;

        const waConversations = [];
        if (!channelFilter || channelFilter === 'whatsapp') {
            let waQuery = `
                SELECT
                    'whatsapp' as channel,
                    t.contact as contact_id,
                    t.tenant_id,
                    tenants.name as tenant_name,
                    t.created_at as last_message_time,
                    t.content as last_message,
                    t.message_type as last_message_type,
                    c.profile_name as display_name,
                    c.profile_picture_url as avatar_url,
                    c.last_ctwa_clid,
                    c.last_ctwa_source_id,
                    c.last_ctwa_source_type,
                    c.last_ctwa_source_url,
                    c.last_ctwa_received_at,
                    (SELECT COUNT(*) FROM messages m2
                     WHERE m2.sender = t.contact
                     AND m2.direction = 'incoming'
                     AND m2.status = 'received'
                     AND (m2.tenant_id = t.tenant_id OR (m2.tenant_id IS NULL AND t.tenant_id IS NULL))
                    ) as unread_count,
                    NULL as linked_page_id,
                    NULL as page_name
                FROM (
                    SELECT
                        id, content, created_at, message_type, tenant_id,
                        CASE WHEN direction = 'incoming' THEN sender ELSE recipient END as contact,
                        ROW_NUMBER() OVER (
                            PARTITION BY (
                                CASE WHEN direction = 'incoming' THEN sender ELSE recipient END
                            ), tenant_id
                            ORDER BY created_at DESC, id DESC
                        ) as rn
                    FROM messages
                ) t
                LEFT JOIN contacts c ON c.phone = t.contact AND (c.tenant_id = t.tenant_id OR (c.tenant_id IS NULL AND t.tenant_id IS NULL))
                LEFT JOIN tenants ON tenants.id = t.tenant_id
                WHERE rn = 1
            `;
            const waParams = [];
            if (tenantIdFilter) {
                waQuery += ` AND t.tenant_id = ?`;
                waParams.push(tenantIdFilter);
            }
            waConversations.push(...enrichTemplateFallbackMessages(db.prepare(waQuery).all(...waParams), 'last_message'));
        }

        const fbConversations = [];
        if (!channelFilter || channelFilter === 'messenger') {
            let fbQuery = `
                SELECT
                    'messenger' as channel,
                    fc.user_psid as contact_id,
                    fc.tenant_id,
                    tenants.name as tenant_name,
                    CASE
                        WHEN fc.last_message_time GLOB '????-??-??T??:??:??*'
                            THEN datetime(substr(replace(fc.last_message_time, 'T', ' '), 1, 19), 'localtime')
                        ELSE fc.last_message_time
                    END AS last_message_time,
                    fc.last_message,
                    NULL as last_message_type,
                    fc.user_name as display_name,
                    fc.user_profile_pic as avatar_url,
                    fc.unread_count,
                    fc.linked_page_id,
                    tp.page_name,
                    fc.id as conversation_id,
                    fc.page_id
                FROM fb_conversations fc
                LEFT JOIN tenants ON tenants.id = fc.tenant_id
                LEFT JOIN tenant_pages tp ON tp.id = fc.linked_page_id
                WHERE fc.is_active = 1
            `;
            const fbParams = [];
            if (tenantIdFilter) {
                fbQuery += ` AND fc.tenant_id = ?`;
                fbParams.push(tenantIdFilter);
            }
            fbQuery += ` ORDER BY last_message_time DESC NULLS LAST`;
            fbConversations.push(...db.prepare(fbQuery).all(...fbParams));
        }

        const unified = [...waConversations, ...fbConversations]
            .sort((a, b) => new Date(b.last_message_time) - new Date(a.last_message_time));

        res.json(unified);
    } catch (error) {
        console.error('[Unified] Conversations fetch error:', error);
        res.status(500).json({ error: 'فشل جلب المحادثات' });
    }
});

router.get('/conversations/:channel/:id/messages', async (req, res) => {
    try {
        const { channel } = req.params;
        const contactId = decodeURIComponent(req.params.id);
        const { tenant_id, linked_page_id, conversation_id } = req.query;

        if (channel === 'whatsapp') {
            let query = `
                SELECT * FROM messages
                WHERE (sender = ? OR recipient = ?)
            `;
            const params = [contactId, contactId];

            if (tenant_id && tenant_id !== 'null' && tenant_id !== 'undefined') {
                query += ` AND tenant_id = ?`;
                params.push(tenant_id);
            } else {
                query += ` AND tenant_id IS NULL`;
            }

            query += ` ORDER BY created_at ASC`;
            const messages = enrichTemplateFallbackMessages(db.prepare(query).all(...params));

            db.prepare(`
                UPDATE messages SET status = 'read'
                WHERE sender = ? AND direction = 'incoming' AND status = 'received'
            `).run(contactId);

            res.json(messages);
        } else if (channel === 'messenger') {
            if (!conversation_id) {
                return res.status(400).json({ error: 'conversation_id is required for messenger channel' });
            }

            const messages = selectMessengerMessages(db, {
                conversationId: parseInt(conversation_id),
                unified: true,
            });

            res.json(messages);
        } else {
            res.status(400).json({ error: 'Invalid channel. Use "whatsapp" or "messenger".' });
        }
    } catch (error) {
        console.error('[Unified] Messages fetch error:', error);
        res.status(500).json({ error: 'فشل جلب الرسائل' });
    }
});

router.post('/conversations/:channel/:id/send', async (req, res) => {
    try {
        const { channel } = req.params;
        const contactId = decodeURIComponent(req.params.id);
        const { message, tenant_id, phone_number_id, access_token, linked_page_id } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'الرسالة مطلوبة' });
        }

        if (channel === 'whatsapp') {
            const credentials = resolveCredentials({
                tenantId: tenant_id,
                phoneNumberIdOverride: phone_number_id,
                accessTokenOverride: access_token,
            });

            if (credentials.isSuspended) {
                return res.status(403).json({ error: 'الحساب موقوف' });
            }
            if (!credentials.phoneNumberId || !credentials.accessToken) {
                return res.status(400).json({ error: 'بيانات الاعتماد غير مكتملة' });
            }

            const formattedNumber = contactId.replace(/\+/g, '').trim();

            const response = await fetch(`${META_API_BASE}/${credentials.phoneNumberId}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${credentials.accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to: formattedNumber,
                    type: 'text',
                    text: { body: message.trim() },
                }),
            });

            const data = await response.json();

            if (response.ok) {
                const messageId = data.messages?.[0]?.id;
                db.prepare(`
                    INSERT INTO messages (tenant_id, direction, sender, recipient, message_type, content, status, wamid)
                    VALUES (?, 'outgoing', ?, ?, 'text', ?, 'sent', ?)
                `).run(tenant_id || null, credentials.phoneNumberId, formattedNumber, message.trim(), messageId);

                eventBus.emitNewMessage({
                    tenant_id: tenant_id,
                    tenant_name: credentials.tenant?.name,
                    direction: 'outgoing',
                    sender: credentials.phoneNumberId,
                    recipient: formattedNumber,
                    content: message.trim(),
                    wamid: messageId,
                });
                eventBus.emitConversationUpdate(tenant_id);

                res.json({ success: true, message_id: messageId });
            } else {
                console.error('[Unified] WA send error:', data.error);
                res.status(response.status).json({ error: data.error?.message || 'فشل إرسال الرسالة' });
            }
        } else if (channel === 'messenger') {
            if (!linked_page_id) {
                return res.status(400).json({ error: 'linked_page_id is required for messenger channel' });
            }

            const result = resolvePageCredentials(linked_page_id);
            if (result.error) return res.status(result.status).json({ error: result.error });
            const { page, accessToken } = result;

            const conv = db.prepare(
                'SELECT * FROM fb_conversations WHERE user_psid = ? AND linked_page_id = ? AND is_active = 1 LIMIT 1'
            ).get(contactId, linked_page_id);

            const userPsid = contactId;

            const sendResponse = await fetch(`${META_API_BASE}/${page.page_id}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    recipient: { id: userPsid },
                    messaging_type: 'RESPONSE',
                    message: { text: message.trim() },
                }),
            });

            const sendData = await sendResponse.json();

            if (sendResponse.ok) {
                const mid = sendData.message_id;

                if (conv) {
                    const createdAt = normalizeMessengerTimestamp();
                    insertMessengerMessage(db, {
                        conversationId: conv.id,
                        tenantId: conv.tenant_id,
                        mid,
                        direction: 'outgoing',
                        senderId: page.page_id,
                        senderName: page.page_name,
                        messageText: message.trim(),
                        createdAt,
                    });

                    db.prepare(`
                        UPDATE fb_conversations
                        SET last_message = ?, last_message_time = ?
                        WHERE id = ?
                    `).run(message.trim().substring(0, 100), createdAt, conv.id);

                    eventBus.broadcast('admin', 'fb_message:new', {
                        tenant_id: conv.tenant_id,
                        page_id: page.page_id,
                        conversation_id: conv.id,
                        direction: 'outgoing',
                        sender_id: page.page_id,
                        sender_name: page.page_name,
                        message: message.trim(),
                    });
                    eventBus.broadcast(`tenant:${conv.tenant_id}`, 'fb_message:new', {
                        tenant_id: conv.tenant_id,
                        page_id: page.page_id,
                        conversation_id: conv.id,
                        direction: 'outgoing',
                        sender_id: page.page_id,
                        sender_name: page.page_name,
                        message: message.trim(),
                    });
                }

                res.json({ success: true, message_id: mid });
            } else {
                console.error('[Unified] Messenger send error:', sendData.error);
                // Outside 24-hour messaging window
                if (sendData.error?.code === 10) {
                    res.status(403).json({
                        error: 'انتهت نافذة الـ 24 ساعة للرد. استخدم "رسالة خدمية" للتواصل خارج هذه النافذة.',
                        error_code: 'OUTSIDE_WINDOW',
                    });
                } else {
                    res.status(sendResponse.status).json({ error: sendData.error?.message || 'فشل إرسال الرسالة' });
                }
            }
        } else {
            res.status(400).json({ error: 'Invalid channel' });
        }
    } catch (error) {
        console.error('[Unified] Send message error:', error);
        res.status(500).json({ error: 'فشل إرسال الرسالة' });
    }
});

router.post('/conversations/:channel/:id/read', async (req, res) => {
    try {
        const { channel } = req.params;
        const contactId = decodeURIComponent(req.params.id);
        const { tenant_id, linked_page_id, conversation_id, message_id, phone_number_id, access_token } = req.body;

        if (channel === 'whatsapp') {
            if (message_id) {
                try {
                    const credentials = resolveCredentials({
                        tenantId: tenant_id,
                        phoneNumberIdOverride: phone_number_id,
                        accessTokenOverride: access_token,
                    });

                    if (credentials.phoneNumberId && credentials.accessToken && !credentials.isSuspended) {
                        await fetch(`${META_API_BASE}/${credentials.phoneNumberId}/messages`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${credentials.accessToken}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                messaging_product: 'whatsapp',
                                status: 'read',
                                message_id: message_id,
                            }),
                        });
                    }
                } catch {
                    // Best-effort, don't block
                }
            }

            db.prepare(`
                UPDATE messages SET status = 'read'
                WHERE sender = ? AND direction = 'incoming' AND status = 'received'
            `).run(contactId);

            res.json({ success: true });
        } else if (channel === 'messenger') {
            if (!conversation_id) {
                return res.status(400).json({ error: 'conversation_id is required for messenger channel' });
            }

            db.prepare(`
                UPDATE fb_messages SET is_read = 1
                WHERE conversation_id = ? AND direction = 'incoming' AND is_read = 0
            `).run(parseInt(conversation_id));

            db.prepare(`
                UPDATE fb_conversations SET unread_count = 0
                WHERE id = ?
            `).run(parseInt(conversation_id));

            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'Invalid channel' });
        }
    } catch (error) {
        console.error('[Unified] Mark read error:', error);
        res.status(500).json({ error: 'فشل تحديد الرسائل كمقروءة' });
    }
});

export default router;
