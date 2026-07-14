import { BillingError } from './billingCore.js';

const invalidPeriod = () => {
    throw new BillingError('نطاق التاريخ غير صالح', {
        status: 400,
        code: 'INVALID_BILLING_PERIOD',
    });
};

const isValidCalendarDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const normalizeRequiredDate = (value, endOfDay = false) => {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        if (!isValidCalendarDate(raw)) invalidPeriod();
        return `${raw} ${endOfDay ? '23:59:59' : '00:00:00'}`;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) invalidPeriod();
    return parsed.toISOString().slice(0, 19).replace('T', ' ');
};

export function sqlDate(db, value = null) {
    if (value === undefined || value === null || value === '') {
        return db.prepare("SELECT datetime('now', 'localtime') AS value").get().value;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

export function normalizeSqlDate(_db, value, endOfDay = false) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    return normalizeRequiredDate(value, endOfDay);
}

export function normalizeBillingPeriod(db, { periodStart = null, periodEnd = null } = {}) {
    const defaults = db.prepare(`
        SELECT datetime('now', 'start of month', 'localtime') AS start_sql,
               datetime('now', 'localtime') AS end_sql
    `).get();
    const startSql = normalizeRequiredDate(periodStart, false) || defaults.start_sql;
    const endSql = normalizeRequiredDate(periodEnd, true) || defaults.end_sql;
    const startMs = new Date(startSql.replace(' ', 'T')).getTime();
    const endMs = new Date(endSql.replace(' ', 'T')).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs > endMs) invalidPeriod();

    return {
        start: startSql,
        end: endSql,
        period_start: startSql,
        period_end: endSql,
        start_date: startSql.slice(0, 10),
        end_date: endSql.slice(0, 10),
        default_start: !periodStart,
        default_end: !periodEnd,
    };
}

export function toUnixSeconds(db, value, endOfDay = false) {
    try {
        const normalized = normalizeSqlDate(db, value, endOfDay);
        if (!normalized) return null;
        const parsed = new Date(normalized.replace(' ', 'T'));
        return Number.isNaN(parsed.getTime()) ? null : Math.floor(parsed.getTime() / 1000);
    } catch (error) {
        if (error instanceof BillingError && error.code === 'INVALID_BILLING_PERIOD') return null;
        throw error;
    }
}
