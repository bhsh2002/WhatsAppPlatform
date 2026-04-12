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
    AccountBalanceWallet as CreditsIcon
} from '@mui/icons-material';
import { useAuth } from '../../context/AuthContext';
import api from '../../api';

const TenantDashboard = () => {
    const { tenant } = useAuth();
    const [dashboardData, setDashboardData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchDashboard = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await api.getPortalDashboard();
            setDashboardData(data);
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
            case 'success': return <Chip label="تم بنجاح" color="success" size="small" />;
            case 'error': return <Chip label="فشل" color="error" size="small" />;
            case 'warning': return <Chip label="تحذير" color="warning" size="small" />;
            default: return <Chip label={status} size="small" />;
        }
    };

    const getEventDescription = (event) => {
        const descriptions = {
            'template_sent': 'إرسال قالب',
            'message_sent': 'إرسال رسالة',
            'message_received': 'رسالة واردة',
            'message_failed': 'فشل إرسال',
        };
        return descriptions[event] || event;
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
                        إعادة المحاولة
                    </Button>
                }>
                    {error}
                </Alert>
            </Box>
        );
    }

    const stats = dashboardData?.stats || {};
    const recentActivity = dashboardData?.recentActivity || [];

    return (
        <Box sx={{ p: 3 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Box>
                    <Typography variant="h4" fontWeight={700} gutterBottom>
                        مرحباً، {tenant?.name || 'العميل'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        لوحة القيادة الخاصة بك - ملخص نشاطك اليومي
                    </Typography>
                </Box>
                <Button
                    variant="outlined"
                    startIcon={loading ? <CircularProgress size={20} /> : <RefreshIcon />}
                    onClick={fetchDashboard}
                    disabled={loading}
                >
                    تحديث
                </Button>
            </Box>

            {/* Stats Grid */}
            <Grid container spacing={3} sx={{ mb: 4 }}>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <StatCard
                        title="إجمالي المحادثات"
                        value={stats.totalConversations}
                        icon={<ChatIcon />}
                        color="primary"
                        description="جميع المحادثات مع الزبائن"
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <StatCard
                        title="الرسائل المرسلة اليوم"
                        value={stats.sentToday}
                        icon={<SendIcon />}
                        color="success"
                        description="الرسائل الصادرة اليوم"
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <StatCard
                        title="الرسائل الواردة اليوم"
                        value={stats.receivedToday}
                        icon={<InboxIcon />}
                        color="info"
                        description="الرسائل المستقبلة اليوم"
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <StatCard
                        title="رسائل غير مقروءة"
                        value={stats.unreadCount}
                        icon={<UnreadIcon />}
                        color="warning"
                        description="تحتاج انتباهك"
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <StatCard
                        title="القوالب"
                        value={stats.templatesCount}
                        icon={<TemplateIcon />}
                        color="secondary"
                        description="قوالب الرسائل المحفوظة"
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <StatCard
                        title="رسائل اليوم"
                        value={stats.messagesToday}
                        icon={<ChatIcon />}
                        color="primary"
                        description="إجمالي الرسائل اليوم"
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <StatCard
                        title="الرصيد المتبقي"
                        value={dashboardData?.tenant?.credits ?? '—'}
                        icon={<CreditsIcon />}
                        color={
                            (dashboardData?.tenant?.credits ?? 999) > 100 ? 'success' :
                            (dashboardData?.tenant?.credits ?? 999) >= 10 ? 'warning' : 'error'
                        }
                        description="رصيد إرسال الرسائل"
                    />
                </Grid>
            </Grid>

            {/* Low Credit Alert */}
            {dashboardData?.tenant?.credits !== null && dashboardData?.tenant?.credits < 10 && (
                <Alert severity="error" sx={{ mb: 3 }}>
                    ⚠️ رصيدك منخفض جداً ({dashboardData.tenant.credits} رسالة متبقية). تواصل مع المدير لإعادة الشحن.
                </Alert>
            )}
            {dashboardData?.tenant?.credits !== null && dashboardData?.tenant?.credits >= 10 && dashboardData?.tenant?.credits < 50 && (
                <Alert severity="warning" sx={{ mb: 3 }}>
                    رصيدك يقترب من النفاد ({dashboardData.tenant.credits} رسالة متبقية). تواصل مع المدير لإعادة الشحن.
                </Alert>
            )}

            {/* Recent Activity */}
            <Card elevation={2}>
                <Box sx={{ p: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
                    <Typography variant="h6" fontWeight={600}>
                        النشاط الأخير
                    </Typography>
                    <Button
                        color="primary"
                        endIcon={<HistoryIcon />}
                        href="/portal/chat"
                    >
                        عرض المحادثات
                    </Button>
                </Box>

                {loading ? (
                    <Box sx={{ p: 4, textAlign: 'center' }}>
                        <CircularProgress />
                    </Box>
                ) : recentActivity.length === 0 ? (
                    <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                        لا توجد أنشطة حتى الآن
                    </Box>
                ) : (
                    <TableContainer>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>الوقت</TableCell>
                                    <TableCell>الحدث</TableCell>
                                    <TableCell>الوصف</TableCell>
                                    <TableCell>الحالة</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {recentActivity.map((item) => (
                                    <TableRow key={item.id} hover>
                                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                            {new Date(item.created_at).toLocaleString('ar-LY')}
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
