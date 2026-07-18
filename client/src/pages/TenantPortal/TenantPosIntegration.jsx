import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Divider,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import {
    Link as LinkIcon,
    Pause as PauseIcon,
    PlayArrow as ResumeIcon,
    PointOfSale as PosIcon,
    Refresh as RefreshIcon,
    LinkOff as RevokeIcon,
} from '@mui/icons-material';

import api from '../../api';
import { PageTitle } from '../../components/Layout/PageTitle';
import { useLanguage } from '../../context/LanguageContext';

const STATUS_COLORS = {
    active: 'success',
    pending_authorization: 'warning',
    paused: 'default',
    error: 'error',
    revoked: 'error',
    disconnected: 'default',
};

const TenantPosIntegration = () => {
    const { language } = useLanguage();
    const ar = language === 'ar';
    const [integration, setIntegration] = useState(null);
    const [diagnostics, setDiagnostics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [form, setForm] = useState({ organization_id: '', pos_external_tenant_id: '' });

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const current = await api.getPortalPosIntegration();
            setIntegration(current);
            if (current.connection_id) {
                setDiagnostics(await api.getPortalPosDiagnostics());
            } else {
                setDiagnostics(null);
            }
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const connect = async () => {
        setWorking(true);
        setError('');
        setSuccess('');
        try {
            await api.connectPortalPos(form);
            setSuccess(ar ? 'تم إنشاء طلب الربط. يبقى معزولاً حتى التفعيل.' : 'Connection request created. It stays isolated until authorized.');
            await load();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setWorking(false);
        }
    };

    const action = async actionName => {
        setWorking(true);
        setError('');
        setSuccess('');
        try {
            await api.actionPortalPos(actionName);
            setSuccess(ar ? 'تم تحديث حالة الربط.' : 'Connection state updated.');
            await load();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setWorking(false);
        }
    };

    if (loading && !integration) {
        return <Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;
    }

    const status = integration?.status || 'disconnected';
    const canConnect = !integration?.connection_id || status === 'revoked';
    const counts = diagnostics?.counts || {};

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
            <PageTitle variant="h4" fontWeight={800} gutterBottom>
                {ar ? 'ربط Savana POS' : 'Savana POS integration'}
            </PageTitle>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
                {ar
                    ? 'ربط اختياري يستقبل المبيعات والإرجاعات والمخزون. تستمر Wa Savana بالعمل كاملاً عند إيقافه.'
                    : 'Optional sales, returns and inventory feed. Wa Savana remains fully operational when it is paused.'}
            </Typography>

            {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
            {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

            <Card sx={{ mb: 3 }}>
                <CardContent>
                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                            <PosIcon color="primary" fontSize="large" />
                            <Box>
                                <Typography variant="h6" fontWeight={800}>Savana POS</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    {integration?.remote_external_tenant_id || (ar ? 'غير مربوط' : 'Not connected')}
                                </Typography>
                            </Box>
                        </Stack>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Chip label={status} color={STATUS_COLORS[status] || 'default'} />
                            <Chip
                                label={integration?.pos_entitled
                                    ? (ar ? 'الاشتراك يشمل الربط' : 'Subscription entitled')
                                    : (ar ? 'غير مشمول بالاشتراك' : 'Not entitled')}
                                color={integration?.pos_entitled ? 'success' : 'warning'}
                                variant="outlined"
                            />
                        </Stack>
                    </Stack>

                    {canConnect ? (
                        <Stack spacing={2} sx={{ mt: 3 }}>
                            <TextField
                                label={ar ? 'معرف المؤسسة المركزي (UUID)' : 'Central organization ID (UUID)'}
                                value={form.organization_id}
                                onChange={event => setForm(current => ({ ...current, organization_id: event.target.value }))}
                                fullWidth
                            />
                            <TextField
                                label={ar ? 'معرف شركة POS' : 'POS company identifier'}
                                value={form.pos_external_tenant_id}
                                onChange={event => setForm(current => ({ ...current, pos_external_tenant_id: event.target.value }))}
                                fullWidth
                            />
                            <Button
                                variant="contained"
                                startIcon={working ? <CircularProgress size={18} color="inherit" /> : <LinkIcon />}
                                disabled={working || !form.organization_id || !form.pos_external_tenant_id}
                                onClick={connect}
                                sx={{ alignSelf: 'flex-start' }}
                            >
                                {ar ? 'طلب الربط' : 'Request connection'}
                            </Button>
                        </Stack>
                    ) : (
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 3 }}>
                            {status === 'active' && <Button startIcon={<PauseIcon />} variant="outlined" onClick={() => action('pause')} disabled={working}>{ar ? 'إيقاف مؤقت' : 'Pause'}</Button>}
                            {status === 'paused' && <Button startIcon={<ResumeIcon />} variant="contained" onClick={() => action('resume')} disabled={working}>{ar ? 'استئناف' : 'Resume'}</Button>}
                            <Button startIcon={<RefreshIcon />} variant="outlined" onClick={() => action('refresh-status')} disabled={working}>{ar ? 'تحديث الحالة' : 'Refresh status'}</Button>
                            <Button startIcon={<RefreshIcon />} variant="outlined" onClick={() => action('refresh-entitlements')} disabled={working}>{ar ? 'تحديث الاشتراك' : 'Refresh subscription'}</Button>
                            <Button startIcon={<RevokeIcon />} color="error" variant="outlined" onClick={() => action('revoke')} disabled={working}>{ar ? 'إلغاء الربط' : 'Revoke'}</Button>
                        </Stack>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardContent>
                    <Typography variant="h6" fontWeight={800}>{ar ? 'حالة المزامنة' : 'Synchronization status'}</Typography>
                    <Divider sx={{ my: 2 }} />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        {[
                            [ar ? 'المنتجات المحلية' : 'Local product projections', counts.products || 0],
                            [ar ? 'المعاملات' : 'POS transactions', counts.transactions || 0],
                            [ar ? 'إشعارات تحت المراجعة' : 'Notifications pending review', counts.pending_notification_candidates || 0],
                        ].map(([label, value]) => (
                            <Box key={label} sx={{ flex: 1, p: 2, bgcolor: 'background.default', borderRadius: 2 }}>
                                <Typography variant="h5" fontWeight={800}>{value}</Typography>
                                <Typography variant="body2" color="text.secondary">{label}</Typography>
                            </Box>
                        ))}
                    </Stack>
                    <Alert severity="info" icon={<LinkIcon />} sx={{ mt: 2 }}>
                        {ar
                            ? 'لا تُرسل المنصة إيصالاً تلقائياً. يُنشأ مرشح مراجعة فقط عند وجود رقم وموافقة صريحة من POS.'
                            : 'No receipt is sent automatically. A review candidate is created only when POS supplies a phone number and explicit consent.'}
                    </Alert>
                </CardContent>
            </Card>
        </Box>
    );
};

export default TenantPosIntegration;
