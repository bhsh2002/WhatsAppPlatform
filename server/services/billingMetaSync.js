import { getAccessToken } from './credentials.js';
import { BillingError, serializeJson, toInt } from './billingCore.js';
import {
    fetchWabaField,
    sumConversationAnalytics,
    sumMessageAnalytics,
    sumPricingAnalytics,
} from './billingMetaAnalytics.js';
import { normalizeBillingPeriod, toUnixSeconds } from './billingPeriod.js';
import { getBillingSettings } from './billingSettings.js';

const GRANULARITIES = new Set(['MONTHLY', 'DAILY']);
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;

export function getLocalMetaMessageCostSummary(db, { tenantId, startSql, endSql }) {
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

export function getLocalMetaReconciliation(db, { tenantId, periodStart, periodEnd }) {
    const period = normalizeBillingPeriod(db, { periodStart, periodEnd });
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
    `).get(tenantId, period.start, period.end);
    const metaCost = getLocalMetaMessageCostSummary(db, {
        tenantId,
        startSql: period.start,
        endSql: period.end,
    });
    const settings = getBillingSettings(db).settings;
    const customerCredits = toInt(usage?.customer_credits);
    const messages = db.prepare(`
        SELECT COUNT(*) AS sent,
               SUM(CASE WHEN status IN ('delivered', 'read') THEN 1 ELSE 0 END) AS delivered
        FROM messages
        WHERE tenant_id = ?
          AND direction = 'outgoing'
          AND message_type IN ('text', 'template', 'image', 'document', 'video', 'audio', 'interactive')
          AND created_at >= ?
          AND created_at <= ?
    `).get(tenantId, period.start, period.end);
    const invoice = db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) AS total
        FROM meta_invoices
        WHERE tenant_id = ?
          AND (
              (period_start IS NULL AND period_end IS NULL)
              OR (date(COALESCE(period_start, ?)) <= date(?) AND date(COALESCE(period_end, ?)) >= date(?))
          )
    `).get(tenantId, period.start_date, period.end_date, period.end_date, period.start_date);

    return {
        local_sent: toInt(messages?.sent),
        local_delivered: toInt(messages?.delivered),
        local_billable_usage_events: toInt(usage?.usage_events),
        local_customer_credits: customerCredits,
        local_customer_revenue_lyd: roundMoney(customerCredits * (Number(settings.credit_value_lyd) || 0.1)),
        local_meta_cost_rows: metaCost.cost_rows,
        local_usage_fallback_rows: metaCost.usage_fallback_rows,
        local_estimated_amount: metaCost.estimated_amount,
        local_final_amount: metaCost.final_amount,
        invoice_total_amount: Number(invoice?.total) || 0,
    };
}

export async function syncMetaUsageSnapshot(db, {
    tenantId,
    periodStart,
    periodEnd,
    granularity = 'MONTHLY',
    createdBy = null,
} = {}, dependencies = { getAccessToken, fetchWabaField }) {
    if (!tenantId || !periodStart || !periodEnd) {
        throw new BillingError('tenant_id و period_start و period_end مطلوبة لمزامنة استهلاك Meta', {
            status: 400,
            code: 'META_USAGE_SYNC_FIELDS_REQUIRED',
        });
    }
    const tenant = db.prepare('SELECT id, name, waba_id FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) throw new BillingError('العميل غير موجود', { status: 404, code: 'TENANT_NOT_FOUND' });
    if (!tenant.waba_id) {
        throw new BillingError('WABA ID غير موجود لهذا العميل', { status: 400, code: 'WABA_ID_REQUIRED' });
    }
    const accessToken = dependencies.getAccessToken(tenantId);
    if (!accessToken) {
        throw new BillingError('رمز WhatsApp Business token مطلوب لمزامنة الاستهلاك', {
            status: 400,
            code: 'WHATSAPP_TOKEN_REQUIRED',
            permission_required: 'whatsapp_business_management',
        });
    }

    const period = normalizeBillingPeriod(db, { periodStart, periodEnd });
    const startTs = toUnixSeconds(db, period.start_date);
    const endTs = toUnixSeconds(db, period.end_date, true);
    const requestedGranularity = String(granularity || 'MONTHLY').trim().toUpperCase();
    if (!GRANULARITIES.has(requestedGranularity)) {
        throw new BillingError('دقة مزامنة Meta غير صالحة', { status: 400, code: 'INVALID_META_GRANULARITY' });
    }

    const analyticsField = `analytics.start(${startTs}).end(${endTs}).granularity(DAY)`;
    const pricingField = `pricing_analytics.start(${startTs}).end(${endTs}).granularity(DAILY).phone_numbers([]).dimensions(["PRICING_CATEGORY","PRICING_TYPE","COUNTRY","PHONE","TIER"])`;
    const conversationField = `conversation_analytics.start(${startTs}).end(${endTs}).granularity(DAILY).phone_numbers([]).metric_types(["COST","CONVERSATION"]).dimensions(["CONVERSATION_CATEGORY","CONVERSATION_TYPE","COUNTRY","PHONE"])`;
    const [messagesResult, pricingResult, conversationsResult] = await Promise.allSettled([
        dependencies.fetchWabaField(tenant.waba_id, analyticsField, accessToken),
        dependencies.fetchWabaField(tenant.waba_id, pricingField, accessToken),
        dependencies.fetchWabaField(tenant.waba_id, conversationField, accessToken),
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
    const local = getLocalMetaReconciliation(db, {
        tenantId,
        periodStart: period.start_date,
        periodEnd: period.end_date,
    });
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
        period.start_date,
        period.end_date,
        requestedGranularity,
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

export function getMetaUsageComparison(db, {
    tenantId,
    periodStart = null,
    periodEnd = null,
} = {}) {
    if (!tenantId) {
        throw new BillingError('tenant_id مطلوب للمقارنة', { status: 400, code: 'TENANT_REQUIRED' });
    }
    if (Boolean(periodStart) !== Boolean(periodEnd)) {
        throw new BillingError('بداية ونهاية فترة المقارنة مطلوبتان معًا', {
            status: 400,
            code: 'META_COMPARISON_PERIOD_REQUIRED',
        });
    }
    let normalizedStart = null;
    let normalizedEnd = null;
    if (periodStart && periodEnd) {
        const period = normalizeBillingPeriod(db, { periodStart, periodEnd });
        normalizedStart = period.start_date;
        normalizedEnd = period.end_date;
    }
    const latestSnapshot = db.prepare(`
        SELECT *
        FROM meta_usage_snapshots
        WHERE tenant_id = ?
          ${normalizedStart ? 'AND period_start = ? AND period_end = ?' : ''}
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `).get(...(normalizedStart ? [tenantId, normalizedStart, normalizedEnd] : [tenantId])) || null;
    const defaults = db.prepare("SELECT date('now', 'start of month') AS start, date('now') AS end").get();
    const start = normalizedStart || latestSnapshot?.period_start || defaults.start;
    const end = normalizedEnd || latestSnapshot?.period_end || defaults.end;
    const local = getLocalMetaReconciliation(db, { tenantId, periodStart: start, periodEnd: end });

    return {
        tenant_id: tenantId,
        period_start: start,
        period_end: end,
        latest_snapshot: latestSnapshot,
        local,
        comparison: latestSnapshot ? {
            meta_sent: latestSnapshot.meta_sent,
            local_sent: local.local_sent,
            diff_sent: latestSnapshot.meta_sent - local.local_sent,
            meta_delivered: latestSnapshot.meta_delivered,
            local_delivered: local.local_delivered,
            diff_delivered: latestSnapshot.meta_delivered - local.local_delivered,
            meta_cost_amount: latestSnapshot.meta_cost_amount,
            local_final_amount: local.local_final_amount,
            local_customer_credits: local.local_customer_credits,
            local_customer_revenue_lyd: local.local_customer_revenue_lyd,
            invoice_total_amount: local.invoice_total_amount,
            diff_meta_vs_local_cost: latestSnapshot.meta_cost_amount - local.local_final_amount,
            diff_invoice_vs_local_cost: local.invoice_total_amount - local.local_final_amount,
        } : null,
    };
}
