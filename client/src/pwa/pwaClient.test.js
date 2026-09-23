import test from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizeNotificationConfig,
    normalizeNotificationPreferences,
    logoutAfterPushUnlink,
    serializePushSubscription,
    unlinkPushSubscription,
    urlBase64ToUint8Array,
} from './pwaClient.js';

test('normalizes the notification API contract without inventing an enabled server', () => {
    assert.deepEqual(normalizeNotificationConfig({ enabled: true, public_key: ' public-key ' }), {
        enabled: true,
        publicKey: 'public-key',
    });
    assert.deepEqual(normalizeNotificationConfig({ public_key: 'public-key' }), {
        enabled: false,
        publicKey: 'public-key',
    });
});

test('normalizes canonical and wrapped notification preferences', () => {
    assert.deepEqual(normalizeNotificationPreferences({
        preferences: { messages_enabled: false, alerts_enabled: true },
    }), {
        messages_enabled: false,
        alerts_enabled: true,
    });
    assert.deepEqual(normalizeNotificationPreferences({}), {
        messages_enabled: true,
        alerts_enabled: true,
    });
});

test('decodes an unpadded URL-safe application server key', () => {
    assert.deepEqual(
        [...urlBase64ToUint8Array('AQIDBA')],
        [1, 2, 3, 4],
    );
});

test('serializes only the Push API fields sent to the server', () => {
    const subscription = {
        toJSON: () => ({
            endpoint: 'https://push.example/subscription/1',
            expirationTime: 1234,
            keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
            ignored: 'value',
        }),
    };

    assert.deepEqual(serializePushSubscription(subscription), {
        endpoint: 'https://push.example/subscription/1',
        expirationTime: 1234,
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    });
});

test('logout starts immediately while endpoint cleanup continues in parallel', async () => {
    const calls = [];
    let resolveDelete;
    let resolveUnsubscribe;
    const deletePending = new Promise(resolve => { resolveDelete = resolve; });
    const unsubscribePending = new Promise(resolve => { resolveUnsubscribe = resolve; });
    const apiClient = {
        deletePushSubscription: async (endpoint, options) => {
            calls.push(['delete-start', endpoint, options.keepalive]);
            await deletePending;
            calls.push(['delete-finish']);
        },
        logout: async () => {
            calls.push(['logout-start']);
            return 'logged-out';
        },
    };

    const resultPending = logoutAfterPushUnlink(apiClient, {
        getSubscription: async () => {
            calls.push(['subscription-read']);
            return {
                endpoint: 'https://push.example/current-device',
                unsubscribe: async () => {
                    calls.push(['unsubscribe-start']);
                    await unsubscribePending;
                    calls.push(['unsubscribe-finish']);
                },
            };
        },
    });

    assert.deepEqual(calls, [
        ['subscription-read'],
        ['logout-start'],
    ]);

    await Promise.resolve();
    assert.deepEqual(calls.slice(-2), [
        ['delete-start', 'https://push.example/current-device', true],
        ['unsubscribe-start'],
    ]);

    resolveDelete();
    await Promise.resolve();
    assert.deepEqual(calls.at(-1), ['delete-finish']);

    resolveUnsubscribe();
    assert.equal(await resultPending, 'logged-out');
    assert.deepEqual(calls.at(-1), ['unsubscribe-finish']);
});

test('explicit disable starts local unsubscribe before server deletion resolves', async () => {
    const calls = [];
    let resolveDelete;
    const deletePending = new Promise(resolve => { resolveDelete = resolve; });
    const subscription = {
        endpoint: 'https://push.example/current-device',
        unsubscribe: async () => calls.push('unsubscribe'),
    };
    const apiClient = {
        deletePushSubscription: async () => {
            calls.push('delete');
            await deletePending;
        },
    };

    const pending = unlinkPushSubscription(apiClient, subscription);
    assert.deepEqual(calls, ['delete', 'unsubscribe']);
    resolveDelete();
    assert.equal(await pending, true);
});

test('logout still revokes the session when endpoint unlinking fails', async () => {
    const calls = [];
    const unlinkErrors = [];
    const apiClient = {
        deletePushSubscription: async () => {
            calls.push('delete');
            throw new Error('offline');
        },
        logout: async () => {
            calls.push('logout');
        },
    };

    await logoutAfterPushUnlink(apiClient, {
        getSubscription: async () => ({
            endpoint: 'https://push.example/current-device',
            unsubscribe: async () => calls.push('unsubscribe'),
        }),
        onUnlinkError: error => unlinkErrors.push(error.message),
    });

    assert.deepEqual(calls, ['logout', 'delete', 'unsubscribe']);
    assert.deepEqual(unlinkErrors, ['offline']);
});

test('logout still revokes the session when local unsubscribe fails', async () => {
    const calls = [];
    const unlinkErrors = [];
    const apiClient = {
        deletePushSubscription: async () => calls.push('delete'),
        logout: async () => calls.push('logout'),
    };

    await logoutAfterPushUnlink(apiClient, {
        getSubscription: async () => ({
            endpoint: 'https://push.example/current-device',
            unsubscribe: async () => {
                calls.push('unsubscribe');
                throw new Error('browser failure');
            },
        }),
        onUnlinkError: error => unlinkErrors.push(error.message),
    });

    assert.deepEqual(calls, ['logout', 'delete', 'unsubscribe']);
    assert.deepEqual(unlinkErrors, ['browser failure']);
});
