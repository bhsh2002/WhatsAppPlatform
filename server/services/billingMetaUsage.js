import { toInt } from './billingCore.js';
import { normalizeSqlDate } from './billingPeriod.js';

const boundedLimit = (value, fallback) => Math.min(Math.max(toInt(value, fallback), 1), 100);
const boundedOffset = (value) => Math.min(Math.max(toInt(value), 0), 1_000_000);

const placeholders = (values) => values.map(() => '?').join(', ');

const getCostRows = (db, ids) => {
    if (ids.length === 0) return [];
    return db.prepare(`
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
        WHERE bmc.id IN (${placeholders(ids)})
    `).all(...ids);
};

const getFallbackUsageRows = (db, ids) => {
    if (ids.length === 0) return [];
    return db.prepare(`
        SELECT bue.*, t.name AS tenant_name
        FROM billing_usage_events bue
        LEFT JOIN tenants t ON t.id = bue.tenant_id
        WHERE bue.id IN (${placeholders(ids)})
    `).all(...ids);
};

export function getMetaUsage(db, {
    tenantId = null,
    limit = 100,
    offset = 0,
    status = null,
} = {}) {
    const costClauses = [];
    const usageClauses = [
        "bue.channel = 'whatsapp'",
        'bue.meta_charge_status IS NOT NULL',
        "bue.meta_charge_status != 'not_applicable'",
    ];
    const costParams = [];
    const usageParams = [];
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

    const candidates = db.prepare(`
        SELECT source, row_id
        FROM (
            SELECT 'cost' AS source,
                   bmc.id AS row_id,
                   COALESCE(bmc.updated_at, bmc.sent_at) AS sort_at
            FROM billing_meta_message_costs bmc
            ${costClauses.length ? `WHERE ${costClauses.join(' AND ')}` : ''}

            UNION ALL

            SELECT 'usage' AS source,
                   bue.id AS row_id,
                   COALESCE(bue.meta_priced_at, bue.committed_at, bue.reserved_at) AS sort_at
            FROM billing_usage_events bue
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
        )
        ORDER BY sort_at DESC, row_id DESC, source
        LIMIT ? OFFSET ?
    `).all(
        ...costParams,
        ...usageParams,
        boundedLimit(limit, 100),
        boundedOffset(offset)
    );

    const costIds = candidates.filter((row) => row.source === 'cost').map((row) => row.row_id);
    const usageIds = candidates.filter((row) => row.source === 'usage').map((row) => row.row_id);
    const rowsByKey = new Map([
        ...getCostRows(db, costIds).map((row) => [`cost:${row.id}`, row]),
        ...getFallbackUsageRows(db, usageIds).map((row) => [`usage:${row.id}`, row]),
    ]);
    return candidates.map((candidate) => rowsByKey.get(`${candidate.source}:${candidate.row_id}`)).filter(Boolean);
}

export function getMetaCostSummary(db, {
    tenantId = null,
    periodStart = null,
    periodEnd = null,
} = {}) {
    const startSql = periodStart ? normalizeSqlDate(db, periodStart) : null;
    const endSql = periodEnd ? normalizeSqlDate(db, periodEnd, true) : null;
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

    if (toInt(totals?.usage_count) > 0) {
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

export function listMetaInvoices(db, { tenantId = null, limit = 50, offset = 0 } = {}) {
    const clauses = [];
    const params = [];
    if (tenantId) {
        clauses.push('mi.tenant_id = ?');
        params.push(tenantId);
    }
    params.push(boundedLimit(limit, 50), boundedOffset(offset));

    return db.prepare(`
        SELECT mi.*, t.name AS tenant_name
        FROM meta_invoices mi
        LEFT JOIN tenants t ON t.id = mi.tenant_id
        ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY COALESCE(mi.period_end, mi.created_at) DESC, mi.id DESC
        LIMIT ? OFFSET ?
    `).all(...params);
}

export function listMetaUsageSnapshots(db, { tenantId = null, limit = 10, offset = 0 } = {}) {
    const clauses = [];
    const params = [];
    if (tenantId) {
        clauses.push('mus.tenant_id = ?');
        params.push(tenantId);
    }
    params.push(boundedLimit(limit, 10), boundedOffset(offset));

    return db.prepare(`
        SELECT mus.*, t.name AS tenant_name
        FROM meta_usage_snapshots mus
        LEFT JOIN tenants t ON t.id = mus.tenant_id
        ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY mus.created_at DESC, mus.id DESC
        LIMIT ? OFFSET ?
    `).all(...params);
}
