import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { getBillingSummary } from '../services/billingSummary.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE tenants (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL,
            credits INTEGER DEFAULT 0,
            updated_at DATETIME
        );
        CREATE TABLE billing_plans (
            id INTEGER PRIMARY KEY,
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            monthly_price_lyd REAL DEFAULT 0,
            monthly_included_credits INTEGER DEFAULT 0,
            default_credit_limit INTEGER DEFAULT 0
        );
        CREATE TABLE tenant_billing_accounts (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER UNIQUE NOT NULL,
            plan_id INTEGER,
            wallet_balance_credits INTEGER DEFAULT 0,
            plan_balance_credits INTEGER DEFAULT 0,
            credit_limit_credits INTEGER DEFAULT 0,
            credit_used_credits INTEGER DEFAULT 0,
            billing_cycle_start DATETIME,
            billing_cycle_end DATETIME,
            status TEXT DEFAULT 'active',
            created_at DATETIME,
            updated_at DATETIME
        );
        CREATE TABLE billing_usage_events (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            channel TEXT,
            operation_type TEXT,
            operation_key TEXT,
            quantity INTEGER DEFAULT 1,
            total_credits INTEGER DEFAULT 0,
            final_credits INTEGER DEFAULT 0,
            status TEXT,
            customer_charge_type TEXT,
            tenant_visible_usage INTEGER DEFAULT 1,
            meta_estimated_amount REAL DEFAULT 0,
            meta_final_amount REAL DEFAULT 0,
            meta_charge_currency TEXT,
            meta_charge_status TEXT,
            committed_at DATETIME
        );
        CREATE TABLE billing_payments (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            amount_lyd REAL DEFAULT 0,
            created_at DATETIME
        );
        CREATE TABLE billing_invoices (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            invoice_number TEXT,
            created_at DATETIME
        );
        CREATE TABLE billing_ledger (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            entry_type TEXT,
            related_type TEXT,
            related_id TEXT,
            created_at DATETIME
        );
        CREATE TABLE billing_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            description TEXT,
            updated_at DATETIME
        );

        INSERT INTO billing_plans (
            id, code, name, description, monthly_price_lyd,
            monthly_included_credits, default_credit_limit
        ) VALUES (1, 'legacy', 'Legacy', 'Legacy plan', 0, 0, 0);
        INSERT INTO tenants (id, name, status, credits) VALUES
            (1, 'Tenant A', 'Active', 0),
            (2, 'Tenant B', 'Active', 0);
        INSERT INTO tenant_billing_accounts (
            id, tenant_id, plan_id, wallet_balance_credits, plan_balance_credits,
            credit_limit_credits, credit_used_credits, billing_cycle_start, status
        ) VALUES
            (1, 1, 1, 100, 50, 20, 5, '2026-06-01 00:00:00', 'active'),
            (2, 2, 1, 900, 0, 0, 0, '2026-06-01 00:00:00', 'active');
        INSERT INTO billing_usage_events (
            id, tenant_id, channel, operation_type, operation_key, quantity,
            total_credits, final_credits, status, customer_charge_type,
            tenant_visible_usage, meta_estimated_amount, meta_final_amount,
            meta_charge_currency, meta_charge_status, committed_at
        ) VALUES
            (1, 1, 'whatsapp', 'text', 'whatsapp.text', 1, 5, 0, 'committed', 'platform_fee', 1, 2, 2, 'USD', 'final', '2026-06-10 10:00:00'),
            (2, 1, 'messenger', 'reply', 'messenger.reply', 1, 4, 3, 'committed', 'paid', 1, 0, 0, NULL, 'not_applicable', '2026-06-20 10:00:00'),
            (3, 1, 'whatsapp', 'text', 'whatsapp.text', 1, 9, 0, 'committed', 'platform_fee', 1, 1, 1, 'USD', 'final', '2026-05-31 23:59:59'),
            (4, 1, 'whatsapp', 'text', 'whatsapp.text', 1, 3, 0, 'reserved', 'platform_fee', 1, 0, 0, 'USD', 'pending', NULL),
            (5, 2, 'whatsapp', 'text', 'whatsapp.text', 1, 100, 0, 'committed', 'platform_fee', 1, 50, 50, 'USD', 'final', '2026-06-15 10:00:00');
        INSERT INTO billing_payments (id, tenant_id, amount_lyd, created_at) VALUES
            (1, 1, 4, '2026-06-12 10:00:00'),
            (2, 1, 99, '2026-05-12 10:00:00'),
            (3, 2, 100, '2026-06-12 10:00:00');
        INSERT INTO billing_invoices (id, tenant_id, invoice_number, created_at) VALUES
            (1, 1, 'A-OLD', '2026-05-01 00:00:00'),
            (2, 1, 'A-LATEST', '2026-06-30 00:00:00'),
            (3, 2, 'B-LATEST', '2026-07-01 00:00:00');
        INSERT INTO billing_ledger (id, tenant_id, entry_type, created_at) VALUES
            (1, 1, 'payment', '2026-06-12 10:00:00'),
            (2, 2, 'payment', '2026-06-13 10:00:00');
        INSERT INTO billing_settings (key, value) VALUES
            ('credit_value_lyd', '0.2'),
            ('meta_cost_exchange_rate_to_lyd', '5');
    `);
    return db;
}

test('billing summary isolates tenants and calculates period profitability from normalized settings', (t) => {
    const db = createDatabase();
    t.after(() => db.close());

    const result = getBillingSummary(db, 1, {
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
    });

    assert.equal(result.tenant_id, 1);
    assert.equal(result.plan.code, 'legacy');
    assert.equal(result.balances.raw_gross_available_credits, 165);
    assert.equal(result.balances.reserved_credits, 3);
    assert.equal(result.balances.available_credits, 162);
    assert.deepEqual(result.usage_period.map((row) => [row.channel, row.credits]), [
        ['messenger', 3],
        ['whatsapp', 5],
    ]);
    assert.equal(result.last_invoice.invoice_number, 'A-LATEST');
    assert.equal(result.recent_ledger.length, 1);
    assert.equal(result.recent_ledger[0].tenant_id, 1);
    assert.deepEqual(result.profitability_period, {
        customer_usage_credits: 8,
        customer_usage_value_lyd: 1.6,
        customer_paid_lyd: 4,
        meta_cost_lyd: 10,
        gross_margin_lyd: -8.4,
        credit_value_lyd: 0.2,
    });
    assert.equal(result.meta_free_cost_usage_period[0].channel, 'messenger');
});

test('public billing summary omits internal profitability fields and handles missing tenants', (t) => {
    const db = createDatabase();
    t.after(() => db.close());

    const result = getBillingSummary(db, 1, {
        includeInternal: false,
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
    });
    assert.equal('profitability_period' in result, false);
    assert.equal('meta_cost_period' in result, false);
    assert.equal('platform_fee_usage_period' in result, false);
    assert.equal(getBillingSummary(db, 999), null);
});
