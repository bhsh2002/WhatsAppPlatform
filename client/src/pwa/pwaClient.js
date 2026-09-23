import {
    getExistingServiceWorkerRegistration,
    getReadyServiceWorkerRegistration,
} from './registerServiceWorker.js';

export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
    messages_enabled: true,
    alerts_enabled: true,
});

export const normalizeNotificationConfig = (payload = {}) => ({
    enabled: payload?.enabled === true,
    publicKey: String(payload?.public_key || payload?.vapid_public_key || '').trim(),
});

export const normalizeNotificationPreferences = (payload = {}) => {
    const value = payload?.preferences || payload || {};
    return {
        messages_enabled: value.messages_enabled ?? value.messages ?? true,
        alerts_enabled: value.alerts_enabled ?? value.alerts ?? true,
    };
};

export const urlBase64ToUint8Array = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) throw new Error('Missing Web Push public key');

    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    const base64 = (normalized + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = globalThis.atob(base64);
    return Uint8Array.from(raw, character => character.charCodeAt(0));
};

export const serializePushSubscription = (subscription) => {
    if (!subscription) return null;
    const serialized = typeof subscription.toJSON === 'function'
        ? subscription.toJSON()
        : subscription;

    return {
        endpoint: String(serialized.endpoint || ''),
        expirationTime: serialized.expirationTime ?? null,
        keys: {
            p256dh: String(serialized.keys?.p256dh || ''),
            auth: String(serialized.keys?.auth || ''),
        },
    };
};

export const isPushSupported = () => (
    typeof window !== 'undefined'
    && 'Notification' in window
    && 'PushManager' in window
    && typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
);

export const getNotificationPermission = () => (
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
);

export const isStandaloneDisplay = () => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    return window.matchMedia?.('(display-mode: standalone)').matches === true
        || navigator.standalone === true;
};

export const isIosDevice = () => {
    if (typeof navigator === 'undefined') return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent || '')
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

export const getExistingPushSubscription = async ({ register = false } = {}) => {
    const registration = register
        ? await getReadyServiceWorkerRegistration()
        : await getExistingServiceWorkerRegistration();
    if (!registration?.pushManager) return null;
    return registration.pushManager.getSubscription();
};

export const createPushSubscription = async (publicKey) => {
    const registration = await getReadyServiceWorkerRegistration();
    if (!registration?.pushManager) throw new Error('Push Manager is unavailable');

    const existing = await registration.pushManager.getSubscription();
    if (existing) return existing;

    return registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
};

const observeOperation = (operation) => {
    try {
        return Promise.resolve(operation());
    } catch (error) {
        return Promise.reject(error);
    }
};

export const unlinkPushSubscription = async (
    apiClient,
    subscription,
    { keepalive = false } = {},
) => {
    if (!subscription) return false;

    // Start the local unsubscribe immediately alongside the network cleanup.
    // A slow or hung DELETE must never leave a shared browser subscribed after
    // the user signs out or explicitly disables notifications.
    const serverCleanup = subscription.endpoint
        ? observeOperation(() => apiClient.deletePushSubscription(
            subscription.endpoint,
            { keepalive },
        ))
        : Promise.resolve();
    const localCleanup = observeOperation(() => subscription.unsubscribe?.());
    const [serverResult, localResult] = await Promise.allSettled([
        serverCleanup,
        localCleanup,
    ]);

    const failure = localResult.status === 'rejected'
        ? localResult.reason
        : serverResult.status === 'rejected' ? serverResult.reason : null;
    if (failure) throw failure;
    return Boolean(subscription.endpoint);
};

export const unlinkPushSubscriptionForLogout = async (
    apiClient,
    getSubscription = getExistingPushSubscription,
) => {
    const subscription = await getSubscription();
    return unlinkPushSubscription(apiClient, subscription, { keepalive: true });
};

export const logoutAfterPushUnlink = (
    apiClient,
    {
        getSubscription = getExistingPushSubscription,
        onUnlinkError = () => undefined,
    } = {},
) => {
    const cleanupRequest = unlinkPushSubscriptionForLogout(apiClient, getSubscription)
        .catch((error) => {
            try {
                return Promise.resolve(onUnlinkError(error)).catch(() => undefined);
            } catch {
                return undefined;
            }
        });

    // Start session revocation immediately instead of waiting for Push API or
    // network cleanup. Promise.all keeps the best-effort cleanup observed, so
    // it cannot produce an unhandled rejection after the page signs out.
    let logoutRequest;
    try {
        logoutRequest = Promise.resolve(apiClient.logout());
    } catch (error) {
        logoutRequest = Promise.reject(error);
    }

    return Promise.all([logoutRequest, cleanupRequest])
        .then(([logoutResult]) => logoutResult);
};
