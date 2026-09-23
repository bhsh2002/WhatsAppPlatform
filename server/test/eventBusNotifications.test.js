import assert from 'node:assert/strict';
import test from 'node:test';

import eventBus from '../services/eventBus.js';

const flushPromises = () => new Promise(resolve => setImmediate(resolve));

test('incoming channel events enqueue durable browser notifications once', async (t) => {
    const messages = [];
    const alerts = [];
    eventBus.setNotificationPublisher({
        enqueueMessage(payload) {
            messages.push(payload);
        },
        enqueueAlert(payload) {
            alerts.push(payload);
        },
    });
    t.after(() => eventBus.setNotificationPublisher(null));

    eventBus.emitNewMessage({
        tenant_id: 41,
        direction: 'incoming',
        wamid: 'wamid.incoming-41',
    });
    eventBus.emitNewMessage({
        tenant_id: 41,
        direction: 'outgoing',
        wamid: 'wamid.outgoing-41',
    });
    eventBus.emitBrowserMessage({
        tenantId: 41,
        channel: 'messenger',
        sourceId: 'mid.41',
    });
    eventBus.emitStatusUpdate({
        tenant_id: 41,
        status: 'delivered',
        wamid: 'wamid.delivered-41',
    });
    eventBus.emitStatusUpdate({
        tenant_id: 41,
        status: 'failed',
        wamid: 'wamid.failed-41',
    });

    // Durable outbox insertion starts before the webhook-facing method returns;
    // only provider-independent promise completion remains asynchronous.
    assert.equal(messages.length, 2);
    assert.equal(alerts.length, 1);
    await flushPromises();

    assert.deepEqual(messages, [
        {
            tenantId: 41,
            channel: 'whatsapp',
            sourceId: 'wamid.incoming-41',
        },
        {
            tenantId: 41,
            channel: 'messenger',
            sourceId: 'mid.41',
        },
    ]);
    assert.deepEqual(alerts, [{
        tenantId: 41,
        code: 'WHATSAPP_MESSAGE_FAILED',
        sourceId: 'wamid.failed-41',
        severity: 'warning',
    }]);
});

test('publisher failures never fail the webhook-facing event path', async (t) => {
    eventBus.setNotificationPublisher({
        enqueueMessage() {
            throw new Error('provider unavailable');
        },
    });
    t.after(() => eventBus.setNotificationPublisher(null));

    assert.doesNotThrow(() => eventBus.emitNewMessage({
        tenant_id: 42,
        direction: 'incoming',
        wamid: 'wamid.resilient-42',
    }));
    await flushPromises();
});

test('publisher promise rejections never fail the webhook-facing event path', async (t) => {
    eventBus.setNotificationPublisher({
        enqueueMessage() {
            return Promise.reject(new Error('outbox unavailable'));
        },
    });
    t.after(() => eventBus.setNotificationPublisher(null));

    assert.doesNotThrow(() => eventBus.emitNewMessage({
        tenant_id: 43,
        direction: 'incoming',
        wamid: 'wamid.resilient-43',
    }));
    await flushPromises();
});

test('durable publisher methods surface storage failures before external acknowledgement', async (t) => {
    eventBus.setNotificationPublisher({
        enqueueMessage() {
            throw new Error('outbox unavailable');
        },
        enqueueAlert() {
            return Promise.reject(new Error('outbox unavailable'));
        },
    });
    t.after(() => eventBus.setNotificationPublisher(null));

    assert.throws(
        () => eventBus.persistBrowserMessage({
            tenantId: 44,
            channel: 'whatsapp',
            sourceId: 'wamid.strict-44',
        }),
        /outbox unavailable/,
    );
    await assert.rejects(
        eventBus.persistBrowserAlert({
            tenantId: 44,
            code: 'STRICT_ALERT',
            sourceId: 'strict-alert-44',
        }),
        /outbox unavailable/,
    );
});
