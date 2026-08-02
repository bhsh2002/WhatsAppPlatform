import crypto from 'node:crypto';

import { decrypt, encrypt } from './encryption.js';
import { safeOutboundFetch, validateOutboundUrl } from '../security/outboundUrl.js';

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const PHONE_PATTERN = /^\+?\d{5,20}$/;

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
        throw new SmsGatewayError('رقم الهاتف غير صالح', 422, 'INVALID_SMS_RECIPIENT');
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
        });
    } catch (error) {
        throw new SmsGatewayError(
            `تعذر الاتصال بحساب SMS: ${error.message}`,
            502,
            'SMS_GATEWAY_UNAVAILABLE',
        );
    }
    const payload = parseJson(response.body, null);
    if (!payload) {
        throw new SmsGatewayError('أعاد حساب SMS استجابة غير صالحة', 502, 'SMS_GATEWAY_INVALID_RESPONSE');
    }
    if (!response.ok) {
        let mappedStatus = 502;
        if (response.status === 409) mappedStatus = 409;
        else if (response.status === 429) mappedStatus = 429;
        else if (response.status >= 400 && response.status < 500) mappedStatus = 422;
        throw new SmsGatewayError(
            payload.error?.message || 'رفض حساب SMS الطلب',
            mappedStatus,
            payload.error?.code || 'SMS_GATEWAY_REJECTED',
            { gateway_status: response.status },
        );
    }
    return payload;
};

export class SmsGatewayService {
    constructor({ database }) {
        if (!database) throw new TypeError('SmsGatewayService requires database');
        this.db = database;
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

    presentAccount(account) {
        return {
            id: account.id,
            name: account.name,
            enabled: Boolean(account.enabled),
            is_default: Boolean(account.is_default),
            status: account.status,
            base_url: account.base_url,
            default_devices: parseJson(account.default_devices_json, []),
            default_sim_slot: account.default_sim_slot,
            last_health_at: account.last_health_at,
            last_error: account.last_error,
            created_at: account.created_at,
            updated_at: account.updated_at,
        };
    }

    async configure(tenantId, payload = {}, accountId = null) {
        const tenant = this.db.prepare('SELECT id, status FROM tenants WHERE id = ?').get(tenantId);
        if (!tenant) throw new SmsGatewayError('العميل غير موجود', 404, 'TENANT_NOT_FOUND');
        if (tenant.status === 'Suspended') {
            throw new SmsGatewayError('الحساب موقوف', 403, 'TENANT_SUSPENDED');
        }
        const existing = accountId == null ? null : this.getAccount(tenantId, accountId);
        if (accountId != null && !existing) {
            throw new SmsGatewayError('حساب SMS غير موجود', 404, 'SMS_ACCOUNT_NOT_FOUND');
        }
        const name = String(payload.name ?? existing?.name ?? '').trim();
        if (!name || name.length > 80) {
            throw new SmsGatewayError('اسم حساب SMS مطلوب وبحد أقصى 80 حرفًا', 400, 'SMS_ACCOUNT_NAME_REQUIRED');
        }
        const requestedBase = String(payload.base_url ?? existing?.base_url ?? '').trim().replace(/\/+$/, '');
        if (!requestedBase) {
            throw new SmsGatewayError('رابط بوابة SMS مطلوب', 400, 'SMS_GATEWAY_URL_REQUIRED');
        }
        const normalizedBase = (await validateOutboundUrl(`${requestedBase}/services/v1/health.php`))
            .replace(/\/services\/v1\/health\.php\/?$/, '');
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
            throw new SmsGatewayError('قائمة أجهزة SMS غير صالحة', 400, 'INVALID_SMS_DEVICES');
        }
        const normalizedDevices = [...new Set(defaultDevices.map(value => String(value).trim()).filter(Boolean))];
        if (normalizedDevices.some(value => !/^\d+$/.test(value))) {
            throw new SmsGatewayError('معرّفات أجهزة SMS يجب أن تكون أرقامًا', 400, 'INVALID_SMS_DEVICES');
        }
        const defaultSimSlot = payload.default_sim_slot === null || payload.default_sim_slot === undefined
            ? (existing?.default_sim_slot ?? null)
            : Number(payload.default_sim_slot);
        if (defaultSimSlot !== null && (!Number.isInteger(defaultSimSlot) || defaultSimSlot < 0)) {
            throw new SmsGatewayError('رقم شريحة SIM غير صالح', 400, 'INVALID_SMS_SIM_SLOT');
        }
        if (defaultSimSlot !== null && normalizedDevices.length !== 1) {
            throw new SmsGatewayError(
                'اختيار شريحة SIM يتطلب جهازًا افتراضيًا واحدًا',
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
        };
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
                            default_sim_slot, enabled, is_default, status
                        ) VALUES (
                            @tenant_id, @name, @base_url, @api_key_encrypted,
                            @credential_fingerprint,
                            @webhook_secret_encrypted, @webhook_key, @default_devices_json,
                            @default_sim_slot, @enabled, @is_default, @status
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
                        WHERE tenant_id = ? AND enabled = 1 ORDER BY id LIMIT 1
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
            if (String(error.message).includes('UNIQUE')) {
                if (String(error.message).includes('credential_fingerprint')) {
                    throw new SmsGatewayError(
                        'حساب SMS هذا مرتبط مسبقًا بحساب Wa',
                        409,
                        'SMS_ACCOUNT_CREDENTIAL_CONFLICT',
                    );
                }
                throw new SmsGatewayError('اسم حساب SMS مستخدم مسبقًا', 409, 'SMS_ACCOUNT_NAME_CONFLICT');
            }
            throw error;
        }
        let account = this.getAccount(tenantId, savedId);
        if (!enabled) {
            try {
                await gatewayJson(account, 'services/v1/webhook.php', {
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
            await gatewayJson(account, 'services/v1/webhook.php', {
                method: 'PUT',
                body: {
                    callback_url: webhookCallbackUrl,
                    webhook_secret: webhookSecret,
                    enabled: true,
                },
            });
            await this.health(tenantId, savedId);
        } catch (error) {
            this.markError(savedId, error);
            throw error;
        }
        account = this.getAccount(tenantId, savedId);
        return this.presentAccount(account);
    }

    async disable(tenantId, accountId) {
        const account = this.getAccount(tenantId, accountId);
        if (!account) throw new SmsGatewayError('حساب SMS غير موجود', 404, 'SMS_ACCOUNT_NOT_FOUND');
        const secret = decrypt(account.webhook_secret_encrypted);
        try {
            await gatewayJson(account, 'services/v1/webhook.php', {
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
                    status = 'disabled', updated_at = datetime('now', 'localtime')
                WHERE id = ? AND tenant_id = ?
            `).run(account.id, tenantId);
            if (account.is_default) {
                const replacement = this.db.prepare(`
                    SELECT id FROM sms_gateway_accounts
                    WHERE tenant_id = ? AND enabled = 1 AND id != ? ORDER BY id LIMIT 1
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
            const result = await gatewayJson(account, 'services/v1/health.php');
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
        const result = await gatewayJson(account, 'services/v1/devices.php');
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
            throw new SmsGatewayError('قائمة أجهزة SMS غير صالحة', 422, 'INVALID_SMS_DEVICES');
        }
        const selectedDevices = [...new Set(rawDevices.map(value => String(value).trim()).filter(Boolean))];
        if (selectedDevices.some(value => !/^\d+$/.test(value))) {
            throw new SmsGatewayError('معرّفات أجهزة SMS يجب أن تكون أرقامًا', 422, 'INVALID_SMS_DEVICES');
        }
        const selectedSim = simSlot ?? account.default_sim_slot;
        if (selectedSim !== null && selectedSim !== undefined
            && (!Number.isInteger(Number(selectedSim)) || Number(selectedSim) < 0 || selectedDevices.length !== 1)) {
            throw new SmsGatewayError(
                'اختيار شريحة SIM يتطلب جهازًا واحدًا ومنفذًا صالحًا',
                422,
                'INVALID_SMS_SIM_SLOT',
            );
        }
        let result;
        let lastError;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                result = await gatewayJson(account, 'services/v1/messages.php', {
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
            if (lastError?.status >= 500) this.markError(account.id, lastError);
            throw lastError || new SmsGatewayError(
                'فشل إرسال رسالة SMS',
                502,
                'SMS_GATEWAY_UNAVAILABLE',
            );
        }
        return { account, message: result.data };
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
                SELECT id FROM sms_messages WHERE sms_account_id = ? AND external_id = ?
            `).get(account.id, values.external_id)
            : null;
        if (existing) {
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
            return { duplicate: false, message: this.storeMessage(account, envelope.data || {}) };
        });
        return {
            tenantId: account.tenant_id,
            accountId: account.id,
            event: envelope.event,
            ...process.immediate(),
        };
    }

    markError(accountId, error, checkedAt = null) {
        this.db.prepare(`
            UPDATE sms_gateway_accounts SET status = 'error', last_error = ?,
                last_health_at = COALESCE(?, last_health_at),
                updated_at = datetime('now', 'localtime') WHERE id = ?
        `).run(String(error.message).slice(0, 1000), checkedAt, accountId);
    }
}
