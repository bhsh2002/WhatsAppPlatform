import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert, Box, Button, Card, CardActionArea, CardContent, Chip,
    CircularProgress, Divider, FormControl, InputLabel, MenuItem,
    Stack, TextField, Typography,
} from '@mui/material';
import {
    Hub as HubIcon, Link as LinkIcon, LinkOff as RevokeIcon,
    Pause as PauseIcon, PlayArrow as ResumeIcon, Refresh as RefreshIcon,
} from '@mui/icons-material';

import api from '../../api';
import Select from '../../components/Form/AccessibleSelect';
import { PageTitle } from '../../components/Layout/PageTitle';
import { useLanguage } from '../../context/LanguageContext';

const PLATFORMS = {
    pos: { ar: 'Savana POS', en: 'Savana POS', detailAr: 'المبيعات والإرجاعات والمخزون', detailEn: 'Sales, returns and inventory' },
    catalog: { ar: 'Catalog', en: 'Catalog', detailAr: 'المنتجات وإشعارات الطلبات والحملات', detailEn: 'Products, order notifications and campaigns' },
    sawemly: { ar: 'Sawemly', en: 'Sawemly', detailAr: 'إتاحة المنتجات ومواقع الأرفف', detailEn: 'Product availability and shelf locations' },
};

const STATUS_COLORS = {
    active: 'success', pending_authorization: 'warning', paused: 'default',
    degraded: 'warning', rejected: 'error', error: 'error', revoked: 'error', disconnected: 'default',
};

const STATUS_AR = {
    active: 'نشط', pending_authorization: 'بانتظار موافقة الطرف الآخر', paused: 'متوقف مؤقتًا',
    degraded: 'يحتاج متابعة', rejected: 'مرفوض', error: 'خطأ', revoked: 'ملغى', disconnected: 'غير مربوط',
};

const TenantPosIntegration = () => {
    const { language } = useLanguage();
    const ar = language === 'ar';
    const [integrations, setIntegrations] = useState([]);
    const [selectedPlatform, setSelectedPlatform] = useState('catalog');
    const [diagnostics, setDiagnostics] = useState(null);
    const [serviceRequests, setServiceRequests] = useState([]);
    const [candidateDocument, setCandidateDocument] = useState(null);
    const [selectedTarget, setSelectedTarget] = useState('');
    const [binding, setBinding] = useState(null);
    const [incoming, setIncoming] = useState([]);
    const [invitationCode, setInvitationCode] = useState('');
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
            const bindingDocument = await api.getPortalPlatformBinding();
            setBinding(bindingDocument);
            const incomingDocument = bindingDocument?.bound
                ? await api.getPortalIncomingConnections()
                : { data: [] };
            setIncoming(incomingDocument?.data || incomingDocument || []);
            const response = await api.getPortalPlatformIntegrations();
            const rows = response?.data || response || [];
            setIntegrations(rows);
            const selected = rows.find(item => item.platform_code === selectedPlatform);
            const isConnectable = !selected?.connection_id
                || ['revoked', 'error', 'disconnected'].includes(selected?.status);
            setDiagnostics(selected?.connection_id
                ? await api.getPortalPlatformDiagnostics(selectedPlatform)
                : null);
            if (selected?.connection_id && selectedPlatform === 'catalog') {
                const requests = await api.getPortalPlatformServiceRequests(
                    selectedPlatform
                );
                setServiceRequests(requests?.data || requests || []);
            } else {
                setServiceRequests([]);
            }
            setCandidateDocument(isConnectable && bindingDocument?.bound
                ? await api.getPortalPlatformCandidates(selectedPlatform)
                : null);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }, [selectedPlatform]);

    useEffect(() => { load(); }, [load]);
    const candidates = useMemo(
        () => (candidateDocument?.organizations || []).flatMap((organization) => (
            (organization.candidates || []).map((target) => ({
                source: organization.source_tenant,
                organization: organization.organization,
                target,
                key: `${organization.source_tenant.id}:${target.id}`,
            }))
        )),
        [candidateDocument],
    );
    useEffect(() => {
        const connectable = candidates.filter(
            (item) => item.target.connectable || integration.status === 'error',
        );
        setSelectedTarget(connectable.length === 1 ? connectable[0].key : '');
    }, [selectedPlatform, candidates, integration.status]);
    const selectedCandidate = candidates.find((item) => item.key === selectedTarget);

    const connect = async () => {
        setWorking(true); setError(''); setSuccess('');
        try {
            await api.connectPortalPlatform(selectedPlatform, {
                source_tenant_id: selectedCandidate.source.id,
                target_tenant_id: selectedCandidate.target.id,
            });
            setSuccess(ar ? 'تم إرسال طلب الربط إلى مدير الحساب الآخر.' : 'The connection request was sent to the other account manager.');
            await load();
        } catch (requestError) { setError(requestError.message); }
        finally { setWorking(false); }
    };

    const redeemBinding = async () => {
        setWorking(true); setError(''); setSuccess('');
        try {
            await api.redeemPortalPlatformBinding(invitationCode);
            setInvitationCode('');
            setSuccess(ar
                ? 'تم ربط حساب Wa Savana بالمؤسسة بعد التحقق من الدعوة.'
                : 'Wa Savana was bound to the organization after invitation verification.');
            await load();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setWorking(false);
        }
    };

    const decideIncoming = async (connectionId, decision) => {
        setWorking(true); setError(''); setSuccess('');
        try {
            await api.decidePortalIncomingConnection(connectionId, decision);
            setSuccess(decision === 'approve'
                ? (ar ? 'تمت الموافقة وتفعيل الرابط للطرفين.' : 'Approved and activated for both platforms.')
                : (ar ? 'تم رفض طلب الربط.' : 'Connection request rejected.'));
            await load();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setWorking(false);
        }
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

    const dismissServiceRequest = async requestId => {
        setWorking(true); setError(''); setSuccess('');
        try {
            await api.dismissPortalPlatformServiceRequest(
                selectedPlatform, requestId
            );
            setSuccess(ar ? 'تم تجاهل طلب الخدمة.' : 'Service request dismissed.');
            await load();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setWorking(false);
        }
    };

    if (loading && integrations.length === 0) {
        return <Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;
    }

    const status = integration.status || 'disconnected';
    const canConnect = !integration.connection_id || ['rejected', 'revoked', 'error', 'disconnected'].includes(status);
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

            {binding && !binding.bound && (
                <Card variant="outlined" sx={{ mb: 2 }}>
                    <CardContent>
                        <Typography variant="h6" fontWeight={800}>
                            {ar ? 'انضمام الحساب إلى مؤسسة سافانا' : 'Join a Savana organization'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ my: 1.5 }}>
                            {ar
                                ? `أرسل إلى مدير المؤسسة معرف هذا الحساب: ${binding.external_tenant_id}. ستُقيد الدعوة به ولا تعمل مع حساب آخر.`
                                : `Send this account identifier to the organization manager: ${binding.external_tenant_id}. The invitation will only work for this account.`}
                        </Typography>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <TextField
                                fullWidth
                                label={ar ? 'رمز دعوة المؤسسة' : 'Organization invitation'}
                                value={invitationCode}
                                onChange={(event) => setInvitationCode(event.target.value)}
                            />
                            <Button
                                variant="contained"
                                disabled={working || invitationCode.trim().length < 20}
                                onClick={redeemBinding}
                            >
                                {ar ? 'تحقق وانضم' : 'Verify and join'}
                            </Button>
                        </Stack>
                    </CardContent>
                </Card>
            )}
            {binding?.bound && (
                <Alert severity="success" sx={{ mb: 2 }}>
                    {ar
                        ? `هذا الحساب تابع للمؤسسة «${binding.binding?.organization_name}».`
                        : `This account belongs to “${binding.binding?.organization_name}”.`}
                </Alert>
            )}
            {incoming.map((request) => (
                <Alert
                    key={request.id}
                    severity="warning"
                    sx={{ mb: 1 }}
                    action={(
                        <Stack direction="row" spacing={0.5}>
                            <Button
                                color="inherit"
                                size="small"
                                disabled={working}
                                onClick={() => decideIncoming(request.id, 'approve')}
                            >
                                {ar ? 'موافقة' : 'Approve'}
                            </Button>
                            <Button
                                color="error"
                                size="small"
                                disabled={working}
                                onClick={() => decideIncoming(request.id, 'reject')}
                            >
                                {ar ? 'رفض' : 'Reject'}
                            </Button>
                        </Stack>
                    )}
                >
                    {ar
                        ? `طلب ربط وارد من ${request.source_external_tenant_id}. لن تبدأ المزامنة قبل موافقتك.`
                        : `Incoming request from ${request.source_external_tenant_id}. Synchronization waits for your approval.`}
                </Alert>
            ))}

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
                                    ? `اختر حساب ${profile.ar} المقصود. سيصل لمديره طلب موافقة قبل بدء المزامنة.`
                                    : `Select the intended ${profile.en} account. Its manager must approve before synchronization.`}
                            </Alert>
                            <FormControl fullWidth>
                                <InputLabel id="wa-savana-integration-target-label">
                                    {ar ? 'المؤسسة والحساب الهدف' : 'Organization and target account'}
                                </InputLabel>
                                <Select
                                    labelId="wa-savana-integration-target-label"
                                    label={ar ? 'المؤسسة والحساب الهدف' : 'Organization and target account'}
                                    value={selectedTarget}
                                    onChange={(event) => setSelectedTarget(event.target.value)}
                                >
                                    {candidates.map((candidate) => (
                                        <MenuItem
                                            key={candidate.key}
                                            value={candidate.key}
                                            disabled={!candidate.target.connectable && status !== 'error'}
                                        >
                                            {candidate.organization.name} — {candidate.target.display_name}
                                            {!candidate.target.connectable
                                                ? (status === 'error'
                                                    ? (ar ? ' (إصلاح الرابط الحالي)' : ' (repair current link)')
                                                    : (ar ? ' (مربوط بالفعل)' : ' (already connected)'))
                                                : ''}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            {candidates.length === 0 && (
                                <Alert severity="warning">
                                    {ar ? `لا يوجد حساب ${profile.ar} متاح ضمن مؤسستك.` : `No ${profile.en} account is available in your organization.`}
                                </Alert>
                            )}
                            {selectedCandidate && (
                                <Alert severity="success">
                                    {ar
                                        ? `سيتم ربط «${selectedCandidate.source.display_name}» في «${selectedCandidate.organization.name}» مع «${selectedCandidate.target.display_name}».`
                                        : `“${selectedCandidate.source.display_name}” in “${selectedCandidate.organization.name}” will connect to “${selectedCandidate.target.display_name}”.`}
                                </Alert>
                            )}
                            <Button
                                variant="contained"
                                startIcon={working ? <CircularProgress size={18} color="inherit" /> : <LinkIcon />}
                                disabled={working || !selectedCandidate}
                                onClick={connect}
                                sx={{ alignSelf: 'flex-start' }}
                            >
                                {ar ? 'إرسال طلب الربط' : 'Send connection request'}
                            </Button>
                        </Stack>
                    ) : (
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 3 }}>
                            {status === 'active' && <Button startIcon={<PauseIcon />} variant="outlined" onClick={() => action('pause')} disabled={working}>{ar ? 'إيقاف مؤقت' : 'Pause'}</Button>}
                            {['paused', 'degraded'].includes(status) && <Button startIcon={<ResumeIcon />} variant="contained" onClick={() => action('resume')} disabled={working}>{ar ? 'استئناف' : 'Resume'}</Button>}
                            <Button startIcon={<RefreshIcon />} variant="outlined" onClick={() => action('refresh-status')} disabled={working}>{ar ? 'تحديث الحالة' : 'Refresh status'}</Button>
                            <Button
                                startIcon={<RevokeIcon />}
                                color="error"
                                variant="outlined"
                                onClick={() => {
                                    if (window.confirm(ar
                                        ? 'سيُفصل الرابط من المنصتين وتتوقف المزامنة الجديدة. هل تريد المتابعة؟'
                                        : 'The link will be disconnected on both platforms and new synchronization will stop. Continue?')) {
                                        action('revoke');
                                    }
                                }}
                                disabled={working}
                            >
                                {ar ? 'إلغاء الربط' : 'Revoke'}
                            </Button>
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
                    {selectedPlatform === 'catalog' && serviceRequests.map((request) => (
                        <Alert
                            key={request.id}
                            severity={request.status === 'pending_review' ? 'warning' : 'info'}
                            sx={{ mt: 1 }}
                            action={request.status === 'pending_review' ? (
                                <Button
                                    color="inherit"
                                    size="small"
                                    disabled={working}
                                    onClick={() => dismissServiceRequest(request.id)}
                                >
                                    {ar ? 'تجاهل' : 'Dismiss'}
                                </Button>
                            ) : null}
                        >
                            {ar
                                ? `طلب ${request.payload?.order_number || request.request_key}: الحالة ${request.payload?.status || request.status}`
                                : `Request ${request.payload?.order_number || request.request_key}: ${request.payload?.status || request.status}`}
                        </Alert>
                    ))}
                </CardContent>
            </Card>
        </Box>
    );
};

export default TenantPosIntegration;
