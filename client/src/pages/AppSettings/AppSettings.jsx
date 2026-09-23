import React from 'react';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Divider,
    FormControlLabel,
    Stack,
    Switch,
    Typography,
} from '@mui/material';
import {
    CheckCircle as CheckCircleIcon,
    Download as DownloadIcon,
    InstallMobile as InstallMobileIcon,
    NotificationsActive as NotificationsActiveIcon,
    NotificationsOff as NotificationsOffIcon,
    Refresh as RefreshIcon,
} from '@mui/icons-material';
import { PageTitle } from '../../components/Layout/PageTitle';
import { useLanguage } from '../../context/LanguageContext';
import { usePwa } from '../../pwa/PwaContext';

const AppSettings = () => {
    const { t } = useLanguage();
    const {
        installed,
        canInstall,
        isIos,
        pushSupported,
        permission,
        serverEnabled,
        subscribed,
        preferences,
        loading,
        busy,
        errorCode,
        clearError,
        promptInstall,
        enableNotifications,
        disableNotifications,
        updatePreferences,
        refresh,
    } = usePwa();

    const permissionLabel = permission === 'granted'
        ? t('pwa.permissionGranted')
        : permission === 'denied'
            ? t('pwa.permissionDenied')
            : permission === 'unsupported'
                ? t('pwa.unsupported')
                : t('pwa.permissionNotRequested');

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 960, mx: 'auto' }}>
            <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', sm: 'center' }}
                gap={2}
                mb={3}
            >
                <Box>
                    <PageTitle variant="h4" fontWeight={800}>{t('pwa.title')}</PageTitle>
                    <Typography color="text.secondary">{t('pwa.subtitle')}</Typography>
                </Box>
                <Button
                    variant="outlined"
                    startIcon={loading ? <CircularProgress size={17} /> : <RefreshIcon />}
                    onClick={() => refresh()}
                    disabled={loading || busy}
                >
                    {t('pwa.refresh')}
                </Button>
            </Stack>

            {errorCode && (
                <Alert severity="error" onClose={clearError} sx={{ mb: 2 }}>
                    {t(`pwa.errors.${errorCode}`)}
                </Alert>
            )}

            <Stack spacing={3}>
                <Card>
                    <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                        <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            alignItems={{ xs: 'stretch', sm: 'center' }}
                            justifyContent="space-between"
                            gap={2}
                            mb={2}
                        >
                            <Stack direction="row" alignItems="center" gap={1.5}>
                                <InstallMobileIcon color="primary" />
                                <Box>
                                    <Typography component="h2" variant="h6" fontWeight={700}>
                                        {t('pwa.installTitle')}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {t('pwa.installDescription')}
                                    </Typography>
                                </Box>
                            </Stack>
                            <Chip
                                icon={installed ? <CheckCircleIcon /> : undefined}
                                color={installed ? 'success' : 'default'}
                                label={installed ? t('pwa.installed') : t('pwa.notInstalled')}
                                variant="outlined"
                            />
                        </Stack>

                        {!installed && !canInstall && (
                            <Alert severity="info" sx={{ mb: 2 }}>
                                {isIos ? t('pwa.iosInstallHelp') : t('pwa.browserInstallHelp')}
                            </Alert>
                        )}

                        <Button
                            variant="contained"
                            startIcon={<DownloadIcon />}
                            onClick={promptInstall}
                            disabled={installed || !canInstall}
                        >
                            {installed ? t('pwa.installed') : t('pwa.installButton')}
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                        <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            alignItems={{ xs: 'stretch', sm: 'center' }}
                            justifyContent="space-between"
                            gap={2}
                            mb={2}
                        >
                            <Stack direction="row" alignItems="center" gap={1.5}>
                                {subscribed ? <NotificationsActiveIcon color="primary" /> : <NotificationsOffIcon color="action" />}
                                <Box>
                                    <Typography component="h2" variant="h6" fontWeight={700}>
                                        {t('pwa.notificationsTitle')}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {t('pwa.notificationsDescription')}
                                    </Typography>
                                </Box>
                            </Stack>
                            <Chip
                                color={subscribed ? 'success' : permission === 'denied' ? 'error' : 'default'}
                                label={subscribed ? t('pwa.notificationsEnabled') : permissionLabel}
                                variant="outlined"
                            />
                        </Stack>

                        <Alert severity="info" sx={{ mb: 2 }}>
                            {t('pwa.privateBodyNotice')}
                        </Alert>

                        {!pushSupported && (
                            <Alert severity="warning" sx={{ mb: 2 }}>{t('pwa.unsupportedHelp')}</Alert>
                        )}
                        {pushSupported && !serverEnabled && !loading && (
                            <Alert severity="warning" sx={{ mb: 2 }}>{t('pwa.serverDisabled')}</Alert>
                        )}
                        {permission === 'denied' && (
                            <Alert severity="warning" sx={{ mb: 2 }}>{t('pwa.deniedHelp')}</Alert>
                        )}

                        <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} mb={3}>
                            {!subscribed ? (
                                <Button
                                    variant="contained"
                                    startIcon={busy ? <CircularProgress size={17} color="inherit" /> : <NotificationsActiveIcon />}
                                    onClick={enableNotifications}
                                    disabled={busy || loading || !pushSupported || !serverEnabled || permission === 'denied'}
                                >
                                    {t('pwa.enableNotifications')}
                                </Button>
                            ) : (
                                <Button
                                    variant="outlined"
                                    color="error"
                                    startIcon={busy ? <CircularProgress size={17} /> : <NotificationsOffIcon />}
                                    onClick={disableNotifications}
                                    disabled={busy}
                                >
                                    {t('pwa.disableNotifications')}
                                </Button>
                            )}
                        </Stack>

                        <Divider sx={{ mb: 2 }} />
                        <Typography component="h3" variant="subtitle1" fontWeight={700} gutterBottom>
                            {t('pwa.preferencesTitle')}
                        </Typography>
                        <Stack>
                            <FormControlLabel
                                control={(
                                    <Switch
                                        checked={preferences.messages_enabled}
                                        onChange={(_, checked) => updatePreferences({ messages_enabled: checked })}
                                        disabled={!subscribed || busy}
                                    />
                                )}
                                label={t('pwa.messageNotifications')}
                            />
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, mx: 6 }}>
                                {t('pwa.messageNotificationsHelp')}
                            </Typography>
                            <FormControlLabel
                                control={(
                                    <Switch
                                        checked={preferences.alerts_enabled}
                                        onChange={(_, checked) => updatePreferences({ alerts_enabled: checked })}
                                        disabled={!subscribed || busy}
                                    />
                                )}
                                label={t('pwa.alertNotifications')}
                            />
                            <Typography variant="caption" color="text.secondary" sx={{ mx: 6 }}>
                                {t('pwa.alertNotificationsHelp')}
                            </Typography>
                        </Stack>
                    </CardContent>
                </Card>
            </Stack>
        </Box>
    );
};

export default AppSettings;
