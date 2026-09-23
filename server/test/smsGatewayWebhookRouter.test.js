import assert from 'node:assert/strict';
import test from 'node:test';

import { createSmsGatewayWebhookRouter } from '../routes/smsGatewayWebhook.js';

const handlerFor = router => {
    const layer = router.stack.find(item => item.route?.path === '/:webhookKey');
    assert.ok(layer);
    return layer.route.stack[0].handle;
};

const invoke = (router, request = {}) => new Promise((resolve, reject) => {
    const req = {
        params: { webhookKey: 'hook-key' },
        headers: {},
        body: {},
        rawBody: Buffer.from('{}'),
        get(name) { return this.headers[String(name).toLowerCase()] || null; },
        ...request,
    };
    const res = {
        statusCode: 200,
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; resolve(this); return this; },
    };
    try {
        Promise.resolve(handlerFor(router)(req, res)).catch(reject);
    } catch (error) {
        reject(error);
    }
});

test('SMS Gateway webhooks forward tenant callback events without blocking SSE updates', async () => {
    const broadcasts = [];
    const callbacks = [];
    const browserMessages = [];
    const browserAlerts = [];
    let responseEvent = 'sms.message.status_changed.v1';
    let messageStatus = 'delivered';
    let duplicateResponse = false;
    const router = createSmsGatewayWebhookRouter({
        service: {
            acceptWebhook() {
                return {
                    tenantId: 7,
                    accountId: 9,
                    event: responseEvent,
                    duplicate: duplicateResponse,
                    message: {
                        id: 1,
                        gateway_message_id: 'gateway-1',
                        sms_account_id: 9,
                        status: responseEvent === 'sms.message.received.v1' ? 'received' : messageStatus,
                    },
                    ussd: null,
                };
            },
        },
        eventBus: {
            broadcast(...args) { broadcasts.push(args); },
            emitConversationUpdate(...args) { broadcasts.push(['conversation', ...args]); },
            emitBrowserMessage(payload) { browserMessages.push(payload); },
            emitBrowserAlert(payload) { browserAlerts.push(payload); },
        },
        callbackSender(...args) { callbacks.push(args); },
    });

    const status = await invoke(router);
    assert.equal(status.body.accepted, true);
    assert.equal(callbacks[0][0], 7);
    assert.equal(callbacks[0][1], 'sms_message_status_changed');
    assert.equal(callbacks[0][2].status, 'delivered');

    responseEvent = 'sms.message.received.v1';
    await invoke(router);
    assert.equal(callbacks[1][1], 'sms_message_received');
    assert.ok(broadcasts.some(item => item[0] === 'conversation' && item[1] === 7));
    assert.deepEqual(browserMessages, [{
        tenantId: 7,
        channel: 'sms',
        sourceId: 'sms-account:9:message:gateway-1',
    }]);

    responseEvent = 'sms.message.status_changed.v1';
    messageStatus = 'failed';
    await invoke(router);
    assert.deepEqual(browserAlerts, [{
        tenantId: 7,
        code: 'SMS_MESSAGE_FAILED',
        sourceId: 'sms-account:9:message:gateway-1',
        severity: 'warning',
    }]);

    const broadcastsBeforeReplay = broadcasts.length;
    const callbacksBeforeReplay = callbacks.length;
    duplicateResponse = true;
    const replay = await invoke(router);
    assert.equal(replay.body.duplicate, true);
    assert.equal(broadcasts.length, broadcastsBeforeReplay);
    assert.equal(callbacks.length, callbacksBeforeReplay);
    assert.equal(browserAlerts.length, 2);
    assert.deepEqual(browserAlerts[1], browserAlerts[0]);
});
