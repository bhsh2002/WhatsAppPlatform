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
import { safeMetaNextPageUrl } from '../services/metaPagination.js';
import { classifyMetaTokenStatus, isMetaTokenReady } from '../services/metaTokenStatus.js';
import { parseListPagination } from '../services/pagination.js';
import {
    hasWhatsAppNumbersTable,
    listTenantWhatsAppNumbers,
    setDefaultTenantWhatsAppNumber,
} from '../services/whatsappNumbers.js';

const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000;
const FACEBOOK_ACCOUNTS_FIELDS = 'id,name,category,picture.width(100).height(100),access_token';
const FACEBOOK_ACCOUNTS_PAGE_SIZE = 100;
const MAX_FACEBOOK_ACCOUNT_REQUESTS = 10;
const MAX_FACEBOOK_ACCOUNTS = 1000;
const PAGE_WEBHOOK_SUBSCRIBE_FAILURE = 'تعذر تفعيل استقبال أحداث الصفحة لدى Meta. تحقق من الصلاحيات ثم أعد المحاولة.';
const PAGE_WEBHOOK_UNSUBSCRIBE_FAILURE = 'تعذر إلغاء اشتراك Webhook لدى Meta';
const SAFE_ONBOARDING_ERROR_CODES = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT',
    'SQLITE_BUSY', 'SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_ERROR',
    'UND_ERR_CONNECT_TIMEOUT',
]);

const safeFailureStatus = error => (
    Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
        ? error.status
        : 500
);

const logOnboardingFailure = (operation, error, level = 'error') => {
    const rawCode = error?.code ?? error?.cause?.code;
    const code = SAFE_ONBOARDING_ERROR_CODES.has(rawCode)
        ? rawCode
        : Number.isInteger(rawCode) && rawCode >= 0 && rawCode <= 9999 ? rawCode : null;
    console[level](`[TenantMetaOnboarding] ${operation}:`, {
        code,
        status: safeFailureStatus(error),
    });
};

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

const normalizeMetaNextUrl = (value, apiBase, expectedPath) => {
    if (!value) return null;
    try {
        const next = new URL(value);
        const base = new URL(apiBase);
        if (next.protocol !== 'https:' || next.origin !== base.origin || next.pathname !== expectedPath) {
            return null;
        }
        const after = normalizeString(next.searchParams.get('after'), 2048);
        return after;
    } catch {
        return null;
    }
};

const fetchFacebookAccounts = async ({
    apiBase,
    accessToken,
    requestMeta,
    stopWhenIds = null,
}) => {
    const endpoint = new URL(`${apiBase}/me/accounts`);
    endpoint.searchParams.set('fields', FACEBOOK_ACCOUNTS_FIELDS);
    endpoint.searchParams.set('limit', String(FACEBOOK_ACCOUNTS_PAGE_SIZE));

    const accounts = [];
    const seenAccountIds = new Set();
    const seenCursors = new Set();
    let pageRequests = 0;
    let nextUrl = endpoint.toString();
    let hasMore = false;
    let paginationWarning = null;

    while (nextUrl && pageRequests < MAX_FACEBOOK_ACCOUNT_REQUESTS && accounts.length < MAX_FACEBOOK_ACCOUNTS) {
        const result = await requestMeta(nextUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!result.ok) return { ok: false, result };

        pageRequests += 1;
        for (const account of (Array.isArray(result.data?.data) ? result.data.data : [])) {
            const accountId = normalizeString(String(account?.id || ''), 256);
            if (!accountId || seenAccountIds.has(accountId)) continue;
            seenAccountIds.add(accountId);
            accounts.push(account);
            if (accounts.length >= MAX_FACEBOOK_ACCOUNTS) break;
        }

        if (stopWhenIds && [...stopWhenIds].every(id => seenAccountIds.has(id))) {
            nextUrl = null;
            hasMore = false;
            break;
        }

        const rawNext = result.data?.paging?.next;
        if (!rawNext) {
            nextUrl = null;
            hasMore = false;
            break;
        }

        hasMore = true;
        const after = normalizeString(result.data?.paging?.cursors?.after, 2048)
            || normalizeMetaNextUrl(rawNext, apiBase, endpoint.pathname);
        if (!after || seenCursors.has(after)) {
            paginationWarning = after ? 'repeated_cursor' : 'invalid_next_page';
            nextUrl = null;
            break;
        }

        seenCursors.add(after);
        const next = new URL(endpoint);
        next.searchParams.set('after', after);
        nextUrl = next.toString();
    }

    const truncated = hasMore && (
        pageRequests >= MAX_FACEBOOK_ACCOUNT_REQUESTS
        || accounts.length >= MAX_FACEBOOK_ACCOUNTS
        || !!paginationWarning
    );

    return {
        ok: true,
        accounts,
        pageRequests,
        truncated,
        paginationWarning,
    };
};

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
        const numbers = listTenantWhatsAppNumbers(database, tenantId);
        const defaultNumber = numbers.find(number => number.is_default) || numbers[0] || null;
        const numberTokenPresent = hasWhatsAppNumbersTable(database) && !!database.prepare(`
            SELECT 1 FROM tenant_whatsapp_numbers
            WHERE tenant_id = ? AND phone_number_id = ?
              AND is_active = 1 AND access_token_encrypted IS NOT NULL
            LIMIT 1
        `).get(tenantId, defaultNumber?.phone_number_id || '');
        return {
            connected: numbers.length > 0 && (tokenPresent || numberTokenPresent),
            waba_id: defaultNumber?.waba_id || tenant?.waba_id || null,
            phone_number_id: defaultNumber?.phone_number_id || tenant?.phone_number_id || null,
            default_phone_number_id: defaultNumber?.phone_number_id || null,
            business_id: defaultNumber?.business_id || tenant?.business_id || null,
            token_present: tokenPresent || numberTokenPresent,
            number_count: numbers.length,
            numbers,
            connected_at: lastConnected?.created_at || null,
            updated_at: tenant?.updated_at || null,
        };
    };

    const router = express.Router();

    const logWhatsAppActivity = (tenantId, eventType, description) => {
        const tenant = database.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId);
        database.prepare(`
            INSERT INTO activity_logs (
                tenant_id, tenant_name, event_type, description, status
            ) VALUES (?, ?, ?, ?, 'success')
        `).run(tenantId, tenant?.name || null, eventType, description);
    };

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
                        tokenStatus = classifyMetaTokenStatus(debugTokenData, { now: now() });
                        tokenExpiresAt = debugTokenData.expires_at > 0
                            ? new Date(debugTokenData.expires_at * 1000).toISOString()
                            : null;
                        tokenAppId = debugTokenData.app_id || null;
                    }
                } catch (error) {
                    logOnboardingFailure('Facebook token debug failed', error, 'warn');
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
                    logOnboardingFailure('Facebook profile fetch failed', {
                        status: profileResult.status,
                        code: profileResult.error?.code,
                    }, 'warn');
                }
            } catch (error) {
                logOnboardingFailure('Facebook profile fetch failed', error, 'warn');
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

            const accountsResult = await fetchFacebookAccounts({
                apiBase: meta.apiBase,
                accessToken: longLivedToken,
                requestMeta,
            });
            if (!accountsResult.ok) {
                return sendMetaFailure(res, accountsResult.result, 'تعذر جلب صفحات Facebook');
            }

            const pages = accountsResult.accounts.map(page => ({
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
                token_status: tokenStatus,
                pages_truncated: accountsResult.truncated,
                pages_pagination_warning: accountsResult.paginationWarning,
            });
        } catch (error) {
            logOnboardingFailure('Facebook connect error', error);
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
            logOnboardingFailure('Facebook diagnostics error', error);
            return res.status(500).json({ error: 'فشل جلب تشخيص فيسبوك' });
        }
    });

    router.get('/meta-review/readiness', async (req, res) => {
        try {
            return res.json(await buildReadiness(req.user.tenant_id));
        } catch (error) {
            logOnboardingFailure('Meta review readiness error', error);
            return res.status(safeFailureStatus(error)).json({ error: 'فشل جلب جاهزية مراجعة Meta' });
        }
    });

    router.get('/meta-review/snapshots', (req, res) => {
        try {
            const { limit } = parseListPagination(req.query, { defaultLimit: 10, maxLimit: 50 });
            return res.json({ snapshots: listSnapshots(req.user.tenant_id, limit) });
        } catch (error) {
            logOnboardingFailure('Meta review snapshots error', error);
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
            logOnboardingFailure('Meta review snapshot error', error);
            return res.status(safeFailureStatus(error)).json({ error: 'فشل حفظ لقطة جاهزية Meta' });
        }
    });

    router.post('/facebook/link-pages', async (req, res) => {
        try {
            const tenantId = req.user.tenant_id;
            const linkState = normalizeString(req.body?.link_state, 256);
            const requestedPageIds = Array.isArray(req.body?.page_ids)
                ? [...new Set(req.body.page_ids.map(value => normalizeString(value, 256)).filter(Boolean))]
                : null;
            if (!linkState || !requestedPageIds?.length || requestedPageIds.length > 100) {
                return res.status(400).json({ error: 'بيانات جلسة الربط والصفحات المحددة مطلوبة' });
            }
            const session = consumeSession(linkState, tenantId, 'facebook_link');
            if (!session) return res.status(400).json({ error: 'Invalid or expired link state' });

            const requestedSet = new Set(requestedPageIds);
            const accountsResult = await fetchFacebookAccounts({
                apiBase: meta.apiBase,
                accessToken: session.longLivedToken,
                requestMeta,
                stopWhenIds: requestedSet,
            });
            if (!accountsResult.ok) {
                return sendMetaFailure(res, accountsResult.result, 'تعذر التحقق من صفحات Facebook');
            }

            const allPages = accountsResult.accounts;
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
                        page_linked: false,
                        webhook_subscribed: false,
                        webhook_error: 'تعذر الحصول على رمز وصول صالح للصفحة',
                    });
                    continue;
                }

                const encryptedToken = encryptToken(pageToken);
                const pagePictureUrl = page.picture?.data?.url || null;
                const existing = database.prepare(`
                    SELECT id, tenant_id
                    FROM tenant_pages
                    WHERE page_id = ?
                `).get(pageId);
                if (existing && String(existing.tenant_id) !== String(tenantId)) {
                    linked.push({
                        id: pageId,
                        name: page.name || null,
                        page_linked: false,
                        webhook_subscribed: false,
                        webhook_error: 'هذه الصفحة غير متاحة للربط',
                    });
                    continue;
                }
                let linkedPageDbId;
                if (existing) {
                    database.prepare(`
                        UPDATE tenant_pages
                        SET page_access_token_encrypted = ?, page_name = ?, page_category = ?,
                            page_picture_url = ?, is_active = 1,
                            webhook_subscribed = 0, subscribed_fields = '[]',
                            token_status = 'unchecked', token_expires_at = NULL,
                            token_checked_at = NULL, token_app_id = NULL, token_scopes = NULL,
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
                    try {
                        linkedPageDbId = database.prepare(`
                            INSERT INTO tenant_pages (
                                tenant_id, platform, page_id, page_name, page_access_token_encrypted,
                                page_category, page_picture_url, subscribed_fields,
                                webhook_subscribed, token_status
                            ) VALUES (?, 'facebook', ?, ?, ?, ?, ?, '[]', 0, 'unchecked')
                        `).run(
                            tenantId,
                            pageId,
                            page.name || null,
                            encryptedToken,
                            page.category || null,
                            pagePictureUrl
                        ).lastInsertRowid;
                    } catch (error) {
                        if (error?.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
                        linked.push({
                            id: pageId,
                            name: page.name || null,
                            page_linked: false,
                            webhook_subscribed: false,
                            webhook_error: 'هذه الصفحة غير متاحة للربط',
                        });
                        continue;
                    }
                }

                let pageTokenStatus = 'unchecked';
                if (meta.appId && meta.appSecret) {
                    try {
                        const debugResult = await requestMeta(
                            `${meta.apiBase}/debug_token?input_token=${encodeURIComponent(pageToken)}`,
                            { headers: { Authorization: `Bearer ${meta.appId}|${meta.appSecret}` } }
                        );
                        if (debugResult.ok) {
                            const data = debugResult.data?.data || {};
                            pageTokenStatus = classifyMetaTokenStatus(data, { now: now() });
                            database.prepare(`
                                UPDATE tenant_pages
                                SET token_status = ?, token_expires_at = ?,
                                    token_checked_at = datetime('now', 'localtime'),
                                    token_app_id = ?, token_scopes = ?
                                WHERE id = ? AND tenant_id = ?
                            `).run(
                                pageTokenStatus,
                                data.expires_at > 0 ? new Date(data.expires_at * 1000).toISOString() : null,
                                data.app_id || null,
                                JSON.stringify(Array.isArray(data.scopes) ? data.scopes : []),
                                linkedPageDbId,
                                tenantId
                            );
                        }
                    } catch (error) {
                        logOnboardingFailure('Page token debug failed', error, 'warn');
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
                        : PAGE_WEBHOOK_SUBSCRIBE_FAILURE;
                } catch (error) {
                    logOnboardingFailure('Page webhook subscription failed', error, 'warn');
                    webhookError = PAGE_WEBHOOK_SUBSCRIBE_FAILURE;
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
                    page_linked: true,
                    token_status: pageTokenStatus,
                    page_ready: isMetaTokenReady(pageTokenStatus) && webhookSubscribed,
                    webhook_subscribed: webhookSubscribed,
                    webhook_error: webhookError,
                });
            }

            const unavailablePageIds = requestedPageIds.filter(pageId => !selectedIds.has(pageId));
            const savedCount = linked.filter(page => page.page_linked).length;
            const readyCount = linked.filter(page => page.page_ready).length;
            const failedCount = requestedPageIds.length - readyCount;
            const success = readyCount === requestedPageIds.length
                && failedCount === 0
                && unavailablePageIds.length === 0;

            return res.json({
                success,
                partial_success: !success && savedCount > 0,
                linked,
                saved_count: savedCount,
                ready_count: readyCount,
                failed_count: failedCount,
                unavailable_page_ids: unavailablePageIds,
                pages_truncated: accountsResult.truncated,
                pages_pagination_warning: accountsResult.paginationWarning,
            });
        } catch (error) {
            logOnboardingFailure('Facebook link-pages error', error);
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
            let webhookUnsubscribed = false;
            let unsubscribeError = null;
            if (accessToken) {
                try {
                    const unsubscribeResult = await requestMeta(
                        `${meta.apiBase}/${encodeURIComponent(page.page_id)}/subscribed_apps`,
                        { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
                    );
                    webhookUnsubscribed = unsubscribeResult.ok && unsubscribeResult.data?.success !== false;
                    if (!webhookUnsubscribed) {
                        unsubscribeError = PAGE_WEBHOOK_UNSUBSCRIBE_FAILURE;
                    }
                } catch (error) {
                    logOnboardingFailure('Webhook unsubscribe failed', error, 'warn');
                    unsubscribeError = PAGE_WEBHOOK_UNSUBSCRIBE_FAILURE;
                }
            } else {
                unsubscribeError = 'رمز وصول الصفحة غير متاح لإلغاء اشتراك Webhook لدى Meta';
            }

            const tenant = database.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId);
            database.transaction(() => {
                database.prepare(`
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
                    WHERE id = ? AND tenant_id = ?
                `).run(linkedPageId, tenantId);
                database.prepare(`
                    UPDATE facebook_content_campaigns
                    SET status = 'paused', next_run_at = NULL,
                        last_error = 'أُوقفت الحملة بعد فصل صفحة Facebook',
                        updated_at = datetime('now')
                    WHERE tenant_id = ? AND linked_page_id = ? AND status = 'active'
                `).run(tenantId, linkedPageId);
                database.prepare(`
                    UPDATE facebook_content_publications
                    SET status = 'cancelled', next_attempt_at = NULL,
                        error_code = 'PAGE_DISCONNECTED',
                        error_message = 'أُلغي النشر المجدول بعد فصل صفحة Facebook',
                        updated_at = datetime('now')
                    WHERE tenant_id = ? AND linked_page_id = ? AND status = 'pending'
                `).run(tenantId, linkedPageId);
                database.prepare(`
                    INSERT INTO activity_logs (
                        tenant_id, tenant_name, event_type, description, status
                    ) VALUES (?, ?, 'page_unlinked', ?, ?)
                `).run(
                    tenantId,
                    tenant?.name,
                    webhookUnsubscribed
                        ? `إلغاء ربط صفحة فيسبوك: ${page.page_name || page.page_id}`
                        : `تعطيل صفحة فيسبوك محلياً مع تعذر إلغاء Webhook لدى Meta: ${page.page_name || page.page_id}`,
                    webhookUnsubscribed ? 'success' : 'failed'
                );
            })();
            return res.json({
                success: webhookUnsubscribed,
                partial_success: !webhookUnsubscribed,
                local_disconnected: true,
                webhook_unsubscribed: webhookUnsubscribed,
                webhook_error: unsubscribeError,
                data_preserved: true,
            });
        } catch (error) {
            logOnboardingFailure('Facebook disconnect error', error);
            return res.status(500).json({ error: 'فشل إلغاء ربط الصفحة' });
        }
    });

    router.get('/whatsapp/status', (req, res) => {
        try {
            return res.json(getTenantWhatsAppStatus(req.user.tenant_id));
        } catch (error) {
            logOnboardingFailure('WhatsApp status error', error);
            return res.status(500).json({ error: 'فشل جلب حالة ربط واتساب' });
        }
    });

    router.get('/whatsapp/numbers', (req, res) => {
        try {
            const numbers = listTenantWhatsAppNumbers(database, req.user.tenant_id);
            return res.json({
                numbers,
                default_phone_number_id: numbers.find(number => number.is_default)?.phone_number_id
                    || numbers[0]?.phone_number_id
                    || null,
            });
        } catch (error) {
            logOnboardingFailure('WhatsApp numbers error', error);
            return res.status(500).json({ error: 'فشل جلب أرقام WhatsApp' });
        }
    });

    router.patch('/whatsapp/numbers/:phoneNumberId', (req, res) => {
        try {
            if (!hasWhatsAppNumbersTable(database)) {
                return res.status(409).json({ error: 'ترحيل تعدد الأرقام غير مطبق' });
            }
            const tenantId = req.user.tenant_id;
            const phoneNumberId = normalizeString(req.params.phoneNumberId, 256);
            const label = req.body?.label == null
                ? null
                : normalizeString(req.body.label, 100);
            if (!phoneNumberId || (req.body?.label != null && !label)) {
                return res.status(400).json({ error: 'بيانات الرقم غير صالحة' });
            }
            const result = database.prepare(`
                UPDATE tenant_whatsapp_numbers
                SET label = ?, updated_at = datetime('now', 'localtime')
                WHERE tenant_id = ? AND phone_number_id = ?
            `).run(label, tenantId, phoneNumberId);
            if (!result.changes) return res.status(404).json({ error: 'رقم WhatsApp غير موجود' });
            logWhatsAppActivity(tenantId, 'whatsapp_number_updated', `تحديث اسم رقم WhatsApp: ${phoneNumberId}`);
            const number = listTenantWhatsAppNumbers(database, tenantId, { includeInactive: true })
                .find(item => item.phone_number_id === phoneNumberId);
            return res.json(number);
        } catch (error) {
            logOnboardingFailure('WhatsApp number update error', error);
            return res.status(500).json({ error: 'فشل تحديث رقم WhatsApp' });
        }
    });

    router.post('/whatsapp/numbers/:phoneNumberId/default', (req, res) => {
        try {
            if (!hasWhatsAppNumbersTable(database)) {
                return res.status(409).json({ error: 'ترحيل تعدد الأرقام غير مطبق' });
            }
            const phoneNumberId = normalizeString(req.params.phoneNumberId, 256);
            const number = phoneNumberId
                ? setDefaultTenantWhatsAppNumber(database, req.user.tenant_id, phoneNumberId)
                : null;
            if (!number) return res.status(404).json({ error: 'رقم WhatsApp النشط غير موجود' });
            logWhatsAppActivity(req.user.tenant_id, 'whatsapp_default_changed', `تعيين رقم WhatsApp الافتراضي: ${phoneNumberId}`);
            return res.json({ success: true, number });
        } catch (error) {
            logOnboardingFailure('WhatsApp default number error', error);
            return res.status(500).json({ error: 'فشل تعيين رقم WhatsApp الافتراضي' });
        }
    });

    router.delete('/whatsapp/numbers/:phoneNumberId', (req, res) => {
        try {
            if (!hasWhatsAppNumbersTable(database)) {
                return res.status(409).json({ error: 'ترحيل تعدد الأرقام غير مطبق' });
            }
            const tenantId = req.user.tenant_id;
            const phoneNumberId = normalizeString(req.params.phoneNumberId, 256);
            const existing = phoneNumberId ? database.prepare(`
                SELECT id, is_default FROM tenant_whatsapp_numbers
                WHERE tenant_id = ? AND phone_number_id = ?
            `).get(tenantId, phoneNumberId) : null;
            if (!existing) return res.status(404).json({ error: 'رقم WhatsApp غير موجود' });

            database.transaction(() => {
                database.prepare(`
                    DELETE FROM tenant_whatsapp_numbers WHERE id = ? AND tenant_id = ?
                `).run(existing.id, tenantId);
                const remaining = listTenantWhatsAppNumbers(database, tenantId);
                if (remaining.length === 0) {
                    database.prepare(`
                        UPDATE tenants
                        SET phone_number_id = NULL, waba_id = NULL, business_id = NULL,
                            dataset_id = NULL,
                            access_token = NULL, access_token_encrypted = NULL,
                            updated_at = datetime('now', 'localtime')
                        WHERE id = ?
                    `).run(tenantId);
                } else if (existing.is_default || !remaining.some(number => number.is_default)) {
                    setDefaultTenantWhatsAppNumber(database, tenantId, remaining[0].phone_number_id);
                }
                logWhatsAppActivity(tenantId, 'whatsapp_number_disconnected', `فصل رقم WhatsApp: ${phoneNumberId}`);
            })();
            const current = listTenantWhatsAppNumbers(database, tenantId);
            return res.json({
                success: true,
                default_phone_number_id: current.find(number => number.is_default)?.phone_number_id || null,
            });
        } catch (error) {
            logOnboardingFailure('WhatsApp number delete error', error);
            return res.status(500).json({ error: 'فشل حذف رقم WhatsApp' });
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
            const makeDefault = req.body?.set_default === true;
            if (!code || !phoneNumberId || !wabaId || (req.body?.business_id != null && !businessId)) {
                return res.status(400).json({
                    error: 'code, phone_number_id, and waba_id are required',
                });
            }

            const existingStatus = getTenantWhatsAppStatus(tenantId);
            if (!hasWhatsAppNumbersTable(database) && existingStatus.connected && !forceReconnect) {
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

            const authorizedPhones = [];
            const initialPhoneNumbersUrl = `${meta.apiBase}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,status,name_status&limit=100`;
            let phoneNumbersUrl = initialPhoneNumbersUrl;
            for (let page = 0; phoneNumbersUrl && page < 10; page += 1) {
                const phoneNumbersResult = await requestMeta(
                    phoneNumbersUrl,
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                );
                if (!phoneNumbersResult.ok) {
                    return sendMetaFailure(res, phoneNumbersResult, 'Failed to verify WhatsApp account');
                }
                const pageRows = Array.isArray(phoneNumbersResult.data?.data)
                    ? phoneNumbersResult.data.data
                    : [];
                authorizedPhones.push(...pageRows.slice(0, Math.max(0, 1000 - authorizedPhones.length)));
                if (authorizedPhones.length >= 1000) break;
                const nextValue = phoneNumbersResult.data?.paging?.next;
                const next = safeMetaNextPageUrl(nextValue, initialPhoneNumbersUrl);
                if (nextValue && !next) {
                    return res.status(502).json({ error: 'Meta returned an invalid pagination URL' });
                }
                phoneNumbersUrl = next;
            }
            const authorizedPhoneIds = new Set(authorizedPhones.map(phone => String(phone.id)));
            if (!authorizedPhoneIds.has(phoneNumberId)) {
                return res.status(400).json({
                    error: 'phone_number_id does not belong to the authorized WhatsApp account',
                });
            }

            const encryptedToken = encryptToken(accessToken);
            const tenant = database.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId);
            let importedCount = 1;
            if (hasWhatsAppNumbersTable(database)) {
                const conflicting = database.prepare(`
                    SELECT tenant_id, phone_number_id
                    FROM tenant_whatsapp_numbers
                    WHERE phone_number_id IN (${authorizedPhones.map(() => '?').join(',') || "''"})
                      AND tenant_id != ?
                    LIMIT 1
                `).get(...authorizedPhones.map(phone => String(phone.id)), tenantId);
                if (conflicting) {
                    return res.status(409).json({
                        error: 'أحد أرقام WhatsApp مرتبط بحساب آخر على المنصة',
                        code: 'WHATSAPP_NUMBER_ALREADY_ASSIGNED',
                    });
                }
                database.transaction(() => {
                    const upsert = database.prepare(`
                        INSERT INTO tenant_whatsapp_numbers (
                            tenant_id, phone_number_id, waba_id, business_id,
                            display_phone_number, verified_name, quality_rating,
                            platform_status, access_token_encrypted, is_default, is_active
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
                        ON CONFLICT(tenant_id, phone_number_id) DO UPDATE SET
                            waba_id = excluded.waba_id,
                            business_id = COALESCE(excluded.business_id, tenant_whatsapp_numbers.business_id),
                            display_phone_number = COALESCE(excluded.display_phone_number, tenant_whatsapp_numbers.display_phone_number),
                            verified_name = COALESCE(excluded.verified_name, tenant_whatsapp_numbers.verified_name),
                            quality_rating = COALESCE(excluded.quality_rating, tenant_whatsapp_numbers.quality_rating),
                            platform_status = COALESCE(excluded.platform_status, tenant_whatsapp_numbers.platform_status),
                            access_token_encrypted = excluded.access_token_encrypted,
                            is_active = 1,
                            updated_at = datetime('now', 'localtime')
                    `);
                    for (const phone of authorizedPhones) {
                        upsert.run(
                            tenantId,
                            String(phone.id),
                            wabaId,
                            businessId,
                            phone.display_phone_number || null,
                            phone.verified_name || null,
                            phone.quality_rating || null,
                            phone.status || phone.name_status || null,
                            encryptedToken,
                        );
                    }
                })();
                importedCount = authorizedPhones.length;
                const currentDefault = listTenantWhatsAppNumbers(database, tenantId)
                    .find(number => number.is_default);
                if (!currentDefault || makeDefault) {
                    setDefaultTenantWhatsAppNumber(database, tenantId, phoneNumberId);
                }
            } else {
                database.prepare(`
                    UPDATE tenants
                    SET waba_id = ?, phone_number_id = ?, business_id = ?,
                        access_token_encrypted = ?, access_token = NULL,
                        updated_at = datetime('now', 'localtime')
                    WHERE id = ?
                `).run(wabaId, phoneNumberId, businessId, encryptedToken, tenantId);
            }

            database.transaction(() => {
                database.prepare(`
                    INSERT INTO activity_logs (
                        tenant_id, tenant_name, event_type, description, status
                    ) VALUES (?, ?, 'whatsapp_connected', ?, 'success')
                `).run(tenantId, tenant?.name, `ربط حساب WhatsApp: ${phoneNumberId} (${importedCount} رقم)`);
            })();

            try {
                const subscribeResult = await requestMeta(
                    `${meta.apiBase}/${encodeURIComponent(wabaId)}/subscribed_apps`,
                    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
                );
                if (!subscribeResult.ok) {
                    logOnboardingFailure('WABA webhook subscription failed', {
                        status: subscribeResult.status,
                        code: subscribeResult.error?.code,
                    }, 'warn');
                }
            } catch (error) {
                logOnboardingFailure('WABA webhook subscription failed', error, 'warn');
            }

            return res.json({
                success: true,
                waba_id: wabaId,
                phone_number_id: phoneNumberId,
                imported_count: importedCount,
                status: getTenantWhatsAppStatus(tenantId),
            });
        } catch (error) {
            logOnboardingFailure('WhatsApp connect error', error);
            return res.status(500).json({ error: 'فشل ربط واتساب' });
        }
    });

    return router;
}

export default createTenantMetaOnboardingRouter;
