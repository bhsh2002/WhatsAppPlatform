import {
    BillingError,
    normalizeMetaCategory,
    toInt,
} from './billingCore.js';

const nowSql = "datetime('now', 'localtime')";
const META_RATE_CATEGORIES = new Set([
    'marketing',
    'marketing_lite',
    'utility',
    'authentication',
    'authentication_international',
    'service',
    'referral_conversion',
]);

const fail = (message, code) => {
    throw new BillingError(message, { status: 400, code });
};

const normalizeCountryCallingCode = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) fail('كود الدولة مطلوب', 'META_RATE_REQUIRED_FIELDS');
    if (raw === '*') return raw;
    const digits = raw.replace(/\D/g, '');
    if (!digits || digits.length > 15) {
        fail('كود الدولة لسعر Meta غير صالح', 'INVALID_META_RATE_COUNTRY_CODE');
    }
    return digits;
};

const normalizeCategory = (value) => {
    const category = normalizeMetaCategory(value);
    if (!category) fail('فئة رسالة Meta مطلوبة', 'META_RATE_REQUIRED_FIELDS');
    if (!META_RATE_CATEGORIES.has(category)) {
        fail('فئة رسالة Meta غير مدعومة', 'INVALID_META_RATE_CATEGORY');
    }
    return category;
};

const normalizeCurrency = (value) => {
    const currency = String(value || 'USD').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
        fail('عملة سعر Meta غير صالحة', 'INVALID_META_RATE_CURRENCY');
    }
    return currency;
};

const normalizeRateAmount = (value) => {
    if (value === null || value === undefined || String(value).trim() === '') {
        fail('قيمة سعر Meta مطلوبة', 'INVALID_META_RATE_AMOUNT');
    }
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
        fail('قيمة سعر Meta غير صالحة', 'INVALID_META_RATE_AMOUNT');
    }
    return amount;
};

const normalizeTier = (value, { nullable = false } = {}) => {
    if (nullable && (value === null || value === undefined || value === '')) return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        fail('نطاق حجم سعر Meta غير صالح', 'INVALID_META_RATE_VOLUME_TIER');
    }
    return parsed;
};

const normalizeDate = (value, { nullable = false } = {}) => {
    if (nullable && (value === null || value === undefined || value === '')) return null;
    const normalized = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        fail('تاريخ سريان سعر Meta غير صالح', 'INVALID_META_RATE_PERIOD');
    }
    const parsed = new Date(`${normalized}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
        fail('تاريخ سريان سعر Meta غير صالح', 'INVALID_META_RATE_PERIOD');
    }
    return normalized;
};

const normalizeIsActive = (value) => {
    if (value === true || value === 1 || value === '1' || value === 'true') return 1;
    if (value === false || value === 0 || value === '0' || value === 'false') return 0;
    fail('حالة سعر Meta غير صالحة', 'INVALID_META_RATE_STATUS');
};

const normalizeRateData = (db, data = {}) => {
    const effectiveFrom = normalizeDate(
        data.effective_from || db.prepare("SELECT date('now') AS value").get().value
    );
    const effectiveTo = normalizeDate(data.effective_to, { nullable: true });
    const volumeTierMin = normalizeTier(data.volume_tier_min ?? 1);
    const volumeTierMax = normalizeTier(data.volume_tier_max, { nullable: true });

    if (volumeTierMax !== null && volumeTierMax < volumeTierMin) {
        fail('الحد الأعلى لحجم سعر Meta أصغر من الحد الأدنى', 'INVALID_META_RATE_VOLUME_TIER');
    }
    if (effectiveTo && effectiveTo < effectiveFrom) {
        fail('تاريخ نهاية سعر Meta يسبق تاريخ بدايته', 'INVALID_META_RATE_PERIOD');
    }

    return {
        country_calling_code: normalizeCountryCallingCode(data.country_calling_code),
        market_name: String(data.market_name || '').trim() || null,
        currency: normalizeCurrency(data.currency),
        category: normalizeCategory(data.category),
        rate_amount: normalizeRateAmount(data.rate_amount),
        volume_tier_min: volumeTierMin,
        volume_tier_max: volumeTierMax,
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
        source: String(data.source || '').trim() || 'manual',
        notes: String(data.notes || '').trim() || null,
        is_active: data.is_active === undefined ? 1 : normalizeIsActive(data.is_active),
    };
};

const metaRateConflict = () => new BillingError(
    'سعر Meta لهذه الدولة والفئة والعملة موجود لنفس تاريخ السريان',
    { status: 400, code: 'META_RATE_CONFLICT' }
);

const insertNormalizedMetaRate = (db, rate) => {
    const result = db.prepare(`
        INSERT INTO meta_whatsapp_rates (
            country_calling_code, market_name, currency, category, rate_amount,
            volume_tier_min, volume_tier_max, effective_from, effective_to,
            source, notes, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        rate.country_calling_code,
        rate.market_name,
        rate.currency,
        rate.category,
        rate.rate_amount,
        rate.volume_tier_min,
        rate.volume_tier_max,
        rate.effective_from,
        rate.effective_to,
        rate.source,
        rate.notes,
        rate.is_active
    );

    return db.prepare('SELECT * FROM meta_whatsapp_rates WHERE id = ?').get(result.lastInsertRowid);
};

export function listMetaRates(db, { category = null, currency = null, activeOnly = false } = {}) {
    const clauses = [];
    const params = [];
    if (category) {
        clauses.push('LOWER(category) = ?');
        params.push(String(category).toLowerCase());
    }
    if (currency) {
        clauses.push('currency = ?');
        params.push(String(currency).toUpperCase());
    }
    if (activeOnly) clauses.push('is_active = 1');

    return db.prepare(`
        SELECT *
        FROM meta_whatsapp_rates
        ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY is_active DESC, currency, category, country_calling_code, effective_from DESC, volume_tier_min
    `).all(...params);
}

export function createMetaRate(db, data = {}) {
    const rate = normalizeRateData(db, data);
    try {
        return insertNormalizedMetaRate(db, rate);
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw metaRateConflict();
        throw error;
    }
}

export function upsertMetaRate(db, data = {}) {
    const normalized = normalizeRateData(db, data);
    try {
        return { action: 'created', rate: insertNormalizedMetaRate(db, normalized) };
    } catch (error) {
        if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
        const existing = db.prepare(`
            SELECT id
            FROM meta_whatsapp_rates
            WHERE country_calling_code = ?
              AND currency = ?
              AND category = ?
              AND effective_from = ?
              AND volume_tier_min = ?
        `).get(
            normalized.country_calling_code,
            normalized.currency,
            normalized.category,
            normalized.effective_from,
            normalized.volume_tier_min
        );
        if (!existing) throw error;
        return { action: 'updated', rate: updateMetaRate(db, existing.id, normalized) };
    }
}

export function updateMetaRate(db, id, data = {}) {
    const rateId = toInt(id);
    const existing = rateId > 0
        ? db.prepare('SELECT * FROM meta_whatsapp_rates WHERE id = ?').get(rateId)
        : null;
    if (!existing) {
        throw new BillingError('سعر Meta غير موجود', { status: 404, code: 'META_RATE_NOT_FOUND' });
    }

    const allowedFields = new Set([
        'country_calling_code',
        'market_name',
        'currency',
        'category',
        'rate_amount',
        'volume_tier_min',
        'volume_tier_max',
        'effective_from',
        'effective_to',
        'source',
        'notes',
        'is_active',
    ]);
    const fields = Object.keys(data).filter(field => allowedFields.has(field));
    if (fields.length === 0) {
        throw new BillingError('لا توجد حقول لتحديث سعر Meta', { status: 400, code: 'NO_FIELDS' });
    }

    const normalized = normalizeRateData(db, { ...existing, ...data });
    const sets = fields.map(field => `${field} = ?`);
    const values = fields.map(field => normalized[field]);
    sets.push(`updated_at = ${nowSql}`);
    values.push(rateId);

    try {
        db.prepare(`UPDATE meta_whatsapp_rates SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw metaRateConflict();
        throw error;
    }
    return db.prepare('SELECT * FROM meta_whatsapp_rates WHERE id = ?').get(rateId);
}
