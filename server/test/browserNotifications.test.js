import assert from 'node:assert/strict';
import test from 'node:test';

import { createBrowserNotificationsRouter } from '../routes/browserNotifications.js';
import { WebPushServiceError } from '../services/webPush.js';

const routeHandler = (router, method, path) => {
    const layer = router.stack.find(item => item.route?.path === path && item.route.methods?.[method]);
    assert.ok(layer, `Missing ${method.toUpperCase()} ${path}`);
    return layer.route.stack[0].handle;
};

const invoke = (router, method, path, request = {}) => new Promise((resolve, reject) => {
    const req = {
        user: { id: 7, jti: 'session-7', iat: 100, exp: 200, auth_version: 0 },
        body: {},
        ...request,
    };
    const res = {
        statusCode: 200,
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; resolve(this); return this; },
    };
    try {
        Promise.resolve(routeHandler(router, method, path)(req, res)).catch(reject);
    } catch (error) {
        reject(error);
    }
});

test('browser notification routes expose config and user-scoped preferences', async () => {
    const calls = [];
    const service = {
        getPublicConfig: () => ({ enabled: true, public_key: 'public' }),
        getPreferences(userId) {
            calls.push(['getPreferences', userId]);
            return { messages_enabled: true, alerts_enabled: true };
        },
        updatePreferences(userId, input) {
            calls.push(['updatePreferences', userId, input]);
            return input;
        },
        registerSubscription: async input => input,
        removeSubscription: input => input,
    };
    const router = createBrowserNotificationsRouter({ service });

    const config = await invoke(router, 'get', '/config');
    assert.deepEqual(config.body, { enabled: true, public_key: 'public' });
    const preferences = await invoke(router, 'get', '/preferences');
    assert.equal(preferences.body.messages_enabled, true);
    const updated = await invoke(router, 'patch', '/preferences', {
        body: { messages_enabled: false, alerts_enabled: true },
    });
    assert.deepEqual(updated.body, { messages_enabled: false, alerts_enabled: true });
    assert.deepEqual(calls, [
        ['getPreferences', 7],
        ['updatePreferences', 7, { messages_enabled: false, alerts_enabled: true }],
    ]);
});

test('subscription routes pass the authenticated user and wrapped browser subscription', async () => {
    const calls = [];
    const service = {
        getPublicConfig: () => ({}),
        getPreferences: () => ({}),
        updatePreferences: () => ({}),
        async registerSubscription(input) {
            calls.push(['register', input]);
            return { id: 9 };
        },
        removeSubscription(input) {
            calls.push(['remove', input]);
            return { removed: true };
        },
    };
    const router = createBrowserNotificationsRouter({ service });
    const browserSubscription = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'key', auth: 'auth' },
    };
    const user = { id: 22, jti: 'session-22', iat: 100, exp: 200, auth_version: 0 };

    const registered = await invoke(router, 'put', '/subscription', {
        user,
        body: { subscription: browserSubscription },
    });
    assert.equal(registered.statusCode, 201);
    assert.deepEqual(registered.body, { subscription: { id: 9 } });
    assert.deepEqual(calls[0], ['register', { user, subscription: browserSubscription }]);

    const removed = await invoke(router, 'delete', '/subscription', {
        user,
        body: { endpoint: browserSubscription.endpoint },
    });
    assert.deepEqual(removed.body, { removed: true });
    assert.deepEqual(calls[1], ['remove', {
        userId: 22,
        endpoint: browserSubscription.endpoint,
    }]);
});

test('browser notification routes return stable service errors without leaking internals', async () => {
    const service = {
        getPublicConfig: () => ({}),
        getPreferences: () => ({}),
        updatePreferences() {
            throw new WebPushServiceError('Invalid preference', {
                code: 'INVALID_NOTIFICATION_PREFERENCES',
                status: 400,
            });
        },
        registerSubscription: async () => ({}),
        removeSubscription: () => ({}),
    };
    const router = createBrowserNotificationsRouter({ service });
    const response = await invoke(router, 'patch', '/preferences', {
        body: { messages_enabled: 'yes' },
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, {
        error: 'Invalid preference',
        code: 'INVALID_NOTIFICATION_PREFERENCES',
    });
});
