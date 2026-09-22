import assert from 'node:assert/strict';
import test from 'node:test';

import { createTenantSmsGatewayRouter } from '../routes/tenantSmsGateway.js';
import { SmsGatewayError } from '../services/smsGateway.js';

const findHandlers = (router, method, path) => {
    const layer = router.stack.find(item => item.route?.path === path && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method} ${path}`);
    return layer.route.stack.map(item => item.handle);
};

const invoke = (router, method, path, request = {}) => new Promise((resolve, reject) => {
    const req = {
        user: { tenant_id: 7 },
        body: {},
        params: {},
        query: {},
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

const createBilling = () => {
    const calls = { reserves: [], commits: [], releases: [] };
    return {
        calls,
        operations: { SMS_TEXT: 'sms.text', SMS_USSD: 'sms.ussd' },
        reserve(options) {
            calls.reserves.push(options);
            return { id: calls.reserves.length };
        },
        commit(reservation, options) { calls.commits.push({ reservation, options }); },
        release(reservation, reason) { calls.releases.push({ reservation, reason }); },
        handleError: () => false,
    };
};

test('tenant SMS account listing uses only the authenticated tenant', async () => {
    const tenantIds = [];
    const service = {
        listAccounts(tenantId) {
            tenantIds.push(tenantId);
            return [{ id: 91, tenant_id: tenantId, name: 'Gateway' }];
        },
        presentAccount(account) { return { id: account.id, name: account.name }; },
    };
    const router = createTenantSmsGatewayRouter({ service, billing: createBilling() });
    const response = await invoke(router, 'get', '/');

    assert.equal(response.statusCode, 200);
    assert.deepEqual(tenantIds, [7]);
    assert.deepEqual(response.body.data, [{ id: 91, name: 'Gateway' }]);
});

test('tenant SMS router does not expose a device inventory endpoint', () => {
    const router = createTenantSmsGatewayRouter({ service: {}, billing: createBilling() });
    const exposed = router.stack.some(item => (
        item.route?.path === '/:accountId/devices' && item.route.methods?.get
    ));

    assert.equal(exposed, false);
});

test('SMS statistics stay tenant-scoped and preserve dashboard filters', async () => {
    const calls = [];
    const service = {
        async stats(tenantId, options) {
            calls.push({ tenantId, options });
            return {
                range: { key: '30d', from: '2026-08-22', to: '2026-09-20' },
                summary: { delivered: 14 },
                accounts: [],
                partial: false,
            };
        },
    };
    const router = createTenantSmsGatewayRouter({ service, billing: createBilling() });
    const response = await invoke(router, 'get', '/stats', {
        query: {
            account_id: '91',
            range: 'custom',
            from: '2026-08-22',
            to: '2026-09-20',
            group_by: 'day',
        },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(calls, [{
        tenantId: 7,
        options: {
            accountId: '91',
            range: 'custom',
            from: '2026-08-22',
            to: '2026-09-20',
            groupBy: 'day',
        },
    }]);
    assert.equal(response.body.data.summary.delivered, 14);
});

test('SMS test sends settle billing on acceptance and release it on rejection', async () => {
    const billing = createBilling();
    let shouldFail = false;
    const service = {
        requireActiveAccount() { return { id: 91, tenant_id: 7, status: 'active' }; },
        async send(tenantId, input) {
            assert.equal(tenantId, 7);
            assert.equal(input.accountId, '91');
            assert.equal(input.idempotencyKey, shouldFail ? 'wa-test-request-0002' : 'wa-test-request-0001');
            if (shouldFail) throw new SmsGatewayError('Gateway unavailable', 502, 'SMS_GATEWAY_UNAVAILABLE');
            return {
                account: { id: 91, tenant_id: tenantId },
                message: { message_id: 'gateway-message-1', recipient: input.recipient },
            };
        },
        storeMessage(account, message) {
            return { sms_account_id: account.id, gateway_message_id: message.message_id };
        },
        presentMessage(message) { return message; },
    };
    const router = createTenantSmsGatewayRouter({ service, billing });
    const accepted = await invoke(router, 'post', '/:accountId/test', {
        params: { accountId: '91' },
        headers: { 'idempotency-key': 'wa-test-request-0001' },
        body: { recipient: '218910000001', message: 'test' },
    });

    assert.equal(accepted.statusCode, 202);
    assert.equal(billing.calls.reserves[0].operationKey, 'sms.text');
    assert.equal(
        billing.calls.reserves[0].idempotencyKey,
        'billing:7:wa-test-request-0001',
    );
    assert.equal(billing.calls.commits[0].options.referenceId, 'gateway-message-1');
    assert.equal(billing.calls.releases.length, 0);

    shouldFail = true;
    const rejected = await invoke(router, 'post', '/:accountId/test', {
        params: { accountId: '91' },
        headers: { 'idempotency-key': 'wa-test-request-0002' },
        body: { recipient: '218910000001', message: 'test' },
    });
    assert.equal(rejected.statusCode, 502);
    assert.equal(rejected.body.code, 'SMS_GATEWAY_UNAVAILABLE');
    assert.equal(billing.calls.releases.length, 1);
});

test('SMS test preserves the caller idempotency key when delivery is uncertain', async () => {
    const billing = createBilling();
    const attempts = [];
    const service = {
        requireActiveAccount() { return { id: 91, tenant_id: 7, status: 'active' }; },
        async send(_tenantId, input) {
            attempts.push(input.idempotencyKey);
            const error = new SmsGatewayError('Gateway timeout', 502, 'SMS_GATEWAY_UNAVAILABLE');
            error.deliveryUncertain = true;
            throw error;
        },
    };
    const router = createTenantSmsGatewayRouter({ service, billing });
    const requestKey = ['wa', 'test', 'uncertain', '0001'].join('-');
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await invoke(router, 'post', '/:accountId/test', {
            params: { accountId: '91' },
            headers: { 'idempotency-key': requestKey },
            body: { recipient: '218910000001', message: 'test' },
        });
        assert.equal(response.statusCode, 502);
        assert.equal(response.body.retry_same_request, true);
    }
    assert.deepEqual(attempts, [requestKey, requestKey]);
    assert.equal(billing.calls.releases.length, 0);
    assert.equal(
        billing.calls.reserves[0].idempotencyKey,
        billing.calls.reserves[1].idempotencyKey,
    );
});

test('SMS retry checks account health before reusing an uncertain billing reservation', async () => {
    const billing = createBilling();
    let healthChecks = 0;
    let sends = 0;
    const service = {
        requireActiveAccount() {
            healthChecks += 1;
            if (healthChecks > 1) {
                throw new SmsGatewayError(
                    'حساب SMS ليس في حالة تشغيل',
                    503,
                    'SMS_ACCOUNT_INACTIVE',
                );
            }
            return { id: 91, tenant_id: 7, status: 'active' };
        },
        async send() {
            sends += 1;
            const error = new SmsGatewayError('Gateway timeout', 502, 'SMS_GATEWAY_UNAVAILABLE');
            error.deliveryUncertain = true;
            throw error;
        },
    };
    const router = createTenantSmsGatewayRouter({ service, billing });
    const request = {
        params: { accountId: '91' },
        headers: { 'idempotency-key': 'wa-test-inactive-retry-0001' },
        body: { recipient: '218910000001', message: 'test' },
    };

    const uncertain = await invoke(router, 'post', '/:accountId/test', request);
    assert.equal(uncertain.statusCode, 502);
    assert.equal(uncertain.body.retry_same_request, true);

    const inactive = await invoke(router, 'post', '/:accountId/test', request);
    assert.equal(inactive.statusCode, 503);
    assert.equal(inactive.body.code, 'SMS_ACCOUNT_INACTIVE');
    assert.equal(healthChecks, 2);
    assert.equal(sends, 1);
    assert.equal(billing.calls.reserves.length, 1);
    assert.equal(billing.calls.releases.length, 0);
});

test('SMS test does not release billing after Gateway acceptance when local commit fails', async () => {
    const billing = createBilling();
    billing.commit = () => { throw new Error('local billing commit unavailable'); };
    const service = {
        requireActiveAccount() { return { id: 91, tenant_id: 7, status: 'active' }; },
        async send(_tenantId, input) {
            return {
                account: { id: 91, tenant_id: 7 },
                message: {
                    message_id: 'gateway-post-accept-1',
                    external_id: input.idempotencyKey,
                    recipient: input.recipient,
                },
            };
        },
    };
    const router = createTenantSmsGatewayRouter({ service, billing });
    const response = await invoke(router, 'post', '/:accountId/test', {
        params: { accountId: '91' },
        headers: { 'idempotency-key': 'wa-test-post-accept-0001' },
        body: { recipient: '218910000001', message: 'test' },
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, 'SMS_POST_ACCEPT_RECOVERY_REQUIRED');
    assert.equal(response.body.retry_same_request, true);
    assert.equal(billing.calls.releases.length, 0);
});

test('USSD history and execution remain tenant-scoped and settle billing once', async () => {
    const billing = createBilling();
    let shouldFail = false;
    const tenantIds = [];
    const service = {
        requireActiveAccount() { return { id: 91, tenant_id: 7, status: 'active' }; },
        listUssd(tenantId, options) {
            tenantIds.push(tenantId);
            assert.deepEqual(options, { accountId: '91', limit: '25' });
            return [{ id: 1, tenant_id: tenantId, sms_account_id: 91, request_code: '*100#' }];
        },
        async sendUssd(tenantId, input) {
            assert.equal(tenantId, 7);
            assert.equal(input.accountId, '91');
            assert.equal(input.deviceId, undefined);
            assert.equal(input.simSlot, undefined);
            assert.match(input.idempotencyKey, /^wa-ussd-request-000[12]$/);
            if (shouldFail) throw new SmsGatewayError('Gateway unavailable', 502, 'SMS_GATEWAY_UNAVAILABLE');
            return {
                account: { id: 91, tenant_id: tenantId },
                ussd: {
                    ussd_id: 'gateway-ussd-1',
                    external_id: input.idempotencyKey,
                    request: input.request,
                },
            };
        },
        storeUssd(account, ussd) {
            return { sms_account_id: account.id, gateway_ussd_id: ussd.ussd_id, status: 'pending' };
        },
        presentUssd(request) { return request; },
    };
    const router = createTenantSmsGatewayRouter({ service, billing });
    const history = await invoke(router, 'get', '/ussd', {
        query: { account_id: '91', limit: '25' },
    });

    assert.equal(history.statusCode, 200);
    assert.deepEqual(tenantIds, [7]);
    assert.equal(history.body.data[0].tenant_id, 7);

    const accepted = await invoke(router, 'post', '/:accountId/ussd', {
        params: { accountId: '91' },
        headers: { 'idempotency-key': 'wa-ussd-request-0001' },
        body: { request: '*100#', device_id: '301', sim_slot: 0 },
    });

    assert.equal(accepted.statusCode, 202);
    assert.equal(billing.calls.reserves[0].operationKey, 'sms.ussd');
    assert.equal(
        billing.calls.reserves[0].idempotencyKey,
        'billing:7:sms-ussd:91:wa-ussd-request-0001',
    );
    assert.equal(billing.calls.commits[0].options.referenceId, 'gateway-ussd-1');
    assert.equal(accepted.body.data.status, 'pending');
    assert.equal(billing.calls.releases.length, 0);

    shouldFail = true;
    const rejected = await invoke(router, 'post', '/:accountId/ussd', {
        params: { accountId: '91' },
        headers: { 'idempotency-key': 'wa-ussd-request-0002' },
        body: { request: '*100#', device_id: '301' },
    });
    assert.equal(rejected.statusCode, 502);
    assert.equal(rejected.body.code, 'SMS_GATEWAY_UNAVAILABLE');
    assert.equal(billing.calls.releases.length, 1);
});

test('tenant SMS errors do not expose routing details or hardware-specific codes', async () => {
    const service = {
        requireActiveAccount() { return { id: 91, tenant_id: 7, status: 'active' }; },
        async sendUssd() {
            throw new SmsGatewayError(
                'Android device 301 cannot use SIM slot 0',
                422,
                'INVALID_USSD_DEVICE',
            );
        },
    };
    const router = createTenantSmsGatewayRouter({ service, billing: createBilling() });
    const response = await invoke(router, 'post', '/:accountId/ussd', {
        params: { accountId: '91' },
        headers: { 'idempotency-key': 'wa-ussd-private-error-0001' },
        body: { request: '*100#', device_id: '301', sim_slot: 0 },
    });

    assert.equal(response.statusCode, 422);
    assert.equal(response.body.code, 'USSD_EXECUTION_FAILED');
    assert.doesNotMatch(response.body.error, /android|device|sim|phone|model/i);
});

test('USSD preserves the request after acceptance when local storage fails', async () => {
    const billing = createBilling();
    const service = {
        requireActiveAccount() { return { id: 91, tenant_id: 7, status: 'active' }; },
        async sendUssd(_tenantId, input) {
            return {
                account: { id: 91, tenant_id: 7 },
                ussd: {
                    ussd_id: 'gateway-post-accept-ussd-1',
                    external_id: input.idempotencyKey,
                    request: input.request,
                    device_id: '301',
                },
            };
        },
        storeUssd() { throw new Error('local USSD store unavailable'); },
        presentUssd(request) { return request; },
    };
    const router = createTenantSmsGatewayRouter({ service, billing });
    const response = await invoke(router, 'post', '/:accountId/ussd', {
        params: { accountId: '91' },
        headers: { 'idempotency-key': 'wa-ussd-post-accept-0001' },
        body: { request: '*100#', device_id: '301' },
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, 'SMS_POST_ACCEPT_RECOVERY_REQUIRED');
    assert.equal(response.body.retry_same_request, true);
    assert.equal(billing.calls.commits.length, 1);
    assert.equal(billing.calls.releases.length, 0);
});
