import express from 'express';
import db from '../db/database.js';
import { META_API_BASE } from '../config/index.js';
import { decrypt } from '../services/encryption.js';
import eventBus from '../services/eventBus.js';

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
        const page = db.prepare('SELECT id FROM tenant_pages WHERE id = ? AND is_active = 1').get(linkedPageId);
        if (!page) {
            return res.status(404).json({ error: 'الصفحة غير موجودة أو غير مفعلة' });
        }

        const conversations = db.prepare(`
            SELECT c.*, tp.page_name AS page_name
            FROM fb_conversations c
            JOIN tenant_pages tp ON c.linked_page_id = tp.id
            WHERE c.linked_page_id = ? AND c.is_active = 1
            ORDER BY c.last_message_time DESC NULLS LAST
        `).all(linkedPageId);

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
        const { limit = 50, before } = req.query;

        const conv = db.prepare('SELECT * FROM fb_conversations WHERE id = ? AND linked_page_id = ?').get(conversationId, linkedPageId);
        if (!conv) {
            return res.status(404).json({ error: 'المحادثة غير موجودة' });
        }

        let messages;
        if (before) {
            messages = db.prepare(`
                SELECT * FROM fb_messages
                WHERE conversation_id = ? AND id < ?
                ORDER BY created_at DESC
                LIMIT ?
            `).all(Number(conversationId), Number(before), Number(limit));
        } else {
            messages = db.prepare(`
                SELECT * FROM fb_messages
                WHERE conversation_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            `).all(Number(conversationId), Number(limit));
        }

        // Return in chronological order (oldest first)
        res.json(messages.reverse());
    } catch (error) {
        console.error('[FBMessenger] Get messages error:', error);
        res.status(500).json({ error: 'فشل جلب الرسائل' });
    }
});

// ============================================
// Send a text reply
// ============================================
router.post('/:linkedPageId/conversations/:conversationId/send', async (req, res) => {
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

        const sendData = await sendResponse.json();

        if (!sendResponse.ok || sendData.error) {
            return res.status(sendResponse.status || 400).json({
                error: sendData.error?.message || 'فشل إرسال الرسالة',
                details: sendData.error,
            });
        }

        const mid = sendData.message_id;

        // Store outgoing message in local DB
        db.prepare(`
            INSERT INTO fb_messages (conversation_id, tenant_id, mid, direction, sender_id, sender_name, message_text, created_at)
            VALUES (?, ?, ?, 'outgoing', ?, ?, ?, ?)
        `).run(conv.id, conv.tenant_id, mid, page.page_id, page.page_name, message, new Date().toISOString());

        // Update conversation
        db.prepare(`
            UPDATE fb_conversations SET last_message = ?, last_message_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(message.substring(0, 100), new Date().toISOString(), conv.id);

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

        db.prepare('UPDATE fb_conversations SET unread_count = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conv.id);
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
        const fields = 'participants,updated_time,messages.limit(5){message,from,created_time,mid}';
        const response = await fetch(
            `${META_API_BASE}/${page.page_id}/conversations?fields=${fields}&access_token=${accessToken}`
        );
        const data = await response.json();

        if (!response.ok || data.error) {
            return res.status(response.status || 400).json({
                error: data.error?.message || 'فشل جلب المحادثات من فيسبوك',
                details: data.error,
            });
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
                ? messages.reduce((a, b) => (a.created_time > b.created_time ? a : b))
                : null;
            const lastMsgText = lastMsg ? (lastMsg.message || '[مرفق]').substring(0, 100) : '';
            const lastMsgTime = conv.updated_time || (lastMsg ? lastMsg.created_time : null) || new Date().toISOString();

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
                const existingTime = dbConv.last_message_time ? new Date(dbConv.last_message_time).getTime() : 0;
                const newTime = new Date(lastMsgTime).getTime();
                if (newTime > existingTime) {
                    db.prepare(`
                        UPDATE fb_conversations SET
                            last_message = ?, last_message_time = ?,
                            user_name = COALESCE(?, user_name),
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `).run(lastMsgText, lastMsgTime, userName, dbConv.id);
                }
            }

            // Insert messages (dedup by mid)
            for (const msg of messages) {
                // Guard against null mid — generate a deterministic fallback
                const mid = msg.mid || `${dbConv.id}_${msg.from?.id || 'unknown'}_${msg.created_time || Date.now()}`;
                const existing = db.prepare('SELECT id FROM fb_messages WHERE mid = ?').get(mid);
                if (existing) continue;

                const direction = msg.from?.id === page.page_id ? 'outgoing' : 'incoming';
                db.prepare(`
                    INSERT INTO fb_messages (conversation_id, tenant_id, mid, direction, sender_id, sender_name, message_text, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(dbConv.id, page.tenant_id, mid, direction, msg.from?.id, msg.from?.name, msg.message || '', msg.created_time || new Date().toISOString());

                syncedMessages++;
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

export default router;
