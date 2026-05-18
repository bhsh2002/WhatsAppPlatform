import db from '../db/database.js';
import { META_API_BASE, META_APP_ID, META_APP_SECRET } from '../config/index.js';
import { getAccessToken } from './credentials.js';
import { decryptIfEncrypted } from './encryption.js';

export const FACEBOOK_OAUTH_SCOPES = [
    'pages_show_list',
    'pages_manage_metadata',
    'pages_messaging',
    'pages_read_engagement',
    'pages_read_user_content',
    'pages_manage_posts',
    'pages_manage_engagement',
    'business_management',
];

export const FACEBOOK_WEBHOOK_FIELDS = ['feed', 'messages', 'messaging_postbacks'];

export const CONTENT_REVIEW_SCOPES = [
    'pages_read_user_content',
    'pages_read_engagement',
    'pages_manage_posts',
    'pages_manage_engagement',
];

export const MESSENGER_REVIEW_SCOPES = [
    'pages_messaging',
    'pages_manage_metadata',
];

export const BUSINESS_REVIEW_SCOPES = ['business_management'];

export const META_PERMISSION_MATRIX = [
    {
        key: 'public_profile',
        label: 'Public Profile',
        group: 'identity',
        action_path: '/portal/fb-pages',
        usage: 'تحديد مستخدم Facebook الذي قام بتفويض الربط.',
        endpoint: 'GET /portal/facebook/auth-url, POST /portal/facebook/connect',
        evidence_key: 'facebook_user_token',
    },
    {
        key: 'email',
        label: 'Email',
        group: 'identity',
        action_path: '/portal/fb-pages',
        usage: 'ربط التفويض بحساب مستخدم واضح عند توفر البريد.',
        endpoint: 'POST /portal/facebook/connect',
        evidence_key: 'facebook_user_token',
    },
    {
        key: 'pages_show_list',
        label: 'Pages Show List',
        group: 'facebook_pages',
        action_path: '/portal/fb-pages',
        usage: 'عرض الصفحات التي يديرها المستخدم لاختيار الصفحات المراد ربطها.',
        endpoint: 'GET /me/accounts',
        evidence_key: 'linked_pages',
    },
    {
        key: 'pages_manage_metadata',
        label: 'Pages Manage Metadata',
        group: 'facebook_pages',
        action_path: '/portal/fb-pages',
        usage: 'اشتراك الصفحة في Webhooks المطلوبة وإدارة بيانات الربط.',
        endpoint: 'POST /{page-id}/subscribed_apps',
        evidence_key: 'webhook_subscription',
    },
    {
        key: 'pages_read_engagement',
        label: 'Pages Read Engagement',
        group: 'facebook_content',
        action_path: '/portal/fb-content',
        usage: 'قراءة التعليقات والتفاعل على المنشورات.',
        endpoint: 'GET /{post-id}/comments',
        evidence_key: 'content_activity',
    },
    {
        key: 'pages_read_user_content',
        label: 'Pages Read User Content',
        group: 'facebook_content',
        action_path: '/portal/fb-content',
        usage: 'قراءة منشورات وتعليقات الصفحة لإدارتها داخل التطبيق.',
        endpoint: 'GET /{page-id}/posts',
        evidence_key: 'content_activity',
    },
    {
        key: 'pages_manage_posts',
        label: 'Pages Manage Posts',
        group: 'facebook_content',
        action_path: '/portal/fb-content',
        usage: 'إنشاء وتعديل وحذف منشورات الصفحة.',
        endpoint: 'POST /{page-id}/feed',
        evidence_key: 'post_management',
    },
    {
        key: 'pages_manage_engagement',
        label: 'Pages Manage Engagement',
        group: 'facebook_content',
        action_path: '/portal/fb-content',
        usage: 'الرد على التعليقات وإخفاؤها وحذفها.',
        endpoint: 'POST /{comment-id}/comments',
        evidence_key: 'comment_management',
    },
    {
        key: 'pages_messaging',
        label: 'Pages Messaging',
        group: 'messenger',
        action_path: '/portal/inbox',
        usage: 'استقبال وإرسال رسائل Messenger من صندوق المحادثات.',
        endpoint: 'POST /{page-id}/messages',
        evidence_key: 'messenger_activity',
    },
    {
        key: 'business_management',
        label: 'Business Management',
        group: 'business',
        action_path: '/portal/fb-pages',
        admin_paths: ['/business-manager', '/partner-solutions'],
        usage: 'عرض وإدارة أصول النشاط التجاري عبر Business Manager.',
        endpoint: 'GET /{business-id}/owned_pages',
        evidence_key: 'business_token',
    },
    {
        key: 'whatsapp_business_management',
        label: 'WhatsApp Business Management',
        group: 'whatsapp',
        action_path: '/portal/templates',
        usage: 'إدارة حساب واتساب والقوالب وبيانات النشاط التجاري.',
        endpoint: 'WhatsApp Business Management API',
        evidence_key: 'whatsapp_management',
    },
    {
        key: 'whatsapp_business_messaging',
        label: 'WhatsApp Business Messaging',
        group: 'whatsapp',
        action_path: '/portal/chat',
        usage: 'إرسال واستقبال رسائل WhatsApp داخل المنصة.',
        endpoint: 'POST /{phone-number-id}/messages',
        evidence_key: 'whatsapp_messages',
    },
    {
        key: 'whatsapp_business_manage_events',
        label: 'WhatsApp Business Manage Events',
        group: 'whatsapp_events',
        action_path: '/portal/conversions',
        usage: 'إرسال أحداث WhatsApp Events API إلى Dataset في Meta.',
        endpoint: 'POST /{dataset-id}/events',
        evidence_key: 'conversion_events',
    },
    {
        key: 'manage_app_solution',
        label: 'Manage App Solution',
        group: 'business',
        action_path: '/portal/fb-pages',
        admin_paths: ['/partner-solutions'],
        usage: 'إدارة حلول الشركاء والربط مع أصول العملاء عند توفر حساب شريك.',
        endpoint: 'Partner Solutions / Managed Businesses APIs',
        evidence_key: 'partner_activity',
    },
    {
        key: 'business_asset_user_profile_access',
        label: 'Business Asset User Profile Access',
        group: 'messenger',
        action_path: '/portal/inbox',
        feature: true,
        usage: 'عرض اسم أو صورة مستخدم Messenger المرتبط بأصل النشاط.',
        endpoint: 'Messenger profile data from webhook/API',
        evidence_key: 'profile_records',
    },
];

export const parseStoredArray = (value) => {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (!value) return [];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
        return String(value)
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
    }
};

export const parseStoredObject = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return value;

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

export const missingItems = (required, available) => {
    const availableSet = new Set(available || []);
    return required.filter(item => !availableSet.has(item));
};

export const hasAllItems = (required, available) => missingItems(required, available).length === 0;

export const readinessStatus = (isReady, hasPartialSetup = false) => {
    if (isReady) return 'ready';
    return hasPartialSetup ? 'action_required' : 'missing';
};

const isLikelyInternalTest = (value) => {
    if (!value) return false;
    return String(value).startsWith('TEST_') || String(value).includes('TEST_');
};

const classifyWebhookSource = ({ entryId, value, messaging }) => {
    if (isLikelyInternalTest(entryId) || isLikelyInternalTest(value?.comment_id) || isLikelyInternalTest(value?.post_id)) {
        return 'internal_test';
    }
    if (entryId === '0' || messaging?.recipient?.id === '23245' || messaging?.sender?.id === '12334') {
        return 'meta_dashboard_test';
    }
    return 'production_event';
};

const summarizeWebhookPayload = (payload) => {
    const events = [];
    const body = parseStoredObject(payload);
    if (!body || body.object !== 'page' || !Array.isArray(body.entry)) return events;

    for (const entry of body.entry) {
        const entryId = entry.id ? String(entry.id) : null;

        for (const change of (entry.changes || [])) {
            const field = change.field || 'unknown';
            const value = change.value || {};
            const item = value.item || null;
            const verb = value.verb || null;
            const eventKey = field === 'feed' && item && verb ? `${field}:${item}:${verb}` : field;

            events.push({
                object: 'page',
                field,
                event_key: eventKey,
                item,
                verb,
                page_id: entryId,
                post_id: value.post_id || null,
                comment_id: value.comment_id || null,
                source: classifyWebhookSource({ entryId, value }),
            });
        }

        for (const messaging of (entry.messaging || [])) {
            let field = 'messages';
            if (messaging.postback) field = 'messaging_postbacks';
            else if (messaging.delivery) field = 'message_deliveries';
            else if (messaging.read) field = 'message_reads';
            else if (messaging.message?.is_echo) field = 'message_echoes';

            events.push({
                object: 'page',
                field,
                event_key: field,
                item: null,
                verb: null,
                page_id: entryId || messaging.recipient?.id || null,
                post_id: null,
                comment_id: null,
                source: classifyWebhookSource({ entryId, messaging }),
            });
        }
    }

    return events;
};

export const getWebhookEvidence = ({ tenantId = null, limit = 10 } = {}) => {
    const params = [];
    let where = "event_type = 'page'";
    if (tenantId) {
        where += ' AND tenant_id = ?';
        params.push(tenantId);
    }

    const rows = db.prepare(`
        SELECT id, tenant_id, event_type, payload, created_at
        FROM webhook_logs
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT 250
    `).all(...params);

    const byField = {};
    const byEventKey = {};
    const recent = [];

    for (const row of rows) {
        const events = summarizeWebhookPayload(row.payload);
        for (const event of events) {
            const sample = {
                id: row.id,
                tenant_id: row.tenant_id,
                field: event.field,
                event_key: event.event_key,
                source: event.source,
                page_id: event.page_id,
                post_id: event.post_id,
                comment_id: event.comment_id,
                created_at: row.created_at,
            };

            if (!byField[event.field]) {
                byField[event.field] = { count: 0, production_count: 0, latest_at: null, latest_source: null, recent: [] };
            }
            byField[event.field].count += 1;
            if (event.source === 'production_event') byField[event.field].production_count += 1;
            if (!byField[event.field].latest_at || row.created_at > byField[event.field].latest_at) {
                byField[event.field].latest_at = row.created_at;
                byField[event.field].latest_source = event.source;
            }
            if (byField[event.field].recent.length < limit) byField[event.field].recent.push(sample);

            if (!byEventKey[event.event_key]) {
                byEventKey[event.event_key] = { count: 0, production_count: 0, latest_at: null, latest_source: null, recent: [] };
            }
            byEventKey[event.event_key].count += 1;
            if (event.source === 'production_event') byEventKey[event.event_key].production_count += 1;
            if (!byEventKey[event.event_key].latest_at || row.created_at > byEventKey[event.event_key].latest_at) {
                byEventKey[event.event_key].latest_at = row.created_at;
                byEventKey[event.event_key].latest_source = event.source;
            }
            if (byEventKey[event.event_key].recent.length < limit) byEventKey[event.event_key].recent.push(sample);

            if (recent.length < limit) recent.push(sample);
        }
    }

    const totalEvents = Object.values(byField).reduce((sum, field) => sum + field.count, 0);
    const productionEvents = Object.values(byField).reduce((sum, field) => sum + field.production_count, 0);

    return {
        total_events: totalEvents,
        production_events: productionEvents,
        by_field: byField,
        by_event_key: byEventKey,
        recent,
    };
};

const getLatestActivity = (tenantId, eventTypes) => {
    if (!eventTypes.length) return null;
    const placeholders = eventTypes.map(() => '?').join(',');
    return db.prepare(`
        SELECT event_type, status, description, created_at
        FROM activity_logs
        WHERE tenant_id = ? AND event_type IN (${placeholders})
        ORDER BY created_at DESC
        LIMIT 1
    `).get(tenantId, ...eventTypes);
};

const tokenStatusFromDebugData = (tokenData) => {
    if (tokenData?.is_valid !== true) return 'invalid';
    const expiresAt = tokenData.expires_at;
    if (!expiresAt || expiresAt <= 0) return 'valid';

    const expiresDate = new Date(expiresAt * 1000);
    const now = new Date();
    if (expiresDate <= now) return 'expired';
    if (expiresDate <= new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)) return 'expiring';
    return 'valid';
};

export const debugFacebookUserToken = async (tenant) => {
    if (!tenant?.facebook_user_access_token_encrypted || !META_APP_ID || !META_APP_SECRET) {
        return {
            checked: false,
            status: tenant?.facebook_user_token_status || 'unchecked',
            scopes: parseStoredArray(tenant?.facebook_user_token_scopes),
            app_id: tenant?.facebook_user_token_app_id || null,
            error: !tenant?.facebook_user_access_token_encrypted ? 'facebook_user_token_missing' : 'app_credentials_missing',
        };
    }

    const token = decryptIfEncrypted(tenant.facebook_user_access_token_encrypted);
    if (!token) {
        return { checked: false, status: 'invalid', scopes: [], app_id: null, error: 'facebook_user_token_decrypt_failed' };
    }

    const appAccessToken = `${META_APP_ID}|${META_APP_SECRET}`;
    const response = await fetch(
        `${META_API_BASE}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appAccessToken)}`,
        { signal: AbortSignal.timeout(8000) }
    );
    const data = await response.json();
    if (!response.ok || data.error) {
        return {
            checked: true,
            status: 'invalid',
            scopes: parseStoredArray(tenant.facebook_user_token_scopes),
            app_id: null,
            error: data.error?.message || 'debug_token_failed',
        };
    }

    const tokenData = data.data || {};
    return {
        checked: true,
        status: tokenStatusFromDebugData(tokenData),
        scopes: tokenData.scopes || [],
        app_id: tokenData.app_id || null,
        expires_at: tokenData.expires_at && tokenData.expires_at > 0 ? new Date(tokenData.expires_at * 1000).toISOString() : null,
        is_valid: tokenData.is_valid === true,
        app_id_matches: !META_APP_ID || !tokenData.app_id || String(tokenData.app_id) === String(META_APP_ID),
    };
};

const buildPermissionMatrix = ({ grantedScopes, evidence }) => META_PERMISSION_MATRIX.map(permission => {
    const granted = permission.feature ? evidence.profile_records.ready : grantedScopes.includes(permission.key);
    let ready = granted;
    let lastSuccessAt = null;
    let lastFailureAt = null;
    let evidenceStatus = 'missing';

    const evidenceItem = evidence[permission.evidence_key];
    if (evidenceItem) {
        evidenceStatus = evidenceItem.ready ? 'ready' : evidenceItem.partial ? 'action_required' : 'missing';
        lastSuccessAt = evidenceItem.last_success_at || null;
        lastFailureAt = evidenceItem.last_failure_at || null;
    }

    return {
        key: permission.key,
        label: permission.label,
        group: permission.group,
        feature: !!permission.feature,
        granted,
        status: readinessStatus(granted && evidenceStatus === 'ready', granted || evidenceStatus === 'action_required'),
        action_path: permission.action_path,
        admin_paths: permission.admin_paths || [],
        usage: permission.usage,
        endpoint: permission.endpoint,
        evidence_key: permission.evidence_key,
        evidence_status: evidenceStatus,
        last_success_at: lastSuccessAt,
        last_failure_at: lastFailureAt,
    };
});

export const buildMetaReviewReadiness = async (tenantId) => {
    const generatedAt = new Date().toISOString();
    const tenant = db.prepare(`
        SELECT id, name, phone_number_id, access_token, access_token_encrypted,
               waba_id, business_id, dataset_id,
               facebook_user_access_token_encrypted,
               facebook_user_token_scopes,
               facebook_user_token_updated_at,
               facebook_user_token_status,
               facebook_user_token_expires_at,
               facebook_user_token_checked_at,
               facebook_user_token_app_id
        FROM tenants
        WHERE id = ?
    `).get(tenantId);

    if (!tenant) {
        const error = new Error('Tenant not found');
        error.status = 404;
        throw error;
    }

    let grantedScopes = parseStoredArray(tenant.facebook_user_token_scopes);
    let liveFacebookUserToken = null;
    try {
        liveFacebookUserToken = await debugFacebookUserToken(tenant);
        if (liveFacebookUserToken.scopes?.length) {
            grantedScopes = liveFacebookUserToken.scopes;
        }
    } catch (err) {
        liveFacebookUserToken = {
            checked: false,
            status: tenant.facebook_user_token_status || 'unchecked',
            scopes: grantedScopes,
            app_id: tenant.facebook_user_token_app_id || null,
            error: err.message,
        };
    }

    const missingScopes = missingItems(FACEBOOK_OAUTH_SCOPES, grantedScopes);
    const facebookUserTokenPresent = !!tenant.facebook_user_access_token_encrypted;

    const pageRows = db.prepare(`
        SELECT id, platform, page_id, page_name, page_category, page_picture_url,
               page_access_token_encrypted, is_active, subscribed_fields,
               webhook_subscribed, token_status, token_expires_at,
               token_checked_at, token_app_id, token_scopes, created_at, updated_at
        FROM tenant_pages
        WHERE tenant_id = ?
        ORDER BY updated_at DESC
    `).all(tenantId);

    const pages = pageRows.map(page => {
        const subscribedFields = parseStoredArray(page.subscribed_fields);
        const missingWebhookFields = missingItems(FACEBOOK_WEBHOOK_FIELDS, subscribedFields);
        const tokenScopes = parseStoredArray(page.token_scopes);

        return {
            id: page.id,
            platform: page.platform,
            page_id: page.page_id,
            page_name: page.page_name,
            page_category: page.page_category,
            page_picture_url: page.page_picture_url,
            is_active: !!page.is_active,
            page_access_token_present: !!page.page_access_token_encrypted,
            subscribed_fields: subscribedFields,
            required_webhook_fields: FACEBOOK_WEBHOOK_FIELDS,
            missing_webhook_fields: missingWebhookFields,
            webhook_subscribed: !!page.webhook_subscribed,
            webhook_ready: !!page.webhook_subscribed && missingWebhookFields.length === 0,
            token_status: page.token_status || 'unchecked',
            token_scopes: tokenScopes,
            token_app_id: page.token_app_id || null,
            token_app_id_matches: !META_APP_ID || !page.token_app_id || String(page.token_app_id) === String(META_APP_ID),
            token_expires_at: page.token_expires_at || null,
            token_checked_at: page.token_checked_at || null,
            created_at: page.created_at,
            updated_at: page.updated_at,
        };
    });

    const activePages = pages.filter(page => page.is_active);
    const pagesWithToken = activePages.filter(page => page.page_access_token_present && page.token_status !== 'invalid');
    const webhookReadyPages = activePages.filter(page => page.webhook_ready);
    const messengerWebhookPages = activePages.filter(page =>
        page.webhook_subscribed && page.subscribed_fields.includes('messages')
    );

    const conversationStats = db.prepare(`
        SELECT COUNT(*) as count,
               MAX(COALESCE(last_message_time, updated_at, created_at)) as latest_activity_at
        FROM fb_conversations
        WHERE tenant_id = ?
    `).get(tenantId);

    const messageStats = db.prepare(`
        SELECT COUNT(*) as count,
               MAX(created_at) as latest_message_at
        FROM fb_messages
        WHERE tenant_id = ?
    `).get(tenantId);

    const profileStats = db.prepare(`
        SELECT COUNT(*) as count
        FROM fb_conversations
        WHERE tenant_id = ?
          AND (user_name IS NOT NULL OR user_profile_pic IS NOT NULL)
    `).get(tenantId);

    const whatsappMessageStats = db.prepare(`
        SELECT COUNT(*) as count, MAX(created_at) as latest_message_at
        FROM messages
        WHERE tenant_id = ?
    `).get(tenantId);

    const conversionStats = db.prepare(`
        SELECT COUNT(*) as total,
               COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) as sent,
               COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
               COALESCE(SUM(CASE WHEN status = 'local_only' THEN 1 ELSE 0 END), 0) as local_only,
               MAX(CASE WHEN status = 'sent' THEN created_at ELSE NULL END) as last_sent_at,
               MAX(CASE WHEN status = 'failed' THEN created_at ELSE NULL END) as last_failed_at
        FROM conversion_events
        WHERE tenant_id = ?
    `).get(tenantId);

    const lastConversion = db.prepare(`
        SELECT id, dataset_id, event_name, status, meta_response, created_at
        FROM conversion_events
        WHERE tenant_id = ?
        ORDER BY created_at DESC
        LIMIT 1
    `).get(tenantId);

    const lastConversionMeta = parseStoredObject(lastConversion?.meta_response);
    const effectiveWhatsAppTokenPresent = !!getAccessToken(tenantId);
    const tenantWhatsAppTokenPresent = !!(tenant.access_token || tenant.access_token_encrypted);
    const webhookEvidence = getWebhookEvidence({ tenantId });

    const contentActivity = getLatestActivity(tenantId, [
        'fb_post_created',
        'fb_post_edited',
        'fb_post_deleted',
        'fb_comment_replied',
        'fb_comment_hidden',
        'fb_comment_deleted',
        'fb_new_comment',
    ]);
    const postActivity = getLatestActivity(tenantId, ['fb_post_created', 'fb_post_edited', 'fb_post_deleted']);
    const commentActivity = getLatestActivity(tenantId, ['fb_comment_replied', 'fb_comment_hidden', 'fb_comment_deleted', 'fb_new_comment']);
    const partnerActivity = getLatestActivity(tenantId, ['partner_client_added', 'partner_client_removed', 'partner_system_user_created']);

    const messengerProductionEvidence =
        (webhookEvidence.by_field.messages?.production_count || 0) > 0 ||
        (webhookEvidence.by_field.messaging_postbacks?.production_count || 0) > 0;
    const feedProductionEvidence = (webhookEvidence.by_event_key['feed:comment:add']?.production_count || 0) > 0 ||
        (webhookEvidence.by_event_key['feed:reaction:add']?.production_count || 0) > 0;

    const permissionsReady = facebookUserTokenPresent &&
        liveFacebookUserToken?.status === 'valid' &&
        missingScopes.length === 0 &&
        (liveFacebookUserToken.app_id_matches !== false);
    const pagesReady = activePages.length > 0 && webhookReadyPages.length > 0;
    const contentScopesReady = hasAllItems(CONTENT_REVIEW_SCOPES, grantedScopes);
    const contentReady = pagesWithToken.length > 0 && contentScopesReady && (feedProductionEvidence || !!contentActivity);
    const messengerScopesReady = hasAllItems(MESSENGER_REVIEW_SCOPES, grantedScopes);
    const messengerConfigured = messengerScopesReady && messengerWebhookPages.length > 0;
    const messengerHasEvidence = (conversationStats?.count || 0) > 0 || (messageStats?.count || 0) > 0 || messengerProductionEvidence;
    const businessScopeReady = hasAllItems(BUSINESS_REVIEW_SCOPES, grantedScopes);
    const businessReady = !!tenant.business_id && facebookUserTokenPresent && businessScopeReady && liveFacebookUserToken?.status === 'valid';
    const eventsConfigured = !!tenant.dataset_id && effectiveWhatsAppTokenPresent;
    const eventsReady = eventsConfigured && lastConversion?.status === 'sent';
    const assetProfileReady = (profileStats?.count || 0) > 0;

    const evidence = {
        facebook_user_token: {
            ready: facebookUserTokenPresent && liveFacebookUserToken?.status === 'valid',
            partial: facebookUserTokenPresent,
            last_success_at: liveFacebookUserToken?.status === 'valid'
                ? (liveFacebookUserToken.checked ? generatedAt : tenant.facebook_user_token_checked_at || tenant.facebook_user_token_updated_at)
                : null,
            last_failure_at: liveFacebookUserToken?.status === 'invalid' ? tenant.facebook_user_token_checked_at : null,
        },
        linked_pages: {
            ready: activePages.length > 0,
            partial: pages.length > 0,
            last_success_at: activePages[0]?.updated_at || null,
        },
        webhook_subscription: {
            ready: pagesReady,
            partial: activePages.length > 0,
            last_success_at: webhookReadyPages[0]?.updated_at || null,
        },
        content_activity: {
            ready: !!contentActivity || feedProductionEvidence,
            partial: pagesWithToken.length > 0,
            last_success_at: contentActivity?.created_at || webhookEvidence.by_event_key['feed:comment:add']?.latest_at || null,
        },
        post_management: {
            ready: !!postActivity,
            partial: pagesWithToken.length > 0 && contentScopesReady,
            last_success_at: postActivity?.created_at || null,
        },
        comment_management: {
            ready: !!commentActivity || feedProductionEvidence,
            partial: pagesWithToken.length > 0 && contentScopesReady,
            last_success_at: commentActivity?.created_at || webhookEvidence.by_event_key['feed:comment:add']?.latest_at || null,
        },
        messenger_activity: {
            ready: messengerHasEvidence,
            partial: messengerConfigured,
            last_success_at: conversationStats?.latest_activity_at || messageStats?.latest_message_at || webhookEvidence.by_field.messages?.latest_at || null,
        },
        business_token: {
            ready: businessReady,
            partial: !!tenant.business_id || facebookUserTokenPresent || businessScopeReady,
            last_success_at: tenant.facebook_user_token_updated_at || null,
        },
        whatsapp_management: {
            ready: !!tenant.waba_id && effectiveWhatsAppTokenPresent,
            partial: !!tenant.waba_id || effectiveWhatsAppTokenPresent,
            last_success_at: tenant.waba_id ? tenant.facebook_user_token_updated_at : null,
        },
        whatsapp_messages: {
            ready: (whatsappMessageStats?.count || 0) > 0 && effectiveWhatsAppTokenPresent,
            partial: effectiveWhatsAppTokenPresent,
            last_success_at: whatsappMessageStats?.latest_message_at || null,
        },
        conversion_events: {
            ready: eventsReady,
            partial: eventsConfigured || !!lastConversion,
            last_success_at: conversionStats?.last_sent_at || null,
            last_failure_at: conversionStats?.last_failed_at || null,
        },
        partner_activity: {
            ready: !!partnerActivity && businessReady,
            partial: businessReady,
            last_success_at: partnerActivity?.created_at || null,
        },
        profile_records: {
            ready: assetProfileReady,
            partial: messengerConfigured,
            last_success_at: conversationStats?.latest_activity_at || null,
        },
    };

    const permission_matrix = buildPermissionMatrix({ grantedScopes, evidence });

    const sections = {
        permissions: {
            key: 'permissions',
            title: 'Facebook OAuth Permissions',
            status: readinessStatus(permissionsReady, facebookUserTokenPresent || grantedScopes.length > 0),
            action_path: '/portal/fb-pages',
            requested_scopes: FACEBOOK_OAUTH_SCOPES,
            granted_scopes: grantedScopes,
            missing_scopes: missingScopes,
            facebook_user_token_present: facebookUserTokenPresent,
            facebook_user_token_updated_at: tenant.facebook_user_token_updated_at || null,
            live_token_status: liveFacebookUserToken?.status || 'unchecked',
            live_token_checked: !!liveFacebookUserToken?.checked,
            live_token_app_id: liveFacebookUserToken?.app_id || tenant.facebook_user_token_app_id || null,
            live_token_app_id_matches: liveFacebookUserToken?.app_id_matches !== false,
            live_token_expires_at: liveFacebookUserToken?.expires_at || tenant.facebook_user_token_expires_at || null,
            live_token_error: liveFacebookUserToken?.error || null,
            review_hint: missingScopes.length
                ? 'أعد تفويض Facebook من صفحة الربط حتى تظهر الأذونات المطلوبة في debug_token.'
                : 'كل أذونات Facebook المطلوبة موجودة في رمز المستخدم، مع تحقق live عند توفر إعدادات التطبيق.',
        },
        pages: {
            key: 'pages',
            title: 'Facebook Pages & Webhooks',
            status: readinessStatus(pagesReady, activePages.length > 0),
            action_path: '/portal/fb-pages',
            linked_count: pages.length,
            active_count: activePages.length,
            page_token_ready_count: pagesWithToken.length,
            webhook_ready_count: webhookReadyPages.length,
            required_webhook_fields: FACEBOOK_WEBHOOK_FIELDS,
            webhook_evidence: webhookEvidence,
            pages,
            review_hint: pagesReady
                ? 'توجد صفحة نشطة واحدة على الأقل مع Webhook fields المطلوبة.'
                : 'اربط صفحة Facebook وتحقق من اشتراك Webhook لكل الحقول المطلوبة.',
        },
        content: {
            key: 'content',
            title: 'Page Content',
            status: readinessStatus(contentReady, pagesWithToken.length > 0 || contentScopesReady),
            action_path: '/portal/fb-content',
            required_permissions: CONTENT_REVIEW_SCOPES,
            missing_permissions: missingItems(CONTENT_REVIEW_SCOPES, grantedScopes),
            linked_pages_ready: pagesWithToken.length,
            supported_actions: ['read_posts', 'create_posts', 'edit_posts', 'delete_posts', 'read_comments', 'reply_comments', 'hide_comments', 'delete_comments'],
            latest_activity: contentActivity || null,
            feed_comment_evidence: webhookEvidence.by_event_key['feed:comment:add'] || null,
            review_hint: contentReady
                ? 'مسار إدارة المحتوى جاهز ويوجد دليل نشاط أو Webhook feed حقيقي.'
                : 'يتطلب صفحة مرتبطة مع رمز صفحة صالح وأذونات إدارة/قراءة محتوى الصفحة ودليل نشاط فعلي.',
        },
        messenger: {
            key: 'messenger',
            title: 'Messenger',
            status: readinessStatus(messengerConfigured && messengerHasEvidence, messengerConfigured || activePages.length > 0),
            action_path: '/portal/inbox',
            required_permissions: MESSENGER_REVIEW_SCOPES,
            missing_permissions: missingItems(MESSENGER_REVIEW_SCOPES, grantedScopes),
            webhook_pages_ready: messengerWebhookPages.length,
            conversations_count: conversationStats?.count || 0,
            messages_count: messageStats?.count || 0,
            latest_activity_at: conversationStats?.latest_activity_at || messageStats?.latest_message_at || null,
            webhook_message_evidence: webhookEvidence.by_field.messages || null,
            webhook_postback_evidence: webhookEvidence.by_field.messaging_postbacks || null,
            review_hint: messengerConfigured && messengerHasEvidence
                ? 'Messenger جاهز وبداخله دليل نشاط يمكن عرضه للمراجع.'
                : 'يتطلب صفحة مشتركة في messages ووجود محادثة Messenger فعلية أو مزامنة محادثة قائمة.',
        },
        business_asset_user_profile_access: {
            key: 'business_asset_user_profile_access',
            title: 'Business Asset User Profile Access',
            status: readinessStatus(assetProfileReady, messengerConfigured),
            action_path: '/portal/inbox',
            feature_required: 'Business Asset User Profile Access',
            profile_records_count: profileStats?.count || 0,
            review_hint: assetProfileReady
                ? 'يوجد دليل على استخدام اسم/صورة مستخدم Messenger داخل المحادثات.'
                : 'يظهر هذا الدليل بعد استقبال Messenger webhook يحتوي PSID ثم جلب بيانات المستخدم للعرض داخل inbox.',
        },
        business: {
            key: 'business',
            title: 'Business APIs',
            status: readinessStatus(businessReady, !!tenant.business_id || facebookUserTokenPresent || businessScopeReady),
            action_path: '/portal/fb-pages',
            admin_paths: ['/business-manager', '/partner-solutions'],
            required_permissions: BUSINESS_REVIEW_SCOPES,
            missing_permissions: missingItems(BUSINESS_REVIEW_SCOPES, grantedScopes),
            business_id_present: !!tenant.business_id,
            facebook_user_token_present: facebookUserTokenPresent,
            live_token_status: liveFacebookUserToken?.status || 'unchecked',
            review_hint: businessReady
                ? 'Business ID ورمز مستخدم Facebook وصلاحية business_management جاهزة لمسارات Business Manager.'
                : 'يتطلب Business ID ورمز مستخدم Facebook صالح يحتوي business_management، ولا يتم استخدام WhatsApp token كبديل.',
        },
        whatsapp_events: {
            key: 'whatsapp_events',
            title: 'WhatsApp Events API',
            status: readinessStatus(eventsReady, eventsConfigured || !!lastConversion),
            action_path: '/portal/conversions',
            permission_required: 'whatsapp_business_manage_events',
            dataset_id_present: !!tenant.dataset_id,
            dataset_id: tenant.dataset_id || null,
            tenant_whatsapp_token_present: tenantWhatsAppTokenPresent,
            effective_whatsapp_token_present: effectiveWhatsAppTokenPresent,
            events_total: conversionStats?.total || 0,
            events_sent: conversionStats?.sent || 0,
            events_failed: conversionStats?.failed || 0,
            events_local_only: conversionStats?.local_only || 0,
            last_success_at: conversionStats?.last_sent_at || null,
            last_failure_at: conversionStats?.last_failed_at || null,
            last_event: lastConversion ? {
                id: lastConversion.id,
                dataset_id: lastConversion.dataset_id,
                event_name: lastConversion.event_name,
                status: lastConversion.status,
                created_at: lastConversion.created_at,
                events_received: lastConversionMeta?.events_received ?? null,
                fbtrace_id: lastConversionMeta?.fbtrace_id || lastConversionMeta?.error?.fbtrace_id || null,
            } : null,
            review_hint: eventsReady
                ? 'يوجد حدث conversion مرسل إلى Meta ويمكن استخدامه كدليل مراجعة.'
                : 'أضف Dataset ID وتأكد من وجود رمز WhatsApp ثم أرسل حدثاً من شاشة أحداث التحويل.',
        },
    };

    const sectionValues = Object.values(sections);
    const readyCount = sectionValues.filter(section => section.status === 'ready').length;
    const permissionReadyCount = permission_matrix.filter(permission => permission.status === 'ready').length;

    return {
        generated_at: generatedAt,
        tenant: {
            id: tenant.id,
            name: tenant.name,
            phone_number_id_present: !!tenant.phone_number_id,
            waba_id_present: !!tenant.waba_id,
            business_id: tenant.business_id || null,
            dataset_id: tenant.dataset_id || null,
        },
        overall: {
            status: readyCount === sectionValues.length ? 'ready' : 'action_required',
            ready_count: readyCount,
            total_count: sectionValues.length,
            action_required_count: sectionValues.length - readyCount,
            permissions_ready_count: permissionReadyCount,
            permissions_total_count: permission_matrix.length,
        },
        permission_matrix,
        webhook_evidence: webhookEvidence,
        ...sections,
    };
};
