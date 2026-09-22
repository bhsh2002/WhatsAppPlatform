import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';

import { TenantCallbackOutbox } from '../services/tenantCallbackOutbox.js';

const createDatabase = () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec(`
        CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE tenant_api_settings (
            tenant_id INTEGER PRIMARY KEY,
            callback_url TEXT,
            webhook_secret TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );
        CREATE TABLE tenant_api_callback_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            delivery_id TEXT NOT NULL UNIQUE,
            dedupe_key TEXT UNIQUE,
            tenant_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            callback_url TEXT NOT NULL,
            body_json TEXT NOT NULL,
            signature TEXT,
            legacy_signature TEXT,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending', 'processing', 'failed', 'delivered', 'dead_letter')),
            attempts INTEGER NOT NULL DEFAULT 0,
            available_at TEXT NOT NULL,
            locked_at TEXT,
            delivered_at TEXT,
            response_status INTEGER,
            last_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );
        INSERT INTO tenants (id, name) VALUES (7, 'Callback tenant');
        INSERT INTO tenant_api_settings (tenant_id, callback_url, webhook_secret)
        VALUES (7, 'https://hooks.example.com/events', 'tenant-webhook-secret');
    `);
    return database;
};

const createHarness = ({
    responses = [],
    maxAttempts = 4,
    deliveryId = () => 'a35aa210-eacc-4dae-96fc-d7b787b6dc69',
} = {}) => {
    const database = createDatabase();
    let currentTime = new Date('2026-09-20T08:00:00.000Z');
    const requests = [];
    const outbox = new TenantCallbackOutbox({
        database,
        fetchImpl: async (url, options) => {
            requests.push({ url, options });
            const response = responses.shift();
            if (response instanceof Error) throw response;
            return response || { ok: true, status: 204 };
        },
        now: () => new Date(currentTime),
        deliveryId,
        maxAttempts,
        leaseMs: 60_000,
        baseDelayMs: 1_000,
        maxDelayMs: 60_000,
    });
    return {
        database,
        outbox,
        requests,
        setTime(value) { currentTime = new Date(value); },
    };
};

test('tenant callbacks persist the exact signed body before network delivery', (t) => {
    const harness = createHarness();
    t.after(() => harness.database.close());

    const result = harness.outbox.enqueue(7, 'sms_message_received', {
        message_id: 42,
        content: 'hello',
    });

    assert.deepEqual(result, {
        queued: true,
        duplicate: false,
        id: 1,
        delivery_id: 'a35aa210-eacc-4dae-96fc-d7b787b6dc69',
    });
    assert.equal(harness.requests.length, 0);
    const row = harness.database.prepare('SELECT * FROM tenant_api_callback_outbox').get();
    assert.equal(row.status, 'pending');
    assert.equal(row.attempts, 0);
    assert.equal(row.callback_url, 'https://hooks.example.com/events');
    assert.deepEqual(JSON.parse(row.body_json), {
        event: 'sms_message_received',
        timestamp: '2026-09-20T08:00:00.000Z',
        tenant_id: 7,
        data: { message_id: 42, content: 'hello' },
    });
    assert.equal(
        row.signature,
        `v1=${crypto.createHmac('sha256', 'tenant-webhook-secret')
            .update(`${row.delivery_id}.${row.body_json}`).digest('hex')}`,
    );
    assert.equal(
        row.legacy_signature,
        `sha256=${crypto.createHmac('sha256', 'tenant-webhook-secret')
            .update(row.body_json).digest('hex')}`,
    );
});

test('callback enqueue deduplicates recovered events by a stable producer key', (t) => {
    let sequence = 0;
    const harness = createHarness({ deliveryId: () => `delivery-${sequence += 1}` });
    t.after(() => harness.database.close());
    const options = { dedupeKey: 'account:9:message:42:delivered' };

    const first = harness.outbox.enqueue(7, 'sms_message_status_changed', {
        message_id: 42,
        status: 'delivered',
    }, options);
    const duplicate = harness.outbox.enqueue(7, 'sms_message_status_changed', {
        message_id: 42,
        status: 'delivered',
    }, options);

    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.delivery_id, first.delivery_id);
    assert.equal(
        harness.database.prepare('SELECT COUNT(*) AS count FROM tenant_api_callback_outbox').get().count,
        1,
    );
});

test('callback worker delivers a queued body and records a successful response', async (t) => {
    const harness = createHarness({ responses: [{ ok: true, status: 202 }] });
    t.after(() => harness.database.close());
    harness.outbox.enqueue(7, 'sms_message_status_changed', { status: 'delivered' });

    const results = await harness.outbox.dispatch();

    assert.deepEqual(results, [{
        delivery_id: 'a35aa210-eacc-4dae-96fc-d7b787b6dc69',
        status: 'delivered',
        response_status: 202,
    }]);
    const row = harness.database.prepare('SELECT * FROM tenant_api_callback_outbox').get();
    assert.equal(row.status, 'delivered');
    assert.equal(row.attempts, 1);
    assert.equal(row.last_error, null);
    assert.equal(harness.requests[0].options.body, row.body_json);
    assert.equal(
        harness.requests[0].options.headers['X-Savana-Delivery-Id'],
        row.delivery_id,
    );
    assert.equal(harness.requests[0].options.headers['X-Savana-Signature'], row.signature);
    assert.equal(harness.requests[0].options.headers['X-Signature'], row.legacy_signature);
});

test('non-2xx callback responses retry with the same body and delivery id', async (t) => {
    const harness = createHarness({
        responses: [
            { ok: false, status: 503 },
            { ok: true, status: 204 },
        ],
    });
    t.after(() => harness.database.close());
    harness.outbox.enqueue(7, 'sms_message_accepted', { message_id: 91 });

    const failed = await harness.outbox.dispatch();
    assert.equal(failed[0].status, 'failed');
    let row = harness.database.prepare('SELECT * FROM tenant_api_callback_outbox').get();
    assert.equal(row.attempts, 1);
    assert.match(row.last_error, /HTTP 503/);

    harness.database.prepare(`
        UPDATE tenant_api_callback_outbox SET available_at = '2026-09-20T08:00:00.000Z'
    `).run();
    const delivered = await harness.outbox.dispatch();
    assert.equal(delivered[0].status, 'delivered');
    row = harness.database.prepare('SELECT * FROM tenant_api_callback_outbox').get();
    assert.equal(row.attempts, 2);
    assert.equal(row.status, 'delivered');
    assert.equal(harness.requests[0].options.body, harness.requests[1].options.body);
    assert.equal(
        harness.requests[0].options.headers['X-Savana-Delivery-Id'],
        harness.requests[1].options.headers['X-Savana-Delivery-Id'],
    );
});

test('worker reclaims a crashed delivery after its lease expires', async (t) => {
    const harness = createHarness({ responses: [{ ok: true, status: 200 }] });
    t.after(() => harness.database.close());
    harness.outbox.enqueue(7, 'sms_message_received', { message_id: 5 });
    harness.database.prepare(`
        UPDATE tenant_api_callback_outbox
        SET status = 'processing', attempts = 1,
            locked_at = '2026-09-20T07:58:00.000Z'
    `).run();

    const results = await harness.outbox.dispatch();

    assert.equal(results[0].status, 'delivered');
    const row = harness.database.prepare('SELECT * FROM tenant_api_callback_outbox').get();
    assert.equal(row.status, 'delivered');
    assert.equal(row.attempts, 2);
    assert.equal(row.locked_at, null);
});

test('worker bounds repeated failures in a dead letter state', async (t) => {
    const harness = createHarness({
        responses: [
            { ok: false, status: 500 },
            { ok: false, status: 500 },
        ],
        maxAttempts: 2,
    });
    t.after(() => harness.database.close());
    harness.outbox.enqueue(7, 'sms_message_received', { message_id: 6 });

    await harness.outbox.dispatch();
    harness.database.prepare(`
        UPDATE tenant_api_callback_outbox SET available_at = '2026-09-20T08:00:00.000Z'
    `).run();
    const results = await harness.outbox.dispatch();

    assert.equal(results[0].status, 'dead_letter');
    const row = harness.database.prepare('SELECT * FROM tenant_api_callback_outbox').get();
    assert.equal(row.status, 'dead_letter');
    assert.equal(row.attempts, 2);
    assert.deepEqual(harness.outbox.diagnostics(), {
        pending: 0,
        dead_letter: 1,
        oldest_pending_at: null,
    });
});

test('worker selects due callbacks fairly across tenants and dispatches concurrently', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    database.exec(`
        INSERT INTO tenants (id, name) VALUES (8, 'Second tenant');
        INSERT INTO tenant_api_settings (tenant_id, callback_url, webhook_secret)
        VALUES (8, 'https://hooks-2.example.com/events', 'second-secret');
    `);
    let sequence = 0;
    let active = 0;
    let maximumActive = 0;
    const release = [];
    const outbox = new TenantCallbackOutbox({
        database,
        deliveryId: () => `delivery-fair-${sequence += 1}`,
        now: () => new Date('2026-09-20T08:00:00.000Z'),
        concurrency: 2,
        fetchImpl: async url => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await new Promise(resolve => release.push(resolve));
            active -= 1;
            return { ok: true, status: url.includes('hooks-2') ? 202 : 204 };
        },
    });
    outbox.enqueue(7, 'sms_message_received', { message_id: 1 });
    outbox.enqueue(7, 'sms_message_received', { message_id: 2 });
    outbox.enqueue(7, 'sms_message_received', { message_id: 3 });
    outbox.enqueue(8, 'sms_message_received', { message_id: 4 });

    const dispatch = outbox.dispatch({ limit: 2 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(maximumActive, 2);
    assert.equal(release.length, 2);
    release.splice(0).forEach(resolve => resolve());
    const results = await dispatch;

    assert.equal(results.length, 2);
    assert.deepEqual(
        database.prepare(`
            SELECT tenant_id FROM tenant_api_callback_outbox
            WHERE status = 'delivered' ORDER BY id
        `).all().map(row => row.tenant_id),
        [7, 8],
    );
    assert.deepEqual(outbox.diagnostics(), {
        pending: 2,
        dead_letter: 0,
        oldest_pending_at: '2026-09-20T08:00:00.000Z',
    });
});

test('worker preserves callback order within one tenant', async (t) => {
    let sequence = 0;
    const harness = createHarness({
        deliveryId: () => `ordered-delivery-${sequence += 1}`,
        responses: [
            { ok: true, status: 204 },
            { ok: true, status: 204 },
        ],
    });
    t.after(() => harness.database.close());
    harness.outbox.enqueue(7, 'sms_message_accepted', { message_id: 71 });
    harness.outbox.enqueue(7, 'sms_message_status_changed', {
        message_id: 71,
        status: 'delivered',
    });

    const delivered = await harness.outbox.dispatch({ limit: 100 });
    assert.equal(delivered.length, 2);
    assert.equal(JSON.parse(harness.requests[0].options.body).event, 'sms_message_accepted');
    assert.equal(JSON.parse(harness.requests[1].options.body).event, 'sms_message_status_changed');
    assert.deepEqual(
        harness.database.prepare(`
            SELECT status FROM tenant_api_callback_outbox ORDER BY id
        `).all().map(row => row.status),
        ['delivered', 'delivered'],
    );
});

test('worker stops a tenant callback chain when its head fails', async (t) => {
    let sequence = 0;
    const harness = createHarness({
        deliveryId: () => `blocked-delivery-${sequence += 1}`,
        responses: [{ ok: false, status: 503 }],
    });
    t.after(() => harness.database.close());
    harness.outbox.enqueue(7, 'sms_message_accepted', { message_id: 81 });
    harness.outbox.enqueue(7, 'sms_message_status_changed', {
        message_id: 81,
        status: 'delivered',
    });

    const results = await harness.outbox.dispatch({ limit: 100 });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'failed');
    assert.equal(harness.requests.length, 1);
    assert.deepEqual(
        harness.database.prepare(`
            SELECT status FROM tenant_api_callback_outbox ORDER BY id
        `).all().map(row => row.status),
        ['failed', 'pending'],
    );
});
