import express from 'express';
import db from '../db/database.js';
import { getFacebookUserAccessToken } from '../services/credentials.js';
import { META_API_BASE } from '../config/index.js';
import { parseStoredArray } from '../services/metaReadiness.js';

const router = express.Router();

const resolveBusinessAccessToken = (tenantId) => {
    if (!tenantId) {
        return { status: 400, error: 'tenant_id مطلوب لاستخدام Partner Solutions', code: 'TENANT_REQUIRED' };
    }

    const tenant = db.prepare('SELECT id, facebook_user_token_scopes FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) {
        return { status: 404, error: 'العميل غير موجود', code: 'TENANT_NOT_FOUND' };
    }

    const accessToken = getFacebookUserAccessToken(tenantId);
    if (!accessToken) {
        return {
            status: 400,
            error: 'رمز Facebook user token مطلوب لمسارات Partner Solutions. أعد تفويض Facebook من بوابة العميل.',
            code: 'FACEBOOK_USER_TOKEN_REQUIRED',
            permission_required: 'business_management',
        };
    }

    const scopes = parseStoredArray(tenant.facebook_user_token_scopes);
    if (!scopes.includes('business_management')) {
        return {
            status: 403,
            error: 'هذه العملية تتطلب صلاحية business_management في Facebook user token.',
            code: 'BUSINESS_MANAGEMENT_REQUIRED',
            permission_required: 'business_management',
        };
    }

    return { accessToken };
};

const requireBusinessAccessToken = (res, tenantId) => {
    const result = resolveBusinessAccessToken(tenantId);
    if (result.error) {
        res.status(result.status).json(result);
        return null;
    }
    return result.accessToken;
};

// ============================================
// List managed businesses (clients)
// ============================================
router.get('/clients', async (req, res) => {
    try {
        const businessId = req.query.business_id;
        const tenantId = req.query.tenant_id;

        if (!businessId) {
            return res.status(400).json({ error: 'معرف النشاط التجاري مفقود' });
        }
        const accessToken = requireBusinessAccessToken(res, tenantId);
        if (!accessToken) return;

        const response = await fetch(
            `${META_API_BASE}/${businessId}/owned_businesses?fields=name,id&limit=50`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            // Permission error — return empty list with explanation
            if (data.error?.code === 100 || data.error?.type === 'OAuthException') {
                return res.json({
                    clients: [],
                    paging: null,
                    permission_error: 'هذه الميزة تحتاج صلاحية business_management. تأكد من صلاحيات Access Token.',
                    hint: 'هذه الميزة متاحة فقط لحسابات الشركاء (Partner accounts)'
                });
            }
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب العملاء المُدارين.',
                details: data.error,
                hint: 'هذه الميزة متاحة فقط لحسابات الشركاء (Partner accounts)'
            });
        }

        res.json({
            clients: data.data || [],
            paging: data.paging || null
        });
    } catch (error) {
        console.error('[Partner] List clients error:', error);
        res.status(500).json({ error: 'فشل جلب العملاء' });
    }
});

// ============================================
// Add (onboard) a new client
// ============================================
router.post('/clients', async (req, res) => {
    try {
        const { business_id, tenant_id, existing_client_business_id, name, survey_business_type, timezone_id } = req.body;

        if (!business_id) {
            return res.status(400).json({ error: 'معرف النشاط التجاري مفقود' });
        }
        const accessToken = requireBusinessAccessToken(res, tenant_id);
        if (!accessToken) return;

        const payload = {};
        if (existing_client_business_id) {
            payload.existing_client_business_id = existing_client_business_id;
        } else {
            if (!name) {
                return res.status(400).json({ error: 'اسم العميل مطلوب عند إنشاء عميل جديد' });
            }
            payload.name = name;
            payload.survey_business_type = survey_business_type || 'ADVERTISER';
            payload.timezone_id = timezone_id || '2'; // Africa/Tripoli
        }

        const response = await fetch(
            `${META_API_BASE}/${business_id}/managed_businesses`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل إضافة العميل',
                details: data.error
            });
        }

        // Log activity
        if (tenant_id) {
            const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenant_id);
            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'partner_client_added', 'إضافة عميل شريك جديد', 'success')
            `).run(tenant_id, tenant?.name || 'Unknown');
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('[Partner] Add client error:', error);
        res.status(500).json({ error: 'فشل إضافة العميل' });
    }
});

// ============================================
// Remove a managed client
// ============================================
router.delete('/clients/:clientBusinessId', async (req, res) => {
    try {
        const { clientBusinessId } = req.params;
        const { business_id, tenant_id } = req.query;

        if (!business_id) {
            return res.status(400).json({ error: 'معرف النشاط التجاري مفقود' });
        }
        const accessToken = requireBusinessAccessToken(res, tenant_id);
        if (!accessToken) return;

        const response = await fetch(
            `${META_API_BASE}/${business_id}/managed_businesses`,
            {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    existing_client_business_id: clientBusinessId
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل إزالة العميل',
                details: data.error
            });
        }

        if (tenant_id) {
            const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenant_id);
            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'partner_client_removed', 'إزالة عميل شريك مُدار', 'success')
            `).run(tenant_id, tenant?.name || 'Unknown');
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[Partner] Remove client error:', error);
        res.status(500).json({ error: 'فشل إزالة العميل' });
    }
});

// ============================================
// Get client's WABA accounts
// ============================================
router.get('/clients/:clientBusinessId/waba', async (req, res) => {
    try {
        const { clientBusinessId } = req.params;
        const tenantId = req.query.tenant_id;

        const accessToken = requireBusinessAccessToken(res, tenantId);
        if (!accessToken) return;

        const response = await fetch(
            `${META_API_BASE}/${clientBusinessId}/owned_whatsapp_business_accounts?fields=name,id,currency,timezone_id`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب حسابات واتساب للعميل',
                details: data.error
            });
        }

        res.json({
            whatsapp_accounts: data.data || [],
            paging: data.paging || null
        });
    } catch (error) {
        console.error('[Partner] Client WABA error:', error);
        res.status(500).json({ error: 'فشل جلب حسابات واتساب للعميل' });
    }
});

// ============================================
// Create system user for a client
// ============================================
router.post('/clients/:clientBusinessId/system-user', async (req, res) => {
    try {
        const { clientBusinessId } = req.params;
        const { tenant_id, name, role } = req.body;

        const accessToken = requireBusinessAccessToken(res, tenant_id);
        if (!accessToken) return;

        if (!name) {
            return res.status(400).json({ error: 'اسم مستخدم النظام مطلوب' });
        }

        const response = await fetch(
            `${META_API_BASE}/${clientBusinessId}/system_users`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name,
                    role: role || 'ADMIN' // ADMIN or EMPLOYEE
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل إنشاء مستخدم نظام',
                details: data.error
            });
        }

        if (tenant_id) {
            const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenant_id);
            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'partner_system_user_created', 'إنشاء مستخدم نظام لعميل شريك', 'success')
            `).run(tenant_id, tenant?.name || 'Unknown');
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('[Partner] Create system user error:', error);
        res.status(500).json({ error: 'فشل إنشاء مستخدم نظام' });
    }
});

export default router;
