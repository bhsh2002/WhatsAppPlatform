import React, { useState, useEffect } from 'react';
import {
    Box,
    Grid,
    Card,
    CardActionArea,
    CardContent,
    Typography,
    Button,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    CircularProgress,
    Alert
} from '@mui/material';
import {
    Chat as ChatIcon,
    Description as TemplateIcon,
    NotificationsActive as UnreadIcon,
    Refresh as RefreshIcon,
    History as HistoryIcon,
    AccountBalanceWallet as CreditsIcon,
    EventAvailable as SubscriptionIcon,
    Sms as SmsIcon,
    ArrowForward as ArrowForwardIcon,
} from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../api';
import { useLanguage } from '../../context/LanguageContext';
import { buildTenantDashboardCards } from './dashboardPresentation';

const EXPIRY_WARNING_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const STAT_ICONS = Object.freeze({
    conversations: <ChatIcon />,
    messages: <ChatIcon />,
    templates: <TemplateIcon />,
    unread: <UnreadIcon />,
    credits: <CreditsIcon />,
    subscription: <SubscriptionIcon />,
    sms: <SmsIcon />,
});

const StatCard = ({ title, value, icon, color, description, actionLabel, to, direction, loading }) => (
    <Card
        component="article"
        elevation={0}
        sx={{
            height: '100%',
            minHeight: 196,
            overflow: 'hidden',
            border: 1,
            borderColor: 'divider',
            borderBlockStart: '4px solid',
            borderBlockStartColor: `${color}.main`,
        }}
    >
        <CardActionArea
            component={RouterLink}
            to={to}
            sx={{
                height: '100%',
                alignItems: 'stretch',
                transition: theme => theme.transitions.create(['background-color', 'box-shadow']),
                '&:hover': {
                    bgcolor: 'action.hover',
                    boxShadow: 2,
                },
                '&.Mui-focusVisible': {
                    outline: '3px solid',
                    outlineColor: `${color}.main`,
                    outlineOffset: -3,
                },
            }}
        >
            <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: { xs: 2, md: 2.5 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, mb: 1.5 }}>
                    <Typography variant="subtitle2" component="h3" color="text.secondary" fontWeight={600}>
                        {title}
                    </Typography>
                    <Box sx={{
                        width: 42,
                        height: 42,
                        flexShrink: 0,
                        borderRadius: 2.5,
                        bgcolor: `${color}.main`,
                        color: `${color}.contrastText`,
                        display: 'grid',
                        placeItems: 'center',
                    }}>
                        {icon}
                    </Box>
                </Box>
                <Typography variant="h4" component="p" fontWeight={700} sx={{ lineHeight: 1.25, mb: 0.75 }}>
                    {loading ? '—' : value}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ minHeight: '2.6em' }}>
                    {description}
                </Typography>
                <Box sx={{
                    mt: 'auto',
                    pt: 1.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.75,
                }}>
                    <Typography
                        variant="caption"
                        fontWeight={700}
                        color={color === 'info' ? 'info.dark' : `${color}.main`}
                    >
                        {actionLabel}
                    </Typography>
                    <ArrowForwardIcon
                        aria-hidden="true"
                        sx={{
                            color: `${color}.main`,
                            fontSize: 17,
                            transform: direction === 'rtl' ? 'scaleX(-1)' : 'none',
                        }}
                    />
                </Box>
            </CardContent>
        </CardActionArea>
    </Card>
);

const TenantDashboard = () => {
    const { tenant } = useAuth();
    const { direction, locale, t } = useLanguage();
    const [dashboardData, setDashboardData] = useState(null);
    const [billingSummary, setBillingSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchDashboard = async () => {
        try {
            setLoading(true);
            setError(null);
            const [dashboardResult, billingResult] = await Promise.allSettled([
                api.getPortalDashboard(),
                api.getPortalBillingSummary(),
            ]);
            if (dashboardResult.status === 'rejected') {
                throw dashboardResult.reason;
            }
            setDashboardData(dashboardResult.value);
            setBillingSummary(billingResult.status === 'fulfilled' ? billingResult.value : null);
        } catch (err) {
            console.error('Failed to fetch dashboard:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDashboard();
    }, []);

    const getStatusBadge = (status) => {
        switch (status) {
            case 'success': return <Chip label={t('dashboard.statuses.success')} color="success" size="small" />;
            case 'error': return <Chip label={t('dashboard.statuses.error')} color="error" size="small" />;
            case 'warning': return <Chip label={t('dashboard.statuses.warning')} color="warning" size="small" />;
            default: return <Chip label={status} size="small" />;
        }
    };

    const getEventDescription = (event) => {
        const translated = t(`dashboard.events.${event}`);
        return translated === `dashboard.events.${event}` ? event : translated;
    };

    if (error) {
        return (
            <Box sx={{ p: 3 }}>
                <Alert severity="error" action={
                    <Button color="inherit" size="small" onClick={fetchDashboard}>
                        {t('common.retry')}
                    </Button>
                }>
                    {error}
                </Alert>
            </Box>
        );
    }

    const stats = dashboardData?.stats || {};
    const recentActivity = dashboardData?.recentActivity || [];
    const formatNumber = (value) => Number(value || 0).toLocaleString(locale);
    const formatDate = (value) => {
        if (!value) return t('common.notSet');
        const parsed = new Date(String(value).replace(' ', 'T'));
        if (Number.isNaN(parsed.getTime())) return value;
        return parsed.toLocaleDateString(locale, { dateStyle: 'medium' });
    };
    const cycleEnd = billingSummary?.account?.billing_cycle_end || null;
    const cycleEndDate = cycleEnd ? new Date(String(cycleEnd).replace(' ', 'T')) : null;
    const cycleEndMs = cycleEndDate && !Number.isNaN(cycleEndDate.getTime()) ? cycleEndDate.getTime() : null;
    const daysUntilExpiry = cycleEndMs ? Math.ceil((cycleEndMs - Date.now()) / MS_PER_DAY) : null;
    const cycleBlocked = Boolean(billingSummary?.balances?.billing_cycle_blocked);
    const cycleExpired = cycleBlocked || (daysUntilExpiry !== null && daysUntilExpiry <= 0);
    const cycleNearExpiry = !cycleExpired && daysUntilExpiry !== null && daysUntilExpiry <= EXPIRY_WARNING_DAYS;
    const cycleStatusColor = !cycleEnd ? 'info' : (cycleExpired ? 'error' : (cycleNearExpiry ? 'warning' : 'success'));
    const cycleCaption = cycleExpired
        ? t('dashboard.subscriptionExpired')
        : (cycleNearExpiry
            ? t('dashboard.subscriptionEndsInDays', { count: formatNumber(daysUntilExpiry) })
            : (cycleEnd ? t('dashboard.subscriptionActive') : t('common.notSet')));
    const dashboardCards = buildTenantDashboardCards({
        stats,
        credits: dashboardData?.tenant?.credits,
        formattedCycleEnd: formatDate(cycleEnd),
        cycleCaption,
        cycleColor: cycleStatusColor,
    });

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            {/* Header */}
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, mb: 4, pb: 3, gap: { xs: 1.5, md: 0 }, borderBottom: '1px solid #d7ccba' }}>
                <Box>
                    <Typography variant="h4" component="h1" fontWeight={700} gutterBottom>
                        {t('dashboard.tenantGreeting', { name: tenant?.name || t('dashboard.tenantFallbackName') })}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {t('dashboard.tenantSubtitle')}
                    </Typography>
                </Box>
                <Button
                    variant="outlined"
                    startIcon={loading ? <CircularProgress size={20} /> : <RefreshIcon />}
                    onClick={fetchDashboard}
                    disabled={loading}
                >
                    {t('common.refresh')}
                </Button>
            </Box>

            {cycleExpired && (
                <Alert severity="error" sx={{ mb: 3 }}>
                    {t('dashboard.subscriptionExpiredNotice')}
                </Alert>
            )}
            {cycleNearExpiry && (
                <Alert severity="warning" sx={{ mb: 3 }}>
                    {t('dashboard.subscriptionExpiringNotice', { count: formatNumber(daysUntilExpiry) })}
                </Alert>
            )}

            <Typography variant="h6" component="h2" fontWeight={700} sx={{ mb: 2 }}>
                {t('dashboard.keyMetrics')}
            </Typography>
            <Grid container spacing={{ xs: 1.5, sm: 2, md: 2.5 }} sx={{ mb: 4 }}>
                {dashboardCards.map(card => {
                    const descriptionValues = Object.fromEntries(
                        Object.entries(card.descriptionValues || {}).map(([key, value]) => [key, formatNumber(value)])
                    );
                    const description = card.description
                        ?? t(card.descriptionKey, descriptionValues);
                    const value = typeof card.value === 'number' ? formatNumber(card.value) : card.value;
                    return (
                        <Grid key={card.id} size={{ xs: 12, sm: 6, lg: 4 }}>
                            <StatCard
                                title={t(card.titleKey)}
                                value={value}
                                icon={STAT_ICONS[card.icon]}
                                color={card.color}
                                description={description}
                                actionLabel={t(card.actionKey)}
                                to={card.to}
                                direction={direction}
                                loading={loading}
                            />
                        </Grid>
                    );
                })}
            </Grid>

            {/* Low Credit Alert */}
            {dashboardData?.tenant?.credits !== null && dashboardData?.tenant?.credits < 10 && (
                <Alert severity="error" sx={{ mb: 3 }}>
                    {t('dashboard.veryLowCredit', { count: dashboardData.tenant.credits })}
                </Alert>
            )}
            {dashboardData?.tenant?.credits !== null && dashboardData?.tenant?.credits >= 10 && dashboardData?.tenant?.credits < 50 && (
                <Alert severity="warning" sx={{ mb: 3 }}>
                    {t('dashboard.lowCredit', { count: dashboardData.tenant.credits })}
                </Alert>
            )}

            {/* Recent Activity */}
            <Card elevation={0}>
                <Box sx={{ p: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
                    <Typography variant="h6" component="h2" fontWeight={600}>
                        {t('dashboard.recentActivity')}
                    </Typography>
                    <Button
                        color="primary"
                        endIcon={<HistoryIcon />}
                        component={RouterLink}
                        to="/portal/inbox"
                    >
                        {t('dashboard.viewInbox')}
                    </Button>
                </Box>

                {loading ? (
                    <Box sx={{ p: 4, textAlign: 'center' }}>
                        <CircularProgress />
                    </Box>
                ) : recentActivity.length === 0 ? (
                    <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                        {t('common.noActivities')}
                    </Box>
                ) : (
                    <TableContainer sx={{ overflowX: 'auto' }}>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>{t('common.time')}</TableCell>
                                    <TableCell>{t('common.event')}</TableCell>
                                    <TableCell>{t('common.description')}</TableCell>
                                    <TableCell>{t('common.status')}</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {recentActivity.map((item) => (
                                    <TableRow key={item.id} hover>
                                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                            {new Date(item.created_at).toLocaleString(locale)}
                                        </TableCell>
                                        <TableCell>{getEventDescription(item.event_type)}</TableCell>
                                        <TableCell>{item.description}</TableCell>
                                        <TableCell>{getStatusBadge(item.status)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </Card>
        </Box>
    );
};

export default TenantDashboard;
