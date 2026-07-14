import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
    getMetaCostSummary,
    getMetaUsage,
    listMetaInvoices,
    listMetaUsageSnapshots,
} from '../services/billingMetaUsage.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE billing_meta_message_costs (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            usage_event_id INTEGER,
            broadcast_job_id INTEGER,
            operation_key TEXT,
            wamid TEXT,
            metadata_json TEXT,
            template_category TEXT,
            country_calling_code TEXT,
            currency TEXT,
            estimated_amount REAL DEFAULT 0,
            final_amount REAL DEFAULT 0,
            rate_card_id INTEGER,
            charge_reason TEXT,
            status TEXT,
            status_payload_json TEXT,
            delivered_at DATETIME,
            updated_at DATETIME,
            sent_at DATETIME
        );
        CREATE TABLE billing_usage_events (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            operation_key TEXT,
            channel TEXT,
            operation_type TEXT,
            quantity INTEGER DEFAULT 1,
            unit_price_credits INTEGER DEFAULT 0,
            total_credits INTEGER DEFAULT 0,
            status TEXT,
            reference_type TEXT,
            reference_id TEXT,
            metadata_json TEXT,
            meta_charge_category TEXT,
            meta_country_calling_code TEXT,
            meta_charge_currency TEXT,
            meta_estimated_amount REAL DEFAULT 0,
            meta_final_amount REAL DEFAULT 0,
            meta_rate_card_id INTEGER,
            meta_charge_reason TEXT,
            meta_charge_status TEXT,
            meta_status_payload_json TEXT,
            meta_delivered_at DATETIME,
            meta_priced_at DATETIME,
            committed_at DATETIME,
            reserved_at DATETIME
        );
        CREATE TABLE meta_invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            invoice_number TEXT,
            period_end DATETIME,
            created_at DATETIME
        );
        CREATE TABLE meta_usage_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            status TEXT,
            created_at DATETIME
        );
        INSERT INTO tenants (id, name) VALUES (1, 'A'), (2, 'B'), (3, 'C');
    `);
    return db;
}

test('Meta usage paginates a single ordered stream across cost and fallback rows', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const insertCost = db.prepare(`
        INSERT INTO billing_meta_message_costs (
            id, tenant_id, usage_event_id, operation_key, wamid, template_category,
            country_calling_code, currency, estimated_amount, final_amount, status,
            updated_at, sent_at
        ) VALUES (?, ?, ?, 'whatsapp.text', ?, 'utility', '218', 'USD', 1, 1, ?, ?, ?)
    `);
    insertCost.run(1, 1, null, 'wamid-1', 'final', '2026-06-10 10:00:00', '2026-06-10 10:00:00');
    insertCost.run(2, 1, 12, 'wamid-2', 'final', '2026-06-10 12:00:00', '2026-06-10 12:00:00');
    insertCost.run(3, 2, null, 'wamid-b', 'final', '2026-06-10 13:00:00', '2026-06-10 13:00:00');

    const insertUsage = db.prepare(`
        INSERT INTO billing_usage_events (
            id, tenant_id, operation_key, channel, operation_type, status,
            reference_type, reference_id, meta_charge_status, meta_priced_at,
            committed_at, reserved_at
        ) VALUES (?, ?, 'whatsapp.text', 'whatsapp', 'text', 'committed', 'message', ?, ?, ?, ?, ?)
    `);
    insertUsage.run(10, 1, 'usage-10', 'pending', '2026-06-10 11:00:00', '2026-06-10 11:00:00', '2026-06-10 11:00:00');
    insertUsage.run(11, 1, 'usage-11', 'final', '2026-06-10 09:00:00', '2026-06-10 09:00:00', '2026-06-10 09:00:00');
    insertUsage.run(12, 1, 'usage-linked', 'final', '2026-06-10 14:00:00', '2026-06-10 14:00:00', '2026-06-10 14:00:00');

    const firstPage = getMetaUsage(db, { tenantId: 1, limit: 2 });
    const secondPage = getMetaUsage(db, { tenantId: 1, limit: 2, offset: 2 });
    assert.deepEqual(firstPage.map((row) => row.reference_id), ['wamid-2', 'usage-10']);
    assert.deepEqual(secondPage.map((row) => row.reference_id), ['wamid-1', 'usage-11']);
    assert.equal(new Set([...firstPage, ...secondPage].map((row) => row.reference_id)).size, 4);
    assert.deepEqual(getMetaUsage(db, { tenantId: 1, status: 'pending' }).map((row) => row.reference_id), ['usage-10']);
    assert.equal(getMetaUsage(db, { tenantId: 1 }).some((row) => row.reference_id === 'wamid-b'), false);
});

test('Meta cost summary prefers message costs and falls back to committed usage per tenant', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    db.exec(`
        INSERT INTO billing_meta_message_costs (
            id, tenant_id, operation_key, template_category, country_calling_code,
            currency, estimated_amount, final_amount, status, sent_at
        ) VALUES
            (1, 1, 'whatsapp.text', 'utility', '218', 'USD', 2, 1.5, 'final', '2026-06-10 10:00:00'),
            (2, 1, 'whatsapp.text', 'marketing', '218', 'USD', 3, 0, 'pending', '2026-06-11 10:00:00'),
            (3, 2, 'whatsapp.text', 'utility', '20', 'EUR', 99, 99, 'final', '2026-06-10 10:00:00');
        INSERT INTO billing_usage_events (
            id, tenant_id, operation_key, channel, operation_type, quantity, status,
            meta_charge_category, meta_country_calling_code, meta_charge_currency,
            meta_estimated_amount, meta_final_amount, meta_charge_status, committed_at
        ) VALUES
            (10, 3, 'whatsapp.text', 'whatsapp', 'text', 2, 'committed', 'utility', '218', 'USD', 4, 3, 'final', '2026-06-12 10:00:00'),
            (11, 2, 'whatsapp.text', 'whatsapp', 'text', 5, 'committed', 'utility', '20', 'EUR', 50, 50, 'final', '2026-06-12 10:00:00');
    `);

    const costs = getMetaCostSummary(db, { tenantId: 1, periodStart: '2026-06-01', periodEnd: '2026-06-30' });
    assert.equal(costs.source, 'billing_meta_message_costs');
    assert.equal(costs.totals.usage_count, 2);
    assert.equal(costs.totals.estimated_amount, 5);
    assert.equal(costs.totals.final_amount, 1.5);
    assert.equal(costs.by_category.length, 2);

    const fallback = getMetaCostSummary(db, { tenantId: 3, periodStart: '2026-06-01', periodEnd: '2026-06-30' });
    assert.equal(fallback.source, 'billing_usage_events_fallback');
    assert.equal(fallback.totals.usage_count, 1);
    assert.equal(fallback.totals.final_amount, 3);
    assert.equal(fallback.by_country[0].quantity, 2);
});

test('Meta invoice and snapshot lists are bounded, offset-aware and tenant-scoped', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const invoice = db.prepare(`
        INSERT INTO meta_invoices (tenant_id, invoice_number, period_end, created_at)
        VALUES (?, ?, ?, ?)
    `);
    const snapshot = db.prepare(`
        INSERT INTO meta_usage_snapshots (tenant_id, status, created_at)
        VALUES (?, 'synced', ?)
    `);
    for (let index = 1; index <= 105; index += 1) {
        const createdAt = `2026-06-${String((index % 28) + 1).padStart(2, '0')} 10:${String(index % 60).padStart(2, '0')}:00`;
        invoice.run(1, `A-${index}`, createdAt, createdAt);
        snapshot.run(1, createdAt);
    }
    invoice.run(2, 'B-ONLY', '2026-07-31 00:00:00', '2026-07-31 00:00:00');
    snapshot.run(2, '2026-07-31 00:00:00');

    assert.equal(listMetaInvoices(db, { tenantId: 1, limit: 999 }).length, 100);
    assert.equal(listMetaInvoices(db, { tenantId: 1, limit: 10, offset: 100 }).length, 5);
    assert.equal(listMetaInvoices(db, { tenantId: 1 }).some((row) => row.invoice_number === 'B-ONLY'), false);
    assert.equal(listMetaUsageSnapshots(db, { tenantId: 1, limit: 999 }).length, 100);
    assert.equal(listMetaUsageSnapshots(db, { tenantId: 1, limit: 10, offset: 100 }).length, 5);
    assert.equal(listMetaUsageSnapshots(db, { tenantId: 1 }).some((row) => row.tenant_id === 2), false);
});
