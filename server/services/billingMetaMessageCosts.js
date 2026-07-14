import {
    BILLING_OPERATIONS,
    BillingError,
    normalizeStatusPricing,
    parseJson,
    serializeJson,
} from './billingCore.js';
import { operationKeyForWhatsAppMessage } from './billingMetaPricing.js';
import { sqlDate } from './billingPeriod.js';

const nowSql = "datetime('now', 'localtime')";

const tenantConflict = () => new BillingError('معرّف رسالة Meta مرتبط بمستأجر آخر', {
    status: 409,
    code: 'META_MESSAGE_TENANT_CONFLICT',
});

const normalizeWamid = (value) => String(value || '').trim();

const assertTenantMatch = (row, tenantId) => {
    if (row && tenantId && Number(row.tenant_id) !== Number(tenantId)) {
        throw tenantConflict();
    }
};

export function recordMetaMessageCost(db, { summarizeMetaEstimate }, {
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
    const normalizedWamid = normalizeWamid(wamid);
    if (!tenantId || !normalizedWamid) return null;

    const existing = db.prepare(`
        SELECT tenant_id
        FROM billing_meta_message_costs
        WHERE wamid = ?
    `).get(normalizedWamid);
    assertTenantMatch(existing, tenantId);

    const inputMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? metadata
        : {};
    const normalizedMetadata = {
        ...inputMetadata,
        recipient: recipient || inputMetadata.recipient || inputMetadata.to || inputMetadata.phone || null,
        message_type: messageType || inputMetadata.message_type || inputMetadata.type || null,
        template_name: templateName || inputMetadata.template_name || null,
        template_category: templateCategory || inputMetadata.template_category || null,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, COALESCE(?, ${nowSql}))
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
        WHERE billing_meta_message_costs.tenant_id = excluded.tenant_id
    `).run(
        tenantId,
        usageEventId || null,
        broadcastJobId || null,
        normalizedWamid,
        normalizedMetadata.recipient,
        operationKey,
        normalizedMetadata.message_type,
        normalizedMetadata.template_name,
        normalizedMetadata.template_category || estimate.category || null,
        estimate.country_calling_code,
        estimate.currency,
        Number(estimate.amount) || 0,
        estimate.rate_card_id,
        pendingStatus,
        estimate.reason,
        estimate.pricing_basis,
        serializeJson({ ...normalizedMetadata, meta_estimate_details: estimate.details || undefined }),
        sentAt || null
    );

    return db.prepare(`
        SELECT *
        FROM billing_meta_message_costs
        WHERE tenant_id = ? AND wamid = ?
    `).get(tenantId, normalizedWamid) || null;
}

export function upsertMetaMessageCostFromStatus(db, dependencies, {
    tenantId = null,
    usage = null,
    wamid,
    status,
    pricing = null,
    timestamp = null,
} = {}) {
    const normalizedWamid = normalizeWamid(wamid);
    if (!normalizedWamid) return null;

    let cost = db.prepare('SELECT * FROM billing_meta_message_costs WHERE wamid = ?').get(normalizedWamid);
    assertTenantMatch(cost, tenantId);
    if (usage) assertTenantMatch(usage, tenantId);

    if (!cost) {
        const message = tenantId
            ? db.prepare(`
                SELECT tenant_id, recipient, message_type, created_at
                FROM messages
                WHERE tenant_id = ? AND wamid = ?
                ORDER BY id DESC
                LIMIT 1
            `).get(tenantId, normalizedWamid)
            : db.prepare(`
                SELECT tenant_id, recipient, message_type, created_at
                FROM messages
                WHERE wamid = ?
                ORDER BY id DESC
                LIMIT 1
            `).get(normalizedWamid);

        const resolvedTenantId = tenantId || usage?.tenant_id || message?.tenant_id || null;
        if (!resolvedTenantId) return null;
        assertTenantMatch(usage, resolvedTenantId);
        assertTenantMatch(message, resolvedTenantId);

        cost = recordMetaMessageCost(db, dependencies, {
            tenantId: resolvedTenantId,
            usageEventId: usage?.id || null,
            wamid: normalizedWamid,
            recipient: message?.recipient || null,
            operationKey: usage?.operation_key || operationKeyForWhatsAppMessage(message?.message_type),
            messageType: message?.message_type || null,
            metadata: parseJson(usage?.metadata_json, {}),
            sentAt: message?.created_at || usage?.committed_at || null,
        });
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
            UPDATE billing_meta_message_costs
            SET status = 'not_charged',
                billable = 0,
                final_amount = 0,
                charge_reason = ?,
                status_payload_json = ?,
                updated_at = ${nowSql}
            WHERE wamid = ?
              AND status NOT IN ('final', 'invoice_reconciled')
        `).run(`message_${normalizedStatus}`, serializeJson(statusPayload), normalizedWamid);
        return db.prepare('SELECT * FROM billing_meta_message_costs WHERE wamid = ?').get(normalizedWamid);
    }

    if (!['delivered', 'read'].includes(normalizedStatus)) return cost;

    const usageMetadata = parseJson(usage?.metadata_json, {});
    const metadata = {
        ...parseJson(cost?.metadata_json, {}),
        ...usageMetadata,
        recipient: cost?.recipient || usageMetadata.recipient || null,
        message_type: cost?.message_type || usageMetadata.message_type || null,
        template_name: cost?.template_name || usageMetadata.template_name || null,
        template_category: normalizedPricing?.category || cost?.template_category || usageMetadata.template_category || null,
    };
    const estimate = dependencies.summarizeMetaEstimate({
        tenantId: cost.tenant_id,
        operationKey: cost.operation_key || usage?.operation_key || operationKeyForWhatsAppMessage(metadata.message_type),
        quantity: 1,
        metadata: { ...metadata, exclude_wamid: normalizedWamid },
        statusPricing: pricing || null,
        effectiveAt: timestamp ? sqlDate(db, Number(timestamp) * 1000) : null,
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
          AND status NOT IN ('final', 'invoice_reconciled')
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
        timestamp ? sqlDate(db, Number(timestamp) * 1000) : sqlDate(db),
        normalizedWamid
    );

    return db.prepare('SELECT * FROM billing_meta_message_costs WHERE wamid = ?').get(normalizedWamid);
}

export function updateUsageMetaEstimate(db, { summarizeMetaEstimate }, usageId, metadataOverride = null) {
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
