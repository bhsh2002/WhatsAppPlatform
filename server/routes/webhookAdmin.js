import express from 'express';
import db from '../db/database.js';
import { decryptIfEncrypted } from '../services/encryption.js';
import { META_API_BASE } from '../config/index.js';
import { resolveCredentials } from '../services/credentials.js';
import eventBus from '../services/eventBus.js';

const router = express.Router();

router.get('/failures', (req, res) => {
    try {
        const { tenant_id, event_type, status, page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let where = '1=1';
        const params = [];

        if (tenant_id) {
            where += ' AND wf.tenant_id = ?';
            params.push(tenant_id);
        }
        if (event_type) {
            where += ' AND wf.event_type = ?';
            params.push(event_type);
        }
        if (status === 'pending') {
            where += ' AND wf.resolved_at IS NULL';
        } else if (status === 'resolved') {
            where += ' AND wf.resolved_at IS NOT NULL';
        }

        const countRow = db.prepare(
            `SELECT COUNT(*) as total FROM webhook_failures wf WHERE ${where}`
        ).get(...params);

        const failures = db.prepare(
            `SELECT wf.*, t.name as tenant_name
             FROM webhook_failures wf
             LEFT JOIN tenants t ON wf.tenant_id = t.id
             WHERE ${where}
             ORDER BY wf.created_at DESC
             LIMIT ? OFFSET ?`
        ).all(...params, parseInt(limit), offset);

        res.json({
            failures,
            total: countRow.total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(countRow.total / parseInt(limit)),
        });
    } catch (error) {
        console.error('Error fetching webhook failures:', error);
        res.status(500).json({ error: 'فشل جلب أعطال Webhook' });
    }
});

router.post('/failures/:id/retry', async (req, res) => {
    try {
        const failure = db.prepare('SELECT * FROM webhook_failures WHERE id = ?').get(req.params.id);
        if (!failure) {
            return res.status(404).json({ error: 'العطل غير موجود' });
        }

        let payload;
        try {
            payload = JSON.parse(failure.payload);
        } catch {
            return res.status(400).json({ error: 'حمولة غير صالحة' });
        }

        const eventType = failure.event_type;
        let retryResult = { success: false, message: 'نوع حدث غير مدعوم' };

        if (eventType === 'message_received' || eventType === 'messages') {
            const phone_number_id = payload.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
            if (phone_number_id) {
                const tenant = db.prepare('SELECT * FROM tenants WHERE phone_number_id = ?').get(phone_number_id);
                if (tenant) {
                    retryResult = { success: true, message: `إعادة محاكاة رسالة للعميل ${tenant.name}` };
                    eventBus.emitNewMessage({
                        tenant_id: tenant.id,
                        tenant_name: tenant.name,
                        phone_number_id,
                    });
                }
            }
        } else if (eventType === 'status_update') {
            retryResult = { success: true, message: 'تم إعادة محاكاة تحديث الحالة' };
        }

        db.prepare(
            `UPDATE webhook_failures SET retry_count = retry_count + 1, last_retry_at = datetime('now', 'localtime') WHERE id = ?`
        ).run(req.params.id);

        res.json({ success: true, ...retryResult });
    } catch (error) {
        console.error('Error retrying webhook failure:', error);
        res.status(500).json({ error: 'فشل إعادة المحاولة' });
    }
});

router.delete('/failures/:id', (req, res) => {
    try {
        const result = db.prepare('DELETE FROM webhook_failures WHERE id = ?').run(req.params.id);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'العطل غير موجود' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting webhook failure:', error);
        res.status(500).json({ error: 'فشل حذف العطل' });
    }
});

router.delete('/failures', (req, res) => {
    try {
        const result = db.prepare("DELETE FROM webhook_failures WHERE resolved_at IS NOT NULL").run();
        res.json({ success: true, deleted: result.changes });
    } catch (error) {
        console.error('Error clearing resolved failures:', error);
        res.status(500).json({ error: 'فشل مسح الأعطال المحلولة' });
    }
});

router.get('/stats', (req, res) => {
    try {
        const byStatus = db.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) as resolved
            FROM webhook_failures
        `).get();

        const byTenant = db.prepare(`
            SELECT wf.tenant_id, t.name as tenant_name, COUNT(*) as count,
                   SUM(CASE WHEN wf.resolved_at IS NULL THEN 1 ELSE 0 END) as pending
            FROM webhook_failures wf
            LEFT JOIN tenants t ON wf.tenant_id = t.id
            GROUP BY wf.tenant_id
            ORDER BY count DESC
        `).all();

        const byEventType = db.prepare(`
            SELECT event_type, COUNT(*) as count,
                   SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END) as pending
            FROM webhook_failures
            GROUP BY event_type
            ORDER BY count DESC
        `).all();

        res.json({ byStatus, byTenant, byEventType });
    } catch (error) {
        console.error('Error fetching webhook failure stats:', error);
        res.status(500).json({ error: 'فشل جلب إحصائيات الأعطال' });
    }
});

export default router;