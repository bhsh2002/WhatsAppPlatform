import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Divider,
    Grid,
    LinearProgress,
    Paper,
    Stack,
    Typography,
} from '@mui/material';
import {
    Article as ArticleIcon,
    Business as BusinessIcon,
    CheckCircle as CheckCircleIcon,
    ErrorOutline as ErrorOutlineIcon,
    Facebook as FacebookIcon,
    FactCheck as FactCheckIcon,
    Forum as ForumIcon,
    History as HistoryIcon,
    OpenInNew as OpenInNewIcon,
    PersonSearch as PersonSearchIcon,
    Refresh as RefreshIcon,
    Save as SaveIcon,
    TrendingUp as TrendingUpIcon,
    Webhook as WebhookIcon,
} from '@mui/icons-material';
import api from '../../api';

const STATUS_CONFIG = {
    ready: { label: 'جاهز', color: 'success', icon: <CheckCircleIcon /> },
    action_required: { label: 'يتطلب إجراء', color: 'warning', icon: <ErrorOutlineIcon /> },
    missing: { label: 'ناقص', color: 'error', icon: <ErrorOutlineIcon /> },
};

const getStatusConfig = (status) => STATUS_CONFIG[status] || STATUS_CONFIG.action_required;

const formatDate = (value) => {
    if (!value) return 'غير متوفر';
    try {
        return new Date(value).toLocaleString('ar-LY');
    } catch {
        return value;
    }
};

const StatusChip = ({ status }) => {
    const config = getStatusConfig(status);
    return (
        <Chip
            icon={config.icon}
            label={config.label}
            color={config.color}
            size="small"
            variant={status === 'ready' ? 'filled' : 'outlined'}
        />
    );
};

const Metric = ({ label, value }) => (
    <Box>
        <Typography variant="caption" color="text.secondary" component="div">
            {label}
        </Typography>
        <Typography variant="body2" fontWeight={700}>
            {value}
        </Typography>
    </Box>
);

const MissingChips = ({ items, emptyLabel = 'لا توجد نواقص' }) => {
    if (!items?.length) {
        return <Chip label={emptyLabel} color="success" size="small" variant="outlined" />;
    }

    return items.map(item => (
        <Chip key={item} label={item} color="warning" size="small" variant="outlined" />
    ));
};

const SourceLabel = {
    production_event: 'حدث إنتاج',
    meta_dashboard_test: 'اختبار Meta',
    internal_test: 'اختبار داخلي',
};

const PermissionMatrix = ({ permissions }) => {
    if (!permissions?.length) return null;

    return (
        <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>
                مصفوفة الأذونات والأدلة
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                كل إذن مربوط بمسار استخدام ودليل تشغيل. الحالة لا تعتمد على وجود scope فقط.
            </Typography>
            <Grid container spacing={1.5}>
                {permissions.map(permission => (
                    <Grid size={{ xs: 12, md: 6, xl: 4 }} key={permission.key}>
                        <Box
                            sx={{
                                border: 1,
                                borderColor: 'divider',
                                borderRadius: 1,
                                p: 1.5,
                                height: '100%',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 1,
                            }}
                        >
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'flex-start' }}>
                                <Box>
                                    <Typography variant="subtitle2" fontWeight={700}>{permission.label}</Typography>
                                    <Typography variant="caption" color="text.secondary">{permission.key}</Typography>
                                </Box>
                                <StatusChip status={permission.status} />
                            </Box>
                            <Typography variant="body2" color="text.secondary">
                                {permission.usage}
                            </Typography>
                            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                <Chip
                                    label={permission.feature
                                        ? (permission.granted ? 'دليل موجود' : 'لا يوجد دليل')
                                        : (permission.granted ? 'ممنوح' : 'غير ممنوح')}
                                    color={permission.granted ? 'success' : 'warning'}
                                    size="small"
                                    variant="outlined"
                                />
                                <Chip
                                    label={`الدليل: ${getStatusConfig(permission.evidence_status).label}`}
                                    color={getStatusConfig(permission.evidence_status).color}
                                    size="small"
                                    variant="outlined"
                                />
                            </Stack>
                            <Typography variant="caption" color="text.secondary">
                                آخر نجاح: {formatDate(permission.last_success_at)}
                            </Typography>
                        </Box>
                    </Grid>
                ))}
            </Grid>
        </Paper>
    );
};

const WebhookEvidence = ({ evidence }) => {
    const fields = Object.entries(evidence?.by_field || {});
    if (!fields.length) return null;

    return (
        <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>
                أدلة Webhook الفعلية
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {fields.map(([field, item]) => (
                    <Chip
                        key={field}
                        label={`${field}: ${item.production_count || 0}/${item.count || 0} إنتاج - ${SourceLabel[item.latest_source] || item.latest_source || 'غير معروف'}`}
                        color={(item.production_count || 0) > 0 ? 'success' : 'warning'}
                        variant="outlined"
                    />
                ))}
            </Stack>
        </Paper>
    );
};

const ReviewSectionCard = ({ title, icon, section, metrics, missingItems, actionLabel, actionPath, children }) => (
    <Card sx={{ height: '100%' }}>
        <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'flex-start' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ color: 'primary.main', display: 'flex' }}>{icon}</Box>
                    <Typography variant="h6" fontWeight={700}>{title}</Typography>
                </Box>
                <StatusChip status={section?.status} />
            </Box>

            {section?.review_hint && (
                <Typography variant="body2" color="text.secondary">
                    {section.review_hint}
                </Typography>
            )}

            <Grid container spacing={2}>
                {metrics.map(metric => (
                    <Grid size={{ xs: 6 }} key={metric.label}>
                        <Metric label={metric.label} value={metric.value} />
                    </Grid>
                ))}
            </Grid>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <MissingChips items={missingItems} />
            </Box>

            {children}

            {actionPath && (
                <Box sx={{ mt: 'auto', pt: 1 }}>
                    <Button
                        component={RouterLink}
                        to={actionPath}
                        variant="outlined"
                        size="small"
                        endIcon={<OpenInNewIcon />}
                    >
                        {actionLabel}
                    </Button>
                </Box>
            )}
        </CardContent>
    </Card>
);

const TenantMetaReview = () => {
    const [readiness, setReadiness] = useState(null);
    const [snapshots, setSnapshots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [savingSnapshot, setSavingSnapshot] = useState(false);
    const [error, setError] = useState('');
    const [snapshotMessage, setSnapshotMessage] = useState('');

    const loadSnapshots = useCallback(async () => {
        try {
            const data = await api.getMetaReviewSnapshots(5);
            setSnapshots(data.snapshots || []);
        } catch {
            setSnapshots([]);
        }
    }, []);

    const loadReadiness = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            const data = await api.getMetaReviewReadiness();
            setReadiness(data);
            await loadSnapshots();
        } catch (err) {
            setError(err.message || 'فشل تحميل جاهزية مراجعة Meta');
        } finally {
            setLoading(false);
        }
    }, [loadSnapshots]);

    useEffect(() => { loadReadiness(); }, [loadReadiness]);

    const handleSaveSnapshot = async () => {
        try {
            setSavingSnapshot(true);
            setSnapshotMessage('');
            const data = await api.saveMetaReviewSnapshot();
            setReadiness(data.readiness);
            await loadSnapshots();
            setSnapshotMessage('تم حفظ لقطة جاهزية Meta كدليل مراجعة.');
        } catch (err) {
            setError(err.message || 'فشل حفظ لقطة جاهزية Meta');
        } finally {
            setSavingSnapshot(false);
        }
    };

    const sections = useMemo(() => {
        if (!readiness) return [];

        return [
            {
                title: 'أذونات Facebook OAuth',
                icon: <FacebookIcon />,
                section: readiness.permissions,
                missingItems: readiness.permissions?.missing_scopes,
                actionLabel: 'إعادة التفويض',
                actionPath: readiness.permissions?.action_path,
                metrics: [
                    { label: 'الممنوحة', value: `${readiness.permissions?.granted_scopes?.length || 0}/${readiness.permissions?.requested_scopes?.length || 0}` },
                    { label: 'آخر تفويض', value: formatDate(readiness.permissions?.facebook_user_token_updated_at) },
                ],
            },
            {
                title: 'دليل هوية Facebook',
                icon: <PersonSearchIcon />,
                section: readiness.identity,
                missingItems: [
                    !readiness.identity?.public_profile_ready ? 'public_profile' : null,
                    !readiness.identity?.email_ready ? 'email evidence' : null,
                ].filter(Boolean),
                actionLabel: 'إعادة التفويض',
                actionPath: readiness.identity?.action_path,
                metrics: [
                    { label: 'Public profile', value: readiness.identity?.public_profile_ready ? 'مثبت' : 'غير مثبت' },
                    { label: 'Email', value: readiness.identity?.email_ready ? 'موجود' : readiness.identity?.email_granted ? 'ممنوح بلا بريد' : 'غير مثبت' },
                ],
            },
            {
                title: 'الصفحات و Webhooks',
                icon: <WebhookIcon />,
                section: readiness.pages,
                missingItems: readiness.pages?.webhook_ready_count ? [] : readiness.pages?.required_webhook_fields,
                actionLabel: 'إدارة الصفحات',
                actionPath: readiness.pages?.action_path,
                metrics: [
                    { label: 'الصفحات النشطة', value: readiness.pages?.active_count || 0 },
                    { label: 'Webhooks جاهزة', value: readiness.pages?.webhook_ready_count || 0 },
                ],
            },
            {
                title: 'محتوى الصفحة',
                icon: <ArticleIcon />,
                section: readiness.content,
                missingItems: readiness.content?.missing_permissions,
                actionLabel: 'فتح إدارة المحتوى',
                actionPath: readiness.content?.action_path,
                metrics: [
                    { label: 'صفحات برمز صالح', value: readiness.content?.linked_pages_ready || 0 },
                    { label: 'الإجراءات', value: readiness.content?.supported_actions?.length || 0 },
                ],
            },
            {
                title: 'Messenger',
                icon: <ForumIcon />,
                section: readiness.messenger,
                missingItems: readiness.messenger?.missing_permissions,
                actionLabel: 'فتح inbox',
                actionPath: readiness.messenger?.action_path,
                metrics: [
                    { label: 'المحادثات', value: readiness.messenger?.conversations_count || 0 },
                    { label: 'آخر نشاط', value: formatDate(readiness.messenger?.latest_activity_at) },
                ],
            },
            {
                title: 'Business Asset User Profile Access',
                icon: <PersonSearchIcon />,
                section: readiness.business_asset_user_profile_access,
                missingItems: readiness.business_asset_user_profile_access?.status === 'ready'
                    ? []
                    : [readiness.business_asset_user_profile_access?.feature_required].filter(Boolean),
                actionLabel: 'فتح inbox',
                actionPath: readiness.business_asset_user_profile_access?.action_path,
                metrics: [
                    { label: 'ملفات مستخدمين', value: readiness.business_asset_user_profile_access?.profile_records_count || 0 },
                    { label: 'الميزة', value: readiness.business_asset_user_profile_access?.feature_required || '-' },
                ],
            },
            {
                title: 'دليل الميزات',
                icon: <FactCheckIcon />,
                section: readiness.feature_evidence,
                missingItems: readiness.feature_evidence?.status === 'ready'
                    ? []
                    : (readiness.feature_evidence?.features || [])
                        .filter(feature => feature.status !== 'ready')
                        .map(feature => feature.label),
                actionLabel: 'عرض التفاصيل',
                actionPath: readiness.feature_evidence?.action_path,
                metrics: [
                    {
                        label: 'ميزات مثبتة',
                        value: `${(readiness.feature_evidence?.features || []).filter(feature => feature.status === 'ready').length}/${readiness.feature_evidence?.features?.length || 0}`,
                    },
                    { label: 'آخر فشل Partner', value: formatDate(readiness.feature_evidence?.features?.find(feature => feature.key === 'manage_app_solution')?.last_failure_at) },
                ],
            },
            {
                title: 'Business APIs',
                icon: <BusinessIcon />,
                section: readiness.business,
                missingItems: readiness.business?.missing_permissions,
                actionLabel: 'إعادة تفويض Facebook',
                actionPath: readiness.business?.action_path,
                metrics: [
                    { label: 'Business ID', value: readiness.business?.business_id_present ? 'موجود' : 'غير موجود' },
                    { label: 'Facebook token', value: readiness.business?.facebook_user_token_present ? 'موجود' : 'غير موجود' },
                ],
                adminPaths: readiness.business?.admin_paths || [],
            },
            {
                title: 'WhatsApp Events API',
                icon: <TrendingUpIcon />,
                section: readiness.whatsapp_events,
                missingItems: readiness.whatsapp_events?.status === 'ready'
                    ? []
                    : [readiness.whatsapp_events?.permission_required].filter(Boolean),
                actionLabel: 'فتح أحداث التحويل',
                actionPath: readiness.whatsapp_events?.action_path,
                metrics: [
                    { label: 'Dataset ID', value: readiness.whatsapp_events?.dataset_id_present ? 'موجود' : 'غير موجود' },
                    { label: 'أحداث مرسلة', value: readiness.whatsapp_events?.events_sent || 0 },
                ],
            },
        ];
    }, [readiness]);

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                justifyContent: 'space-between',
                alignItems: { xs: 'flex-start', md: 'center' },
                gap: 2,
                mb: 3,
            }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <FactCheckIcon sx={{ fontSize: 34, color: 'primary.main' }} />
                    <Box>
                        <Typography variant="h5" fontWeight={700}>جاهزية مراجعة Meta</Typography>
                        <Typography variant="body2" color="text.secondary">
                            حالة الأذونات ومسارات الإثبات المطلوبة قبل إعادة التقديم
                        </Typography>
                    </Box>
                </Box>
                <Button startIcon={<RefreshIcon />} variant="outlined" onClick={loadReadiness}>
                    تحديث
                </Button>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
            {snapshotMessage && <Alert severity="success" sx={{ mb: 3 }}>{snapshotMessage}</Alert>}

            {readiness && (
                <>
                    <Paper sx={{ p: 3, mb: 3 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'center', mb: 2 }}>
                            <Box>
                                <Typography variant="h6" fontWeight={700}>الحالة العامة</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    آخر فحص: {formatDate(readiness.generated_at)}
                                </Typography>
                            </Box>
                            <StatusChip status={readiness.overall?.status} />
                        </Box>
                        <LinearProgress
                            variant="determinate"
                            value={((readiness.overall?.ready_count || 0) / (readiness.overall?.total_count || 1)) * 100}
                            sx={{ height: 8, borderRadius: 1, mb: 1.5 }}
                        />
                        <Typography variant="body2" color="text.secondary">
                            الجاهز: {readiness.overall?.ready_count || 0} من {readiness.overall?.total_count || 0}
                            {readiness.overall?.permissions_total_count ? (
                                <> - الأذونات المثبتة: {readiness.overall.permissions_ready_count || 0} من {readiness.overall.permissions_total_count}</>
                            ) : null}
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
                            <Button
                                variant="contained"
                                size="small"
                                startIcon={savingSnapshot ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                                onClick={handleSaveSnapshot}
                                disabled={savingSnapshot}
                            >
                                حفظ لقطة دليل
                            </Button>
                        </Box>
                    </Paper>

                    {snapshots.length > 0 && (
                        <Paper sx={{ p: 3, mb: 3 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                                <HistoryIcon color="primary" />
                                <Typography variant="h6" fontWeight={700}>آخر لقطات الجاهزية</Typography>
                            </Box>
                            <Stack spacing={1}>
                                {snapshots.map(snapshot => (
                                    <Box
                                        key={snapshot.id}
                                        sx={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            gap: 2,
                                            border: 1,
                                            borderColor: 'divider',
                                            borderRadius: 1,
                                            p: 1.25,
                                        }}
                                    >
                                        <Box>
                                            <Typography variant="body2" fontWeight={700}>
                                                {formatDate(snapshot.created_at)}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                الأذونات المثبتة: {snapshot.permissions_ready_count ?? 0} من {snapshot.permissions_total_count ?? 0}
                                            </Typography>
                                        </Box>
                                        <StatusChip status={snapshot.status} />
                                    </Box>
                                ))}
                            </Stack>
                        </Paper>
                    )}

                    <PermissionMatrix permissions={readiness.permission_matrix} />
                    <WebhookEvidence evidence={readiness.webhook_evidence} />

                    <Grid container spacing={3}>
                        {sections.map(section => (
                            <Grid size={{ xs: 12, lg: 6 }} key={section.title}>
                                <ReviewSectionCard
                                    title={section.title}
                                    icon={section.icon}
                                    section={section.section}
                                    metrics={section.metrics}
                                    missingItems={section.missingItems}
                                    actionLabel={section.actionLabel}
                                    actionPath={section.actionPath}
                                >
                                    {section.adminPaths?.length > 0 && (
                                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                            {section.adminPaths.map(path => (
                                                <Chip key={path} label={`Admin: ${path}`} size="small" variant="outlined" />
                                            ))}
                                        </Stack>
                                    )}
                                    {section.section?.key === 'identity' && (
                                        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.25 }}>
                                            <Typography variant="body2" fontWeight={700}>
                                                {section.section.facebook_user?.name || 'لم تحفظ هوية Facebook بعد'}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary" component="div">
                                                {section.section.facebook_user?.email || 'البريد غير مرجع من Meta'}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary" component="div">
                                                ID: {section.section.facebook_user?.id || '-'}
                                            </Typography>
                                        </Box>
                                    )}
                                    {section.section?.key === 'feature_evidence' && (
                                        <Stack spacing={1}>
                                            {(section.section.features || []).map(feature => (
                                                <Box
                                                    key={feature.key}
                                                    sx={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'center',
                                                        gap: 1,
                                                        border: 1,
                                                        borderColor: 'divider',
                                                        borderRadius: 1,
                                                        p: 1,
                                                    }}
                                                >
                                                    <Box>
                                                        <Typography variant="body2" fontWeight={700}>{feature.label}</Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            آخر نجاح: {formatDate(feature.last_success_at)}
                                                        </Typography>
                                                    </Box>
                                                    <StatusChip status={feature.status} />
                                                </Box>
                                            ))}
                                        </Stack>
                                    )}
                                </ReviewSectionCard>
                            </Grid>
                        ))}
                    </Grid>

                    {readiness.pages?.pages?.length > 0 && (
                        <Paper sx={{ p: 3, mt: 3 }}>
                            <Typography variant="h6" fontWeight={700} gutterBottom>
                                تفاصيل صفحات Facebook
                            </Typography>
                            <Stack spacing={2} divider={<Divider flexItem />}>
                                {readiness.pages.pages.map(page => (
                                    <Box
                                        key={page.id}
                                        sx={{
                                            display: 'flex',
                                            flexDirection: { xs: 'column', md: 'row' },
                                            alignItems: { xs: 'flex-start', md: 'center' },
                                            justifyContent: 'space-between',
                                            gap: 2,
                                        }}
                                    >
                                        <Box>
                                            <Typography variant="subtitle1" fontWeight={700}>
                                                {page.page_name || page.page_id}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                Page ID: {page.page_id} | آخر تحديث: {formatDate(page.updated_at)}
                                            </Typography>
                                        </Box>
                                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                            <StatusChip status={page.webhook_ready ? 'ready' : 'action_required'} />
                                            <Chip
                                                label={page.page_access_token_present ? 'Page token موجود' : 'Page token مفقود'}
                                                color={page.page_access_token_present ? 'success' : 'warning'}
                                                size="small"
                                                variant="outlined"
                                            />
                                            {page.missing_webhook_fields?.map(field => (
                                                <Chip key={field} label={`Webhook ناقص: ${field}`} color="warning" size="small" variant="outlined" />
                                            ))}
                                        </Stack>
                                    </Box>
                                ))}
                            </Stack>
                        </Paper>
                    )}
                </>
            )}
        </Box>
    );
};

export default TenantMetaReview;
