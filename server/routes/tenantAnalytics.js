import express from 'express';

export function createTenantAnalyticsRouter({ database } = {}) {
    if (!database) throw new TypeError('Tenant analytics router requires database');
    const router = express.Router();

    router.get('/summary', (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const totals = database.prepare(`
                SELECT COUNT(*) AS total_messages,
                       SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) AS sent_messages,
                       SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) AS received_messages,
                       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_messages
                FROM messages
                WHERE tenant_id = ?
            `).get(tenantId) || {};

            return res.json({
                totalMessages: Number(totals.total_messages) || 0,
                sentMessages: Number(totals.sent_messages) || 0,
                receivedMessages: Number(totals.received_messages) || 0,
                failedMessages: Number(totals.failed_messages) || 0,
                dailyBreakdown: database.prepare(`
                    SELECT date(created_at) AS date,
                           COUNT(*) AS total,
                           SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) AS sent,
                           SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) AS received
                    FROM messages
                    WHERE tenant_id = ?
                      AND created_at >= datetime('now', '-30 days')
                    GROUP BY date(created_at)
                    ORDER BY date DESC
                `).all(tenantId),
                typeDistribution: database.prepare(`
                    SELECT message_type, COUNT(*) AS count
                    FROM messages
                    WHERE tenant_id = ?
                    GROUP BY message_type
                    ORDER BY count DESC, message_type ASC
                `).all(tenantId),
            });
        } catch (error) {
            console.error('[TenantAnalytics] Summary error:', error);
            return res.status(500).json({ error: 'فشل جلب الإحصائيات' });
        }
    });

    return router;
}

export default createTenantAnalyticsRouter;
