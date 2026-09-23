let registrationPromise = null;

export const canUseServiceWorker = () => (
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator
);

export const registerServiceWorker = async () => {
    if (!canUseServiceWorker()) return null;

    if (!registrationPromise) {
        registrationPromise = navigator.serviceWorker.register('/sw.js', {
            scope: '/',
            updateViaCache: 'none',
        }).catch((error) => {
            registrationPromise = null;
            throw error;
        });
    }

    return registrationPromise;
};

export const getReadyServiceWorkerRegistration = async () => {
    const registration = await registerServiceWorker();
    if (!registration) return null;
    if (registration.active) return registration;
    return navigator.serviceWorker.ready;
};

export const getExistingServiceWorkerRegistration = async () => {
    if (!canUseServiceWorker()) return null;
    return navigator.serviceWorker.getRegistration('/');
};
