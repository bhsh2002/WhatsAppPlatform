import {
    BILLING_OPERATIONS,
    normalizeMetaCategory,
    normalizePhoneDigits,
    normalizeStatusPricing,
    toInt,
} from './billingCore.js';
import { isMetaLikeLocalPricing, localPricingModel } from './billingQuote.js';
import { normalizeSqlDate } from './billingPeriod.js';

const META_PRICED_WHATSAPP_OPERATIONS = new Set([
    BILLING_OPERATIONS.WHATSAPP_TEXT,
    BILLING_OPERATIONS.WHATSAPP_TEMPLATE,
    BILLING_OPERATIONS.WHATSAPP_MEDIA,
    BILLING_OPERATIONS.WHATSAPP_INTERACTIVE,
    BILLING_OPERATIONS.WHATSAPP_BROADCAST_RECIPIENT,
    BILLING_OPERATIONS.WHATSAPP_CONTACT_VERIFICATION_TEMPLATE,
]);

const hoursSince = (value) => {
    if (!value) return Number.POSITIVE_INFINITY;
    const parsed = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
    return (Date.now() - parsed.getTime()) / (60 * 60 * 1000);
};

const normalizeCallingCode = (value) => String(value || '').replace(/[^\d*]/g, '');

const effectiveDate = (db, value = null) => {
    if (!value) return db.prepare("SELECT date('now') AS value").get().value;
    return normalizeSqlDate(db, value).slice(0, 10);
};

const getTemplateCategory = (db, tenantId, templateName) => {
    if (!tenantId || !templateName) return null;
    const row = db.prepare(`
        SELECT category
        FROM templates
        WHERE tenant_id = ? AND name = ?
        ORDER BY id DESC
        LIMIT 1
    `).get(tenantId, templateName);
    return normalizeMetaCategory(row?.category);
};

const getContactWindow = (db, tenantId, recipient) => {
    if (!tenantId || !recipient) return null;
    return db.prepare(`
        SELECT last_customer_message_at, last_ctwa_received_at, last_ctwa_clid
        FROM contacts
        WHERE tenant_id = ? AND phone = ?
        LIMIT 1
    `).get(tenantId, normalizePhoneDigits(recipient)) || null;
};

export function getMonthlyTierVolume(db, {
    tenantId,
    countryCallingCode,
    category,
    currency = null,
    effectiveAt = null,
    excludeWamid = null,
} = {}) {
    const normalizedCode = normalizeCallingCode(countryCallingCode);
    const normalizedCategory = normalizeMetaCategory(category);
    if (!tenantId || !normalizedCode || !normalizedCategory) return 0;
    const dateValue = effectiveDate(db, effectiveAt);
    const monthStart = `${dateValue.slice(0, 7)}-01`;
    const nextMonth = db.prepare("SELECT date(?, '+1 month') AS value").get(monthStart).value;
    const params = [tenantId, normalizedCategory, normalizedCode, monthStart, nextMonth];
    const currencyClause = currency ? 'AND currency = ?' : '';
    const excludeClause = excludeWamid ? 'AND (wamid IS NULL OR wamid != ?)' : '';
    if (currency) params.push(String(currency).trim().toUpperCase());
    if (excludeWamid) params.push(String(excludeWamid));

    return toInt(db.prepare(`
        SELECT COUNT(*) AS count
        FROM billing_meta_message_costs
        WHERE tenant_id = ?
          AND LOWER(template_category) = ?
          AND country_calling_code = ?
          AND status IN ('pending', 'estimated', 'final', 'invoice_reconciled')
          AND sent_at >= ?
          AND sent_at < ?
          ${currencyClause}
          ${excludeClause}
    `).get(...params)?.count);
}

const findTierRate = (db, rows, context) => {
    if (rows.length === 0) return null;
    const code = normalizeCallingCode(rows[0].country_calling_code);
    const monthlyVolume = getMonthlyTierVolume(db, {
        tenantId: context.tenantId,
        countryCallingCode: code,
        category: context.category,
        currency: context.currency || rows[0].currency,
        effectiveAt: context.effectiveAt,
        excludeWamid: context.excludeWamid,
    });
    const ordinal = monthlyVolume + Math.max(toInt(context.tierOffset), 0) + 1;
    return rows.find((rate) => {
        const minimum = Math.max(toInt(rate.volume_tier_min, 1), 1);
        const maximum = rate.volume_tier_max === null || rate.volume_tier_max === undefined
            ? Number.POSITIVE_INFINITY
            : Math.max(toInt(rate.volume_tier_max), minimum);
        return ordinal >= minimum && ordinal <= maximum;
    }) || null;
};

export function chooseRateForRecipient(db, {
    tenantId = null,
    recipient,
    countryCallingCode,
    category,
    currency = 'USD',
    effectiveAt = null,
    tierOffset = 0,
    excludeWamid = null,
} = {}) {
    const normalizedCategory = normalizeMetaCategory(category);
    if (!normalizedCategory) return null;
    const digits = normalizePhoneDigits(recipient);
    const explicitCode = normalizeCallingCode(countryCallingCode);
    const normalizedCurrency = String(currency || 'USD').trim().toUpperCase();
    const dateValue = effectiveDate(db, effectiveAt);
    const params = [normalizedCategory, dateValue, dateValue, normalizedCurrency];

    const rows = db.prepare(`
        SELECT *
        FROM meta_whatsapp_rates
        WHERE is_active = 1
          AND LOWER(category) = ?
          AND date(effective_from) <= date(?)
          AND (effective_to IS NULL OR date(effective_to) >= date(?))
          AND currency = ?
        ORDER BY LENGTH(country_calling_code) DESC, volume_tier_min DESC, id DESC
    `).all(...params);
    const specificCodes = [...new Set(rows
        .map((rate) => normalizeCallingCode(rate.country_calling_code))
        .filter((code) => code && code !== '*'))]
        .sort((left, right) => right.length - left.length);
    const matchedCode = explicitCode && explicitCode !== '*'
        ? (specificCodes.includes(explicitCode) ? explicitCode : null)
        : specificCodes.find((code) => digits.startsWith(code)) || null;
    const context = {
        tenantId,
        category: normalizedCategory,
        currency: normalizedCurrency,
        effectiveAt,
        tierOffset,
        excludeWamid,
    };

    if (matchedCode) {
        const specificRate = findTierRate(
            db,
            rows.filter((rate) => normalizeCallingCode(rate.country_calling_code) === matchedCode),
            context
        );
        if (specificRate) return specificRate;
    }

    return findTierRate(
        db,
        rows.filter((rate) => normalizeCallingCode(rate.country_calling_code) === '*'),
        context
    );
}

export function evaluateSingleMetaCharge(db, {
    tenantId,
    operationKey,
    metadata = {},
    recipient = null,
    category = null,
    statusPricing = null,
    effectiveAt = null,
    tierOffset = 0,
} = {}) {
    const normalizedPricing = normalizeStatusPricing(statusPricing);
    if (!META_PRICED_WHATSAPP_OPERATIONS.has(operationKey)) {
        return {
            status: 'not_applicable', category: null, country_calling_code: null,
            currency: null, amount: 0, rate_card_id: null,
            reason: 'operation_not_meta_priced', pricing_basis: 'none',
        };
    }

    const messageType = String(metadata.message_type || metadata.type || '').toLowerCase();
    const operationDefaultCategory = [
        BILLING_OPERATIONS.WHATSAPP_TEXT,
        BILLING_OPERATIONS.WHATSAPP_MEDIA,
        BILLING_OPERATIONS.WHATSAPP_INTERACTIVE,
    ].includes(operationKey) ? 'service' : null;
    const resolvedCategory = normalizeMetaCategory(
        normalizedPricing?.category
        || category
        || metadata.template_category
        || getTemplateCategory(db, tenantId, metadata.template_name)
        || operationDefaultCategory
        || (messageType && messageType !== 'template' ? 'service' : null)
    );
    if (!resolvedCategory) {
        return {
            status: 'rate_missing', category: null, country_calling_code: null,
            currency: null, amount: 0, rate_card_id: null,
            reason: 'template_category_missing', pricing_basis: 'category_required',
        };
    }

    const pricingType = normalizedPricing?.type || null;
    const isMetaRegularCharge = pricingType === 'regular';
    const isMetaFreeCharge = ['free_customer_service', 'free_entry_point'].includes(pricingType);
    const billableFlag = normalizedPricing?.billable;
    const useLocalFreeWindowRules = !isMetaRegularCharge && billableFlag !== 1;
    if (isMetaFreeCharge || billableFlag === 0) {
        return {
            status: 'not_charged', category: resolvedCategory, country_calling_code: null,
            currency: null, amount: 0, rate_card_id: null,
            reason: isMetaFreeCharge ? `meta_pricing_type_${pricingType}` : 'meta_pricing_billable_false',
            pricing_basis: 'status_webhook',
        };
    }

    const target = recipient || metadata.recipient || metadata.to || metadata.phone || null;
    const contact = getContactWindow(db, tenantId, target);
    if (useLocalFreeWindowRules && contact?.last_ctwa_received_at && hoursSince(contact.last_ctwa_received_at) <= 72) {
        return {
            status: 'not_charged', category: resolvedCategory, country_calling_code: null,
            currency: null, amount: 0, rate_card_id: null,
            reason: 'free_entry_point_72h', pricing_basis: 'ctwa_window',
        };
    }
    if (useLocalFreeWindowRules && resolvedCategory === 'service') {
        return {
            status: 'not_charged', category: resolvedCategory, country_calling_code: null,
            currency: null, amount: 0, rate_card_id: null,
            reason: 'service_messages_free', pricing_basis: 'service_window',
        };
    }
    if (useLocalFreeWindowRules && resolvedCategory === 'utility' && contact?.last_customer_message_at && hoursSince(contact.last_customer_message_at) <= 24) {
        return {
            status: 'not_charged', category: resolvedCategory, country_calling_code: null,
            currency: null, amount: 0, rate_card_id: null,
            reason: 'utility_template_inside_24h_window', pricing_basis: 'customer_service_window',
        };
    }

    const rate = chooseRateForRecipient(db, {
        tenantId,
        recipient: target,
        countryCallingCode: metadata.country_calling_code,
        category: resolvedCategory,
        currency: metadata.meta_currency,
        effectiveAt,
        tierOffset,
        excludeWamid: metadata.exclude_wamid || metadata.wamid || null,
    });
    if (!rate) {
        return {
            status: 'rate_missing', category: resolvedCategory,
            country_calling_code: normalizeCallingCode(metadata.country_calling_code) || null,
            currency: metadata.meta_currency ? String(metadata.meta_currency).trim().toUpperCase() : null,
            amount: 0, rate_card_id: null,
            reason: 'meta_rate_not_configured', pricing_basis: 'manual_rate_card',
        };
    }
    return {
        status: 'estimated',
        category: resolvedCategory,
        country_calling_code: normalizeCallingCode(rate.country_calling_code),
        currency: rate.currency,
        amount: Number(rate.rate_amount) || 0,
        rate_card_id: rate.id,
        reason: 'matched_rate_card',
        pricing_basis: 'manual_rate_card',
    };
}

export function summarizeMetaEstimate(db, {
    tenantId,
    operationKey,
    quantity,
    metadata = {},
    statusPricing = null,
    effectiveAt = null,
} = {}) {
    const counts = metadata.recipient_country_counts && typeof metadata.recipient_country_counts === 'object'
        ? metadata.recipient_country_counts
        : null;
    if (counts && Object.keys(counts).length > 0) {
        let total = 0;
        let rateMissing = false;
        let category = normalizeMetaCategory(
            metadata.template_category || getTemplateCategory(db, tenantId, metadata.template_name)
        );
        let currency = null;
        const details = [];
        for (const [countryCallingCode, count] of Object.entries(counts)) {
            const normalizedCode = normalizeCallingCode(countryCallingCode);
            const rowCount = Math.max(toInt(count), 0);
            let countryTotal = 0;
            let lastEstimate = null;
            for (let index = 0; index < rowCount; index += 1) {
                const estimate = evaluateSingleMetaCharge(db, {
                    tenantId,
                    operationKey,
                    metadata: { ...metadata, country_calling_code: normalizedCode },
                    category,
                    statusPricing,
                    effectiveAt,
                    tierOffset: index,
                });
                lastEstimate = estimate;
                countryTotal += Number(estimate.amount) || 0;
                if (estimate.status === 'rate_missing') rateMissing = true;
                if (!currency && estimate.currency) currency = estimate.currency;
                if (!category && estimate.category) category = estimate.category;
            }
            total += countryTotal;
            details.push({
                country_calling_code: normalizedCode,
                count: rowCount,
                country_total: countryTotal,
                ...(lastEstimate || {}),
            });
        }
        return {
            status: rateMissing ? 'rate_missing' : (total > 0 ? 'estimated' : 'not_charged'),
            category,
            country_calling_code: Object.keys(counts).length === 1 ? normalizeCallingCode(Object.keys(counts)[0]) : 'mixed',
            currency,
            amount: total,
            rate_card_id: details.length === 1 ? details[0].rate_card_id : null,
            reason: rateMissing ? 'one_or_more_rates_missing' : (total > 0 ? 'matched_rate_card' : 'free_or_not_charged'),
            pricing_basis: 'manual_rate_card',
            details,
        };
    }

    const estimate = evaluateSingleMetaCharge(db, {
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

const activeRateCodes = (db) => [...new Set(db.prepare(`
    SELECT country_calling_code
    FROM meta_whatsapp_rates
    WHERE is_active = 1 AND country_calling_code != '*'
`).all().map((row) => normalizeCallingCode(row.country_calling_code)).filter(Boolean))]
    .sort((left, right) => right.length - left.length);

const detectCallingCode = (digits, rateCodes) => (
    rateCodes.find((code) => digits.startsWith(code)) || digits.slice(0, Math.min(3, digits.length))
);

export function summarizeMetaRecipientCountries(db, recipients = []) {
    const counts = {};
    const rateCodes = activeRateCodes(db);
    for (const recipient of recipients || []) {
        const digits = normalizePhoneDigits(recipient);
        if (!digits) continue;
        const code = detectCallingCode(digits, rateCodes);
        counts[code] = (counts[code] || 0) + 1;
    }
    return counts;
}

export function summarizeMetaLikeLocalRecipients(db, {
    tenantId,
    operationKey = BILLING_OPERATIONS.WHATSAPP_BROADCAST_RECIPIENT,
    recipients = [],
    templateName = null,
    templateCategory = null,
} = {}) {
    const summary = {
        recipient_count: 0,
        billable_count: 0,
        free_count: 0,
        free_24h_count: 0,
        free_ctwa_count: 0,
        service_free_count: 0,
        rate_missing_count: 0,
        billable_country_counts: {},
        all_country_counts: {},
        reasons: {},
    };
    const rateCodes = activeRateCodes(db);
    for (const recipient of recipients || []) {
        const normalizedRecipient = normalizePhoneDigits(recipient);
        if (!normalizedRecipient) continue;
        summary.recipient_count += 1;
        const countryCallingCode = detectCallingCode(normalizedRecipient, rateCodes);
        summary.all_country_counts[countryCallingCode] = (summary.all_country_counts[countryCallingCode] || 0) + 1;
        const estimate = evaluateSingleMetaCharge(db, {
            tenantId,
            operationKey,
            metadata: {
                recipient: normalizedRecipient,
                template_name: templateName,
                template_category: templateCategory,
                country_calling_code: countryCallingCode,
            },
            recipient: normalizedRecipient,
            category: templateCategory,
        });
        summary.reasons[estimate.reason] = (summary.reasons[estimate.reason] || 0) + 1;
        if (['not_charged', 'not_applicable'].includes(estimate.status)) {
            summary.free_count += 1;
            if (estimate.reason === 'free_entry_point_72h') summary.free_ctwa_count += 1;
            if (estimate.reason === 'utility_template_inside_24h_window') summary.free_24h_count += 1;
            if (estimate.reason === 'service_messages_free') summary.service_free_count += 1;
            continue;
        }
        summary.billable_count += 1;
        if (estimate.status === 'rate_missing') summary.rate_missing_count += 1;
        summary.billable_country_counts[countryCallingCode] = (summary.billable_country_counts[countryCallingCode] || 0) + 1;
    }
    return summary;
}

export function resolveLocalBillableQuantity(db, {
    tenantId,
    operationKey,
    recipients = [],
    templateName = null,
    templateCategory = null,
    fallbackQuantity = null,
} = {}) {
    const priceItem = db.prepare('SELECT * FROM billing_price_items WHERE operation_key = ?').get(operationKey);
    const fallback = fallbackQuantity === null || fallbackQuantity === undefined
        ? Math.max(toInt(recipients?.length, 0), 0)
        : Math.max(toInt(fallbackQuantity), 0);
    if (!isMetaLikeLocalPricing(priceItem)) {
        return { quantity: fallback, summary: null, pricing_model: localPricingModel(priceItem) };
    }
    const summary = summarizeMetaLikeLocalRecipients(db, {
        tenantId,
        operationKey,
        recipients,
        templateName,
        templateCategory,
    });
    return { quantity: summary.billable_count, summary, pricing_model: 'meta_like' };
}

export function operationKeyForWhatsAppMessage(messageType, fallback = BILLING_OPERATIONS.WHATSAPP_TEXT) {
    const type = String(messageType || '').toLowerCase();
    if (type === 'template') return BILLING_OPERATIONS.WHATSAPP_TEMPLATE;
    if (type === 'interactive') return BILLING_OPERATIONS.WHATSAPP_INTERACTIVE;
    if (['image', 'document', 'video', 'audio', 'sticker'].includes(type)) return BILLING_OPERATIONS.WHATSAPP_MEDIA;
    return fallback;
}
