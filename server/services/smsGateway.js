import crypto from 'node:crypto';

import { decrypt, encrypt } from './encryption.js';
import { safeOutboundFetch, validateOutboundUrl } from '../security/outboundUrl.js';

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const ASSIGNMENT_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/;
const DELIVERY_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_PATTERN = /^\+?\d{5,20}$/;
const USSD_PATTERN = /^[*#][0-9*#+]{0,180}#$/;

export class SmsGatewayError extends Error {
    constructor(message, status = 400, code = 'SMS_GATEWAY_ERROR', details = {}) {
        super(message);
        this.name = 'SmsGatewayError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

const parseJson = (value, fallback = null) => {
    try {
        return value ? JSON.parse(value) : fallback;
    } catch {
        return fallback;
    }
};

const normalizedPhone = value => {
    const phone = String(value || '').trim().replace(/[\s()-]/g, '');
    if (!PHONE_PATTERN.test(phone)) {
        throw new SmsGatewayError('رقم المستلم غير صالح', 422, 'INVALID_SMS_RECIPIENT');
    }
    return phone.replace(/^\+/, '');
};

const normalizedSender = value => {
    const sender = String(value || '').trim();
    if (!sender || sender.length > 64 || /[\u0000-\u001f\u007f]/.test(sender)) {
        throw new SmsGatewayError('معرّف مرسل SMS غير صالح', 422, 'INVALID_SMS_SENDER');
    }
    const compact = sender.replace(/[\s()-]/g, '');
    return PHONE_PATTERN.test(compact) ? compact.replace(/^\+/, '') : sender;
};

const callbackBaseUrl = () => String(process.env.SMS_GATEWAY_CALLBACK_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');

const privateGatewayHostnames = () => String(process.env.SMS_GATEWAY_PRIVATE_HOST_ALLOWLIST || '')
    .split(',')
    .map(hostname => hostname.trim().toLowerCase())
    .filter(Boolean);

const callbackUrlFor = webhookKey => {
    const base = callbackBaseUrl();
    if (!base) {
        throw new SmsGatewayError(
            'SMS_GATEWAY_CALLBACK_BASE_URL غير مضبوط على الخادم',
            503,
            'SMS_GATEWAY_CALLBACK_NOT_CONFIGURED',
        );
    }
    let parsed;
    try {
        parsed = new URL(base);
    } catch {
        throw new SmsGatewayError(
            'SMS_GATEWAY_CALLBACK_BASE_URL غير صالح',
            503,
            'SMS_GATEWAY_CALLBACK_NOT_CONFIGURED',
        );
    }
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
        throw new SmsGatewayError(
            'عنوان callback الخاص بـ SMS يجب أن يستخدم HTTPS في الإنتاج',
            503,
            'SMS_GATEWAY_CALLBACK_NOT_SECURE',
        );
    }
    return `${base}/${encodeURIComponent(webhookKey)}`;
};

const endpointUrl = (baseUrl, path) => `${String(baseUrl).replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const shouldMarkAccountError = error => Boolean(
    error?.deliveryUncertain
    || error?.code === 'SMS_GATEWAY_UNAVAILABLE'
    || error?.code === 'SMS_GATEWAY_INVALID_RESPONSE'
);

const cleanDisplayText = (value, maxLength = 120) => {
    const text = String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
    return text ? text.slice(0, maxLength) : null;
};

const ENGLISH_ROUTING_DETAIL_PATTERN = /(?:^|[^a-z0-9])(?:android|devices?|sims?|phones?|models?|handsets?|mobiles?)(?:$|[^a-z0-9])/i;
const ARABIC_ROUTING_DETAIL_PATTERN = /هاتف|هواتف|جهاز|أجهزة|شريحة|شرائح|موديل/;
const containsRoutingDetail = value => (
    ENGLISH_ROUTING_DETAIL_PATTERN.test(String(value))
    || ARABIC_ROUTING_DETAIL_PATTERN.test(String(value))
);

const tenantSafeCode = (value, fallback) => {
    if (value === null || value === undefined) return value;
    return containsRoutingDetail(value) ? fallback : value;
};

export const presentTenantSmsGatewayError = error => {
    const rawCode = String(error?.code || 'SMS_GATEWAY_ERROR');
    const rawMessage = String(error?.message || 'تعذر تنفيذ طلب SMS');
    if (!containsRoutingDetail(`${rawCode} ${rawMessage}`)) {
        return { code: rawCode, message: rawMessage };
    }
    const ussd = /ussd/i.test(`${rawCode} ${rawMessage}`);
    return ussd
        ? { code: 'USSD_EXECUTION_FAILED', message: 'تعذر تنفيذ طلب USSD؛ تواصل مع الدعم.' }
        : { code: 'SMS_REQUEST_FAILED', message: 'تعذر تنفيذ طلب SMS؛ تواصل مع الدعم.' };
};

const normalizeManagedResources = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const devices = Array.isArray(value.devices) ? value.devices.slice(0, 20).map(device => {
        if (!device || typeof device !== 'object' || Array.isArray(device)) return null;
        const id = cleanDisplayText(device.id, 40);
        if (!id || !/^\d+$/.test(id)) return null;
        return {
            id,
            name: cleanDisplayText(device.name, 100),
            model: cleanDisplayText(device.model, 100),
        };
    }).filter(Boolean) : [];
    const rawSim = value.sim && typeof value.sim === 'object' && !Array.isArray(value.sim)
        ? value.sim
        : null;
    const slot = rawSim?.slot == null ? null : Number(rawSim.slot);
    const sim = rawSim && Number.isInteger(slot) && slot >= 0 ? {
        slot,
        name: cleanDisplayText(rawSim.name, 100),
        carrier: cleanDisplayText(rawSim.carrier, 100),
        number: cleanDisplayText(rawSim.number, 40),
    } : null;
    return { devices, sim };
};

const emptyStats = () => ({
    pending: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    canceled: 0,
    received: 0,
    total_outgoing: 0,
});

const normalizedStats = value => {
    const result = emptyStats();
    for (const key of Object.keys(result)) {
        const parsed = Number(value?.[key]);
        result[key] = Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
    }
    if (!Number.isFinite(Number(value?.total_outgoing))) {
        result.total_outgoing = result.pending + result.sent + result.delivered
            + result.failed + result.canceled;
    }
    return result;
};

const TERMINAL_SMS_STATUSES = new Set(['delivered', 'failed', 'canceled']);
const SMS_STATUS_RANK = new Map([
    ['pending', 0],
    ['queued', 0],
    ['received', 0],
    ['sent', 1],
    ['read', 1],
    ['delivered', 2],
    ['failed', 2],
    ['canceled', 2],
]);

const mergeSmsStatus = (existing, incoming) => {
    const previous = String(existing || '').toLowerCase();
    const next = String(incoming || 'pending').toLowerCase();
    if (!previous || previous === next) return next;
    if (TERMINAL_SMS_STATUSES.has(previous)) return previous;
    const previousRank = SMS_STATUS_RANK.get(previous);
    const nextRank = SMS_STATUS_RANK.get(next);
    if (previousRank !== undefined && nextRank !== undefined && previousRank > nextRank) {
        return previous;
    }
    return next;
};

const localDateInTripoli = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tripoli',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
}).format(now);

const addUtcDays = (date, days) => {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return parsed.toISOString().slice(0, 10);
};

export const parseGatewayJsonResponse = (account, response, method = 'GET') => {
    const payload = parseJson(response.body, null);
    if (!payload) {
        const gatewayError = new SmsGatewayError(
            'أعاد حساب SMS استجابة غير صالحة',
            502,
            'SMS_GATEWAY_INVALID_RESPONSE',
        );
        gatewayError.deliveryUncertain = method !== 'GET';
        throw gatewayError;
    }
    if (!response.ok) {
        let mappedStatus = 502;
        if (response.status === 409) mappedStatus = 409;
        else if (response.status === 429) mappedStatus = 429;
        else if (response.status >= 400 && response.status < 500) mappedStatus = 422;
        const gatewayError = new SmsGatewayError(
            account.management_mode === 'managed'
                ? 'رفضت خدمة SMS المُدارة الطلب'
                : (payload.error?.message || 'رفض حساب SMS الطلب'),
            mappedStatus,
            payload.error?.code || 'SMS_GATEWAY_REJECTED',
            { gateway_status: response.status },
        );
        gatewayError.internalMessage = `SMS Gateway ${account.base_url} returned ${response.status}: ${payload.error?.message || 'request rejected'}`;
        gatewayError.deliveryUncertain = method !== 'GET'
            && gatewayError.code !== 'send_failed'
            && (response.status >= 500 || gatewayError.code === 'request_in_progress');
        throw gatewayError;
    }
    if (method !== 'GET' && (payload.success !== true || !payload.data || typeof payload.data !== 'object')) {
        const gatewayError = new SmsGatewayError(
            'أعاد حساب SMS تأكيدًا غير صالح',
            502,
            'SMS_GATEWAY_INVALID_RESPONSE',
        );
        gatewayError.deliveryUncertain = true;
        throw gatewayError;
    }
    return payload;
};

const gatewayJson = async (account, path, {
    method = 'GET',
    body,
    idempotencyKey,
    authenticated = true,
} = {}) => {
    const apiKey = authenticated ? decrypt(account.api_key_encrypted) : null;
    if (authenticated && !apiKey) {
        throw new SmsGatewayError('تعذر فك مفتاح حساب SMS', 503, 'SMS_GATEWAY_CREDENTIALS_INVALID');
    }
    const encodedBody = body === undefined ? undefined : JSON.stringify(body);
    let response;
    try {
        response = await safeOutboundFetch(endpointUrl(account.base_url, path), {
            method,
            headers: {
                Accept: 'application/json',
                ...(encodedBody === undefined ? {} : { 'Content-Type': 'application/json' }),
                ...(apiKey ? { 'X-API-Key': apiKey } : {}),
                ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
            },
            body: encodedBody,
            timeoutMs: 15_000,
            readBody: true,
            maxResponseBytes: 1024 * 1024,
            allowedPrivateHostnames: privateGatewayHostnames(),
        });
    } catch (error) {
        const gatewayError = new SmsGatewayError(
            account.management_mode === 'managed'
                ? 'تعذر الاتصال بخدمة SMS المُدارة'
                : `تعذر الاتصال بحساب SMS: ${error.message}`,
            502,
            'SMS_GATEWAY_UNAVAILABLE',
        );
        gatewayError.internalMessage = `SMS Gateway request failed for ${account.base_url}: ${error.message}`;
        gatewayError.deliveryUncertain = method !== 'GET' && error.code !== 'UNSAFE_OUTBOUND_URL';
        throw gatewayError;
    }
    return parseGatewayJsonResponse(account, response, method);
};

export class SmsGatewayService {
    constructor({
        database,
        gatewayRequest = gatewayJson,
        outboundUrlValidator = validateOutboundUrl,
        historyMessageHandler = async () => undefined,
        webhookCallbackEnqueuer = null,
        messageBillingReconciler = null,
        ussdBillingReconciler = null,
    }) {
        if (!database) throw new TypeError('SmsGatewayService requires database');
        if (typeof gatewayRequest !== 'function') {
            throw new TypeError('SmsGatewayService gatewayRequest must be a function');
        }
        if (typeof outboundUrlValidator !== 'function') {
            throw new TypeError('SmsGatewayService outboundUrlValidator must be a function');
        }
        if (typeof historyMessageHandler !== 'function') {
            throw new TypeError('SmsGatewayService historyMessageHandler must be a function');
        }
        if (webhookCallbackEnqueuer !== null && typeof webhookCallbackEnqueuer !== 'function') {
            throw new TypeError('SmsGatewayService webhookCallbackEnqueuer must be a function');
        }
        if (messageBillingReconciler !== null && typeof messageBillingReconciler !== 'function') {
            throw new TypeError('SmsGatewayService messageBillingReconciler must be a function');
        }
        if (ussdBillingReconciler !== null && typeof ussdBillingReconciler !== 'function') {
            throw new TypeError('SmsGatewayService ussdBillingReconciler must be a function');
        }
        this.db = database;
        this.gatewayRequest = gatewayRequest;
        this.outboundUrlValidator = outboundUrlValidator;
        this.historyMessageHandler = historyMessageHandler;
        this.webhookCallbackEnqueuer = webhookCallbackEnqueuer;
        this.messageBillingReconciler = messageBillingReconciler;
        this.ussdBillingReconciler = ussdBillingReconciler;
    }

    listAccounts(tenantId) {
        return this.db.prepare(`
            SELECT * FROM sms_gateway_accounts
            WHERE tenant_id = ?
            ORDER BY is_default DESC, name COLLATE NOCASE, id
        `).all(tenantId);
    }

    getAccount(tenantId, accountId) {
        const id = Number(accountId);
        if (!Number.isSafeInteger(id) || id <= 0) return null;
        return this.db.prepare(`
            SELECT * FROM sms_gateway_accounts WHERE id = ? AND tenant_id = ?
        `).get(id, tenantId) || null;
    }

    defaultAccount(tenantId) {
        return this.db.prepare(`
            SELECT * FROM sms_gateway_accounts
            WHERE tenant_id = ? AND enabled = 1
            ORDER BY is_default DESC, id ASC LIMIT 1
        `).get(tenantId) || null;
    }

    presentAccount(account, { includeTechnical = true } = {}) {
        const managed = account.management_mode === 'managed';
        return {
            id: account.id,
            name: account.name,
            enabled: Boolean(account.enabled),
            is_default: Boolean(account.is_default),
            status: account.status,
            ...(!managed && includeTechnical ? { base_url: account.base_url } : {}),
            management_mode: managed ? 'managed' : 'manual',
            managed,
            provisioned_at: managed ? account.provisioned_at : null,
            history_sync: {
                last_at: account.last_history_sync_at || null,
                complete: Boolean(account.history_backfill_complete),
                error: account.last_history_error
                    ? 'SMS_HISTORY_SYNC_FAILED'
                    : null,
            },
            last_health_at: account.last_health_at,
            last_error: account.last_error
                ? 'SMS_ACCOUNT_REQUIRES_SUPPORT'
                : null,
            created_at: account.created_at,
            updated_at: account.updated_at,
        };
    }

    presentMessage(message, { includeTechnical = false } = {}) {
        const { sms_account_management_mode: _managementMode, ...presented } = message;
        if (!includeTechnical) {
            delete presented.device_id;
            delete presented.sim_slot;
            if (presented.error_code !== null && presented.error_code !== undefined) {
                presented.error_code = tenantSafeCode(
                    presented.error_code,
                    'SMS_DELIVERY_FAILED',
                );
            }
            if (presented.result_code !== null && presented.result_code !== undefined) {
                presented.result_code = tenantSafeCode(
                    presented.result_code,
                    'SMS_DELIVERY_STATUS',
                );
            }
            if (presented.error_message) {
                presented.error_message = 'تعذر تنفيذ الرسالة عبر خدمة SMS';
            }
        }
        return presented;
    }

    presentUssd(request, { includeTechnical = false } = {}) {
        const { sms_account_management_mode: _managementMode, ...presented } = request;
        if (!includeTechnical) {
            delete presented.device_id;
            delete presented.sim_slot;
            if (presented.error_code !== null && presented.error_code !== undefined) {
                presented.error_code = tenantSafeCode(
                    presented.error_code,
                    'USSD_EXECUTION_FAILED',
                );
            }
            if (presented.result_code !== null && presented.result_code !== undefined) {
                presented.result_code = tenantSafeCode(
                    presented.result_code,
                    'USSD_EXECUTION_STATUS',
                );
            }
            if (presented.error_message) {
                presented.error_message = 'تعذر تنفيذ طلب USSD';
            }
        }
        return presented;
    }

    async configure(tenantId, payload = {}, accountId = null, internal = {}) {
        const tenant = this.db.prepare('SELECT id, status FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) throw new SmsGatewayError('العميل غير موجود', 404, 'TENANT_NOT_FOUND');
        if (tenant.status === 'Suspended') {
            throw new SmsGatewayError('الحساب موقوف', 403, 'TENANT_SUSPENDED');
        }
        const existing = accountId == null ? null : this.getAccount(tenantId, accountId);
        if (accountId != null && !existing) {
            throw new SmsGatewayError('حساب SMS غير موجود', 404, 'SMS_ACCOUNT_NOT_FOUND');
        }
        const managedOperation = internal.managementMode === 'managed';
        if (existing?.management_mode === 'managed' && !managedOperation) {
            throw new SmsGatewayError(
                'تتم إدارة حساب SMS هذا بواسطة الإدارة',
                403,
                'SMS_ACCOUNT_MANAGED',
            );
        }
        const managementMode = managedOperation ? 'managed' : (existing?.management_mode || 'manual');
        const assignmentId = managedOperation
            ? String(internal.assignmentId || '').trim()
            : (existing?.gateway_assignment_id || null);
        if (managedOperation && !ASSIGNMENT_PATTERN.test(assignmentId)) {
            throw new SmsGatewayError('معرف ربط SMS غير صالح', 422, 'SMS_ASSIGNMENT_INVALID');
        }
        const managedResources = managedOperation
            ? normalizeManagedResources(internal.managedResources)
            : parseJson(existing?.managed_resources_json, {});
        const name = String(payload.name ?? existing?.name ?? '').trim();
        if (!name || name.length > 80) {
            throw new SmsGatewayError('اسم حساب SMS مطلوب وبحد أقصى 80 حرفًا', 400, 'SMS_ACCOUNT_NAME_REQUIRED');
        }
        const requestedBase = String(payload.base_url ?? existing?.base_url ?? '').trim().replace(/\/+$/, '');
        if (!requestedBase) {
            throw new SmsGatewayError('رابط بوابة SMS مطلوب', 400, 'SMS_GATEWAY_URL_REQUIRED');
        }
        const normalizedBase = (await this.outboundUrlValidator(
            `${requestedBase}/services/v1/health.php`,
            { allowedPrivateHostnames: privateGatewayHostnames() }
        ))
            .replace(/\/services\/v1\/health\.php\/?$/, '');
        const baseChanged = Boolean(existing && existing.base_url !== normalizedBase);
        const plainApiKey = String(payload.api_key || '').trim();
        const apiKeyEncrypted = plainApiKey ? encrypt(plainApiKey) : existing?.api_key_encrypted;
        if (!apiKeyEncrypted) {
            throw new SmsGatewayError('مفتاح API لحساب SMS مطلوب', 400, 'SMS_GATEWAY_API_KEY_REQUIRED');
        }
        const effectiveApiKey = plainApiKey || decrypt(existing?.api_key_encrypted);
        if (!effectiveApiKey) {
            throw new SmsGatewayError('تعذر قراءة مفتاح API لحساب SMS', 500, 'SMS_GATEWAY_CREDENTIALS_INVALID');
        }
        const credentialFingerprint = crypto.createHmac('sha256', process.env.CRYPTO_KEY)
            .update(`${normalizedBase}\u0000${effectiveApiKey}`)
            .digest('hex');
        const defaultDevices = payload.default_devices ?? parseJson(existing?.default_devices_json, []);
        if (!Array.isArray(defaultDevices) || defaultDevices.length > 20) {
            throw new SmsGatewayError('إعدادات توجيه SMS غير صالحة', 400, 'INVALID_SMS_DEVICES');
        }
        const normalizedDevices = [...new Set(defaultDevices.map(value => String(value).trim()).filter(Boolean))];
        if (normalizedDevices.some(value => !/^\d+$/.test(value))) {
            throw new SmsGatewayError('إعدادات توجيه SMS غير صالحة', 400, 'INVALID_SMS_DEVICES');
        }
        const defaultSimSlot = payload.default_sim_slot === undefined
            ? (existing?.default_sim_slot ?? null)
            : (payload.default_sim_slot === null || payload.default_sim_slot === ''
                ? null
                : Number(payload.default_sim_slot));
        if (defaultSimSlot !== null && (!Number.isInteger(defaultSimSlot) || defaultSimSlot < 0)) {
            throw new SmsGatewayError('إعدادات توجيه SMS غير صالحة', 400, 'INVALID_SMS_SIM_SLOT');
        }
        if (defaultSimSlot !== null && normalizedDevices.length !== 1) {
            throw new SmsGatewayError(
                'إعدادات توجيه SMS غير صالحة',
                400,
                'INVALID_SMS_SIM_SLOT',
            );
        }
        const webhookKey = existing?.webhook_key || crypto.randomUUID();
        const webhookSecret = existing?.webhook_secret_encrypted
            ? decrypt(existing.webhook_secret_encrypted)
            : crypto.randomBytes(32).toString('hex');
        if (!webhookSecret) {
            throw new SmsGatewayError('تعذر تجهيز سر Webhook', 500, 'SMS_WEBHOOK_SECRET_INVALID');
        }
        const enabled = payload.enabled === undefined ? (existing ? Boolean(existing.enabled) : true) : Boolean(payload.enabled);
        const accountCount = this.db.prepare(
            'SELECT COUNT(*) AS count FROM sms_gateway_accounts WHERE tenant_id = ?'
        ).get(tenantId).count;
        const requestedDefault = payload.is_default === undefined
            ? (existing ? Boolean(existing.is_default) : accountCount === 0)
            : Boolean(payload.is_default);
        if (!enabled && requestedDefault) {
            throw new SmsGatewayError(
                'لا يمكن تعيين حساب SMS معطّل كحساب افتراضي',
                422,
                'SMS_DEFAULT_ACCOUNT_DISABLED',
            );
        }
        const isDefault = enabled && requestedDefault;
        const previousDefaultIds = managedOperation
            ? this.db.prepare(`
                SELECT id FROM sms_gateway_accounts
                WHERE tenant_id = ? AND is_default = 1
            `).all(tenantId).map(row => row.id)
            : [];
        const webhookCallbackUrl = enabled ? callbackUrlFor(webhookKey) : null;
        const data = {
            name,
            base_url: normalizedBase,
            api_key_encrypted: apiKeyEncrypted,
            credential_fingerprint: credentialFingerprint,
            webhook_secret_encrypted: existing?.webhook_secret_encrypted || encrypt(webhookSecret),
            webhook_key: webhookKey,
            default_devices_json: JSON.stringify(normalizedDevices),
            default_sim_slot: defaultSimSlot,
            enabled: enabled ? 1 : 0,
            is_default: isDefault ? 1 : 0,
            status: enabled ? 'pending' : 'disabled',
            management_mode: managementMode,
            gateway_assignment_id: assignmentId,
            managed_resources_json: JSON.stringify(managedResources),
            provisioned_at: managedOperation
                ? (existing?.provisioned_at || new Date().toISOString())
                : (existing?.provisioned_at || null),
            revoked_at: enabled ? null : (existing?.revoked_at || null),
            last_health_at: existing?.last_health_at || null,
        };
        const candidateAccount = {
            ...(existing || {}),
            ...data,
            id: existing?.id || null,
            tenant_id: tenantId,
        };
        const rollbackManagedPreflight = async () => {
            if (!managedOperation || !enabled) return;
            if (!existing || baseChanged) {
                try {
                    await this.gatewayRequest(candidateAccount, 'services/v1/webhook.php', {
                        method: 'PUT',
                        body: {
                            callback_url: webhookCallbackUrl,
                            webhook_secret: webhookSecret,
                            enabled: false,
                        },
                    });
                } catch (disableError) {
                    console.warn('[SmsGateway] Provisioning preflight cleanup failed:', disableError.message);
                }
            }
            if (existing) {
                try {
                    const previousSecret = decrypt(existing.webhook_secret_encrypted);
                    await this.gatewayRequest(existing, 'services/v1/webhook.php', {
                        method: 'PUT',
                        body: {
                            callback_url: callbackUrlFor(existing.webhook_key),
                            webhook_secret: previousSecret,
                            enabled: Boolean(existing.enabled),
                        },
                    });
                } catch (restoreError) {
                    console.warn('[SmsGateway] Provisioning preflight restore failed:', restoreError.message);
                }
            }
        };

        // Managed provisioning originates inside SMS Gateway. Complete the remote
        // webhook/health preflight before changing the tenant-visible account or
        // its default selection, so a timeout or crash cannot expose a pending
        // credential and interrupt the tenant's current default account.
        if (managedOperation && enabled) {
            try {
                await this.gatewayRequest(candidateAccount, 'services/v1/webhook.php', {
                    method: 'PUT',
                    body: {
                        callback_url: webhookCallbackUrl,
                        webhook_secret: webhookSecret,
                        enabled: true,
                    },
                });
                const healthResult = await this.gatewayRequest(
                    candidateAccount,
                    'services/v1/health.php',
                );
                if (healthResult.status !== 'ok') throw new Error('Gateway is not healthy');
                data.status = 'active';
                data.last_health_at = new Date().toISOString();
            } catch (error) {
                await rollbackManagedPreflight();
                throw error;
            }
        }
        let savedId;
        try {
            const save = this.db.transaction(() => {
                if (isDefault) {
                    this.db.prepare(`
                        UPDATE sms_gateway_accounts SET is_default = 0
                        WHERE tenant_id = ? AND id != ?
                    `).run(tenantId, existing?.id || 0);
                }
                if (existing) {
                    this.db.prepare(`
                        UPDATE sms_gateway_accounts SET
                            name = @name, base_url = @base_url,
                            api_key_encrypted = @api_key_encrypted,
                            credential_fingerprint = @credential_fingerprint,
                            webhook_secret_encrypted = @webhook_secret_encrypted,
                            webhook_key = @webhook_key,
                            default_devices_json = @default_devices_json,
                            default_sim_slot = @default_sim_slot,
                            enabled = @enabled, is_default = @is_default,
                            status = @status, last_error = NULL,
                            management_mode = @management_mode,
                            gateway_assignment_id = @gateway_assignment_id,
                            managed_resources_json = @managed_resources_json,
                            provisioned_at = @provisioned_at,
                            revoked_at = @revoked_at,
                            last_health_at = @last_health_at,
                            updated_at = datetime('now', 'localtime')
                        WHERE id = @id AND tenant_id = @tenant_id
                    `).run({ ...data, id: existing.id, tenant_id: tenantId });
                    savedId = existing.id;
                } else {
                    savedId = Number(this.db.prepare(`
                        INSERT INTO sms_gateway_accounts (
                            tenant_id, name, base_url, api_key_encrypted,
                            credential_fingerprint,
                            webhook_secret_encrypted, webhook_key, default_devices_json,
                            default_sim_slot, enabled, is_default, status,
                            management_mode, gateway_assignment_id,
                            managed_resources_json, provisioned_at, revoked_at,
                            last_health_at
                        ) VALUES (
                            @tenant_id, @name, @base_url, @api_key_encrypted,
                            @credential_fingerprint,
                            @webhook_secret_encrypted, @webhook_key, @default_devices_json,
                            @default_sim_slot, @enabled, @is_default, @status,
                            @management_mode, @gateway_assignment_id,
                            @managed_resources_json, @provisioned_at, @revoked_at,
                            @last_health_at
                        )
                    `).run({ ...data, tenant_id: tenantId }).lastInsertRowid);
                }
                const currentDefault = this.db.prepare(`
                    SELECT id FROM sms_gateway_accounts
                    WHERE tenant_id = ? AND enabled = 1 AND is_default = 1 LIMIT 1
                `).get(tenantId);
                if (!currentDefault) {
                    const replacement = this.db.prepare(`
                        SELECT id FROM sms_gateway_accounts
                        WHERE tenant_id = ? AND enabled = 1
                        ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, id LIMIT 1
                    `).get(tenantId);
                    if (replacement) {
                        this.db.prepare('UPDATE sms_gateway_accounts SET is_default = 1 WHERE id = ?')
                            .run(replacement.id);
                    }
                }
                return savedId;
            });
            savedId = save.immediate();
        } catch (error) {
            await rollbackManagedPreflight();
            if (String(error.message).includes('UNIQUE')) {
                if (String(error.message).includes('credential_fingerprint')) {
                    throw new SmsGatewayError(
                        'حساب SMS هذا مرتبط مسبقًا بحساب Wa',
                        409,
                        'SMS_ACCOUNT_CREDENTIAL_CONFLICT',
                    );
                }
                if (String(error.message).includes('gateway_assignment_id')) {
                    throw new SmsGatewayError(
                        'معرف ربط SMS مستخدم مسبقًا',
                        409,
                        'SMS_ASSIGNMENT_CONFLICT',
                    );
                }
                throw new SmsGatewayError('اسم حساب SMS مستخدم مسبقًا', 409, 'SMS_ACCOUNT_NAME_CONFLICT');
            }
            throw error;
        }
        let account = this.getAccount(tenantId, savedId);
        if (!enabled) {
            try {
                await this.gatewayRequest(account, 'services/v1/webhook.php', {
                    method: 'PUT',
                    body: {
                        callback_url: callbackUrlFor(webhookKey),
                        webhook_secret: webhookSecret,
                        enabled: false,
                    },
                });
            } catch (error) {
                console.warn('[SmsGateway] Remote webhook disable failed:', error.message);
            }
            return this.presentAccount(this.getAccount(tenantId, savedId));
        }
        try {
            if (!managedOperation) {
                await this.gatewayRequest(account, 'services/v1/webhook.php', {
                    method: 'PUT',
                    body: {
                        callback_url: webhookCallbackUrl,
                        webhook_secret: webhookSecret,
                        enabled: true,
                    },
                });
                await this.health(tenantId, savedId);
            } else if (existing && baseChanged) {
                const previousSecret = decrypt(existing.webhook_secret_encrypted);
                await this.gatewayRequest(existing, 'services/v1/webhook.php', {
                    method: 'PUT',
                    body: {
                        callback_url: callbackUrlFor(existing.webhook_key),
                        webhook_secret: previousSecret,
                        enabled: false,
                    },
                });
            }
        } catch (error) {
            if (managedOperation) {
                if (!existing || baseChanged) {
                    try {
                        await this.gatewayRequest(account, 'services/v1/webhook.php', {
                            method: 'PUT',
                            body: {
                                callback_url: webhookCallbackUrl,
                                webhook_secret: webhookSecret,
                                enabled: false,
                            },
                        });
                    } catch (disableError) {
                        console.warn('[SmsGateway] Provisioning rollback new webhook disable failed:', disableError.message);
                    }
                }
                const restore = this.db.transaction(() => {
                    if (existing) {
                        this.db.prepare(`
                            UPDATE sms_gateway_accounts SET
                                name = @name,
                                base_url = @base_url,
                                api_key_encrypted = @api_key_encrypted,
                                credential_fingerprint = @credential_fingerprint,
                                webhook_secret_encrypted = @webhook_secret_encrypted,
                                webhook_key = @webhook_key,
                                default_devices_json = @default_devices_json,
                                default_sim_slot = @default_sim_slot,
                                enabled = @enabled,
                                is_default = 0,
                                status = @status,
                                last_health_at = @last_health_at,
                                last_error = @last_error,
                                management_mode = @management_mode,
                                gateway_assignment_id = @gateway_assignment_id,
                                managed_resources_json = @managed_resources_json,
                                provisioned_at = @provisioned_at,
                                revoked_at = @revoked_at,
                                updated_at = datetime('now', 'localtime')
                            WHERE id = @id AND tenant_id = @tenant_id
                        `).run({ ...existing, tenant_id: tenantId });
                    } else {
                        this.db.prepare(`
                            DELETE FROM sms_gateway_accounts
                            WHERE id = ? AND tenant_id = ?
                        `).run(savedId, tenantId);
                    }
                    this.db.prepare(`
                        UPDATE sms_gateway_accounts SET is_default = 0 WHERE tenant_id = ?
                    `).run(tenantId);
                    const restoreDefault = this.db.prepare(`
                        UPDATE sms_gateway_accounts SET is_default = 1
                        WHERE tenant_id = ? AND id = ? AND enabled = 1
                    `);
                    for (const defaultId of previousDefaultIds) {
                        restoreDefault.run(tenantId, defaultId);
                    }
                });
                restore.immediate();
                try {
                    if (existing) {
                        const rollbackSecret = decrypt(existing.webhook_secret_encrypted);
                        await this.gatewayRequest(existing, 'services/v1/webhook.php', {
                            method: 'PUT',
                            body: {
                                callback_url: callbackUrlFor(existing.webhook_key),
                                webhook_secret: rollbackSecret,
                                enabled: Boolean(existing.enabled),
                            },
                        });
                    }
                } catch (rollbackError) {
                    console.warn('[SmsGateway] Provisioning rollback webhook restore failed:', rollbackError.message);
                }
            } else {
                this.markError(savedId, error);
            }
            throw error;
        }
        account = this.getAccount(tenantId, savedId);
        return this.presentAccount(account);
    }

    async disable(tenantId, accountId, { allowManaged = false, revokedAt = null } = {}) {
        const account = this.getAccount(tenantId, accountId);
        if (!account) throw new SmsGatewayError('حساب SMS غير موجود', 404, 'SMS_ACCOUNT_NOT_FOUND');
        if (account.management_mode === 'managed' && !allowManaged) {
            throw new SmsGatewayError(
                'تتم إدارة حساب SMS هذا بواسطة الإدارة',
                403,
                'SMS_ACCOUNT_MANAGED',
            );
        }
        const secret = decrypt(account.webhook_secret_encrypted);
        try {
            await this.gatewayRequest(account, 'services/v1/webhook.php', {
                method: 'PUT',
                body: {
                    callback_url: callbackUrlFor(account.webhook_key),
                    webhook_secret: secret,
                    enabled: false,
                },
            });
        } catch (error) {
            // Local disable is authoritative; remote disable is retriable on a later update.
            console.warn('[SmsGateway] Remote webhook disable failed:', error.message);
        }
        const update = this.db.transaction(() => {
            this.db.prepare(`
                UPDATE sms_gateway_accounts SET enabled = 0, is_default = 0,
                    status = 'disabled', revoked_at = COALESCE(?, revoked_at),
                    updated_at = datetime('now', 'localtime')
                WHERE id = ? AND tenant_id = ?
            `).run(revokedAt, account.id, tenantId);
            if (account.is_default) {
                const replacement = this.db.prepare(`
                    SELECT id FROM sms_gateway_accounts
                    WHERE tenant_id = ? AND enabled = 1 AND id != ?
                    ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, id LIMIT 1
                `).get(tenantId, account.id);
                if (replacement) {
                    this.db.prepare('UPDATE sms_gateway_accounts SET is_default = 1 WHERE id = ?')
                        .run(replacement.id);
                }
            }
        });
        update.immediate();
        return this.presentAccount(this.getAccount(tenantId, account.id));
    }

    async health(tenantId, accountId) {
        const account = this.getAccount(tenantId, accountId);
        if (!account) throw new SmsGatewayError('حساب SMS غير موجود', 404, 'SMS_ACCOUNT_NOT_FOUND');
        try {
            const result = await this.gatewayRequest(account, 'services/v1/health.php');
            if (result.status !== 'ok') throw new Error('Gateway is not healthy');
            const checkedAt = new Date().toISOString();
            this.db.prepare(`
                UPDATE sms_gateway_accounts SET status = ?, last_health_at = ?, last_error = NULL,
                    updated_at = datetime('now', 'localtime') WHERE id = ? AND tenant_id = ?
            `).run(account.enabled ? 'active' : 'disabled', checkedAt, account.id, tenantId);
            return { healthy: true, account_id: account.id, checked_at: checkedAt };
        } catch (error) {
            this.markError(account.id, error, new Date().toISOString());
            throw error;
        }
    }

    async devices(tenantId, accountId) {
        const account = this.requireActiveAccount(tenantId, accountId, false);
        if (account.management_mode === 'managed') {
            throw new SmsGatewayError(
                'تتم إدارة أجهزة حساب SMS بواسطة الإدارة',
                403,
                'SMS_ACCOUNT_MANAGED',
            );
        }
        const result = await this.gatewayRequest(account, 'services/v1/devices.php');
        return result.data?.devices || [];
    }

    requireActiveAccount(tenantId, accountId = null, requireHealthy = true) {
        const account = accountId == null
            ? this.defaultAccount(tenantId)
            : this.getAccount(tenantId, accountId);
        if (!account || !account.enabled) {
            throw new SmsGatewayError('حساب SMS غير مفعّل', 409, 'SMS_ACCOUNT_DISABLED');
        }
        if (requireHealthy && account.status !== 'active') {
            throw new SmsGatewayError('حساب SMS ليس في حالة تشغيل', 503, 'SMS_ACCOUNT_INACTIVE');
        }
        return account;
    }

    async send(tenantId, {
        accountId = null,
        recipient,
        message,
        idempotencyKey,
        devices,
        simSlot,
    } = {}) {
        const account = this.requireActiveAccount(tenantId, accountId);
        if (account.management_mode === 'managed'
            && (devices !== undefined || simSlot !== undefined)) {
            throw new SmsGatewayError(
                'لا يمكن تجاوز توجيه حساب SMS المُدار',
                403,
                'SMS_MANAGED_ROUTING_OVERRIDE',
            );
        }
        const key = String(idempotencyKey || '');
        if (!IDEMPOTENCY_PATTERN.test(key)) {
            throw new SmsGatewayError('مفتاح منع التكرار غير صالح', 400, 'INVALID_IDEMPOTENCY_KEY');
        }
        const text = String(message || '').trim();
        if (!text || text.length > 5000) {
            throw new SmsGatewayError('نص SMS مطلوب وبحد أقصى 5000 حرف', 422, 'INVALID_SMS_MESSAGE');
        }
        const rawDevices = devices ?? parseJson(account.default_devices_json, []);
        if (!Array.isArray(rawDevices) || rawDevices.length > 20) {
            throw new SmsGatewayError('تعذر إرسال الرسالة بإعدادات الحساب الحالية؛ تواصل مع الدعم.', 422, 'INVALID_SMS_DEVICES');
        }
        const selectedDevices = [...new Set(rawDevices.map(value => String(value).trim()).filter(Boolean))];
        if (selectedDevices.some(value => !/^\d+$/.test(value))) {
            throw new SmsGatewayError('تعذر إرسال الرسالة بإعدادات الحساب الحالية؛ تواصل مع الدعم.', 422, 'INVALID_SMS_DEVICES');
        }
        const selectedSim = simSlot ?? account.default_sim_slot;
        if (selectedSim !== null && selectedSim !== undefined
            && (!Number.isInteger(Number(selectedSim)) || Number(selectedSim) < 0 || selectedDevices.length !== 1)) {
            throw new SmsGatewayError(
                'تعذر إرسال الرسالة بإعدادات الحساب الحالية؛ تواصل مع الدعم.',
                422,
                'INVALID_SMS_SIM_SLOT',
            );
        }
        let result;
        let lastError;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                result = await this.gatewayRequest(account, 'services/v1/messages.php', {
                    method: 'POST',
                    idempotencyKey: key,
                    body: {
                        recipient: normalizedPhone(recipient),
                        message: text,
                        devices: selectedDevices,
                        ...(selectedSim === null || selectedSim === undefined ? {} : { sim_slot: Number(selectedSim) }),
                    },
                });
                break;
            } catch (error) {
                lastError = error;
                const retryable = error.status >= 500 || error.code === 'request_in_progress';
                if (!retryable || attempt === 3) break;
                await wait(250 * (2 ** (attempt - 1)));
            }
        }
        if (!result) {
            const sendError = lastError || new SmsGatewayError(
                'فشل إرسال رسالة SMS',
                502,
                'SMS_GATEWAY_UNAVAILABLE',
            );
            if (shouldMarkAccountError(sendError)) this.markError(account.id, sendError);
            throw sendError;
        }
        return { account, message: result.data };
    }

    async sendUssd(tenantId, {
        accountId,
        request,
        deviceId,
        simSlot,
        idempotencyKey,
    } = {}) {
        const account = this.requireActiveAccount(tenantId, accountId);
        if (account.management_mode === 'managed'
            && (deviceId !== undefined || simSlot !== undefined)) {
            throw new SmsGatewayError(
                'لا يمكن تجاوز توجيه حساب SMS المُدار',
                403,
                'SMS_MANAGED_ROUTING_OVERRIDE',
            );
        }
        const key = String(idempotencyKey || '');
        if (!IDEMPOTENCY_PATTERN.test(key)) {
            throw new SmsGatewayError('مفتاح منع التكرار غير صالح', 400, 'INVALID_IDEMPOTENCY_KEY');
        }
        const requestCode = String(request || '').trim();
        if (!USSD_PATTERN.test(requestCode)) {
            throw new SmsGatewayError('رمز USSD غير صالح أو لا ينتهي بـ #', 422, 'INVALID_USSD_REQUEST');
        }
        const defaults = parseJson(account.default_devices_json, []);
        const selectedDevice = deviceId ?? (defaults.length === 1 ? defaults[0] : null);
        if (!/^\d+$/.test(String(selectedDevice || ''))) {
            throw new SmsGatewayError('تعذر تنفيذ طلب USSD بإعدادات الحساب الحالية؛ تواصل مع الدعم.', 422, 'INVALID_USSD_DEVICE');
        }
        const selectedSim = simSlot ?? account.default_sim_slot;
        if (selectedSim !== null && selectedSim !== undefined
            && (!Number.isInteger(Number(selectedSim)) || Number(selectedSim) < 0)) {
            throw new SmsGatewayError('تعذر تنفيذ طلب USSD بإعدادات الحساب الحالية؛ تواصل مع الدعم.', 422, 'INVALID_USSD_SIM_SLOT');
        }

        let result;
        let lastError;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                result = await this.gatewayRequest(account, 'services/v1/ussd.php', {
                    method: 'POST',
                    idempotencyKey: key,
                    body: {
                        request: requestCode,
                        device_id: Number(selectedDevice),
                        ...(selectedSim === null || selectedSim === undefined
                            ? {}
                            : { sim_slot: Number(selectedSim) }),
                    },
                });
                break;
            } catch (error) {
                lastError = error;
                const retryable = error.status >= 500 || error.code === 'request_in_progress';
                if (!retryable || attempt === 3) break;
                await wait(250 * (2 ** (attempt - 1)));
            }
        }
        if (!result) {
            const sendError = lastError || new SmsGatewayError(
                'فشل تنفيذ طلب USSD',
                502,
                'SMS_GATEWAY_UNAVAILABLE',
            );
            if (shouldMarkAccountError(sendError)) this.markError(account.id, sendError);
            throw sendError;
        }
        return { account, ussd: result.data };
    }

    listUssd(tenantId, { accountId = null, limit = 100 } = {}) {
        const normalizedLimit = Math.max(1, Math.min(200, Number(limit) || 100));
        const numericAccountId = accountId == null || accountId === '' ? null : Number(accountId);
        if (numericAccountId !== null && (!Number.isSafeInteger(numericAccountId) || numericAccountId <= 0)) {
            throw new SmsGatewayError('حساب SMS غير صالح', 400, 'SMS_ACCOUNT_INVALID');
        }
        return this.db.prepare(`
            SELECT request.*, account.name AS sms_account_name,
                   account.management_mode AS sms_account_management_mode
            FROM sms_ussd_requests request
            INNER JOIN sms_gateway_accounts account ON account.id = request.sms_account_id
            WHERE request.tenant_id = @tenant_id
              AND (@sms_account_id IS NULL OR request.sms_account_id = @sms_account_id)
            ORDER BY request.id DESC
            LIMIT @limit
        `).all({
            tenant_id: tenantId,
            sms_account_id: numericAccountId,
            limit: normalizedLimit,
        }).map(request => this.presentUssd(request));
    }

    storeUssd(account, data) {
        const gatewayUssdId = String(data.ussd_id || '').trim();
        if (!gatewayUssdId) {
            throw new SmsGatewayError('حدث USSD لا يحتوي ussd_id', 422, 'INVALID_USSD_EVENT');
        }
        const requestCode = String(data.request || '').trim();
        if (!USSD_PATTERN.test(requestCode)) {
            throw new SmsGatewayError('حدث USSD يحتوي رمزًا غير صالح', 422, 'INVALID_USSD_EVENT');
        }
        const deviceId = String(data.device_id || '').trim();
        if (!/^\d+$/.test(deviceId)) {
            throw new SmsGatewayError('حدث USSD لا يحتوي جهازًا صالحًا', 422, 'INVALID_USSD_EVENT');
        }
        const responseText = data.response == null ? null : String(data.response).slice(0, 10000);
        const status = responseText !== null || data.response_at ? 'completed' : 'pending';
        const values = {
            tenant_id: account.tenant_id,
            sms_account_id: account.id,
            gateway_ussd_id: gatewayUssdId,
            idempotency_key: data.external_id || null,
            request_code: requestCode,
            response_text: responseText,
            status,
            device_id: deviceId,
            sim_slot: data.sim_slot == null ? null : Number(data.sim_slot),
            sent_at: data.sent_at || null,
            response_at: data.response_at || null,
        };
        const existing = values.idempotency_key
            ? this.db.prepare(`
                SELECT id FROM sms_ussd_requests
                WHERE sms_account_id = ? AND idempotency_key = ?
            `).get(account.id, values.idempotency_key)
            : null;
        if (existing) {
            this.db.prepare(`
                UPDATE sms_ussd_requests SET
                    gateway_ussd_id = @gateway_ussd_id,
                    request_code = @request_code,
                    response_text = @response_text,
                    status = @status,
                    device_id = @device_id,
                    sim_slot = @sim_slot,
                    sent_at = @sent_at,
                    response_at = @response_at,
                    updated_at = datetime('now', 'localtime')
                WHERE id = @id AND tenant_id = @tenant_id AND sms_account_id = @sms_account_id
            `).run({ ...values, id: existing.id });
        } else {
            this.db.prepare(`
                INSERT INTO sms_ussd_requests (
                    tenant_id, sms_account_id, gateway_ussd_id, idempotency_key,
                    request_code, response_text, status, device_id, sim_slot,
                    sent_at, response_at
                ) VALUES (
                    @tenant_id, @sms_account_id, @gateway_ussd_id, @idempotency_key,
                    @request_code, @response_text, @status, @device_id, @sim_slot,
                    @sent_at, @response_at
                )
                ON CONFLICT(sms_account_id, gateway_ussd_id) DO UPDATE SET
                    idempotency_key = COALESCE(excluded.idempotency_key, sms_ussd_requests.idempotency_key),
                    request_code = excluded.request_code,
                    response_text = excluded.response_text,
                    status = excluded.status,
                    device_id = excluded.device_id,
                    sim_slot = excluded.sim_slot,
                    sent_at = excluded.sent_at,
                    response_at = excluded.response_at,
                    updated_at = datetime('now', 'localtime')
            `).run(values);
        }
        return this.db.prepare(`
            SELECT request.*, account.name AS sms_account_name
            FROM sms_ussd_requests request
            INNER JOIN sms_gateway_accounts account ON account.id = request.sms_account_id
            WHERE request.sms_account_id = ? AND request.gateway_ussd_id = ?
        `).get(account.id, gatewayUssdId);
    }

    async refreshUssd(tenantId, accountId, gatewayUssdId) {
        const account = this.requireActiveAccount(tenantId, accountId, false);
        const normalizedId = String(gatewayUssdId || '').trim();
        if (!/^\d+$/.test(normalizedId)) {
            throw new SmsGatewayError('معرف طلب USSD غير صالح', 400, 'INVALID_USSD_ID');
        }
        const result = await this.gatewayRequest(
            account,
            `services/v1/ussd.php?id=${encodeURIComponent(normalizedId)}`,
        );
        const stored = this.storeUssd(account, result.data || {});
        if (this.ussdBillingReconciler) this.ussdBillingReconciler(stored);
        return stored;
    }

    storeMessage(account, data) {
        const gatewayMessageId = String(data.message_id || '').trim();
        if (!gatewayMessageId) {
            throw new SmsGatewayError('حدث SMS لا يحتوي message_id', 422, 'INVALID_SMS_EVENT');
        }
        const direction = data.direction === 'incoming' ? 'incoming' : 'outgoing';
        const values = {
            tenant_id: account.tenant_id,
            sms_account_id: account.id,
            gateway_message_id: gatewayMessageId,
            external_id: data.external_id || null,
            group_id: data.group_id || null,
            direction,
            sender: direction === 'incoming' ? normalizedSender(data.sender) : null,
            recipient: direction === 'outgoing' ? normalizedPhone(data.recipient) : null,
            content: String(data.message || ''),
            status: String(data.status || 'pending').toLowerCase(),
            device_id: data.device_id == null ? null : String(data.device_id),
            sim_slot: data.sim_slot == null ? null : Number(data.sim_slot),
            result_code: data.result_code == null ? null : String(data.result_code),
            error_code: data.error_code == null ? null : String(data.error_code),
            error_message: data.error_message == null ? null : String(data.error_message).slice(0, 2000),
            sent_at: data.sent_at || null,
            delivered_at: data.delivered_at || null,
        };
        const existing = values.external_id
            ? this.db.prepare(`
                SELECT * FROM sms_messages WHERE sms_account_id = ? AND external_id = ?
            `).get(account.id, values.external_id)
            : this.db.prepare(`
                SELECT * FROM sms_messages WHERE sms_account_id = ? AND gateway_message_id = ?
            `).get(account.id, gatewayMessageId);
        if (existing) {
            const mergedStatus = mergeSmsStatus(existing.status, values.status);
            const preserveTerminal = TERMINAL_SMS_STATUSES.has(String(existing.status).toLowerCase())
                && mergedStatus === existing.status;
            values.status = mergedStatus;
            values.delivered_at = values.delivered_at || existing.delivered_at;
            if (preserveTerminal) {
                values.result_code = existing.result_code;
                values.error_code = existing.error_code;
                values.error_message = existing.error_message;
            }
            this.db.prepare(`
                UPDATE sms_messages SET
                    gateway_message_id = @gateway_message_id, group_id = @group_id,
                    direction = @direction, sender = @sender, recipient = @recipient,
                    content = @content, status = @status, device_id = @device_id,
                    sim_slot = @sim_slot, result_code = @result_code, error_code = @error_code,
                    error_message = @error_message,
                    sent_at = @sent_at, delivered_at = @delivered_at,
                    updated_at = datetime('now', 'localtime')
                WHERE id = @id AND tenant_id = @tenant_id AND sms_account_id = @sms_account_id
            `).run({ ...values, id: existing.id });
        } else {
            this.db.prepare(`
                INSERT INTO sms_messages (
                    tenant_id, sms_account_id, gateway_message_id, external_id, group_id,
                    direction, sender, recipient, content, status, device_id, sim_slot,
                    result_code, error_code, error_message, sent_at, delivered_at
                ) VALUES (
                    @tenant_id, @sms_account_id, @gateway_message_id, @external_id, @group_id,
                    @direction, @sender, @recipient, @content, @status, @device_id, @sim_slot,
                    @result_code, @error_code, @error_message, @sent_at, @delivered_at
                )
                ON CONFLICT(sms_account_id, gateway_message_id) DO UPDATE SET
                    external_id = COALESCE(excluded.external_id, sms_messages.external_id),
                    group_id = excluded.group_id,
                    direction = excluded.direction,
                    sender = excluded.sender,
                    recipient = excluded.recipient,
                    content = excluded.content,
                    status = excluded.status,
                    device_id = excluded.device_id,
                    sim_slot = excluded.sim_slot,
                    result_code = excluded.result_code,
                    error_code = excluded.error_code,
                    error_message = excluded.error_message,
                    sent_at = excluded.sent_at,
                    delivered_at = excluded.delivered_at,
                    updated_at = datetime('now', 'localtime')
            `).run(values);
        }
        return this.db.prepare(`
            SELECT message.*, account.name AS sms_account_name
            FROM sms_messages message
            LEFT JOIN sms_gateway_accounts account ON account.id = message.sms_account_id
            WHERE message.sms_account_id = ? AND message.gateway_message_id = ?
        `).get(account.id, gatewayMessageId);
    }

    acceptWebhook(webhookKey, headers, rawBody) {
        const account = this.db.prepare(`
            SELECT * FROM sms_gateway_accounts WHERE webhook_key = ? AND enabled = 1
        `).get(String(webhookKey || ''));
        if (!account) throw new SmsGatewayError('Webhook غير معروف', 404, 'SMS_WEBHOOK_NOT_FOUND');
        const timestamp = String(headers.timestamp || '');
        const deliveryId = String(headers.deliveryId || '');
        const signature = String(headers.signature || '');
        if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
            throw new SmsGatewayError('توقيت Webhook غير صالح', 401, 'SMS_WEBHOOK_EXPIRED');
        }
        if (!/^[0-9a-f-]{36}$/i.test(deliveryId)) {
            throw new SmsGatewayError('معرف تسليم Webhook غير صالح', 401, 'SMS_WEBHOOK_INVALID');
        }
        const secret = decrypt(account.webhook_secret_encrypted);
        if (!secret) throw new SmsGatewayError('سر Webhook غير متاح', 503, 'SMS_WEBHOOK_SECRET_INVALID');
        const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''));
        const expected = `v1=${crypto.createHmac('sha256', secret)
            .update(`${timestamp}.${deliveryId}.`)
            .update(body)
            .digest('hex')}`;
        const left = Buffer.from(signature);
        const right = Buffer.from(expected);
        if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
            throw new SmsGatewayError('توقيع Webhook غير صالح', 401, 'SMS_WEBHOOK_SIGNATURE_INVALID');
        }
        let envelope;
        try {
            envelope = JSON.parse(body.toString('utf8'));
        } catch {
            throw new SmsGatewayError('محتوى Webhook غير صالح', 400, 'SMS_WEBHOOK_INVALID_JSON');
        }
        if (envelope.delivery_id !== deliveryId || ![
            'sms.message.received.v1',
            'sms.message.status_changed.v1',
            'ussd.response.v1',
        ].includes(envelope.event)) {
            throw new SmsGatewayError('نوع حدث SMS غير مدعوم', 422, 'SMS_WEBHOOK_EVENT_UNSUPPORTED');
        }
        const process = this.db.transaction(() => {
            const duplicate = this.db.prepare(`
                SELECT delivery_id FROM sms_webhook_deliveries WHERE delivery_id = ?
            `).get(deliveryId);
            if (duplicate) return { duplicate: true, message: null };
            this.db.prepare(`
                INSERT INTO sms_webhook_deliveries (
                    delivery_id, tenant_id, sms_account_id, event_type
                ) VALUES (?, ?, ?, ?)
            `).run(deliveryId, account.tenant_id, account.id, envelope.event);
            if (envelope.event === 'ussd.response.v1') {
                const ussd = this.storeUssd(account, envelope.data || {});
                if (this.ussdBillingReconciler) this.ussdBillingReconciler(ussd);
                return { duplicate: false, message: null, ussd };
            }
            const message = this.storeMessage(account, envelope.data || {});
            if (this.messageBillingReconciler) this.messageBillingReconciler(message);
            let callbackHandled = false;
            if (this.webhookCallbackEnqueuer) {
                const tenantMessage = this.presentMessage(message, { account });
                const callbackResult = this.webhookCallbackEnqueuer({
                    tenantId: account.tenant_id,
                    event: envelope.event === 'sms.message.received.v1'
                        ? 'sms_message_received'
                        : 'sms_message_status_changed',
                    message: tenantMessage,
                    deliveryId,
                });
                if (callbackResult && typeof callbackResult.then === 'function') {
                    throw new TypeError('SMS webhook callback enqueue must be synchronous');
                }
                callbackHandled = true;
            }
            return { duplicate: false, message, ussd: null, callbackHandled };
        });
        return {
            tenantId: account.tenant_id,
            accountId: account.id,
            event: envelope.event,
            ...process.immediate(),
        };
    }

    resolveProvisioningTenant(payload = {}) {
        const rawTenantId = payload.tenant_id;
        const tenantId = rawTenantId == null || rawTenantId === '' ? null : Number(rawTenantId);
        if (tenantId !== null && (!Number.isSafeInteger(tenantId) || tenantId <= 0)) {
            throw new SmsGatewayError('معرف عميل Wa غير صالح', 422, 'TENANT_REFERENCE_INVALID');
        }
        const tenantEmail = String(payload.tenant_email || '').trim().toLowerCase();
        if (!tenantId && !tenantEmail) {
            throw new SmsGatewayError(
                'tenant_id أو tenant_email مطلوب لربط حساب SMS',
                422,
                'TENANT_REFERENCE_REQUIRED',
            );
        }
        const byId = tenantId
            ? this.db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId)
            : null;
        const byEmailMatches = tenantEmail
            ? this.db.prepare(`
                SELECT DISTINCT tenant.*
                FROM users user
                INNER JOIN tenants tenant ON tenant.id = user.tenant_id
                WHERE lower(user.email) = ? AND user.is_active = 1
                ORDER BY tenant.id
                LIMIT 2
            `).all(tenantEmail)
            : [];
        if (byEmailMatches.length > 1) {
            throw new SmsGatewayError(
                'البريد الإلكتروني غير فريد بين حسابات Wa',
                409,
                'TENANT_REFERENCE_AMBIGUOUS',
            );
        }
        const byEmail = byEmailMatches[0] || null;
        if ((tenantId && !byId) || (tenantEmail && !byEmail)) {
            throw new SmsGatewayError('تعذر العثور على حساب Wa', 404, 'TENANT_NOT_FOUND');
        }
        if (byId && byEmail && byId.id !== byEmail.id) {
            throw new SmsGatewayError(
                'معرف العميل والبريد يشيران إلى حسابين مختلفين',
                409,
                'TENANT_REFERENCE_CONFLICT',
            );
        }
        return byId || byEmail;
    }

    recordManagementAudit({
        tenantId = null,
        accountId = null,
        assignmentId,
        action,
        status,
        details = {},
        errorCode = null,
    }) {
        this.db.prepare(`
            INSERT INTO sms_gateway_management_audit (
                tenant_id, sms_account_id, assignment_id, action,
                status, details_json, error_code
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            tenantId,
            accountId,
            assignmentId,
            action,
            status,
            JSON.stringify(details),
            errorCode,
        );
    }

    async provisionManaged(payload = {}) {
        const action = String(payload.action || '').trim().toLowerCase();
        const assignmentId = String(payload.assignment_id || '').trim();
        if (!['upsert', 'revoke'].includes(action)) {
            throw new SmsGatewayError('إجراء الربط غير مدعوم', 422, 'SMS_PROVISION_ACTION_INVALID');
        }
        if (!ASSIGNMENT_PATTERN.test(assignmentId)) {
            throw new SmsGatewayError('معرف ربط SMS غير صالح', 422, 'SMS_ASSIGNMENT_INVALID');
        }
        const existingAssignment = this.db.prepare(`
            SELECT * FROM sms_gateway_accounts WHERE gateway_assignment_id = ?
        `).get(assignmentId) || null;

        if (action === 'revoke') {
            if (!existingAssignment) {
                this.recordManagementAudit({
                    assignmentId,
                    action,
                    status: 'success',
                    details: { already_absent: true },
                });
                return { success: true, action, assignment_id: assignmentId, revoked: true };
            }
            try {
                const account = await this.disable(
                    existingAssignment.tenant_id,
                    existingAssignment.id,
                    { allowManaged: true, revokedAt: new Date().toISOString() },
                );
                this.recordManagementAudit({
                    tenantId: existingAssignment.tenant_id,
                    accountId: existingAssignment.id,
                    assignmentId,
                    action,
                    status: 'success',
                });
                return {
                    success: true,
                    action,
                    assignment_id: assignmentId,
                    revoked: true,
                    account,
                };
            } catch (error) {
                this.recordManagementAudit({
                    tenantId: existingAssignment.tenant_id,
                    accountId: existingAssignment.id,
                    assignmentId,
                    action,
                    status: 'error',
                    errorCode: error.code || 'SMS_PROVISION_FAILED',
                });
                throw error;
            }
        }

        const tenant = this.resolveProvisioningTenant(payload);
        if (existingAssignment && existingAssignment.tenant_id !== tenant.id) {
            throw new SmsGatewayError(
                'لا يمكن نقل ربط SMS إلى عميل Wa آخر',
                409,
                'SMS_ASSIGNMENT_TENANT_CONFLICT',
            );
        }
        const accountInput = payload.account;
        if (!accountInput || typeof accountInput !== 'object' || Array.isArray(accountInput)) {
            throw new SmsGatewayError('بيانات حساب SMS مطلوبة', 422, 'SMS_ACCOUNT_REQUIRED');
        }
        let target = existingAssignment;
        const requestedWaAccountId = accountInput.existing_wa_account_id == null
            ? null
            : Number(accountInput.existing_wa_account_id);
        if (!target && requestedWaAccountId !== null) {
            if (!Number.isSafeInteger(requestedWaAccountId) || requestedWaAccountId <= 0) {
                throw new SmsGatewayError('معرف حساب Wa SMS غير صالح', 422, 'SMS_ACCOUNT_INVALID');
            }
            target = this.getAccount(tenant.id, requestedWaAccountId);
            if (!target || target.management_mode === 'managed') {
                throw new SmsGatewayError(
                    'حساب Wa SMS المطلوب غير متاح للتحويل',
                    409,
                    'SMS_ACCOUNT_ADOPTION_CONFLICT',
                );
            }
        }
        try {
            const account = await this.configure(tenant.id, {
                name: accountInput.name,
                base_url: accountInput.base_url,
                api_key: accountInput.api_key,
                default_devices: accountInput.default_devices,
                default_sim_slot: accountInput.default_sim_slot,
                enabled: accountInput.enabled === undefined ? true : Boolean(accountInput.enabled),
                is_default: accountInput.is_default,
            }, target?.id || null, {
                managementMode: 'managed',
                assignmentId,
                managedResources: accountInput.managed_resources,
            });
            this.recordManagementAudit({
                tenantId: tenant.id,
                accountId: account.id,
                assignmentId,
                action,
                status: 'success',
                details: {
                    tenant_reference: payload.tenant_email ? 'email' : 'id',
                    devices: Array.isArray(account.default_devices)
                        ? account.default_devices.length
                        : 0,
                    default: Boolean(account.is_default),
                },
            });
            return {
                success: true,
                action,
                assignment_id: assignmentId,
                account,
            };
        } catch (error) {
            const saved = this.db.prepare(`
                SELECT id, tenant_id FROM sms_gateway_accounts WHERE gateway_assignment_id = ?
            `).get(assignmentId);
            this.recordManagementAudit({
                tenantId: saved?.tenant_id || tenant.id,
                accountId: saved?.id || target?.id || null,
                assignmentId,
                action,
                status: 'error',
                errorCode: error.code || 'SMS_PROVISION_FAILED',
            });
            throw error;
        }
    }

    async acceptProvisioningDelivery({ deliveryId, requestHash, payload }) {
        const normalizedDeliveryId = String(deliveryId || '').trim();
        if (!DELIVERY_PATTERN.test(normalizedDeliveryId)) {
            throw new SmsGatewayError('معرف طلب الربط غير صالح', 401, 'SMS_PROVISION_DELIVERY_INVALID');
        }
        const hash = String(requestHash || '').trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(hash)) {
            throw new SmsGatewayError('بصمة طلب الربط غير صالحة', 400, 'SMS_PROVISION_REQUEST_INVALID');
        }
        const action = String(payload?.action || '').trim().toLowerCase();
        const assignmentId = String(payload?.assignment_id || '').trim();
        if (!['upsert', 'revoke'].includes(action)) {
            throw new SmsGatewayError('إجراء الربط غير مدعوم', 422, 'SMS_PROVISION_ACTION_INVALID');
        }
        if (!ASSIGNMENT_PATTERN.test(assignmentId)) {
            throw new SmsGatewayError('معرف ربط SMS غير صالح', 422, 'SMS_ASSIGNMENT_INVALID');
        }
        let claimed = false;
        try {
            this.db.prepare(`
                INSERT INTO sms_gateway_provision_deliveries (
                    delivery_id, request_hash, assignment_id, action, status
                ) VALUES (?, ?, ?, ?, 'processing')
            `).run(normalizedDeliveryId, hash, assignmentId, action);
            claimed = true;
        } catch (error) {
            if (!String(error.message).includes('UNIQUE')) throw error;
        }
        if (!claimed) {
            const previous = this.db.prepare(`
                SELECT * FROM sms_gateway_provision_deliveries WHERE delivery_id = ?
            `).get(normalizedDeliveryId);
            if (!previous || previous.request_hash !== hash) {
                throw new SmsGatewayError(
                    'أعيد استخدام معرف الطلب بمحتوى مختلف',
                    409,
                    'SMS_PROVISION_IDEMPOTENCY_CONFLICT',
                );
            }
            if (previous.status === 'complete') {
                return { ...parseJson(previous.response_json, {}), duplicate: true };
            }
            const reclaimed = this.db.prepare(`
                UPDATE sms_gateway_provision_deliveries
                SET created_at = datetime('now')
                WHERE delivery_id = ? AND request_hash = ? AND status = 'processing'
                  AND datetime(created_at) <= datetime('now', '-2 minutes')
            `).run(normalizedDeliveryId, hash);
            if (reclaimed.changes !== 1) {
                throw new SmsGatewayError(
                    'طلب الربط قيد التنفيذ',
                    409,
                    'SMS_PROVISION_IN_PROGRESS',
                );
            }
            claimed = true;
        }
        try {
            const response = await this.provisionManaged(payload);
            this.db.prepare(`
                UPDATE sms_gateway_provision_deliveries
                SET status = 'complete', response_json = ?, completed_at = ?
                WHERE delivery_id = ?
            `).run(JSON.stringify(response), new Date().toISOString(), normalizedDeliveryId);
            return { ...response, duplicate: false };
        } catch (error) {
            this.db.prepare(`
                DELETE FROM sms_gateway_provision_deliveries
                WHERE delivery_id = ? AND status = 'processing'
            `).run(normalizedDeliveryId);
            throw error;
        }
    }

    resolveStatsRange({ range = '7d', from, to } = {}) {
        const key = String(range || '7d').trim().toLowerCase();
        const today = localDateInTripoli();
        let start;
        let end;
        if (key === 'today') {
            start = today;
            end = today;
        } else if (key === '7d' || key === '30d') {
            const days = key === '7d' ? 7 : 30;
            start = addUtcDays(today, -(days - 1));
            end = today;
        } else if (key === 'custom') {
            start = String(from || '');
            end = String(to || '');
        } else {
            throw new SmsGatewayError('فترة الإحصاءات غير مدعومة', 400, 'SMS_STATS_RANGE_INVALID');
        }
        if (!DATE_PATTERN.test(start) || !DATE_PATTERN.test(end)
            || addUtcDays(start, 0) !== start || addUtcDays(end, 0) !== end) {
            throw new SmsGatewayError('تواريخ الإحصاءات غير صالحة', 400, 'SMS_STATS_DATES_INVALID');
        }
        const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
        if (days < 1 || days > 366) {
            throw new SmsGatewayError(
                'يجب أن تكون فترة الإحصاءات بين يوم و366 يومًا',
                400,
                'SMS_STATS_RANGE_TOO_LARGE',
            );
        }
        return { key, from: start, to: end, timezone: 'Africa/Tripoli' };
    }

    async syncHistory(tenantId, accountId, {
        incrementalPages = 10,
        backfillPages = 2,
        limit = 100,
    } = {}) {
        let account = this.requireActiveAccount(tenantId, accountId, false);
        const attemptedAt = new Date().toISOString();
        this.db.prepare(`
            UPDATE sms_gateway_accounts
            SET last_history_sync_attempt_at = ?
            WHERE id = ? AND tenant_id = ?
        `).run(attemptedAt, account.id, tenantId);
        const pageLimit = Math.max(1, Math.min(100, Number(limit) || 100));
        const maxIncrementalPages = Math.max(1, Math.min(50, Number(incrementalPages) || 10));
        const maxBackfillPages = Math.max(0, Math.min(20, Number(backfillPages) || 0));
        let imported = 0;
        let pages = 0;

        const importPage = async (params, phase) => {
            const response = await this.gatewayRequest(
                account,
                `services/v1/messages.php?${params.toString()}`,
            );
            const data = response.data || {};
            if (!Array.isArray(data.messages) || !data.pagination
                || typeof data.pagination !== 'object') {
                throw new SmsGatewayError(
                    'أعاد حساب SMS سجلًا غير صالح',
                    502,
                    'SMS_HISTORY_INVALID_RESPONSE',
                );
            }
            const persist = this.db.transaction(() => data.messages.map(message => {
                const gatewayMessageId = String(message.message_id || '').trim();
                const externalId = String(message.external_id || '').trim();
                const previous = externalId
                    ? this.db.prepare(`
                        SELECT * FROM sms_messages
                        WHERE sms_account_id = ? AND external_id = ?
                    `).get(account.id, externalId)
                    : this.db.prepare(`
                        SELECT * FROM sms_messages
                        WHERE sms_account_id = ? AND gateway_message_id = ?
                    `).get(account.id, gatewayMessageId);
                return { previous: previous || null, message: this.storeMessage(account, message) };
            }));
            const persisted = persist.immediate();
            for (const item of persisted) {
                await this.historyMessageHandler({
                    tenantId,
                    account,
                    message: item.message,
                    previous: item.previous,
                    phase,
                    changed: !item.previous || item.previous.status !== item.message.status,
                });
            }
            imported += data.messages.length;
            pages += 1;
            return data.pagination;
        };

        try {
            if (!account.history_cursor || Number(account.history_cursor) <= 0) {
                const params = new URLSearchParams({ limit: String(pageLimit), type: 'sms' });
                const pagination = await importPage(params, 'initial');
                const syncCursor = /^\d+$/.test(String(pagination.sync_cursor || ''))
                    && Number(pagination.sync_cursor) > 0
                    ? String(pagination.sync_cursor)
                    : null;
                const backfillCursor = /^\d+$/.test(String(pagination.next_before_id || ''))
                    ? String(pagination.next_before_id)
                    : null;
                this.db.prepare(`
                    UPDATE sms_gateway_accounts
                    SET history_cursor = ?, history_backfill_cursor = ?,
                        history_backfill_complete = ?, last_history_error = NULL
                    WHERE id = ? AND tenant_id = ?
                `).run(
                    syncCursor,
                    backfillCursor,
                    pagination.has_more && backfillCursor ? 0 : 1,
                    account.id,
                    tenantId,
                );
                account = this.getAccount(tenantId, account.id);
            } else {
                let afterId = String(account.history_cursor);
                for (let index = 0; index < maxIncrementalPages; index += 1) {
                    const params = new URLSearchParams({
                        limit: String(pageLimit),
                        type: 'sms',
                        after_id: afterId,
                    });
                    const pagination = await importPage(params, 'incremental');
                    const nextAfter = /^\d+$/.test(String(pagination.next_after_id || ''))
                        ? String(pagination.next_after_id)
                        : null;
                    const syncCursor = /^\d+$/.test(String(pagination.sync_cursor || ''))
                        ? String(pagination.sync_cursor)
                        : afterId;
                    afterId = nextAfter || syncCursor;
                    this.db.prepare(`
                        UPDATE sms_gateway_accounts SET history_cursor = ?
                        WHERE id = ? AND tenant_id = ?
                    `).run(afterId, account.id, tenantId);
                    if (!pagination.has_more || !nextAfter) break;
                }
            }

            account = this.getAccount(tenantId, account.id);
            let beforeId = account.history_backfill_cursor;
            if (!account.history_backfill_complete && beforeId && maxBackfillPages > 0) {
                for (let index = 0; index < maxBackfillPages; index += 1) {
                    const params = new URLSearchParams({
                        limit: String(pageLimit),
                        type: 'sms',
                        before_id: String(beforeId),
                    });
                    const pagination = await importPage(params, 'backfill');
                    const nextBefore = /^\d+$/.test(String(pagination.next_before_id || ''))
                        ? String(pagination.next_before_id)
                        : null;
                    const complete = !pagination.has_more || !nextBefore;
                    this.db.prepare(`
                        UPDATE sms_gateway_accounts
                        SET history_backfill_cursor = ?, history_backfill_complete = ?
                        WHERE id = ? AND tenant_id = ?
                    `).run(nextBefore, complete ? 1 : 0, account.id, tenantId);
                    beforeId = nextBefore;
                    if (complete) break;
                }
            }
            const syncedAt = new Date().toISOString();
            this.db.prepare(`
                UPDATE sms_gateway_accounts
                SET last_history_sync_at = ?, last_history_error = NULL
                WHERE id = ? AND tenant_id = ?
            `).run(syncedAt, account.id, tenantId);
            const updated = this.getAccount(tenantId, account.id);
            return {
                account_id: account.id,
                imported,
                pages,
                synced_at: syncedAt,
                backfill_complete: Boolean(updated.history_backfill_complete),
            };
        } catch (error) {
            this.db.prepare(`
                UPDATE sms_gateway_accounts SET last_history_error = ?
                WHERE id = ? AND tenant_id = ?
            `).run(String(error.message || error).slice(0, 1000), account.id, tenantId);
            throw error;
        }
    }

    async stats(tenantId, options = {}) {
        const range = this.resolveStatsRange(options);
        const requestedAccount = String(options.accountId ?? 'all').trim().toLowerCase();
        let accounts;
        if (!requestedAccount || requestedAccount === 'all') {
            accounts = this.listAccounts(tenantId).filter(account => account.enabled);
        } else {
            const account = this.getAccount(tenantId, requestedAccount);
            if (!account) {
                throw new SmsGatewayError('حساب SMS غير موجود', 404, 'SMS_ACCOUNT_NOT_FOUND');
            }
            accounts = [account];
        }
        const groupBy = 'day';
        const results = await Promise.all(accounts.map(async account => {
            if (!account.enabled) {
                return {
                    account_id: account.id,
                    name: account.name,
                    error: { code: 'SMS_ACCOUNT_DISABLED', message: 'حساب SMS معطّل' },
                };
            }
            const params = new URLSearchParams({
                range: 'custom',
                from: range.from,
                to: range.to,
                group_by: groupBy,
                type: 'sms',
            });
            try {
                const response = await this.gatewayRequest(
                    account,
                    `services/v1/statistics.php?${params.toString()}`,
                );
                const data = response.data || response;
                const series = Array.isArray(data.series) ? data.series.map(item => ({
                    date: String(item.date || '').slice(0, 10),
                    ...normalizedStats(item),
                })).filter(item => DATE_PATTERN.test(item.date)) : [];
                return {
                    account_id: account.id,
                    name: account.name,
                    summary: normalizedStats(data.summary),
                    series,
                    raw_statuses: data.raw_statuses && typeof data.raw_statuses === 'object'
                        ? data.raw_statuses
                        : {},
                };
            } catch (error) {
                return {
                    account_id: account.id,
                    name: account.name,
                    error: {
                        code: error.code || 'SMS_STATS_UNAVAILABLE',
                        message: 'تعذر تحميل إحصاءات هذا الحساب',
                    },
                };
            }
        }));
        const available = results.filter(result => result.summary);
        const summary = available.length > 0 ? available.reduce((total, result) => {
            for (const key of Object.keys(total)) total[key] += result.summary[key] || 0;
            return total;
        }, emptyStats()) : null;
        const daily = new Map();
        for (const result of available) {
            for (const item of result.series) {
                const current = daily.get(item.date) || { date: item.date, ...emptyStats() };
                for (const key of Object.keys(emptyStats())) current[key] += item[key] || 0;
                daily.set(item.date, current);
            }
        }
        return {
            range,
            summary,
            series: [...daily.values()].sort((left, right) => left.date.localeCompare(right.date)),
            accounts: results,
            partial: available.length !== results.length,
            available_accounts: available.length,
            unavailable_accounts: results.length - available.length,
        };
    }

    markError(accountId, error, checkedAt = null) {
        this.db.prepare(`
            UPDATE sms_gateway_accounts SET status = 'error', last_error = ?,
                last_health_at = COALESCE(?, last_health_at),
                updated_at = datetime('now', 'localtime') WHERE id = ?
        `).run(String(error.internalMessage || error.message).slice(0, 1000), checkedAt, accountId);
    }
}
