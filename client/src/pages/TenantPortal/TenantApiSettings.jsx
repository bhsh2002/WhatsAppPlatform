import React, { useState, useEffect } from 'react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Button,
    TextField,
    Switch,
    FormControlLabel,
    Alert,
    CircularProgress,
    Divider,
    IconButton,
    InputAdornment,
    Paper,
    Tooltip,
    Accordion,
    AccordionSummary,
    AccordionDetails
} from '@mui/material';
import {
    ContentCopy as CopyIcon,
    Visibility as VisibilityIcon,
    VisibilityOff as VisibilityOffIcon,
    Refresh as RefreshIcon,
    Save as SaveIcon,
    ExpandMore as ExpandMoreIcon,
    Code as CodeIcon
} from '@mui/icons-material';
import api from '../../api';

const TenantApiSettings = () => {
    const [settings, setSettings] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [regenerating, setRegenerating] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [showApiKey, setShowApiKey] = useState(false);
    const [showWebhookSecret, setShowWebhookSecret] = useState(false);

    const [formData, setFormData] = useState({
        webhook_url: '',
        callback_url: '',
        is_active: true,
    });

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await api.getPortalApiSettings();
            setSettings(data);
            setFormData({
                webhook_url: data.webhook_url || '',
                callback_url: data.callback_url || '',
                is_active: data.is_active ?? true,
            });
        } catch (err) {
            console.error('Failed to fetch settings:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            setError(null);
            setSuccess(null);
            await api.updatePortalApiSettings(formData);
            setSuccess('تم حفظ الإعدادات بنجاح');
            fetchSettings();
        } catch (err) {
            console.error('Failed to save settings:', err);
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleRegenerateKey = async () => {
        if (!window.confirm('هل أنت متأكد؟ سيتم إلغاء المفتاح الحالي ولن يعمل بعد الآن.')) {
            return;
        }

        try {
            setRegenerating(true);
            setError(null);
            await api.regeneratePortalApiKey();
            setSuccess('تم إنشاء مفتاح جديد بنجاح');
            fetchSettings();
        } catch (err) {
            console.error('Failed to regenerate key:', err);
            setError(err.message);
        } finally {
            setRegenerating(false);
        }
    };

    const copyToClipboard = (text, label) => {
        navigator.clipboard.writeText(text);
        setSuccess(`تم نسخ ${label}`);
        setTimeout(() => setSuccess(null), 2000);
    };

    if (loading) {
        return (
            <Box sx={{ p: 3, textAlign: 'center' }}>
                <CircularProgress />
            </Box>
        );
    }

    const apiBaseUrl = window.location.origin;

    return (
        <Box sx={{ p: 3 }}>
            {/* Header */}
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" fontWeight={700} gutterBottom>
                    إعدادات API
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    إعدادات التكامل الخارجي وربط الأنظمة
                </Typography>
            </Box>

            {error && (
                <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {success && (
                <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)}>
                    {success}
                </Alert>
            )}

            {/* API Credentials */}
            <Card elevation={2} sx={{ mb: 3 }}>
                <CardContent>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                        بيانات الاعتماد
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                        استخدم هذه البيانات للتكامل مع نظامك الخارجي
                    </Typography>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <TextField
                            label="API Key"
                            value={showApiKey ? (settings?.api_key || '') : '••••••••••••••••••••••••••••••••'}
                            fullWidth
                            InputProps={{
                                readOnly: true,
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <Tooltip title={showApiKey ? 'إخفاء' : 'إظهار'}>
                                            <IconButton onClick={() => setShowApiKey(!showApiKey)}>
                                                {showApiKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="نسخ">
                                            <IconButton onClick={() => copyToClipboard(settings?.api_key, 'API Key')}>
                                                <CopyIcon />
                                            </IconButton>
                                        </Tooltip>
                                    </InputAdornment>
                                ),
                            }}
                        />

                        <TextField
                            label="Webhook Secret"
                            value={showWebhookSecret ? (settings?.webhook_secret || '') : '••••••••••••••••'}
                            fullWidth
                            InputProps={{
                                readOnly: true,
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <Tooltip title={showWebhookSecret ? 'إخفاء' : 'إظهار'}>
                                            <IconButton onClick={() => setShowWebhookSecret(!showWebhookSecret)}>
                                                {showWebhookSecret ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="نسخ">
                                            <IconButton onClick={() => copyToClipboard(settings?.webhook_secret, 'Webhook Secret')}>
                                                <CopyIcon />
                                            </IconButton>
                                        </Tooltip>
                                    </InputAdornment>
                                ),
                            }}
                            helperText="استخدم هذا السر للتحقق من طلبات Webhook"
                        />

                        <Button
                            variant="outlined"
                            color="warning"
                            startIcon={regenerating ? <CircularProgress size={20} /> : <RefreshIcon />}
                            onClick={handleRegenerateKey}
                            disabled={regenerating}
                            sx={{ alignSelf: 'flex-start' }}
                        >
                            إنشاء مفتاح جديد
                        </Button>
                    </Box>
                </CardContent>
            </Card>

            {/* Webhook Settings */}
            <Card elevation={2} sx={{ mb: 3 }}>
                <CardContent>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                        إعدادات Webhook
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                        سيتم إرسال الرسائل الواردة إلى هذا الرابط
                    </Typography>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <TextField
                            label="Webhook URL"
                            value={formData.webhook_url}
                            onChange={(e) => setFormData({ ...formData, webhook_url: e.target.value })}
                            fullWidth
                            placeholder="https://example.com/webhook"
                            helperText="سيتم إرسال POST request لهذا الرابط عند استقبال رسالة"
                        />

                        <TextField
                            label="Callback URL (اختياري)"
                            value={formData.callback_url}
                            onChange={(e) => setFormData({ ...formData, callback_url: e.target.value })}
                            fullWidth
                            placeholder="https://example.com/callback"
                            helperText="رابط لتلقي تحديثات حالة الرسائل"
                        />

                        <FormControlLabel
                            control={
                                <Switch
                                    checked={formData.is_active}
                                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                                />
                            }
                            label="تفعيل إرسال Webhooks"
                        />

                        <Button
                            variant="contained"
                            startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
                            onClick={handleSave}
                            disabled={saving}
                            sx={{ alignSelf: 'flex-start' }}
                        >
                            حفظ الإعدادات
                        </Button>
                    </Box>
                </CardContent>
            </Card>

            {/* API Documentation */}
            <Card elevation={2}>
                <CardContent>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                        <CodeIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                        توثيق API
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                        كيفية استخدام API لإرسال واستقبال الرسائل
                    </Typography>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>إرسال رسالة نصية</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
                                    {`POST ${apiBaseUrl}/api/v1/messages/send
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "recipient": "218912345678",
  "type": "text",
  "message": "مرحباً، هذه رسالة تجريبية"
}`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>إرسال قالب</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
                                    {`POST ${apiBaseUrl}/api/v1/messages/send
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "recipient": "218912345678",
  "type": "template",
  "template_name": "welcome_message",
  "template_params": ["اسم العميل", "قيمة أخرى"]
}`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>استقبال Webhook</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                عند استقبال رسالة، سيتم إرسال POST request إلى Webhook URL الخاص بك:
                            </Typography>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
                                    {`{
  "event": "message_received",
  "timestamp": "2024-01-05T10:30:00Z",
  "data": {
    "from": "218912345678",
    "message_id": "wamid.xxx",
    "type": "text",
    "content": "محتوى الرسالة",
    "profile_name": "اسم المرسل"
  },
  "signature": "HMAC-SHA256 signature using webhook_secret"
}`}
                                </pre>
                            </Paper>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
                                تحقق من التوقيع باستخدام Webhook Secret للتأكد من صحة الطلب
                            </Typography>
                        </AccordionDetails>
                    </Accordion>
                </CardContent>
            </Card>
        </Box>
    );
};

export default TenantApiSettings;
