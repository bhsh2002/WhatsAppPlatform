import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { BILLING_OPERATIONS } from '../services/billingCore.js';
import {
    chooseRateForRecipient,
    evaluateSingleMetaCharge,
    getMonthlyTierVolume,
    resolveLocalBillableQuantity,
    summarizeMetaEstimate,
    summarizeMetaRecipientCountries,
} from '../services/billingMetaPricing.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE templates (
            id INTEGER PRIMARY KEY, tenant_id INTEGER, name TEXT, category TEXT
        );
        CREATE TABLE contacts (
            id INTEGER PRIMARY KEY, tenant_id INTEGER, phone TEXT,
            last_customer_message_at DATETIME, last_ctwa_received_at DATETIME,
            last_ctwa_clid TEXT
        );
        CREATE TABLE meta_whatsapp_rates (
            id INTEGER PRIMARY KEY,
            country_calling_code TEXT,
            currency TEXT,
            category TEXT,
            rate_amount REAL,
            volume_tier_min INTEGER,
            volume_tier_max INTEGER,
            effective_from DATE,
            effective_to DATE,
            is_active INTEGER
        );
        CREATE TABLE billing_meta_message_costs (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            wamid TEXT,
            template_category TEXT,
            country_calling_code TEXT,
            currency TEXT,
            status TEXT,
            sent_at DATETIME
        );
        CREATE TABLE billing_price_items (
            id INTEGER PRIMARY KEY,
            operation_key TEXT UNIQUE,
            local_pricing_model TEXT
        );

        INSERT INTO meta_whatsapp_rates (
            id, country_calling_code, currency, category, rate_amount,
            volume_tier_min, volume_tier_max, effective_from, effective_to, is_active
        ) VALUES
            (1, '218', 'USD', 'utility', 1.0, 1, 2, '2026-01-01', NULL, 1),
            (2, '218', 'USD', 'utility', 0.5, 3, NULL, '2026-01-01', NULL, 1),
            (3, '20', 'USD', 'utility', 1.5, 1, NULL, '2026-01-01', NULL, 1),
            (4, '*', 'USD', 'utility', 2.0, 1, NULL, '2026-01-01', NULL, 1),
            (5, '218', 'USD', 'marketing', 0.8, 5, NULL, '2026-01-01', NULL, 1),
            (6, '218', 'EUR', 'utility', 9.0, 1, NULL, '2026-01-01', NULL, 1),
            (7, '218', 'USD', 'utility', 99.0, 1, NULL, '2025-01-01', '2025-12-31', 1),
            (8, '971', 'USD', 'utility', 7.0, 1, NULL, '2026-01-01', NULL, 0);
        INSERT INTO billing_meta_message_costs (
            id, tenant_id, wamid, template_category, country_calling_code,
            currency, status, sent_at
        ) VALUES (1, 1, 'existing-wamid', 'utility', '218', 'USD', 'final', '2026-06-05 10:00:00');
        INSERT INTO billing_price_items (id, operation_key, local_pricing_model) VALUES
            (1, 'whatsapp.broadcast_recipient', 'meta_like'),
            (2, 'messenger.reply', 'fixed');
        INSERT INTO templates (id, tenant_id, name, category) VALUES
            (1, 1, 'utility_template', 'UTILITY'),
            (2, 2, 'utility_template', 'MARKETING');
    `);
    return db;
}

test('rate resolution honors explicit country codes, currency, tiers and gaps', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const base = {
        tenantId: 1,
        recipient: '+218910000000',
        category: 'utility',
        currency: 'USD',
        effectiveAt: '2026-06-10',
    };

    assert.equal(getMonthlyTierVolume(db, {
        tenantId: 1,
        countryCallingCode: '+218',
        category: 'UTILITY',
        currency: 'usd',
        effectiveAt: '2026-06-10',
    }), 1);
    assert.equal(chooseRateForRecipient(db, base).id, 1);
    assert.equal(chooseRateForRecipient(db, { ...base, tierOffset: 1 }).id, 2);
    assert.equal(chooseRateForRecipient(db, { ...base, excludeWamid: 'existing-wamid' }).id, 1);
    assert.equal(chooseRateForRecipient(db, {
        ...base,
        recipient: '+201000000000',
        countryCallingCode: '+218',
    }).id, 1);
    assert.equal(chooseRateForRecipient(db, { ...base, countryCallingCode: '999' }).id, 4);
    assert.equal(chooseRateForRecipient(db, { ...base, category: 'marketing' }), null);
    assert.equal(chooseRateForRecipient(db, { ...base, currency: 'EUR' }).id, 6);
    assert.throws(
        () => chooseRateForRecipient(db, { ...base, effectiveAt: '2026-02-31' }),
        (error) => error?.status === 400 && error?.code === 'INVALID_BILLING_PERIOD'
    );
});

test('single-message pricing applies status-webhook and local free-window rules', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    db.exec(`
        INSERT INTO contacts (id, tenant_id, phone, last_customer_message_at)
        VALUES (1, 1, '218910000000', datetime('now', 'localtime'));
        INSERT INTO contacts (id, tenant_id, phone, last_ctwa_received_at)
        VALUES (2, 1, '218920000000', datetime('now', 'localtime'));
    `);

    const utilityFree = evaluateSingleMetaCharge(db, {
        tenantId: 1,
        operationKey: BILLING_OPERATIONS.WHATSAPP_TEMPLATE,
        metadata: { recipient: '218910000000', template_category: 'utility' },
    });
    assert.equal(utilityFree.reason, 'utility_template_inside_24h_window');

    const ctwaFree = evaluateSingleMetaCharge(db, {
        tenantId: 1,
        operationKey: BILLING_OPERATIONS.WHATSAPP_TEMPLATE,
        metadata: { recipient: '218920000000', template_category: 'marketing' },
    });
    assert.equal(ctwaFree.reason, 'free_entry_point_72h');

    const serviceFree = evaluateSingleMetaCharge(db, {
        tenantId: 1,
        operationKey: BILLING_OPERATIONS.WHATSAPP_TEXT,
        metadata: { recipient: '218930000000' },
    });
    assert.equal(serviceFree.reason, 'service_messages_free');

    const regular = evaluateSingleMetaCharge(db, {
        tenantId: 1,
        operationKey: BILLING_OPERATIONS.WHATSAPP_TEMPLATE,
        metadata: { recipient: '218910000000' },
        statusPricing: { billable: true, type: 'regular', category: 'utility' },
        effectiveAt: '2026-06-10',
    });
    assert.equal(regular.status, 'estimated');
    assert.equal(regular.rate_card_id, 1);

    const webhookFree = evaluateSingleMetaCharge(db, {
        tenantId: 1,
        operationKey: BILLING_OPERATIONS.WHATSAPP_TEMPLATE,
        statusPricing: { billable: false, category: 'utility' },
    });
    assert.equal(webhookFree.pricing_basis, 'status_webhook');
    assert.equal(webhookFree.status, 'not_charged');

    assert.equal(evaluateSingleMetaCharge(db, {
        tenantId: 1,
        operationKey: BILLING_OPERATIONS.MESSENGER_REPLY,
    }).status, 'not_applicable');
    assert.equal(evaluateSingleMetaCharge(db, {
        tenantId: 1,
        operationKey: BILLING_OPERATIONS.WHATSAPP_TEMPLATE,
        metadata: { template_name: 'missing' },
    }).reason, 'template_category_missing');
    assert.equal(evaluateSingleMetaCharge(db, {
        tenantId: 1,
        operationKey: BILLING_OPERATIONS.WHATSAPP_TEMPLATE,
        metadata: { template_name: 'utility_template', recipient: '218930000000' },
        effectiveAt: '2026-06-10',
    }).category, 'utility');
});

test('multi-recipient estimates advance tiers and report missing country rates', (t) => {
    const db = createDatabase();
    t.after(() => db.close());

    const estimate = summarizeMetaEstimate(db, {
        tenantId: 1,
        operationKey: BILLING_OPERATIONS.WHATSAPP_TEMPLATE,
        quantity: 3,
        metadata: {
            template_category: 'utility',
            meta_currency: 'USD',
            recipient_country_counts: { '+218': 2, '20': 1 },
        },
        effectiveAt: '2026-06-10',
    });
    assert.equal(estimate.status, 'estimated');
    assert.equal(estimate.amount, 3);
    assert.equal(estimate.country_calling_code, 'mixed');
    assert.equal(estimate.details[0].country_total, 1.5);
    assert.equal(estimate.details[1].country_total, 1.5);

    const missing = summarizeMetaEstimate(db, {
        tenantId: 1,
        operationKey: BILLING_OPERATIONS.WHATSAPP_TEMPLATE,
        metadata: {
            template_category: 'marketing',
            recipient_country_counts: { 218: 1 },
        },
        effectiveAt: '2026-06-10',
    });
    assert.equal(missing.status, 'rate_missing');
    assert.equal(missing.amount, 0);
});

test('recipient grouping and meta-like billable quantity are scoped and deterministic', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    db.prepare(`
        INSERT INTO contacts (tenant_id, phone, last_customer_message_at)
        VALUES (1, '218910000000', datetime('now', 'localtime'))
    `).run();
    const recipients = ['+218 91 000 0000', '+20 100 000 0000', 'invalid'];
    assert.deepEqual(summarizeMetaRecipientCountries(db, recipients), { 20: 1, 218: 1 });

    const resolved = resolveLocalBillableQuantity(db, {
        tenantId: 1,
        operationKey: BILLING_OPERATIONS.WHATSAPP_BROADCAST_RECIPIENT,
        recipients,
        templateCategory: 'utility',
    });
    assert.equal(resolved.quantity, 1);
    assert.equal(resolved.summary.recipient_count, 2);
    assert.equal(resolved.summary.free_24h_count, 1);
    assert.equal(resolved.summary.billable_count, 1);
    assert.deepEqual(resolved.summary.billable_country_counts, { 20: 1 });

    assert.deepEqual(resolveLocalBillableQuantity(db, {
        operationKey: BILLING_OPERATIONS.MESSENGER_REPLY,
        recipients,
        fallbackQuantity: 9,
    }), { quantity: 9, summary: null, pricing_model: 'fixed' });
});
