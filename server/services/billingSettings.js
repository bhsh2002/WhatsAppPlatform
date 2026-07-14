import { BillingError } from './billingCore.js';

const nowSql = "datetime('now', 'localtime')";
const DEFAULT_SETTINGS = Object.freeze({
    meta_cost_exchange_rate_to_lyd: 1,
    meta_cost_margin_note: '',
    credit_value_lyd: 0.1,
    meta_cost_margin_percent: 20,
    strict_meta_rate_required: true,
    whatsapp_pricing_source_priority: 'status_webhook_then_estimate',
});
const PRICING_SOURCE_PRIORITIES = new Set(['status_webhook_then_estimate']);

const invalidSetting = (key) => {
    throw new BillingError(`قيمة إعداد الفوترة غير صالحة: ${key}`, {
        status: 400,
        code: 'INVALID_BILLING_SETTING',
        field: key,
    });
};

export function getBooleanSetting(value, fallback = false) {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

const normalizePositiveNumber = (value, key) => {
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized <= 0) invalidSetting(key);
    return String(normalized);
};

const normalizeNonNegativeNumber = (value, key) => {
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized < 0) invalidSetting(key);
    return String(normalized);
};

const normalizeStrictBoolean = (value, key) => {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (value === true || value === 1 || ['true', '1', 'yes', 'on'].includes(normalized)) return 'true';
    if (value === false || value === 0 || ['false', '0', 'no', 'off'].includes(normalized)) return 'false';
    invalidSetting(key);
};

const normalizers = {
    meta_cost_exchange_rate_to_lyd: (value) => normalizePositiveNumber(value, 'meta_cost_exchange_rate_to_lyd'),
    meta_cost_margin_note: (value) => String(value || '').trim(),
    credit_value_lyd: (value) => normalizePositiveNumber(value, 'credit_value_lyd'),
    meta_cost_margin_percent: (value) => normalizeNonNegativeNumber(value, 'meta_cost_margin_percent'),
    strict_meta_rate_required: (value) => normalizeStrictBoolean(value, 'strict_meta_rate_required'),
    whatsapp_pricing_source_priority: (value) => {
        const normalized = String(value || '').trim();
        if (!PRICING_SOURCE_PRIORITIES.has(normalized)) {
            invalidSetting('whatsapp_pricing_source_priority');
        }
        return normalized;
    },
};

const positiveOrDefault = (value, fallback) => {
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
};

const nonNegativeOrDefault = (value, fallback) => {
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized >= 0 ? normalized : fallback;
};

export function getBillingSettings(db) {
    const rows = db.prepare('SELECT key, value, description, updated_at FROM billing_settings ORDER BY key').all();
    const stored = rows.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
    }, {});
    const pricingSource = String(stored.whatsapp_pricing_source_priority || '').trim();

    return {
        settings: {
            meta_cost_exchange_rate_to_lyd: positiveOrDefault(
                stored.meta_cost_exchange_rate_to_lyd,
                DEFAULT_SETTINGS.meta_cost_exchange_rate_to_lyd
            ),
            meta_cost_margin_note: stored.meta_cost_margin_note || DEFAULT_SETTINGS.meta_cost_margin_note,
            credit_value_lyd: positiveOrDefault(
                stored.credit_value_lyd,
                DEFAULT_SETTINGS.credit_value_lyd
            ),
            meta_cost_margin_percent: nonNegativeOrDefault(
                stored.meta_cost_margin_percent,
                DEFAULT_SETTINGS.meta_cost_margin_percent
            ),
            strict_meta_rate_required: getBooleanSetting(
                stored.strict_meta_rate_required,
                DEFAULT_SETTINGS.strict_meta_rate_required
            ),
            whatsapp_pricing_source_priority: PRICING_SOURCE_PRIORITIES.has(pricingSource)
                ? pricingSource
                : DEFAULT_SETTINGS.whatsapp_pricing_source_priority,
        },
        rows,
    };
}

export function updateBillingSettings(db, data = {}) {
    const entries = Object.entries(normalizers)
        .filter(([key]) => Object.prototype.hasOwnProperty.call(data, key))
        .map(([key, normalize]) => [key, normalize(data[key])]);
    if (entries.length === 0) {
        throw new BillingError('لا توجد إعدادات فوترة معروفة للتحديث', {
            status: 400,
            code: 'NO_FIELDS',
        });
    }

    const upsert = db.prepare(`
        INSERT INTO billing_settings (key, value, updated_at)
        VALUES (?, ?, ${nowSql})
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = ${nowSql}
    `);
    return db.transaction(() => {
        for (const [key, value] of entries) upsert.run(key, value);
        return getBillingSettings(db);
    })();
}
