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
const META_COST_DIFF_THRESHOLD = 0.01;
const META_RECONCILIATION_STATUSES = new Set(['open', 'synced', 'needs_review', 'invoice_reconciled']);
const LOCAL_PRICING_MODELS = new Set(['fixed', 'meta_like', 'meta_cost_plus_credits', 'free_tracked']);

const normalizeMetaCategory = (value) => {
    const category = String(value || '').trim().toLowerCase();
    if (['marketing', 'marketing_lite', 'utility', 'authentication', 'authentication_international', 'service', 'referral_conversion'].includes(category)) {
        return category;
    }
    return category || null;
};

const normalizePricingType = (value) => String(value || '').trim().toLowerCase();

const normalizePhoneDigits = (value) => String(value || '').replace(/[^\d]/g, '');

const normalizeBillableFlag = (value) => {
    if (value === true || value === 1 || value === 'true') return 1;
    if (value === false || value === 0 || value === 'false') return 0;
    return null;
};

const normalizeStatusPricing = (pricing = null) => {
    if (!pricing) return null;
    return {
        pricing_model: pricing.pricing_model || pricing.model || null,
        billable: normalizeBillableFlag(pricing.billable),
        category: normalizeMetaCategory(pricing.category || pricing.pricing_category),
        type: normalizePricingType(pricing.type || pricing.pricing_type),
    };
};

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

function getWindowSnapshot(contact = null) {
    return {
        customer_service_window_open: Boolean(contact?.last_customer_message_at && hoursSince(contact.last_customer_message_at) <= 24),
        ctwa_free_entry_open: Boolean(contact?.last_ctwa_received_at && hoursSince(contact.last_ctwa_received_at) <= 72),
    };
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

function localPricingModel(priceItem) {
    const model = String(priceItem?.local_pricing_model || 'fixed').trim().toLowerCase();
    return LOCAL_PRICING_MODELS.has(model) ? model : 'fixed';
}

function isMetaLikeLocalPricing(priceItem) {
    return localPricingModel(priceItem) === 'meta_like';
}

function isMetaCostPlusLocalPricing(priceItem) {
    return localPricingModel(priceItem) === 'meta_cost_plus_credits';
}

function isFreeTrackedLocalPricing(priceItem) {
    return localPricingModel(priceItem) === 'free_tracked';
}

function metaCostBasis(priceItem) {
    const basis = String(priceItem?.meta_cost_basis || '').trim().toLowerCase();
    if (['meta_billed', 'meta_free', 'platform_fee', 'not_applicable'].includes(basis)) return basis;
    if (isMetaCostPlusLocalPricing(priceItem)) return 'meta_billed';
    if (isFreeTrackedLocalPricing(priceItem)) return 'meta_free';
    return 'platform_fee';
}

function tenantVisibleUsage(priceItem) {
    return priceItem?.tenant_visible_usage === undefined || priceItem?.tenant_visible_usage === null
        ? true
        : Boolean(priceItem.tenant_visible_usage);
}

function getBillingSettingsValues() {
    return getBillingSettings().settings;
}

function getBooleanSetting(value, fallback = false) {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function calculateCustomerCreditsFromMetaCost(metaAmount, settings = getBillingSettingsValues()) {
    const exchangeRate = Math.max(Number(settings.meta_cost_exchange_rate_to_lyd) || 1, 0);
    const creditValueLyd = Math.max(Number(settings.credit_value_lyd) || 0.1, 0.0001);
    const marginPercent = Math.max(Number(settings.meta_cost_margin_percent) || 0, 0);
    const metaCostAmount = Math.max(Number(metaAmount) || 0, 0);
    const metaCostLyd = metaCostAmount * exchangeRate;
    const customerChargeLyd = metaCostLyd * (1 + marginPercent / 100);
    const credits = customerChargeLyd > 0 ? Math.ceil(customerChargeLyd / creditValueLyd) : 0;

    return {
        credits,
        meta_cost_lyd: metaCostLyd,
        customer_charge_lyd: customerChargeLyd,
        credit_value_lyd: creditValueLyd,
        exchange_rate_to_lyd: exchangeRate,
        margin_percent: marginPercent,
    };
}

function getMonthlyTierVolume({ tenantId, countryCallingCode, category, currency = null, effectiveAt = null, excludeWamid = null } = {}) {
    if (!tenantId || !countryCallingCode || !category) return 0;
    const parsed = effectiveAt ? new Date(String(effectiveAt).replace(' ', 'T')) : new Date();
    if (Number.isNaN(parsed.getTime())) return 0;
    const monthStart = new Date(parsed.getFullYear(), parsed.getMonth(), 1).toISOString().slice(0, 10);
    const nextMonth = new Date(parsed.getFullYear(), parsed.getMonth() + 1, 1).toISOString().slice(0, 10);
    const params = [tenantId, normalizeMetaCategory(category), String(countryCallingCode), monthStart, nextMonth];
    const currencyClause = currency ? 'AND currency = ?' : '';
    const excludeClause = excludeWamid ? 'AND (wamid IS NULL OR wamid != ?)' : '';
    if (currency) params.push(String(currency).toUpperCase());
    if (excludeWamid) params.push(String(excludeWamid));

    const costs = db.prepare(`
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
    `).get(...params)?.count || 0;

    return toInt(costs);
}

function chooseRateForRecipient({ tenantId = null, recipient, countryCallingCode, category, currency = null, effectiveAt = null, tierOffset = 0, excludeWamid = null }) {
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

    const matchingRows = rows.filter((rate) => {
        const code = String(rate.country_calling_code || '').replace(/[^\d*]/g, '');
        if (countryCallingCode && code === String(countryCallingCode)) return true;
        if (code === '*') return true;
        return code && digits.startsWith(code);
    });

    if (matchingRows.length === 0) return null;

    const matchedCode = String(matchingRows[0].country_calling_code || '').replace(/[^\d*]/g, '');
    const monthlyVolume = getMonthlyTierVolume({
        tenantId,
        countryCallingCode: matchedCode,
        category: normalizedCategory,
        currency: currency || matchingRows[0].currency,
        effectiveAt,
        excludeWamid,
    });
    const ordinal = monthlyVolume + Math.max(toInt(tierOffset), 0) + 1;
    return matchingRows.find((rate) => {
        const min = Math.max(toInt(rate.volume_tier_min, 1), 1);
        const max = rate.volume_tier_max ? Math.max(toInt(rate.volume_tier_max), min) : Number.POSITIVE_INFINITY;
        return ordinal >= min && ordinal <= max;
    }) || matchingRows[0];
}

function evaluateSingleMetaCharge({ tenantId, operationKey, metadata = {}, recipient = null, category = null, statusPricing = null, effectiveAt = null, tierOffset = 0 }) {
    const normalizedPricing = normalizeStatusPricing(statusPricing);
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
        normalizedPricing?.category
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

    const pricingType = normalizedPricing?.type || null;
    const isMetaRegularCharge = pricingType === 'regular';
    const isMetaFreeCharge = ['free_customer_service', 'free_entry_point'].includes(pricingType);
    const billableFlag = normalizedPricing?.billable;
    const useLocalFreeWindowRules = !isMetaRegularCharge && billableFlag !== 1;
    if (isMetaFreeCharge || billableFlag === 0) {
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
    if (useLocalFreeWindowRules && contact?.last_ctwa_received_at && hoursSince(contact.last_ctwa_received_at) <= 72) {
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

    if (useLocalFreeWindowRules && resolvedCategory === 'service') {
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

    if (useLocalFreeWindowRules && resolvedCategory === 'utility' && contact?.last_customer_message_at && hoursSince(contact.last_customer_message_at) <= 24) {
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
            const rowCount = Math.max(toInt(count), 0);
            let countryTotal = 0;
            let lastEstimate = null;
            for (let i = 0; i < rowCount; i += 1) {
                const estimate = evaluateSingleMetaCharge({
                    tenantId,
                    operationKey,
                    metadata: { ...metadata, country_calling_code: countryCallingCode },
                    category,
                    statusPricing,
                    effectiveAt,
                    tierOffset: i,
                });
                lastEstimate = estimate;
                countryTotal += Number(estimate.amount) || 0;
                if (estimate.status === 'rate_missing') rateMissing = true;
                if (!currency && estimate.currency) currency = estimate.currency;
                if (!category && estimate.category) category = estimate.category;
            }
            total += countryTotal;
            details.push({ country_calling_code: countryCallingCode, count: rowCount, country_total: countryTotal, ...(lastEstimate || {}) });
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

function operationKeyForWhatsAppMessage(messageType, fallback = BILLING_OPERATIONS.WHATSAPP_TEXT) {
    const type = String(messageType || '').toLowerCase();
    if (type === 'template') return BILLING_OPERATIONS.WHATSAPP_TEMPLATE;
    if (type === 'interactive') return BILLING_OPERATIONS.WHATSAPP_INTERACTIVE;
    if (['image', 'document', 'video', 'audio', 'sticker'].includes(type)) return BILLING_OPERATIONS.WHATSAPP_MEDIA;
    return fallback;
}

export function recordMetaMessageCost({
    tenantId,
    usageEventId = null,
    broadcastJobId = null,
    wamid = null,
    recipient = null,
    operationKey = BILLING_OPERATIONS.WHATSAPP_TEXT,
    messageType = null,
    templateName = null,
    templateCategory = null,
    metadata = {},
    sentAt = null,
} = {}) {
    if (!tenantId || !wamid) return null;

    const normalizedMetadata = {
        ...(metadata || {}),
        recipient: recipient || metadata?.recipient || metadata?.to || metadata?.phone || null,
        message_type: messageType || metadata?.message_type || metadata?.type || null,
        template_name: templateName || metadata?.template_name || null,
        template_category: templateCategory || metadata?.template_category || null,
    };
    const estimate = summarizeMetaEstimate({
        tenantId,
        operationKey,
        quantity: 1,
        metadata: normalizedMetadata,
        effectiveAt: sentAt || null,
    });
    const awaitStatusPricing = normalizedMetadata.local_pricing_model === 'meta_cost_plus_credits'
        || normalizedMetadata.await_status_pricing === true;
    const pendingStatus = awaitStatusPricing || estimate.status === 'estimated' ? 'pending' : estimate.status;

    db.prepare(`
        INSERT INTO billing_meta_message_costs (
            tenant_id, usage_event_id, broadcast_job_id, wamid, recipient,
            operation_key, message_type, template_name, template_category,
            country_calling_code, currency, estimated_amount, final_amount,
            rate_card_id, status, charge_reason, calculation_basis,
            metadata_json, sent_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, ${nowSql}))
        ON CONFLICT(wamid) DO UPDATE SET
            usage_event_id = COALESCE(excluded.usage_event_id, billing_meta_message_costs.usage_event_id),
            broadcast_job_id = COALESCE(excluded.broadcast_job_id, billing_meta_message_costs.broadcast_job_id),
            recipient = COALESCE(excluded.recipient, billing_meta_message_costs.recipient),
            operation_key = excluded.operation_key,
            message_type = COALESCE(excluded.message_type, billing_meta_message_costs.message_type),
            template_name = COALESCE(excluded.template_name, billing_meta_message_costs.template_name),
            template_category = COALESCE(excluded.template_category, billing_meta_message_costs.template_category),
            country_calling_code = COALESCE(excluded.country_calling_code, billing_meta_message_costs.country_calling_code),
            currency = COALESCE(excluded.currency, billing_meta_message_costs.currency),
            estimated_amount = excluded.estimated_amount,
            final_amount = CASE WHEN excluded.status = 'not_charged' THEN 0 ELSE billing_meta_message_costs.final_amount END,
            rate_card_id = COALESCE(excluded.rate_card_id, billing_meta_message_costs.rate_card_id),
            status = CASE
                WHEN billing_meta_message_costs.status IN ('final', 'not_charged', 'invoice_reconciled') THEN billing_meta_message_costs.status
                ELSE excluded.status
            END,
            charge_reason = excluded.charge_reason,
            calculation_basis = excluded.calculation_basis,
            metadata_json = excluded.metadata_json,
            updated_at = ${nowSql}
    `).run(
        tenantId,
        usageEventId || null,
        broadcastJobId || null,
        wamid,
        normalizedMetadata.recipient,
        operationKey,
        normalizedMetadata.message_type,
        normalizedMetadata.template_name,
        normalizedMetadata.template_category || estimate.category || null,
        estimate.country_calling_code,
        estimate.currency,
        Number(estimate.amount) || 0,
        pendingStatus === 'not_charged' ? 0 : 0,
        estimate.rate_card_id,
        pendingStatus,
        estimate.reason,
        estimate.pricing_basis,
        serializeJson({ ...normalizedMetadata, meta_estimate_details: estimate.details || undefined }),
        sentAt || null
    );

    return db.prepare('SELECT * FROM billing_meta_message_costs WHERE wamid = ?').get(wamid);
}

function upsertMetaMessageCostFromStatus({ usage = null, wamid, status, pricing = null, timestamp = null }) {
    if (!wamid) return null;

    let cost = db.prepare('SELECT * FROM billing_meta_message_costs WHERE wamid = ?').get(wamid);
    let message = null;
    if (!cost) {
        message = db.prepare(`
            SELECT tenant_id, recipient, message_type, created_at
            FROM messages
            WHERE wamid = ?
            ORDER BY id DESC
            LIMIT 1
        `).get(wamid) || null;

        const tenantId = usage?.tenant_id || message?.tenant_id || null;
        if (!tenantId) return null;

        cost = recordMetaMessageCost({
            tenantId,
            usageEventId: usage?.id || null,
            wamid,
            recipient: message?.recipient || null,
            operationKey: usage?.operation_key || operationKeyForWhatsAppMessage(message?.message_type),
            messageType: message?.message_type || null,
            metadata: parseJson(usage?.metadata_json, {}),
            sentAt: message?.created_at || usage?.committed_at || null,
        });
    }

    const normalizedStatus = String(status || '').toLowerCase();
    const normalizedPricing = normalizeStatusPricing(pricing);
    const statusPayload = {
        status: normalizedStatus || null,
        timestamp: timestamp || null,
        pricing: normalizedPricing,
    };

    if (['failed', 'undelivered'].includes(normalizedStatus)) {
        db.prepare(`
            UPDATE billing_meta_message_costs
            SET status = 'not_charged',
                billable = 0,
                final_amount = 0,
                charge_reason = ?,
                status_payload_json = ?,
                updated_at = ${nowSql}
            WHERE wamid = ?
        `).run(`message_${normalizedStatus}`, serializeJson(statusPayload), wamid);
        return db.prepare('SELECT * FROM billing_meta_message_costs WHERE wamid = ?').get(wamid);
    }

    if (!['delivered', 'read'].includes(normalizedStatus)) {
        return cost;
    }

    const metadata = {
        ...parseJson(cost?.metadata_json, {}),
        ...parseJson(usage?.metadata_json, {}),
        recipient: cost?.recipient || parseJson(usage?.metadata_json, {}).recipient || null,
        message_type: cost?.message_type || parseJson(usage?.metadata_json, {}).message_type || null,
        template_name: cost?.template_name || parseJson(usage?.metadata_json, {}).template_name || null,
        template_category: normalizedPricing?.category || cost?.template_category || parseJson(usage?.metadata_json, {}).template_category || null,
    };
    const estimate = summarizeMetaEstimate({
        tenantId: cost.tenant_id,
        operationKey: cost.operation_key || usage?.operation_key || operationKeyForWhatsAppMessage(metadata.message_type),
        quantity: 1,
        metadata: { ...metadata, exclude_wamid: wamid },
        statusPricing: pricing || null,
        effectiveAt: timestamp ? sqlDate(Number(timestamp) * 1000) : null,
    });
    const finalStatus = estimate.status === 'estimated' ? 'final' : estimate.status;

    db.prepare(`
        UPDATE billing_meta_message_costs
        SET template_category = COALESCE(?, template_category),
            pricing_type = ?,
            pricing_model = ?,
            billable = ?,
            country_calling_code = ?,
            currency = ?,
            estimated_amount = CASE WHEN COALESCE(estimated_amount, 0) = 0 THEN ? ELSE estimated_amount END,
            final_amount = ?,
            rate_card_id = ?,
            status = ?,
            charge_reason = ?,
            calculation_basis = ?,
            status_payload_json = ?,
            delivered_at = COALESCE(delivered_at, ?),
            updated_at = ${nowSql}
        WHERE wamid = ?
    `).run(
        estimate.category,
        normalizedPricing?.type || null,
        normalizedPricing?.pricing_model || null,
        normalizedPricing?.billable,
        estimate.country_calling_code,
        estimate.currency,
        Number(estimate.amount) || 0,
        finalStatus === 'rate_missing' ? 0 : Number(estimate.amount) || 0,
        estimate.rate_card_id,
        finalStatus,
        normalizedPricing?.pricing_model ? `${estimate.reason}; pricing_model=${normalizedPricing.pricing_model}` : estimate.reason,
        pricing ? 'status_webhook' : estimate.pricing_basis,
        serializeJson(statusPayload),
        timestamp ? sqlDate(Number(timestamp) * 1000) : sqlDate(),
        wamid
    );

    return db.prepare('SELECT * FROM billing_meta_message_costs WHERE wamid = ?').get(wamid);
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
        statusPricing: metadata.status_pricing || metadata.statusPricing || null,
        effectiveAt: usage.committed_at || null,
    });
    const shouldWaitForStatusWebhook = usage.reference_type === 'message'
        && estimate.status === 'estimated'
        && !(metadata.status_pricing || metadata.statusPricing);
    const metaChargeStatus = shouldWaitForStatusWebhook ? 'pending' : estimate.status;

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
        metaChargeStatus,
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

export function summarizeMetaLikeLocalRecipients({
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

    for (const recipient of recipients || []) {
        const normalizedRecipient = normalizePhoneDigits(recipient);
        if (!normalizedRecipient) continue;
        summary.recipient_count += 1;

        const countryCounts = summarizeMetaRecipientCountries([normalizedRecipient]);
        const countryCallingCode = Object.keys(countryCounts)[0] || normalizedRecipient.slice(0, Math.min(3, normalizedRecipient.length));
        summary.all_country_counts[countryCallingCode] = (summary.all_country_counts[countryCallingCode] || 0) + 1;

        const estimate = evaluateSingleMetaCharge({
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
        if (estimate.status === 'not_charged' || estimate.status === 'not_applicable') {
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

export function resolveLocalBillableQuantity({
    tenantId,
    operationKey,
    recipients = [],
    templateName = null,
    templateCategory = null,
    fallbackQuantity = null,
} = {}) {
    const priceItem = getPriceItem(operationKey);
    const fallback = fallbackQuantity === null || fallbackQuantity === undefined
        ? Math.max(toInt(recipients?.length, 0), 0)
        : Math.max(toInt(fallbackQuantity), 0);

    if (!isMetaLikeLocalPricing(priceItem)) {
        return {
            quantity: fallback,
            summary: null,
            pricing_model: localPricingModel(priceItem),
        };
    }

    const summary = summarizeMetaLikeLocalRecipients({
        tenantId,
        operationKey,
        recipients,
        templateName,
        templateCategory,
    });

    return {
        quantity: summary.billable_count,
        summary,
        pricing_model: 'meta_like',
    };
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

function applyFreeTrackedPricing({ quantity, priceItem }) {
    if (!isFreeTrackedLocalPricing(priceItem)) return null;
    return {
        quantity,
        unit_price_credits: 0,
        total_credits: 0,
        billable: false,
        track_usage: Boolean(priceItem?.is_active && tenantVisibleUsage(priceItem)),
        customer_charge_type: 'free_meta',
        reason: 'free_tracked_pricing',
        details: {
            status: 'not_charged',
            pricing_basis: 'free_tracked',
            meta_cost_basis: metaCostBasis(priceItem),
            pricing_note: priceItem?.pricing_note || null,
        },
    };
}

function applyLocalMetaLikePricing({ tenantId, operationKey, quantity, unitPrice, metadata = {}, priceItem }) {
    if (!isMetaLikeLocalPricing(priceItem) || !META_PRICED_WHATSAPP_OPERATIONS.has(operationKey)) {
        return {
            quantity,
            unit_price_credits: unitPrice,
            total_credits: unitPrice * quantity,
            billable: unitPrice > 0 && quantity > 0,
            track_usage: unitPrice > 0 && quantity > 0,
            customer_charge_type: unitPrice > 0 ? 'platform_fee' : 'not_charged',
            reason: 'fixed_pricing',
            details: null,
        };
    }

    if (metadata?.meta_like_billable_quantity !== undefined && metadata?.meta_like_billable_quantity !== null) {
        const billableQuantity = Math.max(Math.min(toInt(metadata.meta_like_billable_quantity), quantity), 0);
        return {
            quantity: billableQuantity,
            unit_price_credits: unitPrice,
            total_credits: billableQuantity * unitPrice,
            billable: unitPrice > 0 && billableQuantity > 0,
            track_usage: unitPrice > 0 && billableQuantity > 0,
            customer_charge_type: unitPrice > 0 && billableQuantity > 0 ? 'paid_meta_like' : 'free_meta',
            reason: 'meta_like_precomputed_recipients',
            details: metadata.meta_like_summary || null,
        };
    }

    const estimate = summarizeMetaEstimate({
        tenantId,
        operationKey,
        quantity,
        metadata,
        effectiveAt: null,
    });
    const isFree = estimate.status === 'not_charged' || estimate.status === 'not_applicable';
    return {
        quantity,
        unit_price_credits: isFree ? 0 : unitPrice,
        total_credits: isFree ? 0 : unitPrice * quantity,
        billable: !isFree && unitPrice > 0 && quantity > 0,
        track_usage: quantity > 0,
        customer_charge_type: isFree ? 'free_meta' : 'paid_meta_like',
        reason: estimate.reason,
        details: {
            status: estimate.status,
            category: estimate.category,
            pricing_basis: estimate.pricing_basis,
        },
    };
}

function applyLocalMetaCostPlusPricing({ tenantId, operationKey, quantity, metadata = {}, priceItem }) {
    if (!isMetaCostPlusLocalPricing(priceItem) || !META_PRICED_WHATSAPP_OPERATIONS.has(operationKey)) {
        return null;
    }

    const target = metadata.recipient || metadata.to || metadata.phone || null;
    const contact = getContactWindow(tenantId, target);
    const windowSnapshot = getWindowSnapshot(contact);
    const isFreeFormOperation = [
        BILLING_OPERATIONS.WHATSAPP_TEXT,
        BILLING_OPERATIONS.WHATSAPP_MEDIA,
        BILLING_OPERATIONS.WHATSAPP_INTERACTIVE,
    ].includes(operationKey);

    if (isFreeFormOperation && !windowSnapshot.customer_service_window_open && !windowSnapshot.ctwa_free_entry_open) {
        return {
            quantity,
            unit_price_credits: 0,
            total_credits: 0,
            billable: true,
            track_usage: true,
            customer_charge_type: 'blocked',
            reason: 'customer_service_window_closed',
            details: {
                status: 'blocked',
                pricing_basis: 'customer_service_window',
                ...windowSnapshot,
            },
        };
    }

    const estimate = summarizeMetaEstimate({
        tenantId,
        operationKey,
        quantity,
        metadata,
        effectiveAt: null,
    });
    const settings = getBillingSettingsValues();
    const charge = calculateCustomerCreditsFromMetaCost(estimate.amount, settings);
    const notCharged = ['not_charged', 'not_applicable'].includes(estimate.status);
    const rateMissing = estimate.status === 'rate_missing';

    return {
        quantity,
        unit_price_credits: quantity > 0 ? Math.ceil(charge.credits / quantity) : 0,
        total_credits: notCharged || rateMissing ? 0 : charge.credits,
        billable: rateMissing || (!notCharged && quantity > 0),
        track_usage: quantity > 0,
        customer_charge_type: rateMissing ? 'needs_review' : (notCharged ? 'pending_meta' : 'pending_meta'),
        reason: rateMissing ? 'meta_rate_missing' : estimate.reason,
        details: {
            status: estimate.status,
            category: estimate.category,
            country_calling_code: estimate.country_calling_code,
            currency: estimate.currency,
            amount: estimate.amount,
            rate_card_id: estimate.rate_card_id,
            pricing_basis: estimate.pricing_basis,
            customer_charge: charge,
            template_category_sent: metadata.template_category || null,
            ...windowSnapshot,
        },
    };
}

export function quote({ tenantId, operationKey, quantity = 1, metadata = null } = {}) {
    const normalizedQuantity = Math.max(toInt(quantity, 1), 1);
    const priceItem = getPriceItem(operationKey);
    const unitPrice = priceItem?.is_active && priceItem?.is_billable ? toInt(priceItem.unit_price_credits, 1) : 0;
    const freeTrackedPricing = applyFreeTrackedPricing({
        quantity: normalizedQuantity,
        priceItem,
    });
    const metaCostPlusPricing = applyLocalMetaCostPlusPricing({
        tenantId,
        operationKey,
        quantity: normalizedQuantity,
        metadata: metadata || {},
        priceItem,
    });
    const localPricing = freeTrackedPricing || metaCostPlusPricing || applyLocalMetaLikePricing({
        tenantId,
        operationKey,
        quantity: normalizedQuantity,
        unitPrice,
        metadata: metadata || {},
        priceItem,
    });
    const account = tenantId ? ensureTenantBillingAccount(tenantId) : null;
    const reservedCredits = tenantId ? getReservedCredits(tenantId) : 0;
    const availability = account ? computeAvailable(account, reservedCredits) : null;

    return {
        tenant_id: tenantId || null,
        operation_key: operationKey,
        quantity: localPricing.quantity,
        requested_quantity: normalizedQuantity,
        price_item: priceItem || null,
        channel: priceItem?.channel || null,
        operation_type: priceItem?.operation_type || null,
        unit_price_credits: localPricing.unit_price_credits,
        total_credits: localPricing.total_credits,
        billable: Boolean(priceItem?.is_active && priceItem?.is_billable && localPricing.billable),
        track_usage: Boolean(priceItem?.is_active && tenantVisibleUsage(priceItem) && localPricing.track_usage),
        tenant_visible_usage: tenantVisibleUsage(priceItem),
        customer_charge_type: localPricing.customer_charge_type || 'platform_fee',
        meta_cost_basis: metaCostBasis(priceItem),
        local_pricing_model: localPricingModel(priceItem),
        local_pricing_reason: localPricing.reason,
        local_pricing_details: localPricing.details,
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

        const currentQuote = quote({ tenantId, operationKey, quantity, metadata });
        const shouldTrackMetaCostPlus = currentQuote.local_pricing_model === 'meta_cost_plus_credits'
            && META_PRICED_WHATSAPP_OPERATIONS.has(operationKey)
            && Boolean(currentQuote.price_item?.is_active && currentQuote.price_item?.is_billable);
        const shouldTrackFreeUsage = currentQuote.local_pricing_model === 'free_tracked'
            && Boolean(currentQuote.price_item?.is_active && currentQuote.track_usage);
        const pricingDetails = currentQuote.local_pricing_details || {};
        const settings = getBillingSettingsValues();

        if (shouldTrackMetaCostPlus && pricingDetails.status === 'blocked') {
            throw new BillingError('نافذة خدمة عملاء WhatsApp مغلقة؛ يمكن إرسال القوالب المعتمدة فقط', {
                status: 400,
                code: 'WHATSAPP_CUSTOMER_SERVICE_WINDOW_CLOSED',
                operation: operationKey,
            });
        }

        if (
            shouldTrackMetaCostPlus
            && pricingDetails.status === 'rate_missing'
            && getBooleanSetting(settings.strict_meta_rate_required, true)
        ) {
            throw new BillingError('سعر Meta غير مضبوط لهذه الدولة أو فئة الرسالة', {
                status: 402,
                code: 'META_RATE_MISSING',
                operation: operationKey,
                meta_category: pricingDetails.category || null,
                country_calling_code: pricingDetails.country_calling_code || null,
            });
        }

        if ((!currentQuote.billable || currentQuote.total_credits <= 0) && !shouldTrackMetaCostPlus && !shouldTrackFreeUsage) {
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
                reference_type, reference_id, idempotency_key, metadata_json,
                reserved_credits, final_credits, meta_charge_status, meta_pricing_basis,
                meta_charge_category, meta_country_calling_code, meta_charge_currency,
                meta_estimated_amount, meta_rate_card_id, meta_charge_reason,
                meta_cost_lyd, customer_charge_lyd, customer_service_window_open,
                ctwa_free_entry_open, template_category_sent, pricing_decision_reason,
                billing_formula_json, customer_charge_type, tenant_visible_usage
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            serializeJson({
                ...(metadata || {}),
                local_pricing_model: currentQuote.local_pricing_model,
                local_pricing_reason: currentQuote.local_pricing_reason,
                local_pricing_details: currentQuote.local_pricing_details,
                meta_cost_basis: currentQuote.meta_cost_basis,
                customer_charge_type: currentQuote.customer_charge_type,
                requested_quantity: currentQuote.requested_quantity,
            }),
            currentQuote.total_credits,
            shouldTrackMetaCostPlus
                ? (pricingDetails.status === 'rate_missing' ? 'rate_missing' : 'pending')
                : (shouldTrackFreeUsage ? 'not_charged' : 'not_applicable'),
            pricingDetails.pricing_basis || null,
            pricingDetails.category || null,
            pricingDetails.country_calling_code || null,
            pricingDetails.currency || null,
            Number(pricingDetails.amount) || 0,
            pricingDetails.rate_card_id || null,
            currentQuote.local_pricing_reason || null,
            Number(pricingDetails.customer_charge?.meta_cost_lyd) || 0,
            Number(pricingDetails.customer_charge?.customer_charge_lyd) || 0,
            pricingDetails.customer_service_window_open === undefined ? null : (pricingDetails.customer_service_window_open ? 1 : 0),
            pricingDetails.ctwa_free_entry_open === undefined ? null : (pricingDetails.ctwa_free_entry_open ? 1 : 0),
            pricingDetails.template_category_sent || metadata?.template_category || null,
            currentQuote.local_pricing_reason || null,
            serializeJson(pricingDetails.customer_charge || null),
            currentQuote.customer_charge_type,
            currentQuote.tenant_visible_usage ? 1 : 0
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

function shouldDeferMetaLikeLocalCommit(usage, metadata, options = {}) {
    if (options.forceCommit) return false;
    if (options.deferUntilDelivered === false) return false;
    if (usage.channel !== 'whatsapp') return false;
    if (!['message', 'api_message'].includes(String(usage.reference_type || ''))) return false;
    if (!options.referenceId && !usage.reference_id) return false;
    return ['meta_like', 'meta_cost_plus_credits'].includes(metadata?.local_pricing_model);
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
        const metadata = {
            ...(usage.metadata_json ? JSON.parse(usage.metadata_json) : {}),
            reserved_quantity: originalQuantity,
            committed_quantity: commitQuantity,
            released_quantity: originalQuantity - commitQuantity,
        };

        if (shouldDeferMetaLikeLocalCommit(usage, metadata, options)) {
            db.prepare(`
                UPDATE billing_usage_events
                SET quantity = ?,
                    total_credits = ?,
                    reserved_credits = COALESCE(NULLIF(reserved_credits, 0), ?),
                    reference_id = COALESCE(?, reference_id),
                    metadata_json = ?
                WHERE id = ?
            `).run(
                commitQuantity,
                toInt(usage.total_credits),
                toInt(usage.total_credits),
                options.referenceId || null,
                serializeJson({
                    ...metadata,
                    local_pricing_deferred_until: 'delivered_or_read',
                }),
                usage.id
            );

            const deferredUsage = db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
            const deferredMetadata = parseJson(deferredUsage.metadata_json, {});
            if (deferredUsage.reference_id) {
                recordMetaMessageCost({
                    tenantId: deferredUsage.tenant_id,
                    usageEventId: deferredUsage.id,
                    wamid: deferredUsage.reference_id,
                    recipient: deferredMetadata.recipient || deferredMetadata.to || deferredMetadata.phone || null,
                    operationKey: deferredUsage.operation_key,
                    messageType: deferredMetadata.message_type || deferredMetadata.type || null,
                    templateName: deferredMetadata.template_name || null,
                    templateCategory: deferredMetadata.template_category || null,
                    metadata: deferredMetadata,
                    sentAt: deferredUsage.reserved_at,
                });
            }

            syncTenantCredits(usage.tenant_id);
            return deferredUsage;
        }

        if (commitQuantity === 0) {
            return release(usage, options.errorMessage || 'No successful billable operations');
        }

        const unitPrice = toInt(usage.unit_price_credits);
        const chargedCredits = options.finalCredits === undefined
            ? commitQuantity * unitPrice
            : Math.max(toInt(options.finalCredits), 0);

        if (chargedCredits <= 0) {
            const freeChargeType = options.customerChargeType
                || metadata.customer_charge_type
                || usage.customer_charge_type
                || (usage.meta_charge_status === 'not_charged' ? 'free_meta' : 'not_charged');

            db.prepare(`
                UPDATE billing_usage_events
                SET quantity = ?,
                    unit_price_credits = 0,
                    total_credits = 0,
                    final_credits = 0,
                    status = 'committed',
                    reference_id = COALESCE(?, reference_id),
                    metadata_json = ?,
                    customer_charge_type = ?,
                    committed_at = ${nowSql}
                WHERE id = ?
            `).run(
                commitQuantity,
                options.referenceId || null,
                serializeJson({
                    ...metadata,
                    customer_charge_type: freeChargeType,
                    free_usage_committed: true,
                }),
                freeChargeType,
                usage.id
            );

            if (options.meta || usage.channel === 'whatsapp') {
                updateUsageMetaEstimate(usage.id, options.meta || options.metaMetadata || null);
            }

            const committedUsage = db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
            if (
                committedUsage?.channel === 'whatsapp'
                && committedUsage.reference_type === 'message'
                && committedUsage.reference_id
            ) {
                const committedMetadata = parseJson(committedUsage.metadata_json, {});
                recordMetaMessageCost({
                    tenantId: committedUsage.tenant_id,
                    usageEventId: committedUsage.id,
                    wamid: committedUsage.reference_id,
                    recipient: committedMetadata.recipient || committedMetadata.to || committedMetadata.phone || null,
                    operationKey: committedUsage.operation_key,
                    messageType: committedMetadata.message_type || committedMetadata.type || null,
                    templateName: committedMetadata.template_name || null,
                    templateCategory: committedMetadata.template_category || null,
                    metadata: committedMetadata,
                    sentAt: committedUsage.committed_at,
                });
            }

            syncTenantCredits(usage.tenant_id);
            return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
        }

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
        db.prepare(`
            UPDATE billing_usage_events
            SET quantity = ?,
                total_credits = ?,
                final_credits = ?,
                status = 'committed',
                reference_id = COALESCE(?, reference_id),
                metadata_json = ?,
                customer_charge_type = ?,
                committed_at = ${nowSql}
            WHERE id = ?
        `).run(
            commitQuantity,
            chargedCredits,
            chargedCredits,
            options.referenceId || null,
            serializeJson(metadata),
            options.customerChargeType || metadata.customer_charge_type || usage.customer_charge_type || 'platform_fee',
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
                unit_price_credits: options.finalCredits === undefined ? unitPrice : (commitQuantity > 0 ? chargedCredits / commitQuantity : chargedCredits),
                final_credits: chargedCredits,
                customer_charge_type: options.customerChargeType || metadata.customer_charge_type || usage.customer_charge_type || 'platform_fee',
            })
        );

        updateUsageMetaEstimate(usage.id, options.meta || options.metaMetadata || null);
        const committedUsage = db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
        if (
            committedUsage?.channel === 'whatsapp'
            && committedUsage.reference_type === 'message'
            && committedUsage.reference_id
        ) {
            const committedMetadata = parseJson(committedUsage.metadata_json, {});
            recordMetaMessageCost({
                tenantId: committedUsage.tenant_id,
                usageEventId: committedUsage.id,
                wamid: committedUsage.reference_id,
                recipient: committedMetadata.recipient || committedMetadata.to || committedMetadata.phone || null,
                operationKey: committedUsage.operation_key,
                messageType: committedMetadata.message_type || committedMetadata.type || null,
                templateName: committedMetadata.template_name || null,
                templateCategory: committedMetadata.template_category || null,
                metadata: committedMetadata,
                sentAt: committedUsage.committed_at,
            });
        }

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

export function deferBroadcastReservationUntilStatuses(reservation, {
    jobId,
    quantity = null,
    metadata = {},
} = {}) {
    if (!reservation || reservation.skipped || !jobId) return reservation || { skipped: true };

    const usage = db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(reservation.id);
    if (!usage || usage.status !== 'reserved') return usage || reservation;

    const currentMetadata = parseJson(usage.metadata_json, {});
    db.prepare(`
        UPDATE billing_usage_events
        SET quantity = ?,
            reference_id = ?,
            metadata_json = ?
        WHERE id = ?
    `).run(
        quantity === null || quantity === undefined ? usage.quantity : Math.max(toInt(quantity), 0),
        String(jobId),
        serializeJson({
            ...currentMetadata,
            ...metadata,
            local_pricing_deferred_until: 'all_broadcast_statuses',
        }),
        usage.id
    );

    syncTenantCredits(usage.tenant_id);
    return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
}

function tryFinalizeBroadcastReservationFromStatus(broadcastJobId) {
    if (!broadcastJobId) return null;
    const job = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ?').get(broadcastJobId);
    if (!job || toInt(job.sent_count) <= 0) return null;

    const usage = db.prepare(`
        SELECT *
        FROM billing_usage_events
        WHERE reference_type = 'broadcast'
          AND reference_id = ?
          AND status = 'reserved'
        ORDER BY id DESC
        LIMIT 1
    `).get(String(broadcastJobId));
    if (!usage) return null;

    const costs = db.prepare(`
        SELECT *
        FROM billing_meta_message_costs
        WHERE broadcast_job_id = ?
          AND tenant_id = ?
    `).all(broadcastJobId, usage.tenant_id);
    const terminalCosts = costs.filter((row) => ['final', 'not_charged', 'rate_missing', 'invoice_reconciled'].includes(row.status));
    if (terminalCosts.length < toInt(job.sent_count)) return usage;
    if (terminalCosts.some((row) => row.status === 'rate_missing')) return usage;

    const totalMetaAmount = terminalCosts.reduce((sum, row) => sum + (Number(row.final_amount) || 0), 0);
    const finalCredits = calculateCustomerCreditsFromMetaCost(totalMetaAmount).credits;
    const customerCharge = calculateCustomerCreditsFromMetaCost(totalMetaAmount);
    if (finalCredits <= 0) {
        commit(usage, {
            forceCommit: true,
            finalCredits: 0,
            quantity: toInt(job.sent_count),
            referenceId: String(broadcastJobId),
            customerChargeType: 'free_meta',
            description: `تسجيل بث WhatsApp مجاني بعد تأكيد التسليم: job ${broadcastJobId}`,
            meta: {
                broadcast_job_id: broadcastJobId,
                final_meta_amount: totalMetaAmount,
                final_credits: 0,
            },
        });
        db.prepare(`
            UPDATE billing_usage_events
            SET meta_charge_status = 'not_charged',
                meta_final_amount = ?,
                meta_cost_lyd = ?,
                customer_charge_lyd = ?,
                final_credits = 0,
                customer_charge_type = 'free_meta',
                pricing_decision_reason = 'broadcast_statuses_not_charged',
                billing_formula_json = ?
            WHERE id = ?
        `).run(
            totalMetaAmount,
            customerCharge.meta_cost_lyd,
            customerCharge.customer_charge_lyd,
            serializeJson(customerCharge),
            usage.id
        );
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
    }

    const committed = commit(usage, {
        forceCommit: true,
        finalCredits,
        quantity: toInt(job.sent_count),
        referenceId: String(broadcastJobId),
        customerChargeType: 'paid_meta',
        description: `خصم بث WhatsApp بعد تأكيد التسليم: job ${broadcastJobId}`,
        meta: {
            broadcast_job_id: broadcastJobId,
            final_meta_amount: totalMetaAmount,
            final_credits: finalCredits,
        },
    });
    db.prepare(`
        UPDATE billing_usage_events
        SET meta_charge_status = 'final',
            meta_final_amount = ?,
            meta_cost_lyd = ?,
            customer_charge_lyd = ?,
            final_credits = ?,
            pricing_decision_reason = 'broadcast_statuses_finalized',
            billing_formula_json = ?
        WHERE id = ?
    `).run(
        totalMetaAmount,
        customerCharge.meta_cost_lyd,
        customerCharge.customer_charge_lyd,
        finalCredits,
        serializeJson(customerCharge),
        usage.id
    );
    return committed;
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
            SELECT COALESCE(SUM(
                CASE
                    WHEN COALESCE(final_credits, 0) > 0 THEN final_credits
                    ELSE COALESCE(total_credits, 0)
                END
            ), 0) AS credits
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

    const chargedCreditsSql = `
        CASE
            WHEN COALESCE(final_credits, 0) > 0 THEN final_credits
            ELSE COALESCE(total_credits, 0)
        END
    `;

    const usageByChannel = db.prepare(`
        SELECT channel,
               COALESCE(SUM(${chargedCreditsSql}), 0) AS credits,
               COALESCE(SUM(quantity), 0) AS quantity
        FROM billing_usage_events
        WHERE tenant_id = ?
          AND status = 'committed'
          AND committed_at >= datetime('now', 'start of month', 'localtime')
          AND (${chargedCreditsSql}) > 0
        GROUP BY channel
        ORDER BY channel
    `).all(tenantId);

    const freeUsageByChannel = db.prepare(`
        SELECT channel,
               operation_type,
               COALESCE(SUM(quantity), 0) AS quantity,
               COALESCE(SUM(${chargedCreditsSql}), 0) AS credits
        FROM billing_usage_events
        WHERE tenant_id = ?
          AND status = 'committed'
          AND tenant_visible_usage != 0
          AND committed_at >= datetime('now', 'start of month', 'localtime')
          AND (${chargedCreditsSql}) = 0
          AND customer_charge_type IN ('free_meta', 'free_tracked', 'not_charged')
        GROUP BY channel, operation_type
        ORDER BY channel, operation_type
    `).all(tenantId);

    const platformFeeUsageByChannel = db.prepare(`
        SELECT channel,
               COALESCE(SUM(${chargedCreditsSql}), 0) AS credits,
               COALESCE(SUM(quantity), 0) AS quantity
        FROM billing_usage_events
        WHERE tenant_id = ?
          AND status = 'committed'
          AND committed_at >= datetime('now', 'start of month', 'localtime')
          AND (${chargedCreditsSql}) > 0
          AND customer_charge_type IN ('platform_fee', 'paid')
        GROUP BY channel
        ORDER BY channel
    `).all(tenantId);

    const metaFreeOperationsCount = db.prepare(`
        SELECT COALESCE(SUM(quantity), 0) AS count
        FROM billing_usage_events
        WHERE tenant_id = ?
          AND status = 'committed'
          AND tenant_visible_usage != 0
          AND committed_at >= datetime('now', 'start of month', 'localtime')
          AND (${chargedCreditsSql}) = 0
          AND customer_charge_type IN ('free_meta', 'free_tracked', 'not_charged')
    `).get(tenantId)?.count || 0;

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
        paid_usage_month: usageByChannel,
        free_usage_month: freeUsageByChannel,
        platform_fee_usage_month: platformFeeUsageByChannel,
        meta_free_operations_count: metaFreeOperationsCount,
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

    const metaCostRow = upsertMetaMessageCostFromStatus({ usage, wamid, status, pricing, timestamp });

    if (!usage) {
        if (metaCostRow?.broadcast_job_id) {
            tryFinalizeBroadcastReservationFromStatus(metaCostRow.broadcast_job_id);
        }
        return null;
    }

    const normalizedStatus = String(status || '').toLowerCase();
    const normalizedPricing = normalizeStatusPricing(pricing);
    const statusPayload = {
        status: normalizedStatus || null,
        timestamp: timestamp || null,
        pricing: normalizedPricing,
    };
    if (['failed', 'undelivered'].includes(normalizedStatus)) {
        db.prepare(`
            UPDATE billing_usage_events
            SET meta_charge_status = 'not_charged',
                meta_final_amount = 0,
                meta_charge_reason = ?,
                meta_status_payload_json = ?,
                meta_priced_at = ${nowSql}
            WHERE id = ?
        `).run(`message_${normalizedStatus}`, serializeJson(statusPayload), usage.id);
        if (usage.status === 'reserved') {
            release(usage, `message_${normalizedStatus}`);
        }
        if (metaCostRow?.broadcast_job_id) {
            tryFinalizeBroadcastReservationFromStatus(metaCostRow.broadcast_job_id);
        }
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
    }

    if (!['delivered', 'read'].includes(normalizedStatus)) {
        if (metaCostRow?.broadcast_job_id) {
            tryFinalizeBroadcastReservationFromStatus(metaCostRow.broadcast_job_id);
        }
        return usage;
    }

    const metadata = parseJson(usage.metadata_json, {});
    const estimate = summarizeMetaEstimate({
        tenantId: usage.tenant_id,
        operationKey: usage.operation_key,
        quantity: usage.quantity,
        metadata: { ...metadata, exclude_wamid: wamid },
        statusPricing: pricing || null,
        effectiveAt: timestamp ? sqlDate(Number(timestamp) * 1000) : null,
    });
    const finalStatus = estimate.status === 'estimated' ? 'final' : estimate.status;
    const customerCharge = calculateCustomerCreditsFromMetaCost(
        finalStatus === 'rate_missing' ? 0 : Number(estimate.amount) || 0
    );
    const finalCredits = ['not_charged', 'not_applicable', 'rate_missing'].includes(finalStatus)
        ? 0
        : customerCharge.credits;

    db.prepare(`
        UPDATE billing_usage_events
        SET meta_charge_status = ?,
            meta_pricing_basis = ?,
            meta_charge_category = ?,
            meta_pricing_category = ?,
            meta_pricing_type = ?,
            meta_billable = ?,
            meta_country_calling_code = ?,
            meta_charge_currency = ?,
            meta_estimated_amount = CASE WHEN COALESCE(meta_estimated_amount, 0) = 0 THEN ? ELSE meta_estimated_amount END,
            meta_final_amount = ?,
            meta_rate_card_id = ?,
            meta_charge_reason = ?,
            pricing_decision_reason = ?,
            meta_status_payload_json = ?,
            meta_cost_lyd = ?,
            customer_charge_lyd = ?,
            final_credits = ?,
            customer_charge_type = ?,
            billing_formula_json = ?,
            meta_delivered_at = COALESCE(meta_delivered_at, ?),
            meta_priced_at = ${nowSql}
        WHERE id = ?
    `).run(
        finalStatus,
        pricing ? 'status_webhook' : estimate.pricing_basis,
        estimate.category,
        normalizedPricing?.category || estimate.category,
        normalizedPricing?.type || null,
        normalizedPricing?.billable,
        estimate.country_calling_code,
        estimate.currency,
        Number(estimate.amount) || 0,
        finalStatus === 'rate_missing' ? 0 : Number(estimate.amount) || 0,
        estimate.rate_card_id,
        pricing?.pricing_model ? `${estimate.reason}; pricing_model=${pricing.pricing_model}` : estimate.reason,
        pricing?.pricing_model ? `${estimate.reason}; pricing_model=${pricing.pricing_model}` : estimate.reason,
        serializeJson(statusPayload),
        customerCharge.meta_cost_lyd,
        customerCharge.customer_charge_lyd,
        finalCredits,
        finalStatus === 'rate_missing' ? 'needs_review' : (finalCredits <= 0 ? 'free_meta' : 'paid_meta'),
        serializeJson(customerCharge),
        timestamp ? sqlDate(Number(timestamp) * 1000) : sqlDate(),
        usage.id
    );

    if (usage.status === 'reserved' && finalStatus === 'rate_missing') {
        if (metaCostRow?.broadcast_job_id) {
            tryFinalizeBroadcastReservationFromStatus(metaCostRow.broadcast_job_id);
        }
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
    }

    if (usage.status === 'reserved' && finalCredits <= 0) {
        commit(usage, {
            quantity: usage.quantity,
            referenceId: wamid,
            forceCommit: true,
            finalCredits: 0,
            customerChargeType: 'free_meta',
            description: `تسجيل WhatsApp مجاني بعد تأكيد ${normalizedStatus}: ${wamid}`,
            meta: {
                status_pricing: normalizeStatusPricing(pricing),
                delivered_status: normalizedStatus,
            },
        });
        if (metaCostRow?.broadcast_job_id) {
            tryFinalizeBroadcastReservationFromStatus(metaCostRow.broadcast_job_id);
        }
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
    }

    if (usage.status === 'reserved') {
        commit(usage, {
            quantity: usage.quantity,
            referenceId: wamid,
            forceCommit: true,
            finalCredits,
            customerChargeType: 'paid_meta',
            description: `خصم WhatsApp بعد تأكيد ${normalizedStatus}: ${wamid}`,
            meta: {
                status_pricing: normalizeStatusPricing(pricing),
                delivered_status: normalizedStatus,
            },
        });
    }

    if (metaCostRow?.broadcast_job_id) {
        tryFinalizeBroadcastReservationFromStatus(metaCostRow.broadcast_job_id);
    }

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
    const costClauses = [];
    const usageClauses = ["bue.channel = 'whatsapp'", "bue.meta_charge_status IS NOT NULL", "bue.meta_charge_status != 'not_applicable'"];
    const costParams = [];
    const usageParams = [];
    const normalizedLimit = Math.max(toInt(limit, 100), 1);
    const normalizedOffset = Math.max(toInt(offset), 0);
    if (tenantId) {
        costClauses.push('bmc.tenant_id = ?');
        usageClauses.push('bue.tenant_id = ?');
        costParams.push(tenantId);
        usageParams.push(tenantId);
    }
    if (status) {
        costClauses.push('bmc.status = ?');
        usageClauses.push('bue.meta_charge_status = ?');
        costParams.push(status);
        usageParams.push(status);
    }

    const costRows = db.prepare(`
        SELECT bmc.id,
               bmc.tenant_id,
               t.name AS tenant_name,
               bmc.operation_key,
               'whatsapp' AS channel,
               'meta_message_cost' AS operation_type,
               1 AS quantity,
               0 AS unit_price_credits,
               0 AS total_credits,
               'committed' AS status,
               'message' AS reference_type,
               bmc.wamid AS reference_id,
               bmc.metadata_json,
               bmc.template_category AS meta_charge_category,
               bmc.country_calling_code AS meta_country_calling_code,
               bmc.currency AS meta_charge_currency,
               bmc.estimated_amount AS meta_estimated_amount,
               bmc.final_amount AS meta_final_amount,
               bmc.rate_card_id AS meta_rate_card_id,
               bmc.charge_reason AS meta_charge_reason,
               bmc.status AS meta_charge_status,
               bmc.status_payload_json AS meta_status_payload_json,
               bmc.delivered_at AS meta_delivered_at,
               bmc.updated_at AS meta_priced_at,
               bmc.sent_at AS committed_at,
               bmc.sent_at AS reserved_at
        FROM billing_meta_message_costs bmc
        LEFT JOIN tenants t ON t.id = bmc.tenant_id
        ${costClauses.length ? `WHERE ${costClauses.join(' AND ')}` : ''}
        ORDER BY COALESCE(bmc.updated_at, bmc.sent_at) DESC, bmc.id DESC
        LIMIT ? OFFSET ?
    `).all(...costParams, normalizedLimit, normalizedOffset);

    if (costRows.length >= normalizedLimit) return costRows;

    const usageRows = db.prepare(`
        SELECT bue.*, t.name AS tenant_name
        FROM billing_usage_events bue
        LEFT JOIN tenants t ON t.id = bue.tenant_id
        WHERE ${usageClauses.join(' AND ')}
          AND NOT EXISTS (
              SELECT 1
              FROM billing_meta_message_costs bmc
              WHERE bmc.usage_event_id = bue.id
          )
          AND NOT (
              bue.reference_type = 'broadcast'
              AND EXISTS (
                  SELECT 1
                  FROM billing_meta_message_costs bmc
                  WHERE bmc.broadcast_job_id = CAST(bue.reference_id AS INTEGER)
              )
          )
        ORDER BY COALESCE(bue.meta_priced_at, bue.committed_at, bue.reserved_at) DESC, bue.id DESC
        LIMIT ?
    `).all(...usageParams, normalizedLimit - costRows.length);

    return [...costRows, ...usageRows]
        .sort((a, b) => String(b.meta_priced_at || b.committed_at || b.reserved_at || '').localeCompare(String(a.meta_priced_at || a.committed_at || a.reserved_at || '')))
        .slice(0, normalizedLimit);
}

export function getMetaCostSummary({ tenantId = null, periodStart = null, periodEnd = null } = {}) {
    const startSql = periodStart ? normalizeSqlDate(periodStart) : null;
    const endSql = periodEnd ? normalizeSqlDate(periodEnd, true) : null;
    const costClauses = [];
    const costParams = [];
    if (tenantId) {
        costClauses.push('tenant_id = ?');
        costParams.push(tenantId);
    }
    if (startSql) {
        costClauses.push('sent_at >= ?');
        costParams.push(startSql);
    }
    if (endSql) {
        costClauses.push('sent_at <= ?');
        costParams.push(endSql);
    }
    const costWhere = costClauses.length ? `WHERE ${costClauses.join(' AND ')}` : '';

    const totals = db.prepare(`
        SELECT
            COALESCE(SUM(estimated_amount), 0) AS estimated_amount,
            COALESCE(SUM(final_amount), 0) AS final_amount,
            COUNT(*) AS usage_count,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
            SUM(CASE WHEN status = 'estimated' THEN 1 ELSE 0 END) AS estimated_count,
            SUM(CASE WHEN status = 'final' THEN 1 ELSE 0 END) AS final_count,
            SUM(CASE WHEN status = 'not_charged' THEN 1 ELSE 0 END) AS not_charged_count,
            SUM(CASE WHEN status = 'rate_missing' THEN 1 ELSE 0 END) AS rate_missing_count,
            SUM(CASE WHEN status = 'invoice_reconciled' THEN 1 ELSE 0 END) AS invoice_reconciled_count,
            SUM(CASE WHEN status IN ('estimated', 'final', 'invoice_reconciled') THEN 1 ELSE 0 END) AS priced_count
        FROM billing_meta_message_costs
        ${costWhere}
    `).get(...costParams);

    const hasCostRows = toInt(totals?.usage_count) > 0;
    if (hasCostRows) {
        const byCategory = db.prepare(`
            SELECT template_category AS category,
                   currency,
                   COALESCE(SUM(estimated_amount), 0) AS estimated_amount,
                   COALESCE(SUM(final_amount), 0) AS final_amount,
                   COUNT(*) AS quantity,
                   COUNT(*) AS count
            FROM billing_meta_message_costs
            ${costWhere}
            GROUP BY template_category, currency
            ORDER BY template_category
        `).all(...costParams);

        const byCountry = db.prepare(`
            SELECT country_calling_code,
                   currency,
                   COALESCE(SUM(estimated_amount), 0) AS estimated_amount,
                   COALESCE(SUM(final_amount), 0) AS final_amount,
                   COUNT(*) AS quantity,
                   COUNT(*) AS count
            FROM billing_meta_message_costs
            ${costWhere}
            GROUP BY country_calling_code, currency
            ORDER BY final_amount DESC, estimated_amount DESC
        `).all(...costParams);

        return {
            filters: { tenant_id: tenantId || null, period_start: periodStart || null, period_end: periodEnd || null },
            source: 'billing_meta_message_costs',
            totals,
            by_category: byCategory,
            by_country: byCountry,
        };
    }

    const clauses = ["channel = 'whatsapp'", "status = 'committed'"];
    const params = [];
    if (tenantId) {
        clauses.push('tenant_id = ?');
        params.push(tenantId);
    }
    if (startSql) {
        clauses.push('committed_at >= ?');
        params.push(startSql);
    }
    if (endSql) {
        clauses.push('committed_at <= ?');
        params.push(endSql);
    }

    const usageTotals = db.prepare(`
        SELECT
            COALESCE(SUM(meta_estimated_amount), 0) AS estimated_amount,
            COALESCE(SUM(meta_final_amount), 0) AS final_amount,
            COUNT(*) AS usage_count,
            SUM(CASE WHEN meta_charge_status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
            SUM(CASE WHEN meta_charge_status = 'estimated' THEN 1 ELSE 0 END) AS estimated_count,
            SUM(CASE WHEN meta_charge_status = 'final' THEN 1 ELSE 0 END) AS final_count,
            SUM(CASE WHEN meta_charge_status = 'not_charged' THEN 1 ELSE 0 END) AS not_charged_count,
            SUM(CASE WHEN meta_charge_status = 'rate_missing' THEN 1 ELSE 0 END) AS rate_missing_count,
            SUM(CASE WHEN meta_charge_status = 'invoice_reconciled' THEN 1 ELSE 0 END) AS invoice_reconciled_count,
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
        source: 'billing_usage_events_fallback',
        totals: usageTotals,
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

function getLocalMetaMessageCostSummary({ tenantId, startSql, endSql }) {
    const messageCosts = db.prepare(`
        SELECT
            COALESCE(SUM(estimated_amount), 0) AS estimated_amount,
            COALESCE(SUM(final_amount), 0) AS final_amount,
            COUNT(*) AS cost_rows,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
            SUM(CASE WHEN status = 'estimated' THEN 1 ELSE 0 END) AS estimated_count,
            SUM(CASE WHEN status = 'final' THEN 1 ELSE 0 END) AS final_count,
            SUM(CASE WHEN status = 'not_charged' THEN 1 ELSE 0 END) AS not_charged_count,
            SUM(CASE WHEN status = 'rate_missing' THEN 1 ELSE 0 END) AS rate_missing_count,
            SUM(CASE WHEN status = 'invoice_reconciled' THEN 1 ELSE 0 END) AS invoice_reconciled_count,
            SUM(CASE WHEN wamid IS NULL OR wamid = '' THEN 1 ELSE 0 END) AS missing_wamid_count
        FROM billing_meta_message_costs
        WHERE tenant_id = ?
          AND sent_at >= ?
          AND sent_at <= ?
    `).get(tenantId, startSql, endSql) || {};

    const usageFallback = db.prepare(`
        SELECT
            COALESCE(SUM(bue.meta_estimated_amount), 0) AS estimated_amount,
            COALESCE(SUM(bue.meta_final_amount), 0) AS final_amount,
            COUNT(*) AS usage_rows,
            SUM(CASE WHEN bue.meta_charge_status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
            SUM(CASE WHEN bue.meta_charge_status = 'estimated' THEN 1 ELSE 0 END) AS estimated_count,
            SUM(CASE WHEN bue.meta_charge_status = 'final' THEN 1 ELSE 0 END) AS final_count,
            SUM(CASE WHEN bue.meta_charge_status = 'not_charged' THEN 1 ELSE 0 END) AS not_charged_count,
            SUM(CASE WHEN bue.meta_charge_status = 'rate_missing' THEN 1 ELSE 0 END) AS rate_missing_count,
            SUM(CASE WHEN bue.meta_charge_status = 'invoice_reconciled' THEN 1 ELSE 0 END) AS invoice_reconciled_count,
            SUM(CASE WHEN bue.reference_type = 'message' AND (bue.reference_id IS NULL OR bue.reference_id = '') THEN 1 ELSE 0 END) AS missing_wamid_count
        FROM billing_usage_events bue
        WHERE bue.tenant_id = ?
          AND bue.channel = 'whatsapp'
          AND bue.status = 'committed'
          AND bue.committed_at >= ?
          AND bue.committed_at <= ?
          AND bue.meta_charge_status IS NOT NULL
          AND bue.meta_charge_status != 'not_applicable'
          AND NOT EXISTS (
              SELECT 1
              FROM billing_meta_message_costs bmc
              WHERE bmc.usage_event_id = bue.id
          )
          AND NOT (
              bue.reference_type = 'broadcast'
              AND EXISTS (
                  SELECT 1
                  FROM billing_meta_message_costs bmc
                  WHERE bmc.broadcast_job_id = CAST(bue.reference_id AS INTEGER)
              )
          )
    `).get(tenantId, startSql, endSql) || {};

    const sumField = (field) => Number(messageCosts?.[field] || 0) + Number(usageFallback?.[field] || 0);
    const countField = (field) => toInt(messageCosts?.[field]) + toInt(usageFallback?.[field]);
    return {
        estimated_amount: sumField('estimated_amount'),
        final_amount: sumField('final_amount'),
        cost_rows: toInt(messageCosts?.cost_rows),
        usage_fallback_rows: toInt(usageFallback?.usage_rows),
        pending_count: countField('pending_count'),
        estimated_count: countField('estimated_count'),
        final_count: countField('final_count'),
        not_charged_count: countField('not_charged_count'),
        rate_missing_count: countField('rate_missing_count'),
        invoice_reconciled_count: countField('invoice_reconciled_count'),
        missing_wamid_count: countField('missing_wamid_count'),
    };
}

function getLocalMetaReconciliation({ tenantId, periodStart, periodEnd }) {
    const startSql = normalizeSqlDate(periodStart);
    const endSql = normalizeSqlDate(periodEnd, true);

    const usage = db.prepare(`
        SELECT
            COALESCE(SUM(quantity), 0) AS usage_events,
            COALESCE(SUM(meta_estimated_amount), 0) AS estimated_amount,
            COALESCE(SUM(meta_final_amount), 0) AS final_amount,
            COALESCE(SUM(total_credits), 0) AS customer_credits
        FROM billing_usage_events
        WHERE tenant_id = ?
          AND channel = 'whatsapp'
          AND status = 'committed'
          AND committed_at >= ?
          AND committed_at <= ?
    `).get(tenantId, startSql, endSql);
    const metaCost = getLocalMetaMessageCostSummary({ tenantId, startSql, endSql });
    const settings = getBillingSettingsValues();
    const customerCredits = toInt(usage?.customer_credits);

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
        local_customer_credits: customerCredits,
        local_customer_revenue_lyd: customerCredits * (Number(settings.credit_value_lyd) || 0.1),
        local_meta_cost_rows: metaCost.cost_rows,
        local_usage_fallback_rows: metaCost.usage_fallback_rows,
        local_estimated_amount: metaCost.estimated_amount,
        local_final_amount: metaCost.final_amount,
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
            local_customer_credits: local?.local_customer_credits || 0,
            local_customer_revenue_lyd: local?.local_customer_revenue_lyd || 0,
            invoice_total_amount: local?.invoice_total_amount || 0,
            diff_meta_vs_local_cost: latestSnapshot.meta_cost_amount - (local?.local_final_amount || 0),
            diff_invoice_vs_local_cost: (local?.invoice_total_amount || 0) - (local?.local_final_amount || 0),
        } : null,
    };
}

export function getBillingSettings() {
    const rows = db.prepare('SELECT key, value, description, updated_at FROM billing_settings ORDER BY key').all();
    const settings = rows.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
    }, {});
    return {
        settings: {
            meta_cost_exchange_rate_to_lyd: Number(settings.meta_cost_exchange_rate_to_lyd || 1) || 1,
            meta_cost_margin_note: settings.meta_cost_margin_note || '',
            credit_value_lyd: Number(settings.credit_value_lyd || 0.1) || 0.1,
            meta_cost_margin_percent: Number(settings.meta_cost_margin_percent || 20) || 0,
            strict_meta_rate_required: getBooleanSetting(settings.strict_meta_rate_required, true),
            whatsapp_pricing_source_priority: settings.whatsapp_pricing_source_priority || 'status_webhook_then_estimate',
        },
        rows,
    };
}

export function updateBillingSettings(data = {}) {
    const allowed = {
        meta_cost_exchange_rate_to_lyd: (value) => String(Math.max(Number(value) || 1, 0)),
        meta_cost_margin_note: (value) => String(value || '').trim(),
        credit_value_lyd: (value) => String(Math.max(Number(value) || 0.1, 0.0001)),
        meta_cost_margin_percent: (value) => String(Math.max(Number(value) || 0, 0)),
        strict_meta_rate_required: (value) => getBooleanSetting(value, true) ? 'true' : 'false',
        whatsapp_pricing_source_priority: (value) => {
            const normalized = String(value || 'status_webhook_then_estimate').trim();
            return ['status_webhook_then_estimate'].includes(normalized) ? normalized : 'status_webhook_then_estimate';
        },
    };
    const transaction = db.transaction(() => {
        for (const [key, normalize] of Object.entries(allowed)) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                db.prepare(`
                    INSERT INTO billing_settings (key, value, updated_at)
                    VALUES (?, ?, ${nowSql})
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = ${nowSql}
                `).run(key, normalize(data[key]));
            }
        }
        return getBillingSettings();
    });
    return transaction();
}

function getLatestSnapshot({ tenantId, periodStart, periodEnd, snapshotId = null }) {
    if (snapshotId) {
        return db.prepare('SELECT * FROM meta_usage_snapshots WHERE id = ? AND tenant_id = ?').get(snapshotId, tenantId) || null;
    }
    return db.prepare(`
        SELECT *
        FROM meta_usage_snapshots
        WHERE tenant_id = ?
          AND period_start = ?
          AND period_end = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `).get(tenantId, periodStart, periodEnd) || null;
}

function getLatestMetaInvoiceForPeriod({ tenantId, periodStart, periodEnd }) {
    return db.prepare(`
        SELECT *
        FROM meta_invoices
        WHERE tenant_id = ?
          AND (
              (period_start IS NULL AND period_end IS NULL)
              OR (date(COALESCE(period_start, ?)) <= date(?) AND date(COALESCE(period_end, ?)) >= date(?))
          )
        ORDER BY COALESCE(period_end, created_at) DESC, id DESC
        LIMIT 1
    `).get(tenantId, periodStart, periodEnd, periodEnd, periodStart) || null;
}

function getMetaStatusCounts({ tenantId, startSql, endSql }) {
    return getLocalMetaMessageCostSummary({ tenantId, startSql, endSql });
}

function listMetaReconciliationActionItems({ tenantId, startSql, endSql, limit = 50 }) {
    const messageCostItems = db.prepare(`
        SELECT bmc.id,
               bmc.tenant_id,
               t.name AS tenant_name,
               bmc.operation_key,
               bmc.wamid AS reference_id,
               bmc.recipient,
               bmc.status AS meta_charge_status,
               bmc.estimated_amount AS meta_estimated_amount,
               bmc.final_amount AS meta_final_amount,
               bmc.currency AS meta_charge_currency,
               bmc.sent_at AS committed_at,
               CASE
                   WHEN bmc.status = 'rate_missing' THEN 'missing_rate'
                   WHEN bmc.status = 'pending' THEN 'no_webhook_status'
                   WHEN bmc.wamid IS NULL OR bmc.wamid = '' THEN 'missing_wamid'
                   ELSE 'needs_review'
               END AS action_reason
        FROM billing_meta_message_costs bmc
        LEFT JOIN tenants t ON t.id = bmc.tenant_id
        WHERE bmc.tenant_id = ?
          AND bmc.sent_at >= ?
          AND bmc.sent_at <= ?
          AND (
              bmc.status IN ('pending', 'rate_missing')
              OR bmc.wamid IS NULL OR bmc.wamid = ''
          )
        ORDER BY bmc.sent_at DESC, bmc.id DESC
        LIMIT ?
    `).all(tenantId, startSql, endSql, Math.max(toInt(limit, 50), 1));

    if (messageCostItems.length >= Math.max(toInt(limit, 50), 1)) return messageCostItems;

    const usageItems = db.prepare(`
        SELECT bue.*, t.name AS tenant_name,
               CASE
                   WHEN bue.meta_charge_status = 'rate_missing' THEN 'missing_rate'
                   WHEN bue.meta_charge_status = 'pending' THEN 'no_webhook_status'
                   WHEN bue.reference_type = 'message' AND (bue.reference_id IS NULL OR bue.reference_id = '') THEN 'missing_wamid'
                   ELSE 'needs_review'
               END AS action_reason
        FROM billing_usage_events bue
        LEFT JOIN tenants t ON t.id = bue.tenant_id
        WHERE bue.tenant_id = ?
          AND bue.channel = 'whatsapp'
          AND bue.status = 'committed'
          AND bue.committed_at >= ?
          AND bue.committed_at <= ?
          AND (
              bue.meta_charge_status IN ('pending', 'rate_missing')
              OR (bue.reference_type = 'message' AND (bue.reference_id IS NULL OR bue.reference_id = ''))
          )
          AND NOT EXISTS (
              SELECT 1
              FROM billing_meta_message_costs bmc
              WHERE bmc.usage_event_id = bue.id
          )
          AND NOT (
              bue.reference_type = 'broadcast'
              AND EXISTS (
                  SELECT 1
                  FROM billing_meta_message_costs bmc
                  WHERE bmc.broadcast_job_id = CAST(bue.reference_id AS INTEGER)
              )
          )
        ORDER BY bue.committed_at DESC, bue.id DESC
        LIMIT ?
    `).all(tenantId, startSql, endSql, Math.max(toInt(limit, 50), 1) - messageCostItems.length);

    return [...messageCostItems, ...usageItems];
}

function linkUsageToReconciliationPeriod({ periodId, invoiceId = null, tenantId, startSql, endSql }) {
    db.prepare(`
        UPDATE billing_usage_events
        SET meta_reconciliation_period_id = COALESCE(meta_reconciliation_period_id, ?)
        WHERE tenant_id = ?
          AND channel = 'whatsapp'
          AND status = 'committed'
          AND committed_at >= ?
          AND committed_at <= ?
    `).run(periodId, tenantId, startSql, endSql);

    db.prepare(`
        UPDATE billing_meta_message_costs
        SET meta_reconciliation_period_id = COALESCE(meta_reconciliation_period_id, ?),
            updated_at = ${nowSql}
        WHERE tenant_id = ?
          AND sent_at >= ?
          AND sent_at <= ?
    `).run(periodId, tenantId, startSql, endSql);

    if (invoiceId) {
        db.prepare(`
            UPDATE billing_usage_events
            SET meta_invoice_id = COALESCE(meta_invoice_id, ?),
                meta_charge_status = CASE
                    WHEN meta_charge_status IN ('pending', 'estimated', 'final') THEN 'invoice_reconciled'
                    ELSE meta_charge_status
                END
            WHERE tenant_id = ?
              AND channel = 'whatsapp'
              AND status = 'committed'
              AND committed_at >= ?
              AND committed_at <= ?
        `).run(invoiceId, tenantId, startSql, endSql);

        db.prepare(`
            UPDATE billing_meta_message_costs
            SET status = CASE
                    WHEN status IN ('pending', 'estimated', 'final') THEN 'invoice_reconciled'
                    ELSE status
                END,
                meta_invoice_id = COALESCE(meta_invoice_id, ?),
                updated_at = ${nowSql}
            WHERE tenant_id = ?
              AND sent_at >= ?
              AND sent_at <= ?
        `).run(invoiceId, tenantId, startSql, endSql);
    }
}

function buildMetaReconciliationMetrics({ tenantId, periodStart, periodEnd, snapshotId = null }) {
    const startSql = normalizeSqlDate(periodStart);
    const endSql = normalizeSqlDate(periodEnd, true);
    const local = getLocalMetaReconciliation({ tenantId, periodStart, periodEnd });
    const snapshot = getLatestSnapshot({ tenantId, periodStart, periodEnd, snapshotId });
    const invoice = getLatestMetaInvoiceForPeriod({ tenantId, periodStart, periodEnd });
    const counts = getMetaStatusCounts({ tenantId, startSql, endSql });
    const diffSent = (snapshot?.meta_sent || 0) - local.local_sent;
    const diffDelivered = (snapshot?.meta_delivered || 0) - local.local_delivered;
    const metaCost = Number(snapshot?.meta_cost_amount) || 0;
    const diffMetaVsLocalCost = metaCost - local.local_final_amount;
    const diffInvoiceVsLocalCost = local.invoice_total_amount - local.local_final_amount;
    const needsActionCount = toInt(counts.pending_count)
        + toInt(counts.rate_missing_count)
        + toInt(counts.missing_wamid_count);

    let status = 'open';
    const snapshotIncomplete = snapshot && snapshot.status !== 'synced';
    const hasDiff = snapshotIncomplete
        || Math.abs(diffSent) > 0
        || Math.abs(diffDelivered) > 0
        || Math.abs(diffMetaVsLocalCost) > META_COST_DIFF_THRESHOLD
        || needsActionCount > 0;
    if (hasDiff) status = 'needs_review';
    else if (local.invoice_total_amount > 0 || invoice) status = 'invoice_reconciled';
    else if (snapshot) status = 'synced';

    return {
        tenant_id: tenantId,
        period_start: periodStart,
        period_end: periodEnd,
        start_sql: startSql,
        end_sql: endSql,
        status,
        currency: snapshot?.currency || invoice?.currency || null,
        snapshot,
        invoice,
        local,
        counts: {
            pending_count: toInt(counts.pending_count),
            estimated_count: toInt(counts.estimated_count),
            final_count: toInt(counts.final_count),
            not_charged_count: toInt(counts.not_charged_count),
            rate_missing_count: toInt(counts.rate_missing_count),
            invoice_reconciled_count: toInt(counts.invoice_reconciled_count),
            missing_wamid_count: toInt(counts.missing_wamid_count),
            needs_action_count: needsActionCount,
        },
        comparison: {
            meta_sent: snapshot?.meta_sent || 0,
            local_sent: local.local_sent,
            diff_sent: diffSent,
            meta_delivered: snapshot?.meta_delivered || 0,
            local_delivered: local.local_delivered,
            diff_delivered: diffDelivered,
            meta_cost_amount: metaCost,
            local_estimated_amount: local.local_estimated_amount,
            local_final_amount: local.local_final_amount,
            local_customer_credits: local.local_customer_credits,
            local_customer_revenue_lyd: local.local_customer_revenue_lyd,
            invoice_total_amount: local.invoice_total_amount,
            diff_meta_vs_local_cost: diffMetaVsLocalCost,
            diff_invoice_vs_local_cost: diffInvoiceVsLocalCost,
        },
    };
}

function upsertMetaReconciliationPeriod({ tenantId, periodStart, periodEnd, snapshotId = null, invoiceId = null, reviewedBy = null } = {}) {
    const tenant = db.prepare('SELECT id, waba_id FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) {
        throw new BillingError('العميل غير موجود', { status: 404, code: 'TENANT_NOT_FOUND' });
    }

    const transaction = db.transaction(() => {
        let period = db.prepare(`
            SELECT *
            FROM billing_meta_reconciliation_periods
            WHERE tenant_id = ? AND period_start = ? AND period_end = ?
        `).get(tenantId, periodStart, periodEnd);

        if (!period) {
            const result = db.prepare(`
                INSERT INTO billing_meta_reconciliation_periods (
                    tenant_id, waba_id, period_start, period_end, status
                ) VALUES (?, ?, ?, ?, 'open')
            `).run(tenantId, tenant.waba_id || null, periodStart, periodEnd);
            period = db.prepare('SELECT * FROM billing_meta_reconciliation_periods WHERE id = ?').get(result.lastInsertRowid);
        }

        const latestInvoice = invoiceId
            ? db.prepare('SELECT * FROM meta_invoices WHERE id = ?').get(invoiceId)
            : getLatestMetaInvoiceForPeriod({ tenantId, periodStart, periodEnd });
        const metricsBeforeLink = buildMetaReconciliationMetrics({ tenantId, periodStart, periodEnd, snapshotId });
        linkUsageToReconciliationPeriod({
            periodId: period.id,
            invoiceId: latestInvoice?.id || null,
            tenantId,
            startSql: metricsBeforeLink.start_sql,
            endSql: metricsBeforeLink.end_sql,
        });
        const metrics = buildMetaReconciliationMetrics({ tenantId, periodStart, periodEnd, snapshotId });
        const status = META_RECONCILIATION_STATUSES.has(metrics.status) ? metrics.status : 'open';

        db.prepare(`
            UPDATE billing_meta_reconciliation_periods
            SET waba_id = ?,
                status = ?,
                currency = ?,
                meta_sent = ?,
                meta_delivered = ?,
                local_sent = ?,
                local_delivered = ?,
                diff_sent = ?,
                diff_delivered = ?,
                meta_cost_amount = ?,
                local_estimated_amount = ?,
                local_final_amount = ?,
                invoice_total_amount = ?,
                diff_meta_vs_local_cost = ?,
                diff_invoice_vs_local_cost = ?,
                pending_count = ?,
                estimated_count = ?,
                final_count = ?,
                not_charged_count = ?,
                rate_missing_count = ?,
                invoice_reconciled_count = ?,
                missing_wamid_count = ?,
                needs_action_count = ?,
                last_snapshot_id = COALESCE(?, last_snapshot_id),
                last_invoice_id = COALESCE(?, last_invoice_id),
                summary_json = ?,
                reviewed_at = COALESCE(reviewed_at, CASE WHEN ? IS NULL THEN NULL ELSE ${nowSql} END),
                reviewed_by = COALESCE(reviewed_by, ?),
                updated_at = ${nowSql}
            WHERE id = ?
        `).run(
            tenant.waba_id || null,
            status,
            metrics.currency,
            metrics.comparison.meta_sent,
            metrics.comparison.meta_delivered,
            metrics.comparison.local_sent,
            metrics.comparison.local_delivered,
            metrics.comparison.diff_sent,
            metrics.comparison.diff_delivered,
            metrics.comparison.meta_cost_amount,
            metrics.comparison.local_estimated_amount,
            metrics.comparison.local_final_amount,
            metrics.comparison.invoice_total_amount,
            metrics.comparison.diff_meta_vs_local_cost,
            metrics.comparison.diff_invoice_vs_local_cost,
            metrics.counts.pending_count,
            metrics.counts.estimated_count,
            metrics.counts.final_count,
            metrics.counts.not_charged_count,
            metrics.counts.rate_missing_count,
            metrics.counts.invoice_reconciled_count,
            metrics.counts.missing_wamid_count,
            metrics.counts.needs_action_count,
            metrics.snapshot?.id || snapshotId || null,
            latestInvoice?.id || invoiceId || null,
            serializeJson({
                local: metrics.local,
                comparison: metrics.comparison,
                counts: metrics.counts,
                snapshot_status: metrics.snapshot?.status || null,
                threshold: META_COST_DIFF_THRESHOLD,
            }),
            reviewedBy || null,
            reviewedBy || null,
            period.id
        );

        return db.prepare('SELECT * FROM billing_meta_reconciliation_periods WHERE id = ?').get(period.id);
    });

    return transaction();
}

export function getMetaReconciliation({ tenantId, periodStart, periodEnd } = {}) {
    if (!tenantId || !periodStart || !periodEnd) {
        throw new BillingError('tenant_id و period_start و period_end مطلوبة للمطابقة', {
            status: 400,
            code: 'META_RECONCILIATION_FIELDS_REQUIRED',
        });
    }
    const metrics = buildMetaReconciliationMetrics({ tenantId, periodStart, periodEnd });
    const period = db.prepare(`
        SELECT *
        FROM billing_meta_reconciliation_periods
        WHERE tenant_id = ? AND period_start = ? AND period_end = ?
    `).get(tenantId, periodStart, periodEnd) || null;
    const actionItems = listMetaReconciliationActionItems({
        tenantId,
        startSql: metrics.start_sql,
        endSql: metrics.end_sql,
        limit: 50,
    });
    return {
        period,
        metrics,
        action_items: actionItems,
        settings: getBillingSettings().settings,
    };
}

export async function syncMetaReconciliationPeriod({ tenantId, periodStart, periodEnd, granularity = 'MONTHLY', createdBy = null } = {}) {
    const snapshot = await syncMetaUsageSnapshot({ tenantId, periodStart, periodEnd, granularity, createdBy });
    const period = upsertMetaReconciliationPeriod({
        tenantId,
        periodStart,
        periodEnd,
        snapshotId: snapshot.id,
    });
    return {
        period,
        snapshot,
        reconciliation: getMetaReconciliation({ tenantId, periodStart, periodEnd }),
    };
}

export function markMetaReconciliationReviewed({ id, reviewedBy = null } = {}) {
    const existing = db.prepare('SELECT * FROM billing_meta_reconciliation_periods WHERE id = ?').get(id);
    if (!existing) {
        throw new BillingError('فترة المطابقة غير موجودة', { status: 404, code: 'META_RECONCILIATION_NOT_FOUND' });
    }

    const nextStatus = existing.invoice_total_amount > 0 ? 'invoice_reconciled' : 'synced';
    db.prepare(`
        UPDATE billing_meta_reconciliation_periods
        SET status = ?,
            reviewed_at = ${nowSql},
            reviewed_by = ?,
            updated_at = ${nowSql}
        WHERE id = ?
    `).run(nextStatus, reviewedBy || null, id);

    return db.prepare('SELECT * FROM billing_meta_reconciliation_periods WHERE id = ?').get(id);
}

export function createMetaInvoice({ tenantId = null, businessId = null, wabaId = null, invoiceNumber = null, periodStart = null, periodEnd = null, currency = 'USD', subtotalAmount = 0, taxAmount = 0, totalAmount = null, status = 'received', invoiceUrl = null, notes = null, metadata = null, createdBy = null } = {}) {
    const total = totalAmount === null || totalAmount === undefined
        ? (Number(subtotalAmount) || 0) + (Number(taxAmount) || 0)
        : Number(totalAmount) || 0;

    const transaction = db.transaction(() => {
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

        const invoice = db.prepare('SELECT * FROM meta_invoices WHERE id = ?').get(result.lastInsertRowid);
        if (tenantId && periodStart && periodEnd) {
            upsertMetaReconciliationPeriod({
                tenantId,
                periodStart,
                periodEnd,
                invoiceId: invoice.id,
            });
        }
        return invoice;
    });

    return transaction();
}

export function handleBillingError(res, error) {
    if (error instanceof BillingError) {
        return res.status(error.status).json(error.toResponse());
    }
    return null;
}
