import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
    computeAvailable,
    ensureTenantBillingAccount,
    getReservedCredits,
    syncTenantCredits,
} from '../services/billingAccount.js';

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
            monthly_price_lyd REAL DEFAULT 0,
            monthly_included_credits INTEGER DEFAULT 0,
            default_credit_limit INTEGER DEFAULT 0
        );

        CREATE TABLE tenant_billing_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER UNIQUE NOT NULL,
            plan_id INTEGER,
            wallet_balance_credits INTEGER DEFAULT 0,
            plan_balance_credits INTEGER DEFAULT 0,
            credit_limit_credits INTEGER DEFAULT 0,
            credit_used_credits INTEGER DEFAULT 0,
            billing_cycle_start DATETIME,
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
            balance_after_credits INTEGER,
            related_type TEXT,
            description TEXT,
            metadata_json TEXT
        );
    `);
    return db;
}

test('availability accounts for balances, reservations, and paid-plan cycle state', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const legacyPlanId = Number(db.prepare("INSERT INTO billing_plans (code, name) VALUES ('legacy', 'Legacy')").run().lastInsertRowid);
    const paidPlanId = Number(db.prepare("INSERT INTO billing_plans (code, name) VALUES ('paid', 'Paid')").run().lastInsertRowid);
    const balances = {
        plan_balance_credits: 10,
        wallet_balance_credits: 5,
        credit_limit_credits: 20,
        credit_used_credits: 3,
    };

    const noPlan = computeAvailable(db, { ...balances, plan_id: null }, 4);
    assert.equal(noPlan.available_credits, 28);
    assert.equal(noPlan.gross_available_credits, 32);
    assert.equal(noPlan.remaining_credit_limit_credits, 17);
    assert.equal(noPlan.billing_cycle_active, true);

    const legacy = computeAvailable(db, { ...balances, plan_id: legacyPlanId, billing_cycle_end: null }, 4);
    assert.equal(legacy.available_credits, 28);
    assert.equal(legacy.billing_cycle_blocked, false);

    const missingCycle = computeAvailable(db, { ...balances, plan_id: paidPlanId, billing_cycle_end: null }, 4);
    assert.equal(missingCycle.available_credits, 0);
    assert.equal(missingCycle.raw_gross_available_credits, 32);
    assert.equal(missingCycle.billing_cycle_block_reason, 'missing_cycle_end');

    const expired = computeAvailable(db, { ...balances, plan_id: paidPlanId, billing_cycle_end: '2000-01-01 00:00:00' }, 4);
    assert.equal(expired.available_credits, 0);
    assert.equal(expired.billing_cycle_block_reason, 'cycle_expired');

    const active = computeAvailable(db, { ...balances, plan_id: paidPlanId, billing_cycle_end: '2999-01-01 00:00:00' }, 4);
    assert.equal(active.available_credits, 28);
    assert.equal(active.billing_cycle_active, true);
});

test('reserved credit totals are tenant-scoped and can exclude one usage event', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const insert = db.prepare('INSERT INTO billing_usage_events (tenant_id, total_credits, status) VALUES (?, ?, ?)');
    const first = Number(insert.run(1, 4, 'reserved').lastInsertRowid);
    insert.run(1, 3, 'reserved');
    insert.run(1, 9, 'committed');
    insert.run(2, 20, 'reserved');

    assert.equal(getReservedCredits(db, 1), 7);
    assert.equal(getReservedCredits(db, 1, first), 3);
    assert.equal(getReservedCredits(db, 2), 20);
});

test('legacy account creation is idempotent and preserves migrated tenant credits', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    db.prepare("INSERT INTO billing_plans (code, name) VALUES ('legacy', 'Legacy')").run();
    db.prepare("INSERT INTO tenants (id, name, status, credits) VALUES (1, 'Tenant', 'Active', 100)").run();

    const first = ensureTenantBillingAccount(db, 1);
    const second = ensureTenantBillingAccount(db, 1);

    assert.equal(first.id, second.id);
    assert.equal(first.plan_code, 'legacy');
    assert.equal(first.wallet_balance_credits, 100);
    assert.equal(db.prepare('SELECT credits FROM tenants WHERE id = 1').get().credits, 100);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tenant_billing_accounts WHERE tenant_id = 1').get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing_ledger WHERE tenant_id = 1 AND entry_type = 'opening_balance'").get().count, 1);
    assert.deepEqual(
        JSON.parse(db.prepare('SELECT metadata_json FROM billing_ledger WHERE tenant_id = 1').get().metadata_json),
        { source: 'tenants.credits', created_by_service: true }
    );
});

test('account creation handles suspended and missing tenants while cycle sync remains strict', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    db.prepare("INSERT INTO billing_plans (code, name) VALUES ('legacy', 'Legacy')").run();
    const paidPlanId = Number(db.prepare("INSERT INTO billing_plans (code, name) VALUES ('paid', 'Paid')").run().lastInsertRowid);
    db.prepare("INSERT INTO tenants (id, name, status, credits) VALUES (1, 'Suspended', 'Suspended', 15)").run();
    db.prepare("INSERT INTO tenants (id, name, status, credits) VALUES (2, 'Paid', 'Active', 88)").run();

    assert.equal(ensureTenantBillingAccount(db, 1).status, 'suspended');
    assert.equal(ensureTenantBillingAccount(db, 999), null);

    db.prepare(`
        INSERT INTO tenant_billing_accounts (tenant_id, plan_id, wallet_balance_credits, billing_cycle_end)
        VALUES (2, ?, 88, NULL)
    `).run(paidPlanId);
    assert.equal(syncTenantCredits(db, 2), 0);
    assert.equal(db.prepare('SELECT credits FROM tenants WHERE id = 2').get().credits, 0);

    db.prepare("UPDATE tenant_billing_accounts SET billing_cycle_end = '2999-01-01 00:00:00' WHERE tenant_id = 2").run();
    assert.equal(syncTenantCredits(db, 2), 88);
    assert.equal(db.prepare('SELECT credits FROM tenants WHERE id = 2').get().credits, 88);
});
