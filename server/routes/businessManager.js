import express from 'express';
import db from '../db/database.js';
import { getFacebookUserAccessToken } from '../services/credentials.js';
import { META_API_BASE } from '../config/index.js';
import { parseStoredArray } from '../services/metaReadiness.js';
import { readMetaResponse, sendMetaFailure } from '../services/metaHttp.js';

const router = express.Router();

const resolveBusinessAccessToken = (tenantId) => {
    if (!tenantId) {
        return { status: 400, error: 'tenant_id مطلوب لاستخدام Business APIs', code: 'TENANT_REQUIRED' };
    }

    const tenant = db.prepare('SELECT id, facebook_user_token_scopes FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) {
        return { status: 404, error: 'العميل غير موجود', code: 'TENANT_NOT_FOUND' };
    }

    const accessToken = getFacebookUserAccessToken(tenantId);
    if (!accessToken) {
        return {
            status: 400,
            error: 'رمز Facebook user token مطلوب لمسارات Business APIs. أعد تفويض Facebook من بوابة العميل.',
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

const logBusinessActivity = (tenantId, eventType, description, status = 'success') => {
    if (!tenantId) return;
    const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId);
    db.prepare(`
        INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
        VALUES (?, ?, ?, ?, ?)
    `).run(tenantId, tenant?.name || 'Unknown', eventType, description, status);
};

const classifyBusinessError = (error) => {
    const message = error?.message || '';
    if (error?.code === 100 || /Unsupported post request|does not exist|cannot be loaded/i.test(message)) {
        return { code: 'BUSINESS_NOT_FOUND_OR_DENIED', label: 'Business غير موجود أو لا يملك المستخدم وصولا إليه' };
    }
    if (error?.type === 'OAuthException' || /permission|permissions|permission/i.test(message)) {
        return { code: 'MISSING_PERMISSION', label: 'صلاحية business_management أو وصول الأصل غير كاف' };
    }
    return { code: 'META_ERROR', label: message || 'خطأ من Meta' };
};

// ============================================
// Get Business Manager info
// ============================================
router.get('/:businessId', async (req, res) => {
    try {
        const { businessId } = req.params;
        const tenantId = req.query.tenant_id;

        const accessToken = requireBusinessAccessToken(res, tenantId);
        if (!accessToken) return;

        const fields = 'name,id,verification_status,created_time,timezone_id,two_factor_type';
        const response = await fetch(
            `${META_API_BASE}/${businessId}?fields=${fields}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            const classified = classifyBusinessError(metaResult.error);
            logBusinessActivity(tenantId, 'business_info_failed', classified.label, 'error');
            // Permission error — return minimal info
            if (metaResult.error?.code === 100 || metaResult.error?.type === 'OAuthException') {
                return res.json({
                    id: businessId,
                    name: 'غير متاح',
                    permission_error: classified.label,
                    reason_code: classified.code,
                });
            }
            return res.status(metaResult.status).json({
                error: metaResult.error?.message || 'فشل جلب معلومات مدير الأعمال',
                details: metaResult.error,
                reason_code: classified.code,
            });
        }

        logBusinessActivity(tenantId, 'business_info_loaded', `جلب معلومات Business Manager: ${data.name || businessId}`, 'success');
        res.json(data);
    } catch (error) {
        console.error('[BusinessManager] Info error:', error);
        logBusinessActivity(req.query.tenant_id, 'business_info_failed', error.message || 'فشل جلب معلومات مدير الأعمال', 'error');
        res.status(500).json({ error: 'فشل جلب معلومات مدير الأعمال' });
    }
});

// ============================================
// Get owned ad accounts
// ============================================
router.get('/:businessId/ad-accounts', async (req, res) => {
    try {
        const { businessId } = req.params;
        const tenantId = req.query.tenant_id;

        const accessToken = requireBusinessAccessToken(res, tenantId);
        if (!accessToken) return;

        const fields = 'name,account_id,account_status,currency,timezone_name,balance,amount_spent';
        const response = await fetch(
            `${META_API_BASE}/${businessId}/owned_ad_accounts?fields=${fields}&limit=50`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            const classified = classifyBusinessError(metaResult.error);
            logBusinessActivity(tenantId, 'business_ad_accounts_failed', classified.label, 'error');
            // If permission error, return empty list instead of failing
            if (metaResult.error?.code === 100 || metaResult.error?.type === 'OAuthException') {
                return res.json({
                    ad_accounts: [],
                    paging: null,
                    permission_error: classified.label,
                    reason_code: classified.code,
                });
            }
            return res.status(metaResult.status).json({
                error: metaResult.error?.message || 'فشل جلب الحسابات الإعلانية',
                details: metaResult.error,
                reason_code: classified.code,
            });
        }

        logBusinessActivity(tenantId, 'business_ad_accounts_loaded', `جلب الحسابات الإعلانية: ${(data.data || []).length}`, 'success');
        res.json({
            ad_accounts: data.data || [],
            paging: data.paging || null
        });
    } catch (error) {
        console.error('[BusinessManager] Ad accounts error:', error);
        res.status(500).json({ error: 'فشل جلب الحسابات الإعلانية' });
    }
});

// ============================================
// Claim ad account
// ============================================
router.post('/:businessId/claim-ad-account', async (req, res) => {
    try {
        const { businessId } = req.params;
        const { tenant_id, adaccount_id } = req.body;

        const accessToken = requireBusinessAccessToken(res, tenant_id);
        if (!accessToken) return;

        if (!adaccount_id) {
            return res.status(400).json({ error: 'معرف الحساب الإعلاني مطلوب' });
        }

        const response = await fetch(
            `${META_API_BASE}/${businessId}/claimed_adaccounts`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ adaccount_id })
            }
        );

        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            const classified = classifyBusinessError(metaResult.error);
            logBusinessActivity(tenant_id, 'business_ad_account_claim_failed', classified.label, 'error');
            return res.status(metaResult.status).json({
                error: metaResult.error?.message || 'فشل المطالبة بالحساب الإعلاني',
                details: metaResult.error,
                reason_code: classified.code,
            });
        }

        logBusinessActivity(tenant_id, 'business_ad_account_claimed', `المطالبة بحساب إعلاني: ${adaccount_id}`, 'success');
        res.json({ success: true, data });
    } catch (error) {
        console.error('[BusinessManager] Claim ad account error:', error);
        logBusinessActivity(req.body?.tenant_id, 'business_ad_account_claim_failed', error.message || 'فشل المطالبة بالحساب الإعلاني', 'error');
        res.status(500).json({ error: 'فشل المطالبة بالحساب الإعلاني' });
    }
});

// ============================================
// Get business assets
// ============================================
router.get('/:businessId/assets', async (req, res) => {
    try {
        const { businessId } = req.params;
        const tenantId = req.query.tenant_id;

        const accessToken = requireBusinessAccessToken(res, tenantId);
        if (!accessToken) return;

        // Fetch multiple asset types in parallel
        const [pagesRes, wabaRes] = await Promise.all([
            fetch(`${META_API_BASE}/${businessId}/owned_pages?fields=name,id,category&limit=50`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }).catch(() => null),
            fetch(`${META_API_BASE}/${businessId}/owned_whatsapp_business_accounts?fields=name,id,currency,timezone_id&limit=50`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }).catch(() => null)
        ]);

        const parseSafe = async (response) => {
            if (!response) return { data: [] };
            const metaResult = await readMetaResponse(response);
            if (!metaResult.ok && (metaResult.error?.code === 100 || metaResult.error?.type === 'OAuthException')) {
                return { data: [], permission_error: metaResult.error?.message };
            }
            return metaResult.ok ? metaResult.data : { data: [] };
        };

        const [pagesData, wabaData] = await Promise.all([
            parseSafe(pagesRes),
            parseSafe(wabaRes)
        ]);

        const permissionErrors = [pagesData.permission_error, wabaData.permission_error].filter(Boolean);
        logBusinessActivity(
            tenantId,
            permissionErrors.length ? 'business_assets_failed' : 'business_assets_loaded',
            permissionErrors.length
                ? permissionErrors.join(' | ')
                : `جلب أصول Business Manager: صفحات ${(pagesData.data || []).length}، WABA ${(wabaData.data || []).length}`,
            permissionErrors.length ? 'error' : 'success'
        );

        res.json({
            pages: pagesData.data || [],
            whatsapp_accounts: wabaData.data || [],
            permission_errors: {
                pages: pagesData.permission_error || null,
                whatsapp_accounts: wabaData.permission_error || null,
            },
        });
    } catch (error) {
        console.error('[BusinessManager] Assets error:', error);
        logBusinessActivity(req.query.tenant_id, 'business_assets_failed', error.message || 'فشل جلب أصول الأعمال', 'error');
        res.status(500).json({ error: 'فشل جلب أصول الأعمال' });
    }
});

// ============================================
// Get owned WABA accounts
// ============================================
router.get('/:businessId/whatsapp-accounts', async (req, res) => {
    try {
        const { businessId } = req.params;
        const tenantId = req.query.tenant_id;

        const accessToken = requireBusinessAccessToken(res, tenantId);
        if (!accessToken) return;

        const response = await fetch(
            `${META_API_BASE}/${businessId}/owned_whatsapp_business_accounts?fields=name,id,currency,timezone_id,message_template_namespace`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            return sendMetaFailure(res, metaResult, 'فشل جلب حسابات واتساب');
        }

        res.json({
            whatsapp_accounts: data.data || [],
            paging: data.paging || null
        });
    } catch (error) {
        console.error('[BusinessManager] WABA accounts error:', error);
        res.status(500).json({ error: 'فشل جلب حسابات واتساب' });
    }
});

export default router;
