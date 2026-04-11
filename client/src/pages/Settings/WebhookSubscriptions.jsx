import React, { useState, useEffect } from 'react';
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
    MenuItem
} from '@mui/material';
import {
    Webhook as WebhookIcon,
    Refresh as RefreshIcon,
    PlayArrow as SubscribeIcon,
    CheckCircle as CheckCircleIcon,
    Cancel as CancelIcon
} from '@mui/icons-material';
import api from '../../api';

const WebhookSubscriptions = () => {
    const [tenants, setTenants] = useState([]);
    const [selectedTenant, setSelectedTenant] = useState('');
    const [subscriptions, setSubscriptions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [subscribing, setSubscribing] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        fetchTenants();
    }, []);

    const fetchTenants = async () => {
        try {
            const data = await api.getTenants();
            setTenants(data);
            const tenantWithWaba = data.find(t => t.waba_id);
            if (tenantWithWaba) {
                setSelectedTenant(tenantWithWaba.id);
            }
        } catch (err) {
            setError('فشل جلب قائمة العملاء');
        }
    };

    const fetchSubscriptions = async () => {
        if (!selectedTenant) return;
        setLoading(true);
        setError('');
        try {
            const data = await api.getWebhookSubscriptions(selectedTenant);
            setSubscriptions(data.data || []);
        } catch (err) {
            setError(err.message || 'فشل جلب اشتراكات الـ Webhook');
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
            setSuccess('تم الاشتراك في Webhook بنجاح');
            fetchSubscriptions();
        } catch (err) {
            setError(err.message || 'فشل الاشتراك في Webhook');
        } finally {
            setSubscribing(false);
        }
    };

    useEffect(() => {
        if (selectedTenant) {
            fetchSubscriptions();
        }
    }, [selectedTenant]);

    const selectedTenantData = tenants.find(t => t.id === selectedTenant);

    return (
        <Box sx={{ p: 3, maxWidth: 1000, mx: 'auto' }}>
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" fontWeight={700} gutterBottom>
                    اشتراكات Webhook
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    إدارة اشتراكات الـ Webhook مع Meta لاستقبال الأحداث (رسائل، حالات، تحديثات الحساب).
                </Typography>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
            {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

            {/* Tenant Selection */}
            <Card elevation={2} sx={{ mb: 3 }}>
                <CardContent>
                    <Grid container spacing={2} alignItems="center">
                        <Grid size={{ xs: 12, md: 5 }}>
                            <FormControl fullWidth size="small">
                                <InputLabel>اختر العميل</InputLabel>
                                <Select
                                    value={selectedTenant}
                                    onChange={(e) => setSelectedTenant(e.target.value)}
                                    label="اختر العميل"
                                >
                                    {tenants.map(t => (
                                        <MenuItem key={t.id} value={t.id}>
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
                                startIcon={subscribing ? <CircularProgress size={18} /> : <SubscribeIcon />}
                                fullWidth
                                color="success"
                            >
                                اشتراك في Webhook
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
                                تحديث
                            </Button>
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>

            {/* Info Card */}
            {selectedTenantData && (
                <Card elevation={2} sx={{ mb: 3 }}>
                    <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                            <WebhookIcon color="primary" />
                            <Typography variant="h6">معلومات العميل</Typography>
                        </Box>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 6, md: 3 }}>
                                <Typography variant="caption" color="text.secondary">الاسم</Typography>
                                <Typography variant="body2" fontWeight={600}>{selectedTenantData.name}</Typography>
                            </Grid>
                            <Grid size={{ xs: 6, md: 3 }}>
                                <Typography variant="caption" color="text.secondary">WABA ID</Typography>
                                <Typography variant="body2" fontFamily="monospace">
                                    {selectedTenantData.waba_id || 'غير محدد'}
                                </Typography>
                            </Grid>
                            <Grid size={{ xs: 6, md: 3 }}>
                                <Typography variant="caption" color="text.secondary">Phone Number ID</Typography>
                                <Typography variant="body2" fontFamily="monospace">
                                    {selectedTenantData.phone_number_id || 'غير محدد'}
                                </Typography>
                            </Grid>
                            <Grid size={{ xs: 6, md: 3 }}>
                                <Typography variant="caption" color="text.secondary">الحالة</Typography>
                                <Chip
                                    label={selectedTenantData.status}
                                    size="small"
                                    color={selectedTenantData.status === 'Active' ? 'success' : 'warning'}
                                />
                            </Grid>
                        </Grid>
                    </CardContent>
                </Card>
            )}

            {/* Subscriptions Table */}
            <Card elevation={2}>
                <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                        <Typography variant="h6">الاشتراكات الحالية</Typography>
                        <Chip label={subscriptions.length} size="small" color="primary" />
                    </Box>

                    {loading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress />
                        </Box>
                    ) : subscriptions.length === 0 ? (
                        <Alert severity="info">
                            لا توجد اشتراكات. اضغط "اشتراك في Webhook" لتفعيل استقبال الأحداث.
                        </Alert>
                    ) : (
                        <TableContainer component={Paper} variant="outlined">
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>التطبيق</TableCell>
                                        <TableCell>الحقول المشترك بها</TableCell>
                                        <TableCell align="center">الحالة</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {subscriptions.map((sub, idx) => (
                                        <TableRow key={idx} hover>
                                            <TableCell>
                                                <Typography variant="body2" fontWeight={600}>
                                                    {sub.whatsapp_business_api_data?.link || sub.id || `App ${idx + 1}`}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>
                                                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                                    {(sub.subscribed_fields || ['messages']).map((field, i) => (
                                                        <Chip key={i} label={field} size="small" variant="outlined" />
                                                    ))}
                                                </Box>
                                            </TableCell>
                                            <TableCell align="center">
                                                <CheckCircleIcon color="success" fontSize="small" />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}

                    <Alert severity="info" sx={{ mt: 2 }}>
                        <Typography variant="subtitle2" gutterBottom>ما هو اشتراك Webhook؟</Typography>
                        <Typography variant="body2">
                            يسمح لتطبيقك باستقبال إشعارات فورية من Meta عند حدوث أحداث مثل:
                            استلام رسالة جديدة، تغيير حالة الرسالة (delivered/read)، تحديثات جودة الحساب.
                        </Typography>
                    </Alert>
                </CardContent>
            </Card>
        </Box>
    );
};

export default WebhookSubscriptions;
