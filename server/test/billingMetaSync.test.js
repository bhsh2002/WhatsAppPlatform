import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
    getLocalMetaMessageCostSummary,
    getLocalMetaReconciliation,
    getMetaUsageComparison,
    syncMetaUsageSnapshot,
} from '../services/billingMetaSync.js';

function createDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT, waba_id TEXT);
        CREATE TABLE billing_settings (key TEXT PRIMARY KEY, value TEXT, description TEXT, updated_at DATETIME);
        CREATE TABLE billing_usage_events (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            channel TEXT,
            status TEXT,
            quantity INTEGER DEFAULT 1,
            total_credits INTEGER DEFAULT 0,
            meta_estimated_amount REAL DEFAULT 0,
            meta_final_amount REAL DEFAULT 0,
            meta_charge_status TEXT,
            reference_type TEXT,
            reference_id TEXT,
            committed_at DATETIME
        );
        CREATE TABLE billing_meta_message_costs (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            usage_event_id INTEGER,
            broadcast_job_id INTEGER,
            wamid TEXT,
            status TEXT,
            estimated_amount REAL DEFAULT 0,
            final_amount REAL DEFAULT 0,
            sent_at DATETIME
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            direction TEXT,
            message_type TEXT,
            status TEXT,
            created_at DATETIME
        );
        CREATE TABLE meta_invoices (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER,
            period_start DATE,
            period_end DATE,
            total_amount REAL DEFAULT 0
        );
        CREATE TABLE meta_usage_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            waba_id TEXT NOT NULL,
            period_start DATE NOT NULL,
            period_end DATE NOT NULL,
            granularity TEXT,
            status TEXT,
            currency TEXT,
            meta_sent INTEGER DEFAULT 0,
            meta_delivered INTEGER DEFAULT 0,
            meta_conversations INTEGER DEFAULT 0,
            meta_cost_amount REAL DEFAULT 0,
            local_sent INTEGER DEFAULT 0,
            local_delivered INTEGER DEFAULT 0,
            local_estimated_amount REAL DEFAULT 0,
            local_final_amount REAL DEFAULT 0,
            invoice_total_amount REAL DEFAULT 0,
            diff_sent INTEGER DEFAULT 0,
            diff_delivered INTEGER DEFAULT 0,
            diff_cost_amount REAL DEFAULT 0,
            summary_json TEXT,
            raw_meta_json TEXT,
            error_message TEXT,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO tenants (id, name, waba_id) VALUES (1, 'A', 'waba-a'), (2, 'B', 'waba-b');
        INSERT INTO billing_settings (key, value) VALUES ('credit_value_lyd', '0.2');
        INSERT INTO billing_usage_events (
            id, tenant_id, channel, status, quantity, total_credits,
            meta_estimated_amount, meta_final_amount, meta_charge_status,
            reference_type, reference_id, committed_at
        ) VALUES
            (1, 1, 'whatsapp', 'committed', 1, 5, 2, 2, 'pending', 'message', 'linked', '2026-06-10 10:00:00'),
            (2, 1, 'whatsapp', 'committed', 2, 7, 3, 3, 'final', 'message', 'fallback', '2026-06-11 10:00:00'),
            (3, 2, 'whatsapp', 'committed', 9, 99, 99, 99, 'final', 'message', 'tenant-b', '2026-06-11 10:00:00');
        INSERT INTO billing_meta_message_costs (
            id, tenant_id, usage_event_id, wamid, status, estimated_amount, final_amount, sent_at
        ) VALUES
            (10, 1, 1, 'linked', 'pending', 2, 2, '2026-06-10 10:00:00'),
            (11, 2, 3, 'tenant-b', 'final', 99, 99, '2026-06-11 10:00:00');
        INSERT INTO messages (id, tenant_id, direction, message_type, status, created_at) VALUES
            (1, 1, 'outgoing', 'text', 'sent', '2026-06-10 10:00:00'),
            (2, 1, 'outgoing', 'template', 'delivered', '2026-06-11 10:00:00'),
            (3, 1, 'outgoing', 'image', 'read', '2026-06-12 10:00:00'),
            (4, 2, 'outgoing', 'text', 'delivered', '2026-06-12 10:00:00');
        INSERT INTO meta_invoices (id, tenant_id, period_start, period_end, total_amount)
        VALUES (1, 1, '2026-06-01', '2026-06-30', 10), (2, 2, '2026-06-01', '2026-06-30', 99);
    `);
    return db;
}

test('local Meta reconciliation deduplicates linked usage and isolates tenant totals', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const costs = getLocalMetaMessageCostSummary(db, {
        tenantId: 1,
        startSql: '2026-06-01 00:00:00',
        endSql: '2026-06-30 23:59:59',
    });
    assert.equal(costs.estimated_amount, 5);
    assert.equal(costs.final_amount, 5);
    assert.equal(costs.cost_rows, 1);
    assert.equal(costs.usage_fallback_rows, 1);
    assert.equal(costs.pending_count, 1);
    assert.equal(costs.final_count, 1);

    const local = getLocalMetaReconciliation(db, {
        tenantId: 1,
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
    });
    assert.deepEqual(local, {
        local_sent: 3,
        local_delivered: 2,
        local_billable_usage_events: 3,
        local_customer_credits: 12,
        local_customer_revenue_lyd: 2.4,
        local_meta_cost_rows: 1,
        local_usage_fallback_rows: 1,
        local_estimated_amount: 5,
        local_final_amount: 5,
        invoice_total_amount: 10,
    });
});

test('Meta usage comparison uses one complete normalized period and latest tenant snapshot', (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    db.prepare(`
        INSERT INTO meta_usage_snapshots (
            tenant_id, waba_id, period_start, period_end, granularity, status,
            currency, meta_sent, meta_delivered, meta_cost_amount, created_at
        ) VALUES (1, 'waba-a', '2026-06-01', '2026-06-30', 'MONTHLY', 'synced', 'USD', 4, 3, 6, '2026-07-01 00:00:00')
    `).run();

    const result = getMetaUsageComparison(db, {
        tenantId: 1,
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
    });
    assert.equal(result.latest_snapshot.meta_sent, 4);
    assert.equal(result.comparison.diff_sent, 1);
    assert.equal(result.comparison.diff_delivered, 1);
    assert.equal(result.comparison.diff_meta_vs_local_cost, 1);
    assert.equal(result.comparison.diff_invoice_vs_local_cost, 5);

    assert.throws(
        () => getMetaUsageComparison(db, { tenantId: 1, periodStart: '2026-06-01' }),
        (error) => error?.status === 400 && error?.code === 'META_COMPARISON_PERIOD_REQUIRED'
    );
    assert.throws(
        () => getMetaUsageComparison(db, {}),
        (error) => error?.status === 400 && error?.code === 'TENANT_REQUIRED'
    );
});

test('Meta snapshot sync normalizes the period and persists aggregated API results', async (t) => {
    const db = createDatabase();
    t.after(() => db.close());
    const requestedFields = [];
    const snapshot = await syncMetaUsageSnapshot(db, {
        tenantId: 1,
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        granularity: 'daily',
        createdBy: 7,
    }, {
        getAccessToken: () => 'test-token',
        async fetchWabaField(wabaId, field, token) {
            assert.equal(wabaId, 'waba-a');
            assert.equal(token, 'test-token');
            requestedFields.push(field);
            if (field.startsWith('analytics.')) {
                return { analytics: { data_points: [{ sent: 4, delivered: 3 }] } };
            }
            if (field.startsWith('pricing_analytics.')) {
                return { pricing_analytics: { data_points: [{ volume: 2, cost: 6, currency: 'USD' }] } };
            }
            return { conversation_analytics: { data: [{ data_points: [{ conversation: 1, cost: 7, currency: 'USD' }] }] } };
        },
    });

    assert.equal(requestedFields.length, 3);
    assert.equal(snapshot.period_start, '2026-06-01');
    assert.equal(snapshot.period_end, '2026-06-30');
    assert.equal(snapshot.granularity, 'DAILY');
    assert.equal(snapshot.status, 'synced');
    assert.equal(snapshot.meta_sent, 4);
    assert.equal(snapshot.meta_delivered, 3);
    assert.equal(snapshot.meta_cost_amount, 6);
    assert.equal(snapshot.local_final_amount, 5);
    assert.equal(snapshot.diff_cost_amount, 1);
    assert.equal(snapshot.created_by, 7);
    assert.equal(JSON.parse(snapshot.summary_json).requested_granularity, 'DAILY');

    await assert.rejects(
        () => syncMetaUsageSnapshot(db, {
            tenantId: 1,
            periodStart: '2026-06-01',
            periodEnd: '2026-06-30',
            granularity: 'hourly',
        }, { getAccessToken: () => 'token', fetchWabaField: async () => ({}) }),
        (error) => error?.status === 400 && error?.code === 'INVALID_META_GRANULARITY'
    );
});
