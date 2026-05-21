import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTenants } from '../../context/TenantContext';
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
    Paper,
    Chip,
    IconButton,
    CircularProgress
} from '@mui/material';
import {
    People as PeopleIcon,
    CheckCircle as CheckCircleIcon,
    Warning as WarningIcon,
    Error as ErrorIcon,
    Refresh as RefreshIcon,
    History as HistoryIcon,
    WhatsApp as WhatsAppIcon,
    Facebook as FacebookIcon,
    Mail as MailIcon,
    Link as LinkIcon
} from '@mui/icons-material';
import api from '../../api';
import { useLanguage } from '../../context/LanguageContext';

const Dashboard = () => {
    const navigate = useNavigate();
    const { stats, fetchStats, loading: statsLoading } = useTenants();
    const { locale, t } = useLanguage();
    const [activity, setActivity] = useState([]);
    const [activityLoading, setActivityLoading] = useState(true);

    const fetchActivity = async () => {
        try {
            setActivityLoading(true);
            const data = await api.getActivity(5);
            setActivity(data);
        } catch (error) {
            console.error('Failed to fetch activity:', error);
        } finally {
            setActivityLoading(false);
        }
    };

    useEffect(() => {
        fetchActivity();
    }, []);

    const handleRefresh = () => {
        fetchStats();
        fetchActivity();
    };

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
                    {statsLoading ? '-' : value}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    {description}
                </Typography>
            </CardContent>
        </Card>
    );

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            {/* Header */}
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, mb: 4, gap: { xs: 1, md: 0 } }}>
                <Box>
                    <Typography variant="h4" fontWeight={700} gutterBottom>
                        {t('dashboard.overview')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {t('dashboard.overviewSubtitle')}
                    </Typography>
                </Box>
                <Button
                    variant="outlined"
                    startIcon={statsLoading || activityLoading ? <CircularProgress size={20} /> : <RefreshIcon />}
                    onClick={handleRefresh}
                    disabled={statsLoading || activityLoading}
                >
                    {t('common.refresh')}
                </Button>
            </Box>

            {/* Tenant Stats Grid */}
            <Grid container spacing={3} sx={{ mb: 4 }}>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title={t('dashboard.totalTenants')}
                        value={stats.total}
                        icon={<PeopleIcon />}
                        color="primary"
                        description={t('dashboard.totalTenantsCaption')}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title={t('dashboard.activeTenants')}
                        value={stats.active}
                        icon={<CheckCircleIcon />}
                        color="success"
                        description={t('dashboard.activeTenantsCaption')}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title={t('dashboard.attentionNeeded')}
                        value={stats.warning}
                        icon={<WarningIcon />}
                        color="warning"
                        description={t('dashboard.attentionNeededCaption')}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title={t('dashboard.criticalIssues')}
                        value={stats.critical}
                        icon={<ErrorIcon />}
                        color="error"
                        description={t('dashboard.criticalIssuesCaption')}
                    />
                </Grid>
            </Grid>

            {/* Message Stats */}
            <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                {t('dashboard.messageStats')}
            </Typography>
            <Grid container spacing={3} sx={{ mb: 3 }}>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title={t('dashboard.todayTotal')}
                        value={(stats.total_messages_today || 0).toLocaleString(locale)}
                        icon={<MailIcon />}
                        color="info"
                        description={t('dashboard.whatsappMessenger')}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title={t('dashboard.whatsappToday')}
                        value={(stats.wa_today || 0).toLocaleString(locale)}
                        icon={<WhatsAppIcon />}
                        color="success"
                        description={t('dashboard.whatsappMessagesToday')}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title={t('dashboard.messengerToday')}
                        value={(stats.fb_today || 0).toLocaleString(locale)}
                        icon={<FacebookIcon />}
                        color="primary"
                        description={t('dashboard.messengerMessagesToday')}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title={t('dashboard.linkedPages')}
                        value={stats.linked_pages || 0}
                        icon={<LinkIcon />}
                        color="secondary"
                        description={t('dashboard.activeFacebookPages')}
                    />
                </Grid>
            </Grid>

            {/* Channel Distribution */}
            {(stats.wa_week > 0 || stats.fb_week > 0) && (
                <Card elevation={2} sx={{ mb: 3 }}>
                    <CardContent>
                        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                            {t('dashboard.channelDistribution')}
                        </Typography>
                        {(() => {
                            const waWeek = stats.wa_week || 0;
                            const fbWeek = stats.fb_week || 0;
                            const total = waWeek + fbWeek || 1;
                            const waPct = Math.round((waWeek / total) * 100);
                            const fbPct = 100 - waPct;
                            return (
                                <Box>
                                    <Box sx={{ mb: 1.5 }}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                            <Typography variant="body2" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <WhatsAppIcon sx={{ fontSize: 16, color: '#25D366' }} /> WhatsApp
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">
                                                {waWeek.toLocaleString(locale)} ({waPct}%)
                                            </Typography>
                                        </Box>
                                        <Box sx={{ width: '100%', height: 8, bgcolor: 'grey.200', borderRadius: 1 }}>
                                            <Box sx={{ width: `${waPct}%`, height: '100%', bgcolor: '#25D366', borderRadius: 1 }} />
                                        </Box>
                                    </Box>
                                    <Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                            <Typography variant="body2" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <FacebookIcon sx={{ fontSize: 16, color: '#0084ff' }} /> Messenger
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">
                                                {fbWeek.toLocaleString(locale)} ({fbPct}%)
                                            </Typography>
                                        </Box>
                                        <Box sx={{ width: '100%', height: 8, bgcolor: 'grey.200', borderRadius: 1 }}>
                                            <Box sx={{ width: `${fbPct}%`, height: '100%', bgcolor: '#0084ff', borderRadius: 1 }} />
                                        </Box>
                                    </Box>
                                </Box>
                            );
                        })()}
                    </CardContent>
                </Card>
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
                        onClick={() => navigate('/logs')}
                    >
                        {t('dashboard.viewFullLog')}
                    </Button>
                </Box>

                {activityLoading ? (
                    <Box sx={{ p: 4, textAlign: 'center' }}>
                        <CircularProgress />
                    </Box>
                ) : activity.length === 0 ? (
                    <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                        {t('common.noActivities')}
                    </Box>
                ) : (
                    <TableContainer sx={{ overflowX: 'auto' }}>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>{t('common.time')}</TableCell>
                                    <TableCell>{t('common.tenant')}</TableCell>
                                    <TableCell>{t('common.event')}</TableCell>
                                    <TableCell>{t('common.status')}</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {activity.map((item) => (
                                    <TableRow key={item.id} hover>
                                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{item.relativeTime}</TableCell>
                                        <TableCell>{item.tenant_name || t('common.unspecified')}</TableCell>
                                        <TableCell>{item.description || getEventDescription(item.event_type)}</TableCell>
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

export default Dashboard;
