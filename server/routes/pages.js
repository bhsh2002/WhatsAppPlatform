import express from 'express';
import db from '../db/database.js';
import { getFacebookUserAccessToken } from '../services/credentials.js';
import { META_API_BASE } from '../config/index.js';
import { decryptIfEncrypted } from '../services/encryption.js';
import { readMetaResponse, sendMetaFailure } from '../services/metaHttp.js';

const router = express.Router();

const resolveFacebookUserToken = (tenantId) => {
    const accessToken = getFacebookUserAccessToken(tenantId);
    if (!accessToken) {
        return {
            error: 'رمز Facebook user token مطلوب. أعد تفويض Facebook من بوابة العميل.',
            status: 400,
            code: 'FACEBOOK_USER_TOKEN_REQUIRED',
        };
    }
    return { accessToken };
};

const resolvePageOrUserToken = (tenantId, pageId) => {
    if (tenantId && pageId) {
        const linkedPage = db.prepare(`
            SELECT page_access_token_encrypted
            FROM tenant_pages
            WHERE tenant_id = ? AND page_id = ? AND is_active = 1
        `).get(tenantId, pageId);
        const pageToken = linkedPage?.page_access_token_encrypted
            ? decryptIfEncrypted(linkedPage.page_access_token_encrypted)
            : null;
        if (pageToken) return { accessToken: pageToken, source: 'page_token' };
    }

    const userToken = resolveFacebookUserToken(tenantId);
    if (userToken.error) return userToken;
    return { accessToken: userToken.accessToken, source: 'facebook_user_token' };
};

// ============================================
// List pages managed by the user
// ============================================
router.get('/me', async (req, res) => {
    try {
        const tenantId = req.query.tenant_id;

        const tokenResult = resolveFacebookUserToken(tenantId);
        if (tokenResult.error) {
            return res.status(tokenResult.status).json(tokenResult);
        }

        const fields = 'name,id,access_token,category,category_list,fan_count,picture,verification_status,is_published';
        const response = await fetch(
            `${META_API_BASE}/me/accounts?fields=${fields}`,
            {
                headers: { 'Authorization': `Bearer ${tokenResult.accessToken}` }
            }
        );

        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            return sendMetaFailure(res, metaResult, 'فشل جلب الصفحات');
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

        const tokenResult = resolvePageOrUserToken(tenantId, pageId);
        if (tokenResult.error) {
            return res.status(tokenResult.status).json(tokenResult);
        }

        const fields = 'name,id,category,fan_count,link,picture,about,description,verification_status,is_published,phone,emails,website';
        const response = await fetch(
            `${META_API_BASE}/${pageId}?fields=${fields}`,
            {
                headers: { 'Authorization': `Bearer ${tokenResult.accessToken}` }
            }
        );

        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            return sendMetaFailure(res, metaResult, 'فشل جلب معلومات الصفحة');
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

        const tokenResult = resolvePageOrUserToken(tenantId, pageId);
        if (tokenResult.error) {
            return res.status(tokenResult.status).json(tokenResult);
        }

        const response = await fetch(
            `${META_API_BASE}/${pageId}?fields=page_backed_instagram_accounts,connected_whatsapp_business_account`,
            {
                headers: { 'Authorization': `Bearer ${tokenResult.accessToken}` }
            }
        );

        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            return sendMetaFailure(res, metaResult, 'فشل جلب WABA المرتبط');
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
