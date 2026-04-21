import express from 'express';
import db from '../db/database.js';
import { getAccessToken } from '../services/credentials.js';
import { META_API_BASE } from '../config/index.js';

const router = express.Router();

// ============================================
// Helper: Get tenant credentials
// ============================================
const getTenantCreds = async (tenantId) => {
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) return null;
    return {
        tenant,
        phoneNumberId: tenant.phone_number_id,
        accessToken: await getAccessToken(tenantId),
        wabaId: tenant.waba_id
    };
};

// ============================================
// List phone numbers for a WABA
// ============================================
router.get('/:wabaId', async (req, res) => {
    try {
        const { wabaId } = req.params;
        const tenantId = req.query.tenant_id;

        let accessToken = getAccessToken(tenantId);

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        const fields = 'display_phone_number,verified_name,quality_rating,status,name_status,code_verification_status,is_official_business_account,messaging_limit_tier';
        const response = await fetch(
            `${META_API_BASE}/${wabaId}/phone_numbers?fields=${fields}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب أرقام الهاتف',
                details: data.error
            });
        }

        res.json({
            phone_numbers: data.data || [],
            paging: data.paging || null
        });
    } catch (error) {
        console.error('[PhoneNumbers] List error:', error);
        res.status(500).json({ error: 'فشل جلب أرقام الهاتف' });
    }
});

// ============================================
// Get single phone number info
// ============================================
router.get('/info/:phoneNumberId', async (req, res) => {
    try {
        const { phoneNumberId } = req.params;
        const tenantId = req.query.tenant_id;

        let accessToken = getAccessToken(tenantId);

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        const fields = 'display_phone_number,verified_name,quality_rating,status,name_status,code_verification_status,is_official_business_account,messaging_limit_tier,platform_type';
        const response = await fetch(
            `${META_API_BASE}/${phoneNumberId}?fields=${fields}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب معلومات الرقم',
                details: data.error
            });
        }

        res.json(data);
    } catch (error) {
        console.error('[PhoneNumbers] Info error:', error);
        res.status(500).json({ error: 'فشل جلب معلومات الرقم' });
    }
});

// ============================================
// Register a phone number with Meta
// ============================================
router.post('/register/:phoneNumberId', async (req, res) => {
    try {
        const { phoneNumberId } = req.params;
        const { tenant_id, pin } = req.body;

        let accessToken = await getAccessToken(tenant_id);

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        if (!pin || pin.length !== 6) {
            return res.status(400).json({ error: 'رمز PIN يجب أن يكون 6 أرقام' });
        }

        const response = await fetch(
            `${META_API_BASE}/${phoneNumberId}/register`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    pin: pin
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل تسجيل رقم الهاتف',
                details: data.error
            });
        }

        // Log activity
        if (tenant_id) {
            const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenant_id);
            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'phone_registered', 'تسجيل رقم الهاتف مع Meta', 'success')
            `).run(tenant_id, tenant?.name || 'Unknown');
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('[PhoneNumbers] Register error:', error);
        res.status(500).json({ error: 'فشل تسجيل رقم الهاتف' });
    }
});

// ============================================
// Request verification code
// ============================================
router.post('/request-code/:phoneNumberId', async (req, res) => {
    try {
        const { phoneNumberId } = req.params;
        const { tenant_id, code_method, language } = req.body;

        let accessToken = getAccessToken(tenant_id);

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        const response = await fetch(
            `${META_API_BASE}/${phoneNumberId}/request_code`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    code_method: code_method || 'SMS',
                    language: language || 'ar'
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل طلب رمز التحقق',
                details: data.error
            });
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('[PhoneNumbers] Request code error:', error);
        res.status(500).json({ error: 'فشل طلب رمز التحقق' });
    }
});

// ============================================
// Verify code
// ============================================
router.post('/verify-code/:phoneNumberId', async (req, res) => {
    try {
        const { phoneNumberId } = req.params;
        const { tenant_id, code } = req.body;

        let accessToken = getAccessToken(tenant_id);

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        const response = await fetch(
            `${META_API_BASE}/${phoneNumberId}/verify_code`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ code })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل التحقق من الرمز',
                details: data.error
            });
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('[PhoneNumbers] Verify code error:', error);
        res.status(500).json({ error: 'فشل التحقق من الرمز' });
    }
});

// ============================================
// Set two-step verification
// ============================================
router.post('/two-step/:phoneNumberId', async (req, res) => {
    try {
        const { phoneNumberId } = req.params;
        const { tenant_id, pin } = req.body;

        let accessToken = getAccessToken(tenant_id);

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        if (!pin || pin.length !== 6) {
            return res.status(400).json({ error: 'رمز PIN يجب أن يكون 6 أرقام' });
        }

        const response = await fetch(
            `${META_API_BASE}/${phoneNumberId}`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ pin })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل إعداد التحقق بخطوتين',
                details: data.error
            });
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('[PhoneNumbers] Two-step error:', error);
        res.status(500).json({ error: 'فشل إعداد التحقق بخطوتين' });
    }
});

export default router;
