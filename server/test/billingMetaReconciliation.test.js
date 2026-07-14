import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
    createMetaInvoice,
    getMetaReconciliation,
    markMetaReconciliationReviewed,
    upsertMetaReconciliationPeriod,
} from '../services/billingMetaReconciliation.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT, waba_id TEXT);
        CREATE TABLE billing_settings (key TEXT PRIMARY KEY, value TEXT, description TEXT, updated_at DATETIME);
        CREATE TABLE meta_usage_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            period_start DATE,
            period_end DATE,
            status TEXT,
            currency TEXT,
            meta_sent INTEGER DEFAULT 0,
            meta_delivered INTEGER DEFAULT 0,
            meta_cost_amount REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE meta_invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            business_id TEXT,
            waba_id TEXT,
            invoice_number TEXT,
            provider TEXT,
            period_start DATE,
            period_end DATE,
            currency TEXT,
            subtotal_amount REAL DEFAULT 0,
            tax_amount REAL DEFAULT 0,
            total_amount REAL DEFAULT 0,
            status TEXT,
            invoice_url TEXT,
            notes TEXT,
            metadata_json TEXT,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE billing_usage_events (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            operation_key TEXT,
            channel TEXT,
            status TEXT,
            reference_type TEXT,
            reference_id TEXT,
            meta_charge_status TEXT,
            meta_reconciliation_period_id INTEGER,
            meta_invoice_id INTEGER,
            committed_at DATETIME
        );
        CREATE TABLE billing_meta_message_costs (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            usage_event_id INTEGER,
            broadcast_job_id INTEGER,
            operation_key TEXT,
            wamid TEXT,
            recipient TEXT,
            status TEXT,
            estimated_amount REAL DEFAULT 0,
            final_amount REAL DEFAULT 0,
            currency TEXT,
            meta_reconciliation_period_id INTEGER,
            meta_invoice_id INTEGER,
            sent_at DATETIME,
            updated_at DATETIME
        );
        CREATE TABLE billing_meta_reconciliation_periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            waba_id TEXT,
            period_start DATE NOT NULL,
            period_end DATE NOT NULL,
            status TEXT DEFAULT 'open',
            currency TEXT,
            meta_sent INTEGER DEFAULT 0,
            meta_delivered INTEGER DEFAULT 0,
            local_sent INTEGER DEFAULT 0,
            local_delivered INTEGER DEFAULT 0,
            diff_sent INTEGER DEFAULT 0,
            diff_delivered INTEGER DEFAULT 0,
            meta_cost_amount REAL DEFAULT 0,
            local_estimated_amount REAL DEFAULT 0,
            local_final_amount REAL DEFAULT 0,
            invoice_total_amount REAL DEFAULT 0,
            diff_meta_vs_local_cost REAL DEFAULT 0,
            diff_invoice_vs_local_cost REAL DEFAULT 0,
            pending_count INTEGER DEFAULT 0,
            estimated_count INTEGER DEFAULT 0,
            final_count INTEGER DEFAULT 0,
            not_charged_count INTEGER DEFAULT 0,
            rate_missing_count INTEGER DEFAULT 0,
            invoice_reconciled_count INTEGER DEFAULT 0,
            missing_wamid_count INTEGER DEFAULT 0,
            needs_action_count INTEGER DEFAULT 0,
            last_snapshot_id INTEGER,
            last_invoice_id INTEGER,
            summary_json TEXT,
            reviewed_at DATETIME,
            reviewed_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(tenant_id, period_start, period_end)
        );

        INSERT INTO tenants (id, name, waba_id) VALUES (1, 'A', 'waba-a'), (2, 'B', 'waba-b');
        INSERT INTO billing_settings (key, value) VALUES ('credit_value_lyd', '0.2');
        INSERT INTO meta_usage_snapshots (
            tenant_id, period_start, period_end, status, currency,
            meta_sent, meta_delivered, meta_cost_amount, created_at
        ) VALUES (1, '2026-06-01', '2026-06-30', 'synced', 'USD', 10, 8, 5, '2026-07-01 00:00:00');
        INSERT INTO billing_usage_events (
            id, tenant_id, operation_key, channel, status, reference_type,
            reference_id, meta_charge_status, committed_at
        ) VALUES (10, 1, 'whatsapp.text', 'whatsapp', 'committed', 'message', 'usage-wamid', 'pending', '2026-06-10 11:00:00');
        INSERT INTO billing_meta_message_costs (
            id, tenant_id, operation_key, wamid, recipient, status,
            estimated_amount, final_amount, currency, sent_at, updated_at
        ) VALUES (20, 1, 'whatsapp.text', 'cost-wamid', '21891', 'pending', 2, 2, 'USD', '2026-06-10 10:00:00', '2026-06-10 10:00:00');
    `);
    return db;
}

function dependencies(db) {
    return {
        getLocalMetaReconciliation({ tenantId, periodStart, periodEnd }) {
            const invoiceTotal = db.prepare(`
                SELECT COALESCE(SUM(total_amount), 0) AS total
                FROM meta_invoices
                WHERE tenant_id = ? AND period_start = ? AND period_end = ?
            `).get(tenantId, periodStart, periodEnd).total;
            return {
                local_sent: 10,
                local_delivered: 8,
                local_billable_usage_events: 2,
                local_customer_credits: 25,
                local_customer_revenue_lyd: 5,
                local_meta_cost_rows: 1,
                local_usage_fallback_rows: 1,
                local_estimated_amount: 5,
                local_final_amount: 5,
                invoice_total_amount: invoiceTotal,
            };
        },
        getLocalMetaMessageCostSummary({ tenantId, startSql, endSql }) {
            const costRows = db.prepare(`
                SELECT status, wamid FROM billing_meta_message_costs
                WHERE tenant_id = ? AND sent_at >= ? AND sent_at <= ?
            `).all(tenantId, startSql, endSql);
            const usageRows = db.prepare(`
                SELECT meta_charge_status AS status, reference_id AS wamid
                FROM billing_usage_events
                WHERE tenant_id = ? AND committed_at >= ? AND committed_at <= ?
            `).all(tenantId, startSql, endSql);
            const rows = [...costRows, ...usageRows];
            const count = (status) => rows.filter((row) => row.status === status).length;
            return {
                pending_count: count('pending'),
                estimated_count: count('estimated'),
                final_count: count('final'),
                not_charged_count: count('not_charged'),
                rate_missing_count: count('rate_missing'),
                invoice_reconciled_count: count('invoice_reconciled'),
                missing_wamid_count: rows.filter((row) => !row.wamid).length,
            };
        },
    };
}

test('reconciliation validates periods, merges action items chronologically and upserts once', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const deps = dependencies(db);

    const initial = getMetaReconciliation(db, deps, {
        tenantId: 1,
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
    });
    assert.equal(initial.metrics.status, 'needs_review');
    assert.equal(initial.metrics.counts.pending_count, 2);
    assert.deepEqual(initial.action_items.map((row) => row.reference_id), ['usage-wamid', 'cost-wamid']);

    const first = upsertMetaReconciliationPeriod(db, deps, {
        tenantId: 1,
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
    });
    const second = upsertMetaReconciliationPeriod(db, deps, {
        tenantId: 1,
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
    });
    assert.equal(first.id, second.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM billing_meta_reconciliation_periods').get().count, 1);
    assert.equal(db.prepare('SELECT meta_reconciliation_period_id FROM billing_usage_events WHERE id = 10').get().meta_reconciliation_period_id, first.id);
    assert.equal(db.prepare('SELECT meta_reconciliation_period_id FROM billing_meta_message_costs WHERE id = 20').get().meta_reconciliation_period_id, first.id);

    assert.throws(
        () => getMetaReconciliation(db, deps, { tenantId: 1, periodStart: '2026-07-01', periodEnd: '2026-06-01' }),
        (error) => error?.status === 400 && error?.code === 'INVALID_BILLING_PERIOD'
    );
});

test('Meta invoice creation validates finance fields and reconciles only the owning tenant', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const deps = dependencies(db);

    const invoice = createMetaInvoice(db, deps, {
        tenantId: 1,
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        currency: 'usd',
        subtotalAmount: 10,
        taxAmount: 2,
        invoiceUrl: 'https://example.com/invoice/1',
    });
    assert.match(invoice.invoice_number, /^META-\d+-[a-f0-9]{8}$/);
    assert.equal(invoice.currency, 'USD');
    assert.equal(invoice.total_amount, 12);
    assert.equal(db.prepare('SELECT meta_invoice_id FROM billing_usage_events WHERE id = 10').get().meta_invoice_id, invoice.id);
    assert.equal(db.prepare('SELECT meta_charge_status FROM billing_usage_events WHERE id = 10').get().meta_charge_status, 'invoice_reconciled');
    assert.equal(db.prepare('SELECT status FROM billing_meta_message_costs WHERE id = 20').get().status, 'invoice_reconciled');
    assert.equal(db.prepare('SELECT status FROM billing_meta_reconciliation_periods WHERE tenant_id = 1').get().status, 'invoice_reconciled');

    const foreignInvoiceId = Number(db.prepare(`
        INSERT INTO meta_invoices (tenant_id, invoice_number, period_start, period_end)
        VALUES (2, 'B-1', '2026-06-01', '2026-06-30')
    `).run().lastInsertRowid);
    assert.throws(
        () => upsertMetaReconciliationPeriod(db, deps, {
            tenantId: 1,
            periodStart: '2026-06-01',
            periodEnd: '2026-06-30',
            invoiceId: foreignInvoiceId,
        }),
        (error) => error?.status === 409 && error?.code === 'META_INVOICE_TENANT_MISMATCH'
    );

    assert.throws(() => createMetaInvoice(db, deps, { tenantId: 1, subtotalAmount: -1 }), (error) => error?.code === 'INVALID_META_INVOICE_AMOUNT');
    assert.throws(() => createMetaInvoice(db, deps, { tenantId: 1, currency: 'US' }), (error) => error?.code === 'INVALID_META_INVOICE_CURRENCY');
    assert.throws(() => createMetaInvoice(db, deps, { tenantId: 1, invoiceUrl: 'javascript:alert(1)' }), (error) => error?.code === 'INVALID_META_INVOICE_URL');
    assert.throws(() => createMetaInvoice(db, deps, { tenantId: 404 }), (error) => error?.code === 'TENANT_NOT_FOUND');
    assert.throws(() => createMetaInvoice(db, deps, { tenantId: 1, periodStart: '2026-06-01' }), (error) => error?.code === 'META_INVOICE_PERIOD_REQUIRED');
});

test('reviewing a reconciliation records the reviewer and respects invoice state', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const deps = dependencies(db);
    const period = upsertMetaReconciliationPeriod(db, deps, {
        tenantId: 1,
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
    });
    const reviewed = markMetaReconciliationReviewed(db, { id: period.id, reviewedBy: 7 });
    assert.equal(reviewed.status, 'synced');
    assert.equal(reviewed.reviewed_by, 7);
    assert.ok(reviewed.reviewed_at);
    assert.throws(
        () => markMetaReconciliationReviewed(db, { id: 999 }),
        (error) => error?.status === 404 && error?.code === 'META_RECONCILIATION_NOT_FOUND'
    );
});
