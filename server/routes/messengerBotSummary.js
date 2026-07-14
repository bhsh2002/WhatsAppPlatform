import express from 'express';
import { requireTenant } from './messengerBotShared.js';

export function createMessengerBotSummaryRouter({ database } = {}) {
    if (!database) throw new TypeError('database is required');
    const router = express.Router();

    router.get('/summary', (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) return;

            const products = database.prepare(`
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN is_active = 1 AND availability = 'available' THEN 1 ELSE 0 END) AS active
                FROM bot_products
                WHERE tenant_id = ?
            `).get(tenant.id);
            const flows = database.prepare(`
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
                FROM bot_flows
                WHERE tenant_id = ?
            `).get(tenant.id);
            const sessions = database.prepare(`
                SELECT status, COUNT(*) AS count
                FROM bot_sessions
                WHERE tenant_id = ?
                GROUP BY status
            `).all(tenant.id);
            const pages = database.prepare(`
                SELECT id, page_id, page_name
                FROM tenant_pages
                WHERE tenant_id = ? AND is_active = 1
                ORDER BY page_name
            `).all(tenant.id);
            const eventStats = database.prepare(`
                SELECT event_type, status, COUNT(*) AS count
                FROM bot_events
                WHERE tenant_id = ?
                  AND created_at >= datetime('now', '-30 days', 'localtime')
                GROUP BY event_type, status
                ORDER BY count DESC
            `).all(tenant.id);
            const topFlows = database.prepare(`
                SELECT
                    json_extract(be.payload_json, '$.flow_id') AS flow_id,
                    COALESCE(bf.name, json_extract(be.payload_json, '$.flow_name'), 'غير معروف') AS flow_name,
                    COUNT(*) AS count
                FROM bot_events be
                LEFT JOIN bot_flows bf ON bf.id = json_extract(be.payload_json, '$.flow_id')
                WHERE be.tenant_id = ?
                  AND be.event_type = 'flow_matched'
                  AND be.created_at >= datetime('now', '-30 days', 'localtime')
                GROUP BY flow_id, flow_name
                ORDER BY count DESC
                LIMIT 5
            `).all(tenant.id);
            const handoffCount = database.prepare(`
                SELECT COUNT(*) AS count
                FROM bot_events
                WHERE tenant_id = ?
                  AND event_type = 'handoff'
                  AND created_at >= datetime('now', '-30 days', 'localtime')
            `).get(tenant.id)?.count || 0;
            const failedSends = database.prepare(`
                SELECT COUNT(*) AS count
                FROM bot_events
                WHERE tenant_id = ?
                  AND event_type = 'send_failed'
                  AND created_at >= datetime('now', '-30 days', 'localtime')
            `).get(tenant.id)?.count || 0;
            const productDetails = database.prepare(`
                SELECT COUNT(*) AS count
                FROM bot_events
                WHERE tenant_id = ?
                  AND payload_json LIKE '%"node_type":"product_detail"%'
                  AND created_at >= datetime('now', '-30 days', 'localtime')
            `).get(tenant.id)?.count || 0;

            res.json({
                tenant,
                products: { total: products?.total || 0, active: products?.active || 0 },
                flows: { total: flows?.total || 0, active: flows?.active || 0 },
                sessions,
                pages,
                performance: {
                    event_stats: eventStats,
                    top_flows: topFlows,
                    handoffs: handoffCount,
                    failed_sends: failedSends,
                    product_details: productDetails,
                },
            });
        } catch (error) {
            console.error('[MessengerBot] Summary error:', error);
            res.status(500).json({ error: 'فشل جلب ملخص البوت' });
        }
    });

    return router;
}
