import crypto from 'node:crypto';
import webPush from 'web-push';

import { decrypt, encrypt } from './encryption.js';
import { resolveSafeOutboundTarget, UnsafeOutboundUrlError } from '../security/outboundUrl.js';

const PUSH_CHANNELS = new Set(['whatsapp', 'messenger', 'sms']);
const ALERT_SEVERITIES = new Set(['info', 'warning', 'critical']);
const ACTIVE_TENANT_STATUSES = new Set(['active', 'warning']);
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ALERT_CODE = /^[A-Za-z0-9_.:-]{1,80}$/;
const DISPATCH_CONCURRENCY = 8;

const EXACT_PUSH_HOSTS = new Set([
    'fcm.googleapis.com',
    'android.googleapis.com',
    'updates.push.services.mozilla.com',
    'push.services.mozilla.com',
    'web.push.apple.com',
]);
const PUSH_HOST_SUFFIXES = ['.notify.windows.com'];

const DEFAULTS = Object.freeze({
    ttlSeconds: 300,
    providerTimeoutMs: 10_000,
    maxAttempts: 8,
    baseDelayMs: 2_000,
    maxDelayMs: 3_600_000,
    leaseMs: 300_000,
    batchSize: 100,
    maxSubscriptionsPerUser: 10,
});

const clampInt = (value, fallback, minimum, maximum) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.trunc(parsed), minimum), maximum);
};

const enabledValue = value => ['1', 'true'].includes(String(value || '').trim().toLowerCase());

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');

const safeIso = value => {
    const instant = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(instant.getTime())) throw new TypeError('Invalid clock value');
    return instant.toISOString();
};

const normalizeSubject = value => {
    const subject = String(value || '').trim();
    if (subject.startsWith('mailto:') && subject.length > 'mailto:a@b.co'.length) return subject;
    try {
        const url = new URL(subject);
        if (url.protocol === 'https:' && !url.username && !url.password) return url.toString();
    } catch {
        // Report one stable configuration error below.
    }
    throw new Error('WEB_PUSH_VAPID_SUBJECT must be a mailto: address or HTTPS URL');
};

const requireVapidKey = (value, name) => {
    const key = String(value || '').trim();
    if (!key || !BASE64URL.test(key)) {
        throw new Error(`${name} must be a non-empty base64url value`);
    }
    return key;
};

export class WebPushServiceError extends Error {
    constructor(message, { code = 'WEB_PUSH_ERROR', status = 400 } = {}) {
        super(message);
        this.name = 'WebPushServiceError';
        this.code = code;
        this.status = status;
    }
}

export const webPushConfigFromEnv = (env = process.env) => {
    const enabled = enabledValue(env.WEB_PUSH_ENABLED);
    const config = {
        enabled,
        publicKey: null,
        privateKey: null,
        subject: null,
        ttlSeconds: clampInt(env.WEB_PUSH_TTL_SECONDS, DEFAULTS.ttlSeconds, 0, 2_419_200),
        providerTimeoutMs: clampInt(
            env.WEB_PUSH_TIMEOUT_MS,
            DEFAULTS.providerTimeoutMs,
            1_000,
            60_000,
        ),
        maxAttempts: clampInt(env.WEB_PUSH_MAX_ATTEMPTS, DEFAULTS.maxAttempts, 1, 20),
        baseDelayMs: clampInt(env.WEB_PUSH_BASE_DELAY_MS, DEFAULTS.baseDelayMs, 500, 60_000),
        maxDelayMs: clampInt(env.WEB_PUSH_MAX_DELAY_MS, DEFAULTS.maxDelayMs, 10_000, 86_400_000),
        leaseMs: clampInt(env.WEB_PUSH_LEASE_MS, DEFAULTS.leaseMs, 10_000, 3_600_000),
        batchSize: clampInt(env.WEB_PUSH_BATCH_SIZE, DEFAULTS.batchSize, 1, 500),
        maxSubscriptionsPerUser: clampInt(
            env.WEB_PUSH_MAX_SUBSCRIPTIONS_PER_USER,
            DEFAULTS.maxSubscriptionsPerUser,
            1,
            50,
        ),
    };

    if (!enabled) return config;
    config.publicKey = requireVapidKey(env.WEB_PUSH_VAPID_PUBLIC_KEY, 'WEB_PUSH_VAPID_PUBLIC_KEY');
    config.privateKey = requireVapidKey(env.WEB_PUSH_VAPID_PRIVATE_KEY, 'WEB_PUSH_VAPID_PRIVATE_KEY');
    config.subject = normalizeSubject(env.WEB_PUSH_VAPID_SUBJECT);
    return config;
};

const pushHostnameAllowed = hostname => {
    const normalized = String(hostname || '').toLowerCase();
    return EXACT_PUSH_HOSTS.has(normalized)
        || PUSH_HOST_SUFFIXES.some(suffix => normalized.endsWith(suffix));
};

const canonicalPushEndpoint = value => {
    const endpoint = String(value || '').trim();
    if (endpoint.length < 20 || endpoint.length > 4096) {
        throw new WebPushServiceError('Push endpoint is invalid', {
            code: 'INVALID_PUSH_ENDPOINT',
        });
    }

    let url;
    try {
        url = new URL(endpoint);
    } catch {
        throw new WebPushServiceError('Push endpoint is invalid', {
            code: 'INVALID_PUSH_ENDPOINT',
        });
    }
    if (url.protocol !== 'https:' || (url.port && url.port !== '443')
        || url.username || url.password || url.hash) {
        throw new WebPushServiceError('Push endpoint must use safe HTTPS', {
            code: 'UNSAFE_PUSH_ENDPOINT',
        });
    }
    if (!pushHostnameAllowed(url.hostname)) {
        throw new WebPushServiceError('Push endpoint provider is not allowed', {
            code: 'PUSH_PROVIDER_NOT_ALLOWED',
        });
    }
    return url.toString();
};

export const validatePushEndpoint = async (value, options = {}) => {
    const endpoint = canonicalPushEndpoint(value);
    const resolver = options.resolver || resolveSafeOutboundTarget;
    try {
        await resolver(endpoint, options.resolverOptions || {});
    } catch (error) {
        if (error instanceof UnsafeOutboundUrlError) {
            throw new WebPushServiceError('Push endpoint does not resolve safely', {
                code: 'UNSAFE_PUSH_ENDPOINT',
            });
        }
        throw error;
    }
    return endpoint;
};

const decodeSubscriptionKey = (value, expectedBytes, name) => {
    const encoded = String(value || '').trim();
    if (!BASE64URL.test(encoded)) {
        throw new WebPushServiceError(`Invalid ${name} subscription key`, {
            code: 'INVALID_PUSH_SUBSCRIPTION',
        });
    }
    let decoded;
    try {
        decoded = Buffer.from(encoded, 'base64url');
    } catch {
        decoded = null;
    }
    if (!decoded || decoded.length !== expectedBytes) {
        throw new WebPushServiceError(`Invalid ${name} subscription key`, {
            code: 'INVALID_PUSH_SUBSCRIPTION',
        });
    }
    return encoded;
};

const normalizeCode = value => {
    const code = String(value || '').trim().toUpperCase();
    if (!ALERT_CODE.test(code)) {
        throw new WebPushServiceError('Alert code is invalid', { code: 'INVALID_ALERT_CODE' });
    }
    return code;
};

const normalizeSource = value => {
    const source = String(value || '').trim();
    if (!source || source.length > 4096) {
        throw new WebPushServiceError('Notification source identifier is invalid', {
            code: 'INVALID_NOTIFICATION_SOURCE',
        });
    }
    return sha256(source);
};

const normalizeTenantId = value => {
    const tenantId = Number(value);
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
        throw new WebPushServiceError('Tenant identifier is invalid', {
            code: 'INVALID_TENANT_ID',
        });
    }
    return tenantId;
};

const normalizeAuthVersion = value => {
    const version = value === undefined ? 0 : value;
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
        throw new WebPushServiceError('Authentication generation is invalid', {
            code: 'PUSH_SESSION_REQUIRED',
            status: 401,
        });
    }
    return version;
};

const booleanInput = (value, name) => {
    if (typeof value !== 'boolean') {
        throw new WebPushServiceError(`${name} must be boolean`, {
            code: 'INVALID_NOTIFICATION_PREFERENCES',
        });
    }
    return value ? 1 : 0;
};

const parseLocalTimestamp = value => {
    if (!value) return null;
    // Keep this byte-for-byte equivalent to authMiddleware's revocation
    // interpretation; users.tokens_revoked_at is written with SQLite localtime.
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? Math.trunc(parsed / 1000) : null;
};

const channelName = channel => ({
    whatsapp: 'WhatsApp',
    messenger: 'Messenger',
    sms: 'SMS',
}[channel] || 'المنصة');

const alertDestination = (code, role) => {
    const normalizedCode = String(code || '').toUpperCase();
    if (normalizedCode === 'WHATSAPP_MESSAGE_FAILED') {
        return role === 'admin'
            ? '/inbox?channel=whatsapp'
            : '/portal/inbox?channel=whatsapp';
    }
    if (normalizedCode === 'SMS_MESSAGE_FAILED') {
        return role === 'admin' ? '/settings' : '/portal/inbox?channel=sms';
    }
    if (normalizedCode === 'WHATSAPP_TEMPLATE_REQUIRES_ATTENTION'
        || normalizedCode === 'WHATSAPP_TEMPLATE_QUALITY_DEGRADED') {
        return role === 'admin' ? '/templates' : '/portal/templates';
    }
    if (normalizedCode === 'WHATSAPP_QUALITY_DEGRADED'
        || normalizedCode === 'META_ACCOUNT_ALERT') {
        return role === 'admin' ? '/whatsapp' : '/portal/meta-review';
    }
    return role === 'admin' ? '/settings' : '/portal';
};

const buildNotificationPayload = (event, role) => {
    if (event.kind === 'message') {
        const adminPath = `/inbox?channel=${encodeURIComponent(event.channel)}`;
        const tenantPath = `/portal/inbox?channel=${encodeURIComponent(event.channel)}`;
        return {
            version: 1,
            type: 'message',
            title: 'رسالة جديدة',
            body: `وصلت رسالة جديدة عبر ${channelName(event.channel)}.`,
            tag: event.notification_tag,
            icon: '/logo.png',
            badge: '/logo.png',
            url: role === 'admin' ? adminPath : tenantPath,
        };
    }
    return {
        version: 1,
        type: 'alert',
        title: event.severity === 'critical' ? 'تنبيه مهم' : 'تنبيه جديد',
        body: 'يوجد تنبيه جديد يحتاج إلى المراجعة.',
        tag: event.notification_tag,
        icon: '/logo.png',
        badge: '/logo.png',
        url: alertDestination(event.alert_code, role),
    };
};

const providerStatus = error => {
    const value = Number(error?.statusCode ?? error?.status);
    return Number.isInteger(value) ? value : null;
};

const errorCodeFor = (error, status) => {
    if (error?.code === 'PUSH_PROVIDER_TIMEOUT') return error.code;
    if (error instanceof WebPushServiceError) return error.code;
    if (error instanceof UnsafeOutboundUrlError) return 'UNSAFE_PUSH_ENDPOINT';
    if (status) return `HTTP_${status}`;
    return 'PUSH_NETWORK_ERROR';
};

const withProviderTimeout = (operation, timeoutMs) => new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
        settled = true;
        const error = new Error('Push provider request timed out');
        error.code = 'PUSH_PROVIDER_TIMEOUT';
        reject(error);
    }, timeoutMs);

    Promise.resolve()
        .then(operation)
        .then(
            value => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(error);
            },
        );
});

const finalizePushEvent = ({ database, eventId, nowIso }) => {
    const summary = database.prepare(`
        SELECT COUNT(*) AS total,
               COALESCE(SUM(status = 'delivered'), 0) AS delivered,
               COALESCE(SUM(status IN ('pending', 'processing', 'failed')), 0) AS remaining,
               COALESCE(SUM(status = 'dead_letter'), 0) AS dead_letter,
               COALESCE(SUM(status = 'skipped'), 0) AS skipped
        FROM web_push_deliveries
        WHERE event_id = ?
    `).get(eventId);
    if (summary.remaining > 0) return 'pending';
    let status;
    if (summary.total === 0 || (summary.delivered === 0 && summary.skipped === summary.total)) {
        status = 'no_recipients';
    } else if (summary.delivered === summary.total) {
        status = 'delivered';
    } else if (summary.delivered > 0) {
        status = 'partial';
    } else {
        status = 'failed';
    }
    database.prepare(`
        UPDATE web_push_events SET status = ?, completed_at = ? WHERE id = ?
    `).run(status, nowIso(), eventId);
    return status;
};

export const createWebPushService = ({
    database,
    config = webPushConfigFromEnv(),
    provider = webPush,
    encryptValue = encrypt,
    decryptValue = decrypt,
    endpointValidator = validatePushEndpoint,
    now = () => new Date(),
} = {}) => {
    if (!database) throw new TypeError('createWebPushService requires database');
    if (!config || typeof config.enabled !== 'boolean') {
        throw new TypeError('createWebPushService requires a valid config');
    }

    const resolvedConfig = { ...DEFAULTS, ...config };
    if (resolvedConfig.enabled) {
        if (!provider || typeof provider.setVapidDetails !== 'function'
            || typeof provider.sendNotification !== 'function') {
            throw new TypeError('A compatible web-push provider is required');
        }
        provider.setVapidDetails(
            resolvedConfig.subject,
            resolvedConfig.publicKey,
            resolvedConfig.privateKey,
        );
    }

    const clock = () => {
        const value = now();
        const instant = value instanceof Date ? value : new Date(value);
        if (!Number.isFinite(instant.getTime())) throw new TypeError('Invalid clock value');
        return instant;
    };
    const nowIso = () => safeIso(clock());
    const nowSeconds = () => Math.trunc(clock().getTime() / 1000);
    const finalizeEvent = eventId => finalizePushEvent({ database, eventId, nowIso });

    const deleteSubscriptionById = subscriptionId => database.transaction(() => {
        const eventIds = database.prepare(`
            SELECT DISTINCT event_id FROM web_push_deliveries
            WHERE subscription_id = ?
        `).all(subscriptionId).map(row => row.event_id);
        const result = database.prepare(`
            DELETE FROM web_push_subscriptions WHERE id = ?
        `).run(subscriptionId);
        for (const eventId of eventIds) finalizeEvent(eventId);
        return result.changes;
    }).immediate();

    const ensureEnabled = () => {
        if (!resolvedConfig.enabled) {
            throw new WebPushServiceError('Browser notifications are not enabled', {
                code: 'WEB_PUSH_DISABLED',
                status: 503,
            });
        }
    };

    const getPreferences = userId => {
        const row = database.prepare(`
            SELECT messages_enabled, alerts_enabled, message_preview_enabled
            FROM web_push_preferences
            WHERE user_id = ?
        `).get(userId);
        return {
            messages_enabled: row ? Boolean(row.messages_enabled) : true,
            alerts_enabled: row ? Boolean(row.alerts_enabled) : true,
            message_preview_enabled: row ? Boolean(row.message_preview_enabled) : false,
        };
    };

    const updatePreferences = (userId, input = {}) => {
        const existing = getPreferences(userId);
        const next = {
            messages_enabled: Object.hasOwn(input, 'messages_enabled')
                ? booleanInput(input.messages_enabled, 'messages_enabled')
                : Number(existing.messages_enabled),
            alerts_enabled: Object.hasOwn(input, 'alerts_enabled')
                ? booleanInput(input.alerts_enabled, 'alerts_enabled')
                : Number(existing.alerts_enabled),
            message_preview_enabled: Object.hasOwn(input, 'message_preview_enabled')
                ? booleanInput(input.message_preview_enabled, 'message_preview_enabled')
                : Number(existing.message_preview_enabled),
        };
        const timestamp = nowIso();
        database.prepare(`
            INSERT INTO web_push_preferences (
                user_id, messages_enabled, alerts_enabled, message_preview_enabled,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                messages_enabled = excluded.messages_enabled,
                alerts_enabled = excluded.alerts_enabled,
                message_preview_enabled = excluded.message_preview_enabled,
                updated_at = excluded.updated_at
        `).run(
            userId,
            next.messages_enabled,
            next.alerts_enabled,
            next.message_preview_enabled,
            timestamp,
            timestamp,
        );
        return getPreferences(userId);
    };

    const assertCurrentUserCanSubscribe = (userId, sessionAuthVersion) => {
        const row = database.prepare(`
            SELECT users.id, users.role, users.tenant_id, users.is_active,
                   users.auth_version, tenants.status AS tenant_status
            FROM users
            LEFT JOIN tenants ON tenants.id = users.tenant_id
            WHERE users.id = ?
        `).get(userId);
        const eligible = Boolean(row?.is_active) && (
            row.role === 'admin'
            || (
                row.tenant_id !== null
                && ACTIVE_TENANT_STATUSES.has(String(row.tenant_status || '').toLowerCase())
            )
        );
        if (!eligible) {
            throw new WebPushServiceError('This account cannot enable notifications', {
                code: 'PUSH_ACCOUNT_INELIGIBLE',
                status: 403,
            });
        }
        if (row.auth_version !== sessionAuthVersion) {
            throw new WebPushServiceError('An active browser session is required', {
                code: 'PUSH_SESSION_REQUIRED',
                status: 401,
            });
        }
        return row;
    };

    const registerSubscription = async ({ user, subscription }) => {
        ensureEnabled();
        const userId = Number(user?.id);
        const issuedAt = Number(user?.iat);
        const expiresAt = Number(user?.exp);
        const sessionJti = String(user?.jti || '').trim();
        const sessionAuthVersion = normalizeAuthVersion(user?.auth_version);
        if (!Number.isSafeInteger(userId) || userId <= 0 || !sessionJti
            || !Number.isInteger(issuedAt) || !Number.isInteger(expiresAt)
            || expiresAt <= issuedAt || expiresAt <= nowSeconds()) {
            throw new WebPushServiceError('An active browser session is required', {
                code: 'PUSH_SESSION_REQUIRED',
                status: 401,
            });
        }
        assertCurrentUserCanSubscribe(userId, sessionAuthVersion);

        let endpoint;
        try {
            endpoint = await withProviderTimeout(
                () => endpointValidator(subscription?.endpoint),
                resolvedConfig.providerTimeoutMs,
            );
        } catch (error) {
            if (error?.code === 'PUSH_PROVIDER_TIMEOUT') {
                throw new WebPushServiceError('Push endpoint validation timed out', {
                    code: 'PUSH_ENDPOINT_VALIDATION_TIMEOUT',
                    status: 503,
                });
            }
            throw error;
        }
        const p256dh = decodeSubscriptionKey(subscription?.keys?.p256dh, 65, 'p256dh');
        const auth = decodeSubscriptionKey(subscription?.keys?.auth, 16, 'auth');
        const endpointHash = sha256(endpoint);
        const encrypted = {
            endpoint: encryptValue(endpoint),
            p256dh: encryptValue(p256dh),
            auth: encryptValue(auth),
        };
        if (!encrypted.endpoint || !encrypted.p256dh || !encrypted.auth) {
            throw new WebPushServiceError('Push subscription could not be protected', {
                code: 'PUSH_ENCRYPTION_FAILED',
                status: 500,
            });
        }
        const timestamp = nowIso();

        return database.transaction(() => {
            // Endpoint validation may perform DNS I/O. Re-check the generation
            // under the write transaction so a concurrent password reset can
            // never persist a subscription for the now-stale session.
            assertCurrentUserCanSubscribe(userId, sessionAuthVersion);
            const existing = database.prepare(`
                SELECT id, user_id FROM web_push_subscriptions WHERE endpoint_hash = ?
            `).get(endpointHash);
            if (existing && Number(existing.user_id) !== userId) {
                // A service-worker subscription is unique to one browser profile.
                // Moving it on a new login must cascade stale deliveries first.
                deleteSubscriptionById(existing.id);
            }

            const ownExisting = database.prepare(`
                SELECT id FROM web_push_subscriptions
                WHERE endpoint_hash = ? AND user_id = ?
            `).get(endpointHash, userId);
            if (!ownExisting) {
                const count = database.prepare(`
                    SELECT COUNT(*) AS count FROM web_push_subscriptions
                    WHERE user_id = ?
                      AND enabled = 1
                      AND session_auth_version = ?
                      AND session_expires_at > ?
                      AND NOT EXISTS (
                          SELECT 1 FROM revoked_tokens
                          WHERE revoked_tokens.jti = web_push_subscriptions.session_jti
                      )
                `).get(userId, sessionAuthVersion, nowSeconds()).count;
                if (count >= resolvedConfig.maxSubscriptionsPerUser) {
                    throw new WebPushServiceError('Notification device limit reached', {
                        code: 'PUSH_SUBSCRIPTION_LIMIT',
                        status: 409,
                    });
                }
            }

            database.prepare(`
                INSERT INTO web_push_subscriptions (
                    user_id, endpoint_hash, endpoint_encrypted, p256dh_encrypted,
                    auth_encrypted, session_jti, session_auth_version,
                    session_issued_at, session_expires_at,
                    enabled, failure_count, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
                ON CONFLICT(endpoint_hash) DO UPDATE SET
                    user_id = excluded.user_id,
                    endpoint_encrypted = excluded.endpoint_encrypted,
                    p256dh_encrypted = excluded.p256dh_encrypted,
                    auth_encrypted = excluded.auth_encrypted,
                    session_jti = excluded.session_jti,
                    session_auth_version = excluded.session_auth_version,
                    session_issued_at = excluded.session_issued_at,
                    session_expires_at = excluded.session_expires_at,
                    enabled = 1,
                    failure_count = 0,
                    updated_at = excluded.updated_at
            `).run(
                userId,
                endpointHash,
                encrypted.endpoint,
                encrypted.p256dh,
                encrypted.auth,
                sessionJti,
                sessionAuthVersion,
                issuedAt,
                expiresAt,
                timestamp,
                timestamp,
            );
            const saved = database.prepare(`
                SELECT id, created_at, updated_at
                FROM web_push_subscriptions WHERE endpoint_hash = ? AND user_id = ?
            `).get(endpointHash, userId);
            return {
                id: saved.id,
                created_at: saved.created_at,
                updated_at: saved.updated_at,
            };
        }).immediate();
    };

    const removeSubscription = ({ userId, endpoint }) => {
        const normalizedUserId = Number(userId);
        if (!Number.isSafeInteger(normalizedUserId) || normalizedUserId <= 0) {
            throw new WebPushServiceError('User identifier is invalid', { code: 'INVALID_USER_ID' });
        }
        const canonical = canonicalPushEndpoint(endpoint);
        const existing = database.prepare(`
            SELECT id FROM web_push_subscriptions
            WHERE user_id = ? AND endpoint_hash = ?
        `).get(normalizedUserId, sha256(canonical));
        return { removed: existing ? deleteSubscriptionById(existing.id) > 0 : false };
    };

    const seedDeliveries = (eventId, event) => {
        const timestamp = nowIso();
        const preferenceColumn = event.kind === 'message' ? 'messages_enabled' : 'alerts_enabled';
        const result = database.prepare(`
            INSERT OR IGNORE INTO web_push_deliveries (
                event_id, subscription_id, status, attempts, available_at, created_at, updated_at
            )
            SELECT ?, subscriptions.id, 'pending', 0, ?, ?, ?
            FROM web_push_subscriptions subscriptions
            JOIN users ON users.id = subscriptions.user_id
            LEFT JOIN tenants ON tenants.id = users.tenant_id
            LEFT JOIN web_push_preferences preferences ON preferences.user_id = users.id
            WHERE subscriptions.enabled = 1
              AND users.is_active = 1
              AND subscriptions.session_auth_version = users.auth_version
              AND subscriptions.session_expires_at > ?
              AND NOT EXISTS (
                  SELECT 1 FROM revoked_tokens
                  WHERE revoked_tokens.jti = subscriptions.session_jti
              )
              AND COALESCE(preferences.${preferenceColumn}, 1) = 1
              AND (
                  (
                      users.role = 'admin'
                      AND NOT (? = 'message' AND ? = 'sms')
                  )
                  OR (
                      ? IS NOT NULL
                      AND users.tenant_id = ?
                      AND lower(COALESCE(tenants.status, '')) IN ('active', 'warning')
                  )
              )
        `).run(
            eventId,
            timestamp,
            timestamp,
            timestamp,
            nowSeconds(),
            event.kind,
            event.channel,
            event.tenant_id,
            event.tenant_id,
        );
        return result.changes;
    };

    const insertEvent = event => {
        const timestamp = nowIso();
        const insert = database.prepare(`
            INSERT OR IGNORE INTO web_push_events (
                dedupe_key, tenant_id, kind, channel, alert_code, severity,
                source_hash, notification_tag, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).run(
            event.dedupe_key,
            event.tenant_id,
            event.kind,
            event.channel,
            event.alert_code,
            event.severity,
            event.source_hash,
            event.notification_tag,
            timestamp,
        );
        const row = database.prepare(`
            SELECT id, status FROM web_push_events WHERE dedupe_key = ?
        `).get(event.dedupe_key);
        if (!insert.changes) {
            return { event_id: row.id, deduplicated: true, deliveries: 0, status: row.status };
        }
        const deliveries = seedDeliveries(row.id, event);
        if (deliveries === 0) {
            database.prepare(`
                UPDATE web_push_events
                SET status = 'no_recipients', completed_at = ?
                WHERE id = ?
            `).run(timestamp, row.id);
        }
        return {
            event_id: row.id,
            deduplicated: false,
            deliveries,
            status: deliveries ? 'pending' : 'no_recipients',
        };
    };

    const enqueueEvent = event => database.transaction(() => insertEvent(event)).immediate();

    const enqueueMessage = ({ tenantId, channel, sourceId }) => {
        ensureEnabled();
        const normalizedTenantId = normalizeTenantId(tenantId);
        const normalizedChannel = String(channel || '').trim().toLowerCase();
        if (!PUSH_CHANNELS.has(normalizedChannel)) {
            throw new WebPushServiceError('Message channel is invalid', {
                code: 'INVALID_MESSAGE_CHANNEL',
            });
        }
        const sourceHash = normalizeSource(sourceId);
        return enqueueEvent({
            tenant_id: normalizedTenantId,
            kind: 'message',
            channel: normalizedChannel,
            alert_code: null,
            severity: null,
            source_hash: sourceHash,
            dedupe_key: `message:${normalizedTenantId}:${normalizedChannel}:${sourceHash}`,
            notification_tag: `wa-message-${normalizedChannel}-${sourceHash.slice(0, 24)}`,
        });
    };

    const buildAlertEvent = ({ tenantId = null, code, sourceId, severity = 'warning' }) => {
        const normalizedTenantId = tenantId === null || tenantId === undefined
            ? null
            : normalizeTenantId(tenantId);
        const normalizedCode = normalizeCode(code);
        const normalizedSeverity = String(severity || '').trim().toLowerCase();
        if (!ALERT_SEVERITIES.has(normalizedSeverity)) {
            throw new WebPushServiceError('Alert severity is invalid', {
                code: 'INVALID_ALERT_SEVERITY',
            });
        }
        const sourceHash = normalizeSource(sourceId);
        const scope = normalizedTenantId === null ? 'admin' : `tenant-${normalizedTenantId}`;
        return {
            tenant_id: normalizedTenantId,
            kind: 'alert',
            channel: null,
            alert_code: normalizedCode,
            severity: normalizedSeverity,
            source_hash: sourceHash,
            dedupe_key: `alert:${scope}:${normalizedCode}:${sourceHash}`,
            notification_tag: `wa-alert-${normalizedCode.toLowerCase()}-${sourceHash.slice(0, 20)}`,
        };
    };

    const enqueueAlert = input => {
        ensureEnabled();
        return enqueueEvent(buildAlertEvent(input));
    };

    const loadDelivery = deliveryId => database.prepare(`
        SELECT deliveries.*,
               events.tenant_id AS event_tenant_id,
               events.kind, events.channel, events.alert_code, events.severity,
               events.notification_tag,
               subscriptions.user_id, subscriptions.endpoint_encrypted,
               subscriptions.p256dh_encrypted, subscriptions.auth_encrypted,
               subscriptions.session_jti, subscriptions.session_auth_version,
               subscriptions.session_issued_at,
               subscriptions.session_expires_at, subscriptions.enabled AS subscription_enabled,
               users.role, users.tenant_id AS user_tenant_id, users.is_active,
               users.tokens_revoked_at, users.auth_version,
               tenants.status AS tenant_status,
               COALESCE(preferences.messages_enabled, 1) AS messages_enabled,
               COALESCE(preferences.alerts_enabled, 1) AS alerts_enabled,
               EXISTS(
                   SELECT 1 FROM revoked_tokens
                   WHERE revoked_tokens.jti = subscriptions.session_jti
               ) AS session_revoked
        FROM web_push_deliveries deliveries
        JOIN web_push_events events ON events.id = deliveries.event_id
        JOIN web_push_subscriptions subscriptions ON subscriptions.id = deliveries.subscription_id
        JOIN users ON users.id = subscriptions.user_id
        LEFT JOIN tenants ON tenants.id = users.tenant_id
        LEFT JOIN web_push_preferences preferences ON preferences.user_id = users.id
        WHERE deliveries.id = ?
    `).get(deliveryId);

    const eligibleDelivery = row => {
        if (!row || !row.subscription_enabled || !row.is_active || row.session_revoked) return false;
        if (row.session_auth_version !== row.auth_version) return false;
        const seconds = nowSeconds();
        if (Number(row.session_expires_at) <= seconds) return false;
        const revokedAt = parseLocalTimestamp(row.tokens_revoked_at);
        if (revokedAt !== null && Number(row.session_issued_at) < revokedAt) return false;
        if (row.kind === 'message' && !row.messages_enabled) return false;
        if (row.kind === 'alert' && !row.alerts_enabled) return false;
        if (row.role === 'admin') {
            return !(row.kind === 'message' && row.channel === 'sms');
        }
        return row.event_tenant_id !== null
            && Number(row.user_tenant_id) === Number(row.event_tenant_id)
            && ACTIVE_TENANT_STATUSES.has(String(row.tenant_status || '').toLowerCase());
    };

    const claimDelivery = deliveryId => database.transaction(() => {
        const timestamp = nowIso();
        const leaseCutoff = safeIso(clock().getTime() - resolvedConfig.leaseMs);
        const result = database.prepare(`
            UPDATE web_push_deliveries
            SET status = 'processing', attempts = attempts + 1,
                locked_at = ?, updated_at = ?
            WHERE id = ?
              AND (
                  (status IN ('pending', 'failed') AND available_at <= ?)
                  OR (status = 'processing' AND locked_at <= ?)
              )
        `).run(timestamp, timestamp, deliveryId, timestamp, leaseCutoff);
        return result.changes ? loadDelivery(deliveryId) : null;
    }).immediate();

    const markSkipped = row => {
        database.prepare(`
            UPDATE web_push_deliveries
            SET status = 'skipped', locked_at = NULL, last_error = NULL, updated_at = ?
            WHERE id = ?
        `).run(nowIso(), row.id);
        finalizeEvent(row.event_id);
        return { delivery_id: row.id, status: 'skipped' };
    };

    const markPermanentFailure = (row, status, code) => {
        const timestamp = nowIso();
        database.prepare(`
            UPDATE web_push_deliveries
            SET status = 'dead_letter', locked_at = NULL, response_status = ?,
                last_error = ?, updated_at = ?
            WHERE id = ?
        `).run(status, code, timestamp, row.id);
        database.prepare(`
            UPDATE web_push_subscriptions
            SET failure_count = failure_count + 1, last_failure_at = ?, updated_at = ?
            WHERE id = ?
        `).run(timestamp, timestamp, row.subscription_id);
        finalizeEvent(row.event_id);
        return { delivery_id: row.id, status: 'dead_letter', response_status: status };
    };

    const dispatchDelivery = async deliveryId => {
        let row = claimDelivery(deliveryId);
        if (!row) return { delivery_id: deliveryId, status: 'not_claimed' };
        if (!eligibleDelivery(row)) return markSkipped(row);

        let endpoint;
        try {
            endpoint = decryptValue(row.endpoint_encrypted);
            if (!endpoint) {
                return markPermanentFailure(row, null, 'PUSH_DECRYPTION_FAILED');
            }
        } catch (error) {
            return markPermanentFailure(row, providerStatus(error), errorCodeFor(error, providerStatus(error)));
        }

        try {
            const validatedEndpoint = await withProviderTimeout(
                () => endpointValidator(endpoint),
                resolvedConfig.providerTimeoutMs,
            );

            // DNS validation is asynchronous. A password reset, logout,
            // tenant reassignment or endpoint removal may happen while it is
            // in flight, so never send from the pre-validation snapshot.
            // Re-check the lease and authorization synchronously immediately
            // before invoking the provider; no event-loop turn exists between
            // this snapshot and the provider call below.
            const refreshed = loadDelivery(row.id);
            if (!refreshed) {
                finalizeEvent(row.event_id);
                return { delivery_id: row.id, status: 'skipped' };
            }
            if (refreshed.status !== 'processing'
                || Number(refreshed.subscription_id) !== Number(row.subscription_id)
                || refreshed.locked_at !== row.locked_at
                || Number(refreshed.attempts) !== Number(row.attempts)) {
                return { delivery_id: row.id, status: 'not_claimed' };
            }
            row = refreshed;
            if (!eligibleDelivery(row)) return markSkipped(row);

            const refreshedEndpoint = decryptValue(row.endpoint_encrypted);
            const p256dh = decryptValue(row.p256dh_encrypted);
            const auth = decryptValue(row.auth_encrypted);
            if (!refreshedEndpoint || !p256dh || !auth
                || refreshedEndpoint !== endpoint) {
                return markPermanentFailure(row, null, 'PUSH_DECRYPTION_FAILED');
            }
            const payload = JSON.stringify(buildNotificationPayload(row, row.role));
            const response = await withProviderTimeout(
                () => provider.sendNotification({
                        endpoint: validatedEndpoint,
                        keys: { p256dh, auth },
                    }, payload, {
                        TTL: resolvedConfig.ttlSeconds,
                        urgency: row.kind === 'alert' && row.severity === 'critical' ? 'high' : 'normal',
                        timeout: resolvedConfig.providerTimeoutMs,
                    }),
                resolvedConfig.providerTimeoutMs,
            );
            const timestamp = nowIso();
            const status = Number(response?.statusCode) || 201;
            database.prepare(`
                UPDATE web_push_deliveries
                SET status = 'delivered', locked_at = NULL, delivered_at = ?,
                    response_status = ?, last_error = NULL, updated_at = ?
                WHERE id = ?
            `).run(timestamp, status, timestamp, row.id);
            database.prepare(`
                UPDATE web_push_subscriptions
                SET failure_count = 0, last_success_at = ?, updated_at = ?
                WHERE id = ?
            `).run(timestamp, timestamp, row.subscription_id);
            finalizeEvent(row.event_id);
            return { delivery_id: row.id, status: 'delivered', response_status: status };
        } catch (error) {
            const status = providerStatus(error);
            const code = errorCodeFor(error, status);
            if (error instanceof WebPushServiceError || error instanceof UnsafeOutboundUrlError) {
                return markPermanentFailure(row, status, code);
            }
            if (status === 404 || status === 410) {
                deleteSubscriptionById(row.subscription_id);
                return { delivery_id: row.id, status: 'subscription_removed', response_status: status };
            }

            const transient = status === null || status === 408 || status === 425
                || status === 429 || status >= 500;
            if (!transient || Number(row.attempts) >= resolvedConfig.maxAttempts) {
                return markPermanentFailure(row, status, code);
            }

            const delay = Math.min(
                resolvedConfig.maxDelayMs,
                resolvedConfig.baseDelayMs * (2 ** Math.max(0, Number(row.attempts) - 1)),
            );
            const timestamp = nowIso();
            const availableAt = safeIso(clock().getTime() + delay);
            database.prepare(`
                UPDATE web_push_deliveries
                SET status = 'failed', locked_at = NULL, available_at = ?,
                    response_status = ?, last_error = ?, updated_at = ?
                WHERE id = ?
            `).run(availableAt, status, code, timestamp, row.id);
            database.prepare(`
                UPDATE web_push_subscriptions
                SET failure_count = failure_count + 1, last_failure_at = ?, updated_at = ?
                WHERE id = ?
            `).run(timestamp, timestamp, row.subscription_id);
            return {
                delivery_id: row.id,
                status: 'retry_scheduled',
                response_status: status,
                available_at: availableAt,
            };
        }
    };

    const dispatchDue = async ({ limit = resolvedConfig.batchSize } = {}) => {
        if (!resolvedConfig.enabled) {
            return { enabled: false, attempted: 0, results: [] };
        }
        const timestamp = nowIso();
        const leaseCutoff = safeIso(clock().getTime() - resolvedConfig.leaseMs);
        const boundedLimit = clampInt(limit, resolvedConfig.batchSize, 1, 500);
        const due = database.prepare(`
            SELECT id FROM web_push_deliveries
            WHERE (status IN ('pending', 'failed') AND available_at <= ?)
               OR (status = 'processing' AND locked_at <= ?)
            ORDER BY available_at ASC, id ASC
            LIMIT ?
        `).all(timestamp, leaseCutoff, boundedLimit);
        const results = new Array(due.length);
        let cursor = 0;
        const worker = async () => {
            while (cursor < due.length) {
                const index = cursor;
                cursor += 1;
                results[index] = await dispatchDelivery(due[index].id);
            }
        };
        await Promise.all(
            Array.from(
                { length: Math.min(DISPATCH_CONCURRENCY, due.length) },
                () => worker(),
            ),
        );
        return { enabled: true, attempted: due.length, results };
    };

    const syncOperationalAlerts = signals => {
        if (!resolvedConfig.enabled) return [];
        const activeAlerts = new Map(
            (Array.isArray(signals?.alerts) ? signals.alerts : [])
                .map(alert => [normalizeCode(alert.code), alert]),
        );
        const timestamp = nowIso();
        return database.transaction(() => {
            const results = [];
            for (const [code, alert] of activeAlerts) {
                const current = database.prepare(`
                    SELECT is_active FROM web_push_alert_states
                    WHERE scope_key = 'admin' AND alert_code = ?
                `).get(code);
                if (!current?.is_active) {
                    const source = `${code}:${timestamp}`;
                    const event = buildAlertEvent({
                        tenantId: null,
                        code,
                        sourceId: source,
                        severity: ALERT_SEVERITIES.has(String(alert.severity || '').toLowerCase())
                            ? String(alert.severity).toLowerCase()
                            : 'warning',
                    });
                    const result = insertEvent(event);
                    database.prepare(`
                        INSERT INTO web_push_alert_states (
                            scope_key, alert_code, is_active, last_source_hash,
                            activated_at, resolved_at, updated_at
                        ) VALUES ('admin', ?, 1, ?, ?, NULL, ?)
                        ON CONFLICT(scope_key, alert_code) DO UPDATE SET
                            is_active = 1,
                            last_source_hash = excluded.last_source_hash,
                            activated_at = excluded.activated_at,
                            resolved_at = NULL,
                            updated_at = excluded.updated_at
                    `).run(code, event.source_hash, timestamp, timestamp);
                    results.push(result);
                }
            }

            const activeRows = database.prepare(`
                SELECT alert_code FROM web_push_alert_states
                WHERE scope_key = 'admin' AND is_active = 1
            `).all();
            for (const row of activeRows) {
                if (!activeAlerts.has(row.alert_code)) {
                    database.prepare(`
                        UPDATE web_push_alert_states
                        SET is_active = 0, resolved_at = ?, updated_at = ?
                        WHERE scope_key = 'admin' AND alert_code = ?
                    `).run(timestamp, timestamp, row.alert_code);
                }
            }
            return results;
        }).immediate();
    };

    return Object.freeze({
        getPublicConfig: () => ({
            enabled: resolvedConfig.enabled,
            public_key: resolvedConfig.enabled ? resolvedConfig.publicKey : null,
        }),
        registerSubscription,
        removeSubscription,
        getPreferences,
        updatePreferences,
        enqueueMessage,
        enqueueAlert,
        dispatchDue,
        syncOperationalAlerts,
    });
};
