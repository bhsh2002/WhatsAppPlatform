import crypto from 'node:crypto';
import express from 'express';
import db from '../db/database.js';
import { presentApiSettings } from '../presenters/apiSettings.js';
import { digestApiKey, generateApiKey } from '../security/apiKeys.js';
import { UnsafeOutboundUrlError, validateOutboundUrl } from '../security/outboundUrl.js';
import { encrypt } from '../services/encryption.js';

const router = express.Router();

class InvalidApiSettingsError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidApiSettingsError';
        this.code = 'INVALID_API_SETTINGS';
    }
}

const selectSettings = db.prepare(
    'SELECT * FROM tenant_api_settings WHERE tenant_id = ?'
);

const createApiCredentials = () => {
    const apiKey = generateApiKey();
    const webhookSecret = crypto.randomBytes(32).toString('hex');
    return {
        apiKey,
        apiKeyDigest: digestApiKey(apiKey),
        webhookSecret,
        encryptedWebhookSecret: encrypt(webhookSecret),
    };
};

const normalizeIsActive = (value, fallback = 1) => {
    if (value === undefined) return fallback;
    if (value === true || value === 1) return 1;
    if (value === false || value === 0) return 0;
    throw new InvalidApiSettingsError('حالة تفعيل API يجب أن تكون قيمة منطقية');
};

const createSettingsIfMissing = (tenantId, {
    webhookUrl = null,
    callbackUrl = null,
    isActive = 1,
} = {}) => {
    const existing = selectSettings.get(tenantId);
    if (existing) return { settings: existing, revealed: {} };

    const credentials = createApiCredentials();
    const result = db.prepare(`
        INSERT INTO tenant_api_settings (
            tenant_id, api_key, api_key_hash, webhook_secret,
            webhook_url, callback_url, is_active
        ) VALUES (?, NULL, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id) DO NOTHING
    `).run(
        tenantId,
        credentials.apiKeyDigest,
        credentials.encryptedWebhookSecret,
        webhookUrl,
        callbackUrl,
        isActive,
    );

    const settings = selectSettings.get(tenantId);
    if (!settings) throw new Error('API settings creation did not produce a stored row');

    return {
        settings,
        revealed: result.changes === 1
            ? { apiKey: credentials.apiKey, webhookSecret: credentials.webhookSecret }
            : {},
    };
};

router.get('/', (req, res) => {
    try {
        const { settings, revealed } = createSettingsIfMissing(req.user.tenant_id);
        res.json(presentApiSettings(settings, revealed));
    } catch (error) {
        console.error('[TenantApiSettings] Get error:', error);
        res.status(500).json({ error: 'فشل جلب إعدادات API' });
    }
});

router.put('/', async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { webhook_url, callback_url, is_active } = req.body;
        const normalizedWebhookUrl = await validateOutboundUrl(webhook_url);
        const normalizedCallbackUrl = await validateOutboundUrl(callback_url);
        let settings = selectSettings.get(tenantId);
        let revealed = {};

        if (!settings) {
            const created = createSettingsIfMissing(tenantId, {
                webhookUrl: normalizedWebhookUrl,
                callbackUrl: normalizedCallbackUrl,
                isActive: normalizeIsActive(is_active),
            });
            settings = created.settings;
            revealed = created.revealed;
        } else {
            const activeValue = normalizeIsActive(is_active, settings.is_active);
            db.prepare(`
                UPDATE tenant_api_settings SET
                    webhook_url = ?,
                    callback_url = ?,
                    is_active = ?,
                    updated_at = datetime('now', 'localtime')
                WHERE tenant_id = ?
            `).run(normalizedWebhookUrl, normalizedCallbackUrl, activeValue, tenantId);
            settings = selectSettings.get(tenantId);
        }

        res.json(presentApiSettings(settings, revealed));
    } catch (error) {
        if (error instanceof UnsafeOutboundUrlError || error instanceof InvalidApiSettingsError) {
            return res.status(400).json({ error: error.message, code: error.code });
        }
        console.error('[TenantApiSettings] Update error:', error);
        res.status(500).json({ error: 'فشل تحديث إعدادات API' });
    }
});

router.post('/regenerate-key', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const newApiKey = generateApiKey();
        const result = db.prepare(`
            UPDATE tenant_api_settings SET
                api_key = NULL,
                api_key_hash = ?,
                updated_at = datetime('now', 'localtime')
            WHERE tenant_id = ?
        `).run(digestApiKey(newApiKey), tenantId);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'إعدادات API غير موجودة' });
        }

        res.json({
            api_key: newApiKey,
            api_key_visible_once: true,
            message: 'تم إنشاء مفتاح API جديد. انسخه الآن؛ لن يظهر مرة أخرى.',
        });
    } catch (error) {
        console.error('[TenantApiSettings] Regenerate API key error:', error);
        res.status(500).json({ error: 'فشل إنشاء مفتاح جديد' });
    }
});

router.post('/regenerate-webhook-secret', (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const newWebhookSecret = crypto.randomBytes(32).toString('hex');
        const result = db.prepare(`
            UPDATE tenant_api_settings SET
                webhook_secret = ?,
                updated_at = datetime('now', 'localtime')
            WHERE tenant_id = ?
        `).run(encrypt(newWebhookSecret), tenantId);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'إعدادات API غير موجودة' });
        }

        res.json({
            webhook_secret: newWebhookSecret,
            webhook_secret_visible_once: true,
            message: 'تم إنشاء سر Webhook جديد. انسخه الآن؛ لن يظهر مرة أخرى.',
        });
    } catch (error) {
        console.error('[TenantApiSettings] Regenerate webhook secret error:', error);
        res.status(500).json({ error: 'فشل إنشاء سر Webhook جديد' });
    }
});

export default router;
