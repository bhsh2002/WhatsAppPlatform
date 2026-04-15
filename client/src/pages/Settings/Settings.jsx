import React, { useState, useEffect } from 'react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    TextField,
    Button,
    Grid,
    IconButton,
    InputAdornment,
    Chip,
    Alert,
    Paper,
    Divider,
    CircularProgress
} from '@mui/material';
import {
    Key as KeyIcon,
    Webhook as WebhookIcon,
    CheckCircle as CheckCircleIcon,
    Error as ErrorIcon,
    ContentCopy as CopyIcon,
    Refresh as RefreshIcon,
    Settings as SettingsIcon,
    Dns as DnsIcon
} from '@mui/icons-material';
import api from '../../api';

const Settings = () => {
    const [config, setConfig] = useState({
        phoneNumberId: localStorage.getItem('ab_wa_phoneId') || '',
        accessToken: localStorage.getItem('ab_wa_token') || '',
        webhookVerifyToken: 'whatsapp_platform_verify_token_2024',
    });
    const [serverStatus, setServerStatus] = useState(null); // null, 'checking', 'online', 'offline'
    const [copied, setCopied] = useState(false);
    const [saved, setSaved] = useState(false);

    // Get webhook URL based on current server
    const getWebhookUrl = () => {
        // In production, this would be your domain
        return `${api.baseUrl}/webhook`;
    };

    const checkServerStatus = async () => {
        setServerStatus('checking');
        try {
            await api.checkHealth();
            setServerStatus('online');
        } catch (_error) {
            setServerStatus('offline');
        }
    };

    useEffect(() => {
        checkServerStatus();
    }, []);

    const handleSave = () => {
        localStorage.setItem('ab_wa_phoneId', config.phoneNumberId);
        localStorage.setItem('ab_wa_token', config.accessToken);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const copyWebhookUrl = async () => {
        try {
            await navigator.clipboard.writeText(getWebhookUrl());
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            console.error('Failed to copy:', error);
        }
    };

    const renderStatusIndicator = () => {
        if (serverStatus === 'checking') {
            return <Chip icon={<CircularProgress size={16} />} label="جاري الفحص..." variant="outlined" />;
        }
        if (serverStatus === 'online') {
            return <Chip icon={<CheckCircleIcon />} label="متصل" color="success" variant="outlined" />;
        }
        return <Chip icon={<ErrorIcon />} label="غير متصل" color="error" variant="outlined" />;
    };

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1000, mx: 'auto' }}>
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" fontWeight={700} gutterBottom>
                    الإعدادات
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    إعدادات الربط مع واتساب و Meta Cloud API.
                </Typography>
            </Box>

            <Grid container spacing={3}>
                {/* Server Status Card */}
                <Grid size={{ xs: 12 }}>
                    <Card elevation={2}>
                        <CardContent>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                    <Box sx={{
                                        p: 1,
                                        borderRadius: '50%',
                                        bgcolor: 'primary.light',
                                        color: 'primary.main'
                                    }}>
                                        <DnsIcon />
                                    </Box>
                                    <Box>
                                        <Typography variant="h6">حالة الخادم</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {serverStatus === 'online' ? 'الخادم متصل ويعمل بشكل صحيح' : 'تأكد من تشغيل الخادم'}
                                        </Typography>
                                    </Box>
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    {renderStatusIndicator()}
                                    <IconButton onClick={checkServerStatus} disabled={serverStatus === 'checking'}>
                                        <RefreshIcon />
                                    </IconButton>
                                </Box>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>

                {/* Webhook Configuration */}
                <Grid size={{ xs: 12, md: 6 }}>
                    <Card elevation={2} sx={{ height: '100%' }}>
                        <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                                <WebhookIcon color="primary" />
                                <Typography variant="h6">إعدادات Webhook</Typography>
                            </Box>

                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <TextField
                                    fullWidth
                                    label="Webhook URL"
                                    value={getWebhookUrl()}
                                    InputProps={{
                                        readOnly: true,
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton onClick={copyWebhookUrl} edge="end">
                                                    {copied ? <CheckCircleIcon color="success" fontSize="small" /> : <CopyIcon fontSize="small" />}
                                                </IconButton>
                                            </InputAdornment>
                                        ),
                                    }}
                                    helperText="انسخه إلى Meta Dashboard"
                                />

                                <TextField
                                    fullWidth
                                    label="Verify Token"
                                    value={config.webhookVerifyToken}
                                    InputProps={{
                                        readOnly: true,
                                    }}
                                    helperText="للتحقق من الـ Webhook"
                                />

                                <Alert severity="info" sx={{ mt: 1 }}>
                                    <Typography variant="subtitle2" gutterBottom>كيفية الإعداد:</Typography>
                                    <ol style={{ margin: 0, paddingRight: '1.2rem' }}>
                                        <li>افتح Meta Developer Dashboard</li>
                                        <li>اذهب إلى WhatsApp → Configuration</li>
                                        <li>في قسم Webhook، اضغط Edit</li>
                                        <li>الصق Webhook URL و Verify Token</li>
                                        <li>اختر الـ Subscriptions: messages, message_echoes</li>
                                    </ol>
                                </Alert>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>

                {/* API Credentials */}
                <Grid size={{ xs: 12, md: 6 }}>
                    <Card elevation={2} sx={{ height: '100%' }}>
                        <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                                <KeyIcon color="primary" />
                                <Typography variant="h6">بيانات الربط (Meta Cloud API)</Typography>
                            </Box>

                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <TextField
                                    fullWidth
                                    label="Phone Number ID"
                                    value={config.phoneNumberId}
                                    onChange={(e) => setConfig({ ...config, phoneNumberId: e.target.value })}
                                    placeholder="مثال: 105956789012345"
                                />

                                <TextField
                                    fullWidth
                                    type="password"
                                    label="Access Token"
                                    value={config.accessToken}
                                    onChange={(e) => setConfig({ ...config, accessToken: e.target.value })}
                                    placeholder="EAA..."
                                    multiline
                                    rows={3}
                                />

                                <Button
                                    variant="contained"
                                    size="large"
                                    onClick={handleSave}
                                    startIcon={saved ? <CheckCircleIcon /> : <SettingsIcon />}
                                    color={saved ? "success" : "primary"}
                                    fullWidth
                                >
                                    {saved ? 'تم الحفظ بنجاح' : 'حفظ البيانات'}
                                </Button>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>
        </Box>
    );
};

export default Settings;
