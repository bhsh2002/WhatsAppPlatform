import React, { useState, useEffect } from 'react';
import {
    Box,
    Grid,
    Card,
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
    Send as SendIcon,
    Inbox as InboxIcon,
    Description as TemplateIcon,
    NotificationsActive as UnreadIcon,
    Refresh as RefreshIcon,
    History as HistoryIcon,
    AccountBalanceWallet as CreditsIcon,
    WhatsApp as WhatsAppIcon,
    Facebook as FacebookIcon,
    EventAvailable as SubscriptionIcon
} from '@mui/icons-material';
import { useAuth } from '../../context/AuthContext';
import api from '../../api';
import { useLanguage } from '../../context/LanguageContext';

const EXPIRY_WARNING_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const TenantDashboard = () => {
    const { tenant } = useAuth();
    const { locale, t } = useLanguage();
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

    const StatCard = ({ title, value, icon, color, description }) => (
        <Card elevation={2} sx={{ height: '100%' }}>
            <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                        {title}
                    </Typography>
                    <Box sx={{
                        p: 1,
                        borderRadius: '50%',
                        bgcolor: `${color}.light`,
                        color: `${color}.main`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        {icon}
                    </Box>
                </Box>
                <Typography variant="h4" fontWeight={600} gutterBottom>
                    {loading ? '-' : value}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    {description}
                </Typography>
            </CardContent>
        </Card>
    );

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
    const formatDateTime = (value) => {
        if (!value) return t('common.notSet');
        const parsed = new Date(String(value).replace(' ', 'T'));
        if (Number.isNaN(parsed.getTime())) return value;
        return parsed.toLocaleString(locale);
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
        ? 'منتهي'
        : (cycleNearExpiry ? `ينتهي خلال ${formatNumber(daysUntilExpiry)} يوم` : (cycleEnd ? 'نشط' : t('common.notSet')));

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            {/* Header */}
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, mb: 4, gap: { xs: 1, md: 0 } }}>
                <Box>
                    <Typography variant="h4" fontWeight={700} gutterBottom>
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
                    انتهت فترة الاشتراك، ولا يمكن تنفيذ عمليات جديدة حتى يتم تجديد الباقة.
                </Alert>
            )}
            {cycleNearExpiry && (
                <Alert severity="warning" sx={{ mb: 3 }}>
                    فترة الاشتراك ستنتهي خلال {formatNumber(daysUntilExpiry)} يوم. يرجى التواصل مع الإدارة لتجديد الباقة.
                </Alert>
            )}

            {/* Stats Grid */}
            <Grid container spacing={3} sx={{ mb: 4 }}>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <StatCard
                        title={t('dashboard.totalConversations')}
                        value={formatNumber(stats.totalConversations)}
                        icon={<ChatIcon />}
                        color="primary"
                        description={t('dashboard.whatsappMessenger')}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <StatCard
                        title={t('dashboard.sentToday')}
                        value={formatNumber(stats.sentToday)}
                        icon={<SendIcon />}
                        color="success"
                        description={t('dashboard.whatsappMessenger')}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <StatCard
                        title={t('dashboard.receivedToday')}
                        value={formatNumber(stats.receivedToday)}
                        icon={<InboxIcon />}
                        color="info"
                        description={t('dashboard.whatsappMessenger')}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <StatCard
                        title={t('dashboard.unreadMessages')}
                        value={formatNumber(stats.unreadCount)}
                        icon={<UnreadIcon />}
                        color="warning"
                        description={t('dashboard.whatsappMessenger')}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <StatCard
                        title={t('dashboard.templates')}
                        value={formatNumber(stats.templatesCount)}
                        icon={<TemplateIcon />}
                        color="secondary"
                        description="WhatsApp"
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <StatCard
                        title={t('dashboard.messagesToday')}
                        value={formatNumber(stats.messagesToday)}
                        icon={<ChatIcon />}
                        color="primary"
                        description={t('dashboard.whatsappMessenger')}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <StatCard
                        title={t('dashboard.remainingCredits')}
                        value={dashboardData?.tenant?.credits ?? '—'}
                        icon={<CreditsIcon />}
                        color={
                            (dashboardData?.tenant?.credits ?? 999) > 100 ? 'success' :
                            (dashboardData?.tenant?.credits ?? 999) >= 10 ? 'warning' : 'error'
                        }
                        description={t('dashboard.messageCredits')}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <StatCard
                        title="انتهاء الاشتراك"
                        value={formatDateTime(cycleEnd)}
                        icon={<SubscriptionIcon />}
                        color={cycleStatusColor}
                        description={cycleCaption}
                    />
                </Grid>
            </Grid>

            <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                {t('dashboard.channelSummary')}
            </Typography>
            <Grid container spacing={3} sx={{ mb: 4 }}>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title={t('dashboard.whatsappToday')}
                        value={formatNumber(stats.whatsappMessagesToday)}
                        icon={<WhatsAppIcon />}
                        color="success"
                        description={t('dashboard.sentReceived', { sent: formatNumber(stats.whatsappSentToday), received: formatNumber(stats.whatsappReceivedToday) })}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title={t('dashboard.messengerToday')}
                        value={formatNumber(stats.messengerMessagesToday)}
                        icon={<FacebookIcon />}
                        color="primary"
                        description={t('dashboard.sentReceived', { sent: formatNumber(stats.messengerSentToday), received: formatNumber(stats.messengerReceivedToday) })}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title={t('dashboard.messengerConversations')}
                        value={formatNumber(stats.messengerConversations)}
                        icon={<FacebookIcon />}
                        color="info"
                        description={t('dashboard.unreadCount', { count: formatNumber(stats.messengerUnread) })}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title={t('dashboard.facebookPages')}
                        value={formatNumber(stats.linkedFacebookPages)}
                        icon={<FacebookIcon />}
                        color="secondary"
                        description={t('dashboard.facebookActionsWeek', { count: formatNumber(stats.facebookActionsWeek) })}
                    />
                </Grid>
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
            <Card elevation={2}>
                <Box sx={{ p: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
                    <Typography variant="h6" fontWeight={600}>
                        {t('dashboard.recentActivity')}
                    </Typography>
                    <Button
                        color="primary"
                        endIcon={<HistoryIcon />}
                        href="/portal/inbox"
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
