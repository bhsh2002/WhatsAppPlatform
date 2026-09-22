import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { createSmsGatewayProvisioningRouter } from '../routes/smsGatewayProvisioning.js';

const findHandler = router => {
    const layer = router.stack.find(item => item.route?.path === '/' && item.route.methods?.post);
    assert.ok(layer, 'Missing POST /');
    return layer.route.stack[0].handle;
};

const invoke = (router, { body, rawBody, headers = {} }) => new Promise((resolve, reject) => {
    const req = {
        body,
        rawBody,
        get(name) { return headers[String(name).toLowerCase()] || null; },
    };
    const res = {
        statusCode: 200,
        body: undefined,
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; resolve(this); return this; },
    };
    Promise.resolve(findHandler(router)(req, res)).catch(reject);
});

test('managed SMS provisioning requires a fresh valid raw-body signature', async () => {
    const secret = 'p'.repeat(48);
    const now = 1_790_000_000_000;
    const timestamp = String(Math.floor(now / 1000));
    const body = {
        action: 'upsert',
        assignment_id: 'assignment-0001',
        tenant_email: 'owner@example.test',
        account: { name: 'SMS' },
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const deliveryId = 'delivery-0001';
    const signature = `v1=${crypto.createHmac('sha256', secret)
        .update(`${timestamp}.${deliveryId}.`)
        .update(rawBody)
        .digest('hex')}`;
    const calls = [];
    const router = createSmsGatewayProvisioningRouter({
        secret,
        now: () => now,
        service: {
            async acceptProvisioningDelivery(input) {
                calls.push(input);
                return { success: true, assignment_id: body.assignment_id };
            },
        },
    });

    const accepted = await invoke(router, {
        body,
        rawBody,
        headers: {
            'x-savana-timestamp': timestamp,
            'x-savana-signature': signature,
            'x-savana-delivery-id': deliveryId,
        },
    });
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.body.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].deliveryId, 'delivery-0001');
    assert.equal(calls[0].requestHash, crypto.createHash('sha256').update(rawBody).digest('hex'));

    const mutatedDelivery = await invoke(router, {
        body,
        rawBody,
        headers: {
            'x-savana-timestamp': timestamp,
            'x-savana-signature': signature,
            'x-savana-delivery-id': 'delivery-mutated-0002',
        },
    });
    assert.equal(mutatedDelivery.statusCode, 401);
    assert.equal(mutatedDelivery.body.code, 'SMS_PROVISION_SIGNATURE_INVALID');
    assert.equal(calls.length, 1);

    const invalid = await invoke(router, {
        body,
        rawBody,
        headers: {
            'x-savana-timestamp': timestamp,
            'x-savana-signature': `v1=${'0'.repeat(64)}`,
            'x-savana-delivery-id': 'delivery-0002',
        },
    });
    assert.equal(invalid.statusCode, 401);
    assert.equal(invalid.body.code, 'SMS_PROVISION_SIGNATURE_INVALID');
    assert.equal(calls.length, 1);

    const expiredTimestamp = String(Number(timestamp) - 301);
    const expiredSignature = `v1=${crypto.createHmac('sha256', secret)
        .update(`${expiredTimestamp}.delivery-0003.`)
        .update(rawBody)
        .digest('hex')}`;
    const expired = await invoke(router, {
        body,
        rawBody,
        headers: {
            'x-savana-timestamp': expiredTimestamp,
            'x-savana-signature': expiredSignature,
            'x-savana-delivery-id': 'delivery-0003',
        },
    });
    assert.equal(expired.statusCode, 401);
    assert.equal(expired.body.code, 'SMS_PROVISION_EXPIRED');
});
