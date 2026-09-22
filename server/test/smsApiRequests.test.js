import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
    createSmsHistoryMessageHandler,
    reconcileSmsMessageBilling,
    smsCallbackDedupeKey,
    SmsApiRequestStore,
    smsApiRequestHash,
} from '../services/smsApiRequests.js';

const createDatabase = () => {
    const database = new Database(':memory:');
    database.exec(`
        CREATE TABLE billing_usage_events (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            status TEXT NOT NULL,
            idempotency_key TEXT UNIQUE,
            reference_type TEXT
        );
        CREATE TABLE sms_api_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            idempotency_key TEXT NOT NULL,
            request_hash TEXT NOT NULL,
            sms_account_id INTEGER,
            status TEXT NOT NULL DEFAULT 'processing',
            attempt INTEGER NOT NULL DEFAULT 1,
            billing_usage_id INTEGER,
            response_json TEXT,
            last_error_code TEXT,
            lease_expires_at TEXT NOT NULL,
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(tenant_id, idempotency_key)
        );
    `);
    return database;
};

test('SMS API request recovery reuses an orphaned reservation after a crashed attach', () => {
    const database = createDatabase();
    let now = Date.parse('2026-09-20T08:00:00.000Z');
    const store = new SmsApiRequestStore({ database, now: () => now, leaseMilliseconds: 30_000 });
    const input = {
        tenantId: 4,
        idempotencyKey: 'external-order-1001',
        smsAccountId: 12,
        requestHash: smsApiRequestHash({
            smsAccountSelector: null,
            recipient: '+218 91 000 0001',
            message: 'Ready',
        }),
    };
    const first = store.claim(input);
    assert.equal(first.request.attempt, 1);

    database.prepare(`
        INSERT INTO billing_usage_events (id, tenant_id, status, idempotency_key)
        VALUES (77, 4, 'reserved', 'billing:4:api-sms:external-order-1001:attempt:1')
    `).run();
    now += 31_000;
    const recovered = store.claim(input);
    assert.equal(recovered.request.attempt, 1);
    assert.equal(recovered.request.billing_usage_id, 77);
    assert.equal(recovered.reservation.id, 77);

    store.accept(recovered.request.id, { success: true, data: { message_id: 55 } });
    const duplicate = store.inspect({
        tenantId: input.tenantId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
    });
    assert.equal(duplicate.status, 'accepted');
    assert.equal(duplicate.response.data.message_id, 55);
    database.close();
});

test('SMS API request retry advances the billing attempt after a released reservation', () => {
    const database = createDatabase();
    let now = Date.parse('2026-09-20T08:00:00.000Z');
    const store = new SmsApiRequestStore({ database, now: () => now, leaseMilliseconds: 30_000 });
    const input = {
        tenantId: 4,
        idempotencyKey: 'external-order-1002',
        smsAccountId: 12,
        requestHash: smsApiRequestHash({
            smsAccountSelector: 12,
            recipient: '218910000001',
            message: 'Ready',
        }),
    };
    const first = store.claim(input);
    database.prepare(`
        INSERT INTO billing_usage_events (id, tenant_id, status, idempotency_key)
        VALUES (78, 4, 'released', 'billing:4:api-sms:external-order-1002:attempt:1')
    `).run();
    store.attachBilling(first.request.id, 78);
    store.fail(first.request.id, { code: 'SMS_GATEWAY_UNAVAILABLE' });

    now += 1_000;
    const retry = store.claim(input);
    assert.equal(retry.request.attempt, 2);
    assert.equal(retry.request.billing_usage_id, null);
    assert.equal(retry.reservation, null);
    database.close();
});

test('history reconciliation commits an uncertain API reservation and caches its response', () => {
    const database = createDatabase();
    const store = new SmsApiRequestStore({ database });
    const requestHash = smsApiRequestHash({
        smsAccountSelector: null,
        recipient: '218910000001',
        message: 'Recovered',
    });
    const claimed = store.claim({
        tenantId: 4,
        idempotencyKey: 'external-order-1003',
        requestHash,
        smsAccountId: 12,
    });
    database.prepare(`
        INSERT INTO billing_usage_events (
            id, tenant_id, status, idempotency_key, reference_type
        ) VALUES (
            79, 4, 'reserved', 'billing:4:api-sms:external-order-1003:attempt:1',
            'api_sms_message'
        )
    `).run();
    store.attachBilling(claimed.request.id, 79);
    store.fail(claimed.request.id, { code: 'SMS_GATEWAY_UNAVAILABLE' });
    const commits = [];
    const message = {
        id: 501,
        tenant_id: 4,
        sms_account_id: 12,
        sms_account_name: 'Primary',
        gateway_message_id: 'gateway-501',
        external_id: 'external-order-1003',
        recipient: '218910000001',
        status: 'delivered',
    };

    const result = reconcileSmsMessageBilling({
        database,
        billing: {
            commit(usage, options) {
                commits.push({ usage, options });
                database.prepare("UPDATE billing_usage_events SET status = 'committed' WHERE id = ?")
                    .run(usage.id);
            },
        },
        requestStore: store,
        message,
    });

    assert.equal(result.reconciled, true);
    assert.equal(commits.length, 1);
    const accepted = store.inspect({
        tenantId: 4,
        idempotencyKey: 'external-order-1003',
        requestHash,
    });
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.response.data.message_id, 501);
    assert.equal(database.prepare('SELECT status FROM billing_usage_events WHERE id = 79').get().status, 'committed');
    database.close();
});

test('unchanged incremental history replay re-enqueues a missed callback without repeating SSE', async () => {
    const reconciled = [];
    const broadcasts = [];
    const conversationUpdates = [];
    const callbackAttempts = [];
    const message = {
        id: 502,
        tenant_id: 4,
        sms_account_id: 12,
        sms_account_name: 'Primary',
        gateway_message_id: 'gateway-502',
        external_id: 'external-order-1004',
        direction: 'incoming',
        sender: '218910000002',
        content: 'Recovered after crash',
        status: 'received',
    };
    const handler = createSmsHistoryMessageHandler({
        reconcileMessage: value => reconciled.push(value.id),
        presentMessage: value => ({ ...value, presented: true }),
        broadcast: (channel, event, data) => broadcasts.push({ channel, event, data }),
        emitConversationUpdate: tenantId => conversationUpdates.push(tenantId),
        callbackSender: async (tenantId, event, data, options) => {
            callbackAttempts.push({ tenantId, event, data, options });
        },
    });

    // The row already exists because the process stopped after committing the
    // history page but before its callback was enqueued.
    const unchangedReplay = {
        account: { id: 12, tenant_id: 4, management_mode: 'managed' },
        message,
        phase: 'incremental',
        changed: false,
    };
    await handler(unchangedReplay);
    await handler(unchangedReplay);

    assert.deepEqual(reconciled, [502, 502]);
    assert.deepEqual(broadcasts, []);
    assert.deepEqual(conversationUpdates, []);
    assert.equal(callbackAttempts.length, 2);
    assert.equal(callbackAttempts[0].tenantId, 4);
    assert.equal(callbackAttempts[0].event, 'sms_message_received');
    assert.equal(callbackAttempts[0].data.presented, true);
    assert.equal(
        callbackAttempts[0].options.dedupeKey,
        smsCallbackDedupeKey('sms_message_received', message),
    );
    assert.equal(
        callbackAttempts[1].options.dedupeKey,
        callbackAttempts[0].options.dedupeKey,
    );
});
