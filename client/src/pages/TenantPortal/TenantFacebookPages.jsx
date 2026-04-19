import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Paper, Typography, CircularProgress, Alert, Snackbar, Grid,
    Card, CardContent, Chip, Avatar, Button, Dialog, DialogTitle,
    DialogContent, DialogActions, Divider
} from '@mui/material';
import {
    Facebook as FacebookIcon,
    CloudDone as CloudDoneIcon,
    CloudOff as CloudOffIcon,
    Refresh as RefreshIcon,
    CheckCircle as CheckCircleIcon,
    Cancel as CancelIcon
} from '@mui/icons-material';
import api from '../../api';

const TenantFacebookPages = () => {
    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    const [subStatusPage, setSubStatusPage] = useState(null);
    const [subStatusData, setSubStatusData] = useState(null);
    const [subStatusLoading, setSubStatusLoading] = useState(false);

    const fetchPages = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            const data = await api.getPortalPages();
            setPages(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err.message || 'فشل جلب صفحات فيسبوك');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchPages(); }, [fetchPages]);

    const checkSubscription = async (page) => {
        try {
            setSubStatusLoading(true);
            setSubStatusPage(page.id);
            const data = await api.getPortalPageSubscriptionStatus(page.id);
            setSubStatusData(data);
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل جلب حالة الاشتراك', severity: 'error' });
        } finally {
            setSubStatusLoading(false);
        }
    };

    const formatDate = (ts) => {
        if (!ts) return '';
        try { return new Date(ts).toLocaleDateString('ar-LY'); } catch { return ts; }
    };

    if (loading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}><CircularProgress /></Box>;
    }

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, mb: 3, gap: { xs: 1, md: 0 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <FacebookIcon sx={{ fontSize: 32, color: '#1877f2' }} />
                    <Box>
                        <Typography variant="h4" fontWeight={700}>صفحات فيسبوك</Typography>
                        <Typography variant="body2" color="text.secondary">الصفحات المربوطة بحسابك</Typography>
                    </Box>
                </Box>
                <Button startIcon={<RefreshIcon />} onClick={fetchPages} variant="outlined">
                    تحديث
                </Button>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            {pages.length === 0 ? (
                <Paper sx={{ p: 6, textAlign: 'center' }}>
                    <FacebookIcon sx={{ fontSize: 60, color: 'grey.300', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">لا توجد صفحات مربوطة</Typography>
                    <Typography variant="body2" color="text.secondary">
                        تواصل مع المدير لربط صفحة فيسبوك بحسابك
                    </Typography>
                </Paper>
            ) : (
                <Grid container spacing={3}>
                    {pages.map(page => (
                        <Grid size={{ xs: 12, md: 6 }} key={page.id}>
                            <Card sx={{ height: '100%' }}>
                                <CardContent>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                                        <Avatar
                                            src={page.page_picture_url}
                                            sx={{ width: 56, height: 56, bgcolor: '#1877f2' }}
                                        >
                                            <FacebookIcon />
                                        </Avatar>
                                        <Box sx={{ flex: 1 }}>
                                            <Typography variant="h6" fontWeight={600}>
                                                {page.page_name || page.page_id}
                                            </Typography>
                                            {page.page_category && (
                                                <Typography variant="body2" color="text.secondary">
                                                    {page.page_category}
                                                </Typography>
                                            )}
                                        </Box>
                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-end' }}>
                                            {page.is_active ? (
                                                <Chip icon={<CheckCircleIcon />} label="مفعلة" size="small" color="success" />
                                            ) : (
                                                <Chip icon={<CancelIcon />} label="معطلة" size="small" color="error" />
                                            )}
                                            {page.webhook_subscribed ? (
                                                <Chip icon={<CloudDoneIcon />} label="Webhook مشترك" size="small" color="primary" variant="outlined" />
                                            ) : (
                                                <Chip icon={<CloudOffIcon />} label="بدون Webhook" size="small" color="warning" variant="outlined" />
                                            )}
                                        </Box>
                                    </Box>

                                    <Divider sx={{ my: 1.5 }} />

                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <Typography variant="caption" color="text.secondary">
                                            رُبطت في {formatDate(page.created_at)}
                                        </Typography>
                                        <Button
                                            size="small"
                                            variant="text"
                                            onClick={() => checkSubscription(page)}
                                            disabled={subStatusLoading && subStatusPage === page.id}
                                        >
                                            {subStatusLoading && subStatusPage === page.id
                                                ? 'جاري التحقق...'
                                                : 'حالة الاشتراك'}
                                        </Button>
                                    </Box>

                                    {subStatusPage === page.id && subStatusData && (
                                        <Alert severity="info" sx={{ mt: 1.5, fontSize: '0.8rem' }}>
                                            <Typography variant="caption" component="div">
                                                حالة قاعدة البيانات: {subStatusData.webhook_subscribed_in_db ? 'مشترك ✅' : 'غير مشترك ❌'}
                                            </Typography>
                                            {subStatusData.meta_response?.data?.length > 0 && (
                                                <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                                                    الحقول المشترك بها: {subStatusData.meta_response.data.map(s => s.name || s).join(', ')}
                                                </Typography>
                                            )}
                                        </Alert>
                                    )}
                                </CardContent>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            )}

            <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default TenantFacebookPages;
