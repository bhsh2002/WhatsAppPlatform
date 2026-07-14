import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
    createInvoice,
    getInvoices,
    getLedger,
} from '../services/billingHistory.js';

const createDatabase = () => {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE billing_usage_events (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            channel TEXT,
            operation_key TEXT,
            status TEXT,
            final_credits INTEGER DEFAULT 0,
            total_credits INTEGER DEFAULT 0,
            committed_at DATETIME
        );
        CREATE TABLE billing_ledger (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            entry_type TEXT,
            related_type TEXT,
            related_id TEXT,
            created_at DATETIME
        );
        CREATE TABLE billing_invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            invoice_number TEXT UNIQUE NOT NULL,
            period_start DATETIME,
            period_end DATETIME,
            subtotal_credits INTEGER DEFAULT 0,
            subtotal_lyd REAL DEFAULT 0,
            status TEXT,
            due_date DATETIME,
            notes TEXT,
            created_by INTEGER,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);
    return db;
};

const assertBillingCode = (operation, code, status) => assert.throws(
    operation,
    error => error?.code === code && error?.status === status
);

test('billing history bounds pagination, filters usage and isolates tenants', () => {
    const db = createDatabase();
    db.exec(`
        INSERT INTO billing_usage_events (id, tenant_id, channel, operation_key, status)
        VALUES
            (1, 1, 'whatsapp', 'whatsapp.text', 'committed'),
            (2, 1, 'messenger', 'messenger.reply', 'committed'),
            (3, 2, 'whatsapp', 'whatsapp.text', 'committed')
    `);
    const insertLedger = db.prepare(`
        INSERT INTO billing_ledger (id, tenant_id, entry_type, related_type, related_id, created_at)
        VALUES (?, ?, 'usage', 'usage_event', ?, ?)
    `);
    for (let id = 1; id <= 105; id += 1) {
        insertLedger.run(id, 1, id % 2 === 0 ? '2' : '1', `2026-07-13 10:${String(id % 60).padStart(2, '0')}:00`);
    }
    insertLedger.run(1000, 2, '3', '2026-07-13 12:00:00');

    assert.equal(getLedger(db, 1, { limit: 500 }).length, 100);
    assert.equal(getLedger(db, 1, { channel: 'whatsapp' }).every(row => Number(row.related_id) === 1), true);
    assert.equal(getLedger(db, 1, { operation: 'messenger.reply' }).every(row => Number(row.related_id) === 2), true);
    assert.equal(getLedger(db, 2).length, 1);
    assert.equal(getLedger(db, 1).some(row => row.id === 1000), false);

    const insertInvoice = db.prepare(`
        INSERT INTO billing_invoices (tenant_id, invoice_number, created_at)
        VALUES (?, ?, ?)
    `);
    for (let id = 1; id <= 105; id += 1) {
        insertInvoice.run(1, `INV-A-${id}`, `2026-07-${String((id % 28) + 1).padStart(2, '0')} 10:00:00`);
    }
    insertInvoice.run(2, 'INV-B-1', '2026-07-31 10:00:00');
    assert.equal(getInvoices(db, 1, { limit: 1000 }).length, 100);
    assert.equal(getInvoices(db, 2).length, 1);
    assert.equal(getInvoices(db, 1).some(invoice => invoice.invoice_number === 'INV-B-1'), false);
    db.close();
});

test('invoice creation sums committed period usage and converts credits to LYD', () => {
    const db = createDatabase();
    db.exec(`
        INSERT INTO billing_usage_events (
            id, tenant_id, channel, operation_key, status, final_credits, total_credits, committed_at
        ) VALUES
            (1, 1, 'whatsapp', 'whatsapp.text', 'committed', 5, 10, '2026-06-10 10:00:00'),
            (2, 1, 'messenger', 'messenger.reply', 'committed', 0, 7, '2026-06-20 10:00:00'),
            (3, 1, 'whatsapp', 'whatsapp.text', 'reserved', 0, 50, '2026-06-15 10:00:00'),
            (4, 1, 'whatsapp', 'whatsapp.text', 'committed', 0, 30, '2026-05-31 23:59:59'),
            (5, 2, 'whatsapp', 'whatsapp.text', 'committed', 0, 100, '2026-06-15 10:00:00')
    `);
    let ensuredTenant = null;
    const invoice = createInvoice(db, {
        tenantId: 1,
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        dueDate: '2026-07-15',
        notes: 'June usage',
        createdBy: 9,
    }, {
        ensureTenantBillingAccount(tenantId) {
            ensuredTenant = tenantId;
            return { tenant_id: tenantId };
        },
        creditValueLyd: 0.2,
    });

    assert.equal(ensuredTenant, 1);
    assert.match(invoice.invoice_number, /^INV-1-\d+-[a-f0-9]{8}$/);
    assert.equal(invoice.period_start, '2026-06-01 00:00:00');
    assert.equal(invoice.period_end, '2026-06-30 23:59:59');
    assert.equal(invoice.subtotal_credits, 12);
    assert.equal(invoice.subtotal_lyd, 2.4);
    assert.equal(invoice.status, 'issued');
    assert.equal(invoice.due_date, '2026-07-15');
    db.close();
});

test('invoice creation reports tenant and period errors without partial rows', () => {
    const db = createDatabase();
    const dependencies = {
        ensureTenantBillingAccount: () => null,
        creditValueLyd: 0.1,
    };

    assertBillingCode(() => createInvoice(db, {}, dependencies), 'TENANT_REQUIRED', 400);
    assertBillingCode(
        () => createInvoice(db, { tenantId: 404 }, dependencies),
        'TENANT_NOT_FOUND',
        404
    );
    assertBillingCode(() => createInvoice(db, {
        tenantId: 1,
        periodStart: '2026-02-31',
        periodEnd: '2026-03-02',
    }, {
        ensureTenantBillingAccount: () => ({ tenant_id: 1 }),
    }), 'INVALID_BILLING_PERIOD', 400);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM billing_invoices').get().count, 0);
    db.close();
});
