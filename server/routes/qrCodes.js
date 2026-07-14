import express from 'express';
import db from '../db/database.js';
import { getAccessToken } from '../services/credentials.js';
import { META_API_BASE } from '../config/index.js';
import { requestMetaJson } from '../services/metaHttp.js';

const router = express.Router();

// ============================================
// Helper: Get credentials
// ============================================
const getCredentials = (tenantId) => {
    if (!tenantId) return { accessToken: getAccessToken() };
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    return {
        tenant,
        accessToken: getAccessToken(tenantId),
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

        const result = await requestMetaJson(
            `${META_API_BASE}/${phoneNumberId}/message_qrdls`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const { data, error: metaError } = result;

        if (!result.ok) {
            return res.status(result.status).json({
                error: metaError?.message || 'فشل جلب رموز QR',
                details: metaError
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

        const result = await requestMetaJson(
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

        const { data, error: metaError } = result;

        if (!result.ok) {
            return res.status(result.status).json({
                error: metaError?.message || 'فشل إنشاء رمز QR',
                details: metaError
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

        const result = await requestMetaJson(
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

        const { data, error: metaError } = result;

        if (!result.ok) {
            return res.status(result.status).json({
                error: metaError?.message || 'فشل تحديث رمز QR',
                details: metaError
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

        const result = await requestMetaJson(
            `${META_API_BASE}/${phoneNumberId}/message_qrdls/${qrCodeId}`,
            {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const { data, error: metaError } = result;

        if (!result.ok) {
            return res.status(result.status).json({
                error: metaError?.message || 'فشل حذف رمز QR',
                details: metaError
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[QRCodes] Delete error:', error);
        res.status(500).json({ error: 'فشل حذف رمز QR' });
    }
});

export default router;
