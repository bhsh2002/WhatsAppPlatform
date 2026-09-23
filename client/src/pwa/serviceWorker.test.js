import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const origin = 'https://wa.savana.ly';

const createWorker = ({ windowClients = [] } = {}) => {
    const handlers = new Map();
    const notifications = [];
    const openedWindows = [];
    const fetched = [];

    const worker = {
        location: { origin },
        addEventListener: (type, handler) => handlers.set(type, handler),
        skipWaiting: async () => undefined,
        registration: {
            showNotification: async (title, options) => {
                notifications.push({ title, options });
            },
        },
        clients: {
            claim: async () => undefined,
            matchAll: async () => windowClients,
            openWindow: async (url) => {
                openedWindows.push(url);
                return { url };
            },
        },
    };

    vm.runInNewContext(source, {
        self: worker,
        URL,
        Set,
        Promise,
        fetch: async (request) => {
            fetched.push(request.url);
            return { ok: true };
        },
    }, { filename: 'sw.js' });

    return { fetched, handlers, notifications, openedWindows };
};

const dispatchPush = async (handler, payload) => {
    let pending;
    handler({
        data: { json: () => payload },
        waitUntil: value => { pending = value; },
    });
    await pending;
};

test('push notifications use generic text and reject off-origin click URLs', async () => {
    const { handlers, notifications } = createWorker();
    await dispatchPush(handlers.get('push'), {
        category: 'message',
        body: 'private customer message',
        title: 'private customer name',
        url: 'https://evil.example/inbox?contact=secret',
    });

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].title, 'Wa Savana');
    assert.equal(notifications[0].options.body, 'لديك رسالة جديدة في Wa Savana.');
    assert.equal(notifications[0].options.data.url, '/login');
    assert.doesNotMatch(notifications[0].options.body, /private|customer|secret/i);
});

test('push notifications keep only an allowlisted inbox channel and remove identifiers', async () => {
    const { handlers, notifications } = createWorker();
    await dispatchPush(handlers.get('push'), {
        category: 'alert',
        language: 'en',
        url: '/portal/inbox?channel=whatsapp&contact=218900000000#private-message',
    });

    assert.equal(notifications[0].options.body, 'You have a new alert in Wa Savana.');
    assert.equal(
        notifications[0].options.data.url,
        '/portal/inbox?channel=whatsapp',
    );
});

test('a visible Wa Savana window receives a private in-app signal instead of an OS notification', async () => {
    const messages = [];
    const client = {
        url: `${origin}/portal`,
        visibilityState: 'visible',
        focused: true,
        postMessage: async message => messages.push(message),
    };
    const { handlers, notifications } = createWorker({ windowClients: [client] });
    await dispatchPush(handlers.get('push'), { category: 'message', url: '/portal/inbox' });

    assert.equal(notifications.length, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(messages[0])), {
        type: 'wa-push:received',
        category: 'message',
        url: '/portal/inbox',
    });
});

test('a visible but unfocused Wa Savana window still receives an OS notification', async () => {
    const messages = [];
    const client = {
        url: `${origin}/portal`,
        visibilityState: 'visible',
        focused: false,
        postMessage: async message => messages.push(message),
    };
    const { handlers, notifications } = createWorker({ windowClients: [client] });
    await dispatchPush(handlers.get('push'), { category: 'alert', url: '/portal/meta-review' });

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].options.data.url, '/portal/meta-review');
    assert.deepEqual(messages, []);
});

test('notification workflow paths remain inside the explicit allowlist', async () => {
    for (const path of ['/templates', '/whatsapp', '/portal/templates', '/portal/meta-review']) {
        const { handlers, notifications } = createWorker();
        await dispatchPush(handlers.get('push'), { category: 'alert', url: `${path}?secret=1#private` });
        assert.equal(notifications[0].options.data.url, path);
    }
});

test('notification clicks reject API routes and open a safe same-origin fallback', async () => {
    const { handlers, openedWindows } = createWorker();
    let pending;
    handlers.get('notificationclick')({
        notification: {
            data: { url: '/api/auth/session' },
            close: () => undefined,
        },
        waitUntil: value => { pending = value; },
    });
    await pending;

    assert.deepEqual(openedWindows, [`${origin}/login`]);
});

test('the network-only fetch handler never intercepts API requests', async () => {
    const { fetched, handlers } = createWorker();
    let apiResponse = null;
    handlers.get('fetch')({
        request: { method: 'GET', url: `${origin}/api/messages` },
        respondWith: value => { apiResponse = value; },
    });
    assert.equal(apiResponse, null);
    assert.deepEqual(fetched, []);

    let assetResponse = null;
    handlers.get('fetch')({
        request: { method: 'GET', url: `${origin}/assets/app.js` },
        respondWith: value => { assetResponse = value; },
    });
    await assetResponse;
    assert.deepEqual(fetched, [`${origin}/assets/app.js`]);
    assert.doesNotMatch(source, /\bcaches\s*\./);
});
