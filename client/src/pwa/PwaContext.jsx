import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { Alert, Snackbar } from '@mui/material';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import {
    createPushSubscription,
    DEFAULT_NOTIFICATION_PREFERENCES,
    getExistingPushSubscription,
    getNotificationPermission,
    isIosDevice,
    isPushSupported,
    isStandaloneDisplay,
    normalizeNotificationConfig,
    normalizeNotificationPreferences,
    serializePushSubscription,
    unlinkPushSubscription,
} from './pwaClient';

const PwaContext = createContext(null);
const EMPTY_CONFIG = Object.freeze({ enabled: false, publicKey: '' });

export const PwaProvider = ({ children }) => {
    const { isAuthenticated, sessionRevision, user } = useAuth();
    const { t } = useLanguage();
    const [installPrompt, setInstallPrompt] = useState(null);
    const [installed, setInstalled] = useState(isStandaloneDisplay);
    const [permission, setPermission] = useState(getNotificationPermission);
    const [config, setConfig] = useState(EMPTY_CONFIG);
    const [preferences, setPreferences] = useState(DEFAULT_NOTIFICATION_PREFERENCES);
    const [subscription, setSubscription] = useState(null);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [errorCode, setErrorCode] = useState('');
    const [foregroundCategory, setForegroundCategory] = useState('');

    useEffect(() => {
        const beforeInstall = (event) => {
            event.preventDefault();
            setInstallPrompt(event);
        };
        const appInstalled = () => {
            setInstalled(true);
            setInstallPrompt(null);
        };
        const updatePermission = () => setPermission(getNotificationPermission());

        window.addEventListener('beforeinstallprompt', beforeInstall);
        window.addEventListener('appinstalled', appInstalled);
        document.addEventListener('visibilitychange', updatePermission);
        return () => {
            window.removeEventListener('beforeinstallprompt', beforeInstall);
            window.removeEventListener('appinstalled', appInstalled);
            document.removeEventListener('visibilitychange', updatePermission);
        };
    }, []);

    useEffect(() => {
        if (!isAuthenticated || !navigator.serviceWorker) return undefined;
        const receivePush = (event) => {
            if (event.data?.type !== 'wa-push:received') return;
            setForegroundCategory(event.data.category === 'alert' ? 'alert' : 'message');
        };
        navigator.serviceWorker.addEventListener('message', receivePush);
        return () => navigator.serviceWorker.removeEventListener('message', receivePush);
    }, [isAuthenticated]);

    const loadNotificationState = useCallback(async ({
        bindExisting = true,
        shouldContinue = () => true,
    } = {}) => {
        if (!isAuthenticated) return;
        setLoading(true);
        setErrorCode('');
        try {
            const remoteConfig = normalizeNotificationConfig(await api.getNotificationConfig());
            if (!shouldContinue()) return;
            setConfig(remoteConfig);

            if (!remoteConfig.enabled) {
                setSubscription(null);
                return;
            }

            if (isPushSupported()) {
                const existing = await getExistingPushSubscription({ register: true });
                if (!shouldContinue()) return;
                setSubscription(existing);
                setPermission(getNotificationPermission());

                if (bindExisting && existing && getNotificationPermission() === 'granted') {
                    await api.savePushSubscription(serializePushSubscription(existing));
                }
            }

            const remotePreferences = normalizeNotificationPreferences(
                await api.getNotificationPreferences(),
            );
            if (!shouldContinue()) return;
            setPreferences(remotePreferences);
        } catch (error) {
            if (!shouldContinue()) return;
            console.warn('[PWA] Failed to load browser notification state:', error);
            setErrorCode('serverUnavailable');
        } finally {
            if (shouldContinue()) setLoading(false);
        }
    }, [isAuthenticated]);

    useEffect(() => {
        if (!isAuthenticated) {
            setConfig(EMPTY_CONFIG);
            setPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
            setSubscription(null);
            setErrorCode('');
            setLoading(false);
            return;
        }

        let active = true;
        loadNotificationState({ shouldContinue: () => active });
        return () => { active = false; };
    }, [isAuthenticated, loadNotificationState, sessionRevision, user?.id]);

    const promptInstall = useCallback(async () => {
        if (!installPrompt) return 'unavailable';
        try {
            await installPrompt.prompt();
            const choice = await installPrompt.userChoice;
            return choice?.outcome || 'dismissed';
        } finally {
            // A beforeinstallprompt event can only be consumed once. A future
            // browser event will populate a fresh prompt when it is eligible.
            setInstallPrompt(null);
        }
    }, [installPrompt]);

    const enableNotifications = useCallback(async () => {
        setBusy(true);
        setErrorCode('');
        try {
            if (!isPushSupported()) {
                setErrorCode('unsupported');
                return false;
            }

            let currentConfig = config;
            if (!currentConfig.enabled || !currentConfig.publicKey) {
                currentConfig = normalizeNotificationConfig(await api.getNotificationConfig());
                setConfig(currentConfig);
            }
            if (!currentConfig.enabled || !currentConfig.publicKey) {
                setErrorCode('serverDisabled');
                return false;
            }

            let nextPermission = getNotificationPermission();
            if (nextPermission !== 'granted') {
                nextPermission = await Notification.requestPermission();
                setPermission(nextPermission);
            }
            if (nextPermission !== 'granted') {
                setErrorCode(nextPermission === 'denied' ? 'permissionDenied' : 'permissionRequired');
                return false;
            }

            const nextSubscription = await createPushSubscription(currentConfig.publicKey);
            await api.savePushSubscription(serializePushSubscription(nextSubscription));
            setSubscription(nextSubscription);
            return true;
        } catch (error) {
            console.warn('[PWA] Failed to enable browser notifications:', error);
            setErrorCode('subscribeFailed');
            return false;
        } finally {
            setBusy(false);
        }
    }, [config]);

    const disableNotifications = useCallback(async () => {
        setBusy(true);
        setErrorCode('');
        try {
            const existing = subscription || await getExistingPushSubscription();
            if (!existing) {
                setSubscription(null);
                return true;
            }

            await unlinkPushSubscription(api, existing);
            setSubscription(null);
            return true;
        } catch (error) {
            console.warn('[PWA] Failed to disable browser notifications:', error);
            setSubscription(null);
            setErrorCode('unsubscribeFailed');
            return false;
        } finally {
            setBusy(false);
        }
    }, [subscription]);

    const updatePreferences = useCallback(async (changes) => {
        setBusy(true);
        setErrorCode('');
        const next = { ...preferences, ...changes };
        try {
            const saved = normalizeNotificationPreferences(
                await api.updateNotificationPreferences(next),
            );
            setPreferences(saved);
            return true;
        } catch (error) {
            console.warn('[PWA] Failed to update notification preferences:', error);
            setErrorCode('preferencesFailed');
            return false;
        } finally {
            setBusy(false);
        }
    }, [preferences]);

    const value = useMemo(() => ({
        installed,
        canInstall: !installed && Boolean(installPrompt),
        isIos: isIosDevice(),
        pushSupported: isPushSupported(),
        permission,
        serverEnabled: config.enabled,
        subscribed: Boolean(subscription),
        preferences,
        loading,
        busy,
        errorCode,
        clearError: () => setErrorCode(''),
        promptInstall,
        enableNotifications,
        disableNotifications,
        updatePreferences,
        refresh: loadNotificationState,
    }), [
        busy,
        config.enabled,
        disableNotifications,
        enableNotifications,
        errorCode,
        installPrompt,
        installed,
        loadNotificationState,
        loading,
        permission,
        preferences,
        promptInstall,
        subscription,
        updatePreferences,
    ]);

    return (
        <PwaContext.Provider value={value}>
            {children}
            <Snackbar
                open={Boolean(foregroundCategory)}
                autoHideDuration={6000}
                onClose={() => setForegroundCategory('')}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert
                    severity={foregroundCategory === 'alert' ? 'warning' : 'info'}
                    onClose={() => setForegroundCategory('')}
                    variant="filled"
                >
                    {foregroundCategory === 'alert'
                        ? t('pwa.foregroundAlert')
                        : t('pwa.foregroundMessage')}
                </Alert>
            </Snackbar>
        </PwaContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const usePwa = () => {
    const context = useContext(PwaContext);
    if (!context) throw new Error('usePwa must be used within PwaProvider');
    return context;
};
