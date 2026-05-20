import db from '../db/database.js';
import { META_API_BASE } from '../config/index.js';
import { getAccessToken } from './credentials.js';

export const BILLING_OPERATIONS = Object.freeze({
    WHATSAPP_TEXT: 'whatsapp.text',
    WHATSAPP_TEMPLATE: 'whatsapp.template',
    WHATSAPP_MEDIA: 'whatsapp.media',
    WHATSAPP_INTERACTIVE: 'whatsapp.interactive',
    WHATSAPP_BROADCAST_RECIPIENT: 'whatsapp.broadcast_recipient',
    WHATSAPP_CONTACT_VERIFICATION_TEMPLATE: 'whatsapp.contact_verification_template',
    MESSENGER_REPLY: 'messenger.reply',
    MESSENGER_UTILITY: 'messenger.utility',
    MESSENGER_BOT_REPLY: 'messenger.bot_reply',
    FACEBOOK_POST_CREATE: 'facebook.post_create',
    FACEBOOK_POST_EDIT: 'facebook.post_edit',
    FACEBOOK_POST_DELETE: 'facebook.post_delete',
    FACEBOOK_PHOTO_POST_CREATE: 'facebook.photo_post_create',
    FACEBOOK_COMMENT_REPLY: 'facebook.comment_reply',
    FACEBOOK_COMMENT_HIDE: 'facebook.comment_hide',
    FACEBOOK_COMMENT_LIKE: 'facebook.comment_like',
    FACEBOOK_COMMENT_UNLIKE: 'facebook.comment_unlike',
    FACEBOOK_COMMENT_DELETE: 'facebook.comment_delete',
    WHATSAPP_EVENT_CONVERSION: 'whatsapp.event_conversion',
});

export class BillingError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'BillingError';
        this.status = details.status || 402;
        this.code = details.code || 'INSUFFICIENT_BALANCE';
        this.details = details;
    }

    toResponse() {
        return {
            success: false,
            error: this.message,
            code: this.code,
            ...this.details,
        };
    }
}

const toInt = (value, fallback = 0) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const serializeJson = (value) => {
    if (value === undefined || value === null) return null;
    try {
        return JSON.stringify(value);
    } catch {
        return JSON.stringify({ unparseable: true });
    }
};

const nowSql = "datetime('now', 'localtime')";
const META_PRICED_WHATSAPP_OPERATIONS = new Set([
    BILLING_OPERATIONS.WHATSAPP_TEXT,
    BILLING_OPERATIONS.WHATSAPP_TEMPLATE,
    BILLING_OPERATIONS.WHATSAPP_MEDIA,
    BILLING_OPERATIONS.WHATSAPP_INTERACTIVE,
    BILLING_OPERATIONS.WHATSAPP_BROADCAST_RECIPIENT,
    BILLING_OPERATIONS.WHATSAPP_CONTACT_VERIFICATION_TEMPLATE,
]);

const normalizeMetaCategory = (value) => {
    const category = String(value || '').trim().toLowerCase();
    if (['marketing', 'marketing_lite', 'utility', 'authentication', 'authentication_international', 'service', 'referral_conversion'].includes(category)) {
        return category;
    }
    return category || null;
};

const normalizePricingType = (value) => String(value || '').trim().toLowerCase();

const normalizePhoneDigits = (value) => String(value || '').replace(/[^\d]/g, '');

function parseJson(value, fallback = {}) {
    if (!value) return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function sqlDate(value = null) {
    if (!value) return db.prepare("SELECT datetime('now', 'localtime') AS value").get().value;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeSqlDate(value, endOfDay = false) {
    if (!value) return null;
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return `${raw} ${endOfDay ? '23:59:59' : '00:00:00'}`;
    }
    return sqlDate(raw);
}

function toUnixSeconds(value, endOfDay = false) {
    const normalized = normalizeSqlDate(value, endOfDay);
    const parsed = new Date(normalized.replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return null;
    return Math.floor(parsed.getTime() / 1000);
}

function hoursSince(value) {
    if (!value) return Number.POSITIVE_INFINITY;
    const parsed = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
    return (Date.now() - parsed.getTime()) / (60 * 60 * 1000);
}

function getTemplateCategory(tenantId, templateName) {
    if (!tenantId || !templateName) return null;
    const row = db.prepare('SELECT category FROM templates WHERE tenant_id = ? AND name = ? ORDER BY id DESC LIMIT 1')
        .get(tenantId, templateName);
    return normalizeMetaCategory(row?.category);
}

function getContactWindow(tenantId, recipient) {
    if (!tenantId || !recipient) return null;
    const phone = normalizePhoneDigits(recipient);
    return db.prepare(`
        SELECT last_customer_message_at, last_ctwa_received_at, last_ctwa_clid
        FROM contacts
        WHERE tenant_id = ? AND phone = ?
        LIMIT 1
    `).get(tenantId, phone) || null;
}

function chooseRateForRecipient({ recipient, countryCallingCode, category, currency = null, effectiveAt = null }) {
    const normalizedCategory = normalizeMetaCategory(category);
    if (!normalizedCategory) return null;

    const digits = normalizePhoneDigits(recipient);
    const dateValue = String(effectiveAt || '').slice(0, 10) || db.prepare("SELECT date('now') AS value").get().value;
    const params = [normalizedCategory, dateValue, dateValue];
    let currencyFilter = '';
    if (currency) {
        currencyFilter = 'AND currency = ?';
        params.push(String(currency).toUpperCase());
    }

    const rows = db.prepare(`
        SELECT *
        FROM meta_whatsapp_rates
        WHERE is_active = 1
          AND LOWER(category) = ?
          AND date(effective_from) <= date(?)
          AND (effective_to IS NULL OR date(effective_to) >= date(?))
          ${currencyFilter}
        ORDER BY LENGTH(country_calling_code) DESC, volume_tier_min DESC, id DESC
    `).all(...params);

    return rows.find((rate) => {
        const code = String(rate.country_calling_code || '').replace(/[^\d*]/g, '');
        if (countryCallingCode && code === String(countryCallingCode)) return true;
        if (code === '*') return true;
        return code && digits.startsWith(code);
    }) || null;
}

function evaluateSingleMetaCharge({ tenantId, operationKey, metadata = {}, recipient = null, category = null, statusPricing = null, effectiveAt = null }) {
    if (!META_PRICED_WHATSAPP_OPERATIONS.has(operationKey)) {
        return {
            status: 'not_applicable',
            category: null,
            country_calling_code: null,
            currency: null,
            amount: 0,
            rate_card_id: null,
            reason: 'operation_not_meta_priced',
            pricing_basis: 'none',
        };
    }

    const messageType = String(metadata.message_type || metadata.type || '').toLowerCase();
    const operationDefaultCategory = [
        BILLING_OPERATIONS.WHATSAPP_TEXT,
        BILLING_OPERATIONS.WHATSAPP_MEDIA,
        BILLING_OPERATIONS.WHATSAPP_INTERACTIVE,
    ].includes(operationKey) ? 'service' : null;
    const resolvedCategory = normalizeMetaCategory(
        statusPricing?.category
        || category
        || metadata.template_category
        || getTemplateCategory(tenantId, metadata.template_name)
        || operationDefaultCategory
        || (messageType && messageType !== 'template' ? 'service' : null)
    );

    if (!resolvedCategory) {
        return {
            status: 'rate_missing',
            category: null,
            country_calling_code: null,
            currency: null,
            amount: 0,
            rate_card_id: null,
            reason: 'template_category_missing',
            pricing_basis: 'category_required',
        };
    }

    const pricingType = normalizePricingType(statusPricing?.type);
    const isMetaRegularCharge = pricingType === 'regular';
    const isMetaFreeCharge = ['free_customer_service', 'free_entry_point'].includes(pricingType);
    const billableFlag = statusPricing?.billable;
    if (isMetaFreeCharge || billableFlag === false || billableFlag === 'false') {
        return {
            status: 'not_charged',
            category: resolvedCategory,
            country_calling_code: null,
            currency: null,
            amount: 0,
            rate_card_id: null,
            reason: isMetaFreeCharge ? `meta_pricing_type_${pricingType}` : 'meta_pricing_billable_false',
            pricing_basis: 'status_webhook',
        };
    }

    const target = recipient || metadata.recipient || metadata.to || metadata.phone || null;
    const contact = getContactWindow(tenantId, target);
    if (!isMetaRegularCharge && contact?.last_ctwa_received_at && hoursSince(contact.last_ctwa_received_at) <= 72) {
        return {
            status: 'not_charged',
            category: resolvedCategory,
            country_calling_code: null,
            currency: null,
            amount: 0,
            rate_card_id: null,
            reason: 'free_entry_point_72h',
            pricing_basis: 'ctwa_window',
        };
    }

    if (!isMetaRegularCharge && resolvedCategory === 'service') {
        return {
            status: 'not_charged',
            category: resolvedCategory,
            country_calling_code: null,
            currency: null,
            amount: 0,
            rate_card_id: null,
            reason: 'service_messages_free',
            pricing_basis: 'service_window',
        };
    }

    if (!isMetaRegularCharge && resolvedCategory === 'utility' && contact?.last_customer_message_at && hoursSince(contact.last_customer_message_at) <= 24) {
        return {
            status: 'not_charged',
            category: resolvedCategory,
            country_calling_code: null,
            currency: null,
            amount: 0,
            rate_card_id: null,
            reason: 'utility_template_inside_24h_window',
            pricing_basis: 'customer_service_window',
        };
    }

    const rate = chooseRateForRecipient({
        recipient: target,
        countryCallingCode: metadata.country_calling_code,
        category: resolvedCategory,
        currency: metadata.meta_currency,
        effectiveAt,
    });

    if (!rate) {
        return {
            status: 'rate_missing',
            category: resolvedCategory,
            country_calling_code: metadata.country_calling_code || null,
            currency: metadata.meta_currency || null,
            amount: 0,
            rate_card_id: null,
            reason: 'meta_rate_not_configured',
            pricing_basis: 'manual_rate_card',
        };
    }

    return {
        status: 'estimated',
        category: resolvedCategory,
        country_calling_code: rate.country_calling_code,
        currency: rate.currency,
        amount: Number(rate.rate_amount) || 0,
        rate_card_id: rate.id,
        reason: 'matched_rate_card',
        pricing_basis: 'manual_rate_card',
    };
}

function summarizeMetaEstimate({ tenantId, operationKey, quantity, metadata = {}, statusPricing = null, effectiveAt = null }) {
    const counts = metadata.recipient_country_counts && typeof metadata.recipient_country_counts === 'object'
        ? metadata.recipient_country_counts
        : null;

    if (counts && Object.keys(counts).length > 0) {
        let total = 0;
        let rateMissing = false;
        let category = normalizeMetaCategory(metadata.template_category || getTemplateCategory(tenantId, metadata.template_name));
        let currency = null;
        const details = [];

        for (const [countryCallingCode, count] of Object.entries(counts)) {
            const estimate = evaluateSingleMetaCharge({
                tenantId,
                operationKey,
                metadata: { ...metadata, country_calling_code: countryCallingCode },
                category,
                statusPricing,
                effectiveAt,
            });
            const rowCount = Math.max(toInt(count), 0);
            total += (Number(estimate.amount) || 0) * rowCount;
            if (estimate.status === 'rate_missing') rateMissing = true;
            if (!currency && estimate.currency) currency = estimate.currency;
            if (!category && estimate.category) category = estimate.category;
            details.push({ country_calling_code: countryCallingCode, count: rowCount, ...estimate });
        }

        return {
            status: rateMissing ? 'rate_missing' : (total > 0 ? 'estimated' : 'not_charged'),
            category,
            country_calling_code: Object.keys(counts).length === 1 ? Object.keys(counts)[0] : 'mixed',
            currency,
            amount: total,
            rate_card_id: details.length === 1 ? details[0].rate_card_id : null,
            reason: rateMissing ? 'one_or_more_rates_missing' : (total > 0 ? 'matched_rate_card' : 'free_or_not_charged'),
            pricing_basis: 'manual_rate_card',
            details,
        };
    }

    const estimate = evaluateSingleMetaCharge({
        tenantId,
        operationKey,
        metadata,
        recipient: metadata.recipient,
        category: metadata.template_category,
        statusPricing,
        effectiveAt,
    });

    return {
        ...estimate,
        amount: (Number(estimate.amount) || 0) * Math.max(toInt(quantity, 1), 1),
        details: null,
    };
}

function updateUsageMetaEstimate(usageId, metadataOverride = null) {
    const usage = db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usageId);
    if (!usage) return null;

    const metadata = {
        ...parseJson(usage.metadata_json, {}),
        ...(metadataOverride || {}),
    };
    const estimate = summarizeMetaEstimate({
        tenantId: usage.tenant_id,
        operationKey: usage.operation_key,
        quantity: usage.quantity,
        metadata,
        effectiveAt: usage.committed_at || null,
    });

    db.prepare(`
        UPDATE billing_usage_events
        SET metadata_json = ?,
            meta_charge_status = ?,
            meta_pricing_basis = ?,
            meta_charge_category = ?,
            meta_country_calling_code = ?,
            meta_charge_currency = ?,
            meta_estimated_amount = ?,
            meta_final_amount = CASE WHEN ? IN ('not_charged', 'not_applicable') THEN 0 ELSE COALESCE(meta_final_amount, 0) END,
            meta_rate_card_id = ?,
            meta_charge_reason = ?,
            meta_priced_at = ${nowSql}
        WHERE id = ?
    `).run(
        serializeJson({ ...metadata, meta_estimate_details: estimate.details || undefined }),
        estimate.status,
        estimate.pricing_basis,
        estimate.category,
        estimate.country_calling_code,
        estimate.currency,
        Number(estimate.amount) || 0,
        estimate.status,
        estimate.rate_card_id,
        estimate.reason,
        usageId
    );

    return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usageId);
}

export function summarizeMetaRecipientCountries(recipients = []) {
    const counts = {};
    for (const recipient of recipients || []) {
        const digits = normalizePhoneDigits(recipient);
        if (!digits) continue;
        const matches = db.prepare(`
            SELECT country_calling_code
            FROM meta_whatsapp_rates
            WHERE is_active = 1
              AND country_calling_code != '*'
            ORDER BY LENGTH(country_calling_code) DESC
        `).all();
        const match = matches.find((rate) => digits.startsWith(String(rate.country_calling_code)));
        const code = match?.country_calling_code || digits.slice(0, Math.min(3, digits.length));
        counts[code] = (counts[code] || 0) + 1;
    }
    return counts;
}

function getLegacyPlanId() {
    const plan = db.prepare('SELECT id FROM billing_plans WHERE code = ?').get('legacy');
    return plan?.id || null;
}

function getTenant(tenantId) {
    return db.prepare('SELECT id, name, status, credits FROM tenants WHERE id = ?').get(tenantId);
}

function computeAvailable(account, reservedCredits = 0) {
    const planBalance = toInt(account?.plan_balance_credits);
    const walletBalance = toInt(account?.wallet_balance_credits);
    const creditLimit = toInt(account?.credit_limit_credits);
    const creditUsed = toInt(account?.credit_used_credits);
    const remainingCreditLimit = Math.max(creditLimit - creditUsed, 0);
    const grossAvailable = planBalance + walletBalance + remainingCreditLimit;

    return {
        plan_balance_credits: planBalance,
        wallet_balance_credits: walletBalance,
        credit_limit_credits: creditLimit,
        credit_used_credits: creditUsed,
        remaining_credit_limit_credits: remainingCreditLimit,
        gross_available_credits: grossAvailable,
        reserved_credits: Math.max(toInt(reservedCredits), 0),
        available_credits: Math.max(grossAvailable - Math.max(toInt(reservedCredits), 0), 0),
    };
}

function getReservedCredits(tenantId, excludeUsageEventId = null) {
    const params = [tenantId];
    let where = "tenant_id = ? AND status = 'reserved'";
    if (excludeUsageEventId) {
        where += ' AND id != ?';
        params.push(excludeUsageEventId);
    }
    const row = db.prepare(`SELECT COALESCE(SUM(total_credits), 0) AS total FROM billing_usage_events WHERE ${where}`).get(...params);
    return toInt(row?.total);
}

function syncTenantCredits(tenantId) {
    const account = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = ?').get(tenantId);
    if (!account) return null;

    const availability = computeAvailable(account, getReservedCredits(tenantId));
    db.prepare(`UPDATE tenants SET credits = ?, updated_at = ${nowSql} WHERE id = ?`)
        .run(availability.available_credits, tenantId);
    return availability.available_credits;
}

export function ensureTenantBillingAccount(tenantId) {
    if (!tenantId) return null;

    const existing = db.prepare(`
        SELECT ba.*, p.code AS plan_code, p.name AS plan_name, p.monthly_price_lyd,
               p.monthly_included_credits, p.default_credit_limit
        FROM tenant_billing_accounts ba
        LEFT JOIN billing_plans p ON p.id = ba.plan_id
        WHERE ba.tenant_id = ?
    `).get(tenantId);

    if (existing) return existing;

    const tenant = getTenant(tenantId);
    if (!tenant) return null;

    const planId = getLegacyPlanId();
    const wallet = toInt(tenant.credits);

    const createAccount = db.transaction(() => {
        db.prepare(`
            INSERT INTO tenant_billing_accounts (
                tenant_id, plan_id, wallet_balance_credits, plan_balance_credits,
                credit_limit_credits, credit_used_credits, status
            ) VALUES (?, ?, ?, 0, 0, 0, ?)
        `).run(
            tenantId,
            planId,
            wallet,
            tenant.status === 'Suspended' ? 'suspended' : 'active'
        );

        if (wallet !== 0) {
            db.prepare(`
                INSERT INTO billing_ledger (
                    tenant_id, entry_type, direction, credits_delta, balance_after_credits,
                    related_type, description, metadata_json
                ) VALUES (?, 'opening_balance', ?, ?, ?, 'tenant_migration', ?, ?)
            `).run(
                tenantId,
                wallet >= 0 ? 'credit' : 'debit',
                wallet,
                wallet,
                'ترحيل الرصيد الافتتاحي من tenants.credits',
                serializeJson({ source: 'tenants.credits', created_by_service: true })
            );
        }
    });

    createAccount();
    syncTenantCredits(tenantId);
    return ensureTenantBillingAccount(tenantId);
}

function getPriceItem(operationKey) {
    return db.prepare('SELECT * FROM billing_price_items WHERE operation_key = ?').get(operationKey);
}

export function quote({ tenantId, operationKey, quantity = 1 } = {}) {
    const normalizedQuantity = Math.max(toInt(quantity, 1), 1);
    const priceItem = getPriceItem(operationKey);
    const unitPrice = priceItem?.is_active && priceItem?.is_billable ? toInt(priceItem.unit_price_credits, 1) : 0;
    const totalCredits = unitPrice * normalizedQuantity;
    const account = tenantId ? ensureTenantBillingAccount(tenantId) : null;
    const reservedCredits = tenantId ? getReservedCredits(tenantId) : 0;
    const availability = account ? computeAvailable(account, reservedCredits) : null;

    return {
        tenant_id: tenantId || null,
        operation_key: operationKey,
        quantity: normalizedQuantity,
        price_item: priceItem || null,
        channel: priceItem?.channel || null,
        operation_type: priceItem?.operation_type || null,
        unit_price_credits: unitPrice,
        total_credits: totalCredits,
        billable: Boolean(priceItem?.is_active && priceItem?.is_billable && totalCredits > 0),
        availability,
    };
}

export function reserve({
    tenantId,
    operationKey,
    quantity = 1,
    referenceType = null,
    referenceId = null,
    idempotencyKey = null,
    metadata = null,
} = {}) {
    if (!tenantId) {
        return { skipped: true, operation_key: operationKey, quantity: toInt(quantity, 1), total_credits: 0 };
    }

    const existing = idempotencyKey
        ? db.prepare('SELECT * FROM billing_usage_events WHERE idempotency_key = ?').get(idempotencyKey)
        : null;

    if (existing) {
        return {
            ...existing,
            total_credits: toInt(existing.total_credits),
            quantity: toInt(existing.quantity),
            already_committed: existing.status === 'committed',
        };
    }

    const transaction = db.transaction(() => {
        const account = ensureTenantBillingAccount(tenantId);
        if (!account) {
            throw new BillingError('حساب العميل غير موجود', {
                status: 404,
                code: 'TENANT_NOT_FOUND',
                operation: operationKey,
            });
        }

        if (account.status !== 'active') {
            throw new BillingError('حساب الفوترة موقوف ولا يمكن تنفيذ العملية', {
                status: 402,
                code: 'BILLING_ACCOUNT_SUSPENDED',
                operation: operationKey,
            });
        }

        const currentQuote = quote({ tenantId, operationKey, quantity });
        if (!currentQuote.billable || currentQuote.total_credits <= 0) {
            return {
                skipped: true,
                tenant_id: tenantId,
                operation_key: operationKey,
                quantity: currentQuote.quantity,
                total_credits: 0,
                billable: false,
            };
        }

        const available = currentQuote.availability?.available_credits || 0;
        if (available < currentQuote.total_credits) {
            throw new BillingError('الرصيد غير كافٍ لتنفيذ العملية', {
                operation: operationKey,
                required_credits: currentQuote.total_credits,
                available_credits: available,
                credit_limit: currentQuote.availability?.credit_limit_credits || 0,
            });
        }

        const result = db.prepare(`
            INSERT INTO billing_usage_events (
                tenant_id, price_item_id, operation_key, channel, operation_type,
                quantity, unit_price_credits, total_credits, status,
                reference_type, reference_id, idempotency_key, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?)
        `).run(
            tenantId,
            currentQuote.price_item.id,
            operationKey,
            currentQuote.price_item.channel,
            currentQuote.price_item.operation_type,
            currentQuote.quantity,
            currentQuote.unit_price_credits,
            currentQuote.total_credits,
            referenceType,
            referenceId,
            idempotencyKey,
            serializeJson(metadata)
        );

        syncTenantCredits(tenantId);
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(result.lastInsertRowid);
    });

    return transaction();
}

function deductAccountBalances(account, credits) {
    let remaining = Math.max(toInt(credits), 0);
    let planBalance = toInt(account.plan_balance_credits);
    let walletBalance = toInt(account.wallet_balance_credits);
    let creditUsed = toInt(account.credit_used_credits);

    const planDebit = Math.min(planBalance, remaining);
    planBalance -= planDebit;
    remaining -= planDebit;

    const walletDebit = Math.min(walletBalance, remaining);
    walletBalance -= walletDebit;
    remaining -= walletDebit;

    if (remaining > 0) {
        creditUsed += remaining;
    }

    return {
        plan_balance_credits: planBalance,
        wallet_balance_credits: walletBalance,
        credit_used_credits: creditUsed,
    };
}

export function commit(reservation, options = {}) {
    if (!reservation || reservation.skipped) return { skipped: true };
    if (reservation.already_committed || reservation.status === 'committed') return reservation;

    const usageId = reservation.id;
    const transaction = db.transaction(() => {
        const usage = db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usageId);
        if (!usage) return null;
        if (usage.status === 'committed') return usage;
        if (usage.status !== 'reserved') return usage;

        const originalQuantity = toInt(usage.quantity, 1);
        const commitQuantity = options.quantity === undefined
            ? originalQuantity
            : Math.max(Math.min(toInt(options.quantity), originalQuantity), 0);

        if (commitQuantity === 0) {
            return release(usage, options.errorMessage || 'No successful billable operations');
        }

        const unitPrice = toInt(usage.unit_price_credits);
        const chargedCredits = commitQuantity * unitPrice;
        const account = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = ?').get(usage.tenant_id);
        if (!account) {
            throw new BillingError('حساب الفوترة غير موجود عند اعتماد الخصم', {
                status: 500,
                code: 'BILLING_ACCOUNT_MISSING',
                operation: usage.operation_key,
            });
        }

        const balances = deductAccountBalances(account, chargedCredits);
        db.prepare(`
            UPDATE tenant_billing_accounts
            SET plan_balance_credits = ?,
                wallet_balance_credits = ?,
                credit_used_credits = ?,
                updated_at = ${nowSql}
            WHERE tenant_id = ?
        `).run(
            balances.plan_balance_credits,
            balances.wallet_balance_credits,
            balances.credit_used_credits,
            usage.tenant_id
        );

        const updatedAccount = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = ?').get(usage.tenant_id);
        const balanceAfter = computeAvailable(updatedAccount, getReservedCredits(usage.tenant_id, usage.id)).gross_available_credits;
        const metadata = {
            ...(usage.metadata_json ? JSON.parse(usage.metadata_json) : {}),
            reserved_quantity: originalQuantity,
            committed_quantity: commitQuantity,
            released_quantity: originalQuantity - commitQuantity,
        };

        db.prepare(`
            UPDATE billing_usage_events
            SET quantity = ?,
                total_credits = ?,
                status = 'committed',
                reference_id = COALESCE(?, reference_id),
                metadata_json = ?,
                committed_at = ${nowSql}
            WHERE id = ?
        `).run(
            commitQuantity,
            chargedCredits,
            options.referenceId || null,
            serializeJson(metadata),
            usage.id
        );

        db.prepare(`
            INSERT INTO billing_ledger (
                tenant_id, entry_type, direction, credits_delta, balance_after_credits,
                related_type, related_id, description, metadata_json
            ) VALUES (?, 'usage_charge', 'debit', ?, ?, ?, ?, ?, ?)
        `).run(
            usage.tenant_id,
            -chargedCredits,
            balanceAfter,
            usage.reference_type || 'usage_event',
            String(usage.id),
            options.description || `خصم عملية: ${usage.operation_key}`,
            serializeJson({
                operation_key: usage.operation_key,
                channel: usage.channel,
                operation_type: usage.operation_type,
                reference_id: options.referenceId || usage.reference_id || null,
                quantity: commitQuantity,
                unit_price_credits: unitPrice,
            })
        );

        updateUsageMetaEstimate(usage.id, options.meta || options.metaMetadata || null);

        syncTenantCredits(usage.tenant_id);
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
    });

    return transaction();
}

export function release(reservation, errorMessage = null) {
    if (!reservation || reservation.skipped) return { skipped: true };
    if (reservation.status === 'committed') return reservation;

    const usageId = reservation.id;
    const transaction = db.transaction(() => {
        const usage = db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usageId);
        if (!usage) return null;
        if (usage.status !== 'reserved') return usage;

        db.prepare(`
            UPDATE billing_usage_events
            SET status = 'released',
                error_message = ?,
                released_at = ${nowSql}
            WHERE id = ?
        `).run(errorMessage || null, usage.id);

        syncTenantCredits(usage.tenant_id);
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
    });

    return transaction();
}

export function recordPayment({ tenantId, credits, amountLyd = 0, method = 'manual', reference = null, note = null, createdBy = null, invoiceId = null }) {
    const normalizedCredits = Math.max(toInt(credits), 0);
    if (!tenantId || normalizedCredits <= 0) {
        throw new BillingError('قيمة الرصيد المضاف غير صالحة', { status: 400, code: 'INVALID_PAYMENT_CREDITS' });
    }

    const transaction = db.transaction(() => {
        const account = ensureTenantBillingAccount(tenantId);
        if (!account) {
            throw new BillingError('العميل غير موجود', { status: 404, code: 'TENANT_NOT_FOUND' });
        }

        const payment = db.prepare(`
            INSERT INTO billing_payments (tenant_id, invoice_id, amount_lyd, credits, method, reference, note, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(tenantId, invoiceId || null, Number(amountLyd) || 0, normalizedCredits, method, reference, note, createdBy);

        db.prepare(`
            UPDATE tenant_billing_accounts
            SET wallet_balance_credits = wallet_balance_credits + ?,
                updated_at = ${nowSql}
            WHERE tenant_id = ?
        `).run(normalizedCredits, tenantId);

        const updatedAccount = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = ?').get(tenantId);
        const balanceAfter = computeAvailable(updatedAccount, getReservedCredits(tenantId)).gross_available_credits;

        db.prepare(`
            INSERT INTO billing_ledger (
                tenant_id, entry_type, direction, credits_delta, amount_lyd,
                balance_after_credits, related_type, related_id, description, metadata_json, created_by
            ) VALUES (?, 'payment', 'credit', ?, ?, ?, 'billing_payment', ?, ?, ?, ?)
        `).run(
            tenantId,
            normalizedCredits,
            Number(amountLyd) || 0,
            balanceAfter,
            String(payment.lastInsertRowid),
            note || `إضافة رصيد ${normalizedCredits}`,
            serializeJson({ method, reference }),
            createdBy
        );

        syncTenantCredits(tenantId);
        return {
            payment: db.prepare('SELECT * FROM billing_payments WHERE id = ?').get(payment.lastInsertRowid),
            summary: getBillingSummary(tenantId),
        };
    });

    return transaction();
}

export function recordAdjustment({ tenantId, creditsDelta, reason, createdBy = null }) {
    const delta = toInt(creditsDelta);
    if (!tenantId || delta === 0) {
        throw new BillingError('قيمة التعديل غير صالحة', { status: 400, code: 'INVALID_ADJUSTMENT_CREDITS' });
    }
    if (!String(reason || '').trim()) {
        throw new BillingError('سبب التعديل مطلوب', { status: 400, code: 'ADJUSTMENT_REASON_REQUIRED' });
    }

    const transaction = db.transaction(() => {
        const account = ensureTenantBillingAccount(tenantId);
        if (!account) {
            throw new BillingError('العميل غير موجود', { status: 404, code: 'TENANT_NOT_FOUND' });
        }

        db.prepare(`
            UPDATE tenant_billing_accounts
            SET wallet_balance_credits = wallet_balance_credits + ?,
                updated_at = ${nowSql}
            WHERE tenant_id = ?
        `).run(delta, tenantId);

        const updatedAccount = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = ?').get(tenantId);
        const balanceAfter = computeAvailable(updatedAccount, getReservedCredits(tenantId)).gross_available_credits;

        const ledger = db.prepare(`
            INSERT INTO billing_ledger (
                tenant_id, entry_type, direction, credits_delta, balance_after_credits,
                related_type, description, metadata_json, created_by
            ) VALUES (?, 'manual_adjustment', ?, ?, ?, 'admin_adjustment', ?, ?, ?)
        `).run(
            tenantId,
            delta >= 0 ? 'credit' : 'debit',
            delta,
            balanceAfter,
            reason,
            serializeJson({ reason }),
            createdBy
        );

        syncTenantCredits(tenantId);
        return {
            ledger: db.prepare('SELECT * FROM billing_ledger WHERE id = ?').get(ledger.lastInsertRowid),
            summary: getBillingSummary(tenantId),
        };
    });

    return transaction();
}

export function applyMonthlyAllowance(tenantId) {
    const transaction = db.transaction(() => {
        const account = ensureTenantBillingAccount(tenantId);
        if (!account?.plan_id) return { applied: false, reason: 'no_plan' };

        const plan = db.prepare('SELECT * FROM billing_plans WHERE id = ?').get(account.plan_id);
        if (!plan || !plan.is_active) return { applied: false, reason: 'inactive_plan' };

        const currentMonth = db.prepare("SELECT strftime('%Y-%m', datetime('now', 'localtime')) AS month").get().month;
        const cycleMonth = account.billing_cycle_start
            ? db.prepare("SELECT strftime('%Y-%m', ?) AS month").get(account.billing_cycle_start).month
            : null;

        if (cycleMonth === currentMonth) {
            return { applied: false, reason: 'already_current_cycle' };
        }

        const included = Math.max(toInt(plan.monthly_included_credits), 0);
        db.prepare(`
            UPDATE tenant_billing_accounts
            SET plan_balance_credits = ?,
                credit_limit_credits = ?,
                credit_used_credits = 0,
                billing_cycle_start = ${nowSql},
                billing_cycle_end = datetime('now', '+1 month', 'localtime'),
                updated_at = ${nowSql}
            WHERE tenant_id = ?
        `).run(included, toInt(plan.default_credit_limit), tenantId);

        const updatedAccount = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = ?').get(tenantId);
        const balanceAfter = computeAvailable(updatedAccount, getReservedCredits(tenantId)).gross_available_credits;

        db.prepare(`
            INSERT INTO billing_ledger (
                tenant_id, entry_type, direction, credits_delta, balance_after_credits,
                related_type, related_id, description, metadata_json
            ) VALUES (?, 'monthly_allowance', 'credit', ?, ?, 'billing_plan', ?, ?, ?)
        `).run(
            tenantId,
            included,
            balanceAfter,
            String(plan.id),
            `تجديد رصيد الباقة الشهرية: ${plan.name}`,
            serializeJson({ plan_code: plan.code, credit_limit: toInt(plan.default_credit_limit) })
        );

        syncTenantCredits(tenantId);
        return { applied: true, summary: getBillingSummary(tenantId) };
    });

    return transaction();
}

export function updateTenantBillingAccount(tenantId, data = {}) {
    const account = ensureTenantBillingAccount(tenantId);
    if (!account) {
        throw new BillingError('العميل غير موجود', { status: 404, code: 'TENANT_NOT_FOUND' });
    }

    const nextPlanId = 'plan_id' in data
        ? (data.plan_id === null || data.plan_id === '' ? null : toInt(data.plan_id))
        : account.plan_id;
    const planChanged = 'plan_id' in data && String(nextPlanId || '') !== String(account.plan_id || '');
    const nextPlan = nextPlanId ? db.prepare('SELECT * FROM billing_plans WHERE id = ?').get(nextPlanId) : null;

    const fields = [];
    const values = [];
    const allowed = {
        plan_id: () => nextPlanId,
        wallet_balance_credits: (v) => toInt(v),
        plan_balance_credits: (v) => toInt(v),
        credit_limit_credits: (v) => Math.max(toInt(v), 0),
        credit_used_credits: (v) => Math.max(toInt(v), 0),
        status: (v) => ['active', 'suspended', 'closed'].includes(v) ? v : account.status,
        billing_cycle_start: (v) => v || account.billing_cycle_start,
        billing_cycle_end: (v) => v || null,
    };

    for (const [key, normalizer] of Object.entries(allowed)) {
        if (key in data) {
            fields.push(`${key} = ?`);
            values.push(normalizer(data[key]));
        }
    }

    if (planChanged && nextPlan) {
        if (!('plan_balance_credits' in data)) {
            fields.push('plan_balance_credits = ?');
            values.push(Math.max(toInt(nextPlan.monthly_included_credits), 0));
        }
        if (!('credit_limit_credits' in data)) {
            fields.push('credit_limit_credits = ?');
            values.push(Math.max(toInt(nextPlan.default_credit_limit), 0));
        }
        if (!('credit_used_credits' in data)) {
            fields.push('credit_used_credits = ?');
            values.push(0);
        }
        fields.push(`billing_cycle_start = ${nowSql}`);
        fields.push("billing_cycle_end = datetime('now', '+1 month', 'localtime')");
    } else if (planChanged && !nextPlan) {
        if (!('plan_balance_credits' in data)) {
            fields.push('plan_balance_credits = ?');
            values.push(0);
        }
        fields.push('billing_cycle_end = ?');
        values.push(null);
    }

    if (fields.length === 0) return getBillingSummary(tenantId);

    fields.push(`updated_at = ${nowSql}`);
    values.push(tenantId);

    const transaction = db.transaction(() => {
        db.prepare(`UPDATE tenant_billing_accounts SET ${fields.join(', ')} WHERE tenant_id = ?`).run(...values);

        if (planChanged) {
            const updatedAccount = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = ?').get(tenantId);
            const balanceAfter = computeAvailable(updatedAccount, getReservedCredits(tenantId)).gross_available_credits;
            const included = nextPlan ? Math.max(toInt(nextPlan.monthly_included_credits), 0) : 0;
            db.prepare(`
                INSERT INTO billing_ledger (
                    tenant_id, entry_type, direction, credits_delta, balance_after_credits,
                    related_type, related_id, description, metadata_json
                ) VALUES (?, 'monthly_allowance', 'credit', ?, ?, 'billing_plan', ?, ?, ?)
            `).run(
                tenantId,
                included,
                balanceAfter,
                nextPlan ? String(nextPlan.id) : null,
                nextPlan
                    ? `تطبيق باقة: ${nextPlan.name}`
                    : 'إزالة باقة العميل',
                serializeJson({
                    previous_plan_id: account.plan_id || null,
                    new_plan_id: nextPlanId || null,
                    monthly_included_credits: included,
                    credit_limit: nextPlan ? toInt(nextPlan.default_credit_limit) : null,
                })
            );
        }
    });

    transaction();
    syncTenantCredits(tenantId);
    return getBillingSummary(tenantId);
}

export function getLedger(tenantId, { limit = 50, offset = 0, channel = null, operation = null } = {}) {
    const clauses = ['bl.tenant_id = ?'];
    const params = [tenantId];

    if (channel || operation) {
        clauses.push(`EXISTS (
            SELECT 1 FROM billing_usage_events bue
            WHERE bue.id = CAST(bl.related_id AS INTEGER)
              AND bl.related_type IN ('usage_event', 'message', 'broadcast', 'facebook_content', 'conversion_event')
              ${channel ? 'AND bue.channel = ?' : ''}
              ${operation ? 'AND bue.operation_key = ?' : ''}
        )`);
        if (channel) params.push(channel);
        if (operation) params.push(operation);
    }

    params.push(Math.max(toInt(limit, 50), 1), Math.max(toInt(offset), 0));

    return db.prepare(`
        SELECT bl.*
        FROM billing_ledger bl
        WHERE ${clauses.join(' AND ')}
        ORDER BY bl.created_at DESC, bl.id DESC
        LIMIT ? OFFSET ?
    `).all(...params);
}

export function getInvoices(tenantId, { limit = 20, offset = 0 } = {}) {
    return db.prepare(`
        SELECT *
        FROM billing_invoices
        WHERE tenant_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
    `).all(tenantId, Math.max(toInt(limit, 20), 1), Math.max(toInt(offset), 0));
}

export function createInvoice({ tenantId, periodStart = null, periodEnd = null, dueDate = null, notes = null, createdBy = null } = {}) {
    if (!tenantId) {
        throw new BillingError('العميل مطلوب لإنشاء الفاتورة', { status: 400, code: 'TENANT_REQUIRED' });
    }

    const transaction = db.transaction(() => {
        ensureTenantBillingAccount(tenantId);
        const periodClause = [];
        const params = [tenantId];

        if (periodStart) {
            periodClause.push('created_at >= ?');
            params.push(periodStart);
        }
        if (periodEnd) {
            periodClause.push('created_at <= ?');
            params.push(periodEnd);
        }

        const usageWhere = periodClause.length ? `AND ${periodClause.join(' AND ')}` : '';
        const usage = db.prepare(`
            SELECT COALESCE(SUM(total_credits), 0) AS credits
            FROM billing_usage_events
            WHERE tenant_id = ?
              AND status = 'committed'
              ${usageWhere}
        `).get(...params);

        const invoiceNumber = `INV-${tenantId}-${Date.now()}`;
        const credits = toInt(usage?.credits);
        const invoice = db.prepare(`
            INSERT INTO billing_invoices (
                tenant_id, invoice_number, period_start, period_end,
                subtotal_credits, subtotal_lyd, status, due_date, notes, created_by
            ) VALUES (?, ?, ?, ?, ?, 0, 'issued', ?, ?, ?)
        `).run(tenantId, invoiceNumber, periodStart, periodEnd, credits, dueDate, notes, createdBy);

        return db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(invoice.lastInsertRowid);
    });

    return transaction();
}

export function getBillingSummary(tenantId) {
    const account = ensureTenantBillingAccount(tenantId);
    if (!account) return null;

    const fullAccount = db.prepare(`
        SELECT ba.*, p.code AS plan_code, p.name AS plan_name, p.description AS plan_description,
               p.monthly_price_lyd, p.monthly_included_credits, p.default_credit_limit
        FROM tenant_billing_accounts ba
        LEFT JOIN billing_plans p ON p.id = ba.plan_id
        WHERE ba.tenant_id = ?
    `).get(tenantId);

    const reservedCredits = getReservedCredits(tenantId);
    const availability = computeAvailable(fullAccount, reservedCredits);

    const usageByChannel = db.prepare(`
        SELECT channel, COALESCE(SUM(total_credits), 0) AS credits, COALESCE(SUM(quantity), 0) AS quantity
        FROM billing_usage_events
        WHERE tenant_id = ?
          AND status = 'committed'
          AND committed_at >= datetime('now', 'start of month', 'localtime')
        GROUP BY channel
        ORDER BY channel
    `).all(tenantId);

    const metaCostMonth = db.prepare(`
        SELECT meta_charge_currency AS currency,
               COALESCE(SUM(meta_estimated_amount), 0) AS estimated_amount,
               COALESCE(SUM(meta_final_amount), 0) AS final_amount,
               SUM(CASE WHEN meta_charge_status = 'rate_missing' THEN 1 ELSE 0 END) AS rate_missing_count
        FROM billing_usage_events
        WHERE tenant_id = ?
          AND status = 'committed'
          AND channel = 'whatsapp'
          AND committed_at >= datetime('now', 'start of month', 'localtime')
        GROUP BY meta_charge_currency
        ORDER BY final_amount DESC, estimated_amount DESC
    `).all(tenantId);

    const lastPayment = db.prepare(`
        SELECT *
        FROM billing_payments
        WHERE tenant_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `).get(tenantId) || null;

    const lastInvoice = db.prepare(`
        SELECT *
        FROM billing_invoices
        WHERE tenant_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `).get(tenantId) || null;

    const recentLedger = getLedger(tenantId, { limit: 10 });

    return {
        tenant_id: tenantId,
        account: fullAccount,
        plan: fullAccount?.plan_id ? {
            id: fullAccount.plan_id,
            code: fullAccount.plan_code,
            name: fullAccount.plan_name,
            description: fullAccount.plan_description,
            monthly_price_lyd: fullAccount.monthly_price_lyd,
            monthly_included_credits: fullAccount.monthly_included_credits,
            default_credit_limit: fullAccount.default_credit_limit,
        } : null,
        balances: availability,
        usage_month: usageByChannel,
        meta_cost_month: metaCostMonth,
        last_payment: lastPayment,
        last_invoice: lastInvoice,
        recent_ledger: recentLedger,
    };
}

export function updateMetaChargeFromStatus({ wamid, status, pricing = null, timestamp = null } = {}) {
    if (!wamid) return null;

    const usage = db.prepare(`
        SELECT *
        FROM billing_usage_events
        WHERE reference_id = ?
          AND channel = 'whatsapp'
        ORDER BY id DESC
        LIMIT 1
    `).get(wamid);

    if (!usage) return null;

    const normalizedStatus = String(status || '').toLowerCase();
    if (['failed', 'undelivered'].includes(normalizedStatus)) {
        db.prepare(`
            UPDATE billing_usage_events
            SET meta_charge_status = 'not_charged',
                meta_final_amount = 0,
                meta_charge_reason = ?,
                meta_priced_at = ${nowSql}
            WHERE id = ?
        `).run(`message_${normalizedStatus}`, usage.id);
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
    }

    if (!['delivered', 'read'].includes(normalizedStatus)) {
        return usage;
    }

    const metadata = parseJson(usage.metadata_json, {});
    const estimate = summarizeMetaEstimate({
        tenantId: usage.tenant_id,
        operationKey: usage.operation_key,
        quantity: usage.quantity,
        metadata,
        statusPricing: pricing || null,
        effectiveAt: timestamp ? sqlDate(Number(timestamp) * 1000) : null,
    });

    db.prepare(`
        UPDATE billing_usage_events
        SET meta_charge_status = ?,
            meta_pricing_basis = ?,
            meta_charge_category = ?,
            meta_country_calling_code = ?,
            meta_charge_currency = ?,
            meta_estimated_amount = CASE WHEN COALESCE(meta_estimated_amount, 0) = 0 THEN ? ELSE meta_estimated_amount END,
            meta_final_amount = ?,
            meta_rate_card_id = ?,
            meta_charge_reason = ?,
            meta_delivered_at = COALESCE(meta_delivered_at, ?),
            meta_priced_at = ${nowSql}
        WHERE id = ?
    `).run(
        estimate.status === 'estimated' ? 'final' : estimate.status,
        pricing ? 'status_webhook' : estimate.pricing_basis,
        estimate.category,
        estimate.country_calling_code,
        estimate.currency,
        Number(estimate.amount) || 0,
        estimate.status === 'rate_missing' ? 0 : Number(estimate.amount) || 0,
        estimate.rate_card_id,
        pricing?.pricing_model ? `${estimate.reason}; pricing_model=${pricing.pricing_model}` : estimate.reason,
        timestamp ? sqlDate(Number(timestamp) * 1000) : sqlDate(),
        usage.id
    );

    return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
}

export function listMetaRates({ category = null, currency = null, activeOnly = false } = {}) {
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
    if (activeOnly) {
        clauses.push('is_active = 1');
    }

    return db.prepare(`
        SELECT *
        FROM meta_whatsapp_rates
        ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY is_active DESC, currency, category, country_calling_code, effective_from DESC, volume_tier_min
    `).all(...params);
}

export function createMetaRate(data = {}) {
    const countryCode = String(data.country_calling_code || '').trim();
    const category = normalizeMetaCategory(data.category);
    const currency = String(data.currency || 'USD').trim().toUpperCase();

    if (!countryCode || !category) {
        throw new BillingError('كود الدولة وفئة رسالة Meta مطلوبان', { status: 400, code: 'META_RATE_REQUIRED_FIELDS' });
    }

    const result = db.prepare(`
        INSERT INTO meta_whatsapp_rates (
            country_calling_code, market_name, currency, category, rate_amount,
            volume_tier_min, volume_tier_max, effective_from, effective_to,
            source, notes, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        countryCode,
        data.market_name || null,
        currency,
        category,
        Number(data.rate_amount) || 0,
        Math.max(toInt(data.volume_tier_min, 1), 1),
        data.volume_tier_max ? Math.max(toInt(data.volume_tier_max), 1) : null,
        data.effective_from || db.prepare("SELECT date('now') AS value").get().value,
        data.effective_to || null,
        data.source || 'manual',
        data.notes || null,
        data.is_active === false ? 0 : 1
    );

    return db.prepare('SELECT * FROM meta_whatsapp_rates WHERE id = ?').get(result.lastInsertRowid);
}

export function updateMetaRate(id, data = {}) {
    const allowed = {
        country_calling_code: (v) => String(v || '').trim(),
        market_name: (v) => v || null,
        currency: (v) => String(v || 'USD').trim().toUpperCase(),
        category: (v) => normalizeMetaCategory(v),
        rate_amount: (v) => Number(v) || 0,
        volume_tier_min: (v) => Math.max(toInt(v, 1), 1),
        volume_tier_max: (v) => v ? Math.max(toInt(v), 1) : null,
        effective_from: (v) => v || db.prepare("SELECT date('now') AS value").get().value,
        effective_to: (v) => v || null,
        source: (v) => v || 'manual',
        notes: (v) => v || null,
        is_active: (v) => v ? 1 : 0,
    };
    const sets = [];
    const values = [];

    for (const [field, normalizer] of Object.entries(allowed)) {
        if (field in data) {
            sets.push(`${field} = ?`);
            values.push(normalizer(data[field]));
        }
    }
    if (sets.length === 0) {
        throw new BillingError('لا توجد حقول لتحديث سعر Meta', { status: 400, code: 'NO_FIELDS' });
    }

    sets.push(`updated_at = ${nowSql}`);
    values.push(id);
    db.prepare(`UPDATE meta_whatsapp_rates SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return db.prepare('SELECT * FROM meta_whatsapp_rates WHERE id = ?').get(id);
}

export function getMetaUsage({ tenantId = null, limit = 100, offset = 0, status = null } = {}) {
    const clauses = ["bue.channel = 'whatsapp'", "bue.meta_charge_status IS NOT NULL", "bue.meta_charge_status != 'not_applicable'"];
    const params = [];
    if (tenantId) {
        clauses.push('bue.tenant_id = ?');
        params.push(tenantId);
    }
    if (status) {
        clauses.push('bue.meta_charge_status = ?');
        params.push(status);
    }
    params.push(Math.max(toInt(limit, 100), 1), Math.max(toInt(offset), 0));

    return db.prepare(`
        SELECT bue.*, t.name AS tenant_name
        FROM billing_usage_events bue
        LEFT JOIN tenants t ON t.id = bue.tenant_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY COALESCE(bue.meta_priced_at, bue.committed_at, bue.reserved_at) DESC, bue.id DESC
        LIMIT ? OFFSET ?
    `).all(...params);
}

export function getMetaCostSummary({ tenantId = null, periodStart = null, periodEnd = null } = {}) {
    const clauses = ["channel = 'whatsapp'", "status = 'committed'"];
    const params = [];
    if (tenantId) {
        clauses.push('tenant_id = ?');
        params.push(tenantId);
    }
    if (periodStart) {
        clauses.push('committed_at >= ?');
        params.push(periodStart);
    }
    if (periodEnd) {
        clauses.push('committed_at <= ?');
        params.push(periodEnd);
    }

    const totals = db.prepare(`
        SELECT
            COALESCE(SUM(meta_estimated_amount), 0) AS estimated_amount,
            COALESCE(SUM(meta_final_amount), 0) AS final_amount,
            COUNT(*) AS usage_count,
            SUM(CASE WHEN meta_charge_status = 'rate_missing' THEN 1 ELSE 0 END) AS rate_missing_count,
            SUM(CASE WHEN meta_charge_status IN ('estimated', 'final') THEN 1 ELSE 0 END) AS priced_count
        FROM billing_usage_events
        WHERE ${clauses.join(' AND ')}
    `).get(...params);

    const byCategory = db.prepare(`
        SELECT meta_charge_category AS category,
               meta_charge_currency AS currency,
               COALESCE(SUM(meta_estimated_amount), 0) AS estimated_amount,
               COALESCE(SUM(meta_final_amount), 0) AS final_amount,
               COALESCE(SUM(quantity), 0) AS quantity,
               COUNT(*) AS count
        FROM billing_usage_events
        WHERE ${clauses.join(' AND ')}
        GROUP BY meta_charge_category, meta_charge_currency
        ORDER BY meta_charge_category
    `).all(...params);

    const byCountry = db.prepare(`
        SELECT meta_country_calling_code AS country_calling_code,
               meta_charge_currency AS currency,
               COALESCE(SUM(meta_estimated_amount), 0) AS estimated_amount,
               COALESCE(SUM(meta_final_amount), 0) AS final_amount,
               COALESCE(SUM(quantity), 0) AS quantity,
               COUNT(*) AS count
        FROM billing_usage_events
        WHERE ${clauses.join(' AND ')}
        GROUP BY meta_country_calling_code, meta_charge_currency
        ORDER BY final_amount DESC, estimated_amount DESC
    `).all(...params);

    return {
        filters: { tenant_id: tenantId || null, period_start: periodStart || null, period_end: periodEnd || null },
        totals,
        by_category: byCategory,
        by_country: byCountry,
    };
}

export function listMetaInvoices({ tenantId = null, limit = 50, offset = 0 } = {}) {
    const clauses = [];
    const params = [];
    if (tenantId) {
        clauses.push('mi.tenant_id = ?');
        params.push(tenantId);
    }
    params.push(Math.max(toInt(limit, 50), 1), Math.max(toInt(offset), 0));

    return db.prepare(`
        SELECT mi.*, t.name AS tenant_name
        FROM meta_invoices mi
        LEFT JOIN tenants t ON t.id = mi.tenant_id
        ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY COALESCE(mi.period_end, mi.created_at) DESC, mi.id DESC
        LIMIT ? OFFSET ?
    `).all(...params);
}

export function listMetaUsageSnapshots({ tenantId = null, limit = 10, offset = 0 } = {}) {
    const clauses = [];
    const params = [];
    if (tenantId) {
        clauses.push('mus.tenant_id = ?');
        params.push(tenantId);
    }
    params.push(Math.max(toInt(limit, 10), 1), Math.max(toInt(offset), 0));

    return db.prepare(`
        SELECT mus.*, t.name AS tenant_name
        FROM meta_usage_snapshots mus
        LEFT JOIN tenants t ON t.id = mus.tenant_id
        ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY mus.created_at DESC, mus.id DESC
        LIMIT ? OFFSET ?
    `).all(...params);
}

function buildWabaFieldUrl(wabaId, field, accessToken) {
    const params = new URLSearchParams({
        fields: field,
        access_token: accessToken,
    });
    return `${META_API_BASE}/${wabaId}?${params.toString()}`;
}

async function fetchWabaField(wabaId, field, accessToken) {
    const response = await fetch(buildWabaFieldUrl(wabaId, field, accessToken));
    const data = await response.json();
    if (!response.ok) {
        const error = new Error(data.error?.message || 'Meta analytics request failed');
        error.status = response.status;
        error.data = data;
        throw error;
    }
    return data;
}

function sumMessageAnalytics(data) {
    const points = data?.analytics?.data_points || [];
    return points.reduce((acc, point) => ({
        sent: acc.sent + toInt(point.sent),
        delivered: acc.delivered + toInt(point.delivered),
    }), { sent: 0, delivered: 0 });
}

function flattenConversationPoints(data) {
    const groups = data?.conversation_analytics?.data || [];
    return groups.flatMap((group) => Array.isArray(group.data_points) ? group.data_points : []);
}

function sumConversationAnalytics(data) {
    const points = flattenConversationPoints(data);
    return points.reduce((acc, point) => ({
        conversations: acc.conversations + toInt(point.conversation),
        cost: acc.cost + (Number(point.cost) || 0),
        currency: acc.currency || point.currency || null,
    }), { conversations: 0, cost: 0, currency: null });
}

function flattenPricingPoints(data) {
    const pricing = data?.pricing_analytics;
    if (!pricing) return [];
    if (Array.isArray(pricing.data_points)) return pricing.data_points;
    if (Array.isArray(pricing.data)) {
        return pricing.data.flatMap((group) => {
            if (Array.isArray(group.data_points)) return group.data_points;
            if (group && typeof group === 'object') return [group];
            return [];
        });
    }
    return [];
}

function sumPricingAnalytics(data) {
    const points = flattenPricingPoints(data);
    const byCategoryType = {};
    let volume = 0;
    let cost = 0;
    let currency = null;

    for (const point of points) {
        const pointVolume = toInt(point.volume);
        const pointCost = Number(point.cost) || 0;
        const category = normalizeMetaCategory(point.pricing_category || point.category) || 'unknown';
        const type = normalizePricingType(point.pricing_type || point.type) || 'unknown';
        const key = `${category}:${type}`;

        volume += pointVolume;
        cost += pointCost;
        currency = currency || point.currency || null;

        if (!byCategoryType[key]) {
            byCategoryType[key] = {
                pricing_category: category,
                pricing_type: type,
                volume: 0,
                cost: 0,
                currency: point.currency || null,
            };
        }
        byCategoryType[key].volume += pointVolume;
        byCategoryType[key].cost += pointCost;
        byCategoryType[key].currency = byCategoryType[key].currency || point.currency || null;
    }

    return {
        volume,
        cost,
        currency,
        points,
        by_category_type: Object.values(byCategoryType),
    };
}

function getLocalMetaReconciliation({ tenantId, periodStart, periodEnd }) {
    const startSql = normalizeSqlDate(periodStart);
    const endSql = normalizeSqlDate(periodEnd, true);

    const usage = db.prepare(`
        SELECT
            COALESCE(SUM(quantity), 0) AS usage_events,
            COALESCE(SUM(meta_estimated_amount), 0) AS estimated_amount,
            COALESCE(SUM(meta_final_amount), 0) AS final_amount
        FROM billing_usage_events
        WHERE tenant_id = ?
          AND channel = 'whatsapp'
          AND status = 'committed'
          AND committed_at >= ?
          AND committed_at <= ?
    `).get(tenantId, startSql, endSql);

    const messages = db.prepare(`
        SELECT
            COUNT(*) AS sent,
            SUM(CASE WHEN status IN ('delivered', 'read') THEN 1 ELSE 0 END) AS delivered
        FROM messages
        WHERE tenant_id = ?
          AND direction = 'outgoing'
          AND message_type IN ('text', 'template', 'image', 'document', 'video', 'audio', 'interactive')
          AND created_at >= ?
          AND created_at <= ?
    `).get(tenantId, startSql, endSql);

    const invoice = db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) AS total
        FROM meta_invoices
        WHERE tenant_id = ?
          AND (
              (period_start IS NULL AND period_end IS NULL)
              OR (date(COALESCE(period_start, ?)) <= date(?) AND date(COALESCE(period_end, ?)) >= date(?))
          )
    `).get(tenantId, periodStart, periodEnd, periodEnd, periodStart);

    return {
        local_sent: toInt(messages?.sent),
        local_delivered: toInt(messages?.delivered),
        local_billable_usage_events: toInt(usage?.usage_events),
        local_estimated_amount: Number(usage?.estimated_amount) || 0,
        local_final_amount: Number(usage?.final_amount) || 0,
        invoice_total_amount: Number(invoice?.total) || 0,
    };
}

export async function syncMetaUsageSnapshot({ tenantId, periodStart, periodEnd, granularity = 'MONTHLY', createdBy = null } = {}) {
    if (!tenantId || !periodStart || !periodEnd) {
        throw new BillingError('tenant_id و period_start و period_end مطلوبة لمزامنة استهلاك Meta', {
            status: 400,
            code: 'META_USAGE_SYNC_FIELDS_REQUIRED',
        });
    }

    const tenant = db.prepare('SELECT id, name, waba_id FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) {
        throw new BillingError('العميل غير موجود', { status: 404, code: 'TENANT_NOT_FOUND' });
    }
    if (!tenant.waba_id) {
        throw new BillingError('WABA ID غير موجود لهذا العميل', { status: 400, code: 'WABA_ID_REQUIRED' });
    }

    const accessToken = getAccessToken(tenantId);
    if (!accessToken) {
        throw new BillingError('رمز WhatsApp Business token مطلوب لمزامنة الاستهلاك', {
            status: 400,
            code: 'WHATSAPP_TOKEN_REQUIRED',
            permission_required: 'whatsapp_business_management',
        });
    }

    const startTs = toUnixSeconds(periodStart);
    const endTs = toUnixSeconds(periodEnd, true);
    if (!startTs || !endTs || endTs <= startTs) {
        throw new BillingError('نطاق التاريخ غير صالح', { status: 400, code: 'INVALID_PERIOD' });
    }

    const requestedGranularity = String(granularity || 'MONTHLY').toUpperCase();
    // Meta pricing_analytics can return empty aggregates for MONTHLY in some WABAs.
    // Pull daily points and aggregate locally so monthly comparisons stay reliable.
    const messageGranularity = 'DAY';
    const conversationGranularity = 'DAILY';
    const pricingGranularity = 'DAILY';
    const analyticsField = `analytics.start(${startTs}).end(${endTs}).granularity(${messageGranularity})`;
    const pricingField = `pricing_analytics.start(${startTs}).end(${endTs}).granularity(${pricingGranularity}).phone_numbers([]).dimensions(["PRICING_CATEGORY","PRICING_TYPE","COUNTRY","PHONE","TIER"])`;
    const conversationField = `conversation_analytics.start(${startTs}).end(${endTs}).granularity(${conversationGranularity}).phone_numbers([]).metric_types(["COST","CONVERSATION"]).dimensions(["CONVERSATION_CATEGORY","CONVERSATION_TYPE","COUNTRY","PHONE"])`;

    const [messagesResult, pricingResult, conversationsResult] = await Promise.allSettled([
        fetchWabaField(tenant.waba_id, analyticsField, accessToken),
        fetchWabaField(tenant.waba_id, pricingField, accessToken),
        fetchWabaField(tenant.waba_id, conversationField, accessToken),
    ]);

    const messagesOk = messagesResult.status === 'fulfilled';
    const pricingOk = pricingResult.status === 'fulfilled';
    const conversationsOk = conversationsResult.status === 'fulfilled';
    const rawMeta = {
        messages: messagesOk ? messagesResult.value : messagesResult.reason?.data || { error: messagesResult.reason?.message },
        pricing: pricingOk ? pricingResult.value : pricingResult.reason?.data || { error: pricingResult.reason?.message },
        conversations: conversationsOk ? conversationsResult.value : conversationsResult.reason?.data || { error: conversationsResult.reason?.message },
    };

    const messageTotals = messagesOk ? sumMessageAnalytics(messagesResult.value) : { sent: 0, delivered: 0 };
    const pricingTotals = pricingOk ? sumPricingAnalytics(pricingResult.value) : { volume: 0, cost: 0, currency: null, points: [], by_category_type: [] };
    const conversationTotals = conversationsOk ? sumConversationAnalytics(conversationsResult.value) : { conversations: 0, cost: 0, currency: null };
    const local = getLocalMetaReconciliation({ tenantId, periodStart, periodEnd });
    const metaCostAmount = pricingOk ? pricingTotals.cost : conversationTotals.cost;
    const metaCostCurrency = pricingTotals.currency || conversationTotals.currency || null;
    const status = messagesOk && pricingOk ? 'synced' : (messagesOk || pricingOk || conversationsOk ? 'partial' : 'failed');
    const errorMessage = [
        messagesOk ? null : `messages: ${messagesResult.reason?.message || 'failed'}`,
        pricingOk ? null : `pricing: ${pricingResult.reason?.message || 'failed'}`,
        conversationsOk ? null : `conversations: ${conversationsResult.reason?.message || 'failed'}`,
    ].filter(Boolean).join('; ') || null;

    const summary = {
        message_analytics_ok: messagesOk,
        pricing_analytics_ok: pricingOk,
        conversation_analytics_ok: conversationsOk,
        requested_granularity: requestedGranularity,
        fetched_granularity: 'DAILY',
        pricing_volume: pricingTotals.volume,
        pricing_breakdown: pricingTotals.by_category_type,
        local,
        note: pricingOk
            ? 'Meta pricing_analytics cost is approximate and may differ from final invoices.'
            : 'pricing_analytics was unavailable; conversation_analytics is used only as a historical fallback when possible.',
    };

    const inserted = db.prepare(`
        INSERT INTO meta_usage_snapshots (
            tenant_id, waba_id, period_start, period_end, granularity, status, currency,
            meta_sent, meta_delivered, meta_conversations, meta_cost_amount,
            local_sent, local_delivered, local_estimated_amount, local_final_amount,
            invoice_total_amount, diff_sent, diff_delivered, diff_cost_amount,
            summary_json, raw_meta_json, error_message, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        tenantId,
        tenant.waba_id,
        periodStart,
        periodEnd,
        String(granularity || 'MONTHLY').toUpperCase(),
        status,
        metaCostCurrency,
        messageTotals.sent,
        messageTotals.delivered,
        conversationTotals.conversations,
        metaCostAmount,
        local.local_sent,
        local.local_delivered,
        local.local_estimated_amount,
        local.local_final_amount,
        local.invoice_total_amount,
        messageTotals.sent - local.local_sent,
        messageTotals.delivered - local.local_delivered,
        metaCostAmount - local.local_final_amount,
        serializeJson(summary),
        serializeJson(rawMeta),
        errorMessage,
        createdBy || null
    );

    return db.prepare(`
        SELECT mus.*, t.name AS tenant_name
        FROM meta_usage_snapshots mus
        LEFT JOIN tenants t ON t.id = mus.tenant_id
        WHERE mus.id = ?
    `).get(inserted.lastInsertRowid);
}

export function getMetaUsageComparison({ tenantId, periodStart = null, periodEnd = null } = {}) {
    const params = [tenantId];
    let periodWhere = '';
    if (periodStart && periodEnd) {
        periodWhere = 'AND period_start = ? AND period_end = ?';
        params.push(periodStart, periodEnd);
    }

    const latestSnapshot = db.prepare(`
        SELECT *
        FROM meta_usage_snapshots
        WHERE tenant_id = ?
          ${periodWhere}
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `).get(...params) || null;

    const start = periodStart || latestSnapshot?.period_start || db.prepare("SELECT date('now', 'start of month') AS value").get().value;
    const end = periodEnd || latestSnapshot?.period_end || db.prepare("SELECT date('now') AS value").get().value;
    const local = tenantId ? getLocalMetaReconciliation({ tenantId, periodStart: start, periodEnd: end }) : null;

    return {
        tenant_id: tenantId || null,
        period_start: start,
        period_end: end,
        latest_snapshot: latestSnapshot,
        local,
        comparison: latestSnapshot ? {
            meta_sent: latestSnapshot.meta_sent,
            local_sent: local?.local_sent || 0,
            diff_sent: latestSnapshot.meta_sent - (local?.local_sent || 0),
            meta_delivered: latestSnapshot.meta_delivered,
            local_delivered: local?.local_delivered || 0,
            diff_delivered: latestSnapshot.meta_delivered - (local?.local_delivered || 0),
            meta_cost_amount: latestSnapshot.meta_cost_amount,
            local_final_amount: local?.local_final_amount || 0,
            invoice_total_amount: local?.invoice_total_amount || 0,
            diff_meta_vs_local_cost: latestSnapshot.meta_cost_amount - (local?.local_final_amount || 0),
            diff_invoice_vs_local_cost: (local?.invoice_total_amount || 0) - (local?.local_final_amount || 0),
        } : null,
    };
}

export function createMetaInvoice({ tenantId = null, businessId = null, wabaId = null, invoiceNumber = null, periodStart = null, periodEnd = null, currency = 'USD', subtotalAmount = 0, taxAmount = 0, totalAmount = null, status = 'received', invoiceUrl = null, notes = null, metadata = null, createdBy = null } = {}) {
    const total = totalAmount === null || totalAmount === undefined
        ? (Number(subtotalAmount) || 0) + (Number(taxAmount) || 0)
        : Number(totalAmount) || 0;

    const result = db.prepare(`
        INSERT INTO meta_invoices (
            tenant_id, business_id, waba_id, invoice_number, provider,
            period_start, period_end, currency, subtotal_amount, tax_amount,
            total_amount, status, invoice_url, notes, metadata_json, created_by
        ) VALUES (?, ?, ?, ?, 'meta', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        tenantId || null,
        businessId || null,
        wabaId || null,
        invoiceNumber || `META-${Date.now()}`,
        periodStart || null,
        periodEnd || null,
        String(currency || 'USD').toUpperCase(),
        Number(subtotalAmount) || 0,
        Number(taxAmount) || 0,
        total,
        status || 'received',
        invoiceUrl || null,
        notes || null,
        serializeJson(metadata),
        createdBy || null
    );

    return db.prepare('SELECT * FROM meta_invoices WHERE id = ?').get(result.lastInsertRowid);
}

export function handleBillingError(res, error) {
    if (error instanceof BillingError) {
        return res.status(error.status).json(error.toResponse());
    }
    return null;
}
