import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { BILLING_OPERATIONS } from '../services/billingCore.js';
import { quote } from '../services/billingQuote.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE tenants (
            id INTEGER PRIMARY KEY, name TEXT, status TEXT, credits INTEGER, updated_at DATETIME
        );
        CREATE TABLE billing_plans (
            id INTEGER PRIMARY KEY, code TEXT, name TEXT, monthly_price_lyd REAL,
            monthly_included_credits INTEGER, default_credit_limit INTEGER
        );
        CREATE TABLE tenant_billing_accounts (
            id INTEGER PRIMARY KEY, tenant_id INTEGER UNIQUE, plan_id INTEGER,
            wallet_balance_credits INTEGER, plan_balance_credits INTEGER,
            credit_limit_credits INTEGER, credit_used_credits INTEGER,
            billing_cycle_start DATETIME, billing_cycle_end DATETIME, status TEXT,
            created_at DATETIME, updated_at DATETIME
        );
        CREATE TABLE billing_usage_events (
            id INTEGER PRIMARY KEY, tenant_id INTEGER, total_credits INTEGER, status TEXT
        );
        CREATE TABLE billing_ledger (
            id INTEGER PRIMARY KEY, tenant_id INTEGER, entry_type TEXT, direction TEXT,
            credits_delta INTEGER, balance_after_credits INTEGER, related_type TEXT,
            description TEXT, metadata_json TEXT
        );
        CREATE TABLE billing_price_items (
            id INTEGER PRIMARY KEY,
            operation_key TEXT UNIQUE,
            channel TEXT,
            operation_type TEXT,
            unit_price_credits INTEGER,
            is_billable INTEGER,
            is_active INTEGER,
            local_pricing_model TEXT,
            meta_cost_basis TEXT,
            tenant_visible_usage INTEGER
        );
        CREATE TABLE contacts (
            id INTEGER PRIMARY KEY, tenant_id INTEGER, phone TEXT,
            last_customer_message_at DATETIME, last_ctwa_received_at DATETIME,
            last_ctwa_clid TEXT
        );
        CREATE TABLE billing_settings (
            key TEXT PRIMARY KEY, value TEXT, description TEXT, updated_at DATETIME
        );

        INSERT INTO tenants (id, name, status, credits) VALUES (1, 'A', 'Active', 20);
        INSERT INTO tenant_billing_accounts (
            id, tenant_id, plan_id, wallet_balance_credits, plan_balance_credits,
            credit_limit_credits, credit_used_credits, status
        ) VALUES (1, 1, NULL, 20, 0, 0, 0, 'active');
        INSERT INTO billing_usage_events (id, tenant_id, total_credits, status)
        VALUES (1, 1, 3, 'reserved');
        INSERT INTO billing_price_items (
            id, operation_key, channel, operation_type, unit_price_credits,
            is_billable, is_active, local_pricing_model, meta_cost_basis, tenant_visible_usage
        ) VALUES
            (1, 'messenger.reply', 'messenger', 'reply', 2, 1, 1, 'fixed', 'platform_fee', 1),
            (2, 'whatsapp.text', 'whatsapp', 'text', 1, 1, 1, 'meta_cost_plus_credits', 'meta_billed', 1),
            (3, 'facebook.post_create', 'facebook', 'post_create', 5, 1, 0, 'fixed', 'platform_fee', 1);
        INSERT INTO billing_settings (key, value) VALUES
            ('meta_cost_exchange_rate_to_lyd', '1'),
            ('credit_value_lyd', '0.5'),
            ('meta_cost_margin_percent', '0');
    `);
    return db;
}

test('fixed quote applies bounded quantity pricing and current reservations', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const result = quote(db, { summarizeMetaEstimate: () => ({}) }, {
        tenantId: 1,
        operationKey: BILLING_OPERATIONS.MESSENGER_REPLY,
        quantity: 2,
    });

    assert.equal(result.quantity, 2);
    assert.equal(result.unit_price_credits, 2);
    assert.equal(result.total_credits, 4);
    assert.equal(result.billable, true);
    assert.equal(result.track_usage, true);
    assert.equal(result.local_pricing_model, 'fixed');
    assert.equal(result.availability.reserved_credits, 3);
    assert.equal(result.availability.available_credits, 17);
});

test('Meta cost-plus quote blocks free-form messages outside customer windows', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    let estimateCalls = 0;
    const result = quote(db, {
        summarizeMetaEstimate() {
            estimateCalls += 1;
            return { status: 'estimated', amount: 2 };
        },
    }, {
        tenantId: 1,
        operationKey: BILLING_OPERATIONS.WHATSAPP_TEXT,
        metadata: { recipient: '+218 91 000 0000' },
    });

    assert.equal(estimateCalls, 0);
    assert.equal(result.total_credits, 0);
    assert.equal(result.billable, true);
    assert.equal(result.track_usage, true);
    assert.equal(result.customer_charge_type, 'blocked');
    assert.equal(result.local_pricing_reason, 'customer_service_window_closed');
});

test('Meta cost-plus quote combines base and converted Meta credits inside an open window', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    db.prepare(`
        INSERT INTO contacts (tenant_id, phone, last_customer_message_at)
        VALUES (1, '218910000000', datetime('now', 'localtime'))
    `).run();
    const result = quote(db, {
        summarizeMetaEstimate: () => ({
            status: 'estimated',
            category: 'utility',
            country_calling_code: '218',
            currency: 'USD',
            amount: 2,
            rate_card_id: 9,
            pricing_basis: 'local_rate_card',
            reason: 'rate_applied',
        }),
    }, {
        tenantId: 1,
        operationKey: BILLING_OPERATIONS.WHATSAPP_TEXT,
        metadata: { recipient: '+218 91 000 0000' },
    });

    assert.equal(result.total_credits, 5);
    assert.equal(result.unit_price_credits, 5);
    assert.equal(result.customer_charge_type, 'paid_meta');
    assert.equal(result.local_pricing_details.base_charge_credits, 1);
    assert.equal(result.local_pricing_details.meta_cost_credits, 4);
    assert.equal(result.local_pricing_details.customer_service_window_open, true);
    assert.equal(result.meta_cost_basis, 'meta_billed');

    const inactive = quote(db, { summarizeMetaEstimate: () => ({}) }, {
        tenantId: 1,
        operationKey: BILLING_OPERATIONS.FACEBOOK_POST_CREATE,
    });
    assert.equal(inactive.total_credits, 0);
    assert.equal(inactive.billable, false);
    assert.equal(inactive.track_usage, false);
});
