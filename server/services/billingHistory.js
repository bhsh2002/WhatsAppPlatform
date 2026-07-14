import { randomUUID } from 'node:crypto';
import { BillingError, toInt } from './billingCore.js';
import { normalizeBillingPeriod } from './billingPeriod.js';

const boundedLimit = (value, fallback) => Math.min(Math.max(toInt(value, fallback), 1), 100);
const boundedOffset = (value) => Math.min(Math.max(toInt(value), 0), 1_000_000);

export function getLedger(db, tenantId, {
    limit = 50,
    offset = 0,
    channel = null,
    operation = null,
} = {}) {
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
    params.push(boundedLimit(limit, 50), boundedOffset(offset));

    return db.prepare(`
        SELECT bl.*
        FROM billing_ledger bl
        WHERE ${clauses.join(' AND ')}
        ORDER BY bl.created_at DESC, bl.id DESC
        LIMIT ? OFFSET ?
    `).all(...params);
}

export function getInvoices(db, tenantId, { limit = 20, offset = 0 } = {}) {
    return db.prepare(`
        SELECT *
        FROM billing_invoices
        WHERE tenant_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
    `).all(tenantId, boundedLimit(limit, 20), boundedOffset(offset));
}

export function createInvoice(db, {
    tenantId,
    periodStart = null,
    periodEnd = null,
    dueDate = null,
    notes = null,
    createdBy = null,
} = {}, {
    ensureTenantBillingAccount,
    creditValueLyd = 0.1,
} = {}) {
    if (!tenantId) {
        throw new BillingError('العميل مطلوب لإنشاء الفاتورة', { status: 400, code: 'TENANT_REQUIRED' });
    }
    if (typeof ensureTenantBillingAccount !== 'function') {
        throw new TypeError('ensureTenantBillingAccount dependency is required');
    }

    return db.transaction(() => {
        const account = ensureTenantBillingAccount(tenantId);
        if (!account) {
            throw new BillingError('العميل غير موجود', { status: 404, code: 'TENANT_NOT_FOUND' });
        }
        const periodClause = [];
        const params = [tenantId];
        const period = periodStart || periodEnd
            ? normalizeBillingPeriod(db, { periodStart, periodEnd })
            : null;

        if (period) {
            periodClause.push('committed_at >= ?');
            params.push(period.start);
            periodClause.push('committed_at <= ?');
            params.push(period.end);
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

        const credits = toInt(usage?.credits);
        const normalizedCreditValue = Number(creditValueLyd);
        const rawSubtotalLyd = credits * (
            Number.isFinite(normalizedCreditValue) && normalizedCreditValue > 0
                ? normalizedCreditValue
                : 0.1
        );
        const subtotalLyd = Math.round((rawSubtotalLyd + Number.EPSILON) * 1000) / 1000;
        const invoiceNumber = `INV-${tenantId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
        const invoice = db.prepare(`
            INSERT INTO billing_invoices (
                tenant_id, invoice_number, period_start, period_end,
                subtotal_credits, subtotal_lyd, status, due_date, notes, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)
        `).run(
            tenantId,
            invoiceNumber,
            period?.start || periodStart,
            period?.end || periodEnd,
            credits,
            subtotalLyd,
            dueDate,
            notes,
            createdBy
        );

        return db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(invoice.lastInsertRowid);
    })();
}
