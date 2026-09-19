import express from 'express';
import db from '../db/database.js';
import {
    resolveTenantWhatsAppContext,
    selectedWhatsAppPhoneNumberId,
} from '../services/whatsappNumbers.js';

const router = express.Router();

const FACEBOOK_ACTIVITY_TYPES = Object.freeze([
    'fb_post_created',
    'fb_post_edited',
    'fb_post_deleted',
    'fb_comment_replied',
    'fb_comment_hidden',
    'fb_comment_liked',
    'fb_comment_unliked',
    'fb_comment_deleted',
    'page_linked',
    'page_unlinked',
]);

router.get('/', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const tenant = db.prepare(`
            SELECT id, name, phone, status, quality, tier, credits
            FROM tenants
            WHERE id = ?
        `).get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const requestedPhoneNumberId = selectedWhatsAppPhoneNumberId(req);
        let whatsappFilter = '';
        let whatsappParams = [];
        const context = resolveTenantWhatsAppContext({
            database: db,
            tenantId,
            phoneNumberId: requestedPhoneNumberId,
            requireToken: false,
        });
        if (context.error) {
            if (context.code !== 'WHATSAPP_NUMBER_REQUIRED' || requestedPhoneNumberId) {
                return res.status(context.status).json({ error: context.error, code: context.code });
            }
        } else {
            whatsappFilter = "AND ((direction = 'incoming' AND recipient = ?) OR (direction = 'outgoing' AND sender = ?))";
            whatsappParams = [context.phoneNumberId, context.phoneNumberId];
        }

        const whatsapp = db.prepare(`
            SELECT
                COUNT(DISTINCT CASE WHEN direction = 'incoming' THEN sender ELSE recipient END) AS conversations,
                COALESCE(SUM(CASE WHEN date(created_at) = date('now', 'localtime') THEN 1 ELSE 0 END), 0) AS messages_today,
                COALESCE(SUM(CASE WHEN direction = 'outgoing' AND date(created_at) = date('now', 'localtime') THEN 1 ELSE 0 END), 0) AS sent_today,
                COALESCE(SUM(CASE WHEN direction = 'incoming' AND date(created_at) = date('now', 'localtime') THEN 1 ELSE 0 END), 0) AS received_today,
                COALESCE(SUM(CASE WHEN direction = 'incoming' AND status = 'received' THEN 1 ELSE 0 END), 0) AS unread
            FROM messages
            WHERE tenant_id = ?
              ${whatsappFilter}
        `).get(tenantId, ...whatsappParams);

        const messengerConversations = db.prepare(`
            SELECT COUNT(*) AS conversations, COALESCE(SUM(unread_count), 0) AS unread
            FROM fb_conversations
            WHERE tenant_id = ? AND is_active = 1
        `).get(tenantId);

        const messengerMessages = db.prepare(`
            SELECT
                COALESCE(SUM(CASE WHEN date(created_at) = date('now', 'localtime') THEN 1 ELSE 0 END), 0) AS messages_today,
                COALESCE(SUM(CASE WHEN direction = 'outgoing' AND date(created_at) = date('now', 'localtime') THEN 1 ELSE 0 END), 0) AS sent_today,
                COALESCE(SUM(CASE WHEN direction = 'incoming' AND date(created_at) = date('now', 'localtime') THEN 1 ELSE 0 END), 0) AS received_today
            FROM fb_messages
            WHERE tenant_id = ?
        `).get(tenantId);

        const linkedFacebookPages = db.prepare(`
            SELECT COUNT(*) AS count
            FROM tenant_pages
            WHERE tenant_id = ? AND is_active = 1
        `).get(tenantId).count;

        const templatesCount = db.prepare(
            'SELECT COUNT(*) AS count FROM templates WHERE tenant_id = ?'
        ).get(tenantId).count;

        const facebookActivityPlaceholders = FACEBOOK_ACTIVITY_TYPES.map(() => '?').join(', ');
        const facebookActionsWeek = db.prepare(`
            SELECT COUNT(*) AS count
            FROM activity_logs
            WHERE tenant_id = ?
              AND event_type IN (${facebookActivityPlaceholders})
              AND created_at >= datetime('now', '-7 days')
        `).get(tenantId, ...FACEBOOK_ACTIVITY_TYPES).count;

        const stats = {
            totalConversations: whatsapp.conversations + messengerConversations.conversations,
            messagesToday: whatsapp.messages_today + messengerMessages.messages_today,
            sentToday: whatsapp.sent_today + messengerMessages.sent_today,
            receivedToday: whatsapp.received_today + messengerMessages.received_today,
            unreadCount: whatsapp.unread + messengerConversations.unread,
            templatesCount,
            whatsappConversations: whatsapp.conversations,
            whatsappMessagesToday: whatsapp.messages_today,
            whatsappSentToday: whatsapp.sent_today,
            whatsappReceivedToday: whatsapp.received_today,
            whatsappUnread: whatsapp.unread,
            messengerConversations: messengerConversations.conversations,
            messengerMessagesToday: messengerMessages.messages_today,
            messengerSentToday: messengerMessages.sent_today,
            messengerReceivedToday: messengerMessages.received_today,
            messengerUnread: messengerConversations.unread,
            linkedFacebookPages,
            facebookActionsWeek,
        };

        const recentActivity = db.prepare(`
            SELECT id, event_type, description, status, created_at
            FROM activity_logs
            WHERE tenant_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 5
        `).all(tenantId);

        res.json({ tenant, stats, recentActivity });
    } catch (error) {
        console.error('[TenantDashboard] Get error:', error);
        res.status(500).json({ error: 'فشل جلب البيانات' });
    }
});

export default router;
