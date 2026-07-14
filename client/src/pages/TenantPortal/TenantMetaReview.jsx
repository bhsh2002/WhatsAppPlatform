import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Divider, Grid, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import { Article as ArticleIcon, Business as BusinessIcon, CheckCircle as CheckCircleIcon, ErrorOutline as ErrorOutlineIcon, Facebook as FacebookIcon, FactCheck as FactCheckIcon, Forum as ForumIcon, History as HistoryIcon, OpenInNew as OpenInNewIcon, PersonSearch as PersonSearchIcon, Refresh as RefreshIcon, Save as SaveIcon, TrendingUp as TrendingUpIcon, Webhook as WebhookIcon } from '@mui/icons-material';
import api from '../../api';
import { useLanguage } from '../../context/LanguageContext';
import { PageTitle } from '../../components/Layout/PageTitle';
import { tx } from "../../i18n/tx";
import { getCurrentLocale } from '../../utils/locale';
const STATUS_CONFIG = {
  ready: {
    labelKey: 'metaReview.ready',
    color: 'success',
    icon: <CheckCircleIcon />
  },
  action_required: {
    labelKey: 'metaReview.actionRequired',
    color: 'warning',
    icon: <ErrorOutlineIcon />
  },
  missing: {
    labelKey: 'metaReview.missing',
    color: 'error',
    icon: <ErrorOutlineIcon />
  }
};
const getStatusConfig = status => STATUS_CONFIG[status] || STATUS_CONFIG.action_required;
const translationsFallback = key => {
  const labels = {
    'common.unavailable': document.documentElement.lang === 'en' ? 'Unavailable' : tx("auto.k_6c6d82b6791a")
  };
  return labels[key] || key;
};
const formatDate = value => {
  if (!value) return translationsFallback('common.unavailable');
  try {
    return new Date(value).toLocaleString(getCurrentLocale());
  } catch {
    return value;
  }
};
const StatusChip = ({
  status
}) => {
  const {
    t
  } = useLanguage();
  const config = getStatusConfig(status);
  return <Chip icon={config.icon} label={t(config.labelKey)} color={config.color} size="small" variant={status === 'ready' ? 'filled' : 'outlined'} />;
};
const Metric = ({
  label,
  value
}) => <Box>
        <Typography variant="caption" color="text.secondary" component="div">
            {label}
        </Typography>
        <Typography variant="body2" fontWeight={700}>
            {value}
        </Typography>
    </Box>;
const MissingChips = ({
  items,
  emptyLabel
}) => {
  const {
    t
  } = useLanguage();
  if (!items?.length) {
    return <Chip label={emptyLabel || t('metaReview.noMissing')} color="success" size="small" variant="outlined" />;
  }
  return items.map(item => <Chip key={item} label={item} color="warning" size="small" variant="outlined" />);
};
const SourceLabelKey = {
  production_event: 'metaReview.productionEvent',
  meta_dashboard_test: 'metaReview.metaDashboardTest',
  internal_test: 'metaReview.internalTest'
};
const PermissionMatrix = ({
  permissions
}) => {
  const {
    t
  } = useLanguage();
  if (!permissions?.length) return null;
  return <Paper sx={{
    p: 3,
    mb: 3
  }}>
            <Typography component="h2" variant="h6" fontWeight={700} gutterBottom>
                {t('metaReview.permissionMatrix')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{
      mb: 2
    }}>
                {t('metaReview.permissionMatrixHint')}
            </Typography>
            <Grid container spacing={1.5}>
                {permissions.map(permission => <Grid size={{
        xs: 12,
        md: 6,
        xl: 4
      }} key={permission.key}>
                        <Box sx={{
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          p: 1.5,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 1
        }}>

                            <Box sx={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 1,
            alignItems: 'flex-start'
          }}>
                                <Box>
                                    <Typography component="h3" variant="subtitle2" fontWeight={700}>{permission.label}</Typography>
                                    <Typography variant="caption" color="text.secondary">{permission.key}</Typography>
                                </Box>
                                <StatusChip status={permission.status} />
                            </Box>
                            <Typography variant="body2" color="text.secondary">
                                {permission.usage}
                            </Typography>
                            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                <Chip label={permission.feature ? permission.granted ? t('metaReview.evidenceFound') : t('metaReview.noEvidence') : permission.granted ? t('metaReview.granted') : t('metaReview.notGranted')} color={permission.granted ? 'success' : 'warning'} size="small" variant="outlined" />

                                <Chip label={t('metaReview.evidence', {
              status: t(getStatusConfig(permission.evidence_status).labelKey)
            })} color={getStatusConfig(permission.evidence_status).color} size="small" variant="outlined" />

                            </Stack>
                            <Typography variant="caption" color="text.secondary">
                                {t('metaReview.lastSuccess', {
              date: formatDate(permission.last_success_at)
            })}
                            </Typography>
                        </Box>
                    </Grid>)}
            </Grid>
        </Paper>;
};
const WebhookEvidence = ({
  evidence
}) => {
  const {
    t
  } = useLanguage();
  const fields = Object.entries(evidence?.by_field || {});
  if (!fields.length) return null;
  return <Paper sx={{
    p: 3,
    mb: 3
  }}>
            <Typography component="h2" variant="h6" fontWeight={700} gutterBottom>
                {t('metaReview.webhookEvidence')}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {fields.map(([field, item]) => <Chip key={field} label={`${field}: ${item.production_count || 0}/${item.count || 0} - ${SourceLabelKey[item.latest_source] ? t(SourceLabelKey[item.latest_source]) : item.latest_source || t('metaReview.unknownSource')}`} color={(item.production_count || 0) > 0 ? 'success' : 'warning'} variant="outlined" />)}
            </Stack>
        </Paper>;
};
const ReviewSectionCard = ({
  title,
  icon,
  section,
  metrics,
  missingItems,
  actionLabel,
  actionPath,
  children
}) => <Card sx={{
  height: '100%'
}}>
        <CardContent sx={{
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 2
  }}>
            <Box sx={{
      display: 'flex',
      justifyContent: 'space-between',
      gap: 2,
      alignItems: 'flex-start'
    }}>
                <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5
      }}>
                    <Box sx={{
          color: 'primary.main',
          display: 'flex'
        }}>{icon}</Box>
                    <Typography component="h2" variant="h6" fontWeight={700}>{title}</Typography>
                </Box>
                <StatusChip status={section?.status} />
            </Box>

            {section?.review_hint && <Typography variant="body2" color="text.secondary">
                    {section.review_hint}
                </Typography>}

            <Grid container spacing={2}>
                {metrics.map(metric => <Grid size={{
        xs: 6
      }} key={metric.label}>
                        <Metric label={metric.label} value={metric.value} />
                    </Grid>)}
            </Grid>

            <Box sx={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 1
    }}>
                <MissingChips items={missingItems} />
            </Box>

            {children}

            {actionPath && <Box sx={{
      mt: 'auto',
      pt: 1
    }}>
                    <Button component={RouterLink} to={actionPath} variant="outlined" size="small" endIcon={<OpenInNewIcon />}>

                        {actionLabel}
                    </Button>
                </Box>}
        </CardContent>
    </Card>;
const TenantMetaReview = () => {
  const {
    t
  } = useLanguage();
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
      setError(err.message || t('metaReview.fetchFailed'));
    } finally {
      setLoading(false);
    }
  }, [loadSnapshots, t]);
  useEffect(() => {
    loadReadiness();
  }, [loadReadiness]);
  const handleSaveSnapshot = async () => {
    try {
      setSavingSnapshot(true);
      setSnapshotMessage('');
      const data = await api.saveMetaReviewSnapshot();
      setReadiness(data.readiness);
      await loadSnapshots();
      setSnapshotMessage(t('metaReview.snapshotSaved'));
    } catch (err) {
      setError(err.message || t('metaReview.snapshotFailed'));
    } finally {
      setSavingSnapshot(false);
    }
  };
  const sections = useMemo(() => {
    if (!readiness) return [];
    return [{
      title: t('metaReview.facebookOauth'),
      icon: <FacebookIcon />,
      section: readiness.permissions,
      missingItems: readiness.permissions?.missing_scopes,
      actionLabel: t('metaReview.reauthorize'),
      actionPath: readiness.permissions?.action_path,
      metrics: [{
        label: t('metaReview.facebookRequestedGranted'),
        value: `${readiness.permissions?.requested_scopes?.length || 0} / ${readiness.permissions?.granted_scopes?.length || 0}`
      }, {
        label: t('metaReview.lastAuthorization'),
        value: formatDate(readiness.permissions?.facebook_user_token_updated_at)
      }]
    }, {
      title: t('metaReview.identityEvidence'),
      icon: <PersonSearchIcon />,
      section: readiness.identity,
      missingItems: [!readiness.identity?.public_profile_ready ? 'public_profile' : null, !readiness.identity?.email_ready ? 'email evidence' : null].filter(Boolean),
      actionLabel: t('metaReview.reauthorize'),
      actionPath: readiness.identity?.action_path,
      metrics: [{
        label: t('metaReview.publicProfile'),
        value: readiness.identity?.public_profile_ready ? t('metaReview.verified') : t('metaReview.notVerified')
      }, {
        label: t('metaReview.email'),
        value: readiness.identity?.email_ready ? t('metaReview.present') : readiness.identity?.email_granted ? t('metaReview.grantedNoEmail') : t('metaReview.notVerified')
      }]
    }, {
      title: t('metaReview.pagesWebhooks'),
      icon: <WebhookIcon />,
      section: readiness.pages,
      missingItems: readiness.pages?.webhook_ready_count ? [] : readiness.pages?.required_webhook_fields,
      actionLabel: t('metaReview.managePages'),
      actionPath: readiness.pages?.action_path,
      metrics: [{
        label: t('metaReview.activePages'),
        value: readiness.pages?.active_count || 0
      }, {
        label: t('metaReview.readyWebhooks'),
        value: readiness.pages?.webhook_ready_count || 0
      }]
    }, {
      title: t('metaReview.pageContent'),
      icon: <ArticleIcon />,
      section: readiness.content,
      missingItems: readiness.content?.missing_permissions,
      actionLabel: t('metaReview.openContent'),
      actionPath: readiness.content?.action_path,
      metrics: [{
        label: t('metaReview.pagesWithValidToken'),
        value: readiness.content?.linked_pages_ready || 0
      }, {
        label: t('metaReview.actions'),
        value: readiness.content?.supported_actions?.length || 0
      }]
    }, {
      title: t('metaReview.messenger'),
      icon: <ForumIcon />,
      section: readiness.messenger,
      missingItems: readiness.messenger?.missing_permissions,
      actionLabel: t('metaReview.openInbox'),
      actionPath: readiness.messenger?.action_path,
      metrics: [{
        label: t('metaReview.conversations'),
        value: readiness.messenger?.conversations_count || 0
      }, {
        label: t('metaReview.latestActivity'),
        value: formatDate(readiness.messenger?.latest_activity_at)
      }]
    }, {
      title: t('metaReview.businessAssetProfile'),
      icon: <PersonSearchIcon />,
      section: readiness.business_asset_user_profile_access,
      missingItems: readiness.business_asset_user_profile_access?.status === 'ready' ? [] : [readiness.business_asset_user_profile_access?.feature_required].filter(Boolean),
      actionLabel: t('metaReview.openInbox'),
      actionPath: readiness.business_asset_user_profile_access?.action_path,
      metrics: [{
        label: t('metaReview.userProfiles'),
        value: readiness.business_asset_user_profile_access?.profile_records_count || 0
      }, {
        label: t('metaReview.feature'),
        value: readiness.business_asset_user_profile_access?.feature_required || '-'
      }]
    }, {
      title: t('metaReview.featureEvidence'),
      icon: <FactCheckIcon />,
      section: readiness.feature_evidence,
      missingItems: readiness.feature_evidence?.status === 'ready' ? [] : (readiness.feature_evidence?.features || []).filter(feature => feature.status !== 'ready').map(feature => feature.label),
      actionLabel: t('metaReview.viewDetails'),
      actionPath: readiness.feature_evidence?.action_path,
      metrics: [{
        label: t('metaReview.provenFeatures'),
        value: `${(readiness.feature_evidence?.features || []).filter(feature => feature.status === 'ready').length}/${readiness.feature_evidence?.features?.length || 0}`
      }, {
        label: t('metaReview.lastPartnerFailure'),
        value: formatDate(readiness.feature_evidence?.features?.find(feature => feature.key === 'manage_app_solution')?.last_failure_at)
      }]
    }, {
      title: t('metaReview.businessApis'),
      icon: <BusinessIcon />,
      section: readiness.business,
      missingItems: readiness.business?.missing_permissions,
      actionLabel: t('metaReview.reauthorize'),
      actionPath: readiness.business?.action_path,
      metrics: [{
        label: t('metaReview.businessId'),
        value: readiness.business?.business_id_present ? t('metaReview.present') : t('common.notSet')
      }, {
        label: t('metaReview.facebookToken'),
        value: readiness.business?.facebook_user_token_present ? t('metaReview.present') : t('common.notSet')
      }],
      adminPaths: readiness.business?.admin_paths || []
    }, {
      title: t('metaReview.whatsappEvents'),
      icon: <TrendingUpIcon />,
      section: readiness.whatsapp_events,
      missingItems: readiness.whatsapp_events?.status === 'ready' ? [] : [readiness.whatsapp_events?.permission_required].filter(Boolean),
      actionLabel: t('metaReview.openConversions'),
      actionPath: readiness.whatsapp_events?.action_path,
      metrics: [{
        label: t('metaReview.datasetId'),
        value: readiness.whatsapp_events?.dataset_id_present ? t('metaReview.present') : t('common.notSet')
      }, {
        label: t('metaReview.sentEvents'),
        value: readiness.whatsapp_events?.events_sent || 0
      }]
    }];
  }, [readiness, t]);
  if (loading) {
    return <Box sx={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: 400
    }}>
                <CircularProgress />
            </Box>;
  }
  return <Box sx={{
    p: {
      xs: 1.5,
      md: 3
    }
  }}>
            <Box sx={{
      display: 'flex',
      flexDirection: {
        xs: 'column',
        md: 'row'
      },
      justifyContent: 'space-between',
      alignItems: {
        xs: 'flex-start',
        md: 'center'
      },
      gap: 2,
      mb: 3
    }}>
                <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2
      }}>
                    <FactCheckIcon sx={{
          fontSize: 34,
          color: 'primary.main'
        }} />
                    <Box>
                        <PageTitle variant="h5" fontWeight={700}>{t('metaReview.title')}</PageTitle>
                        <Typography variant="body2" color="text.secondary">
                            {t('metaReview.subtitle')}
                        </Typography>
                    </Box>
                </Box>
                <Button startIcon={<RefreshIcon />} variant="outlined" onClick={loadReadiness}>
                    {t('common.refresh')}
                </Button>
            </Box>

            {error && <Alert severity="error" sx={{
      mb: 3
    }}>{error}</Alert>}
            {snapshotMessage && <Alert severity="success" sx={{
      mb: 3
    }}>{snapshotMessage}</Alert>}

            {readiness && <>
                    <Paper sx={{
        p: 3,
        mb: 3
      }}>
                        <Box sx={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 2,
          alignItems: 'center',
          mb: 2
        }}>
                            <Box>
                                <Typography component="h2" variant="h6" fontWeight={700}>{t('metaReview.overallStatus')}</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    {t('metaReview.lastCheck', {
                date: formatDate(readiness.generated_at)
              })}
                                </Typography>
                            </Box>
                            <StatusChip status={readiness.overall?.status} />
                        </Box>
                        <LinearProgress aria-label={t('metaReview.overallStatus')} variant="determinate" value={(readiness.overall?.ready_count || 0) / (readiness.overall?.total_count || 1) * 100} sx={{
          height: 8,
          borderRadius: 1,
          mb: 1.5
        }} />

                        <Typography variant="body2" color="text.secondary">
                            {t('metaReview.readinessProgress', {
            ready: readiness.overall?.ready_count || 0,
            total: readiness.overall?.total_count || 0
          })}
                            {readiness.overall?.permissions_total_count ? <> - {t('metaReview.provenPermissions', {
              ready: readiness.overall.permissions_ready_count || 0,
              total: readiness.overall.permissions_total_count
            })}</> : null}
                        </Typography>
                        <Box sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          mt: 2
        }}>
                            <Button variant="contained" size="small" startIcon={savingSnapshot ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />} onClick={handleSaveSnapshot} disabled={savingSnapshot}>

                                {t('metaReview.saveEvidenceSnapshot')}
                            </Button>
                        </Box>
                    </Paper>

                    {readiness.remaining_actions?.length > 0 && <Paper sx={{
        p: 3,
        mb: 3
      }}>
                            <Typography component="h2" variant="h6" fontWeight={700} gutterBottom>
                                {t('metaReview.remainingActions')}
                            </Typography>
                            <Stack spacing={1.5}>
                                {readiness.remaining_actions.map(item => <Box key={item.key} sx={{
            display: 'flex',
            flexDirection: {
              xs: 'column',
              md: 'row'
            },
            justifyContent: 'space-between',
            alignItems: {
              xs: 'flex-start',
              md: 'center'
            },
            gap: 2,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            p: 1.5
          }}>

                                        <Box>
                                            <Typography component="h3" variant="subtitle2" fontWeight={700}>{item.label}</Typography>
                                            <Typography variant="body2" color="text.secondary">{item.reason}</Typography>
                                        </Box>
                                        <Stack direction="row" spacing={1} alignItems="center">
                                            <StatusChip status={item.status} />
                                            <Button component={RouterLink} to={item.action_path} size="small" variant="outlined" endIcon={<OpenInNewIcon />}>

                                                {t('metaReview.open')}
                                            </Button>
                                        </Stack>
                                    </Box>)}
                            </Stack>
                        </Paper>}

                    {snapshots.length > 0 && <Paper sx={{
        p: 3,
        mb: 3
      }}>
                            <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 2
        }}>
                                <HistoryIcon color="primary" />
                                <Typography component="h2" variant="h6" fontWeight={700}>{t('metaReview.recentSnapshots')}</Typography>
                            </Box>
                            <Stack spacing={1}>
                                {snapshots.map(snapshot => <Box key={snapshot.id} sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 2,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            p: 1.25
          }}>

                                        <Box>
                                            <Typography variant="body2" fontWeight={700}>
                                                {formatDate(snapshot.created_at)}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {t('metaReview.provenPermissions', {
                  ready: snapshot.permissions_ready_count ?? 0,
                  total: snapshot.permissions_total_count ?? 0
                })}
                                            </Typography>
                                        </Box>
                                        <StatusChip status={snapshot.status} />
                                    </Box>)}
                            </Stack>
                        </Paper>}

                    <PermissionMatrix permissions={readiness.permission_matrix} />
                    <WebhookEvidence evidence={readiness.webhook_evidence} />

                    <Grid container spacing={3}>
                        {sections.map(section => <Grid size={{
          xs: 12,
          lg: 6
        }} key={section.title}>
                                <ReviewSectionCard title={section.title} icon={section.icon} section={section.section} metrics={section.metrics} missingItems={section.missingItems} actionLabel={section.actionLabel} actionPath={section.actionPath}>

                                    {section.adminPaths?.length > 0 && <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                            {section.adminPaths.map(path => <Chip key={path} label={`Admin: ${path}`} size="small" variant="outlined" />)}
                                        </Stack>}
                                    {section.section?.key === 'identity' && <Box sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              p: 1.25
            }}>
                                            <Typography variant="body2" fontWeight={700}>
                                                {section.section.facebook_user?.name || t('metaReview.facebookIdentityMissing')}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary" component="div">
                                                {section.section.facebook_user?.email || t('metaReview.emailMissingFromMeta')}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary" component="div">
                                                ID: {section.section.facebook_user?.id || '-'}
                                            </Typography>
                                        </Box>}
                                    {section.section?.key === 'feature_evidence' && <Stack spacing={1}>
                                            {(section.section.features || []).map(feature => <Box key={feature.key} sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 1,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                p: 1
              }}>

                                                    <Box>
                                                        <Typography variant="body2" fontWeight={700}>{feature.label}</Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            {t('metaReview.lastSuccess', {
                      date: formatDate(feature.last_success_at)
                    })}
                                                        </Typography>
                                                        {feature.operational_blocked && <Typography variant="caption" color="warning.main" component="div">
                                                                {t('metaReview.operationalBlock')}
                                                            </Typography>}
                                                    </Box>
                                                    <StatusChip status={feature.status} />
                                                </Box>)}
                                        </Stack>}
                                </ReviewSectionCard>
                            </Grid>)}
                    </Grid>

                    {readiness.pages?.pages?.length > 0 && <Paper sx={{
        p: 3,
        mt: 3
      }}>
                            <Typography component="h2" variant="h6" fontWeight={700} gutterBottom>
                                {t('metaReview.facebookPageDetails')}
                            </Typography>
                            <Stack spacing={2} divider={<Divider flexItem />}>
                                {readiness.pages.pages.map(page => <Box key={page.id} sx={{
            display: 'flex',
            flexDirection: {
              xs: 'column',
              md: 'row'
            },
            alignItems: {
              xs: 'flex-start',
              md: 'center'
            },
            justifyContent: 'space-between',
            gap: 2
          }}>

                                        <Box>
                                            <Typography component="h3" variant="subtitle1" fontWeight={700}>
                                                {page.page_name || page.page_id}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                Page ID: {page.page_id} | {t('metaReview.lastUpdate', {
                  date: formatDate(page.updated_at)
                })}
                                            </Typography>
                                        </Box>
                                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                            <StatusChip status={page.webhook_ready ? 'ready' : 'action_required'} />
                                            <Chip label={page.page_access_token_present ? t('metaReview.pageTokenPresent') : t('metaReview.pageTokenMissing')} color={page.page_access_token_present ? 'success' : 'warning'} size="small" variant="outlined" />

                                            {page.missing_webhook_fields?.map(field => <Chip key={field} label={t('metaReview.missingWebhook', {
                field
              })} color="warning" size="small" variant="outlined" />)}
                                        </Stack>
                                    </Box>)}
                            </Stack>
                        </Paper>}
                </>}
        </Box>;
};
export default TenantMetaReview;
