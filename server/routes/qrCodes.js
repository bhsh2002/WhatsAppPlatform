import express from 'express';
import db from '../db/database.js';

const router = express.Router();

const META_API_VERSION = 'v22.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// ============================================
// Helper: Get credentials
// ============================================
const getCredentials = (tenantId) => {
    if (!tenantId) return { accessToken: process.env.DEFAULT_ACCESS_TOKEN };
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    return {
        tenant,
        accessToken: tenant?.access_token || process.env.DEFAULT_ACCESS_TOKEN,
        phoneNumberId: tenant?.phone_number_id
    };
};

// ============================================
// List QR Codes
// ============================================
router.get('/:phoneNumberId', async (req, res) => {
    try {
        const { phoneNumberId } = req.params;
        const tenantId = req.query.tenant_id;
        const { accessToken } = getCredentials(tenantId);

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        const response = await fetch(
            `${META_API_BASE}/${phoneNumberId}/message_qrdls`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب رموز QR',
                details: data.error
            });
        }

        res.json({
            qr_codes: data.data || [],
            paging: data.paging || null
        });
    } catch (error) {
        console.error('[QRCodes] List error:', error);
        res.status(500).json({ error: 'فشل جلب رموز QR' });
    }
});

// ============================================
// Create QR Code
// ============================================
router.post('/:phoneNumberId', async (req, res) => {
    try {
        const { phoneNumberId } = req.params;
        const { tenant_id, prefilled_message, generate_qr_image } = req.body;
        const { accessToken } = getCredentials(tenant_id);

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        if (!prefilled_message) {
            return res.status(400).json({ error: 'نص الرسالة المعبأة مسبقاً مطلوب' });
        }

        const response = await fetch(
            `${META_API_BASE}/${phoneNumberId}/message_qrdls`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prefilled_message,
                    generate_qr_image: generate_qr_image || 'PNG'
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل إنشاء رمز QR',
                details: data.error
            });
        }

        // Log activity
        if (tenant_id) {
            const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenant_id);
            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'qr_code_created', 'إنشاء رمز QR جديد', 'success')
            `).run(tenant_id, tenant?.name || 'Unknown');
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('[QRCodes] Create error:', error);
        res.status(500).json({ error: 'فشل إنشاء رمز QR' });
    }
});

// ============================================
// Update QR Code
// ============================================
router.put('/:phoneNumberId/:qrCodeId', async (req, res) => {
    try {
        const { phoneNumberId, qrCodeId } = req.params;
        const { tenant_id, prefilled_message } = req.body;
        const { accessToken } = getCredentials(tenant_id);

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        const response = await fetch(
            `${META_API_BASE}/${phoneNumberId}/message_qrdls/${qrCodeId}`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ prefilled_message })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل تحديث رمز QR',
                details: data.error
            });
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('[QRCodes] Update error:', error);
        res.status(500).json({ error: 'فشل تحديث رمز QR' });
    }
});

// ============================================
// Delete QR Code
// ============================================
router.delete('/:phoneNumberId/:qrCodeId', async (req, res) => {
    try {
        const { phoneNumberId, qrCodeId } = req.params;
        const tenantId = req.query.tenant_id;
        const { accessToken } = getCredentials(tenantId);

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        const response = await fetch(
            `${META_API_BASE}/${phoneNumberId}/message_qrdls/${qrCodeId}`,
            {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل حذف رمز QR',
                details: data.error
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[QRCodes] Delete error:', error);
        res.status(500).json({ error: 'فشل حذف رمز QR' });
    }
});

export default router;
