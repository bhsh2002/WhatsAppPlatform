import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert, Box, Button, Card, CardActionArea, CardContent, Chip,
    CircularProgress, Divider, Stack, Typography,
} from '@mui/material';
import {
    Hub as HubIcon, Link as LinkIcon, LinkOff as RevokeIcon,
    Pause as PauseIcon, PlayArrow as ResumeIcon, Refresh as RefreshIcon,
} from '@mui/icons-material';

import api from '../../api';
import { PageTitle } from '../../components/Layout/PageTitle';
import { useLanguage } from '../../context/LanguageContext';

const PLATFORMS = {
    pos: { ar: 'Savana POS', en: 'Savana POS', detailAr: 'المبيعات والإرجاعات والمخزون', detailEn: 'Sales, returns and inventory' },
    catalog: { ar: 'Catalog', en: 'Catalog', detailAr: 'المنتجات وإشعارات الطلبات والحملات', detailEn: 'Products, order notifications and campaigns' },
    sawemly: { ar: 'Sawemly', en: 'Sawemly', detailAr: 'إتاحة المنتجات ومواقع الأرفف', detailEn: 'Product availability and shelf locations' },
};

const STATUS_COLORS = {
    active: 'success', pending_authorization: 'warning', paused: 'default',
    degraded: 'warning', error: 'error', revoked: 'error', disconnected: 'default',
};

const STATUS_AR = {
    active: 'نشط', pending_authorization: 'بانتظار موافقة الطرف الآخر', paused: 'متوقف مؤقتًا',
    degraded: 'يحتاج متابعة', error: 'خطأ', revoked: 'ملغى', disconnected: 'غير مربوط',
};

const TenantPosIntegration = () => {
    const { language } = useLanguage();
    const ar = language === 'ar';
    const [integrations, setIntegrations] = useState([]);
    const [selectedPlatform, setSelectedPlatform] = useState('catalog');
    const [diagnostics, setDiagnostics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const integration = useMemo(
        () => integrations.find(item => item.platform_code === selectedPlatform)
            || { platform_code: selectedPlatform, status: 'disconnected', scopes: [] },
        [integrations, selectedPlatform],
    );
    const profile = PLATFORMS[selectedPlatform];

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const response = await api.getPortalPlatformIntegrations();
            const rows = response?.data || response || [];
            setIntegrations(rows);
            const selected = rows.find(item => item.platform_code === selectedPlatform);
            setDiagnostics(selected?.connection_id
                ? await api.getPortalPlatformDiagnostics(selectedPlatform)
                : null);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }, [selectedPlatform]);

    useEffect(() => { load(); }, [load]);

    const connect = async () => {
        setWorking(true); setError(''); setSuccess('');
        try {
            await api.connectPortalPlatform(selectedPlatform, {});
            setSuccess(ar ? 'تم ربط المنصتين وتفعيلهما تلقائياً.' : 'The platforms were connected and activated automatically.');
            await load();
        } catch (requestError) { setError(requestError.message); }
        finally { setWorking(false); }
    };

    const action = async actionName => {
        setWorking(true); setError(''); setSuccess('');
        try {
            await api.actionPortalPlatform(selectedPlatform, actionName);
            setSuccess(ar ? 'تم تحديث حالة الربط.' : 'Connection state updated.');
            await load();
        } catch (requestError) { setError(requestError.message); }
        finally { setWorking(false); }
    };

    if (loading && integrations.length === 0) {
        return <Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;
    }

    const status = integration.status || 'disconnected';
    const canConnect = !integration.connection_id || ['revoked', 'error', 'disconnected'].includes(status);
    const counts = diagnostics?.counts || {};

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
            <PageTitle variant="h4" fontWeight={800} gutterBottom>
                {ar ? 'ربط منصات سافانا' : 'Savana platform integrations'}
            </PageTitle>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
                {ar ? 'روابط مباشرة ومستقلة؛ لا تمر بيانات Catalog أو Sawemly عبر POS.' : 'Direct independent links; Catalog and Sawemly data never transit through POS.'}
            </Typography>
            {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
            {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 3 }}>
                {Object.entries(PLATFORMS).map(([code, item]) => {
                    const row = integrations.find(value => value.platform_code === code);
                    return (
                        <Card key={code} variant={selectedPlatform === code ? 'elevation' : 'outlined'} sx={{ flex: 1 }}>
                            <CardActionArea onClick={() => setSelectedPlatform(code)}>
                                <CardContent>
                                    <Stack direction="row" justifyContent="space-between" gap={1}>
                                        <Typography fontWeight={800}>{ar ? item.ar : item.en}</Typography>
                                        <Chip size="small" label={ar ? STATUS_AR[row?.status || 'disconnected'] : row?.status || 'disconnected'} color={STATUS_COLORS[row?.status] || 'default'} />
                                    </Stack>
                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{ar ? item.detailAr : item.detailEn}</Typography>
                                </CardContent>
                            </CardActionArea>
                        </Card>
                    );
                })}
            </Stack>

            <Card sx={{ mb: 3 }}>
                <CardContent>
                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                            <HubIcon color="primary" fontSize="large" />
                            <Box>
                                <Typography variant="h6" fontWeight={800}>{ar ? profile.ar : profile.en}</Typography>
                                <Typography variant="body2" color="text.secondary">{integration.remote_external_tenant_id || (ar ? 'غير مربوط' : 'Not connected')}</Typography>
                            </Box>
                        </Stack>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Chip label={ar ? STATUS_AR[status] : status} color={STATUS_COLORS[status] || 'default'} />
                            <Chip label={integration.entitled || integration.pos_entitled ? (ar ? 'الاشتراك يشمل الربط' : 'Subscription entitled') : (ar ? 'غير مشمول بالاشتراك' : 'Not entitled')} color={integration.entitled || integration.pos_entitled ? 'success' : 'warning'} variant="outlined" />
                        </Stack>
                    </Stack>

                    {canConnect ? (
                        <Stack spacing={2} sx={{ mt: 3 }}>
                            <Alert severity="info">
                                {ar
                                    ? `سيعثر النظام تلقائياً على حساب ${profile.ar} المسجل ضمن مؤسستك المركزية ويُفعّل الربط فوراً.`
                                    : `Savana will automatically find the ${profile.en} account registered to your central organization and activate the link.`}
                            </Alert>
                            <Button variant="contained" startIcon={working ? <CircularProgress size={18} color="inherit" /> : <LinkIcon />} disabled={working} onClick={connect} sx={{ alignSelf: 'flex-start' }}>{ar ? 'ربط الآن بضغطة واحدة' : 'Connect now in one click'}</Button>
                        </Stack>
                    ) : (
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 3 }}>
                            {status === 'active' && <Button startIcon={<PauseIcon />} variant="outlined" onClick={() => action('pause')} disabled={working}>{ar ? 'إيقاف مؤقت' : 'Pause'}</Button>}
                            {['paused', 'degraded'].includes(status) && <Button startIcon={<ResumeIcon />} variant="contained" onClick={() => action('resume')} disabled={working}>{ar ? 'استئناف' : 'Resume'}</Button>}
                            <Button startIcon={<RefreshIcon />} variant="outlined" onClick={() => action('refresh-status')} disabled={working}>{ar ? 'تحديث الحالة' : 'Refresh status'}</Button>
                            <Button startIcon={<RevokeIcon />} color="error" variant="outlined" onClick={() => action('revoke')} disabled={working}>{ar ? 'إلغاء الربط' : 'Revoke'}</Button>
                        </Stack>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardContent>
                    <Typography variant="h6" fontWeight={800}>{ar ? 'حالة الخدمة' : 'Service status'}</Typography>
                    <Divider sx={{ my: 2 }} />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        {[
                            [ar ? 'نسخ المنتجات' : 'Product projections', counts.products || 0],
                            [ar ? 'طلبات خدمة للمراجعة' : 'Service requests pending review', counts.pending_service_requests || 0],
                            [ar ? 'إشعارات POS للمراجعة' : 'POS notifications pending review', counts.pending_notification_candidates || 0],
                        ].map(([label, value]) => <Box key={label} sx={{ flex: 1, p: 2, bgcolor: 'background.default', borderRadius: 2 }}><Typography variant="h5" fontWeight={800}>{value}</Typography><Typography variant="body2" color="text.secondary">{label}</Typography></Box>)}
                    </Stack>
                    <Alert severity="info" icon={<LinkIcon />} sx={{ mt: 2 }}>
                        {ar ? 'طلبات الإشعار الواردة لا تُرسل تلقائيًا؛ تُحفظ للمراجعة وتطبق سياسات القالب والموافقة.' : 'Incoming notification requests are never sent automatically; they await review and channel consent checks.'}
                    </Alert>
                </CardContent>
            </Card>
        </Box>
    );
};

export default TenantPosIntegration;
