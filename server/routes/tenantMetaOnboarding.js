import crypto from 'node:crypto';
import express from 'express';

import {
    FACEBOOK_REDIRECT_URI,
    META_API_BASE,
    META_API_VERSION,
    META_APP_ID,
    META_APP_SECRET,
    WA_EMBEDDED_SIGNUP_CONFIG_ID,
} from '../config/index.js';
import { requestMetaJson, sendMetaFailure } from '../services/metaHttp.js';
import { parseListPagination } from '../services/pagination.js';

const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000;

const normalizeString = (value, maxLength = 500) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized && normalized.length <= maxLength ? normalized : null;
};

const parsePositiveId = value => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 && String(parsed) === String(value).trim() ? parsed : null;
};

const parseStoredList = value => {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const buildFormRequest = values => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values).toString(),
});

export function createTenantMetaOnboardingRouter({
    database,
    encryptToken,
    decryptToken,
    buildReadiness,
    listSnapshots,
    saveSnapshot,
    requestMeta = requestMetaJson,
    randomBytes = crypto.randomBytes,
    now = Date.now,
    sessionTtlMs = DEFAULT_SESSION_TTL_MS,
    config = {},
} = {}) {
    if (
        !database
        || typeof encryptToken !== 'function'
        || typeof decryptToken !== 'function'
        || typeof buildReadiness !== 'function'
        || typeof listSnapshots !== 'function'
        || typeof saveSnapshot !== 'function'
    ) {
        throw new TypeError('Tenant Meta onboarding router requires database, token and readiness dependencies');
    }

    const meta = {
        apiBase: config.apiBase || META_API_BASE,
        apiVersion: config.apiVersion || META_API_VERSION,
        appId: config.appId ?? META_APP_ID,
        appSecret: config.appSecret ?? META_APP_SECRET,
        redirectUri: config.redirectUri ?? FACEBOOK_REDIRECT_URI,
        whatsappConfigId: config.whatsappConfigId ?? WA_EMBEDDED_SIGNUP_CONFIG_ID,
        reviewScopes: Object.freeze([...(config.reviewScopes || [])]),
        webhookFields: Object.freeze([...(config.webhookFields || [])]),
    };
    const oauthSessions = new Map();

    const pruneSessions = () => {
        const currentTime = now();
        for (const [state, session] of oauthSessions) {
            if (currentTime - session.createdAt > sessionTtlMs) oauthSessions.delete(state);
        }
    };

    const createSession = (kind, tenantId, values = {}) => {
        pruneSessions();
        const state = randomBytes(32).toString('hex');
        oauthSessions.set(state, { kind, tenantId, createdAt: now(), ...values });
        return state;
    };

    const consumeSession = (stateValue, tenantId, kind) => {
        pruneSessions();
        const state = normalizeString(stateValue, 256);
        if (!state) return null;
        const session = oauthSessions.get(state);
        if (!session || session.tenantId !== tenantId || session.kind !== kind) return null;
        oauthSessions.delete(state);
        return session;
    };

    const getTenantWhatsAppStatus = tenantId => {
        const tenant = database.prepare(`
            SELECT id, waba_id, phone_number_id, business_id,
                   access_token, access_token_encrypted, updated_at
            FROM tenants
            WHERE id = ?
        `).get(tenantId);
        const lastConnected = database.prepare(`
            SELECT created_at
            FROM activity_logs
            WHERE tenant_id = ? AND event_type = 'whatsapp_connected' AND status = 'success'
            ORDER BY created_at DESC, id DESC
            LIMIT 1
        `).get(tenantId);
        const tokenPresent = !!(tenant?.access_token || tenant?.access_token_encrypted);
        return {
            connected: !!(tenant?.waba_id && tenant?.phone_number_id && tokenPresent),
            waba_id: tenant?.waba_id || null,
            phone_number_id: tenant?.phone_number_id || null,
            business_id: tenant?.business_id || null,
            token_present: tokenPresent,
            connected_at: lastConnected?.created_at || null,
            updated_at: tenant?.updated_at || null,
        };
    };

    const router = express.Router();

    router.get('/meta/config', (_req, res) => res.json({
        app_id: meta.appId,
        config_id: meta.whatsappConfigId,
        api_version: meta.apiVersion,
        facebook_review_scopes: meta.reviewScopes,
        facebook_webhook_fields: meta.webhookFields,
        facebook_oauth_available: !!(meta.appId && meta.appSecret && meta.redirectUri),
        whatsapp_signup_available: !!(meta.appId && meta.whatsappConfigId),
    }));

    router.get('/facebook/auth-url', (req, res) => {
        if (!meta.appId || !meta.appSecret || !meta.redirectUri) {
            return res.status(400).json({ error: 'Facebook OAuth not configured' });
        }
        const state = createSession('facebook_auth', req.user.tenant_id);
        const params = new URLSearchParams({
            client_id: meta.appId,
            redirect_uri: meta.redirectUri,
            state,
            scope: meta.reviewScopes.join(','),
            response_type: 'code',
        });
        return res.json({
            url: `https://www.facebook.com/${meta.apiVersion}/dialog/oauth?${params.toString()}`,
            state,
        });
    });

    router.post('/facebook/connect', async (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const code = normalizeString(req.body?.code, 4096);
            const state = normalizeString(req.body?.state, 256);
            if (!code || !state) return res.status(400).json({ error: 'code and state are required' });

            const session = consumeSession(state, tenantId, 'facebook_auth');
            if (!session) return res.status(400).json({ error: 'Invalid or expired OAuth state' });

            const tokenResult = await requestMeta(
                `${meta.apiBase}/oauth/access_token`,
                buildFormRequest({
                    client_id: meta.appId,
                    redirect_uri: meta.redirectUri,
                    client_secret: meta.appSecret,
                    code,
                })
            );
            if (!tokenResult.ok) return sendMetaFailure(res, tokenResult, 'Token exchange failed');
            const shortLivedToken = normalizeString(tokenResult.data?.access_token, 8192);
            if (!shortLivedToken) return res.status(502).json({ error: 'Token exchange returned no access token' });

            const longLivedResult = await requestMeta(
                `${meta.apiBase}/oauth/access_token`,
                buildFormRequest({
                    grant_type: 'fb_exchange_token',
                    client_id: meta.appId,
                    client_secret: meta.appSecret,
                    fb_exchange_token: shortLivedToken,
                })
            );
            if (!longLivedResult.ok) {
                return sendMetaFailure(res, longLivedResult, 'Long-lived token exchange failed');
            }
            const longLivedToken = normalizeString(longLivedResult.data?.access_token, 8192);
            if (!longLivedToken) {
                return res.status(502).json({ error: 'Long-lived token exchange returned no access token' });
            }

            let grantedScopes = [];
            let tokenStatus = 'unchecked';
            let tokenExpiresAt = null;
            let tokenAppId = null;
            let facebookUserProfile = null;
            if (meta.appId && meta.appSecret) {
                try {
                    const debugResult = await requestMeta(
                        `${meta.apiBase}/debug_token?input_token=${encodeURIComponent(longLivedToken)}`,
                        { headers: { Authorization: `Bearer ${meta.appId}|${meta.appSecret}` } }
                    );
                    if (debugResult.ok) {
                        const debugTokenData = debugResult.data?.data || {};
                        grantedScopes = Array.isArray(debugTokenData.scopes) ? debugTokenData.scopes : [];
                        tokenStatus = debugTokenData.is_valid === true ? 'valid' : 'invalid';
                        tokenExpiresAt = debugTokenData.expires_at > 0
                            ? new Date(debugTokenData.expires_at * 1000).toISOString()
                            : null;
                        tokenAppId = debugTokenData.app_id || null;
                    }
                } catch (error) {
                    console.warn('[TenantMetaOnboarding] Facebook token debug failed:', error.message);
                }
            }

            try {
                const profileResult = await requestMeta(
                    `${meta.apiBase}/me?fields=id,name,email,picture.width(100).height(100)`,
                    { headers: { Authorization: `Bearer ${longLivedToken}` } }
                );
                if (profileResult.ok) {
                    const profileData = profileResult.data || {};
                    facebookUserProfile = {
                        id: profileData.id || null,
                        name: profileData.name || null,
                        email: profileData.email || null,
                        picture_url: profileData.picture?.data?.url || null,
                    };
                } else {
                    console.warn(
                        '[TenantMetaOnboarding] Facebook profile fetch failed:',
                        profileResult.status,
                        profileResult.error?.code
                    );
                }
            } catch (error) {
                console.warn('[TenantMetaOnboarding] Facebook profile fetch failed:', error.message);
            }

            database.transaction(() => {
                database.prepare(`
                    UPDATE tenants
                    SET facebook_user_access_token_encrypted = ?,
                        facebook_user_token_scopes = ?,
                        facebook_user_token_updated_at = datetime('now', 'localtime'),
                        facebook_user_token_status = ?,
                        facebook_user_token_expires_at = ?,
                        facebook_user_token_checked_at = datetime('now', 'localtime'),
                        facebook_user_token_app_id = ?,
                        updated_at = datetime('now', 'localtime')
                    WHERE id = ?
                `).run(
                    encryptToken(longLivedToken),
                    JSON.stringify(grantedScopes),
                    tokenStatus,
                    tokenExpiresAt,
                    tokenAppId,
                    tenantId
                );

                if (facebookUserProfile?.id) {
                    database.prepare(`
                        UPDATE tenants
                        SET facebook_user_id = ?, facebook_user_name = ?, facebook_user_email = ?,
                            facebook_user_picture_url = ?,
                            facebook_user_profile_updated_at = datetime('now', 'localtime'),
                            updated_at = datetime('now', 'localtime')
                        WHERE id = ?
                    `).run(
                        facebookUserProfile.id,
                        facebookUserProfile.name,
                        facebookUserProfile.email,
                        facebookUserProfile.picture_url,
                        tenantId
                    );
                }
            })();

            const pagesResult = await requestMeta(
                `${meta.apiBase}/me/accounts?fields=id,name,category,picture.width(100).height(100),access_token`,
                { headers: { Authorization: `Bearer ${longLivedToken}` } }
            );
            if (!pagesResult.ok) return sendMetaFailure(res, pagesResult, 'Failed to fetch pages');

            const pages = (Array.isArray(pagesResult.data?.data) ? pagesResult.data.data : []).map(page => ({
                id: page.id,
                name: page.name,
                category: page.category,
                picture_url: page.picture?.data?.url || null,
            }));
            const linkState = createSession('facebook_link', tenantId, { longLivedToken });
            const missingScopes = meta.reviewScopes.filter(scope => !grantedScopes.includes(scope));
            return res.json({
                pages,
                link_state: linkState,
                granted_scopes: grantedScopes,
                missing_scopes: missingScopes,
                facebook_user: facebookUserProfile,
            });
        } catch (error) {
            console.error('[TenantMetaOnboarding] Facebook connect error:', error);
            return res.status(500).json({ error: 'فشل ربط فيسبوك' });
        }
    });

    router.get('/facebook/diagnostics', (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const tenant = database.prepare(`
                SELECT facebook_user_access_token_encrypted, facebook_user_token_scopes,
                       facebook_user_token_updated_at, facebook_user_id, facebook_user_name,
                       facebook_user_email, facebook_user_picture_url,
                       facebook_user_profile_updated_at
                FROM tenants
                WHERE id = ?
            `).get(tenantId);
            const grantedScopes = parseStoredList(tenant?.facebook_user_token_scopes);
            const pages = database.prepare(`
                SELECT id, page_id, page_name, page_category, page_picture_url,
                       is_active, subscribed_fields, webhook_subscribed,
                       token_status, token_expires_at, token_checked_at, updated_at
                FROM tenant_pages
                WHERE tenant_id = ?
                ORDER BY updated_at DESC, id DESC
                LIMIT 100
            `).all(tenantId).map(page => {
                const subscribedFields = parseStoredList(page.subscribed_fields);
                return {
                    ...page,
                    subscribed_fields: subscribedFields,
                    missing_webhook_fields: meta.webhookFields.filter(
                        field => !subscribedFields.includes(field)
                    ),
                };
            });
            return res.json({
                requested_scopes: meta.reviewScopes,
                granted_scopes: grantedScopes,
                missing_scopes: meta.reviewScopes.filter(scope => !grantedScopes.includes(scope)),
                facebook_user_token_present: !!tenant?.facebook_user_access_token_encrypted,
                facebook_user_token_updated_at: tenant?.facebook_user_token_updated_at || null,
                facebook_user_identity: {
                    id: tenant?.facebook_user_id || null,
                    name: tenant?.facebook_user_name || null,
                    email: tenant?.facebook_user_email || null,
                    picture_url: tenant?.facebook_user_picture_url || null,
                    updated_at: tenant?.facebook_user_profile_updated_at || null,
                    public_profile_ready: !!(tenant?.facebook_user_id && tenant?.facebook_user_name),
                    email_granted: grantedScopes.includes('email'),
                    email_ready: !!tenant?.facebook_user_email,
                },
                required_webhook_fields: meta.webhookFields,
                pages,
            });
        } catch (error) {
            console.error('[TenantMetaOnboarding] Facebook diagnostics error:', error);
            return res.status(500).json({ error: 'فشل جلب تشخيص فيسبوك' });
        }
    });

    router.get('/meta-review/readiness', async (req, res) => {
        try {
            return res.json(await buildReadiness(req.user.tenant_id));
        } catch (error) {
            console.error('[TenantMetaOnboarding] Meta review readiness error:', error);
            return res.status(error.status || 500).json({ error: 'فشل جلب جاهزية مراجعة Meta' });
        }
    });

    router.get('/meta-review/snapshots', (req, res) => {
        try {
            const { limit } = parseListPagination(req.query, { defaultLimit: 10, maxLimit: 50 });
            return res.json({ snapshots: listSnapshots(req.user.tenant_id, limit) });
        } catch (error) {
            console.error('[TenantMetaOnboarding] Meta review snapshots error:', error);
            return res.status(500).json({ error: 'فشل جلب لقطات جاهزية Meta' });
        }
    });

    router.post('/meta-review/snapshot', async (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const readiness = await buildReadiness(tenantId);
            const snapshot = saveSnapshot(tenantId, readiness);
            return res.status(201).json({ snapshot, readiness });
        } catch (error) {
            console.error('[TenantMetaOnboarding] Meta review snapshot error:', error);
            return res.status(error.status || 500).json({ error: 'فشل حفظ لقطة جاهزية Meta' });
        }
    });

    router.post('/facebook/link-pages', async (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const linkState = normalizeString(req.body?.link_state, 256);
            const requestedPageIds = Array.isArray(req.body?.page_ids)
                ? [...new Set(req.body.page_ids.map(value => normalizeString(value, 256)).filter(Boolean))]
                : null;
            if (!linkState || !requestedPageIds || requestedPageIds.length > 100) {
                return res.status(400).json({ error: 'link_state and page_ids are required' });
            }
            const session = consumeSession(linkState, tenantId, 'facebook_link');
            if (!session) return res.status(400).json({ error: 'Invalid or expired link state' });

            const pagesResult = await requestMeta(
                `${meta.apiBase}/me/accounts?fields=id,name,category,picture.width(100).height(100),access_token`,
                { headers: { Authorization: `Bearer ${session.longLivedToken}` } }
            );
            if (!pagesResult.ok) return sendMetaFailure(res, pagesResult, 'Failed to fetch pages');

            const requestedSet = new Set(requestedPageIds);
            const allPages = Array.isArray(pagesResult.data?.data) ? pagesResult.data.data : [];
            const selectedPages = allPages.filter(page => requestedSet.has(String(page.id)));
            const selectedIds = new Set(selectedPages.map(page => String(page.id)));
            const tenant = database.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId);
            const linked = [];

            for (const page of selectedPages) {
                const pageId = normalizeString(String(page.id), 256);
                const pageToken = normalizeString(page.access_token, 8192);
                if (!pageId || !pageToken) {
                    linked.push({
                        id: pageId,
                        name: page.name || null,
                        webhook_subscribed: false,
                        webhook_error: 'Page access token unavailable',
                    });
                    continue;
                }

                const encryptedToken = encryptToken(pageToken);
                const pagePictureUrl = page.picture?.data?.url || null;
                const existing = database.prepare(`
                    SELECT id
                    FROM tenant_pages
                    WHERE tenant_id = ? AND page_id = ?
                `).get(tenantId, pageId);
                let linkedPageDbId;
                if (existing) {
                    database.prepare(`
                        UPDATE tenant_pages
                        SET page_access_token_encrypted = ?, page_name = ?, page_category = ?,
                            page_picture_url = ?, is_active = 1,
                            updated_at = datetime('now', 'localtime')
                        WHERE id = ? AND tenant_id = ?
                    `).run(
                        encryptedToken,
                        page.name || null,
                        page.category || null,
                        pagePictureUrl,
                        existing.id,
                        tenantId
                    );
                    linkedPageDbId = existing.id;
                } else {
                    linkedPageDbId = database.prepare(`
                        INSERT INTO tenant_pages (
                            tenant_id, platform, page_id, page_name, page_access_token_encrypted,
                            page_category, page_picture_url, webhook_subscribed
                        ) VALUES (?, 'facebook', ?, ?, ?, ?, ?, 0)
                    `).run(
                        tenantId,
                        pageId,
                        page.name || null,
                        encryptedToken,
                        page.category || null,
                        pagePictureUrl
                    ).lastInsertRowid;
                }

                if (meta.appId && meta.appSecret) {
                    try {
                        const debugResult = await requestMeta(
                            `${meta.apiBase}/debug_token?input_token=${encodeURIComponent(pageToken)}`,
                            { headers: { Authorization: `Bearer ${meta.appId}|${meta.appSecret}` } }
                        );
                        if (debugResult.ok) {
                            const data = debugResult.data?.data || {};
                            database.prepare(`
                                UPDATE tenant_pages
                                SET token_status = ?, token_expires_at = ?,
                                    token_checked_at = datetime('now', 'localtime'),
                                    token_app_id = ?, token_scopes = ?
                                WHERE id = ? AND tenant_id = ?
                            `).run(
                                data.is_valid === true ? 'valid' : 'invalid',
                                data.expires_at > 0 ? new Date(data.expires_at * 1000).toISOString() : null,
                                data.app_id || null,
                                JSON.stringify(Array.isArray(data.scopes) ? data.scopes : []),
                                linkedPageDbId,
                                tenantId
                            );
                        }
                    } catch (error) {
                        console.warn('[TenantMetaOnboarding] Page token debug failed:', pageId, error.message);
                    }
                }

                let webhookSubscribed = false;
                let webhookError = null;
                try {
                    const subscribeResult = await requestMeta(
                        `${meta.apiBase}/${encodeURIComponent(pageId)}/subscribed_apps`,
                        {
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${pageToken}`,
                                'Content-Type': 'application/x-www-form-urlencoded',
                            },
                            body: new URLSearchParams({
                                subscribed_fields: meta.webhookFields.join(','),
                            }).toString(),
                        }
                    );
                    webhookSubscribed = subscribeResult.ok && subscribeResult.data?.success !== false;
                    webhookError = webhookSubscribed
                        ? null
                        : subscribeResult.error?.message || 'فشل اشتراك Webhook';
                } catch (error) {
                    webhookError = error.message;
                }

                database.transaction(() => {
                    database.prepare(`
                        UPDATE tenant_pages
                        SET webhook_subscribed = ?,
                            subscribed_fields = CASE WHEN ? = 1 THEN ? ELSE subscribed_fields END,
                            updated_at = datetime('now', 'localtime')
                        WHERE id = ? AND tenant_id = ?
                    `).run(
                        webhookSubscribed ? 1 : 0,
                        webhookSubscribed ? 1 : 0,
                        JSON.stringify(meta.webhookFields),
                        linkedPageDbId,
                        tenantId
                    );
                    database.prepare(`
                        INSERT INTO activity_logs (
                            tenant_id, tenant_name, event_type, description, status
                        ) VALUES (?, ?, 'page_linked', ?, 'success')
                    `).run(tenantId, tenant?.name, `ربط صفحة فيسبوك: ${page.name || pageId}`);
                })();

                linked.push({
                    id: pageId,
                    name: page.name || null,
                    webhook_subscribed: webhookSubscribed,
                    webhook_error: webhookError,
                });
            }

            return res.json({
                success: true,
                linked,
                unavailable_page_ids: requestedPageIds.filter(pageId => !selectedIds.has(pageId)),
            });
        } catch (error) {
            console.error('[TenantMetaOnboarding] Facebook link-pages error:', error);
            return res.status(500).json({ error: 'فشل ربط الصفحات' });
        }
    });

    router.delete('/facebook/disconnect/:linkedPageId', async (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const linkedPageId = parsePositiveId(req.params.linkedPageId);
            if (!linkedPageId) return res.status(400).json({ error: 'معرّف الصفحة غير صالح' });
            const page = database.prepare(`
                SELECT id, tenant_id, page_id, page_name, page_access_token_encrypted
                FROM tenant_pages
                WHERE id = ? AND tenant_id = ?
            `).get(linkedPageId, tenantId);
            if (!page) return res.status(404).json({ error: 'الصفحة غير موجودة' });

            const accessToken = decryptToken(page.page_access_token_encrypted);
            if (accessToken) {
                try {
                    await requestMeta(
                        `${meta.apiBase}/${encodeURIComponent(page.page_id)}/subscribed_apps`,
                        { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
                    );
                } catch (error) {
                    console.warn('[TenantMetaOnboarding] Webhook unsubscribe failed:', error.message);
                }
            }

            const tenant = database.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId);
            database.transaction(() => {
                database.prepare('DELETE FROM tenant_pages WHERE id = ? AND tenant_id = ?')
                    .run(linkedPageId, tenantId);
                database.prepare(`
                    INSERT INTO activity_logs (
                        tenant_id, tenant_name, event_type, description, status
                    ) VALUES (?, ?, 'page_unlinked', ?, 'success')
                `).run(
                    tenantId,
                    tenant?.name,
                    `إلغاء ربط صفحة فيسبوك: ${page.page_name || page.page_id}`
                );
            })();
            return res.json({ success: true });
        } catch (error) {
            console.error('[TenantMetaOnboarding] Facebook disconnect error:', error);
            return res.status(500).json({ error: 'فشل إلغاء ربط الصفحة' });
        }
    });

    router.get('/whatsapp/status', (req, res) => {
        try {
            return res.json(getTenantWhatsAppStatus(req.user.tenant_id));
        } catch (error) {
            console.error('[TenantMetaOnboarding] WhatsApp status error:', error);
            return res.status(500).json({ error: 'فشل جلب حالة ربط واتساب' });
        }
    });

    router.post('/whatsapp/connect', async (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const code = normalizeString(req.body?.code, 4096);
            const phoneNumberId = normalizeString(req.body?.phone_number_id, 256);
            const wabaId = normalizeString(req.body?.waba_id, 256);
            const businessId = req.body?.business_id == null
                ? null
                : normalizeString(req.body.business_id, 256);
            const forceReconnect = req.body?.force_reconnect === true;
            if (!code || !phoneNumberId || !wabaId || (req.body?.business_id != null && !businessId)) {
                return res.status(400).json({
                    error: 'code, phone_number_id, and waba_id are required',
                });
            }

            const existingStatus = getTenantWhatsAppStatus(tenantId);
            if (existingStatus.connected && !forceReconnect) {
                return res.status(409).json({
                    error: 'حساب WhatsApp مربوط بالفعل',
                    code: 'WHATSAPP_ALREADY_CONNECTED',
                    status: existingStatus,
                });
            }
            if (!meta.appId || !meta.appSecret) {
                return res.status(400).json({ error: 'Meta app not configured' });
            }

            const tokenResult = await requestMeta(
                `${meta.apiBase}/oauth/access_token`,
                buildFormRequest({ client_id: meta.appId, client_secret: meta.appSecret, code })
            );
            if (!tokenResult.ok) return sendMetaFailure(res, tokenResult, 'Token exchange failed');
            const accessToken = normalizeString(tokenResult.data?.access_token, 8192);
            if (!accessToken) return res.status(502).json({ error: 'Token exchange returned no access token' });

            const phoneNumbersResult = await requestMeta(
                `${meta.apiBase}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id&limit=100`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (!phoneNumbersResult.ok) {
                return sendMetaFailure(res, phoneNumbersResult, 'Failed to verify WhatsApp account');
            }
            const authorizedPhoneIds = new Set(
                (Array.isArray(phoneNumbersResult.data?.data) ? phoneNumbersResult.data.data : [])
                    .map(phone => String(phone.id))
            );
            if (!authorizedPhoneIds.has(phoneNumberId)) {
                return res.status(400).json({
                    error: 'phone_number_id does not belong to the authorized WhatsApp account',
                });
            }

            const encryptedToken = encryptToken(accessToken);
            const tenant = database.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId);
            database.transaction(() => {
                database.prepare(`
                    UPDATE tenants
                    SET waba_id = ?, phone_number_id = ?, business_id = ?,
                        access_token_encrypted = ?, access_token = NULL,
                        updated_at = datetime('now', 'localtime')
                    WHERE id = ?
                `).run(wabaId, phoneNumberId, businessId, encryptedToken, tenantId);
                database.prepare(`
                    INSERT INTO activity_logs (
                        tenant_id, tenant_name, event_type, description, status
                    ) VALUES (?, ?, 'whatsapp_connected', ?, 'success')
                `).run(tenantId, tenant?.name, `ربط حساب WhatsApp: ${phoneNumberId}`);
            })();

            try {
                const subscribeResult = await requestMeta(
                    `${meta.apiBase}/${encodeURIComponent(wabaId)}/subscribed_apps`,
                    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
                );
                if (!subscribeResult.ok) {
                    console.warn(
                        '[TenantMetaOnboarding] WABA webhook subscription failed:',
                        subscribeResult.error?.message
                    );
                }
            } catch (error) {
                console.warn('[TenantMetaOnboarding] WABA webhook subscription failed:', error.message);
            }

            return res.json({
                success: true,
                waba_id: wabaId,
                phone_number_id: phoneNumberId,
                status: getTenantWhatsAppStatus(tenantId),
            });
        } catch (error) {
            console.error('[TenantMetaOnboarding] WhatsApp connect error:', error);
            return res.status(500).json({ error: 'فشل ربط واتساب' });
        }
    });

    return router;
}

export default createTenantMetaOnboardingRouter;
