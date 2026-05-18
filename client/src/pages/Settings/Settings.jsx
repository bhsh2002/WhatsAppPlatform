import React, { useEffect, useState } from 'react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Grid,
    IconButton,
    InputAdornment,
    Chip,
    Alert,
    Button,
    TextField,
    CircularProgress,
    Divider,
} from '@mui/material';
import {
    CheckCircle as CheckCircleIcon,
    Error as ErrorIcon,
    ContentCopy as CopyIcon,
    Refresh as RefreshIcon,
    Settings as SettingsIcon,
    Dns as DnsIcon,
    Security as SecurityIcon,
    Webhook as WebhookIcon,
} from '@mui/icons-material';
import api from '../../api';

const StatusChip = ({ ok, label }) => (
    <Chip
        icon={ok ? <CheckCircleIcon /> : <ErrorIcon />}
        label={label}
        color={ok ? 'success' : 'error'}
        variant="outlined"
        size="small"
    />
);

const Settings = () => {
    const [serverStatus, setServerStatus] = useState('checking');
    const [systemStatus, setSystemStatus] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState('');

    const loadStatus = async () => {
        setLoading(true);
        setError('');
        setServerStatus('checking');
        try {
            await api.checkHealth();
            setServerStatus('online');
            const data = await api.getSystemStatus();
            setSystemStatus(data);
        } catch (err) {
            setServerStatus('offline');
            setError(err.message || 'فشل جلب حالة النظام');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadStatus();
    }, []);

    const copyValue = async (key, value) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(key);
            setTimeout(() => setCopied(''), 2000);
        } catch (err) {
            setError(err.message || 'فشل النسخ');
        }
    };

    const webhookUrl = systemStatus?.meta?.webhook_callback_url || '';
    const security = systemStatus?.security || {};
    const meta = systemStatus?.meta || {};

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' }, gap: 1.5, mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <SettingsIcon color="primary" sx={{ fontSize: 32 }} />
                    <Box>
                        <Typography variant="h4" fontWeight={700}>حالة النظام وإعدادات Meta</Typography>
                        <Typography variant="body2" color="text.secondary">
                            عرض غير سري لحالة الربط. بيانات العملاء الحساسة تدار من صفحات العملاء والربط الرسمية.
                        </Typography>
                    </Box>
                </Box>
                <Button
                    variant="outlined"
                    startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
                    onClick={loadStatus}
                    disabled={loading}
                >
                    تحديث
                </Button>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

            <Grid container spacing={3}>
                <Grid size={{ xs: 12 }}>
                    <Card>
                        <CardContent>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                    <DnsIcon color="primary" />
                                    <Box>
                                        <Typography variant="h6">حالة الخادم</Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            {serverStatus === 'online' ? 'الخادم متصل ويستجيب' : serverStatus === 'checking' ? 'جاري الفحص' : 'الخادم لا يستجيب'}
                                        </Typography>
                                    </Box>
                                </Box>
                                <StatusChip ok={serverStatus === 'online'} label={serverStatus === 'online' ? 'متصل' : serverStatus === 'checking' ? 'فحص' : 'غير متصل'} />
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                    <Card sx={{ height: '100%' }}>
                        <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                                <WebhookIcon color="primary" />
                                <Typography variant="h6">Meta Webhook</Typography>
                            </Box>
                            <TextField
                                fullWidth
                                label="Callback URL"
                                value={webhookUrl || 'غير متاح'}
                                InputProps={{
                                    readOnly: true,
                                    endAdornment: webhookUrl ? (
                                        <InputAdornment position="end">
                                            <IconButton onClick={() => copyValue('webhook', webhookUrl)} edge="end">
                                                {copied === 'webhook' ? <CheckCircleIcon color="success" fontSize="small" /> : <CopyIcon fontSize="small" />}
                                            </IconButton>
                                        </InputAdornment>
                                    ) : null,
                                }}
                                helperText={`المصدر: ${systemStatus?.meta?.webhook_callback_url_source || 'غير معروف'}`}
                                sx={{ mb: 2 }}
                            />
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                <StatusChip ok={!!meta.app_id_present} label="META_APP_ID" />
                                <StatusChip ok={!!meta.app_secret_present} label="META_APP_SECRET" />
                                <StatusChip ok={!!security.webhook_verify_token_present} label="WEBHOOK_VERIFY_TOKEN" />
                            </Box>
                            <Alert severity="info" sx={{ mt: 2 }}>
                                لا يتم عرض verify token أو access tokens هنا. استخدم صفحات الربط والتشخيص لإعادة التفويض أو الاشتراك.
                            </Alert>
                        </CardContent>
                    </Card>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                    <Card sx={{ height: '100%' }}>
                        <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                                <SecurityIcon color="primary" />
                                <Typography variant="h6">أمان التشغيل</Typography>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                                <StatusChip ok={!!security.jwt_secret_present && !!security.jwt_secret_min_length_ok} label="JWT_SECRET" />
                                <StatusChip ok={!!security.crypto_key_present && !!security.crypto_key_length_ok} label="CRYPTO_KEY" />
                                <StatusChip ok={!!systemStatus?.cors_origins_configured} label="CORS_ORIGINS" />
                            </Box>
                            <Divider sx={{ my: 2 }} />
                            <Grid container spacing={1.5}>
                                <Grid size={{ xs: 12, sm: 6 }}>
                                    <Typography variant="caption" color="text.secondary">بيئة التشغيل</Typography>
                                    <Typography variant="body2" fontWeight={600}>{systemStatus?.node_env || '-'}</Typography>
                                </Grid>
                                <Grid size={{ xs: 12, sm: 6 }}>
                                    <Typography variant="caption" color="text.secondary">آخر فحص</Typography>
                                    <Typography variant="body2" fontWeight={600}>
                                        {systemStatus?.checked_at ? new Date(systemStatus.checked_at).toLocaleString('ar-LY') : '-'}
                                    </Typography>
                                </Grid>
                            </Grid>
                        </CardContent>
                    </Card>
                </Grid>

                <Grid size={{ xs: 12 }}>
                    <Alert severity="warning">
                        صفحة الإعدادات لم تعد تحفظ Phone Number ID أو Access Token في المتصفح. استخدم إدارة العملاء، أرقام الهواتف، وربط Facebook/WhatsApp لتعديل بيانات الربط الحقيقية.
                    </Alert>
                </Grid>
            </Grid>
        </Box>
    );
};

export default Settings;
