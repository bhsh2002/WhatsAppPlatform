import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
    deferBroadcastReservationUntilStatuses,
    tryFinalizeBroadcastReservationFromStatus,
    updateMetaChargeFromStatus,
} from '../services/billingMetaStatus.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE billing_usage_events (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            status TEXT,
            channel TEXT,
            operation_key TEXT,
            quantity INTEGER,
            reference_type TEXT,
            reference_id TEXT,
            metadata_json TEXT,
            meta_charge_status TEXT,
            meta_pricing_basis TEXT,
            meta_charge_category TEXT,
            meta_pricing_category TEXT,
            meta_pricing_type TEXT,
            meta_billable INTEGER,
            meta_country_calling_code TEXT,
            meta_charge_currency TEXT,
            meta_estimated_amount REAL,
            meta_final_amount REAL,
            meta_rate_card_id INTEGER,
            meta_charge_reason TEXT,
            pricing_decision_reason TEXT,
            meta_status_payload_json TEXT,
            meta_cost_lyd REAL,
            customer_charge_lyd REAL,
            final_credits INTEGER,
            customer_charge_type TEXT,
            billing_formula_json TEXT,
            meta_delivered_at DATETIME,
            meta_priced_at DATETIME
        );
        CREATE TABLE broadcast_jobs (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            sent_count INTEGER
        );
        CREATE TABLE billing_meta_message_costs (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            broadcast_job_id INTEGER,
            wamid TEXT,
            final_amount REAL,
            status TEXT
        );
    `);
    return db;
}

function createDependencies(db) {
    const calls = { commits: [], releases: [], synced: [] };
    return {
        calls,
        calculateCustomerCreditsFromMetaCost(amount) {
            return {
                credits: Math.ceil(Number(amount) || 0),
                meta_cost_lyd: (Number(amount) || 0) * 2,
                customer_charge_lyd: (Number(amount) || 0) * 2,
                credit_value_lyd: 0.1,
                exchange_rate_to_lyd: 2,
                margin_percent: 0,
            };
        },
        commit(usage, options) {
            calls.commits.push({ usage, options });
            db.prepare("UPDATE billing_usage_events SET status = 'committed' WHERE id = ?").run(usage.id);
            return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
        },
        getBillingSettings: () => ({ credit_value_lyd: 0.1 }),
        release(usage, reason) {
            calls.releases.push({ usage, reason });
            db.prepare("UPDATE billing_usage_events SET status = 'released' WHERE id = ?").run(usage.id);
            return db.prepare('SELECT * FROM billing_usage_events WHERE id = ?').get(usage.id);
        },
        summarizeMetaEstimate: () => ({
            status: 'estimated',
            category: 'utility',
            country_calling_code: '218',
            currency: 'USD',
            amount: 2,
            rate_card_id: 4,
            reason: 'matched_rate_card',
            pricing_basis: 'manual_rate_card',
        }),
        syncTenantCredits(tenantId) {
            calls.synced.push(tenantId);
        },
        upsertMetaMessageCostFromStatus: () => null,
    };
}

test('message statuses are tenant-scoped and final usage pricing is immutable', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const dependencies = createDependencies(db);
    db.exec(`
        INSERT INTO billing_usage_events (
            id, tenant_id, status, channel, operation_key, quantity,
            reference_type, reference_id, metadata_json, meta_charge_status
        ) VALUES
            (1, 1, 'reserved', 'whatsapp', 'whatsapp.template', 1, 'message', 'shared-wamid',
             '{"local_pricing_details":{"base_charge_credits":1}}', 'pending'),
            (2, 2, 'reserved', 'whatsapp', 'whatsapp.template', 1, 'message', 'shared-wamid', '{}', 'pending');
    `);

    const finalized = updateMetaChargeFromStatus(db, dependencies, {
        tenantId: 1,
        wamid: ' shared-wamid ',
        status: 'delivered',
        pricing: { billable: true, type: 'regular', category: 'utility' },
        timestamp: 1781100000,
    });
    assert.equal(finalized.tenant_id, 1);
    assert.equal(finalized.status, 'committed');
    assert.equal(finalized.meta_charge_status, 'final');
    assert.equal(finalized.meta_final_amount, 2);
    assert.equal(finalized.final_credits, 3);
    assert.equal(dependencies.calls.commits.length, 1);
    assert.equal(db.prepare('SELECT meta_charge_status FROM billing_usage_events WHERE id = 2').get().meta_charge_status, 'pending');

    const afterLateFailure = updateMetaChargeFromStatus(db, dependencies, {
        tenantId: 1,
        wamid: 'shared-wamid',
        status: 'failed',
    });
    assert.equal(afterLateFailure.meta_charge_status, 'final');
    assert.equal(afterLateFailure.meta_final_amount, 2);
    assert.equal(dependencies.calls.releases.length, 0);
});

test('failed delivery releases only the matching pending reservation', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const dependencies = createDependencies(db);
    db.exec(`
        INSERT INTO billing_usage_events (
            id, tenant_id, status, channel, operation_key, quantity,
            reference_type, reference_id, metadata_json, meta_charge_status,
            meta_final_amount
        ) VALUES (3, 1, 'reserved', 'whatsapp', 'whatsapp.template', 1,
                  'message', 'failed-wamid', '{}', 'pending', 8);
    `);

    const failed = updateMetaChargeFromStatus(db, dependencies, {
        tenantId: 1,
        wamid: 'failed-wamid',
        status: 'undelivered',
    });
    assert.equal(failed.status, 'released');
    assert.equal(failed.meta_charge_status, 'not_charged');
    assert.equal(failed.meta_final_amount, 0);
    assert.equal(dependencies.calls.releases[0].reason, 'message_undelivered');
});

test('broadcast defer immediately finalizes statuses that arrived before deferral', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const dependencies = createDependencies(db);
    db.exec(`
        INSERT INTO broadcast_jobs (id, tenant_id, sent_count) VALUES (10, 1, 2);
        INSERT INTO billing_usage_events (
            id, tenant_id, status, channel, operation_key, quantity,
            reference_type, metadata_json, meta_charge_status
        ) VALUES (10, 1, 'reserved', 'whatsapp', 'whatsapp.broadcast_recipient', 5,
                  'broadcast', '{"local_pricing_details":{"base_charge_credits":1}}', 'pending');
        INSERT INTO billing_meta_message_costs (
            id, tenant_id, broadcast_job_id, wamid, final_amount, status
        ) VALUES
            (1, 1, 10, 'broadcast-1', 1, 'final'),
            (2, 1, 10, 'broadcast-2', 2, 'not_charged'),
            (3, 2, 10, 'other-tenant', 100, 'final');
    `);

    const finalized = deferBroadcastReservationUntilStatuses(db, dependencies, { id: 10 }, {
        jobId: 10,
        quantity: 2,
        metadata: { completed_send_loop: true },
    });
    assert.equal(finalized.status, 'committed');
    assert.equal(finalized.quantity, 2);
    assert.equal(finalized.reference_id, '10');
    assert.equal(finalized.meta_charge_status, 'final');
    assert.equal(finalized.meta_final_amount, 3);
    assert.equal(finalized.final_credits, 4);
    assert.equal(finalized.customer_charge_lyd, 0.4);
    assert.equal(dependencies.calls.commits.length, 1);
    assert.equal(dependencies.calls.commits[0].options.finalCredits, 4);
    assert.deepEqual(dependencies.calls.synced, [1]);
    assert.equal(JSON.parse(finalized.metadata_json).local_pricing_deferred_until, 'all_broadcast_statuses');
});

test('broadcast finalization keeps rate-missing jobs reserved for review', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const dependencies = createDependencies(db);
    db.exec(`
        INSERT INTO broadcast_jobs (id, tenant_id, sent_count) VALUES (11, 1, 1);
        INSERT INTO billing_usage_events (
            id, tenant_id, status, channel, operation_key, quantity,
            reference_type, reference_id, metadata_json, meta_charge_status
        ) VALUES (11, 1, 'reserved', 'whatsapp', 'whatsapp.broadcast_recipient', 1,
                  'broadcast', '11', '{}', 'pending');
        INSERT INTO billing_meta_message_costs (
            id, tenant_id, broadcast_job_id, wamid, final_amount, status
        ) VALUES (11, 1, 11, 'missing-rate', 0, 'rate_missing');
    `);

    const pending = tryFinalizeBroadcastReservationFromStatus(db, dependencies, 11);
    assert.equal(pending.status, 'reserved');
    assert.equal(dependencies.calls.commits.length, 0);
    assert.equal(dependencies.calls.releases.length, 0);
});
