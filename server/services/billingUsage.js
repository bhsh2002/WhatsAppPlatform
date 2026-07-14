import {
    BILLING_OPERATIONS,
    BillingError,
    parseJson,
    serializeJson,
    toInt,
} from './billingCore.js';
import { deductAccountBalances } from './billingMath.js';
import {
    computeAvailable,
    ensureTenantBillingAccount,
    getBillingCycleState,
    getReservedCredits,
    syncTenantCredits,
} from './billingAccount.js';
import { getBooleanSetting } from './billingSettings.js';

const nowSql = "datetime('now', 'localtime')";
const META_PRICED_WHATSAPP_OPERATIONS = new Set([
    BILLING_OPERATIONS.WHATSAPP_TEXT,
    BILLING_OPERATIONS.WHATSAPP_TEMPLATE,
    BILLING_OPERATIONS.WHATSAPP_MEDIA,
    BILLING_OPERATIONS.WHATSAPP_INTERACTIVE,
    BILLING_OPERATIONS.WHATSAPP_BROADCAST_RECIPIENT,
    BILLING_OPERATIONS.WHATSAPP_CONTACT_VERIFICATION_TEMPLATE,
]);

const normalizeExistingUsage = (usage) => ({
    ...usage,
    total_credits: toInt(usage.total_credits),
    quantity: toInt(usage.quantity),
    already_committed: usage.status === 'committed',
});

const getIdempotentUsage = (db, tenantId, idempotencyKey) => {
    if (!idempotencyKey) return null;
    const existing = db.prepare('SELECT * FROM billing_usage_events WHERE idempotency_key = ?').get(idempotencyKey);
    if (!existing) return null;
    if (existing.tenant_id !== tenantId) {
        throw new BillingError('مفتاح تكرار العملية مستخدم لحساب آخر', {
            status: 409,
            code: 'IDEMPOTENCY_KEY_CONFLICT',
        });
    }
    return normalizeExistingUsage(existing);
};

export function reserveBillingUsage(db, dependencies, {
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

    const existing = getIdempotentUsage(db, tenantId, idempotencyKey);
    if (existing) return existing;

    const transaction = db.transaction(() => {
        const account = ensureTenantBillingAccount(db, tenantId);
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

        const cycleState = getBillingCycleState(db, account);
        if (cycleState.billing_cycle_blocked) {
            throw new BillingError('انتهت دورة الاشتراك، يجب تجديد الباقة قبل تنفيذ العملية', {
                status: 402,
                code: 'BILLING_CYCLE_EXPIRED',
                operation: operationKey,
                billing_cycle_start: cycleState.billing_cycle_start,
                billing_cycle_end: cycleState.billing_cycle_end,
                reason: cycleState.billing_cycle_block_reason,
            });
        }

        const currentQuote = dependencies.quote({ tenantId, operationKey, quantity, metadata });
        const shouldTrackMetaCostPlus = currentQuote.local_pricing_model === 'meta_cost_plus_credits'
            && META_PRICED_WHATSAPP_OPERATIONS.has(operationKey)
            && Boolean(currentQuote.price_item?.is_active && currentQuote.price_item?.is_billable);
        const pricingDetails = currentQuote.local_pricing_details || {};
        const settings = dependencies.getBillingSettings();

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

        if ((!currentQuote.billable || currentQuote.total_credits <= 0) && !shouldTrackMetaCostPlus) {
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
            ON CONFLICT(idempotency_key) DO NOTHING
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
                : 'not_applicable',
            pricingDetails.pricing_basis || null,
            pricingDetails.category || null,
            pricingDetails.country_calling_code || null,
            pricingDetails.currency || null,
            Number(pricingDetails.amount) || 0,
            pricingDetails.rate_card_id || null,
            currentQuote.local_pricing_reason || null,
            Number(pricingDetails.customer_charge?.meta_cost_lyd) || 0,
            currentQuote.total_credits * (Number(settings.credit_value_lyd) || 0.1),
            pricingDetails.customer_service_window_open === undefined ? null : (pricingDetails.customer_service_window_open ? 1 : 0),
            pricingDetails.ctwa_free_entry_open === undefined ? null : (pricingDetails.ctwa_free_entry_open ? 1 : 0),
            pricingDetails.template_category_sent || metadata?.template_category || null,
            currentQuote.local_pricing_reason || null,
            serializeJson(pricingDetails.customer_charge || null),
            currentQuote.customer_charge_type,
            currentQuote.tenant_visible_usage ? 1 : 0
        );

        if (result.changes === 0) {
            return getIdempotentUsage(db, tenantId, idempotencyKey);
        }

        syncTenantCredits(db, tenantId);
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(result.lastInsertRowid);
    });

    return transaction();
}

function shouldDeferMetaLikeLocalCommit(usage, metadata, options = {}) {
    if (options.forceCommit) return false;
    if (options.deferUntilDelivered === false) return false;
    if (usage.channel !== 'whatsapp') return false;
    if (!['message', 'api_message'].includes(String(usage.reference_type || ''))) return false;
    if (!options.referenceId && !usage.reference_id) return false;
    return ['meta_like', 'meta_cost_plus_credits'].includes(metadata?.local_pricing_model);
}

export function commitBillingUsage(db, dependencies, reservation, options = {}) {
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
            ...parseJson(usage.metadata_json, {}),
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
                dependencies.recordMetaMessageCost?.({
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

            syncTenantCredits(db, usage.tenant_id);
            return deferredUsage;
        }

        if (commitQuantity === 0) {
            return releaseBillingUsage(db, usage, options.errorMessage || 'No successful billable operations');
        }

        const unitPrice = toInt(usage.unit_price_credits);
        const chargedCredits = options.finalCredits === undefined
            ? commitQuantity * unitPrice
            : Math.max(toInt(options.finalCredits), 0);

        if (chargedCredits <= 0) {
            return releaseBillingUsage(db, usage, options.errorMessage || 'No customer credits to charge');
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
        const balanceAfter = computeAvailable(
            db,
            updatedAccount,
            getReservedCredits(db, usage.tenant_id, usage.id)
        ).gross_available_credits;
        const chargedValueLyd = chargedCredits * (Number(dependencies.getBillingSettings().credit_value_lyd) || 0.1);
        db.prepare(`
            UPDATE billing_usage_events
            SET quantity = ?,
                total_credits = ?,
                final_credits = ?,
                customer_charge_lyd = ?,
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
            chargedValueLyd,
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
                customer_charge_lyd: chargedValueLyd,
                customer_charge_type: options.customerChargeType || metadata.customer_charge_type || usage.customer_charge_type || 'platform_fee',
            })
        );

        dependencies.updateUsageMetaEstimate?.(usage.id, options.meta || options.metaMetadata || null);
        const committedUsage = db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
        if (
            committedUsage?.channel === 'whatsapp'
            && committedUsage.reference_type === 'message'
            && committedUsage.reference_id
        ) {
            const committedMetadata = parseJson(committedUsage.metadata_json, {});
            dependencies.recordMetaMessageCost?.({
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

        syncTenantCredits(db, usage.tenant_id);
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
    });

    return transaction();
}

export function releaseBillingUsage(db, reservation, errorMessage = null) {
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

        syncTenantCredits(db, usage.tenant_id);
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
    });

    return transaction();
}
