import React, { useEffect, useMemo, useState } from 'react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Button,
    Grid,
    Chip,
    Alert,
    CircularProgress,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
} from '@mui/material';
import {
    Webhook as WebhookIcon,
    Refresh as RefreshIcon,
    PlayArrow as SubscribeIcon,
    CheckCircle as CheckCircleIcon,
    Cancel as CancelIcon,
} from '@mui/icons-material';
import api from '../../api';

const fieldLabel = {
    messages: 'الرسائل والحالات',
    message_template_status_update: 'تحديثات القوالب',
    account_alerts: 'تنبيهات الحساب',
};

const WebhookSubscriptions = () => {
    const [tenants, setTenants] = useState([]);
    const [selectedTenant, setSelectedTenant] = useState('');
    const [diagnostic, setDiagnostic] = useState(null);
    const [loading, setLoading] = useState(false);
    const [subscribing, setSubscribing] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const selectedTenantData = useMemo(
        () => tenants.find(t => String(t.id) === String(selectedTenant)),
        [tenants, selectedTenant],
    );

    const fetchTenants = async () => {
        try {
            const data = await api.getTenants();
            setTenants(data);
            const tenantWithWaba = data.find(t => t.waba_id);
            if (tenantWithWaba) setSelectedTenant(String(tenantWithWaba.id));
        } catch {
            setError('فشل جلب قائمة العملاء');
        }
    };

    const fetchSubscriptions = async () => {
        if (!selectedTenant) return;
        setLoading(true);
        setError('');
        try {
            const data = await api.getWebhookSubscriptions(selectedTenant);
            setDiagnostic(data);
        } catch (err) {
            setError(err.message || 'فشل جلب اشتراكات WABA Webhook');
            setDiagnostic(null);
        } finally {
            setLoading(false);
        }
    };

    const handleSubscribe = async () => {
        if (!selectedTenant) return;
        setSubscribing(true);
        setError('');
        setSuccess('');
        try {
            await api.subscribeWebhook(selectedTenant);
            setSuccess('تم إرسال طلب اشتراك WABA Webhook إلى Meta');
            await fetchSubscriptions();
        } catch (err) {
            setError(err.message || 'فشل الاشتراك في WABA Webhook');
        } finally {
            setSubscribing(false);
        }
    };

    useEffect(() => {
        fetchTenants();
    }, []);

    useEffect(() => {
        if (selectedTenant) fetchSubscriptions();
    }, [selectedTenant]);

    const requiredFields = diagnostic?.required_fields || ['messages', 'message_template_status_update', 'account_alerts'];
    const subscribedFields = diagnostic?.subscribed_fields || [];
    const missingFields = diagnostic?.missing_fields || [];
    const evidence = diagnostic?.evidence?.by_field || {};

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
            <Box sx={{ mb: 3 }}>
                <Typography variant="h4" fontWeight={700} gutterBottom>
                    اشتراكات WABA Webhook
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    هذه الصفحة خاصة بـ WhatsApp Business Account فقط. تشخيص Facebook Page Webhook موجود داخل محتوى فيسبوك.
                </Typography>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
            {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

            <Card sx={{ mb: 3 }}>
                <CardContent>
                    <Grid container spacing={2} alignItems="center">
                        <Grid size={{ xs: 12, md: 5 }}>
                            <FormControl fullWidth size="small">
                                <InputLabel>العميل</InputLabel>
                                <Select value={selectedTenant} onChange={(e) => setSelectedTenant(e.target.value)} label="العميل">
                                    {tenants.map(t => (
                                        <MenuItem key={t.id} value={String(t.id)}>
                                            {t.name} {t.waba_id ? `(${t.waba_id})` : '(بدون WABA)'}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid size={{ xs: 12, md: 3.5 }}>
                            <Button
                                variant="contained"
                                onClick={handleSubscribe}
                                disabled={subscribing || !selectedTenantData?.waba_id}
                                startIcon={subscribing ? <CircularProgress size={18} color="inherit" /> : <SubscribeIcon />}
                                fullWidth
                            >
                                إعادة اشتراك WABA
                            </Button>
                        </Grid>
                        <Grid size={{ xs: 12, md: 3.5 }}>
                            <Button
                                variant="outlined"
                                onClick={fetchSubscriptions}
                                disabled={loading || !selectedTenant}
                                startIcon={loading ? <CircularProgress size={18} /> : <RefreshIcon />}
                                fullWidth
                            >
                                فحص الاشتراك
                            </Button>
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>

            {selectedTenantData && (
                <Grid container spacing={3}>
                    <Grid size={{ xs: 12, md: 5 }}>
                        <Card sx={{ height: '100%' }}>
                            <CardContent>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                                    <WebhookIcon color="primary" />
                                    <Typography variant="h6">حالة العميل</Typography>
                                </Box>
                                <Grid container spacing={1.5}>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">WABA ID</Typography>
                                        <Typography variant="body2" fontFamily="monospace">{diagnostic?.waba_id || selectedTenantData.waba_id || '-'}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">Phone Number ID</Typography>
                                        <Typography variant="body2" fontFamily="monospace">{diagnostic?.phone_number_id || selectedTenantData.phone_number_id || '-'}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">Token</Typography>
                                        <Typography variant="body2">{diagnostic?.token_status || selectedTenantData.token_status || 'unchecked'}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">Meta subscriptions</Typography>
                                        <Typography variant="body2">{diagnostic?.subscriptions?.length || 0}</Typography>
                                    </Grid>
                                </Grid>
                                {missingFields.length > 0 && (
                                    <Alert severity="warning" sx={{ mt: 2 }}>
                                        حقول غير مؤكدة في الاشتراك: {missingFields.join(', ')}
                                    </Alert>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>

                    <Grid size={{ xs: 12, md: 7 }}>
                        <Card sx={{ height: '100%' }}>
                            <CardContent>
                                <Typography variant="h6" gutterBottom>الحقول المطلوبة والدليل الفعلي</Typography>
                                <Grid container spacing={1.5}>
                                    {requiredFields.map(field => {
                                        const fieldEvidence = evidence[field];
                                        const subscribed = subscribedFields.includes(field) || diagnostic?.subscriptions?.length > 0;
                                        return (
                                            <Grid size={{ xs: 12, sm: 6 }} key={field}>
                                                <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
                                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 1 }}>
                                                        <Typography variant="subtitle2">{fieldLabel[field] || field}</Typography>
                                                        <Chip
                                                            size="small"
                                                            icon={subscribed ? <CheckCircleIcon /> : <CancelIcon />}
                                                            label={subscribed ? 'مشترك' : 'غير مؤكد'}
                                                            color={subscribed ? 'success' : 'warning'}
                                                            variant="outlined"
                                                        />
                                                    </Box>
                                                    <Typography variant="caption" color="text.secondary" display="block">آخر وصول</Typography>
                                                    <Typography variant="body2" fontWeight={600}>
                                                        {fieldEvidence?.latest_at ? new Date(fieldEvidence.latest_at).toLocaleString('ar-LY') : 'لا يوجد دليل بعد'}
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        العدد: {fieldEvidence?.count || 0}
                                                    </Typography>
                                                </Paper>
                                            </Grid>
                                        );
                                    })}
                                </Grid>
                            </CardContent>
                        </Card>
                    </Grid>

                    <Grid size={{ xs: 12 }}>
                        <Card>
                            <CardContent>
                                <Typography variant="h6" gutterBottom>استجابة Meta الحالية</Typography>
                                {loading ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
                                ) : (
                                    <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto' }}>
                                        <Table size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell>التطبيق / الاشتراك</TableCell>
                                                    <TableCell>الحقول</TableCell>
                                                    <TableCell align="center">الحالة</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {(diagnostic?.subscriptions || []).map((sub, index) => (
                                                    <TableRow key={sub.id || index}>
                                                        <TableCell>{sub.name || sub.id || `Subscription ${index + 1}`}</TableCell>
                                                        <TableCell>
                                                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                                                {(sub.subscribed_fields || sub.fields?.map(field => field.name) || ['messages']).map(field => (
                                                                    <Chip key={field} label={field} size="small" variant="outlined" />
                                                                ))}
                                                            </Box>
                                                        </TableCell>
                                                        <TableCell align="center"><CheckCircleIcon color="success" fontSize="small" /></TableCell>
                                                    </TableRow>
                                                ))}
                                                {(!diagnostic?.subscriptions || diagnostic.subscriptions.length === 0) && (
                                                    <TableRow>
                                                        <TableCell colSpan={3} align="center" sx={{ py: 4 }}>
                                                            لا توجد اشتراكات مؤكدة من Meta لهذا WABA.
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>
            )}
        </Box>
    );
};

export default WebhookSubscriptions;
