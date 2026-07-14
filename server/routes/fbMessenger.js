import express from 'express';
import db from '../db/database.js';
import { META_API_BASE } from '../config/index.js';
import { decrypt } from '../services/encryption.js';
import eventBus from '../services/eventBus.js';
import {
    getTimestampMs,
    insertMessengerMessage,
    normalizeMessengerTimestamp,
    selectMessengerMessages,
} from '../services/messengerMessages.js';
import {
    BILLING_OPERATIONS,
    commit as commitBilling,
    handleBillingError,
    release as releaseBilling,
    reserve as reserveBilling,
} from '../services/billing.js';
import { markBotHandoffForConversation } from '../services/messengerBot.js';
import { readMetaResponse, sendMetaFailure } from '../services/metaHttp.js';
import { parseListPagination } from '../services/pagination.js';

const router = express.Router();

const resolvePageCredentials = (linkedPageId) => {
    const page = db.prepare('SELECT * FROM tenant_pages WHERE id = ? AND is_active = 1').get(linkedPageId);
    if (!page) return { error: 'الصفحة غير موجودة أو غير مفعلة', status: 404 };
    const accessToken = decrypt(page.page_access_token_encrypted);
    if (!accessToken) return { error: 'رمز الوصول غير صالح', status: 400 };
    return { page, accessToken };
};

// ============================================
// List conversations for a linked page
// ============================================
router.get('/:linkedPageId/conversations', (req, res) => {
    try {
        const { linkedPageId } = req.params;
        const { limit, offset } = parseListPagination(req.query, {
            defaultLimit: 100,
            maxLimit: 200,
            maxOffset: 5000,
        });
        const page = db.prepare('SELECT id FROM tenant_pages WHERE id = ? AND is_active = 1').get(linkedPageId);
        if (!page) {
            return res.status(404).json({ error: 'الصفحة غير موجودة أو غير مفعلة' });
        }

        const conversations = db.prepare(`
            SELECT
                c.*,
                CASE
                    WHEN c.last_message_time GLOB '????-??-??T??:??:??*'
                        THEN datetime(substr(replace(c.last_message_time, 'T', ' '), 1, 19), 'localtime')
                    ELSE c.last_message_time
                END AS last_message_time,
                tp.page_name AS page_name
            FROM fb_conversations c
            JOIN tenant_pages tp ON c.linked_page_id = tp.id
            WHERE c.linked_page_id = ? AND c.is_active = 1
            ORDER BY last_message_time DESC NULLS LAST
            LIMIT ? OFFSET ?
        `).all(linkedPageId, limit, offset);

        res.json(conversations);
    } catch (error) {
        console.error('[FBMessenger] List conversations error:', error);
        res.status(500).json({ error: 'فشل جلب المحادثات' });
    }
});

// ============================================
// Get messages in a conversation
// ============================================
router.get('/:linkedPageId/conversations/:conversationId/messages', (req, res) => {
    try {
        const { linkedPageId, conversationId } = req.params;
        const { before } = req.query;
        const { limit, offset } = parseListPagination(req.query, {
            defaultLimit: 50,
            maxLimit: 200,
            maxOffset: 5000,
        });

        const conv = db.prepare('SELECT * FROM fb_conversations WHERE id = ? AND linked_page_id = ?').get(conversationId, linkedPageId);
        if (!conv) {
            return res.status(404).json({ error: 'المحادثة غير موجودة' });
        }

        const beforeId = before === undefined ? null : Number.parseInt(before, 10);
        if (before !== undefined && !Number.isInteger(beforeId)) {
            return res.status(400).json({ error: 'before غير صالح' });
        }

        const messages = selectMessengerMessages(db, {
            conversationId: Number(conversationId),
            beforeId,
            limit,
            offset,
            newestFirst: true,
        }).reverse();

        // Return in chronological order (oldest first)
        res.json(messages);
    } catch (error) {
        console.error('[FBMessenger] Get messages error:', error);
        res.status(500).json({ error: 'فشل جلب الرسائل' });
    }
});

// ============================================
// Send a text reply
// ============================================
router.post('/:linkedPageId/conversations/:conversationId/send', async (req, res) => {
    let billingReservation = null;
    try {
        const { linkedPageId, conversationId } = req.params;
        const { message } = req.body;

        if (!message?.trim()) {
            return res.status(400).json({ error: 'نص الرسالة مطلوب' });
        }

        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId);
        if (error) return res.status(status).json({ error });

        const conv = db.prepare('SELECT * FROM fb_conversations WHERE id = ? AND linked_page_id = ?').get(conversationId, linkedPageId);
        if (!conv) {
            return res.status(404).json({ error: 'المحادثة غير موجودة' });
        }

        billingReservation = reserveBilling({
            tenantId: conv.tenant_id,
            operationKey: BILLING_OPERATIONS.MESSENGER_REPLY,
            quantity: 1,
            referenceType: 'messenger_message',
            metadata: { linked_page_id: linkedPageId, conversation_id: conversationId, user_psid: conv.user_psid },
        });

        // Send via Meta Send API
        const sendResponse = await fetch(`${META_API_BASE}/${page.page_id}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                recipient: { id: conv.user_psid },
                messaging_type: 'RESPONSE',
                message: { text: message },
            }),
        });

        const sendResult = await readMetaResponse(sendResponse);
        const sendData = sendResult.data || {};

        if (!sendResult.ok) {
            releaseBilling(billingReservation, sendResult.error?.message || 'Meta Messenger reply failed');
            // Outside 24-hour messaging window
            if (sendResult.error?.code === 10) {
                return res.status(403).json({
                    error: 'انتهت نافذة الـ 24 ساعة للرد. استخدم "رسالة خدمية" للتواصل خارج هذه النافذة.',
                    error_code: 'OUTSIDE_WINDOW',
                    details: sendResult.error,
                });
            }
            return sendMetaFailure(res, sendResult, 'فشل إرسال الرسالة');
        }

        const mid = sendData.message_id;
        commitBilling(billingReservation, {
            referenceId: mid,
            description: 'خصم رد Messenger',
        });

        const createdAt = normalizeMessengerTimestamp();
        insertMessengerMessage(db, {
            conversationId: conv.id,
            tenantId: conv.tenant_id,
            mid,
            direction: 'outgoing',
            senderId: page.page_id,
            senderName: page.page_name,
            messageText: message,
            createdAt,
        });

        // Update conversation
        db.prepare(`
            UPDATE fb_conversations SET last_message = ?, last_message_time = ?, updated_at = datetime('now', 'localtime') WHERE id = ?
        `).run(message.substring(0, 100), createdAt, conv.id);

        markBotHandoffForConversation({
            tenantId: conv.tenant_id,
            linkedPageId: Number(linkedPageId),
            conversationId: conv.id,
            userPsid: conv.user_psid,
            reason: 'manual_reply',
            actor: 'admin',
        });

        // Emit SSE
        const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(conv.tenant_id);
        eventBus.broadcast('admin', 'fb_message:new', {
            tenant_id: conv.tenant_id,
            page_id: conv.page_id,
            conversation_id: conv.id,
            direction: 'outgoing',
            sender_id: page.page_id,
            sender_name: page.page_name,
            message,
        });
        eventBus.broadcast(`tenant:${conv.tenant_id}`, 'fb_message:new', {
            tenant_id: conv.tenant_id,
            page_id: conv.page_id,
            conversation_id: conv.id,
            direction: 'outgoing',
            sender_id: page.page_id,
            sender_name: page.page_name,
            message,
        });

        res.status(201).json({ id: mid, conversation_id: conv.id });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[FBMessenger] Billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[FBMessenger] Send message error:', error);
        res.status(500).json({ error: 'فشل إرسال الرسالة' });
    }
});

// ============================================
// Mark conversation as read
// ============================================
router.post('/:linkedPageId/conversations/:conversationId/read', (req, res) => {
    try {
        const { linkedPageId, conversationId } = req.params;

        const conv = db.prepare('SELECT * FROM fb_conversations WHERE id = ? AND linked_page_id = ?').get(conversationId, linkedPageId);
        if (!conv) {
            return res.status(404).json({ error: 'المحادثة غير موجودة' });
        }

        db.prepare("UPDATE fb_conversations SET unread_count = 0, updated_at = datetime('now', 'localtime') WHERE id = ?").run(conv.id);
        db.prepare('UPDATE fb_messages SET is_read = 1 WHERE conversation_id = ? AND direction = ? AND is_read = 0').run(conv.id, 'incoming');

        res.json({ success: true });
    } catch (error) {
        console.error('[FBMessenger] Mark read error:', error);
        res.status(500).json({ error: 'فشل تحديث حالة القراءة' });
    }
});

// ============================================
// Sync conversations from Meta API
// ============================================
router.post('/:linkedPageId/sync', async (req, res) => {
    try {
        const { linkedPageId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId);
        if (error) return res.status(status).json({ error });

        // Fetch conversations from Meta
        const fields = 'participants,updated_time,messages.limit(5){message,from,created_time,mid,attachments}';
        const response = await fetch(
            `${META_API_BASE}/${page.page_id}/conversations?fields=${fields}&access_token=${accessToken}`
        );
        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            return sendMetaFailure(res, metaResult, 'فشل جلب المحادثات من فيسبوك');
        }

        let syncedConversations = 0;
        let syncedMessages = 0;

        for (const conv of (data.data || [])) {
            // Extract user PSID from participants
            const participants = conv.participants?.data || [];
            const userParticipant = participants.find(p => p.id !== page.page_id);
            if (!userParticipant) continue;

            const userPsid = userParticipant.id;
            const userName = userParticipant.name || null;

            // Find the most recent message text for preview
            const messages = conv.messages?.data || [];
            const lastMsg = messages.length > 0
                ? messages.reduce((a, b) => (getTimestampMs(a.created_time) > getTimestampMs(b.created_time) ? a : b))
                : null;
            const lastMsgText = lastMsg ? (lastMsg.message || '[مرفق]').substring(0, 100) : '';
            const lastMsgTime = normalizeMessengerTimestamp(conv.updated_time || (lastMsg ? lastMsg.created_time : null));

            // Upsert conversation
            let dbConv = db.prepare(
                'SELECT * FROM fb_conversations WHERE linked_page_id = ? AND user_psid = ?'
            ).get(linkedPageId, userPsid);

            if (!dbConv) {
                db.prepare(`
                    INSERT INTO fb_conversations (tenant_id, linked_page_id, page_id, user_psid, user_name, user_profile_pic, last_message, last_message_time, unread_count)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                `).run(page.tenant_id, linkedPageId, page.page_id, userPsid, userName, null, lastMsgText, lastMsgTime);

                dbConv = db.prepare(
                    'SELECT * FROM fb_conversations WHERE linked_page_id = ? AND user_psid = ?'
                ).get(linkedPageId, userPsid);
                syncedConversations++;
            } else {
                // Only update if the conversation has newer activity
                const existingTime = dbConv.last_message_time ? getTimestampMs(dbConv.last_message_time) : 0;
                const newTime = getTimestampMs(lastMsgTime);
                if (newTime > existingTime) {
                    db.prepare(`
                        UPDATE fb_conversations SET
                            last_message = ?, last_message_time = ?,
                            user_name = COALESCE(?, user_name),
                            updated_at = datetime('now', 'localtime')
                        WHERE id = ?
                    `).run(lastMsgText, lastMsgTime, userName, dbConv.id);
                }
            }

            // Insert messages through the shared store so mid/timestamp handling stays consistent.
            for (const msg of messages) {
                const mid = msg.mid;
                const existing = mid ? db.prepare('SELECT id FROM fb_messages WHERE mid = ?').get(mid) : null;
                if (existing) continue;

                const direction = msg.from?.id === page.page_id ? 'outgoing' : 'incoming';
                const attachment = msg.attachments?.data?.[0] || null;
                const result = insertMessengerMessage(db, {
                    conversationId: dbConv.id,
                    tenantId: page.tenant_id,
                    mid,
                    direction,
                    senderId: msg.from?.id,
                    senderName: msg.from?.name,
                    messageText: msg.message || '',
                    attachmentType: attachment?.type || null,
                    attachmentUrl: attachment?.payload?.url || null,
                    createdAt: msg.created_time,
                });

                if (result.inserted) syncedMessages++;
            }
        }

        res.json({
            success: true,
            synced_conversations: syncedConversations,
            synced_messages: syncedMessages,
        });
    } catch (error) {
        console.error('[FBMessenger] Sync error:', error);
        res.status(500).json({ error: 'فشل مزامنة المحادثات' });
    }
});

// ============================================
// Send utility message (MESSAGE_TAG) — outside 24-hour window
// NOTE: As of Feb 10, 2026, Meta deprecated CONFIRMED_EVENT_UPDATE,
// POST_PURCHASE_UPDATE, and ACCOUNT_UPDATE tags.
// Only HUMAN_AGENT remains, which requires App Review approval.
// ============================================
const VALID_MESSAGE_TAGS = [
    'HUMAN_AGENT',              // Human agent response (7-day window) — requires App Review
];

router.post('/:linkedPageId/conversations/:conversationId/utility-message', async (req, res) => {
    let billingReservation = null;
    try {
        const { linkedPageId, conversationId } = req.params;
        const { message, tag } = req.body;

        if (!message || !tag) {
            return res.status(400).json({ error: 'نص الرسالة ونوع العلامة مطلوبان' });
        }

        if (!VALID_MESSAGE_TAGS.includes(tag)) {
            return res.status(400).json({
                error: `علامة غير صالحة: ${tag}`,
                valid_tags: VALID_MESSAGE_TAGS
            });
        }

        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId);
        if (error) return res.status(status).json({ error });

        const conv = db.prepare('SELECT * FROM fb_conversations WHERE id = ? AND linked_page_id = ?').get(conversationId, linkedPageId);
        if (!conv) {
            return res.status(404).json({ error: 'المحادثة غير موجودة' });
        }

        billingReservation = reserveBilling({
            tenantId: conv.tenant_id,
            operationKey: BILLING_OPERATIONS.MESSENGER_UTILITY,
            quantity: 1,
            referenceType: 'messenger_message',
            metadata: { linked_page_id: linkedPageId, conversation_id: conversationId, user_psid: conv.user_psid, tag },
        });

        // Send via Meta Send API with MESSAGE_TAG
        const sendResponse = await fetch(`${META_API_BASE}/${page.page_id}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                recipient: { id: conv.user_psid },
                messaging_type: 'MESSAGE_TAG',
                tag: tag,
                message: { text: message },
            }),
        });

        const sendResult = await readMetaResponse(sendResponse);
        const sendData = sendResult.data || {};

        if (!sendResult.ok) {
            releaseBilling(billingReservation, sendResult.error?.message || 'Meta Messenger utility failed');
            return sendMetaFailure(res, sendResult, 'فشل إرسال الرسالة');
        }

        const mid = sendData.message_id;
        commitBilling(billingReservation, {
            referenceId: mid,
            description: `خصم رسالة Messenger موسومة: ${tag}`,
        });

        const createdAt = normalizeMessengerTimestamp();
        insertMessengerMessage(db, {
            conversationId: conv.id,
            tenantId: conv.tenant_id,
            mid,
            direction: 'outgoing',
            senderId: page.page_id,
            senderName: page.page_name,
            messageText: `[${tag}] ${message}`,
            createdAt,
        });

        // Update conversation
        db.prepare(`
            UPDATE fb_conversations SET last_message = ?, last_message_time = ?, updated_at = datetime('now', 'localtime') WHERE id = ?
        `).run(message.substring(0, 100), createdAt, conv.id);

        markBotHandoffForConversation({
            tenantId: conv.tenant_id,
            linkedPageId: Number(linkedPageId),
            conversationId: conv.id,
            userPsid: conv.user_psid,
            reason: 'manual_utility_message',
            actor: 'admin',
        });

        // Emit SSE
        eventBus.broadcast('admin', 'fb_message:new', {
            tenant_id: conv.tenant_id,
            page_id: conv.page_id,
            conversation_id: conv.id,
            direction: 'outgoing',
            sender_id: page.page_id,
            sender_name: page.page_name,
            message: `[${tag}] ${message}`,
            tag,
        });

        res.status(201).json({ id: mid, conversation_id: conv.id, tag });
    } catch (error) {
        if (billingReservation) {
            try {
                releaseBilling(billingReservation, error.message);
            } catch (releaseError) {
                console.error('[FBMessenger] Utility billing release error:', releaseError);
            }
        }
        if (handleBillingError(res, error)) return;
        console.error('[FBMessenger] Utility message error:', error);
        res.status(500).json({ error: 'فشل إرسال الرسالة' });
    }
});

// ============================================
// Get available message tags
// ============================================
router.get('/message-tags', (req, res) => {
    res.json({
        tags: VALID_MESSAGE_TAGS.map(tag => ({
            value: tag,
            label: {
                'HUMAN_AGENT': 'رد وكيل بشري (يتطلب مراجعة التطبيق)',
            }[tag],
            description: {
                'HUMAN_AGENT': 'Send a response to a user within 7 days of their last message (requires App Review)',
            }[tag],
        })),
    });
});

export default router;
