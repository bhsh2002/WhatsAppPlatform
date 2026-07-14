import { randomUUID } from 'node:crypto';
import { BillingError, serializeJson, toInt } from './billingCore.js';
import { normalizeBillingPeriod } from './billingPeriod.js';
import { getBillingSettings } from './billingSettings.js';

const nowSql = "datetime('now', 'localtime')";
const META_COST_DIFF_THRESHOLD = 0.01;
const META_RECONCILIATION_STATUSES = new Set(['open', 'synced', 'needs_review', 'invoice_reconciled']);

const boundedLimit = (value, fallback = 50) => Math.min(Math.max(toInt(value, fallback), 1), 100);

const requireDependencies = (dependencies) => {
    for (const name of ['getLocalMetaReconciliation', 'getLocalMetaMessageCostSummary']) {
        if (typeof dependencies?.[name] !== 'function') {
            throw new TypeError(`${name} dependency is required`);
        }
    }
};

const validatePeriod = (db, periodStart, periodEnd) => {
    if (!periodStart || !periodEnd) {
        throw new BillingError('tenant_id و period_start و period_end مطلوبة للمطابقة', {
            status: 400,
            code: 'META_RECONCILIATION_FIELDS_REQUIRED',
        });
    }
    const period = normalizeBillingPeriod(db, { periodStart, periodEnd });
    return { startSql: period.start, endSql: period.end };
};

const getLatestSnapshot = (db, { tenantId, periodStart, periodEnd, snapshotId = null }) => {
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
};

const getLatestMetaInvoiceForPeriod = (db, { tenantId, periodStart, periodEnd }) => db.prepare(`
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

function listMetaReconciliationActionItems(db, { tenantId, startSql, endSql, limit = 50 }) {
    const normalizedLimit = boundedLimit(limit);
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
    `).all(tenantId, startSql, endSql, normalizedLimit);

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
    `).all(tenantId, startSql, endSql, normalizedLimit);

    return [...messageCostItems, ...usageItems]
        .sort((left, right) => String(right.committed_at || '').localeCompare(String(left.committed_at || '')))
        .slice(0, normalizedLimit);
}

function linkUsageToReconciliationPeriod(db, { periodId, invoiceId = null, tenantId, startSql, endSql }) {
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

    if (!invoiceId) return;
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

export function buildMetaReconciliationMetrics(db, dependencies, {
    tenantId,
    periodStart,
    periodEnd,
    snapshotId = null,
} = {}) {
    requireDependencies(dependencies);
    const { startSql, endSql } = validatePeriod(db, periodStart, periodEnd);
    const local = dependencies.getLocalMetaReconciliation({ tenantId, periodStart, periodEnd });
    const snapshot = getLatestSnapshot(db, { tenantId, periodStart, periodEnd, snapshotId });
    const invoice = getLatestMetaInvoiceForPeriod(db, { tenantId, periodStart, periodEnd });
    const counts = dependencies.getLocalMetaMessageCostSummary({ tenantId, startSql, endSql });
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

export function upsertMetaReconciliationPeriod(db, dependencies, {
    tenantId,
    periodStart,
    periodEnd,
    snapshotId = null,
    invoiceId = null,
    reviewedBy = null,
} = {}) {
    requireDependencies(dependencies);
    validatePeriod(db, periodStart, periodEnd);
    const tenant = db.prepare('SELECT id, waba_id FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) {
        throw new BillingError('العميل غير موجود', { status: 404, code: 'TENANT_NOT_FOUND' });
    }

    return db.transaction(() => {
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
            ? db.prepare('SELECT * FROM meta_invoices WHERE id = ? AND tenant_id = ?').get(invoiceId, tenantId)
            : getLatestMetaInvoiceForPeriod(db, { tenantId, periodStart, periodEnd });
        if (invoiceId && !latestInvoice) {
            throw new BillingError('فاتورة Meta لا تخص العميل', {
                status: 409,
                code: 'META_INVOICE_TENANT_MISMATCH',
            });
        }
        const metricsBeforeLink = buildMetaReconciliationMetrics(db, dependencies, {
            tenantId,
            periodStart,
            periodEnd,
            snapshotId,
        });
        linkUsageToReconciliationPeriod(db, {
            periodId: period.id,
            invoiceId: latestInvoice?.id || null,
            tenantId,
            startSql: metricsBeforeLink.start_sql,
            endSql: metricsBeforeLink.end_sql,
        });
        const metrics = buildMetaReconciliationMetrics(db, dependencies, {
            tenantId,
            periodStart,
            periodEnd,
            snapshotId,
        });
        const status = META_RECONCILIATION_STATUSES.has(metrics.status) ? metrics.status : 'open';

        db.prepare(`
            UPDATE billing_meta_reconciliation_periods
            SET waba_id = ?, status = ?, currency = ?, meta_sent = ?, meta_delivered = ?,
                local_sent = ?, local_delivered = ?, diff_sent = ?, diff_delivered = ?,
                meta_cost_amount = ?, local_estimated_amount = ?, local_final_amount = ?,
                invoice_total_amount = ?, diff_meta_vs_local_cost = ?, diff_invoice_vs_local_cost = ?,
                pending_count = ?, estimated_count = ?, final_count = ?, not_charged_count = ?,
                rate_missing_count = ?, invoice_reconciled_count = ?, missing_wamid_count = ?,
                needs_action_count = ?, last_snapshot_id = COALESCE(?, last_snapshot_id),
                last_invoice_id = COALESCE(?, last_invoice_id), summary_json = ?,
                reviewed_at = COALESCE(reviewed_at, CASE WHEN ? IS NULL THEN NULL ELSE ${nowSql} END),
                reviewed_by = COALESCE(reviewed_by, ?), updated_at = ${nowSql}
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
    })();
}

export function getMetaReconciliation(db, dependencies, { tenantId, periodStart, periodEnd } = {}) {
    requireDependencies(dependencies);
    if (!tenantId || !periodStart || !periodEnd) {
        throw new BillingError('tenant_id و period_start و period_end مطلوبة للمطابقة', {
            status: 400,
            code: 'META_RECONCILIATION_FIELDS_REQUIRED',
        });
    }
    const metrics = buildMetaReconciliationMetrics(db, dependencies, { tenantId, periodStart, periodEnd });
    const period = db.prepare(`
        SELECT *
        FROM billing_meta_reconciliation_periods
        WHERE tenant_id = ? AND period_start = ? AND period_end = ?
    `).get(tenantId, periodStart, periodEnd) || null;
    return {
        period,
        metrics,
        action_items: listMetaReconciliationActionItems(db, {
            tenantId,
            startSql: metrics.start_sql,
            endSql: metrics.end_sql,
            limit: 50,
        }),
        settings: getBillingSettings(db).settings,
    };
}

export async function syncMetaReconciliationPeriod(db, dependencies, options = {}) {
    if (typeof dependencies?.syncMetaUsageSnapshot !== 'function') {
        throw new TypeError('syncMetaUsageSnapshot dependency is required');
    }
    const snapshot = await dependencies.syncMetaUsageSnapshot(options);
    const period = upsertMetaReconciliationPeriod(db, dependencies, {
        tenantId: options.tenantId,
        periodStart: options.periodStart,
        periodEnd: options.periodEnd,
        snapshotId: snapshot.id,
    });
    return {
        period,
        snapshot,
        reconciliation: getMetaReconciliation(db, dependencies, options),
    };
}

export function markMetaReconciliationReviewed(db, { id, reviewedBy = null } = {}) {
    const existing = db.prepare('SELECT * FROM billing_meta_reconciliation_periods WHERE id = ?').get(id);
    if (!existing) {
        throw new BillingError('فترة المطابقة غير موجودة', { status: 404, code: 'META_RECONCILIATION_NOT_FOUND' });
    }
    const nextStatus = existing.invoice_total_amount > 0 ? 'invoice_reconciled' : 'synced';
    db.prepare(`
        UPDATE billing_meta_reconciliation_periods
        SET status = ?, reviewed_at = ${nowSql}, reviewed_by = ?, updated_at = ${nowSql}
        WHERE id = ?
    `).run(nextStatus, reviewedBy || null, id);
    return db.prepare('SELECT * FROM billing_meta_reconciliation_periods WHERE id = ?').get(id);
}

const normalizeMoney = (value, field) => {
    const normalized = Number(value ?? 0);
    if (!Number.isFinite(normalized) || normalized < 0) {
        throw new BillingError('قيمة فاتورة Meta غير صالحة', {
            status: 400,
            code: 'INVALID_META_INVOICE_AMOUNT',
            field,
        });
    }
    return normalized;
};

export function createMetaInvoice(db, dependencies, {
    tenantId = null,
    businessId = null,
    wabaId = null,
    invoiceNumber = null,
    periodStart = null,
    periodEnd = null,
    currency = 'USD',
    subtotalAmount = 0,
    taxAmount = 0,
    totalAmount = null,
    status = 'received',
    invoiceUrl = null,
    notes = null,
    metadata = null,
    createdBy = null,
} = {}) {
    requireDependencies(dependencies);
    if (tenantId && !db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId)) {
        throw new BillingError('العميل غير موجود', { status: 404, code: 'TENANT_NOT_FOUND' });
    }
    if (Boolean(periodStart) !== Boolean(periodEnd)) {
        throw new BillingError('بداية ونهاية فترة فاتورة Meta مطلوبتان معًا', {
            status: 400,
            code: 'META_INVOICE_PERIOD_REQUIRED',
        });
    }
    if (periodStart && periodEnd) validatePeriod(db, periodStart, periodEnd);
    const normalizedCurrency = String(currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
        throw new BillingError('عملة فاتورة Meta غير صالحة', { status: 400, code: 'INVALID_META_INVOICE_CURRENCY' });
    }
    const subtotal = normalizeMoney(subtotalAmount, 'subtotal_amount');
    const tax = normalizeMoney(taxAmount, 'tax_amount');
    const total = totalAmount === null || totalAmount === undefined
        ? subtotal + tax
        : normalizeMoney(totalAmount, 'total_amount');
    if (invoiceUrl) {
        let parsed;
        try {
            parsed = new URL(String(invoiceUrl));
        } catch {
            parsed = null;
        }
        if (!parsed || parsed.protocol !== 'https:') {
            throw new BillingError('رابط فاتورة Meta يجب أن يستخدم HTTPS', {
                status: 400,
                code: 'INVALID_META_INVOICE_URL',
            });
        }
    }

    return db.transaction(() => {
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
            invoiceNumber || `META-${Date.now()}-${randomUUID().slice(0, 8)}`,
            periodStart || null,
            periodEnd || null,
            normalizedCurrency,
            subtotal,
            tax,
            total,
            String(status || 'received').trim().slice(0, 64) || 'received',
            invoiceUrl || null,
            notes || null,
            serializeJson(metadata),
            createdBy || null
        );
        const invoice = db.prepare('SELECT * FROM meta_invoices WHERE id = ?').get(result.lastInsertRowid);
        if (tenantId && periodStart && periodEnd) {
            upsertMetaReconciliationPeriod(db, dependencies, {
                tenantId,
                periodStart,
                periodEnd,
                invoiceId: invoice.id,
            });
        }
        return invoice;
    })();
}
