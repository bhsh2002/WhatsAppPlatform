import { BILLING_OPERATIONS, normalizePhoneDigits, toInt } from './billingCore.js';
import { calculateCustomerCreditsFromMetaCost } from './billingMath.js';
import {
    computeAvailable,
    ensureTenantBillingAccount,
    getReservedCredits,
} from './billingAccount.js';
import { getBillingSettings } from './billingSettings.js';

const META_PRICED_WHATSAPP_OPERATIONS = new Set([
    BILLING_OPERATIONS.WHATSAPP_TEXT,
    BILLING_OPERATIONS.WHATSAPP_TEMPLATE,
    BILLING_OPERATIONS.WHATSAPP_MEDIA,
    BILLING_OPERATIONS.WHATSAPP_INTERACTIVE,
    BILLING_OPERATIONS.WHATSAPP_BROADCAST_RECIPIENT,
    BILLING_OPERATIONS.WHATSAPP_CONTACT_VERIFICATION_TEMPLATE,
]);
const LOCAL_PRICING_MODELS = new Set(['fixed', 'meta_like', 'meta_cost_plus_credits']);

const hoursSince = (value) => {
    if (!value) return Number.POSITIVE_INFINITY;
    const parsed = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
    return (Date.now() - parsed.getTime()) / (60 * 60 * 1000);
};

const getWindowSnapshot = (contact = null) => ({
    customer_service_window_open: Boolean(contact?.last_customer_message_at && hoursSince(contact.last_customer_message_at) <= 24),
    ctwa_free_entry_open: Boolean(contact?.last_ctwa_received_at && hoursSince(contact.last_ctwa_received_at) <= 72),
});

const getContactWindow = (db, tenantId, recipient) => {
    if (!tenantId || !recipient) return null;
    return db.prepare(`
        SELECT last_customer_message_at, last_ctwa_received_at, last_ctwa_clid
        FROM contacts
        WHERE tenant_id = ? AND phone = ?
        LIMIT 1
    `).get(tenantId, normalizePhoneDigits(recipient)) || null;
};

export function localPricingModel(priceItem) {
    const model = String(priceItem?.local_pricing_model || 'fixed').trim().toLowerCase();
    return LOCAL_PRICING_MODELS.has(model) ? model : 'fixed';
}

export const isMetaLikeLocalPricing = (priceItem) => localPricingModel(priceItem) === 'meta_like';
const isMetaCostPlusLocalPricing = (priceItem) => localPricingModel(priceItem) === 'meta_cost_plus_credits';

const metaCostBasis = (priceItem) => {
    const basis = String(priceItem?.meta_cost_basis || '').trim().toLowerCase();
    if (['meta_billed', 'meta_free', 'platform_fee', 'not_applicable'].includes(basis)) return basis;
    if (isMetaCostPlusLocalPricing(priceItem)) return 'meta_billed';
    return 'platform_fee';
};

const tenantVisibleUsage = (priceItem) => (
    priceItem?.tenant_visible_usage === undefined || priceItem?.tenant_visible_usage === null
        ? true
        : Boolean(priceItem.tenant_visible_usage)
);

const applyLocalMetaLikePricing = (dependencies, {
    tenantId,
    operationKey,
    quantity,
    unitPrice,
    metadata = {},
    priceItem,
}) => {
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
        return {
            quantity,
            unit_price_credits: unitPrice,
            total_credits: quantity * unitPrice,
            billable: unitPrice > 0 && quantity > 0,
            track_usage: unitPrice > 0 && quantity > 0,
            customer_charge_type: unitPrice > 0 && quantity > 0 ? 'paid_meta_like' : 'not_charged',
            reason: 'meta_like_precomputed_recipients',
            details: metadata.meta_like_summary || null,
        };
    }

    const estimate = dependencies.summarizeMetaEstimate({ tenantId, operationKey, quantity, metadata, effectiveAt: null });
    return {
        quantity,
        unit_price_credits: unitPrice,
        total_credits: unitPrice * quantity,
        billable: unitPrice > 0 && quantity > 0,
        track_usage: quantity > 0,
        customer_charge_type: unitPrice > 0 && quantity > 0 ? 'paid_meta_like' : 'not_charged',
        reason: estimate.reason,
        details: {
            status: estimate.status,
            category: estimate.category,
            pricing_basis: estimate.pricing_basis,
        },
    };
};

const applyLocalMetaCostPlusPricing = (db, dependencies, {
    tenantId,
    operationKey,
    quantity,
    metadata = {},
    priceItem,
}) => {
    if (!isMetaCostPlusLocalPricing(priceItem) || !META_PRICED_WHATSAPP_OPERATIONS.has(operationKey)) return null;

    const baseUnitCredits = priceItem?.is_active && priceItem?.is_billable
        ? toInt(priceItem.unit_price_credits, 1)
        : 0;
    const baseChargeCredits = baseUnitCredits * quantity;
    const target = metadata.recipient || metadata.to || metadata.phone || null;
    const windowSnapshot = getWindowSnapshot(getContactWindow(db, tenantId, target));
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
            details: { status: 'blocked', pricing_basis: 'customer_service_window', ...windowSnapshot },
        };
    }

    const estimate = dependencies.summarizeMetaEstimate({ tenantId, operationKey, quantity, metadata, effectiveAt: null });
    const settings = getBillingSettings(db).settings;
    const charge = calculateCustomerCreditsFromMetaCost(estimate.amount, settings);
    const notCharged = ['not_charged', 'not_applicable'].includes(estimate.status);
    const rateMissing = estimate.status === 'rate_missing';
    const metaCostCredits = notCharged || rateMissing ? 0 : charge.credits;
    const totalCredits = rateMissing ? 0 : baseChargeCredits + metaCostCredits;

    return {
        quantity,
        unit_price_credits: quantity > 0 ? Math.ceil(totalCredits / quantity) : 0,
        total_credits: totalCredits,
        billable: rateMissing || totalCredits > 0,
        track_usage: quantity > 0,
        customer_charge_type: rateMissing ? 'needs_review' : (metaCostCredits > 0 ? 'paid_meta' : 'platform_fee'),
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
            base_unit_credits: baseUnitCredits,
            base_charge_credits: baseChargeCredits,
            meta_cost_credits: metaCostCredits,
            total_customer_credits: totalCredits,
            template_category_sent: metadata.template_category || null,
            ...windowSnapshot,
        },
    };
};

export function quote(db, dependencies, {
    tenantId,
    operationKey,
    quantity = 1,
    metadata = null,
} = {}) {
    if (typeof dependencies?.summarizeMetaEstimate !== 'function') {
        throw new TypeError('summarizeMetaEstimate dependency is required');
    }
    const normalizedQuantity = Math.max(toInt(quantity, 1), 1);
    const priceItem = db.prepare('SELECT * FROM billing_price_items WHERE operation_key = ?').get(operationKey);
    const unitPrice = priceItem?.is_active && priceItem?.is_billable ? toInt(priceItem.unit_price_credits, 1) : 0;
    const metaCostPlusPricing = applyLocalMetaCostPlusPricing(db, dependencies, {
        tenantId,
        operationKey,
        quantity: normalizedQuantity,
        metadata: metadata || {},
        priceItem,
    });
    const localPricing = metaCostPlusPricing || applyLocalMetaLikePricing(dependencies, {
        tenantId,
        operationKey,
        quantity: normalizedQuantity,
        unitPrice,
        metadata: metadata || {},
        priceItem,
    });
    const account = tenantId ? ensureTenantBillingAccount(db, tenantId) : null;
    const reservedCredits = tenantId ? getReservedCredits(db, tenantId) : 0;
    const availability = account ? computeAvailable(db, account, reservedCredits) : null;

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
