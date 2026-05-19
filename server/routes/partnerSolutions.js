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

const PARTNER_SUCCESS_EVENTS = [
    'partner_client_added',
    'partner_client_removed',
    'partner_client_waba_loaded',
    'partner_system_user_created',
];

const PARTNER_FAILURE_EVENTS = [
    'partner_clients_list_failed',
    'partner_client_add_failed',
    'partner_client_remove_failed',
    'partner_client_waba_failed',
    'partner_system_user_failed',
];

const logPartnerActivity = (tenantId, eventType, description, status = 'success') => {
    if (!tenantId) return;
    const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId);
    db.prepare(`
        INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
        VALUES (?, ?, ?, ?, ?)
    `).run(tenantId, tenant?.name || 'Unknown', eventType, description, status);
};

const getLatestPartnerActivity = (tenantId, eventTypes, status = null) => {
    const placeholders = eventTypes.map(() => '?').join(',');
    const statusClause = status ? 'AND status = ?' : '';
    const params = status ? [tenantId, status, ...eventTypes] : [tenantId, ...eventTypes];
    return db.prepare(`
        SELECT event_type, description, status, created_at
        FROM activity_logs
        WHERE tenant_id = ? ${statusClause} AND event_type IN (${placeholders})
        ORDER BY created_at DESC
        LIMIT 1
    `).get(...params);
};

// ============================================
// Partner readiness/evidence for Meta Review
// ============================================
router.get('/evidence', (req, res) => {
    try {
        const tenantId = req.query.tenant_id;
        if (!tenantId) {
            return res.status(400).json({ error: 'tenant_id مطلوب' });
        }

        const tenant = db.prepare(`
            SELECT id, name, business_id, facebook_user_access_token_encrypted,
                   facebook_user_token_scopes, facebook_user_token_status,
                   facebook_user_token_app_id, facebook_user_token_checked_at,
                   facebook_user_token_updated_at
            FROM tenants
            WHERE id = ?
        `).get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const scopes = parseStoredArray(tenant.facebook_user_token_scopes);
        const latestSuccess = getLatestPartnerActivity(tenantId, PARTNER_SUCCESS_EVENTS, 'success');
        const latestFailure = getLatestPartnerActivity(tenantId, PARTNER_FAILURE_EVENTS);

        res.json({
            tenant: {
                id: tenant.id,
                name: tenant.name,
                business_id: tenant.business_id || null,
            },
            readiness: {
                business_id_present: !!tenant.business_id,
                facebook_user_token_present: !!tenant.facebook_user_access_token_encrypted,
                facebook_user_token_status: tenant.facebook_user_token_status || 'unchecked',
                business_management_granted: scopes.includes('business_management'),
                app_id: tenant.facebook_user_token_app_id || null,
                checked_at: tenant.facebook_user_token_checked_at || null,
                updated_at: tenant.facebook_user_token_updated_at || null,
            },
            latest_success: latestSuccess || null,
            latest_failure: latestFailure || null,
        });
    } catch (error) {
        console.error('[Partner] Evidence error:', error);
        res.status(500).json({ error: 'فشل جلب دليل حلول الشركاء' });
    }
});

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
            logPartnerActivity(tenantId, 'partner_clients_list_failed', data.error?.message || 'فشل جلب العملاء المُدارين', 'error');
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
            logPartnerActivity(tenant_id, 'partner_client_add_failed', data.error?.message || 'فشل إضافة العميل', 'error');
            return res.status(response.status).json({
                error: data.error?.message || 'فشل إضافة العميل',
                details: data.error
            });
        }

        logPartnerActivity(tenant_id, 'partner_client_added', 'إضافة عميل شريك جديد', 'success');

        res.json({ success: true, data });
    } catch (error) {
        console.error('[Partner] Add client error:', error);
        logPartnerActivity(req.body?.tenant_id, 'partner_client_add_failed', error.message || 'فشل إضافة العميل', 'error');
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
            logPartnerActivity(tenant_id, 'partner_client_remove_failed', data.error?.message || 'فشل إزالة العميل', 'error');
            return res.status(response.status).json({
                error: data.error?.message || 'فشل إزالة العميل',
                details: data.error
            });
        }

        logPartnerActivity(tenant_id, 'partner_client_removed', 'إزالة عميل شريك مُدار', 'success');

        res.json({ success: true });
    } catch (error) {
        console.error('[Partner] Remove client error:', error);
        logPartnerActivity(req.query?.tenant_id, 'partner_client_remove_failed', error.message || 'فشل إزالة العميل', 'error');
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
            logPartnerActivity(tenantId, 'partner_client_waba_failed', data.error?.message || 'فشل جلب حسابات واتساب للعميل', 'error');
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب حسابات واتساب للعميل',
                details: data.error
            });
        }

        logPartnerActivity(tenantId, 'partner_client_waba_loaded', 'جلب حسابات WABA لعميل شريك', 'success');

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
            logPartnerActivity(tenant_id, 'partner_system_user_failed', data.error?.message || 'فشل إنشاء مستخدم نظام', 'error');
            return res.status(response.status).json({
                error: data.error?.message || 'فشل إنشاء مستخدم نظام',
                details: data.error
            });
        }

        logPartnerActivity(tenant_id, 'partner_system_user_created', 'إنشاء مستخدم نظام لعميل شريك', 'success');

        res.json({ success: true, data });
    } catch (error) {
        console.error('[Partner] Create system user error:', error);
        logPartnerActivity(req.body?.tenant_id, 'partner_system_user_failed', error.message || 'فشل إنشاء مستخدم نظام', 'error');
        res.status(500).json({ error: 'فشل إنشاء مستخدم نظام' });
    }
});

export default router;
