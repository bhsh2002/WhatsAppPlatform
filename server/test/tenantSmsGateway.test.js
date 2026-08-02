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

test('SMS test sends settle billing on acceptance and release it on rejection', async () => {
    const billing = createBilling();
    let shouldFail = false;
    const service = {
        async send(tenantId, input) {
            assert.equal(tenantId, 7);
            assert.equal(input.accountId, '91');
            if (shouldFail) throw new SmsGatewayError('Gateway unavailable', 502, 'SMS_GATEWAY_UNAVAILABLE');
            return {
                account: { id: 91, tenant_id: tenantId },
                message: { message_id: 'gateway-message-1', recipient: input.recipient },
            };
        },
        storeMessage(account, message) {
            return { sms_account_id: account.id, gateway_message_id: message.message_id };
        },
    };
    const router = createTenantSmsGatewayRouter({ service, billing });
    const accepted = await invoke(router, 'post', '/:accountId/test', {
        params: { accountId: '91' },
        body: { recipient: '218910000001', message: 'test' },
    });

    assert.equal(accepted.statusCode, 202);
    assert.equal(billing.calls.reserves[0].operationKey, 'sms.text');
    assert.equal(billing.calls.commits[0].options.referenceId, 'gateway-message-1');
    assert.equal(billing.calls.releases.length, 0);

    shouldFail = true;
    const rejected = await invoke(router, 'post', '/:accountId/test', {
        params: { accountId: '91' },
        body: { recipient: '218910000001', message: 'test' },
    });
    assert.equal(rejected.statusCode, 502);
    assert.equal(rejected.body.code, 'SMS_GATEWAY_UNAVAILABLE');
    assert.equal(billing.calls.releases.length, 1);
});

test('USSD history and execution remain tenant-scoped and settle billing once', async () => {
    const billing = createBilling();
    let shouldFail = false;
    const tenantIds = [];
    const service = {
        listUssd(tenantId, options) {
            tenantIds.push(tenantId);
            assert.deepEqual(options, { accountId: '91', limit: '25' });
            return [{ id: 1, tenant_id: tenantId, sms_account_id: 91, request_code: '*100#' }];
        },
        async sendUssd(tenantId, input) {
            assert.equal(tenantId, 7);
            assert.equal(input.accountId, '91');
            assert.match(input.idempotencyKey, /^wa-ussd-request-000[12]$/);
            if (shouldFail) throw new SmsGatewayError('Gateway unavailable', 502, 'SMS_GATEWAY_UNAVAILABLE');
            return {
                account: { id: 91, tenant_id: tenantId },
                ussd: {
                    ussd_id: 'gateway-ussd-1',
                    external_id: input.idempotencyKey,
                    request: input.request,
                    device_id: input.deviceId,
                },
            };
        },
        storeUssd(account, ussd) {
            return { sms_account_id: account.id, gateway_ussd_id: ussd.ussd_id, status: 'pending' };
        },
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
