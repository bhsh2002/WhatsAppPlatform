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
    Cancel as CancelIcon,
    Add as AddIcon,
    Delete as DeleteIcon
} from '@mui/icons-material';
import api from '../../api';
import FacebookConnect from '../../components/Facebook/FacebookConnect';

const TenantFacebookPages = () => {
    const [pages, setPages] = useState([]);
    const [diagnostics, setDiagnostics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    const [subStatusPage, setSubStatusPage] = useState(null);
    const [subStatusData, setSubStatusData] = useState(null);
    const [subStatusLoading, setSubStatusLoading] = useState(false);

    const [disconnectDialog, setDisconnectDialog] = useState(null);
    const [disconnecting, setDisconnecting] = useState(false);

    const [showConnect, setShowConnect] = useState(false);

    const fetchPages = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            const [data, diag] = await Promise.all([
                api.getPortalPages(),
                api.getFacebookDiagnostics().catch(() => null),
            ]);
            setPages(Array.isArray(data) ? data : []);
            setDiagnostics(diag);
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

    const handleDisconnect = async () => {
        if (!disconnectDialog) return;
        try {
            setDisconnecting(true);
            await api.disconnectFacebookPage(disconnectDialog.id);
            setSnackbar({ open: true, message: `تم إلغاء ربط ${disconnectDialog.page_name}`, severity: 'success' });
            setDisconnectDialog(null);
            fetchPages();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل إلغاء الربط', severity: 'error' });
        } finally {
            setDisconnecting(false);
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
                        <Typography variant="body2" color="text.secondary">ربط صفحات Facebook وإدارة اشتراكات Webhook الخاصة بها</Typography>
                    </Box>
                </Box>
            </Box>

            <Paper sx={{ p: 2, mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <Box>
                        <Typography variant="h6">صفحات فيسبوك المربوطة</Typography>
                        <Typography variant="body2" color="text.secondary">
                            هذه الصفحة مخصصة لـ Facebook Pages فقط. ربط WhatsApp موجود في قسم WhatsApp.
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setShowConnect(!showConnect)}>
                            {showConnect ? 'إخفاء' : 'ربط صفحة جديدة'}
                        </Button>
                        <Button startIcon={<RefreshIcon />} onClick={fetchPages} variant="outlined">
                            تحديث
                        </Button>
                    </Box>
                </Box>
            </Paper>

            {showConnect && (
                <Box sx={{ mb: 3 }}>
                    <FacebookConnect onComplete={() => { setShowConnect(false); fetchPages(); }} />
                </Box>
            )}

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            {diagnostics?.facebook_user_token_present && (
                <Alert severity={diagnostics.missing_scopes?.length ? 'warning' : 'success'} sx={{ mb: 2 }}>
                    <Typography variant="body2" fontWeight={600}>
                        حالة صلاحيات Facebook: {diagnostics.missing_scopes?.length ? 'تحتاج إعادة تفويض' : 'مكتملة'}
                    </Typography>
                    <Typography variant="caption" component="div">
                        الأذونات الممنوحة: {diagnostics.granted_scopes?.length || 0} / {diagnostics.requested_scopes?.length || 0}
                    </Typography>
                    {diagnostics.missing_scopes?.length > 0 && (
                        <Typography variant="caption" component="div">
                            الناقصة: {diagnostics.missing_scopes.join(', ')}
                        </Typography>
                    )}
                </Alert>
            )}

            {diagnostics?.facebook_user_token_present && (
                <Paper sx={{ p: 2, mb: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        <Avatar src={diagnostics.facebook_user_identity?.picture_url || undefined} sx={{ bgcolor: '#1877f2' }}>
                            {diagnostics.facebook_user_identity?.name?.charAt(0) || <FacebookIcon />}
                        </Avatar>
                        <Box sx={{ flex: 1, minWidth: 220 }}>
                            <Typography variant="subtitle1" fontWeight={700}>
                                {diagnostics.facebook_user_identity?.name || 'هوية مستخدم Facebook غير محفوظة'}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                {diagnostics.facebook_user_identity?.email || 'البريد غير متاح من Meta'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" component="div">
                                ID: {diagnostics.facebook_user_identity?.id || '-'} | آخر تحديث: {formatDate(diagnostics.facebook_user_identity?.updated_at)}
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            <Chip
                                label={diagnostics.facebook_user_identity?.public_profile_ready ? 'public_profile مثبت' : 'public_profile يحتاج إعادة تفويض'}
                                color={diagnostics.facebook_user_identity?.public_profile_ready ? 'success' : 'warning'}
                                size="small"
                                variant="outlined"
                            />
                            <Chip
                                label={diagnostics.facebook_user_identity?.email_ready ? 'email مثبت' : diagnostics.facebook_user_identity?.email_granted ? 'email ممنوح بدون بريد مرجع' : 'email غير ممنوح'}
                                color={diagnostics.facebook_user_identity?.email_ready ? 'success' : 'warning'}
                                size="small"
                                variant="outlined"
                            />
                        </Box>
                    </Box>
                </Paper>
            )}

            {pages.length === 0 ? (
                <Paper sx={{ p: 6, textAlign: 'center' }}>
                    <FacebookIcon sx={{ fontSize: 60, color: 'grey.300', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">لا توجد صفحات مربوطة</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        اربط صفحة فيسبوك للبدء
                    </Typography>
                    <Button variant="contained" startIcon={<AddIcon />} onClick={() => setShowConnect(true)}>
                        ربط صفحة
                    </Button>
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
                                        <Box sx={{ display: 'flex', gap: 1 }}>
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
                                            <Button
                                                size="small"
                                                variant="text"
                                                color="error"
                                                startIcon={<DeleteIcon />}
                                                onClick={() => setDisconnectDialog(page)}
                                            >
                                                إلغاء الربط
                                            </Button>
                                        </Box>
                                    </Box>

                                    {subStatusPage === page.id && subStatusData && (
                                        <Alert severity="info" sx={{ mt: 1.5, fontSize: '0.8rem' }}>
                                            <Typography variant="caption" component="div">
                                                حالة قاعدة البيانات: {subStatusData.webhook_subscribed_in_db ? 'مشترك' : 'غير مشترك'}
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


            <Dialog open={!!disconnectDialog} onClose={() => setDisconnectDialog(null)}>
                <DialogTitle>إلغاء ربط الصفحة</DialogTitle>
                <DialogContent>
                    <Typography>
                        هل أنت متأكد من إلغاء ربط صفحة "{disconnectDialog?.page_name}"؟
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        سيتم إلغاء اشتراك Webhook وحذف بيانات الصفحة من حسابك.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDisconnectDialog(null)}>إلغاء</Button>
                    <Button onClick={handleDisconnect} color="error" variant="contained" disabled={disconnecting}>
                        {disconnecting ? <CircularProgress size={20} /> : 'إلغاء الربط'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default TenantFacebookPages;
