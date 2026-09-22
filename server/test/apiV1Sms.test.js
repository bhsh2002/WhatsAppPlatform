import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { createApiV1SmsRouter } from '../routes/api/v1Sms.js';
import { SmsGatewayError } from '../services/smsGateway.js';

const createDatabase = () => {
    const database = new Database(':memory:');
    database.exec(`
        CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
        CREATE TABLE sms_gateway_accounts (id INTEGER PRIMARY KEY, tenant_id INTEGER, name TEXT);
        CREATE TABLE sms_messages (
            id INTEGER PRIMARY KEY, tenant_id INTEGER, sms_account_id INTEGER,
            gateway_message_id TEXT, external_id TEXT, direction TEXT, sender TEXT,
            recipient TEXT, content TEXT, status TEXT, result_code TEXT,
            error_code TEXT, error_message TEXT, sent_at TEXT, delivered_at TEXT,
            created_at TEXT, updated_at TEXT
        );
        CREATE TABLE activity_logs (
            id INTEGER PRIMARY KEY, tenant_id INTEGER, tenant_name TEXT,
            event_type TEXT, description TEXT, status TEXT
        );
        CREATE TABLE billing_usage_events (
            id INTEGER PRIMARY KEY, tenant_id INTEGER, status TEXT, idempotency_key TEXT
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
        INSERT INTO tenants VALUES (1, 'Tenant A', 'Active');
        INSERT INTO tenants VALUES (2, 'Suspended tenant', 'Suspended');
        INSERT INTO tenants VALUES (3, 'Tenant B', 'Active');
    `);
    return database;
};

const findHandlers = (router, method, path) => {
    const layer = router.stack.find(item => item.route?.path === path && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method.toUpperCase()} ${path}`);
    return layer.route.stack.map(item => item.handle);
};

const invoke = (router, method, path, request = {}) => new Promise((resolve, reject) => {
    const req = {
        tenantId: 1,
        body: {},
        params: {},
        headers: {},
        get(name) { return this.headers[String(name).toLowerCase()] || null; },
        ...request,
    };
    const res = {
        statusCode: 200,
        body: undefined,
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; resolve(this); return this; },
    };
    const handlers = findHandlers(router, method, path);
    let index = 0;
    const next = error => {
        if (error) return reject(error);
        if (index >= handlers.length) return resolve(res);
        return Promise.resolve(handlers[index++](req, res, next)).catch(reject);
    };
    next();
});

const createBilling = database => {
    const calls = { reserve: [], commit: [], release: [] };
    return {
        calls,
        operations: { SMS_TEXT: 'sms.text' },
        reserve(input) {
            calls.reserve.push(input);
            const id = calls.reserve.length;
            database.prepare(`
                INSERT INTO billing_usage_events (id, tenant_id, status, idempotency_key)
                VALUES (?, ?, 'reserved', ?)
            `).run(id, input.tenantId, input.idempotencyKey);
            return { id, tenant_id: input.tenantId, status: 'reserved' };
        },
        commit(reservation, input) {
            calls.commit.push({ reservation, input });
            database.prepare("UPDATE billing_usage_events SET status = 'committed' WHERE id = ?")
                .run(reservation.id);
        },
        release(reservation, error) {
            calls.release.push({ reservation, error });
            database.prepare("UPDATE billing_usage_events SET status = 'released' WHERE id = ?")
                .run(reservation.id);
        },
        handleError: () => false,
    };
};

test('WA API sends SMS through a logical account without exposing routing controls', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const billing = createBilling(database);
    const sends = [];
    const callbacks = [];
    let accountAvailable = true;
    const service = {
        listAccounts: () => [{ id: 9, name: 'Managed SMS' }],
        presentAccount: account => ({ ...account, status: 'active', enabled: true, is_default: true }),
        getAccount: () => ({ id: 9, tenant_id: 1, management_mode: 'managed' }),
        presentMessage(message, { account }) {
            return {
                ...message,
                error_message: account.management_mode === 'managed' && message.error_message
                    ? 'تعذر تنفيذ الرسالة عبر خدمة SMS المُدارة'
                    : message.error_message,
            };
        },
        requireActiveAccount: (_tenantId, accountId) => {
            if (!accountAvailable) {
                throw new SmsGatewayError('Account disabled', 409, 'SMS_ACCOUNT_DISABLED');
            }
            return {
                id: accountId || 9,
                tenant_id: 1,
                status: 'active',
                enabled: 1,
            };
        },
        async send(tenantId, input) {
            sends.push({ tenantId, input });
            return {
                account: { id: 9, tenant_id: tenantId },
                message: {
                    message_id: 'gw-100', external_id: input.idempotencyKey,
                    recipient: input.recipient, message: input.message, status: 'queued',
                },
            };
        },
        storeMessage(account, message) {
            return {
                id: 101,
                gateway_message_id: message.message_id,
                external_id: message.external_id,
                sms_account_id: account.id,
                sms_account_name: 'Managed SMS',
                recipient: message.recipient,
                status: message.status,
            };
        },
    };
    const router = createApiV1SmsRouter({
        database,
        service,
        billing,
        callbackSender: async (...args) => callbacks.push(args),
        logger: { error() {} },
    });

    const missingKey = await invoke(router, 'post', '/sms/messages', {
        body: { recipient: '218910000001', message: 'Hello' },
    });
    assert.equal(missingKey.statusCode, 400);
    assert.equal(missingKey.body.code, 'INVALID_IDEMPOTENCY_KEY');
    assert.equal(billing.calls.reserve.length, 0);

    const accepted = await invoke(router, 'post', '/sms/messages', {
        headers: { 'idempotency-key': 'customer-request-0001' },
        body: {
            recipient: '+218910000001',
            message: 'Hello by SMS',
            sms_account_id: 9,
            devices: ['must-not-pass'],
            sim_slot: 4,
        },
    });
    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.body.data.message_id, 101);
    assert.equal(accepted.body.data.gateway_message_id, 'gw-100');
    assert.deepEqual(sends[0], {
        tenantId: 1,
        input: {
            accountId: 9,
            recipient: '+218910000001',
            message: 'Hello by SMS',
            idempotencyKey: 'customer-request-0001',
        },
    });
    assert.equal(billing.calls.reserve[0].operationKey, 'sms.text');
    assert.equal(billing.calls.commit.length, 1);
    assert.equal(billing.calls.release.length, 0);
    assert.equal(callbacks[0][1], 'sms_message_accepted');

    accountAvailable = false;
    const duplicate = await invoke(router, 'post', '/sms/messages', {
        headers: { 'idempotency-key': 'customer-request-0001' },
        body: {
            recipient: '+218910000001',
            message: 'Hello by SMS',
            sms_account_id: 9,
        },
    });
    assert.equal(duplicate.statusCode, 202);
    assert.deepEqual(duplicate.body, accepted.body);
    assert.equal(sends.length, 1);
    assert.equal(billing.calls.reserve.length, 1);

    const conflict = await invoke(router, 'post', '/sms/messages', {
        headers: { 'idempotency-key': 'customer-request-0001' },
        body: {
            recipient: '+218910000001',
            message: 'Different body',
            sms_account_id: 9,
        },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.code, 'SMS_IDEMPOTENCY_CONFLICT');
    accountAvailable = true;

    const accounts = await invoke(router, 'get', '/sms/accounts');
    assert.deepEqual(accounts.body.data, [{
        id: 9,
        name: 'Managed SMS',
        status: 'active',
        enabled: true,
        is_default: true,
    }]);

    database.prepare(`
        INSERT INTO sms_gateway_accounts (id, tenant_id, name) VALUES (9, 1, 'Managed SMS')
    `).run();
    database.prepare(`
        INSERT INTO sms_messages (
            id, tenant_id, sms_account_id, gateway_message_id, direction,
            recipient, content, status, error_message, created_at, updated_at
        ) VALUES (
            101, 1, 9, 'gw-100', 'outgoing', '218910000001',
            'Hello by SMS', 'delivered', 'private gateway failure detail',
            '2026-09-20T10:00:00Z', '2026-09-20T10:01:00Z'
        )
    `).run();
    const status = await invoke(router, 'get', '/sms/messages/:messageId', {
        params: { messageId: '101' },
    });
    assert.equal(status.body.data.status, 'delivered');
    assert.equal(status.body.data.sms_account_name, 'Managed SMS');
    assert.equal(status.body.data.error_message, 'تعذر تنفيذ الرسالة عبر خدمة SMS المُدارة');
    const crossTenant = await invoke(router, 'get', '/sms/messages/:messageId', {
        tenantId: 3,
        params: { messageId: '101' },
    });
    assert.equal(crossTenant.statusCode, 404);
});

test('WA SMS API releases billing when the Gateway rejects before acceptance', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const billing = createBilling(database);
    let attempts = 0;
    const service = {
        requireActiveAccount: () => ({ id: 9, tenant_id: 1, status: 'active', enabled: 1 }),
        async send(_tenantId, input) {
            attempts += 1;
            if (attempts === 1) {
                throw new SmsGatewayError('Gateway offline', 502, 'SMS_GATEWAY_UNAVAILABLE');
            }
            return {
                account: { id: 9, tenant_id: 1 },
                message: {
                    message_id: 'gateway-retry-1',
                    external_id: input.idempotencyKey,
                    recipient: input.recipient,
                    status: 'queued',
                },
            };
        },
        storeMessage(account, message) {
            return {
                id: 202,
                sms_account_id: account.id,
                sms_account_name: 'Managed SMS',
                gateway_message_id: message.message_id,
                external_id: message.external_id,
                recipient: message.recipient,
                status: message.status,
            };
        },
    };
    const router = createApiV1SmsRouter({
        database,
        service,
        billing,
        logger: { error() {} },
    });
    const response = await invoke(router, 'post', '/sms/messages', {
        headers: { 'idempotency-key': 'customer-request-0002' },
        body: { recipient: '218910000001', message: 'Hello' },
    });
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.code, 'SMS_GATEWAY_UNAVAILABLE');
    assert.equal(billing.calls.commit.length, 0);
    assert.equal(billing.calls.release.length, 1);

    const retried = await invoke(router, 'post', '/sms/messages', {
        headers: { 'idempotency-key': 'customer-request-0002' },
        body: { recipient: '218910000001', message: 'Hello' },
    });
    assert.equal(retried.statusCode, 202);
    assert.equal(retried.body.data.message_id, 202);
    assert.equal(billing.calls.reserve.length, 2);
    assert.equal(
        billing.calls.reserve[0].idempotencyKey,
        'billing:1:api-sms:customer-request-0002:attempt:1',
    );
    assert.equal(
        billing.calls.reserve[1].idempotencyKey,
        'billing:1:api-sms:customer-request-0002:attempt:2',
    );
    assert.equal(billing.calls.commit.length, 1);
});

test('WA SMS API retains an uncertain reservation and reuses it on recovery', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const billing = createBilling(database);
    let attempts = 0;
    const service = {
        requireActiveAccount: () => ({ id: 9, tenant_id: 1, status: 'active', enabled: 1 }),
        async send(_tenantId, input) {
            attempts += 1;
            if (attempts === 1) {
                const error = new SmsGatewayError(
                    'Gateway response was lost',
                    502,
                    'SMS_GATEWAY_UNAVAILABLE',
                );
                error.deliveryUncertain = true;
                throw error;
            }
            return {
                account: { id: 9, tenant_id: 1 },
                message: {
                    message_id: 'gateway-uncertain-1',
                    external_id: input.idempotencyKey,
                    recipient: input.recipient,
                    status: 'queued',
                },
            };
        },
        storeMessage(account, message) {
            return {
                id: 303,
                sms_account_id: account.id,
                sms_account_name: 'Managed SMS',
                gateway_message_id: message.message_id,
                external_id: message.external_id,
                recipient: message.recipient,
                status: message.status,
            };
        },
    };
    const router = createApiV1SmsRouter({
        database,
        service,
        billing,
        logger: { error() {} },
    });
    const request = {
        headers: { 'idempotency-key': 'customer-request-uncertain-1' },
        body: { recipient: '218910000001', message: 'Hello' },
    };

    const uncertain = await invoke(router, 'post', '/sms/messages', request);
    assert.equal(uncertain.statusCode, 502);
    assert.equal(billing.calls.release.length, 0);
    assert.equal(database.prepare('SELECT status FROM billing_usage_events WHERE id = 1').get().status, 'reserved');

    const recovered = await invoke(router, 'post', '/sms/messages', request);
    assert.equal(recovered.statusCode, 202);
    assert.equal(billing.calls.reserve.length, 1);
    assert.equal(billing.calls.commit.length, 1);
    assert.equal(database.prepare('SELECT status FROM billing_usage_events WHERE id = 1').get().status, 'committed');
});

test('WA SMS API keeps the same request recoverable after a post-accept commit failure', async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const billing = createBilling(database);
    const originalCommit = billing.commit;
    let failCommit = true;
    billing.commit = (...args) => {
        if (failCommit) {
            failCommit = false;
            throw new Error('local commit unavailable');
        }
        return originalCommit(...args);
    };
    const sends = [];
    const service = {
        requireActiveAccount: () => ({ id: 9, tenant_id: 1, status: 'active', enabled: 1 }),
        async send(_tenantId, input) {
            sends.push(input.idempotencyKey);
            return {
                account: { id: 9, tenant_id: 1 },
                message: {
                    message_id: 'gateway-post-accept-1',
                    external_id: input.idempotencyKey,
                    recipient: input.recipient,
                    status: 'queued',
                },
            };
        },
        storeMessage(account, message) {
            return {
                id: 404,
                sms_account_id: account.id,
                sms_account_name: 'Managed SMS',
                gateway_message_id: message.message_id,
                external_id: message.external_id,
                recipient: message.recipient,
                status: message.status,
            };
        },
    };
    const router = createApiV1SmsRouter({
        database,
        service,
        billing,
        logger: { error() {} },
    });
    const request = {
        headers: { 'idempotency-key': 'customer-post-accept-0001' },
        body: { recipient: '218910000001', message: 'Hello' },
    };

    const incomplete = await invoke(router, 'post', '/sms/messages', request);
    assert.equal(incomplete.statusCode, 503);
    assert.equal(incomplete.body.code, 'SMS_POST_ACCEPT_RECOVERY_REQUIRED');
    assert.equal(incomplete.body.retry_same_request, true);
    assert.equal(billing.calls.release.length, 0);

    const recovered = await invoke(router, 'post', '/sms/messages', request);
    assert.equal(recovered.statusCode, 202);
    assert.deepEqual(sends, ['customer-post-accept-0001', 'customer-post-accept-0001']);
    assert.equal(billing.calls.reserve.length, 1);
    assert.equal(billing.calls.release.length, 0);
});
