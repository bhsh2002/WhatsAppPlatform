const APP_NAME = 'Wa Savana';
const APP_ORIGIN = self.location.origin;
const DEFAULT_PATH = '/login';
const ALLOWED_NOTIFICATION_PATHS = new Set([
    '/inbox',
    '/portal/inbox',
    '/dashboard',
    '/portal',
    '/app-settings',
    '/settings',
    '/templates',
    '/whatsapp',
    '/portal/templates',
    '/portal/meta-review',
    '/login',
]);
const INBOX_PATHS = new Set(['/inbox', '/portal/inbox']);
const ALLOWED_CHANNELS = new Set(['whatsapp', 'messenger', 'sms']);

const genericBody = (category, language) => {
    if (language === 'en') {
        return category === 'alert'
            ? 'You have a new alert in Wa Savana.'
            : 'You have a new message in Wa Savana.';
    }

    return category === 'alert'
        ? 'لديك تنبيه جديد في Wa Savana.'
        : 'لديك رسالة جديدة في Wa Savana.';
};

const notificationCategory = (payload) => {
    const value = String(payload?.category || payload?.kind || payload?.type || '').toLowerCase();
    return value.includes('alert') ? 'alert' : 'message';
};

const sameOriginPath = (candidate) => {
    if (typeof candidate !== 'string' || !candidate.trim()) return DEFAULT_PATH;

    try {
        const url = new URL(candidate, APP_ORIGIN);
        if (
            url.origin !== APP_ORIGIN
            || !['http:', 'https:'].includes(url.protocol)
            || !ALLOWED_NOTIFICATION_PATHS.has(url.pathname)
        ) {
            return DEFAULT_PATH;
        }
        if (INBOX_PATHS.has(url.pathname)) {
            const channel = url.searchParams.get('channel');
            if (ALLOWED_CHANNELS.has(channel)) {
                return `${url.pathname}?channel=${encodeURIComponent(channel)}`;
            }
        }
        return url.pathname;
    } catch {
        return DEFAULT_PATH;
    }
};

const parsePushPayload = (event) => {
    if (!event.data) return {};

    try {
        return event.data.json() || {};
    } catch {
        return {};
    }
};

const notificationOptions = (payload) => {
    const category = notificationCategory(payload);
    const requestedLanguage = String(payload?.language || '').toLowerCase();
    const browserLanguage = String(self.navigator?.language || '').toLowerCase();
    const language = requestedLanguage === 'en' || requestedLanguage === 'ar'
        ? requestedLanguage
        : browserLanguage.startsWith('en') ? 'en' : 'ar';
    const options = {
        body: genericBody(category, language),
        icon: '/icons/wa-savana-192.png',
        badge: '/icons/wa-savana-192.png',
        data: {
            category,
            url: sameOriginPath(payload?.url),
        },
    };

    const rawTag = payload?.tag || payload?.notification_id || payload?.id;
    if (rawTag !== undefined && rawTag !== null) {
        const tag = String(rawTag).replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 120);
        if (tag) options.tag = tag;
    }

    return options;
};

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// This worker deliberately uses the network only. In particular, /api requests
// are not intercepted, and no Cache Storage entry can contain user or API data.
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    if (url.origin !== APP_ORIGIN || url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return;
    }

    event.respondWith(fetch(event.request));
});

self.addEventListener('push', (event) => {
    const payload = parsePushPayload(event);
    const options = notificationOptions(payload);
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const focusedWindows = windows.filter(client => (
            new URL(client.url).origin === APP_ORIGIN
            && client.visibilityState === 'visible'
            && client.focused === true
        ));

        if (focusedWindows.length > 0) {
            await Promise.all(focusedWindows.map(client => client.postMessage({
                type: 'wa-push:received',
                category: options.data.category,
                url: options.data.url,
            })));
            return;
        }

        await self.registration.showNotification(APP_NAME, options);
    })());
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetPath = sameOriginPath(event.notification?.data?.url);
    const targetUrl = new URL(targetPath, APP_ORIGIN).href;

    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const appWindow = windows.find((client) => new URL(client.url).origin === APP_ORIGIN);

        if (appWindow) {
            if ('navigate' in appWindow) await appWindow.navigate(targetUrl);
            return appWindow.focus();
        }

        return self.clients.openWindow(targetUrl);
    })());
});
