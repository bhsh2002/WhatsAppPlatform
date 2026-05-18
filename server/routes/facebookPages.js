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
        const pages = db.prepare(`
            SELECT tp.id, tp.tenant_id, tp.platform, tp.page_id, tp.page_name,
                   tp.page_category, tp.page_picture_url, tp.is_active,
                   tp.subscribed_fields, tp.webhook_subscribed, tp.created_at, tp.updated_at,
                   t.name AS tenant_name
            FROM tenant_pages tp
            JOIN tenants t ON tp.tenant_id = t.id
            ORDER BY tp.created_at DESC
        `).all();
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
        const tenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }

        const pages = db.prepare(
            'SELECT id, tenant_id, platform, page_id, page_name, page_category, page_picture_url, is_active, subscribed_fields, webhook_subscribed, created_at, updated_at FROM tenant_pages WHERE tenant_id = ? ORDER BY created_at DESC'
        ).all(tenantId);

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

        const existing = db.prepare('SELECT id FROM tenant_pages WHERE tenant_id = ? AND page_id = ?').get(tenantId, page_id);
        if (existing) {
            return res.status(409).json({ error: 'هذه الصفحة مربوطة بالفعل بهذا العميل' });
        }

        // Verify the page token by fetching page info from Meta
        const fields = 'name,category,picture.width(100).height(100)';
        const verifyResponse = await fetch(
            `${META_API_BASE}/${page_id}?fields=${fields}&access_token=${page_access_token}`
        );
        const verifyData = await verifyResponse.json();

        if (!verifyResponse.ok || verifyData.error) {
            const errMsg = verifyData.error?.message || 'رمز الوصول غير صالح أو الصفحة غير موجودة';
            return res.status(400).json({
                error: 'فشل التحقق من رمز الوصول',
                details: errMsg,
            });
        }

        const pageName = verifyData.name || null;
        const pageCategory = verifyData.category || null;
        const pagePictureUrl = verifyData.picture?.data?.url || null;

        // Encrypt the page access token before storing
        const encryptedToken = encrypt(page_access_token);

        const stmt = db.prepare(`
            INSERT INTO tenant_pages (tenant_id, platform, page_id, page_name, page_access_token_encrypted, page_category, page_picture_url, webhook_subscribed)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `);
        const result = stmt.run(tenantId, 'facebook', page_id, pageName, encryptedToken, pageCategory, pagePictureUrl);

        const newPage = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(result.lastInsertRowid);

        if (META_APP_ID && META_APP_SECRET) {
            try {
                const appAccessToken = `${META_APP_ID}|${META_APP_SECRET}`;
                const debugResponse = await fetch(
                    `${META_API_BASE}/debug_token?input_token=${encodeURIComponent(page_access_token)}&access_token=${encodeURIComponent(appAccessToken)}`
                );
                const debugData = await debugResponse.json();
                const tokenData = debugData.data || {};
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
                `${META_API_BASE}/${page_id}/subscribed_apps`,
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
            const subscribeData = await subscribeResponse.json();

            if (subscribeResponse.ok && subscribeData.success !== false) {
                db.prepare("UPDATE tenant_pages SET webhook_subscribed = 1, updated_at = datetime('now', 'localtime') WHERE id = ?")
                    .run(newPage.id);
                webhookSubscribed = true;
            } else {
                webhookError = subscribeData.error?.message || 'فشل اشتراك Webhook';
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
        `).run(parseInt(tenantId), tenant.name, `ربط صفحة فيسبوك: ${pageName || page_id}`);

        const finalPage = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(newPage.id);
        const response = sanitizePage(finalPage);
        if (webhookError) {
            response._webhook_warning = webhookError;
        }
        response._webhook_subscribed = webhookSubscribed;

        res.status(201).json(response);
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
            values.push(encrypt(page_access_token));
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
// Unlink a page (unsubscribe webhook + delete)
// ============================================
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const existing = db.prepare('SELECT * FROM tenant_pages WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'الصفحة غير موجودة' });
        }

        // Try to unsubscribe the page from our webhooks
        const accessToken = decrypt(existing.page_access_token_encrypted);
        if (accessToken) {
            try {
                await fetch(
                    `${META_API_BASE}/${existing.page_id}/subscribed_apps?access_token=${accessToken}`,
                    { method: 'DELETE' }
                );
            } catch (err) {
                console.warn('[FacebookPages] Failed to unsubscribe webhook on unlink:', err.message);
            }
        }

        const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(existing.tenant_id);

        db.prepare('DELETE FROM tenant_pages WHERE id = ?').run(id);

        // Log activity
        if (tenant) {
            db.prepare(`
                INSERT INTO activity_logs (tenant_id, tenant_name, event_type, description, status)
                VALUES (?, ?, 'page_unlinked', ?, 'success')
            `).run(existing.tenant_id, tenant.name, `فك ربط صفحة فيسبوك: ${existing.page_name || existing.page_id}`);
        }

        res.json({ message: 'تم فك ربط الصفحة بنجاح' });
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
        const response = await fetch(
            `${META_API_BASE}/${existing.page_id}?fields=${fields}&access_token=${accessToken}`
        );
        const data = await response.json();

        if (!response.ok || data.error) {
            return res.status(400).json({
                valid: false,
                error: data.error?.message || 'رمز الوصول غير صالح',
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
            `${META_API_BASE}/${existing.page_id}/subscribed_apps`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    access_token: accessToken,
                    subscribed_fields: fieldsString,
                }).toString(),
            }
        );
        const data = await response.json();

        if (!response.ok || data.error) {
            return res.status(response.status || 400).json({
                error: data.error?.message || 'فشل اشتراك Webhook',
                details: data.error,
            });
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

        const response = await fetch(
            `${META_API_BASE}/${page.page_id}/subscribed_apps?access_token=${accessToken}`
        );
        const data = await response.json();

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
        const subsRes = await fetch(`${META_API_BASE}/${appId}/subscriptions?access_token=${appAccessToken}`);
        results.app_subscriptions = await subsRes.json();
        results.app_subscription_summary = summarizeAppSubscriptions(
            results.app_subscriptions,
            expectedCallbackUrl
        );

        // 2. Check all linked pages
        const pages = db.prepare('SELECT * FROM tenant_pages WHERE is_active = 1').all();
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
                const pageSubRes = await fetch(
                    `${META_API_BASE}/${page.page_id}/subscribed_apps?access_token=${pageToken}`
                );
                pageInfo.page_subscription = await pageSubRes.json();
                pageInfo.page_subscription_summary = summarizePageSubscription(pageInfo.page_subscription);

                // Check token permissions
                const debugRes = await fetch(
                    `${META_API_BASE}/debug_token?input_token=${pageToken}&access_token=${appAccessToken}`
                );
                const debugData = await debugRes.json();
                pageInfo.token_scopes = debugData.data?.scopes || [];
                pageInfo.token_valid = debugData.data?.is_valid || false;
                pageInfo.token_app_id = debugData.data?.app_id || null;
                pageInfo.token_app_id_matches = !META_APP_ID || !debugData.data?.app_id || String(debugData.data.app_id) === String(META_APP_ID);
                pageInfo.token_expires_at = debugData.data?.expires_at || null;
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

        // First, check current subscriptions
        const getRes = await fetch(
            `${META_API_BASE}/${appId}/subscriptions?access_token=${appAccessToken}`
        );
        const currentSubs = await getRes.json();

        console.log('[FacebookPages] Current app subscriptions:', JSON.stringify(currentSubs));

        // Subscribe to Page object
        const subscribeRes = await fetch(
            `${META_API_BASE}/${appId}/subscriptions`,
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
        const subscribeData = await subscribeRes.json();

        console.log('[FacebookPages] App webhook subscription result:', JSON.stringify(subscribeData));

        if (!subscribeRes.ok || subscribeData.error) {
            return res.status(subscribeRes.status || 400).json({
                error: 'Failed to subscribe',
                details: subscribeData.error || subscribeData,
                callback_url_used: callbackUrl,
            });
        }

        // Verify it was set correctly
        const verifyRes = await fetch(
            `${META_API_BASE}/${appId}/subscriptions?access_token=${appAccessToken}`
        );
        const verifySubs = await verifyRes.json();

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
