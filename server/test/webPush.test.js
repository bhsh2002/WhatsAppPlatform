import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { initEncryption } from '../services/encryption.js';
import {
    createWebPushService,
    validatePushEndpoint,
    webPushConfigFromEnv,
    WebPushServiceError,
} from '../services/webPush.js';
import { UnsafeOutboundUrlError } from '../security/outboundUrl.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationSql = fs.readFileSync(
    path.join(testDirectory, '..', 'db', 'migrations', '053_web_push.sql'),
    'utf8',
);

const vapidPublic = Buffer.alloc(65, 3).toString('base64url');
const vapidPrivate = Buffer.alloc(32, 4).toString('base64url');
const p256dh = Buffer.alloc(65, 5).toString('base64url');
const auth = Buffer.alloc(16, 6).toString('base64url');

process.env.CRYPTO_KEY = 'c'.repeat(64);
initEncryption();

const createDatabase = () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec(`
        CREATE TABLE tenants (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL
        );
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            tenant_id INTEGER,
            is_active INTEGER NOT NULL DEFAULT 1,
            tokens_revoked_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
        );
        CREATE TABLE revoked_tokens (
            jti TEXT PRIMARY KEY,
            user_id INTEGER,
            expires_at TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    `);
    database.exec(migrationSql);
    database.exec(`
        INSERT INTO tenants VALUES (1, 'Tenant A', 'Active');
        INSERT INTO tenants VALUES (2, 'Tenant B', 'Active');
        INSERT INTO users (
            id, username, password_hash, role, tenant_id, is_active, tokens_revoked_at
        ) VALUES
            (1, 'a', 'hash', 'user', 1, 1, NULL),
            (2, 'b', 'hash', 'user', 2, 1, NULL),
            (3, 'admin', 'hash', 'admin', NULL, 1, NULL),
            (4, 'disabled', 'hash', 'user', 1, 0, NULL);
    `);
    return database;
};

const createProvider = behavior => {
    const calls = [];
    return {
        calls,
        vapid: null,
        setVapidDetails(...values) { this.vapid = values; },
        async sendNotification(subscription, payload, options) {
            calls.push({ subscription, payload: JSON.parse(payload), options });
            if (behavior) return behavior({ subscription, payload: JSON.parse(payload), options, calls });
            return { statusCode: 201 };
        },
    };
};

const config = overrides => ({
    enabled: true,
    publicKey: vapidPublic,
    privateKey: vapidPrivate,
    subject: 'mailto:support@savana.ly',
    ttlSeconds: 300,
    providerTimeoutMs: 10_000,
    maxAttempts: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 10_000,
    leaseMs: 30_000,
    batchSize: 100,
    maxSubscriptionsPerUser: 10,
    ...overrides,
});

const sessionFor = (id, clockMs, overrides = {}) => ({
    id,
    role: id === 3 ? 'admin' : 'user',
    tenant_id: id === 1 ? 1 : id === 2 ? 2 : undefined,
    jti: `session-${id}`,
    iat: Math.trunc(clockMs / 1000) - 60,
    exp: Math.trunc(clockMs / 1000) + 3600,
    auth_version: 0,
    ...overrides,
});

const subscriptionFor = suffix => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`,
    keys: { p256dh, auth },
});

const buildService = ({
    database,
    provider,
    clock,
    overrides,
    endpointValidator = async endpoint => new URL(endpoint).toString(),
} = {}) => createWebPushService({
    database,
    provider,
    config: config(overrides),
    endpointValidator,
    now: () => new Date(clock.value),
});

test('subscriptions are encrypted, bound to a session and movable only as one browser endpoint', async () => {
    const database = createDatabase();
    const provider = createProvider();
    const clock = { value: Date.UTC(2027, 0, 1) };
    const service = buildService({ database, provider, clock });
    const subscription = subscriptionFor('shared-browser');

    await service.registerSubscription({ user: sessionFor(1, clock.value), subscription });
    const stored = database.prepare('SELECT * FROM web_push_subscriptions').get();
    assert.equal(stored.user_id, 1);
    assert.equal(stored.session_jti, 'session-1');
    assert.equal(stored.session_auth_version, 0);
    assert.notEqual(stored.endpoint_encrypted, subscription.endpoint);
    assert.notEqual(stored.p256dh_encrypted, subscription.keys.p256dh);
    assert.notEqual(stored.auth_encrypted, subscription.keys.auth);
    assert.equal(stored.endpoint_hash.length, 64);

    await service.registerSubscription({ user: sessionFor(2, clock.value), subscription });
    const moved = database.prepare('SELECT id, user_id FROM web_push_subscriptions').all();
    assert.equal(moved.length, 1);
    assert.equal(moved[0].user_id, 2);
    database.close();
});

test('subscription deletion and reassignment finalize affected outbox events', async () => {
    const database = createDatabase();
    const provider = createProvider();
    const clock = { value: Date.UTC(2027, 0, 1) };
    const service = buildService({ database, provider, clock });
    const subscription = subscriptionFor('finalize-on-delete');

    await service.registerSubscription({ user: sessionFor(1, clock.value), subscription });
    const removedEvent = service.enqueueMessage({
        tenantId: 1,
        channel: 'sms',
        sourceId: 'removed-subscription-event',
    });
    assert.equal(removedEvent.status, 'pending');
    assert.deepEqual(
        service.removeSubscription({ userId: 1, endpoint: subscription.endpoint }),
        { removed: true },
    );
    assert.deepEqual(
        database.prepare(`
            SELECT status, completed_at IS NOT NULL AS completed
            FROM web_push_events WHERE id = ?
        `).get(removedEvent.event_id),
        { status: 'no_recipients', completed: 1 },
    );

    await service.registerSubscription({ user: sessionFor(1, clock.value), subscription });
    const movedEvent = service.enqueueMessage({
        tenantId: 1,
        channel: 'sms',
        sourceId: 'moved-subscription-event',
    });
    await service.registerSubscription({ user: sessionFor(2, clock.value), subscription });
    assert.equal(
        database.prepare('SELECT status FROM web_push_events WHERE id = ?')
            .get(movedEvent.event_id).status,
        'no_recipients',
    );
    database.close();
});

test('subscription registration bounds endpoint validation time', async () => {
    const database = createDatabase();
    const provider = createProvider();
    const clock = { value: Date.UTC(2027, 0, 1) };
    const service = buildService({
        database,
        provider,
        clock,
        overrides: { providerTimeoutMs: 10 },
        endpointValidator: async () => new Promise(() => {}),
    });

    await assert.rejects(
        service.registerSubscription({
            user: sessionFor(1, clock.value),
            subscription: subscriptionFor('registration-timeout'),
        }),
        error => error instanceof WebPushServiceError
            && error.code === 'PUSH_ENDPOINT_VALIDATION_TIMEOUT'
            && error.status === 503,
    );
    assert.equal(database.prepare('SELECT COUNT(*) count FROM web_push_subscriptions').get().count, 0);
    database.close();
});

test('subscription registration rechecks auth generation after asynchronous validation', async () => {
    const database = createDatabase();
    const provider = createProvider();
    const clock = { value: Date.UTC(2027, 0, 1) };
    const service = buildService({
        database,
        provider,
        clock,
        endpointValidator: async endpoint => {
            database.prepare(`
                UPDATE users SET auth_version = auth_version + 1 WHERE id = 1
            `).run();
            return new URL(endpoint).toString();
        },
    });

    await assert.rejects(
        service.registerSubscription({
            user: sessionFor(1, clock.value),
            subscription: subscriptionFor('reset-during-validation'),
        }),
        error => error instanceof WebPushServiceError
            && error.code === 'PUSH_SESSION_REQUIRED'
            && error.status === 401,
    );
    assert.equal(database.prepare('SELECT COUNT(*) count FROM web_push_subscriptions').get().count, 0);
    database.close();
});

test('stale auth generations do not consume the current push subscription limit', async () => {
    const database = createDatabase();
    const provider = createProvider();
    const clock = { value: Date.UTC(2027, 0, 1) };
    const service = buildService({
        database,
        provider,
        clock,
        overrides: { maxSubscriptionsPerUser: 2 },
    });

    await service.registerSubscription({
        user: sessionFor(1, clock.value),
        subscription: subscriptionFor('generation-zero-a'),
    });
    await service.registerSubscription({
        user: sessionFor(1, clock.value),
        subscription: subscriptionFor('generation-zero-b'),
    });
    database.prepare('UPDATE users SET auth_version = 1 WHERE id = 1').run();

    const currentSession = sessionFor(1, clock.value, {
        jti: 'session-1-current',
        auth_version: 1,
    });
    await service.registerSubscription({
        user: currentSession,
        subscription: subscriptionFor('generation-one-a'),
    });
    await service.registerSubscription({
        user: currentSession,
        subscription: subscriptionFor('generation-one-b'),
    });
    assert.deepEqual(
        database.prepare(`
            SELECT COUNT(*) AS total,
                   SUM(session_auth_version = 1) AS current
            FROM web_push_subscriptions WHERE user_id = 1
        `).get(),
        { total: 4, current: 2 },
    );

    await assert.rejects(
        service.registerSubscription({
            user: currentSession,
            subscription: subscriptionFor('generation-one-over-limit'),
        }),
        error => error instanceof WebPushServiceError
            && error.code === 'PUSH_SUBSCRIPTION_LIMIT'
            && error.status === 409,
    );
    const queued = service.enqueueMessage({
        tenantId: 1,
        channel: 'sms',
        sourceId: 'current-generation-only',
    });
    assert.equal(queued.deliveries, 2);
    database.close();
});

test('expired and revoked sessions do not consume the push subscription limit', async () => {
    const database = createDatabase();
    const provider = createProvider();
    const clock = { value: Date.UTC(2027, 0, 1) };
    const service = buildService({
        database,
        provider,
        clock,
        overrides: { maxSubscriptionsPerUser: 1 },
    });

    const revokedSession = sessionFor(1, clock.value, { jti: 'revoked-for-limit' });
    await service.registerSubscription({
        user: revokedSession,
        subscription: subscriptionFor('revoked-for-limit'),
    });
    database.prepare(`
        INSERT INTO revoked_tokens (jti, user_id, expires_at)
        VALUES (?, 1, ?)
    `).run(revokedSession.jti, new Date(clock.value + 86_400_000).toISOString());

    const expiredLater = sessionFor(1, clock.value, { jti: 'expired-for-limit' });
    await service.registerSubscription({
        user: expiredLater,
        subscription: subscriptionFor('expired-for-limit'),
    });
    database.prepare(`
        UPDATE web_push_subscriptions
        SET session_expires_at = ?
        WHERE session_jti = ?
    `).run(Math.trunc(clock.value / 1000) - 1, expiredLater.jti);

    const activeSession = sessionFor(1, clock.value, { jti: 'active-for-limit' });
    await service.registerSubscription({
        user: activeSession,
        subscription: subscriptionFor('active-for-limit'),
    });
    assert.equal(
        database.prepare('SELECT COUNT(*) AS count FROM web_push_subscriptions').get().count,
        3,
    );
    assert.equal(service.enqueueMessage({
        tenantId: 1,
        channel: 'sms',
        sourceId: 'only-active-limit-recipient',
    }).deliveries, 1);
    database.close();
});

test('tenant message delivery includes admins but never another tenant and exposes no message data', async () => {
    const database = createDatabase();
    const provider = createProvider();
    const clock = { value: Date.UTC(2027, 0, 1) };
    const service = buildService({ database, provider, clock });
    await service.registerSubscription({ user: sessionFor(1, clock.value), subscription: subscriptionFor('tenant-a') });
    await service.registerSubscription({ user: sessionFor(2, clock.value), subscription: subscriptionFor('tenant-b') });
    await service.registerSubscription({ user: sessionFor(3, clock.value), subscription: subscriptionFor('admin') });

    const sourceId = 'wamid-sensitive-218910000000-secret-message';
    const queued = service.enqueueMessage({
        tenantId: 1,
        channel: 'whatsapp',
        sourceId,
        content: 'must never be accepted into the payload',
    });
    assert.equal(queued.deliveries, 2);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM web_push_deliveries').get().count, 2);
    assert.equal(database.prepare('SELECT source_hash FROM web_push_events').get().source_hash.length, 64);
    assert.equal(JSON.stringify(database.prepare('SELECT * FROM web_push_events').get()).includes(sourceId), false);

    const duplicate = service.enqueueMessage({ tenantId: 1, channel: 'whatsapp', sourceId });
    assert.equal(duplicate.deduplicated, true);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM web_push_deliveries').get().count, 2);

    const dispatched = await service.dispatchDue();
    assert.equal(dispatched.attempted, 2);
    assert.equal(provider.calls.length, 2);
    assert.deepEqual(
        provider.calls.map(call => call.subscription.endpoint).sort(),
        [
            'https://fcm.googleapis.com/fcm/send/admin',
            'https://fcm.googleapis.com/fcm/send/tenant-a',
        ],
    );
    const serializedPayloads = provider.calls.map(call => JSON.stringify(call.payload)).join('\n');
    assert.equal(serializedPayloads.includes(sourceId), false);
    assert.equal(serializedPayloads.includes('218910000000'), false);
    assert.equal(serializedPayloads.includes('secret-message'), false);
    assert.ok(provider.calls.every(call => call.payload.tag.startsWith('wa-message-whatsapp-')));
    assert.ok(provider.calls.every(call => call.payload.body === 'وصلت رسالة جديدة عبر WhatsApp.'));
    assert.ok(provider.calls.some(call => call.payload.url === '/inbox?channel=whatsapp'));
    assert.ok(provider.calls.some(call => call.payload.url === '/portal/inbox?channel=whatsapp'));
    database.close();
});

test('SMS messages notify only the tenant while SMS failure alerts still notify admins', async () => {
    const database = createDatabase();
    const provider = createProvider();
    const clock = { value: Date.UTC(2027, 0, 1) };
    const service = buildService({ database, provider, clock });
    await service.registerSubscription({
        user: sessionFor(1, clock.value),
        subscription: subscriptionFor('tenant-a'),
    });
    await service.registerSubscription({
        user: sessionFor(3, clock.value),
        subscription: subscriptionFor('admin'),
    });

    const message = service.enqueueMessage({
        tenantId: 1,
        channel: 'sms',
        sourceId: 'incoming-sms-1',
    });
    assert.equal(message.deliveries, 1);
    await service.dispatchDue();
    assert.deepEqual(
        provider.calls.map(call => call.subscription.endpoint),
        ['https://fcm.googleapis.com/fcm/send/tenant-a'],
    );
    assert.equal(provider.calls[0].payload.url, '/portal/inbox?channel=sms');

    const smsEvent = database.prepare(`
        SELECT id FROM web_push_events WHERE kind = 'message' AND channel = 'sms'
    `).get();
    const adminSubscription = database.prepare(`
        SELECT subscriptions.id
        FROM web_push_subscriptions subscriptions
        JOIN users ON users.id = subscriptions.user_id
        WHERE users.role = 'admin'
    `).get();
    const timestamp = new Date(clock.value).toISOString();
    database.prepare(`
        INSERT INTO web_push_deliveries (
            event_id, subscription_id, status, attempts, available_at, created_at, updated_at
        ) VALUES (?, ?, 'pending', 0, ?, ?, ?)
    `).run(smsEvent.id, adminSubscription.id, timestamp, timestamp, timestamp);
    const staleAdminDelivery = await service.dispatchDue();
    assert.equal(staleAdminDelivery.results[0].status, 'skipped');
    assert.equal(provider.calls.length, 1);

    const failure = service.enqueueAlert({
        tenantId: 1,
        code: 'SMS_MESSAGE_FAILED',
        sourceId: 'failed-sms-1',
        severity: 'critical',
    });
    assert.equal(failure.deliveries, 2);
    await service.dispatchDue();
    const failureCalls = provider.calls.slice(1);
    assert.deepEqual(
        failureCalls.map(call => call.subscription.endpoint).sort(),
        [
            'https://fcm.googleapis.com/fcm/send/admin',
            'https://fcm.googleapis.com/fcm/send/tenant-a',
        ],
    );
    assert.deepEqual(
        failureCalls.map(call => call.payload.url).sort(),
        ['/portal/inbox?channel=sms', '/settings'],
    );
    database.close();
});

test('alert payloads use supported role-aware destinations', async () => {
    const database = createDatabase();
    const provider = createProvider();
    const clock = { value: Date.UTC(2027, 0, 1) };
    const service = buildService({ database, provider, clock });
    await service.registerSubscription({
        user: sessionFor(1, clock.value),
        subscription: subscriptionFor('tenant-a'),
    });
    await service.registerSubscription({
        user: sessionFor(3, clock.value),
        subscription: subscriptionFor('admin'),
    });

    const cases = [
        ['WHATSAPP_MESSAGE_FAILED', '/inbox?channel=whatsapp', '/portal/inbox?channel=whatsapp'],
        ['WHATSAPP_TEMPLATE_REQUIRES_ATTENTION', '/templates', '/portal/templates'],
        ['WHATSAPP_TEMPLATE_QUALITY_DEGRADED', '/templates', '/portal/templates'],
        ['WHATSAPP_QUALITY_DEGRADED', '/whatsapp', '/portal/meta-review'],
        ['META_ACCOUNT_ALERT', '/whatsapp', '/portal/meta-review'],
    ];
    for (const [code] of cases) {
        service.enqueueAlert({ tenantId: 1, code, sourceId: `source-${code}` });
    }
    await service.dispatchDue();

    for (const [code, adminUrl, tenantUrl] of cases) {
        const tagPrefix = `wa-alert-${code.toLowerCase()}-`;
        const calls = provider.calls.filter(call => call.payload.tag.startsWith(tagPrefix));
        assert.equal(calls.length, 2);
        assert.equal(
            calls.find(call => call.subscription.endpoint.endsWith('/admin')).payload.url,
            adminUrl,
        );
        assert.equal(
            calls.find(call => call.subscription.endpoint.endsWith('/tenant-a')).payload.url,
            tenantUrl,
        );
    }
    database.close();
});

test('dispatch rechecks tenant assignment, suspension, revocation and preferences', async () => {
    const database = createDatabase();
    const provider = createProvider();
    const clock = { value: Date.UTC(2027, 0, 1) };
    const service = buildService({ database, provider, clock });
    await service.registerSubscription({ user: sessionFor(1, clock.value), subscription: subscriptionFor('tenant-a') });

    service.enqueueMessage({ tenantId: 1, channel: 'sms', sourceId: 'sms-1' });
    database.prepare("UPDATE tenants SET status = 'Suspended' WHERE id = 1").run();
    assert.equal((await service.dispatchDue()).results[0].status, 'skipped');
    assert.equal(provider.calls.length, 0);

    database.prepare("UPDATE tenants SET status = 'Active' WHERE id = 1").run();
    service.enqueueMessage({ tenantId: 1, channel: 'sms', sourceId: 'sms-2' });
    database.prepare('UPDATE users SET tenant_id = 2 WHERE id = 1').run();
    assert.equal((await service.dispatchDue()).results[0].status, 'skipped');

    database.prepare('UPDATE users SET tenant_id = 1 WHERE id = 1').run();
    service.updatePreferences(1, { messages_enabled: false });
    const noPreferenceRecipient = service.enqueueMessage({
        tenantId: 1,
        channel: 'sms',
        sourceId: 'sms-3',
    });
    assert.equal(noPreferenceRecipient.status, 'no_recipients');

    service.updatePreferences(1, { messages_enabled: true });
    database.prepare(`
        INSERT INTO revoked_tokens (jti, user_id, expires_at)
        VALUES ('session-1', 1, '2027-01-02T00:00:00.000Z')
    `).run();
    const revoked = service.enqueueMessage({ tenantId: 1, channel: 'sms', sourceId: 'sms-4' });
    assert.equal(revoked.status, 'no_recipients');

    database.prepare("DELETE FROM revoked_tokens WHERE jti = 'session-1'").run();
    service.enqueueAlert({ tenantId: 1, code: 'ACCOUNT_QUALITY', sourceId: 'quality-1' });
    const issuedAt = sessionFor(1, clock.value).iat;
    database.prepare('UPDATE users SET tokens_revoked_at = ? WHERE id = 1')
        .run(new Date((issuedAt + 1) * 1000).toISOString());
    const revokeAllResult = await service.dispatchDue();
    assert.equal(revokeAllResult.results[0].status, 'skipped');
    assert.equal(provider.calls.length, 0);
    database.close();
});

test('same-second auth generation rotation blocks stale push seeding and dispatch', async () => {
    const database = createDatabase();
    const provider = createProvider();
    const clock = { value: Date.UTC(2027, 0, 1) };
    const issuedAt = Math.trunc(clock.value / 1000);
    const service = buildService({ database, provider, clock });
    const staleSession = sessionFor(1, clock.value, {
        iat: issuedAt,
        auth_version: 0,
    });
    await service.registerSubscription({
        user: staleSession,
        subscription: subscriptionFor('same-second-reset'),
    });

    const queuedBeforeReset = service.enqueueMessage({
        tenantId: 1,
        channel: 'sms',
        sourceId: 'same-second-before-reset',
    });
    assert.equal(queuedBeforeReset.deliveries, 1);

    database.prepare(`
        UPDATE users
        SET auth_version = auth_version + 1,
            tokens_revoked_at = ?
        WHERE id = 1
    `).run(new Date(issuedAt * 1000).toISOString());

    const dispatched = await service.dispatchDue();
    assert.equal(dispatched.results[0].status, 'skipped');
    assert.equal(provider.calls.length, 0);

    const queuedAfterReset = service.enqueueMessage({
        tenantId: 1,
        channel: 'sms',
        sourceId: 'same-second-after-reset',
    });
    assert.equal(queuedAfterReset.status, 'no_recipients');
    assert.equal(queuedAfterReset.deliveries, 0);

    await assert.rejects(
        service.registerSubscription({
            user: staleSession,
            subscription: subscriptionFor('stale-reregister'),
        }),
        error => error instanceof WebPushServiceError
            && error.code === 'PUSH_SESSION_REQUIRED',
    );
    database.close();
});

test('dispatch rechecks session authorization after asynchronous endpoint validation', async () => {
    const database = createDatabase();
    const provider = createProvider();
    const clock = { value: Date.UTC(2027, 0, 1) };
    let validations = 0;
    let validationStarted;
    let finishValidation;
    const started = new Promise(resolve => { validationStarted = resolve; });
    const endpointValidator = async endpoint => {
        validations += 1;
        if (validations === 1) return new URL(endpoint).toString();
        validationStarted();
        return new Promise(resolve => {
            finishValidation = () => resolve(new URL(endpoint).toString());
        });
    };
    const service = buildService({ database, provider, clock, endpointValidator });
    await service.registerSubscription({
        user: sessionFor(1, clock.value),
        subscription: subscriptionFor('reset-during-dispatch-validation'),
    });
    service.enqueueMessage({
        tenantId: 1,
        channel: 'sms',
        sourceId: 'reset-during-dispatch-validation',
    });

    const dispatch = service.dispatchDue();
    await started;
    database.prepare('UPDATE users SET auth_version = auth_version + 1 WHERE id = 1').run();
    finishValidation();

    const result = await dispatch;
    assert.equal(result.results[0].status, 'skipped');
    assert.equal(provider.calls.length, 0);
    assert.equal(
        database.prepare('SELECT status FROM web_push_deliveries').get().status,
        'skipped',
    );
    database.close();
});

test('transient failures retry with backoff and expired endpoints are removed', async () => {
    const database = createDatabase();
    const clock = { value: Date.UTC(2027, 0, 1) };
    let attempts = 0;
    const provider = createProvider(() => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error('temporary'), { statusCode: 503 });
        return { statusCode: 201 };
    });
    const service = buildService({ database, provider, clock });
    await service.registerSubscription({ user: sessionFor(1, clock.value), subscription: subscriptionFor('retry') });
    service.enqueueMessage({ tenantId: 1, channel: 'messenger', sourceId: 'mid-1' });

    const first = await service.dispatchDue();
    assert.equal(first.results[0].status, 'retry_scheduled');
    assert.equal(database.prepare('SELECT status FROM web_push_deliveries').get().status, 'failed');
    assert.equal((await service.dispatchDue()).attempted, 0);

    clock.value += 1_100;
    const second = await service.dispatchDue();
    assert.equal(second.results[0].status, 'delivered');
    assert.equal(database.prepare('SELECT status FROM web_push_events').get().status, 'delivered');

    const goneProvider = createProvider(() => {
        throw Object.assign(new Error('gone'), { statusCode: 410 });
    });
    const goneService = buildService({ database, provider: goneProvider, clock });
    goneService.enqueueAlert({ tenantId: 1, code: 'META_ACCOUNT_ALERT', sourceId: 'alert-1' });
    const gone = await goneService.dispatchDue();
    assert.equal(gone.results[0].status, 'subscription_removed');
    assert.equal(database.prepare('SELECT COUNT(*) count FROM web_push_subscriptions').get().count, 0);
    assert.equal(
        database.prepare('SELECT status FROM web_push_events ORDER BY id DESC LIMIT 1').get().status,
        'no_recipients',
    );
    database.close();
});

test('provider requests have a bounded deadline and timeout failures are retried', async () => {
    const database = createDatabase();
    const clock = { value: Date.UTC(2027, 0, 1) };
    const provider = createProvider(() => new Promise(() => {}));
    const service = buildService({
        database,
        provider,
        clock,
        overrides: { providerTimeoutMs: 10 },
    });
    await service.registerSubscription({
        user: sessionFor(1, clock.value),
        subscription: subscriptionFor('provider-timeout'),
    });
    service.enqueueMessage({ tenantId: 1, channel: 'sms', sourceId: 'sms-timeout' });

    const result = await service.dispatchDue();
    assert.equal(result.results[0].status, 'retry_scheduled');
    assert.equal(provider.calls[0].options.timeout, 10);
    assert.deepEqual(
        database.prepare('SELECT status, last_error FROM web_push_deliveries').get(),
        { status: 'failed', last_error: 'PUSH_PROVIDER_TIMEOUT' },
    );
    database.close();
});

test('endpoint validation shares the provider deadline and timeout remains transient', async () => {
    const database = createDatabase();
    const clock = { value: Date.UTC(2027, 0, 1) };
    const provider = createProvider();
    let validations = 0;
    let finishLateValidation;
    const endpointValidator = async endpoint => {
        validations += 1;
        if (validations === 1) return new URL(endpoint).toString();
        return new Promise(resolve => {
            finishLateValidation = () => resolve(new URL(endpoint).toString());
        });
    };
    const service = buildService({
        database,
        provider,
        clock,
        endpointValidator,
        overrides: { providerTimeoutMs: 10 },
    });
    await service.registerSubscription({
        user: sessionFor(1, clock.value),
        subscription: subscriptionFor('validator-timeout'),
    });
    service.enqueueMessage({ tenantId: 1, channel: 'sms', sourceId: 'validator-timeout' });

    const result = await service.dispatchDue();
    assert.equal(result.results[0].status, 'retry_scheduled');
    assert.equal(provider.calls.length, 0);
    assert.deepEqual(
        database.prepare('SELECT status, last_error FROM web_push_deliveries').get(),
        { status: 'failed', last_error: 'PUSH_PROVIDER_TIMEOUT' },
    );
    finishLateValidation();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(provider.calls.length, 0);
    database.close();
});

test('unsafe endpoint validation failures are permanent and never reach the provider', async () => {
    const database = createDatabase();
    const clock = { value: Date.UTC(2027, 0, 1) };
    const provider = createProvider();
    let validations = 0;
    const endpointValidator = async endpoint => {
        validations += 1;
        if (validations === 1) return new URL(endpoint).toString();
        throw new UnsafeOutboundUrlError('private target');
    };
    const service = buildService({ database, provider, clock, endpointValidator });
    await service.registerSubscription({
        user: sessionFor(1, clock.value),
        subscription: subscriptionFor('validator-unsafe'),
    });
    service.enqueueMessage({ tenantId: 1, channel: 'sms', sourceId: 'validator-unsafe' });

    const result = await service.dispatchDue();
    assert.equal(result.results[0].status, 'dead_letter');
    assert.equal(provider.calls.length, 0);
    assert.deepEqual(
        database.prepare('SELECT status, last_error FROM web_push_deliveries').get(),
        { status: 'dead_letter', last_error: 'UNSAFE_PUSH_ENDPOINT' },
    );
    database.close();
});

test('dispatches due deliveries with at most eight concurrent provider operations', async () => {
    const database = createDatabase();
    const clock = { value: Date.UTC(2027, 0, 1) };
    let inFlight = 0;
    let maximumInFlight = 0;
    const provider = createProvider(async () => {
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve, 10));
        inFlight -= 1;
        return { statusCode: 201 };
    });
    const service = buildService({ database, provider, clock });
    for (let index = 0; index < 9; index += 1) {
        await service.registerSubscription({
            user: sessionFor(1, clock.value),
            subscription: subscriptionFor(`concurrent-${index}`),
        });
    }
    const queued = service.enqueueMessage({
        tenantId: 1,
        channel: 'whatsapp',
        sourceId: 'concurrency-test',
    });
    assert.equal(queued.deliveries, 9);

    const result = await service.dispatchDue();
    assert.equal(result.attempted, 9);
    assert.equal(maximumInFlight, 8);
    assert.ok(result.results.every(item => item.status === 'delivered'));
    database.close();
});

test('Web Push provider timeout configuration has a safe bounded default', () => {
    assert.equal(webPushConfigFromEnv({ WEB_PUSH_ENABLED: 'false' }).providerTimeoutMs, 10_000);
    assert.equal(webPushConfigFromEnv({
        WEB_PUSH_ENABLED: 'false',
        WEB_PUSH_TIMEOUT_MS: '250',
    }).providerTimeoutMs, 1_000);
    assert.equal(webPushConfigFromEnv({
        WEB_PUSH_ENABLED: 'false',
        WEB_PUSH_TIMEOUT_MS: '90000',
    }).providerTimeoutMs, 60_000);
});

test('operational alert state emits only on a new firing transition', async () => {
    const database = createDatabase();
    const provider = createProvider();
    const clock = { value: Date.UTC(2027, 0, 1) };
    const service = buildService({ database, provider, clock });
    await service.registerSubscription({ user: sessionFor(3, clock.value), subscription: subscriptionFor('admin') });
    const signals = { alerts: [{ code: 'RECENT_WEBHOOK_FAILURES', severity: 'critical' }] };

    assert.equal(service.syncOperationalAlerts(signals).length, 1);
    assert.equal(service.syncOperationalAlerts(signals).length, 0);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM web_push_events').get().count, 1);
    service.syncOperationalAlerts({ alerts: [] });
    clock.value += 1_000;
    assert.equal(service.syncOperationalAlerts(signals).length, 1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM web_push_events').get().count, 2);
    database.close();
});

test('operational alert event and active state roll back atomically on insert failure', () => {
    const database = createDatabase();
    const provider = createProvider();
    const clock = { value: Date.UTC(2027, 0, 1) };
    const service = buildService({ database, provider, clock });
    database.exec(`
        CREATE TRIGGER reject_operational_push_event
        BEFORE INSERT ON web_push_events
        WHEN NEW.alert_code = 'RECENT_WEBHOOK_FAILURES'
        BEGIN
            SELECT RAISE(ABORT, 'blocked operational event');
        END;
    `);

    assert.throws(
        () => service.syncOperationalAlerts({
            alerts: [{ code: 'RECENT_WEBHOOK_FAILURES', severity: 'critical' }],
        }),
        /blocked operational event/,
    );
    assert.equal(database.prepare('SELECT COUNT(*) count FROM web_push_events').get().count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM web_push_alert_states').get().count, 0);
    database.close();
});

test('push endpoints require an allowlisted provider and a public HTTPS target', async () => {
    const allowed = await validatePushEndpoint(
        'https://fcm.googleapis.com/fcm/send/abc',
        { resolver: async endpoint => ({ url: new URL(endpoint), address: '142.250.1.1', family: 4 }) },
    );
    assert.equal(allowed, 'https://fcm.googleapis.com/fcm/send/abc');

    await assert.rejects(
        validatePushEndpoint('https://example.com/push/abc', {
            resolver: async endpoint => ({ url: new URL(endpoint), address: '93.184.216.34', family: 4 }),
        }),
        error => error instanceof WebPushServiceError
            && error.code === 'PUSH_PROVIDER_NOT_ALLOWED',
    );
    await assert.rejects(
        validatePushEndpoint('http://fcm.googleapis.com/fcm/send/abc', {
            resolver: async endpoint => ({ url: new URL(endpoint), address: '142.250.1.1', family: 4 }),
        }),
        error => error instanceof WebPushServiceError && error.code === 'UNSAFE_PUSH_ENDPOINT',
    );
    await assert.rejects(
        validatePushEndpoint('https://fcm.googleapis.com/fcm/send/abc', {
            resolver: async () => { throw new UnsafeOutboundUrlError('private'); },
        }),
        error => error instanceof WebPushServiceError && error.code === 'UNSAFE_PUSH_ENDPOINT',
    );
});
