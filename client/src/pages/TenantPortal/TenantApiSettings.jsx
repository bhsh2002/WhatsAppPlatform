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
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
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
                        استخدم API Key في ترويسة <code>X-API-Key</code> للمصادقة
                    </Typography>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>إرسال رسالة نصية</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                <strong>POST</strong> {apiBaseUrl}/api/v1/messages/send
                            </Typography>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
{`Headers:
  X-API-Key: YOUR_API_KEY
  Content-Type: application/json

Body:
{
  "recipient": "218912345678",
  "type": "text",
  "message": "مرحباً، هذه رسالة تجريبية"
}

Response:
{
  "success": true,
  "message_id": "wamid.xxx",
  "recipient": "218912345678"
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
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                <strong>POST</strong> {apiBaseUrl}/api/v1/messages/send
                            </Typography>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
{`Headers:
  X-API-Key: YOUR_API_KEY
  Content-Type: application/json

Body:
{
  "recipient": "218912345678",
  "type": "template",
  "template_name": "otp",
  "template_language": "ar",
  "template_params": ["123456"]
}

Response:
{
  "success": true,
  "message_id": "wamid.xxx",
  "recipient": "218912345678"
}

ملاحظة:
- template_name: اسم القالب المعتمد في WhatsApp
- template_language: رمز اللغة (ar, en, ...)
- template_params: مصفوفة القيم التي تحل محل {{1}}, {{2}}, ...
- يمكن أيضاً استخدام الصيغة المختصرة: {"template": "otp", "params": ["123456"]}
- القالب يجب أن يكون بحالة "approved" ليعمل`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>إرسال وسيط (صورة/فيديو/مستند)</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                <strong>POST</strong> {apiBaseUrl}/api/v1/messages/send-media
                            </Typography>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
{`Headers:
  X-API-Key: YOUR_API_KEY
  Content-Type: application/json

Body:
{
  "recipient": "218912345678",
  "type": "image",
  "media_url": "https://example.com/image.jpg",
  "caption": "وصف الصورة (اختياري)"
}

الحقول المطلوبة:
- recipient: رقم المستلم
- type: نوع الوسيط (image, video, audio, document)
- media_url: رابط مباشر للملف

حقل اختياري:
- caption: وصف الوسيط (يعمل مع image, video, document)

Response:
{
  "success": true,
  "message_id": "wamid.xxx",
  "recipient": "218912345678"
}`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>إرسال رسالة تفاعلية (أزرار/قائمة)</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                <strong>POST</strong> {apiBaseUrl}/api/v1/messages/send-interactive
                            </Typography>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
{`Headers:
  X-API-Key: YOUR_API_KEY
  Content-Type: application/json

// مثال 1: رسالة بأزرار (button)
Body:
{
  "recipient": "218912345678",
  "interactive_type": "button",
  "body_text": "اختر أحد الخيارات:",
  "header_text": "القائمة الرئيسية",
  "footer_text": "منصة Savana",
  "buttons": [
    { "id": "btn_1", "title": "الدعم الفني" },
    { "id": "btn_2", "title": "المبيعات" },
    { "id": "btn_3", "title": "الاستفسارات" }
  ]
}

// مثال 2: رسالة بقائمة (list)
Body:
{
  "recipient": "218912345678",
  "interactive_type": "list",
  "body_text": "اختر من القائمة:",
  "list_button_text": "عرض الخيارات",
  "sections": [
    {
      "title": "الخدمات",
      "rows": [
        { "id": "svc_1", "title": "خدمة 1", "description": "وصف مختصر" },
        { "id": "svc_2", "title": "خدمة 2", "description": "وصف مختصر" }
      ]
    }
  ]
}

Response:
{
  "success": true,
  "message_id": "wamid.xxx",
  "recipient": "218912345678"
}

ملاحظة:
- interactive_type: "button" أو "list"
- أزرار: 1-3 أزرار كحد أقصى، العنوان حتى 20 حرف
- القائمة: حتى 10 عناصر في جميع الأقسام`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>رفع وإرسال مستند</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                <strong>POST</strong> {apiBaseUrl}/api/v1/messages/send-document
                            </Typography>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
{`Headers:
  X-API-Key: YOUR_API_KEY
  Content-Type: multipart/form-data

Body (form-data):
  file: [PDF/DOC/XLS file]
  recipient: 218912345678
  caption: وصف الملف (اختياري)
  filename: اسم_الملف.pdf (اختياري)`}
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
                                عند استقبال رسالة، سيتم إرسال POST request إلى Webhook URL الذي أدخلته:
                            </Typography>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
{`Headers:
  Content-Type: application/json
  X-Signature: sha256=abc123...
  X-Tenant-Id: 6

Body:
{
  "event": "message_received",
  "timestamp": "2024-01-05T10:30:00Z",
  "tenant_id": 6,
  "data": {
    "from": "218912345678",
    "message_id": "wamid.xxx",
    "type": "text",
    "content": "محتوى الرسالة",
    "profile_name": "اسم المرسل"
  }
}

// للتحقق من التوقيع:
const expectedSignature = 'sha256=' + 
  hmacSha256(webhookSecret, JSON.stringify(payload));`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>تحديثات حالة الرسائل (Callback)</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                عند تغير حالة الرسالة (تم الإرسال، تم التسليم، تمت القراءة، فشل)، سيتم إرسال تحديث إلى Callback URL:
                            </Typography>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
{`Headers:
  Content-Type: application/json
  X-Signature: sha256=abc123...
  X-Tenant-Id: 6

Body:
{
  "event": "message_status",
  "timestamp": "2024-01-05T10:35:00Z",
  "tenant_id": 6,
  "data": {
    "message_id": "wamid.xxx",
    "status": "delivered",  // sent, delivered, read, failed
    "recipient": "218912345678",
    "timestamp": "2024-01-05T10:35:00Z"
  }
}`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>الحصول على المحادثات</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                <strong>GET</strong> {apiBaseUrl}/api/v1/conversations
                            </Typography>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
{`Headers:
  X-API-Key: YOUR_API_KEY

Response:
[
  {
    "contact": "218912345678",
    "profile_name": "John Doe",
    "last_message": "مرحبا",
    "last_interaction": "2024-01-05T10:30:00Z",
    "unread_count": 2
  },
  ...
]`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>الحصول على رسائل محادثة</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                <strong>GET</strong> {apiBaseUrl}/api/v1/conversations/:phone/messages
                            </Typography>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
{`Headers:
  X-API-Key: YOUR_API_KEY

Query Parameters:
  limit: 100 (optional)
  offset: 0 (optional)

Response:
[
  {
    "id": 1,
    "direction": "incoming",
    "sender": "218912345678",
    "message_type": "text",
    "content": "مرحبا",
    "status": "read",
    "created_at": "2024-01-05T10:30:00Z"
  },
  ...
]`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>الحصول على القوالب</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                <strong>GET</strong> {apiBaseUrl}/api/v1/templates
                            </Typography>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
{`Headers:
  X-API-Key: YOUR_API_KEY

Query Parameters:
  status: approved (optional, default: approved)

Response:
[
  {
    "id": 1,
    "name": "welcome_message",
    "language": "ar",
    "category": "UTILITY",
    "status": "approved",
    "body": "مرحباً {{1}}،..."
  },
  ...
]`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>الحصول على قالب محدد</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                <strong>GET</strong> {apiBaseUrl}/api/v1/templates/:id
                            </Typography>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
{`Headers:
  X-API-Key: YOUR_API_KEY

مثال:
GET ${apiBaseUrl}/api/v1/templates/5

Response:
{
  "id": 5,
  "name": "otp",
  "language": "ar",
  "category": "AUTHENTICATION",
  "status": "approved",
  "header_type": "text",
  "header_content": "رمز التحقق",
  "body": "رمز التحقق الخاص بك هو {{1}}",
  "footer": "لا تشارك هذا الرمز",
  "buttons": null,
  "variables": null
}

خطأ (القالب غير موجود):
{
  "error": "Template not found"
}`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>إرسال أحداث التحويل (Conversions API)</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                <strong>POST</strong> {apiBaseUrl}/api/v1/events
                            </Typography>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
{`Headers:
  X-API-Key: YOUR_API_KEY
  Content-Type: application/json

Body:
{
  "events": [
    {
      "event_name": "purchase",
      "event_time": 1704417000,
      "action_source": "business_messaging",
      "phone": "218912345678",
      "email": "user@example.com",
      "custom_data": {
        "currency": "LYD",
        "value": "150.00"
      }
    }
  ]
}

Response:
{
  "success": true,
  "events_received": 1,
  "fbtrace_id": "AbCdEf..."
}

ملاحظة:
- events: مصفوفة من الأحداث (حتى 1000 حدث)
- event_time: توقيت Unix (ثوانٍ)
- phone و email: يتم تجزئتها تلقائياً (SHA-256) قبل الإرسال
- يجب إعداد Dataset ID من الإدارة ليعمل`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>سجل أحداث التحويل</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                <strong>GET</strong> {apiBaseUrl}/api/v1/events/history
                            </Typography>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
{`Headers:
  X-API-Key: YOUR_API_KEY

Query Parameters:
  limit: 50 (optional, default: 50)
  offset: 0 (optional, default: 0)

Response:
{
  "events": [
    {
      "id": 1,
      "event_name": "purchase",
      "status": "sent",
      "phone": "218912345678",
      "created_at": "2024-01-05T10:30:00Z",
      "custom_data": "{\\"currency\\":\\"LYD\\",\\"value\\":\\"150\\"}"
    }
  ],
  "total": 120,
  "limit": 50,
  "offset": 0
}`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>فحص حالة API</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                <strong>GET</strong> {apiBaseUrl}/api/v1/health
                            </Typography>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
{`لا يتطلب مصادقة (لا يحتاج X-API-Key)

Response:
{
  "status": "ok",
  "timestamp": "2024-01-05T10:30:00Z",
  "version": "v1"
}

استخدم هذا endpoint للتحقق من أن API يعمل
وأن رابط الخادم صحيح قبل تنفيذ طلبات أخرى.`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>أحداث Webhook من فيسبوك</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                عند ربط صفحة فيسبوك بحسابك، سيتم إرسال أحداث فيسبوك إلى Webhook URL أيضاً:
                            </Typography>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
{`// 1. رسالة ماسنجر جديدة
{
  "event": "fb_message_received",
  "timestamp": "2024-01-05T10:30:00Z",
  "tenant_id": 6,
  "data": {
    "page_id": "123456789",
    "sender": "987654321",
    "message": "مرحبا",
    "attachments": [],
    "timestamp": 1704417000000
  }
}

// 2. تعليق جديد على منشور
{
  "event": "fb_comment_add",
  "timestamp": "2024-01-05T10:30:00Z",
  "tenant_id": 6,
  "data": {
    "item": "comment",
    "verb": "add",
    "post_id": "123_456",
    "comment_id": "789",
    "from": { "id": "100", "name": "أحمد" },
    "message": "تعليق رائع!"
  }
}

// 3. تفاعل/إعجاب على منشور
{
  "event": "fb_reaction_add",
  "timestamp": "2024-01-05T10:30:00Z",
  "tenant_id": 6,
  "data": {
    "item": "reaction",
    "verb": "add",
    "post_id": "123_456",
    "from": { "id": "100", "name": "أحمد" },
    "reaction_type": "like"
  }
}

ملاحظة:
- جميع أحداث فيسبوك تحمل نفس ترويسات التوقيع
  (X-Signature و X-Tenant-Id)
- أنواع الأحداث: fb_message_received,
  fb_comment_add, fb_reaction_add,
  fb_like_add`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>رموز الأخطاء وملاحظات مهمة</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
{`// رموز HTTP الشائعة:
// 200 - نجاح
// 400 - طلب غير صالح (بيانات مفقودة)
// 401 - مفتاح API غير صالح أو مفقود
// 402 - رصيد الرسائل غير كافٍ
// 403 - الحساب معلّق
// 404 - المورد غير موجود (قالب/محادثة)
// 429 - تجاوز حد الطلبات المسموحة
// 500 - خطأ داخلي في الخادم

// مثال على خطأ:
{
  "error": "recipient is required"
}

// ملاحظات مهمة:
//
// 1. نافذة المحادثة (24 ساعة):
//    الرسائل النصية العادية يمكن إرسالها فقط خلال
//    24 ساعة من آخر رسالة من العميل.
//    خارج النافذة، استخدم قوالب معتمدة فقط.
//
// 2. نظام الأرصدة:
//    كل رسالة صادرة ناجحة تخصم رصيد واحد.
//    تحقق من رصيدك قبل إرسال رسائل كثيرة.
//
// 3. تنسيق أرقام الهاتف:
//    استخدم التنسيق الدولي بدون + (مثال: 218912345678)
//
// 4. إعادة محاولة Webhook:
//    عند فشل التسليم، يعاد المحاولة حتى 3 مرات
//    مع تأخير متزايد (1ث، 2ث، 4ث).
//    أخطاء العميل (4xx) لا يعاد المحاولة.`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>
                </CardContent>
            </Card>
        </Box>
    );
};

export default TenantApiSettings;
