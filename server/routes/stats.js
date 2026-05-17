import express from 'express';
import db from '../db/database.js';

const router = express.Router();

// Get dashboard stats
router.get('/dashboard', (req, res) => {
    try {
        const stats = {
            total: db.prepare('SELECT COUNT(*) as count FROM tenants').get().count,
            active: db.prepare("SELECT COUNT(*) as count FROM tenants WHERE status = 'Active'").get().count,
            warning: db.prepare("SELECT COUNT(*) as count FROM tenants WHERE quality = 'Medium' OR status = 'Warning'").get().count,
            critical: db.prepare("SELECT COUNT(*) as count FROM tenants WHERE quality = 'Low' OR status = 'Suspended'").get().count,
            wa_today: db.prepare("SELECT COUNT(*) as count FROM messages WHERE date(created_at) = date('now', 'localtime')").get().count,
            wa_week: db.prepare("SELECT COUNT(*) as count FROM messages WHERE created_at >= datetime('now', '-7 days')").get().count,
            wa_sent_today: db.prepare("SELECT COUNT(*) as count FROM messages WHERE date(created_at) = date('now', 'localtime') AND direction = 'outgoing'").get().count,
            wa_received_today: db.prepare("SELECT COUNT(*) as count FROM messages WHERE date(created_at) = date('now', 'localtime') AND direction = 'incoming'").get().count,
            fb_today: db.prepare("SELECT COUNT(*) as count FROM fb_messages WHERE date(created_at) = date('now', 'localtime')").get().count,
            fb_week: db.prepare("SELECT COUNT(*) as count FROM fb_messages WHERE created_at >= datetime('now', '-7 days')").get().count,
            fb_conversations: db.prepare("SELECT COUNT(*) as count FROM fb_conversations WHERE is_active = 1").get().count,
            linked_pages: db.prepare("SELECT COUNT(*) as count FROM tenant_pages WHERE is_active = 1").get().count,
        };
        stats.todayMessages = stats.wa_today;
        stats.weekMessages = stats.wa_week;
        stats.total_messages_today = stats.wa_today + stats.fb_today;
        stats.total_messages_week = stats.wa_week + stats.fb_week;
        res.json(stats);
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Get recent activity
router.get('/activity', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const activities = db.prepare(`
      SELECT * FROM activity_logs
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);

        // Format relative time
        const now = new Date();
        const formatted = activities.map(activity => {
            const activityDate = new Date(activity.created_at);
            const diffMs = now - activityDate;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMins / 60);
            const diffDays = Math.floor(diffHours / 24);

            let relativeTime;
            if (diffMins < 1) relativeTime = 'الآن';
            else if (diffMins < 60) relativeTime = `منذ ${diffMins} دقيقة`;
            else if (diffHours < 24) relativeTime = `منذ ${diffHours} ساعة`;
            else relativeTime = `منذ ${diffDays} يوم`;

            return {
                ...activity,
                relativeTime
            };
        });

        res.json(formatted);
    } catch (error) {
        console.error('Error fetching activity:', error);
        res.status(500).json({ error: 'Failed to fetch activity' });
    }
});

export default router;
