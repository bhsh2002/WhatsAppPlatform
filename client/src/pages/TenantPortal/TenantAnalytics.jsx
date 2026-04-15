import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Typography, Paper, Grid, Card, CardContent, Chip, CircularProgress,
    Alert, Snackbar, Table, TableBody, TableCell, TableContainer, TableHead, TableRow
} from '@mui/material';
import { Analytics as AnalyticsIcon, TrendingUp, TrendingDown, Message as MessageIcon } from '@mui/icons-material';
import api from '../../api';

const TenantAnalytics = () => {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const loadStats = useCallback(async () => {
        try {
            setLoading(true);
            const data = await api.getPortalAnalytics();
            setStats(data);
        } catch (err) {
            setError(err.message || 'فشل تحميل الإحصائيات');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadStats(); }, [loadStats]);

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
                <CircularProgress />
            </Box>
        );
    }

    const statCards = [
        { label: 'إجمالي الرسائل', value: stats?.totalMessages || 0, color: '#2196f3', icon: <MessageIcon /> },
        { label: 'المرسلة', value: stats?.sentMessages || 0, color: '#4caf50', icon: <TrendingUp /> },
        { label: 'المستقبلة', value: stats?.receivedMessages || 0, color: '#ff9800', icon: <TrendingDown /> },
        { label: 'الفاشلة', value: stats?.failedMessages || 0, color: '#f44336', icon: <TrendingDown /> },
    ];

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                <AnalyticsIcon sx={{ fontSize: 32, color: 'secondary.main' }} />
                <Box>
                    <Typography variant="h5" fontWeight={700}>التحليلات</Typography>
                    <Typography variant="body2" color="text.secondary">إحصائيات الرسائل والمحادثات</Typography>
                </Box>
            </Box>

            <Grid container spacing={3} sx={{ mb: 4 }}>
                {statCards.map((card, i) => (
                    <Grid size={{ xs: 6, md: 3 }} key={i}>
                        <Card sx={{ bgcolor: card.color + '10', border: `1px solid ${card.color}30` }}>
                            <CardContent sx={{ textAlign: 'center' }}>
                                <Box sx={{ color: card.color, mb: 1 }}>{card.icon}</Box>
                                <Typography variant="h4" fontWeight={700} sx={{ color: card.color }}>{card.value}</Typography>
                                <Typography variant="body2" color="text.secondary">{card.label}</Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                ))}
            </Grid>

            <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 7 }}>
                    <Paper sx={{ p: 3 }}>
                        <Typography variant="h6" gutterBottom fontWeight={600}>النشاط اليومي (آخر 30 يوم)</Typography>
                        <TableContainer sx={{ overflowX: 'auto' }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>التاريخ</TableCell>
                                        <TableCell align="center">المرسلة</TableCell>
                                        <TableCell align="center">المستقبلة</TableCell>
                                        <TableCell align="center">الإجمالي</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {(stats?.dailyBreakdown || []).slice(0, 15).map((day, i) => (
                                        <TableRow key={i}>
                                            <TableCell>{day.date}</TableCell>
                                            <TableCell align="center">
                                                <Chip label={day.sent} size="small" color="success" variant="outlined" />
                                            </TableCell>
                                            <TableCell align="center">
                                                <Chip label={day.received} size="small" color="warning" variant="outlined" />
                                            </TableCell>
                                            <TableCell align="center">
                                                <Chip label={day.total} size="small" color="primary" />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {(!stats?.dailyBreakdown || stats.dailyBreakdown.length === 0) && (
                                        <TableRow>
                                            <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                                                لا توجد بيانات بعد
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </Paper>
                </Grid>

                <Grid size={{ xs: 12, md: 5 }}>
                    <Paper sx={{ p: 3 }}>
                        <Typography variant="h6" gutterBottom fontWeight={600}>توزيع أنواع الرسائل</Typography>
                        {(stats?.typeDistribution || []).map((type, i) => (
                            <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1.5, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                <Chip label={type.message_type || 'غير محدد'} size="small" variant="outlined" />
                                <Typography variant="h6" fontWeight={600}>{type.count}</Typography>
                            </Box>
                        ))}
                        {(!stats?.typeDistribution || stats.typeDistribution.length === 0) && (
                            <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>لا توجد بيانات</Typography>
                        )}
                    </Paper>
                </Grid>
            </Grid>

            <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError('')}>
                <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
            </Snackbar>
        </Box>
    );
};

export default TenantAnalytics;
