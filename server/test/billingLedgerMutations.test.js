import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
    applyMonthlyAllowance,
    recordAdjustment,
    recordPayment,
    updateTenantBillingAccount,
} from '../services/billingLedgerMutations.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE tenants (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Active',
            credits INTEGER NOT NULL DEFAULT 0,
            updated_at DATETIME
        );
        CREATE TABLE billing_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            monthly_price_lyd REAL DEFAULT 0,
            monthly_included_credits INTEGER DEFAULT 0,
            default_credit_limit INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1
        );
        CREATE TABLE tenant_billing_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER UNIQUE NOT NULL,
            plan_id INTEGER,
            wallet_balance_credits INTEGER DEFAULT 0,
            plan_balance_credits INTEGER DEFAULT 0,
            credit_limit_credits INTEGER DEFAULT 0,
            credit_used_credits INTEGER DEFAULT 0,
            billing_cycle_start DATETIME DEFAULT CURRENT_TIMESTAMP,
            billing_cycle_end DATETIME,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE billing_usage_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            total_credits INTEGER DEFAULT 0,
            status TEXT NOT NULL
        );
        CREATE TABLE billing_ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            entry_type TEXT NOT NULL,
            direction TEXT NOT NULL,
            credits_delta INTEGER NOT NULL,
            amount_lyd REAL,
            balance_after_credits INTEGER,
            related_type TEXT,
            related_id TEXT,
            description TEXT,
            metadata_json TEXT,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE billing_invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL
        );
        CREATE TABLE billing_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            invoice_id INTEGER,
            amount_lyd REAL DEFAULT 0,
            credits INTEGER DEFAULT 0,
            method TEXT,
            reference TEXT,
            note TEXT,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO billing_plans (code, name, monthly_included_credits, default_credit_limit)
        VALUES ('legacy', 'Legacy', 0, 0);
        INSERT INTO billing_plans (code, name, monthly_included_credits, default_credit_limit)
        VALUES ('pro', 'Pro', 50, 20);
        INSERT INTO tenants (id, name, status, credits) VALUES (1, 'First', 'Active', 100);
        INSERT INTO tenants (id, name, status, credits) VALUES (2, 'Second', 'Active', 20);
    `);
    return db;
}

const dependencies = (db) => ({
    getBillingSummary: (tenantId) => ({
        tenant_id: Number(tenantId),
        available_credits: db.prepare('SELECT credits FROM tenants WHERE id = ?').get(tenantId)?.credits ?? null,
    }),
});

test('payments add wallet credit atomically and reject invalid or cross-tenant invoices', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const deps = dependencies(db);

    const result = recordPayment(db, deps, {
        tenantId: 1,
        credits: 25,
        amountLyd: 12.5,
        method: 'bank',
        reference: 'PAY-1',
    });
    assert.equal(result.payment.credits, 25);
    assert.equal(result.payment.amount_lyd, 12.5);
    assert.equal(db.prepare('SELECT wallet_balance_credits FROM tenant_billing_accounts WHERE tenant_id = 1').get().wallet_balance_credits, 125);
    assert.equal(db.prepare('SELECT credits FROM tenants WHERE id = 1').get().credits, 125);
    assert.deepEqual(
        db.prepare("SELECT direction, credits_delta, balance_after_credits FROM billing_ledger WHERE entry_type = 'payment'").get(),
        { direction: 'credit', credits_delta: 25, balance_after_credits: 125 }
    );

    const foreignInvoiceId = Number(db.prepare('INSERT INTO billing_invoices (tenant_id) VALUES (2)').run().lastInsertRowid);
    assert.throws(
        () => recordPayment(db, deps, { tenantId: 1, credits: 5, invoiceId: foreignInvoiceId }),
        (error) => error?.status === 409 && error?.code === 'INVOICE_TENANT_MISMATCH'
    );
    assert.throws(
        () => recordPayment(db, deps, { tenantId: 1, credits: 1.5 }),
        (error) => error?.status === 400 && error?.code === 'INVALID_PAYMENT_CREDITS'
    );
    assert.throws(
        () => recordPayment(db, deps, { tenantId: 1, credits: 5, amountLyd: -1 }),
        (error) => error?.status === 400 && error?.code === 'INVALID_PAYMENT_AMOUNT'
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM billing_payments').get().count, 1);
});

test('manual adjustments require an integer delta and an audit reason', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const deps = dependencies(db);

    const result = recordAdjustment(db, deps, {
        tenantId: 1,
        creditsDelta: -30,
        reason: 'تصحيح رصيد اختباري',
    });
    assert.equal(result.ledger.direction, 'debit');
    assert.equal(result.ledger.credits_delta, -30);
    assert.equal(result.ledger.balance_after_credits, 70);
    assert.equal(db.prepare('SELECT credits FROM tenants WHERE id = 1').get().credits, 70);

    assert.throws(
        () => recordAdjustment(db, deps, { tenantId: 1, creditsDelta: 1.2, reason: 'invalid' }),
        (error) => error?.code === 'INVALID_ADJUSTMENT_CREDITS'
    );
    assert.throws(
        () => recordAdjustment(db, deps, { tenantId: 1, creditsDelta: 5, reason: '  ' }),
        (error) => error?.code === 'ADJUSTMENT_REASON_REQUIRED'
    );
});

test('account updates validate plans and ledger every direct financial change', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const deps = dependencies(db);
    const proPlanId = db.prepare("SELECT id FROM billing_plans WHERE code = 'pro'").get().id;

    const planSummary = updateTenantBillingAccount(db, deps, 1, { plan_id: proPlanId });
    assert.equal(planSummary.available_credits, 170);
    const account = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = 1').get();
    assert.equal(account.plan_balance_credits, 50);
    assert.equal(account.credit_limit_credits, 20);
    assert.ok(account.billing_cycle_end);
    assert.deepEqual(
        db.prepare("SELECT direction, credits_delta FROM billing_ledger WHERE entry_type = 'plan_change'").get(),
        { direction: 'credit', credits_delta: 70 }
    );

    updateTenantBillingAccount(db, deps, 1, { wallet_balance_credits: 90 });
    assert.deepEqual(
        db.prepare("SELECT direction, credits_delta FROM billing_ledger WHERE entry_type = 'account_adjustment'").get(),
        { direction: 'debit', credits_delta: -10 }
    );
    assert.equal(db.prepare('SELECT credits FROM tenants WHERE id = 1').get().credits, 160);

    assert.throws(
        () => updateTenantBillingAccount(db, deps, 1, { plan_id: 999 }),
        (error) => error?.status === 404 && error?.code === 'BILLING_PLAN_NOT_FOUND'
    );
    assert.throws(
        () => updateTenantBillingAccount(db, deps, 1, { status: 'invalid' }),
        (error) => error?.status === 400 && error?.code === 'INVALID_BILLING_ACCOUNT_STATUS'
    );
    assert.throws(
        () => updateTenantBillingAccount(db, deps, 1, { billing_cycle_end: '2026-02-31' }),
        (error) => error?.status === 400 && error?.code === 'INVALID_BILLING_PERIOD'
    );
});

test('monthly allowance renews due paid plans with a net availability ledger delta', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const deps = dependencies(db);
    const legacyPlanId = db.prepare("SELECT id FROM billing_plans WHERE code = 'legacy'").get().id;
    const proPlanId = db.prepare("SELECT id FROM billing_plans WHERE code = 'pro'").get().id;

    assert.equal(applyMonthlyAllowance(db, deps, 1).reason, 'legacy_plan');
    updateTenantBillingAccount(db, deps, 1, { plan_id: proPlanId });
    db.prepare(`
        UPDATE tenant_billing_accounts
        SET plan_balance_credits = 20, credit_limit_credits = 20, credit_used_credits = 5,
            billing_cycle_end = '2000-01-01 00:00:00'
        WHERE tenant_id = 1
    `).run();

    const renewed = applyMonthlyAllowance(db, deps, 1);
    assert.equal(renewed.applied, true);
    const account = db.prepare('SELECT * FROM tenant_billing_accounts WHERE tenant_id = 1').get();
    assert.equal(account.plan_id, proPlanId);
    assert.equal(account.plan_balance_credits, 50);
    assert.equal(account.credit_used_credits, 0);
    assert.equal(db.prepare('SELECT credits FROM tenants WHERE id = 1').get().credits, 170);
    assert.deepEqual(
        db.prepare("SELECT direction, credits_delta, balance_after_credits FROM billing_ledger WHERE entry_type = 'monthly_allowance'").get(),
        { direction: 'credit', credits_delta: 35, balance_after_credits: 170 }
    );
    assert.equal(applyMonthlyAllowance(db, deps, 1).reason, 'cycle_not_due');

    db.prepare('UPDATE tenant_billing_accounts SET plan_id = ? WHERE tenant_id = 1').run(legacyPlanId);
    assert.equal(applyMonthlyAllowance(db, deps, 1).reason, 'legacy_plan');
});
