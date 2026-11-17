import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, Card, CardActionArea, CardContent, Chip,
    CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, InputLabel, MenuItem,
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
import SharedProductReadPanel from './SharedProductReadPanel';
import SharedReadSetupPanel from './SharedReadSetupPanel';
import SharedReadOwnerSetupPanel from './SharedReadOwnerSetupPanel';
import {
    presentServiceRequest,
    shouldLoadServiceRequests,
} from './serviceRequestPresentation';
import {
    integrationCandidatesForPlatform,
    integrationCandidateIsSelectable,
    integrationIsConnectable,
    integrationLoadIsCurrent,
    integrationSubscriptionBadge,
    integrationRequirements,
    resolveAvailablePlatform,
    shouldRequestIntegrationCandidates,
} from './integrationPlatformAvailability';

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
    const [selectedPlatform, setSelectedPlatform] = useState(null);
    const [diagnostics, setDiagnostics] = useState(null);
    const [serviceRequests, setServiceRequests] = useState([]);
    const [candidateDocument, setCandidateDocument] = useState(null);
    const [selectedTarget, setSelectedTarget] = useState('');
    const [binding, setBinding] = useState(null);
    const [incoming, setIncoming] = useState([]);
    const [invitationCode, setInvitationCode] = useState('');
    const [showFallback, setShowFallback] = useState(false);
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [requirementsOpen, setRequirementsOpen] = useState(false);
    const loadRevision = useRef(0);
    const selectedPlatformRef = useRef(selectedPlatform);
    selectedPlatformRef.current = selectedPlatform;
    const authorizationStateKey = 'savana-binding-state:wa-savana';

    const integration = useMemo(
        () => integrations.find(item => item.platform_code === selectedPlatform)
            || {
                platform_code: selectedPlatform,
                status: 'disconnected',
                scopes: [],
                available: false,
            },
        [integrations, selectedPlatform],
    );
    const profile = PLATFORMS[selectedPlatform] || {
        ar: 'منصات سافانا',
        en: 'Savana platforms',
    };

    const load = useCallback(async () => {
        const requestedPlatform = selectedPlatformRef.current;
        const revision = loadRevision.current + 1;
        loadRevision.current = revision;
        const isCurrent = () => integrationLoadIsCurrent({
            currentPlatform: selectedPlatformRef.current,
            currentRevision: loadRevision.current,
            requestedPlatform,
            revision,
        });
        setLoading(true);
        setError('');
        setDiagnostics(null);
        setServiceRequests([]);
        setCandidateDocument(null);
        setSelectedTarget('');
        try {
            const bindingDocument = await api.getPortalPlatformBinding();
            if (!isCurrent()) return;
            setBinding(bindingDocument);
            const incomingDocument = bindingDocument?.bound
                ? await api.getPortalIncomingConnections()
                : { data: [] };
            if (!isCurrent()) return;
            setIncoming(incomingDocument?.data || incomingDocument || []);
            const response = await api.getPortalPlatformIntegrations();
            if (!isCurrent()) return;
            const rows = response?.data || response || [];
            setIntegrations(rows);
            const resolvedPlatform = resolveAvailablePlatform(rows, requestedPlatform);
            if (resolvedPlatform !== requestedPlatform) {
                setSelectedPlatform(resolvedPlatform);
                return;
            }
            if (!resolvedPlatform) return;
            const selected = rows.find(item => item.platform_code === resolvedPlatform);
            const nextDiagnostics = selected?.connection_id
                ? await api.getPortalPlatformDiagnostics(resolvedPlatform)
                : null;
            if (!isCurrent()) return;
            setDiagnostics(nextDiagnostics);
            if (shouldLoadServiceRequests(selected)) {
                const requests = await api.getPortalPlatformServiceRequests(
                    resolvedPlatform
                );
                if (!isCurrent()) return;
                setServiceRequests(requests?.data || requests || []);
            }
            const nextCandidateDocument = shouldRequestIntegrationCandidates({
                binding: bindingDocument,
                integration: selected,
            })
                ? await api.getPortalPlatformCandidates(resolvedPlatform)
                : null;
            if (!isCurrent()) return;
            setCandidateDocument(nextCandidateDocument);
        } catch (requestError) {
            if (isCurrent()) setError(requestError.message);
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load, selectedPlatform]);
    useEffect(() => {
        const parameters = new URLSearchParams(window.location.search);
        const result = parameters.get('savana_binding');
        if (!result) return;
        const returnedState = parameters.get('state');
        const expectedState = window.sessionStorage.getItem(authorizationStateKey);
        parameters.delete('savana_binding');
        parameters.delete('state');
        const queryString = parameters.toString();
        window.history.replaceState(
            {},
            document.title,
            `${window.location.pathname}${queryString ? `?${queryString}` : ''}${window.location.hash}`,
        );
        window.sessionStorage.removeItem(authorizationStateKey);
        if (!expectedState || returnedState !== expectedState) {
            setError(ar
                ? 'تعذر التحقق من عودة طلب الربط. لم تُجرَ أي عملية من هذه الصفحة.'
                : 'The account-linking return could not be verified.');
            return;
        }
        if (result === 'approved') {
            setSuccess(ar
                ? 'تم ربط حساب Wa Savana بالمؤسسة المختارة.'
                : 'Wa Savana was linked to the selected organization.');
        } else {
            setSuccess(ar
                ? 'تم إلغاء طلب ربط المؤسسة.'
                : 'Organization linking was cancelled.');
        }
    }, [ar, authorizationStateKey]);
    const candidates = useMemo(
        () => integrationCandidatesForPlatform(candidateDocument, selectedPlatform),
        [candidateDocument, selectedPlatform],
    );
    useEffect(() => {
        const connectable = candidates.filter(
            (item) => integrationCandidateIsSelectable(item, integration),
        );
        setSelectedTarget(connectable.length === 1 ? connectable[0].key : '');
    }, [selectedPlatform, candidates, integration]);
    const selectedCandidate = candidates.find((item) => item.key === selectedTarget);

    const connect = async () => {
        if (!integrationCandidateIsSelectable(selectedCandidate, integration)) return;
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

    const authorizeBinding = async () => {
        setWorking(true); setError(''); setSuccess('');
        try {
            const bytes = window.crypto.getRandomValues(new Uint8Array(32));
            const requestState = Array.from(
                bytes, value => value.toString(16).padStart(2, '0')
            ).join('');
            const redirectUri = `${window.location.origin}${window.location.pathname}`;
            const result = await api.authorizePortalPlatformBinding(
                redirectUri, requestState
            );
            window.sessionStorage.setItem(authorizationStateKey, requestState);
            window.location.assign(result.authorization_url);
        } catch (requestError) {
            setError(requestError.message);
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
    const platformAvailable = integration.available === true;
    const entitlementBadge = integrationSubscriptionBadge(integration.subscription_entitled, ar);
    const canConnect = integrationIsConnectable(integration);
    const counts = diagnostics?.counts || {};
    const outboxCounts = diagnostics?.outbox?.counts || {};
    const requirements = integrationRequirements({ integration, bound: binding?.bound }, language);
    const capabilityLabels = {
        'wa_savana.notifications.send': ar ? 'رسائل وإشعارات' : 'Messages and notifications',
        'wa_savana.campaigns.send': ar ? 'حملات' : 'Campaigns',
        'wa_savana.content.publish': ar ? 'نشر محتوى' : 'Content publication',
    };
    const capabilities = Array.isArray(integration.capabilities) && integration.capabilities.length
        ? integration.capabilities
        : Object.keys(capabilityLabels).map(capabilityId => ({
            capability_id: capabilityId,
            can_request_review: false,
            execution_blockers: [{
                code: 'readiness_unavailable',
                message: ar
                    ? 'لم تصل أهلية هذه القدرة من الخادم. حدّث الحالة أو راجع المسؤول؛ لا يمكن التنفيذ دون تحقق.'
                    : 'The server has not provided readiness for this capability. Refresh the status or contact your administrator; execution requires verification.',
            }],
        }));

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
                            {ar ? 'ربط حسابك بمؤسستك' : 'Link your organization'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ my: 1.5 }}>
                            {ar
                                ? 'سجّل الدخول بحساب سافانا واختر مؤسستك. يمكنك إنشاء حساب إن كانت هذه زيارتك الأولى.'
                                : 'Sign in to your Savana account and choose your organization. New here? Create an account.'}
                        </Typography>
                        <Stack spacing={1}>
                            <Button
                                variant="contained"
                                disabled={working}
                                onClick={authorizeBinding}
                            >
                                {ar ? 'ربط الحساب' : 'Link account'}
                            </Button>
                            <Button
                                size="small"
                                color="inherit"
                                onClick={() => setShowFallback(value => !value)}
                            >
                                {showFallback
                                    ? (ar ? 'إخفاء الرمز الاحتياطي' : 'Hide fallback code')
                                    : (ar ? 'لدي رمز ربط احتياطي' : 'I have a fallback code')}
                            </Button>
                            {showFallback && (
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                    <TextField
                                        fullWidth
                                        label={ar ? 'رمز الربط الاحتياطي' : 'Fallback linking code'}
                                        value={invitationCode}
                                        onChange={(event) => setInvitationCode(event.target.value)}
                                    />
                                    <Button
                                        variant="outlined"
                                        disabled={working || invitationCode.trim().length < 20}
                                        onClick={redeemBinding}
                                    >
                                        {ar ? 'تحقق وانضم' : 'Verify and join'}
                                    </Button>
                                </Stack>
                            )}
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
                    const available = row?.available === true;
                    return (
                        <Card key={code} variant={selectedPlatform === code ? 'elevation' : 'outlined'} sx={{ flex: 1 }}>
                            <CardActionArea
                                disabled={loading || working}
                                aria-pressed={selectedPlatform === code}
                                aria-label={`${ar ? item.ar : item.en} — ${ar ? 'عرض الحالة والمتطلبات' : 'View status and requirements'}`}
                                onClick={() => setSelectedPlatform(code)}
                            >
                                <CardContent>
                                    <Stack direction="row" justifyContent="space-between" gap={1}>
                                        <Typography fontWeight={800}>{ar ? item.ar : item.en}</Typography>
                                        <Chip
                                            size="small"
                                            label={available
                                                ? (ar ? STATUS_AR[row?.status || 'disconnected'] : row?.status || 'disconnected')
                                                : (ar ? 'غير مفعّلة حاليًا' : 'Currently unavailable')}
                                            color={available ? STATUS_COLORS[row?.status] || 'default' : 'default'}
                                        />
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
                            <Chip label={entitlementBadge.label} color={entitlementBadge.color} variant="outlined" />
                            <Button
                                variant="outlined"
                                aria-haspopup="dialog"
                                onClick={() => setRequirementsOpen(true)}
                            >
                                {ar ? 'لماذا؟ والمتطلبات' : 'Why? View requirements'}
                            </Button>
                        </Stack>
                    </Stack>

                    {!platformAvailable ? (
                        <Alert severity="warning" sx={{ mt: 3 }}>
                            {selectedPlatform
                                ? (ar
                                    ? `منصة ${profile.ar} غير مفعّلة في هذه البيئة حاليًا.`
                                    : `${profile.en} is not enabled in this environment.`)
                                : (ar
                                    ? 'لا توجد منصة ربط مفعّلة في هذه البيئة حاليًا.'
                                    : 'No integration platform is enabled in this environment.')}
                        </Alert>
                    ) : canConnect ? (
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
                                            disabled={!integrationCandidateIsSelectable(candidate, integration)}
                                        >
                                            {candidate.organization.name} — {candidate.target.display_name}
                                            {!candidate.target.connectable
                                                ? (integrationCandidateIsSelectable(candidate, integration)
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
                                disabled={loading || working || !selectedCandidate}
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

            {capabilities.length > 0 && (
                <Card sx={{ mb: 3 }}>
                    <CardContent>
                        <Typography variant="h6" fontWeight={800}>{ar ? 'قدرات التواصل بين المنصات' : 'Cross-platform communication capabilities'}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
                            {ar ? 'استلام الطلب ومراجعته مرحلتان منفصلتان عن الإرسال أو تنفيذ حملة أو نشر محتوى.' : 'Receiving and reviewing a request are separate from sending, running a campaign or publishing content.'}
                        </Typography>
                        <Stack spacing={1.5}>
                            {capabilities.map(capability => (
                                <Box key={capability.capability_id} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                                    <Stack direction="row" justifyContent="space-between" gap={1} flexWrap="wrap">
                                        <Typography fontWeight={700}>{capabilityLabels[capability.capability_id] || capability.capability_id}</Typography>
                                        <Chip size="small" color={capability.can_request_review ? 'info' : 'default'} label={capability.can_request_review
                                            ? (ar ? 'استقبال للمراجعة' : 'Review requests available')
                                            : (ar ? 'عرض المتطلبات' : 'Requirements available')} />
                                        <Chip size="small" variant="outlined" label={ar ? 'التنفيذ العابر غير مفعّل' : 'Cross-platform execution unavailable'} />
                                    </Stack>
                                    <Button sx={{ mt: 1 }} size="small" aria-haspopup="dialog" onClick={() => setRequirementsOpen(capability.capability_id)}>
                                        {ar ? 'لماذا؟' : 'Why?'}
                                    </Button>
                                </Box>
                            ))}
                        </Stack>
                    </CardContent>
                </Card>
            )}

            <SharedReadSetupPanel />
            <SharedReadOwnerSetupPanel />
            <SharedProductReadPanel />

            <Card>
                <CardContent>
                    <Typography variant="h6" fontWeight={800}>{ar ? 'حالة الخدمة' : 'Service status'}</Typography>
                    <Divider sx={{ my: 2 }} />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        {[
                            [ar ? 'نسخ المنتجات' : 'Product projections', counts.products || 0],
                            [ar ? 'طلبات خدمة للمراجعة' : 'Service requests pending review', counts.pending_service_requests || 0],
                            [ar ? 'إشعارات POS للمراجعة' : 'POS notifications pending review', counts.pending_notification_candidates || 0],
                            [
                                ar ? 'أحداث إرسال متعذرة' : 'Failed outbound events',
                                (outboxCounts.failed || 0) + (outboxCounts.dead_letter || 0),
                            ],
                        ].map(([label, value]) => <Box key={label} sx={{ flex: 1, p: 2, bgcolor: 'background.default', borderRadius: 2 }}><Typography variant="h5" fontWeight={800}>{value}</Typography><Typography variant="body2" color="text.secondary">{label}</Typography></Box>)}
                    </Stack>
                    {(outboxCounts.failed || outboxCounts.dead_letter) > 0 && (
                        <Button
                            sx={{ mt: 2 }}
                            variant="outlined"
                            startIcon={<RefreshIcon />}
                            disabled={working || status !== 'active'}
                            onClick={() => action('retry-outbox')}
                        >
                            {ar ? 'إعادة إرسال الأحداث المتعذرة' : 'Retry failed outbound events'}
                        </Button>
                    )}
                    <Alert severity="info" icon={<LinkIcon />} sx={{ mt: 2 }}>
                        {ar ? 'طلبات الإشعار الواردة لا تُرسل تلقائيًا؛ تُحفظ للمراجعة وتطبق سياسات القالب والموافقة.' : 'Incoming notification requests are never sent automatically; they await review and channel consent checks.'}
                    </Alert>
                    {serviceRequests.map((request) => {
                        const presentation = presentServiceRequest(request, language);
                        return (
                            <Alert
                                key={request.id}
                                severity={request.status === 'pending_review' ? 'warning' : 'info'}
                                sx={{ mt: 1 }}
                                action={presentation.dismissible ? (
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
                                <Stack spacing={0.75}>
                                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                                        <Chip size="small" label={presentation.kind} />
                                        <Chip
                                            size="small"
                                            variant="outlined"
                                            color={request.status === 'pending_review' ? 'warning' : 'default'}
                                            label={presentation.status}
                                        />
                                    </Stack>
                                    <Typography variant="body2">{presentation.summary}</Typography>
                                    {['pending_review', 'approved'].includes(request.status) && (
                                        <Typography variant="caption" color="text.secondary">
                                            {ar
                                                ? 'هذا النوع محفوظ للمراجعة؛ لا يتوفر تنفيذه أو إرساله من هذه الصفحة.'
                                                : 'This request is retained for review; this page does not execute or send it.'}
                                        </Typography>
                                    )}
                                </Stack>
                            </Alert>
                        );
                    })}
                </CardContent>
            </Card>
            <Dialog
                open={Boolean(requirementsOpen)}
                onClose={() => setRequirementsOpen(false)}
                fullWidth
                maxWidth="sm"
                aria-labelledby="integration-requirements-title"
            >
                <DialogTitle id="integration-requirements-title">{ar ? 'المتطلبات والخطوة التالية' : 'Requirements and next step'}</DialogTitle>
                <DialogContent>
                    <Stack spacing={1.5}>
                        {requirements.map(reason => <Alert key={reason.code} severity="warning">{reason.message}</Alert>)}
                        {requirements.length === 0 && <Alert severity="success">{ar ? 'متطلبات الربط الأساسية متاحة. لكل إجراء تحقق مستقل من الصلاحية والحساب والموافقة والتكلفة قبل التنفيذ.' : 'Basic connection requirements are met. Each action still requires separate permission, account, consent and cost checks before execution.'}</Alert>}
                        {capabilities.filter(capability => requirementsOpen === true || requirementsOpen === capability.capability_id).map(capability => (
                            <Box key={capability.capability_id}>
                                <Typography fontWeight={700} sx={{ mb: 1 }}>{capabilityLabels[capability.capability_id] || capability.capability_id}</Typography>
                                {[...(capability.review_blockers || []), ...(capability.execution_blockers || [])].filter((reason, index, rows) => rows.findIndex(row => row.code === reason.code) === index).map(reason => (
                                    <Alert key={reason.code} severity="info" sx={{ mt: 1 }}>
                                        {reason.message}
                                    </Alert>
                                ))}
                            </Box>
                        ))}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button disabled={loading || working} onClick={() => {
                        setRequirementsOpen(false);
                        load();
                    }}>{ar ? 'إعادة التحقق' : 'Check again'}</Button>
                    <Button onClick={() => setRequirementsOpen(false)}>{ar ? 'إغلاق' : 'Close'}</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default TenantPosIntegration;
