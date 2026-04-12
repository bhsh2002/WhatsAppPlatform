import express from 'express';
import db from '../db/database.js';
import { getAccessToken } from '../services/credentials.js';
import { META_API_BASE } from '../config/index.js';

const router = express.Router();

// ============================================
// Get Business Manager info
// ============================================
router.get('/:businessId', async (req, res) => {
    try {
        const { businessId } = req.params;
        const tenantId = req.query.tenant_id;

        let accessToken = getAccessToken(tenantId);
        if (tenantId) {
            const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
            if (tenant?.access_token) accessToken = tenant.access_token;
        }

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        const fields = 'name,id';
        const response = await fetch(
            `${META_API_BASE}/${businessId}?fields=${fields}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            // Permission error — return minimal info
            if (data.error?.code === 100 || data.error?.type === 'OAuthException') {
                return res.json({
                    id: businessId,
                    name: 'غير متاح',
                    permission_error: 'صلاحيات محدودة — بعض المعلومات غير متاحة'
                });
            }
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب معلومات مدير الأعمال',
                details: data.error
            });
        }

        res.json(data);
    } catch (error) {
        console.error('[BusinessManager] Info error:', error);
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

        let accessToken = getAccessToken(tenantId);
        if (tenantId) {
            const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
            if (tenant?.access_token) accessToken = tenant.access_token;
        }

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        const fields = 'name,account_id,account_status,currency,timezone_name,balance';
        const response = await fetch(
            `${META_API_BASE}/${businessId}/owned_ad_accounts?fields=${fields}&limit=50`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            // If permission error, return empty list instead of failing
            if (data.error?.code === 100 || data.error?.type === 'OAuthException') {
                return res.json({
                    ad_accounts: [],
                    paging: null,
                    permission_error: 'يحتاج صلاحية business_management للوصول للحسابات الإعلانية'
                });
            }
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب الحسابات الإعلانية',
                details: data.error
            });
        }

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

        let accessToken = getAccessToken(tenant_id);
        if (tenant_id) {
            const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenant_id);
            if (tenant?.access_token) accessToken = tenant.access_token;
        }

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

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

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل المطالبة بالحساب الإعلاني',
                details: data.error
            });
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('[BusinessManager] Claim ad account error:', error);
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

        let accessToken = getAccessToken(tenantId);
        if (tenantId) {
            const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
            if (tenant?.access_token) accessToken = tenant.access_token;
        }

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

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
            try {
                const json = await response.json();
                // If permission error, return empty
                if (!response.ok && (json.error?.code === 100 || json.error?.type === 'OAuthException')) {
                    return { data: [], permission_error: json.error?.message };
                }
                return response.ok ? json : { data: [] };
            } catch {
                return { data: [] };
            }
        };

        const [pagesData, wabaData] = await Promise.all([
            parseSafe(pagesRes),
            parseSafe(wabaRes)
        ]);

        res.json({
            pages: pagesData.data || [],
            whatsapp_accounts: wabaData.data || [],
        });
    } catch (error) {
        console.error('[BusinessManager] Assets error:', error);
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

        let accessToken = getAccessToken(tenantId);
        if (tenantId) {
            const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
            if (tenant?.access_token) accessToken = tenant.access_token;
        }

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        const response = await fetch(
            `${META_API_BASE}/${businessId}/owned_whatsapp_business_accounts?fields=name,id,currency,timezone_id,message_template_namespace`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب حسابات واتساب',
                details: data.error
            });
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
