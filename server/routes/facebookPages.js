import express from 'express';
import db from '../db/database.js';
import {
    META_API_BASE,
    META_APP_ID,
    META_APP_SECRET,
    META_WEBHOOK_CALLBACK_URL,
} from '../config/index.js';
import { encrypt, decrypt } from '../services/encryption.js';
import {
    FACEBOOK_WEBHOOK_FIELDS,
    getWebhookEvidence,
    parseStoredArray,
} from '../services/metaReadiness.js';
import { readMetaResponse, sendMetaFailure } from '../services/metaHttp.js';
import { fetchMetaWithAccessToken } from '../services/metaAuthorizedFetch.js';
import { parseListPagination } from '../services/pagination.js';

const router = express.Router();

const sanitizePage = (row) => {
    if (!row) return null;
    const { page_access_token_encrypted, ...rest } = row;
    return rest;
};

const normalizeUrl = (value) => {
    if (!value) return '';
    return String(value).trim().replace(/\/+$/, '');
};

const resolveWebhookCallbackUrl = (req, bodyCallbackUrl = '') => {
    const configuredUrl = normalizeUrl(META_WEBHOOK_CALLBACK_URL);
    if (configuredUrl) return configuredUrl;

    const requestedUrl = normalizeUrl(bodyCallbackUrl);
    if (requestedUrl) return requestedUrl;

    return normalizeUrl(`${req.protocol}://${req.get('host')}/webhook`);
};

const parseStoredFields = parseStoredArray;

const extractSubscriptionFields = (subscription) => {
    const rawFields = subscription?.fields ?? subscription?.subscribed_fields ?? [];
    if (Array.isArray(rawFields)) {
        return rawFields
            .map(field => {
                if (typeof field === 'string') return field;
                return field?.name || field?.field || field?.key || '';
            })
            .filter(Boolean);
    }
    if (typeof rawFields === 'string') {
        return rawFields.split(',').map(field => field.trim()).filter(Boolean);
    }
    return [];
};

const missingFields = (fields) => FACEBOOK_WEBHOOK_FIELDS.filter(field => !fields.includes(field));

const redactPayloadPreview = (preview) => {
    if (!preview) return preview;
    return String(preview)
        .replace(/"message"\s*:\s*"[^"]*"/g, '"message":"[redacted]"')
        .replace(/"text"\s*:\s*"[^"]*"/g, '"text":"[redacted]"')
        .replace(/"name"\s*:\s*"[^"]*"/g, '"name":"[redacted]"')
        .replace(/"email"\s*:\s*"[^"]*"/g, '"email":"[redacted]"');
};

const summarizeAppSubscriptions = (appSubscriptions, expectedCallbackUrl) => {
    const subscriptions = Array.isArray(appSubscriptions?.data) ? appSubscriptions.data : [];
    const pageSubscriptions = subscriptions.filter(subscription => subscription.object === 'page');
    const pageFields = [...new Set(pageSubscriptions.flatMap(extractSubscriptionFields))];
    const normalizedExpectedUrl = normalizeUrl(expectedCallbackUrl);
    const callbackMatchesExpected = pageSubscriptions.some(subscription =>
        normalizeUrl(subscription.callback_url) === normalizedExpectedUrl
    );

    return {
        page_subscription_present: pageSubscriptions.length > 0,
        page_subscription_count: pageSubscriptions.length,
        page_fields: pageFields,
        missing_fields: missingFields(pageFields),
        feed_subscribed: pageFields.includes('feed'),
        callback_matches_expected: callbackMatchesExpected,
        expected_callback_url: expectedCallbackUrl,
        page_subscriptions: pageSubscriptions.map(subscription => ({
            object: subscription.object,
            callback_url: subscription.callback_url || null,
            fields: extractSubscriptionFields(subscription),
            active: subscription.active ?? null,
        })),
    };
};

const summarizePageSubscription = (pageSubscription) => {
    const apps = Array.isArray(pageSubscription?.data) ? pageSubscription.data : [];
    const fields = [...new Set(apps.flatMap(extractSubscriptionFields))];

    return {
        subscribed: apps.length > 0,
        fields,
        missing_fields: missingFields(fields),
        feed_subscribed: fields.includes('feed'),
    };
};

// ============================================
// List ALL linked pages (across all tenants)
// ============================================
router.get('/', (req, res) => {
    try {
        const { limit, offset } = parseListPagination(req.query, {
            defaultLimit: 100,
            maxLimit: 200,
        });
        const pages = db.prepare(`
            SELECT tp.id, tp.tenant_id, tp.platform, tp.page_id, tp.page_name,
                   tp.page_category, tp.page_picture_url, tp.is_active,
                   tp.subscribed_fields, tp.webhook_subscribed, tp.created_at, tp.updated_at,
                   t.name AS tenant_name
            FROM tenant_pages tp
            JOIN tenants t ON tp.tenant_id = t.id
            ORDER BY tp.created_at DESC
            LIMIT ? OFFSET ?
        `).all(limit, offset);
        res.json(pages);
    } catch (error) {
        console.error('[FacebookPages] List all error:', error);
        res.status(500).json({ error: 'فشل جلب صفحات فيسبوك' });
    }
});

// ============================================
// List all linked pages for a tenant
// ============================================
router.get('/tenant/:tenantId', (req, res) => {
    try {
        const { tenantId } = req.params;
        const { limit, offset } = parseListPagination(req.query, {
            defaultLimit: 100,
            maxLimit: 200,
        });
        const tenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const pages = db.prepare(
            `SELECT id, tenant_id, platform, page_id, page_name, page_category, page_picture_url,
                    is_active, subscribed_fields, webhook_subscribed, created_at, updated_at,
                    CASE WHEN page_access_token_encrypted IS NOT NULL
                              AND page_access_token_encrypted <> '' THEN 1 ELSE 0 END AS page_access_token_present
             FROM tenant_pages WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
        ).all(tenantId, limit, offset);

        res.json(pages);
    } catch (error) {
        console.error('[FacebookPages] List error:', error);
        res.status(500).json({ error: 'فشل جلب صفحات فيسبوك' });
    }
});

// ============================================
// Link a new Facebook page to a tenant
// ============================================
router.post('/tenant/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { page_id, page_access_token } = req.body;

        if (!page_id || !page_access_token) {
            return res.status(400).json({ error: 'معرف الصفحة ورمز الوصول مطلوبان' });
        }

        const tenant = db.prepare('SELECT id, name FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const existing = db.prepare(
            'SELECT id, tenant_id, is_active, subscribed_fields FROM tenant_pages WHERE page_id = ?'
        ).get(page_id);
        const sameTenant = existing && String(existing.tenant_id) === String(tenantId);
        if (existing && (!sameTenant || existing.is_active)) {
            return res.status(409).json({
                error: sameTenant
                    ? 'هذه الصفحة مربوطة بالفعل بهذا العميل'
                    : 'هذه الصفحة غير متاحة للربط',
            });
        }

        // Verify the page token by fetching page info from Meta
        const fields = 'name,category,picture.width(100).height(100)';
        const verifyResponse = await fetchMetaWithAccessToken(
            `${META_API_BASE}/${encodeURIComponent(page_id)}?fields=${fields}`,
            page_access_token
        );
        const verifyResult = await readMetaResponse(verifyResponse);
        const verifyData = verifyResult.data || {};

        if (!verifyResult.ok) {
            return res.status(400).json({
                error: 'فشل التحقق من رمز الوصول',
                details: verifyResult.error,
            });
        }

        const pageName = verifyData.name || null;
        const pageCategory = verifyData.category || null;
        const pagePictureUrl = verifyData.picture?.data?.url || null;

        // Encrypt the page access token before storing
        const encryptedToken = encrypt(page_access_token);

        let linkedPageId;
        try {
            if (existing) {
                const savedFields = parseStoredFields(existing.subscribed_fields);
                const update = db.prepare(`
                    UPDATE tenant_pages
                    SET page_name = ?, page_access_token_encrypted = ?, page_category = ?, page_picture_url = ?,
                        is_active = 1, subscribed_fields = ?, webhook_subscribed = 0,
                        token_status = 'unchecked', token_expires_at = NULL, token_checked_at = NULL,
                        token_app_id = NULL, token_scopes = NULL,
                        updated_at = datetime('now', 'localtime')
                    WHERE id = ? AND tenant_id = ? AND is_active = 0
                `).run(
                    pageName,
                    encryptedToken,
                    pageCategory,
                    pagePictureUrl,
                    JSON.stringify(savedFields.length ? savedFields : FACEBOOK_WEBHOOK_FIELDS),
                    existing.id,
                    tenantId
                );
                if (!update.changes) {
                    return res.status(409).json({ error: 'هذه الصفحة مربوطة بالفعل بهذا العميل' });
                }
                linkedPageId = existing.id;
            } else {
                const result = db.prepare(`
                    INSERT INTO tenant_pages (tenant_id, platform, page_id, page_name, page_access_token_encrypted, page_category, page_picture_url, webhook_subscribed)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
                `).run(
                    tenantId,
                    'facebook',
                    page_id,
                    pageName,
                    encryptedToken,
                    pageCategory,
                    pagePictureUrl
                );
                linkedPageId = result.lastInsertRowid;
            }
        } catch (error) {
            if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(409).json({ error: 'هذه الصفحة غير متاحة للربط' });
            }
            throw error;
        }

        const newPage = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(linkedPageId);

        if (META_APP_ID && META_APP_SECRET) {
            try {
                const appAccessToken = `${META_APP_ID}|${META_APP_SECRET}`;
                const debugResponse = await fetchMetaWithAccessToken(
                    `${META_API_BASE}/debug_token?input_token=${encodeURIComponent(page_access_token)}`,
                    appAccessToken
                );
                const debugResult = await readMetaResponse(debugResponse);
                if (debugResult.ok) {
                    const tokenData = debugResult.data?.data || {};
                    db.prepare(`
                        UPDATE tenant_pages
                        SET token_status = ?,
                            token_expires_at = ?,
                            token_checked_at = datetime('now', 'localtime'),
                            token_app_id = ?,
                            token_scopes = ?
                        WHERE id = ?
                    `).run(
                        tokenData.is_valid === true ? 'valid' : 'invalid',
                        tokenData.expires_at && tokenData.expires_at > 0 ? new Date(tokenData.expires_at * 1000).toISOString() : null,
                        tokenData.app_id || null,
                        JSON.stringify(tokenData.scopes || []),
                        newPage.id
                    );
                }
            } catch (err) {
                console.warn('[FacebookPages] Page token debug failed:', err.message);
            }
        }

        // Try to subscribe the page to our app webhooks
        let webhookSubscribed = false;
        let webhookError = null;
        try {
            const subscribedFields = parseStoredFields(newPage.subscribed_fields || JSON.stringify(FACEBOOK_WEBHOOK_FIELDS));
            const fieldsString = subscribedFields.length ? subscribedFields.join(',') : FACEBOOK_WEBHOOK_FIELDS.join(',');
            const subscribeResponse = await fetch(
                `${META_API_BASE}/${encodeURIComponent(page_id)}/subscribed_apps`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                        access_token: page_access_token,
                        subscribed_fields: fieldsString,
                    }).toString(),
                }
            );
            const subscribeResult = await readMetaResponse(subscribeResponse);
            const subscribeData = subscribeResult.data || {};

            if (subscribeResult.ok && subscribeData.success !== false) {
                db.prepare("UPDATE tenant_pages SET webhook_subscribed = 1, updated_at = datetime('now', 'localtime') WHERE id = ?")
                    .run(newPage.id);
                webhookSubscribed = true;
            } else {
                webhookError = subscribeResult.error?.message || 'فشل اشتراك Webhook';
                console.warn('[FacebookPages] Webhook subscription failed:', webhookError);
            }
        } catch (err) {
            webhookError = err.message;
            console.warn('[FacebookPages] Webhook subscription error:', err.message);
        }

        // Log activity
        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (?, ?, 'page_linked', ?, 'success')
        `).run(parseInt(tenantId), tenant.name, `${existing ? 'إعادة ربط' : 'ربط'} صفحة فيسبوك: ${pageName || page_id}`);

        const finalPage = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(newPage.id);
        const response = sanitizePage(finalPage);
        if (webhookError) {
            response._webhook_warning = webhookError;
        }
        response._webhook_subscribed = webhookSubscribed;

        res.status(existing ? 200 : 201).json(response);
    } catch (error) {
        console.error('[FacebookPages] Link error:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'هذه الصفحة مربوطة بالفعل بهذا العميل' });
        }
        res.status(500).json({ error: 'فشل ربط صفحة فيسبوك' });
    }
});

// ============================================
// Update a linked page
// ============================================
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { page_access_token, is_active, page_name } = req.body;

        const existing = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'الصفحة غير موجودة' });
        }
        if (page_access_token !== undefined && (typeof page_access_token !== 'string' || !page_access_token.trim())) {
            return res.status(400).json({ error: 'أدخل رمز وصول صالحاً للصفحة' });
        }
        if (is_active && !existing.page_access_token_encrypted && page_access_token === undefined) {
            return res.status(409).json({ error: 'أعد ربط الصفحة برمز وصول صالح قبل تفعيلها' });
        }

        const setClauses = [];
        const values = [];

        if (page_name !== undefined) {
            setClauses.push('page_name = ?');
            values.push(page_name);
        }

        if (is_active !== undefined) {
            setClauses.push('is_active = ?');
            values.push(is_active ? 1 : 0);
        }

        if (page_access_token !== undefined) {
            setClauses.push('page_access_token_encrypted = ?');
            values.push(encrypt(page_access_token.trim()));
            setClauses.push("token_status = 'unchecked'");
            setClauses.push('token_expires_at = NULL');
            setClauses.push('token_checked_at = NULL');
            setClauses.push('token_app_id = NULL');
            setClauses.push('token_scopes = NULL');
            setClauses.push('webhook_subscribed = 0');
        }

        if (setClauses.length === 0) {
            return res.status(400).json({ error: 'لا توجد بيانات للتحديث' });
        }

        setClauses.push("updated_at = datetime('now', 'localtime')");
        values.push(id);

        db.prepare(`UPDATE tenant_pages SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

        const updated = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        res.json(sanitizePage(updated));
    } catch (error) {
        console.error('[FacebookPages] Update error:', error);
        res.status(500).json({ error: 'فشل تحديث الصفحة' });
    }
});

// ============================================
// Disconnect a page without deleting conversations or Content Studio records.
// ============================================
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const existing = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'الصفحة غير موجودة' });
        }

        // Clear local credentials even if Meta is temporarily unavailable.
        const accessToken = decrypt(existing.page_access_token_encrypted);
        let webhookUnsubscribed = false;
        let webhookError = null;
        if (accessToken) {
            try {
                const unsubscribeResponse = await fetch(
                    `${META_API_BASE}/${encodeURIComponent(existing.page_id)}/subscribed_apps`,
                    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
                );
                const unsubscribeResult = await readMetaResponse(unsubscribeResponse);
                webhookUnsubscribed = unsubscribeResult.ok && unsubscribeResult.data?.success !== false;
                if (!webhookUnsubscribed) webhookError = 'تعذر إلغاء اشتراك Webhook لدى Meta';
            } catch (err) {
                console.warn('[FacebookPages] Failed to unsubscribe webhook on unlink:', err.message);
                webhookError = 'تعذر الاتصال بـ Meta لإلغاء اشتراك Webhook';
            }
        } else {
            webhookError = 'رمز وصول الصفحة غير متاح لإلغاء اشتراك Webhook لدى Meta';
        }

        const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(existing.tenant_id);
        let pausedCampaigns = 0;
        let cancelledPublications = 0;
        db.transaction(() => {
            db.prepare(`
                UPDATE tenant_pages
                SET is_active = 0,
                    webhook_subscribed = 0,
                    subscribed_fields = '[]',
                    page_access_token_encrypted = NULL,
                    token_status = 'unchecked',
                    token_expires_at = NULL,
                    token_checked_at = NULL,
                    token_app_id = NULL,
                    token_scopes = NULL,
                    updated_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(id);
            pausedCampaigns = db.prepare(`
                UPDATE facebook_content_campaigns
                SET status = 'paused', next_run_at = NULL, updated_at = datetime('now')
                WHERE linked_page_id = ? AND status = 'active'
            `).run(id).changes;
            cancelledPublications = db.prepare(`
                UPDATE facebook_content_publications
                SET status = 'cancelled', next_attempt_at = NULL, updated_at = datetime('now')
                WHERE linked_page_id = ? AND status = 'pending'
            `).run(id).changes;
            if (!tenant) return;
            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'page_unlinked', ?, ?)
            `).run(
                existing.tenant_id,
                tenant.name,
                webhookUnsubscribed
                    ? `إلغاء ربط صفحة فيسبوك: ${existing.page_name || existing.page_id}`
                    : `تعطيل صفحة فيسبوك محلياً مع تعذر إلغاء Webhook لدى Meta: ${existing.page_name || existing.page_id}`,
                webhookUnsubscribed ? 'success' : 'failed'
            );
        })();

        res.json({
            success: webhookUnsubscribed,
            partial_success: !webhookUnsubscribed,
            local_disconnected: true,
            webhook_unsubscribed: webhookUnsubscribed,
            webhook_error: webhookError,
            data_preserved: true,
            paused_campaigns: pausedCampaigns,
            cancelled_publications: cancelledPublications,
        });
    } catch (error) {
        console.error('[FacebookPages] Delete error:', error);
        res.status(500).json({ error: 'فشل فك ربط الصفحة' });
    }
});

// ============================================
// Verify a page token still works
// ============================================
router.post('/:id/verify', async (req, res) => {
    try {
        const { id } = req.params;

        const existing = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'الصفحة غير موجودة' });
        }

        const accessToken = decrypt(existing.page_access_token_encrypted);
        if (!accessToken) {
            return res.status(400).json({ error: 'رمز الوصول غير متوفر أو غير صالح' });
        }

        const fields = 'name,category,picture.width(100).height(100)';
        const response = await fetchMetaWithAccessToken(
            `${META_API_BASE}/${encodeURIComponent(existing.page_id)}?fields=${fields}`,
            accessToken
        );
        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            return res.status(400).json({
                valid: false,
                error: metaResult.error?.message || 'رمز الوصول غير صالح',
            });
        }

        // Update page info if changed
        const updates = [];
        const values = [];
        if (data.name && data.name !== existing.page_name) {
            updates.push('page_name = ?');
            values.push(data.name);
        }
        if (data.category && data.category !== existing.page_category) {
            updates.push('page_category = ?');
            values.push(data.category);
        }
        if (data.picture?.data?.url && data.picture.data.url !== existing.page_picture_url) {
            updates.push('page_picture_url = ?');
            values.push(data.picture.data.url);
        }
        if (updates.length > 0) {
            updates.push("updated_at = datetime('now', 'localtime')");
            values.push(id);
            db.prepare(`UPDATE tenant_pages SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        }

        const refreshed = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        res.json({
            valid: true,
            page: sanitizePage(refreshed),
            info: {
                name: data.name,
                category: data.category,
                picture: data.picture?.data?.url || null,
            },
        });
    } catch (error) {
        console.error('[FacebookPages] Verify error:', error);
        res.status(500).json({ error: 'فشل التحقق من رمز الوصول' });
    }
});

// ============================================
// Re-subscribe a page to webhooks
// ============================================
router.post('/:id/subscribe', async (req, res) => {
    try {
        const { id } = req.params;

        const existing = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'الصفحة غير موجودة' });
        }

        const accessToken = decrypt(existing.page_access_token_encrypted);
        if (!accessToken) {
            return res.status(400).json({ error: 'رمز الوصول غير متوفر أو غير صالح' });
        }

        const subscribedFields = parseStoredFields(existing.subscribed_fields || JSON.stringify(FACEBOOK_WEBHOOK_FIELDS));
        const fieldsString = subscribedFields.length ? subscribedFields.join(',') : FACEBOOK_WEBHOOK_FIELDS.join(',');

        const response = await fetch(
            `${META_API_BASE}/${encodeURIComponent(existing.page_id)}/subscribed_apps`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    access_token: accessToken,
                    subscribed_fields: fieldsString,
                }).toString(),
            }
        );
        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            return sendMetaFailure(res, metaResult, 'فشل اشتراك Webhook');
        }

        db.prepare("UPDATE tenant_pages SET webhook_subscribed = 1, updated_at = datetime('now', 'localtime') WHERE id = ?")
            .run(id);

        const updated = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        res.json({
            success: true,
            page: sanitizePage(updated),
        });
    } catch (error) {
        console.error('[FacebookPages] Subscribe error:', error);
        res.status(500).json({ error: 'فشل اشتراك Webhook' });
    }
});

// ============================================
// GET /:id/subscription-status — Check webhook subscription status
// ============================================
router.get('/:id/subscription-status', async (req, res) => {
    try {
        const { id } = req.params;
        const page = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        if (!page) return res.status(404).json({ error: 'الصفحة غير موجودة' });

        const accessToken = decrypt(page.page_access_token_encrypted);
        if (!accessToken) {
            return res.status(400).json({ error: 'رمز الوصول غير متوفر' });
        }

        const response = await fetchMetaWithAccessToken(
            `${META_API_BASE}/${encodeURIComponent(page.page_id)}/subscribed_apps`,
            accessToken
        );
        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            return sendMetaFailure(res, metaResult, 'فشل جلب حالة الاشتراك');
        }

        res.json({
            page_id: page.page_id,
            page_name: page.page_name,
            webhook_subscribed_in_db: !!page.webhook_subscribed,
            meta_response: data,
        });
    } catch (error) {
        console.error('[FacebookPages] Subscription status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GET /webhook-diagnostic — Full diagnostic of webhook configuration
// ============================================
router.get('/webhook-diagnostic', async (req, res) => {
    try {
        const appId = META_APP_ID;
        const appSecret = META_APP_SECRET;
        const expectedCallbackUrl = resolveWebhookCallbackUrl(req);

        if (!appId || !appSecret) {
            return res.status(400).json({ error: 'META_APP_ID/META_APP_SECRET not set' });
        }

        const appAccessToken = `${appId}|${appSecret}`;
        const results = {
            app_id: appId,
            api_version: META_API_BASE,
            expected_callback_url: expectedCallbackUrl,
            callback_url_source: META_WEBHOOK_CALLBACK_URL ? 'META_WEBHOOK_CALLBACK_URL' : 'request',
            required_fields: FACEBOOK_WEBHOOK_FIELDS,
        };

        // 1. Check app-level subscriptions
        const subsRes = await fetchMetaWithAccessToken(
            `${META_API_BASE}/${encodeURIComponent(appId)}/subscriptions`,
            appAccessToken
        );
        const subscriptionsResult = await readMetaResponse(subsRes);
        results.app_subscriptions = subscriptionsResult.ok
            ? subscriptionsResult.data
            : { error: subscriptionsResult.error };
        results.app_subscription_summary = summarizeAppSubscriptions(
            results.app_subscriptions,
            expectedCallbackUrl
        );

        // 2. Check all linked pages
        const pages = db.prepare(
            'SELECT * FROM tenant_pages WHERE is_active = 1 ORDER BY id ASC LIMIT 100'
        ).all();
        const activePageCount = db.prepare(
            'SELECT COUNT(*) AS count FROM tenant_pages WHERE is_active = 1'
        ).get()?.count || 0;
        results.linked_pages_truncated = activePageCount > pages.length;
        results.linked_pages_total = activePageCount;
        results.linked_pages = [];

        for (const page of pages) {
            const pageToken = decrypt(page.page_access_token_encrypted);
            const storedSubscribedFields = parseStoredFields(page.subscribed_fields);
            const pageInfo = {
                id: page.id,
                tenant_id: page.tenant_id,
                page_id: page.page_id,
                page_name: page.page_name,
                webhook_subscribed_in_db: !!page.webhook_subscribed,
                stored_subscribed_fields: storedSubscribedFields,
                stored_missing_fields: missingFields(storedSubscribedFields),
            };

            if (pageToken) {
                // Check page-level subscription
                const pageSubRes = await fetchMetaWithAccessToken(
                    `${META_API_BASE}/${encodeURIComponent(page.page_id)}/subscribed_apps`,
                    pageToken
                );
                const pageSubscriptionResult = await readMetaResponse(pageSubRes);
                pageInfo.page_subscription = pageSubscriptionResult.ok
                    ? pageSubscriptionResult.data
                    : { error: pageSubscriptionResult.error };
                pageInfo.page_subscription_summary = summarizePageSubscription(pageInfo.page_subscription);

                // Check token permissions
                const debugRes = await fetchMetaWithAccessToken(
                    `${META_API_BASE}/debug_token?input_token=${encodeURIComponent(pageToken)}`,
                    appAccessToken
                );
                const debugResult = await readMetaResponse(debugRes);
                const debugData = debugResult.ok ? (debugResult.data?.data || {}) : {};
                pageInfo.token_scopes = debugData.scopes || [];
                pageInfo.token_valid = debugData.is_valid || false;
                pageInfo.token_app_id = debugData.app_id || null;
                pageInfo.token_app_id_matches = !META_APP_ID || !debugData.app_id || String(debugData.app_id) === String(META_APP_ID);
                pageInfo.token_expires_at = debugData.expires_at || null;
                if (!debugResult.ok) pageInfo.token_error = debugResult.error;
            } else {
                pageInfo.error = 'Cannot decrypt page token';
            }

            results.linked_pages.push(pageInfo);
        }

        const pageWebhookLogs = db.prepare(`
            SELECT id, tenant_id, event_type, substr(payload, 1, 500) AS payload_preview, created_at
            FROM webhook_logs
            WHERE event_type = 'page'
            ORDER BY created_at DESC
            LIMIT 10
        `).all().map(row => ({
            ...row,
            payload_preview: redactPayloadPreview(row.payload_preview),
        }));

        const pageWebhookLogCount = db.prepare(`
            SELECT COUNT(*) AS count, MAX(created_at) AS latest_at
            FROM webhook_logs
            WHERE event_type = 'page'
        `).get();
        const webhookEvidence = getWebhookEvidence();
        results.webhook_evidence = webhookEvidence;

        const pagesWithFeed = results.linked_pages.filter(page =>
            page.page_subscription_summary?.feed_subscribed || page.stored_subscribed_fields.includes('feed')
        );
        const feedCommentEvidence = webhookEvidence.by_event_key?.['feed:comment:add'] || null;
        const feedReactionEvidence = webhookEvidence.by_event_key?.['feed:reaction:add'] || null;
        const feedProductionCount = (feedCommentEvidence?.production_count || 0) + (feedReactionEvidence?.production_count || 0);

        const warnings = [];
        if (!results.app_subscription_summary.page_subscription_present) {
            warnings.push('App-level Page webhook subscription is missing.');
        }
        if (!results.app_subscription_summary.feed_subscribed) {
            warnings.push('App-level Page webhook subscription does not include feed.');
        }
        if (!results.app_subscription_summary.callback_matches_expected) {
            warnings.push('App-level Page webhook callback URL does not match the expected production URL.');
        }
        if (pages.length > 0 && pagesWithFeed.length === 0) {
            warnings.push('No active linked page has feed in its page-level subscription.');
        }
        if (!pageWebhookLogCount?.count) {
            warnings.push('No page webhook logs were recorded locally.');
        }
        if (results.app_subscription_summary.feed_subscribed && pagesWithFeed.length > 0 && feedProductionCount === 0) {
            warnings.push('feed is subscribed, but no production comment/reaction feed event has been recorded yet.');
        }

        results.page_webhook_logs = {
            count: pageWebhookLogCount?.count || 0,
            latest_at: pageWebhookLogCount?.latest_at || null,
            recent: pageWebhookLogs,
        };

        results.summary = {
            ready: warnings.length === 0,
            warnings,
            app_page_subscription_present: results.app_subscription_summary.page_subscription_present,
            app_feed_subscribed: results.app_subscription_summary.feed_subscribed,
            app_callback_matches_expected: results.app_subscription_summary.callback_matches_expected,
            linked_page_count: pages.length,
            pages_with_feed_count: pagesWithFeed.length,
            last_page_webhook_at: pageWebhookLogCount?.latest_at || null,
            webhook_events_count: webhookEvidence.total_events,
            production_webhook_events_count: webhookEvidence.production_events,
            latest_by_field: Object.fromEntries(
                Object.entries(webhookEvidence.by_field || {}).map(([field, evidence]) => [
                    field,
                    {
                        count: evidence.count,
                        production_count: evidence.production_count,
                        latest_at: evidence.latest_at,
                        latest_source: evidence.latest_source,
                    },
                ])
            ),
        };

        res.json(results);
    } catch (error) {
        console.error('[FacebookPages] Diagnostic error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// POST /setup-app-webhook — Configure app-level webhook for Page events
// Uses Graph API /{app-id}/subscriptions to bypass the dashboard
// ============================================
router.post('/setup-app-webhook', async (req, res) => {
    try {
        const appId = META_APP_ID;
        const appSecret = META_APP_SECRET;
        const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;
        const callbackUrl = resolveWebhookCallbackUrl(req, req.body.callback_url);

        if (!appId || !appSecret) {
            return res.status(400).json({
                error: 'META_APP_ID and META_APP_SECRET must be set in environment',
            });
        }

        if (!verifyToken) {
            return res.status(400).json({ error: 'WEBHOOK_VERIFY_TOKEN must be set' });
        }

        // App access token = app_id|app_secret
        const appAccessToken = `${appId}|${appSecret}`;

        // Subscribe to Page object
        const subscribeRes = await fetch(
            `${META_API_BASE}/${encodeURIComponent(appId)}/subscriptions`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    object: 'page',
                    callback_url: callbackUrl,
                    fields: FACEBOOK_WEBHOOK_FIELDS.join(','),
                    verify_token: verifyToken,
                    access_token: appAccessToken,
                    include_values: 'true',
                }).toString(),
            }
        );
        const subscribeResult = await readMetaResponse(subscribeRes);
        const subscribeData = subscribeResult.data || {};

        if (!subscribeResult.ok) {
            return res.status(subscribeResult.status).json({
                error: 'Failed to subscribe',
                details: subscribeResult.error,
                callback_url_used: callbackUrl,
            });
        }

        // Verify it was set correctly
        const verifyRes = await fetchMetaWithAccessToken(
            `${META_API_BASE}/${encodeURIComponent(appId)}/subscriptions`,
            appAccessToken
        );
        const verifyResult = await readMetaResponse(verifyRes);
        if (!verifyResult.ok) {
            return sendMetaFailure(res, verifyResult, 'Failed to verify app webhook subscription');
        }
        const verifySubs = verifyResult.data;

        db.prepare(`
            INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
            VALUES (NULL, 'System', 'facebook_app_webhook_configured', ?, 'success')
        `).run(`إعادة إعداد App Webhook: ${callbackUrl}`);

        res.json({
            success: true,
            message: 'App-level webhook for Page events configured successfully',
            callback_url: callbackUrl,
            callback_url_source: META_WEBHOOK_CALLBACK_URL ? 'META_WEBHOOK_CALLBACK_URL' : req.body.callback_url ? 'request_body' : 'request',
            current_subscriptions: verifySubs,
            app_subscription_summary: summarizeAppSubscriptions(verifySubs, callbackUrl),
        });
    } catch (error) {
        console.error('[FacebookPages] Setup app webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
