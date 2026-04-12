import express from 'express';
import db from '../db/database.js';
import { getAccessToken } from '../services/credentials.js';
import { META_API_BASE } from '../config/index.js';

const router = express.Router();

// ============================================
// Helper: Get credentials
// ============================================
const getCredentials = (tenantId) => {
    if (!tenantId) return { accessToken: getAccessToken() };
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    return {
        tenant,
        accessToken: tenant?.access_token || getAccessToken(),
        wabaId: tenant?.waba_id
    };
};

// ============================================
// Get Conversation Analytics
// ============================================
router.get('/conversations/:wabaId', async (req, res) => {
    try {
        const { wabaId } = req.params;
        const { tenant_id, start, end, granularity, phone_numbers } = req.query;
        const { accessToken } = getCredentials(tenant_id);

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        // Build query params
        const params = new URLSearchParams();
        if (start) params.append('start', start);
        if (end) params.append('end', end);
        params.append('granularity', granularity || 'DAY');
        if (phone_numbers) params.append('phone_numbers', phone_numbers);

        const response = await fetch(
            `${META_API_BASE}/${wabaId}/conversation_analytics?${params.toString()}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب تحليلات المحادثات',
                details: data.error
            });
        }

        res.json(data);
    } catch (error) {
        console.error('[Analytics] Conversations error:', error);
        res.status(500).json({ error: 'فشل جلب تحليلات المحادثات' });
    }
});

// ============================================
// Get Message Analytics
// ============================================
router.get('/messages/:wabaId', async (req, res) => {
    try {
        const { wabaId } = req.params;
        const { tenant_id, start, end, granularity, phone_numbers } = req.query;
        const { accessToken } = getCredentials(tenant_id);

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        const params = new URLSearchParams();
        if (start) params.append('start', start);
        if (end) params.append('end', end);
        params.append('granularity', granularity || 'DAY');
        if (phone_numbers) params.append('phone_numbers', phone_numbers);

        const response = await fetch(
            `${META_API_BASE}/${wabaId}/analytics?${params.toString()}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب تحليلات الرسائل',
                details: data.error
            });
        }

        res.json(data);
    } catch (error) {
        console.error('[Analytics] Messages error:', error);
        res.status(500).json({ error: 'فشل جلب تحليلات الرسائل' });
    }
});

// ============================================
// Get Template Analytics
// ============================================
router.get('/templates/:wabaId', async (req, res) => {
    try {
        const { wabaId } = req.params;
        const { tenant_id, start, end, template_ids } = req.query;
        const { accessToken } = getCredentials(tenant_id);

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        const params = new URLSearchParams();
        if (start) params.append('start', start);
        if (end) params.append('end', end);
        if (template_ids) params.append('template_ids', template_ids);

        const response = await fetch(
            `${META_API_BASE}/${wabaId}/template_analytics?${params.toString()}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب تحليلات القوالب',
                details: data.error
            });
        }

        res.json(data);
    } catch (error) {
        console.error('[Analytics] Templates error:', error);
        res.status(500).json({ error: 'فشل جلب تحليلات القوالب' });
    }
});

// ============================================
// Get local platform stats (aggregated/anonymized)
// ============================================
router.get('/local/summary', (req, res) => {
    try {
        const tenantId = req.query.tenant_id || req.user?.tenant_id;

        let conditions = '';
        const params = [];

        if (tenantId) {
            conditions = 'WHERE tenant_id = ?';
            params.push(tenantId);
        }

        const stats = {
            totalMessages: db.prepare(`SELECT COUNT(*) as count FROM messages ${conditions}`).get(...params)?.count || 0,
            sentMessages: db.prepare(`SELECT COUNT(*) as count FROM messages ${conditions ? conditions + " AND" : "WHERE"} direction = 'outgoing'`).get(...params)?.count || 0,
            receivedMessages: db.prepare(`SELECT COUNT(*) as count FROM messages ${conditions ? conditions + " AND" : "WHERE"} direction = 'incoming'`).get(...params)?.count || 0,
            failedMessages: db.prepare(`SELECT COUNT(*) as count FROM messages ${conditions ? conditions + " AND" : "WHERE"} status = 'failed'`).get(...params)?.count || 0,

            // Daily breakdown (last 30 days)
            dailyBreakdown: db.prepare(`
                SELECT 
                    date(created_at) as date,
                    COUNT(*) as total,
                    SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) as sent,
                    SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) as received
                FROM messages
                ${conditions ? conditions + " AND" : "WHERE"} created_at >= datetime('now', '-30 days')
                GROUP BY date(created_at)
                ORDER BY date DESC
            `).all(...params),

            // Message type distribution
            typeDistribution: db.prepare(`
                SELECT message_type, COUNT(*) as count
                FROM messages
                ${conditions}
                GROUP BY message_type
                ORDER BY count DESC
            `).all(...params),
        };

        res.json(stats);
    } catch (error) {
        console.error('[Analytics] Local summary error:', error);
        res.status(500).json({ error: 'فشل جلب الإحصائيات' });
    }
});

export default router;
