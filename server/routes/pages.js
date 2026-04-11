import express from 'express';
import db from '../db/database.js';
import { getAccessToken } from '../utils/credentials.js';

const router = express.Router();

const META_API_VERSION = 'v22.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// ============================================
// List pages managed by the user
// ============================================
router.get('/me', async (req, res) => {
    try {
        const tenantId = req.query.tenant_id;

        let accessToken = getAccessToken(tenantId);
        if (tenantId) {
            const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
            if (tenant?.access_token) accessToken = tenant.access_token;
        }

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        const fields = 'name,id,access_token,category,category_list,fan_count,picture,verification_status,is_published';
        const response = await fetch(
            `${META_API_BASE}/me/accounts?fields=${fields}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب الصفحات',
                details: data.error
            });
        }

        res.json({
            pages: data.data || [],
            paging: data.paging || null
        });
    } catch (error) {
        console.error('[Pages] List error:', error);
        res.status(500).json({ error: 'فشل جلب الصفحات' });
    }
});

// ============================================
// Get page info
// ============================================
router.get('/:pageId/info', async (req, res) => {
    try {
        const { pageId } = req.params;
        const tenantId = req.query.tenant_id;

        let accessToken = getAccessToken(tenantId);
        if (tenantId) {
            const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
            if (tenant?.access_token) accessToken = tenant.access_token;
        }

        if (!accessToken) {
            return res.status(400).json({ error: 'بيانات الاعتماد مفقودة' });
        }

        const fields = 'name,id,category,fan_count,link,picture,about,description,verification_status,is_published,phone,emails,website';
        const response = await fetch(
            `${META_API_BASE}/${pageId}?fields=${fields}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب معلومات الصفحة',
                details: data.error
            });
        }

        res.json(data);
    } catch (error) {
        console.error('[Pages] Info error:', error);
        res.status(500).json({ error: 'فشل جلب معلومات الصفحة' });
    }
});

// ============================================
// Get linked WABA for a page
// ============================================
router.get('/:pageId/linked-waba', async (req, res) => {
    try {
        const { pageId } = req.params;
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
            `${META_API_BASE}/${pageId}?fields=page_backed_instagram_accounts,connected_whatsapp_business_account`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'فشل جلب WABA المرتبط',
                details: data.error
            });
        }

        res.json({
            page_id: pageId,
            whatsapp_business_account: data.connected_whatsapp_business_account || null
        });
    } catch (error) {
        console.error('[Pages] Linked WABA error:', error);
        res.status(500).json({ error: 'فشل جلب WABA المرتبط' });
    }
});

export default router;
