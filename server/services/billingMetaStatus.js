import {
    normalizeStatusPricing,
    parseJson,
    serializeJson,
    toInt,
} from './billingCore.js';
import { sqlDate } from './billingPeriod.js';

const nowSql = "datetime('now', 'localtime')";
const FINAL_META_STATUSES = new Set(['final', 'not_charged', 'invoice_reconciled']);

const finishBroadcastIfNeeded = (db, dependencies, metaCostRow) => {
    if (!metaCostRow?.broadcast_job_id) return null;
    return tryFinalizeBroadcastReservationFromStatus(db, dependencies, metaCostRow.broadcast_job_id);
};

export function deferBroadcastReservationUntilStatuses(db, dependencies, reservation, {
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
            ...(metadata || {}),
            local_pricing_deferred_until: 'all_broadcast_statuses',
        }),
        usage.id
    );

    dependencies.syncTenantCredits(usage.tenant_id);
    return tryFinalizeBroadcastReservationFromStatus(db, dependencies, jobId)
        || db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
}

export function tryFinalizeBroadcastReservationFromStatus(db, dependencies, broadcastJobId) {
    if (!broadcastJobId) return null;
    const job = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ?').get(broadcastJobId);
    if (!job || toInt(job.sent_count) <= 0) return null;

    const usage = db.prepare(`
        SELECT *
        FROM billing_usage_events
        WHERE reference_type = 'broadcast'
          AND reference_id = ?
          AND status = 'reserved'
          AND (? IS NULL OR tenant_id = ?)
        ORDER BY id DESC
        LIMIT 1
    `).get(String(broadcastJobId), job.tenant_id, job.tenant_id);
    if (!usage) return null;

    const costs = db.prepare(`
        SELECT *
        FROM billing_meta_message_costs
        WHERE broadcast_job_id = ?
          AND tenant_id = ?
    `).all(broadcastJobId, usage.tenant_id);
    const terminalCosts = costs.filter((row) => (
        ['final', 'not_charged', 'rate_missing', 'invoice_reconciled'].includes(row.status)
    ));
    if (terminalCosts.length < toInt(job.sent_count)) return usage;
    if (terminalCosts.some((row) => row.status === 'rate_missing')) return usage;

    const usageMetadata = parseJson(usage.metadata_json, {});
    const totalMetaAmount = terminalCosts.reduce((sum, row) => sum + (Number(row.final_amount) || 0), 0);
    const customerCharge = dependencies.calculateCustomerCreditsFromMetaCost(totalMetaAmount);
    const baseChargeCredits = usageMetadata?.local_pricing_details?.base_charge_credits !== undefined
        ? Math.max(toInt(usageMetadata.local_pricing_details.base_charge_credits), 0)
        : 0;
    const metaCostCredits = customerCharge.credits;
    const finalCredits = baseChargeCredits + metaCostCredits;
    if (finalCredits <= 0) return dependencies.release(usage, 'broadcast_no_customer_credits');

    dependencies.commit(usage, {
        forceCommit: true,
        finalCredits,
        quantity: toInt(job.sent_count),
        referenceId: String(broadcastJobId),
        customerChargeType: metaCostCredits > 0 ? 'paid_meta' : 'platform_fee',
        description: `خصم بث WhatsApp بعد تأكيد التسليم: job ${broadcastJobId}`,
        meta: {
            broadcast_job_id: broadcastJobId,
            final_meta_amount: totalMetaAmount,
            final_credits: finalCredits,
        },
    });
    const settings = dependencies.getBillingSettings();
    const customerChargeLyd = finalCredits * (Number(settings.credit_value_lyd) || 0.1);
    db.prepare(`
        UPDATE billing_usage_events
        SET meta_charge_status = 'final',
            meta_final_amount = ?,
            meta_cost_lyd = ?,
            customer_charge_lyd = ?,
            final_credits = ?,
            customer_charge_type = ?,
            pricing_decision_reason = 'broadcast_statuses_finalized',
            billing_formula_json = ?
        WHERE id = ?
    `).run(
        totalMetaAmount,
        customerCharge.meta_cost_lyd,
        customerChargeLyd,
        finalCredits,
        metaCostCredits > 0 ? 'paid_meta' : 'platform_fee',
        serializeJson({
            ...customerCharge,
            base_charge_credits: baseChargeCredits,
            meta_cost_credits: metaCostCredits,
            final_credits: finalCredits,
            customer_charge_lyd: customerChargeLyd,
        }),
        usage.id
    );
    return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
}

export function updateMetaChargeFromStatus(db, dependencies, {
    tenantId = null,
    wamid,
    status,
    pricing = null,
    timestamp = null,
} = {}) {
    const normalizedWamid = String(wamid || '').trim();
    if (!normalizedWamid) return null;

    const usage = db.prepare(`
        SELECT *
        FROM billing_usage_events
        WHERE reference_id = ?
          AND channel = 'whatsapp'
          AND (? IS NULL OR tenant_id = ?)
        ORDER BY id DESC
        LIMIT 1
    `).get(normalizedWamid, tenantId, tenantId);

    const metaCostRow = dependencies.upsertMetaMessageCostFromStatus({
        tenantId,
        usage,
        wamid: normalizedWamid,
        status,
        pricing,
        timestamp,
    });

    if (!usage) {
        finishBroadcastIfNeeded(db, dependencies, metaCostRow);
        return null;
    }

    if (FINAL_META_STATUSES.has(usage.meta_charge_status)) {
        finishBroadcastIfNeeded(db, dependencies, metaCostRow);
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
    }

    const normalizedStatus = String(status || '').trim().toLowerCase();
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
        if (usage.status === 'reserved') dependencies.release(usage, `message_${normalizedStatus}`);
        finishBroadcastIfNeeded(db, dependencies, metaCostRow);
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
    }

    if (!['delivered', 'read'].includes(normalizedStatus)) {
        finishBroadcastIfNeeded(db, dependencies, metaCostRow);
        return usage;
    }

    const metadata = parseJson(usage.metadata_json, {});
    const estimate = dependencies.summarizeMetaEstimate({
        tenantId: usage.tenant_id,
        operationKey: usage.operation_key,
        quantity: usage.quantity,
        metadata: { ...metadata, exclude_wamid: normalizedWamid },
        statusPricing: pricing || null,
        effectiveAt: timestamp ? sqlDate(db, Number(timestamp) * 1000) : null,
    });
    const finalStatus = estimate.status === 'estimated' ? 'final' : estimate.status;
    const customerCharge = dependencies.calculateCustomerCreditsFromMetaCost(
        finalStatus === 'rate_missing' ? 0 : Number(estimate.amount) || 0
    );
    const metaCostCredits = ['not_charged', 'not_applicable', 'rate_missing'].includes(finalStatus)
        ? 0
        : customerCharge.credits;
    const baseChargeCredits = metadata?.local_pricing_details?.base_charge_credits !== undefined
        ? Math.max(toInt(metadata.local_pricing_details.base_charge_credits), 0)
        : 0;
    const finalCredits = finalStatus === 'rate_missing' ? 0 : baseChargeCredits + metaCostCredits;
    const settings = dependencies.getBillingSettings();
    const customerChargeLyd = finalCredits * (Number(settings.credit_value_lyd) || 0.1);

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
        customerChargeLyd,
        finalCredits,
        finalStatus === 'rate_missing' ? 'needs_review' : (metaCostCredits > 0 ? 'paid_meta' : 'platform_fee'),
        serializeJson({
            ...customerCharge,
            base_charge_credits: baseChargeCredits,
            meta_cost_credits: metaCostCredits,
            final_credits: finalCredits,
            customer_charge_lyd: customerChargeLyd,
        }),
        timestamp ? sqlDate(db, Number(timestamp) * 1000) : sqlDate(db),
        usage.id
    );

    if (usage.status === 'reserved' && finalStatus === 'rate_missing') {
        finishBroadcastIfNeeded(db, dependencies, metaCostRow);
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
    }

    if (usage.status === 'reserved' && finalCredits <= 0) {
        dependencies.release(usage, `meta_${finalStatus}_no_customer_credits`);
        finishBroadcastIfNeeded(db, dependencies, metaCostRow);
        return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
    }

    if (usage.status === 'reserved') {
        dependencies.commit(usage, {
            quantity: usage.quantity,
            referenceId: normalizedWamid,
            forceCommit: true,
            finalCredits,
            customerChargeType: metaCostCredits > 0 ? 'paid_meta' : 'platform_fee',
            description: `خصم WhatsApp بعد تأكيد ${normalizedStatus}: ${normalizedWamid}`,
            meta: {
                status_pricing: normalizeStatusPricing(pricing),
                delivered_status: normalizedStatus,
            },
        });
    }

    finishBroadcastIfNeeded(db, dependencies, metaCostRow);
    return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
}
