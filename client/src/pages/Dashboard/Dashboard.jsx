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
    History as HistoryIcon
} from '@mui/icons-material';
import api from '../../api';

const Dashboard = () => {
    const navigate = useNavigate();
    const { stats, fetchStats, loading: statsLoading } = useTenants();
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
            case 'success': return <Chip label="تم بنجاح" color="success" size="small" />;
            case 'error': return <Chip label="فشل" color="error" size="small" />;
            case 'warning': return <Chip label="تحذير" color="warning" size="small" />;
            default: return <Chip label={status} size="small" />;
        }
    };

    const getEventDescription = (event) => {
        const descriptions = {
            'template_sent': 'إرسال حملة (Template)',
            'message_sent': 'إرسال رسالة',
            'message_received': 'رسالة واردة',
            'message_failed': 'فشل إرسال',
            'webhook_update': 'تحديث Webhook',
            'quality_drop': 'انخفاض الجودة',
            'quality_update': 'تحديث جودة الرقم',
            'tenant_created': 'إضافة عميل جديد',
            'tenant_updated': 'تحديث بيانات العميل',
            'tenant_deleted': 'حذف عميل',
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
                        نظرة عامة
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        ملخص أداء المنصة وحالة العملاء لليوم.
                    </Typography>
                </Box>
                <Button
                    variant="outlined"
                    startIcon={statsLoading || activityLoading ? <CircularProgress size={20} /> : <RefreshIcon />}
                    onClick={handleRefresh}
                    disabled={statsLoading || activityLoading}
                >
                    تحديث
                </Button>
            </Box>

            {/* Stats Grid */}
            <Grid container spacing={3} sx={{ mb: 4 }}>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title="إجمالي العملاء"
                        value={stats.total}
                        icon={<PeopleIcon />}
                        color="primary"
                        description="جميع الشركات المسجلة"
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title="عملاء نشطين"
                        value={stats.active}
                        icon={<CheckCircleIcon />}
                        color="success"
                        description="حالة الربط والتشغيل سليمة"
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title="تحتاج انتباه"
                        value={stats.warning}
                        icon={<WarningIcon />}
                        color="warning"
                        description="جودة متوسطة أو اقتراب من الحدود"
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title="مشاكل حرجة"
                        value={stats.critical}
                        icon={<ErrorIcon />}
                        color="error"
                        description="حظر أو انقطاع خدمة"
                    />
                </Grid>
            </Grid>

            {/* Recent Activity */}
            <Card elevation={2}>
                <Box sx={{ p: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
                    <Typography variant="h6" fontWeight={600}>
                        النشاط الأخير
                    </Typography>
                    <Button
                        color="primary"
                        endIcon={<HistoryIcon />}
                        onClick={() => navigate('/logs')}
                    >
                        عرض السجل الكامل
                    </Button>
                </Box>

                {activityLoading ? (
                    <Box sx={{ p: 4, textAlign: 'center' }}>
                        <CircularProgress />
                    </Box>
                ) : activity.length === 0 ? (
                    <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                        لا توجد أنشطة حتى الآن
                    </Box>
                ) : (
                    <TableContainer>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>الوقت</TableCell>
                                    <TableCell>العميل</TableCell>
                                    <TableCell>الحدث</TableCell>
                                    <TableCell>الحالة</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {activity.map((item) => (
                                    <TableRow key={item.id} hover>
                                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{item.relativeTime}</TableCell>
                                        <TableCell>{item.tenant_name || 'غير محدد'}</TableCell>
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
