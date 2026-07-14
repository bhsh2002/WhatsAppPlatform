import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
    recordMetaMessageCost,
    updateUsageMetaEstimate,
    upsertMetaMessageCostFromStatus,
} from '../services/billingMetaMessageCosts.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE billing_meta_message_costs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            usage_event_id INTEGER,
            broadcast_job_id INTEGER,
            wamid TEXT UNIQUE,
            recipient TEXT,
            operation_key TEXT,
            message_type TEXT,
            template_name TEXT,
            template_category TEXT,
            pricing_type TEXT,
            pricing_model TEXT,
            billable INTEGER,
            country_calling_code TEXT,
            currency TEXT,
            estimated_amount REAL DEFAULT 0,
            final_amount REAL DEFAULT 0,
            rate_card_id INTEGER,
            status TEXT DEFAULT 'pending',
            charge_reason TEXT,
            calculation_basis TEXT,
            status_payload_json TEXT,
            metadata_json TEXT,
            sent_at DATETIME,
            delivered_at DATETIME,
            updated_at DATETIME
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            recipient TEXT,
            message_type TEXT,
            created_at DATETIME,
            wamid TEXT
        );
        CREATE TABLE billing_usage_events (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            operation_key TEXT,
            quantity INTEGER,
            metadata_json TEXT,
            reference_type TEXT,
            committed_at DATETIME,
            meta_charge_status TEXT,
            meta_pricing_basis TEXT,
            meta_charge_category TEXT,
            meta_country_calling_code TEXT,
            meta_charge_currency TEXT,
            meta_estimated_amount REAL,
            meta_final_amount REAL,
            meta_rate_card_id INTEGER,
            meta_charge_reason TEXT,
            meta_priced_at DATETIME
        );
    `);
    return db;
}

const estimate = (options = {}) => {
    if (options.metadata?.free) {
        return {
            status: 'not_charged',
            category: 'utility',
            country_calling_code: '218',
            currency: 'USD',
            amount: 0,
            rate_card_id: null,
            reason: 'free_window',
            pricing_basis: 'customer_service_window',
            details: null,
        };
    }
    return {
        status: 'estimated',
        category: 'utility',
        country_calling_code: '218',
        currency: 'USD',
        amount: 2.5,
        rate_card_id: 7,
        reason: 'matched_rate_card',
        pricing_basis: 'manual_rate_card',
        details: [{ count: 1, country_total: 2.5 }],
    };
};

const dependencies = { summarizeMetaEstimate: estimate };

test('message-cost recording is idempotent within a tenant and rejects cross-tenant wamid reuse', (t) => {
    const db = createDatabase();
    t.after(() => db.close());

    const first = recordMetaMessageCost(db, dependencies, {
        tenantId: 1,
        wamid: ' wamid-shared ',
        recipient: '218910000001',
        operationKey: 'whatsapp.template',
        metadata: { await_status_pricing: true },
        sentAt: '2026-06-10 10:00:00',
    });
    assert.equal(first.status, 'pending');
    assert.equal(first.estimated_amount, 2.5);
    assert.equal(first.wamid, 'wamid-shared');

    db.prepare(`
        UPDATE billing_meta_message_costs
        SET status = 'final', final_amount = 2.5
        WHERE id = ?
    `).run(first.id);
    const repeated = recordMetaMessageCost(db, dependencies, {
        tenantId: 1,
        wamid: 'wamid-shared',
        recipient: '218910000002',
        operationKey: 'whatsapp.template',
    });
    assert.equal(repeated.id, first.id);
    assert.equal(repeated.status, 'final');
    assert.equal(repeated.final_amount, 2.5);
    assert.equal(repeated.recipient, '218910000002');

    assert.throws(
        () => recordMetaMessageCost(db, dependencies, { tenantId: 2, wamid: 'wamid-shared' }),
        (error) => error?.status === 409 && error?.code === 'META_MESSAGE_TENANT_CONFLICT'
    );
    assert.equal(db.prepare('SELECT tenant_id FROM billing_meta_message_costs WHERE wamid = ?').get('wamid-shared').tenant_id, 1);
});

test('status updates finalize delivery but cannot roll back final or reconciled costs', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    recordMetaMessageCost(db, dependencies, {
        tenantId: 1,
        wamid: 'wamid-status',
        operationKey: 'whatsapp.template',
    });

    const delivered = upsertMetaMessageCostFromStatus(db, dependencies, {
        tenantId: 1,
        wamid: 'wamid-status',
        status: 'delivered',
        pricing: {
            billable: true,
            type: 'regular',
            category: 'utility',
            pricing_model: 'PMP',
        },
        timestamp: 1781100000,
    });
    assert.equal(delivered.status, 'final');
    assert.equal(delivered.final_amount, 2.5);
    assert.equal(delivered.billable, 1);
    assert.equal(delivered.calculation_basis, 'status_webhook');

    const repricedRead = upsertMetaMessageCostFromStatus(db, {
        summarizeMetaEstimate: () => ({ ...estimate(), amount: 99 }),
    }, {
        tenantId: 1,
        wamid: 'wamid-status',
        status: 'read',
        pricing: { billable: true, category: 'utility' },
    });
    assert.equal(repricedRead.final_amount, 2.5);

    const lateFailure = upsertMetaMessageCostFromStatus(db, dependencies, {
        tenantId: 1,
        wamid: 'wamid-status',
        status: 'failed',
    });
    assert.equal(lateFailure.status, 'final');
    assert.equal(lateFailure.final_amount, 2.5);

    db.prepare(`
        UPDATE billing_meta_message_costs
        SET status = 'invoice_reconciled', final_amount = 9
        WHERE wamid = 'wamid-status'
    `).run();
    const reconciled = upsertMetaMessageCostFromStatus(db, dependencies, {
        tenantId: 1,
        wamid: 'wamid-status',
        status: 'read',
        pricing: { billable: true, category: 'utility' },
    });
    assert.equal(reconciled.status, 'invoice_reconciled');
    assert.equal(reconciled.final_amount, 9);

    recordMetaMessageCost(db, dependencies, { tenantId: 1, wamid: 'wamid-failed' });
    const failed = upsertMetaMessageCostFromStatus(db, dependencies, {
        tenantId: 1,
        wamid: 'wamid-failed',
        status: 'undelivered',
    });
    assert.equal(failed.status, 'not_charged');
    assert.equal(failed.final_amount, 0);
});

test('status recovery scopes message lookup to the webhook tenant', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    db.exec(`
        INSERT INTO messages (id, tenant_id, recipient, message_type, created_at, wamid)
        VALUES
            (1, 1, '218911111111', 'text', '2026-06-10 09:00:00', 'wamid-recover'),
            (2, 2, '218922222222', 'template', '2026-06-10 10:00:00', 'wamid-recover');
    `);

    const recovered = upsertMetaMessageCostFromStatus(db, dependencies, {
        tenantId: 2,
        wamid: 'wamid-recover',
        status: 'delivered',
    });
    assert.equal(recovered.tenant_id, 2);
    assert.equal(recovered.recipient, '218922222222');
    assert.equal(recovered.message_type, 'template');

    assert.throws(
        () => upsertMetaMessageCostFromStatus(db, dependencies, {
            tenantId: 1,
            wamid: 'wamid-recover',
            status: 'read',
        }),
        (error) => error?.code === 'META_MESSAGE_TENANT_CONFLICT'
    );
});

test('usage estimates wait for message status and zero confirmed free charges', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    db.prepare(`
        INSERT INTO billing_usage_events (
            id, tenant_id, operation_key, quantity, metadata_json,
            reference_type, committed_at, meta_final_amount
        ) VALUES (1, 1, 'whatsapp.template', 1, '{"seed":true}', 'message', '2026-06-10 10:00:00', 4)
    `).run();

    const pending = updateUsageMetaEstimate(db, dependencies, 1, { recipient: '218910000000' });
    assert.equal(pending.meta_charge_status, 'pending');
    assert.equal(pending.meta_estimated_amount, 2.5);
    assert.equal(pending.meta_final_amount, 4);
    assert.deepEqual(JSON.parse(pending.metadata_json).meta_estimate_details, [{ count: 1, country_total: 2.5 }]);

    const free = updateUsageMetaEstimate(db, dependencies, 1, { free: true });
    assert.equal(free.meta_charge_status, 'not_charged');
    assert.equal(free.meta_final_amount, 0);
    assert.equal(free.meta_charge_reason, 'free_window');
    assert.equal(updateUsageMetaEstimate(db, dependencies, 999), null);
});
