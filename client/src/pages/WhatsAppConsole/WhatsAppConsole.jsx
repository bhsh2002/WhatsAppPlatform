import React, { useState, useEffect } from 'react';
import {
    Box,
    Grid,
    Card,
    CardContent,
    Typography,
    TextField,
    Button,
    FormControl,
    FormControlLabel,
    Radio,
    RadioGroup,
    Checkbox,
    Select,
    MenuItem,
    InputLabel,
    IconButton,
    InputAdornment,
    Paper,
    Divider,
    Chip,
    Alert
} from '@mui/material';
import {
    Send as SendIcon,
    Key as KeyIcon,
    Smartphone as SmartphoneIcon,
    Notes as NotesIcon,
    Add as AddIcon,
    Delete as DeleteIcon,
    CheckCircle as CheckCircleIcon,
    Error as ErrorIcon,
    Terminal as TerminalIcon
} from '@mui/icons-material';
import api from '../../api';
import { useTenants } from '../../context/TenantContext';

const WhatsAppConsole = () => {
    const { tenants } = useTenants();
    const [config, setConfig] = useState({
        token: localStorage.getItem('ab_wa_token') || '',
        phoneId: localStorage.getItem('ab_wa_phoneId') || '',
    });

    const [messageForm, setMessageForm] = useState({
        recipient: '',
        type: 'text',
        message: 'مرحباً! هذه رسالة تجريبية من لوحة التحكم ⚡',
        templateName: 'delivery_confirmation',
        templateLanguage: 'ar',
        templateParams: [],
        sendViaBackend: true,
        tenantId: '',
    });

    const [status, setStatus] = useState(null);
    const [logs, setLogs] = useState([]);
    const [serverOnline, setServerOnline] = useState(null);

    useEffect(() => {
        localStorage.setItem('ab_wa_token', config.token);
        localStorage.setItem('ab_wa_phoneId', config.phoneId);
    }, [config]);

    // Check server status
    useEffect(() => {
        const checkServer = async () => {
            try {
                await api.checkHealth();
                setServerOnline(true);
            } catch {
                setServerOnline(false);
            }
        };
        checkServer();
    }, []);

    const addParam = () => {
        setMessageForm(prev => {
            const components = [...(prev.templateParams || [])];
            let bodyComponentIndex = components.findIndex(c => c.type === 'body');

            if (bodyComponentIndex === -1) {
                components.push({ type: 'body', parameters: [{ type: 'text', text: '' }] });
            } else {
                components[bodyComponentIndex].parameters.push({ type: 'text', text: '' });
            }

            return { ...prev, templateParams: components };
        });
    };

    const updateParam = (paramIndex, value) => {
        setMessageForm(prev => {
            const components = [...prev.templateParams];
            const bodyIndex = components.findIndex(c => c.type === 'body');
            if (bodyIndex !== -1) {
                components[bodyIndex].parameters[paramIndex].text = value;
            }
            return { ...prev, templateParams: components };
        });
    };

    const removeParam = (paramIndex) => {
        setMessageForm(prev => {
            const components = [...prev.templateParams];
            const bodyIndex = components.findIndex(c => c.type === 'body');
            if (bodyIndex !== -1) {
                components[bodyIndex].parameters = components[bodyIndex].parameters.filter((_, i) => i !== paramIndex);
                if (components[bodyIndex].parameters.length === 0) {
                    components.splice(bodyIndex, 1);
                }
            }
            return { ...prev, templateParams: components };
        });
    };

    const handleSend = async (e) => {
        e.preventDefault();
        setStatus('loading');

        const timestamp = new Date().toLocaleTimeString();

        try {
            if (messageForm.sendViaBackend && serverOnline) {
                // Send via backend
                const payload = {
                    recipient: messageForm.recipient,
                    type: messageForm.type,
                    message: messageForm.message,
                    templateName: messageForm.templateName,
                    templateLanguage: messageForm.templateLanguage,
                    templateParams: messageForm.templateParams,
                    tenant_id: messageForm.tenantId || null,
                    phone_number_id: messageForm.tenantId ? null : config.phoneId,
                    access_token: messageForm.tenantId ? null : config.token,
                };

                const result = await api.sendMessage(payload);
                setStatus('success');
                setLogs(prev => [`[${timestamp}] ✅ Success (Backend): ${result.message_id}`, ...prev]);
            } else {
                // Direct call to Meta API
                const url = `https://graph.facebook.com/v22.0/${config.phoneId}/messages`;

                let payload = {
                    messaging_product: 'whatsapp',
                    to: messageForm.recipient,
                };

                if (messageForm.type === 'text') {
                    payload.type = 'text';
                    payload.text = { body: messageForm.message };
                } else {
                    payload.type = 'template';
                    payload.template = {
                        name: messageForm.templateName,
                        language: { code: messageForm.templateLanguage },
                    };

                    if (messageForm.templateParams && messageForm.templateParams.length > 0) {
                        payload.template.components = messageForm.templateParams;
                    }
                }

                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${config.token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });

                const data = await res.json();

                if (res.ok) {
                    setStatus('success');
                    setLogs(prev => [`[${timestamp}] ✅ Success (Direct): ${data.messages?.[0]?.id}`, ...prev]);
                } else {
                    setStatus('error');
                    setLogs(prev => [`[${timestamp}] ❌ Error: ${data.error?.message}`, ...prev]);
                }
            }
        } catch (error) {
            setStatus('error');
            setLogs(prev => [`[${timestamp}] ❌ Error: ${error.message || error.toString()}`, ...prev]);
        }
    };

    const getBodyParams = () => {
        const bodyComp = messageForm.templateParams?.find(c => c.type === 'body');
        return bodyComp ? bodyComp.parameters : [];
    };

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, mb: 4, gap: { xs: 1, md: 0 } }}>
                <Box>
                    <Typography variant="h4" fontWeight={700} gutterBottom>
                        منصة واتساب المباشرة
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        أداة تشخيص وإرسال مباشر للتفاعل مع Meta Graph API.
                    </Typography>
                </Box>
                <Chip
                    icon={serverOnline ? <CheckCircleIcon /> : <ErrorIcon />}
                    label={serverOnline === null ? "فحص الخادم..." : serverOnline ? "الخادم متصل" : "الخادم غير متصل"}
                    color={serverOnline ? "success" : "error"}
                    variant="outlined"
                />
            </Box>

            <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 8 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {/* Configuration */}
                        <Card elevation={2}>
                            <CardContent>
                                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <KeyIcon color="primary" />
                                    بيانات الربط (Configuration)
                                </Typography>

                                <Grid container spacing={2} sx={{ mb: 2 }}>
                                    <Grid size={{ xs: 12, sm: 6 }}>
                                        <TextField
                                            fullWidth
                                            label="Phone Number ID"
                                            value={config.phoneId}
                                            onChange={e => setConfig({ ...config, phoneId: e.target.value })}
                                            placeholder="10595..."
                                            size="small"
                                        />
                                    </Grid>
                                    <Grid size={{ xs: 12, sm: 6 }}>
                                        <TextField
                                            fullWidth
                                            type="password"
                                            label="Access Token"
                                            value={config.token}
                                            onChange={e => setConfig({ ...config, token: e.target.value })}
                                            placeholder="EAA..."
                                            size="small"
                                        />
                                    </Grid>
                                </Grid>

                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={messageForm.sendViaBackend}
                                                onChange={(e) => setMessageForm({ ...messageForm, sendViaBackend: e.target.checked })}
                                            />
                                        }
                                        label="إرسال عبر الخادم (Backend)"
                                    />

                                    {messageForm.sendViaBackend && tenants.length > 0 && (
                                        <FormControl size="small" sx={{ minWidth: 200 }}>
                                            <Select
                                                value={messageForm.tenantId}
                                                onChange={(e) => setMessageForm({ ...messageForm, tenantId: e.target.value })}
                                                displayEmpty
                                            >
                                                <MenuItem value="">اختر عميل (اختياري)</MenuItem>
                                                {tenants.map(t => (
                                                    <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                    )}
                                </Box>
                            </CardContent>
                        </Card>

                        {/* Message Tester */}
                        <Card elevation={2}>
                            <CardContent>
                                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                                    <SmartphoneIcon color="primary" />
                                    اختبار الإرسال
                                </Typography>

                                <form onSubmit={handleSend}>
                                    <Grid container spacing={2}>
                                        <Grid size={{ xs: 12 }}>
                                            <TextField
                                                fullWidth
                                                label="رقم المستلم"
                                                value={messageForm.recipient}
                                                onChange={e => setMessageForm({ ...messageForm, recipient: e.target.value })}
                                                placeholder="مثال: 20100000000"
                                                required
                                            />
                                        </Grid>

                                        <Grid size={{ xs: 12 }}>
                                            <FormControl>
                                                <RadioGroup
                                                    row
                                                    value={messageForm.type}
                                                    onChange={(e) => setMessageForm({ ...messageForm, type: e.target.value })}
                                                >
                                                    <FormControlLabel value="text" control={<Radio />} label="نص (Text)" />
                                                    <FormControlLabel value="template" control={<Radio />} label="قالب (Template)" />
                                                </RadioGroup>
                                            </FormControl>
                                        </Grid>

                                        {messageForm.type === 'text' ? (
                                            <Grid size={{ xs: 12 }}>
                                                <TextField
                                                    fullWidth
                                                    multiline
                                                    rows={4}
                                                    label="نص الرسالة"
                                                    value={messageForm.message}
                                                    onChange={e => setMessageForm({ ...messageForm, message: e.target.value })}
                                                    required
                                                />
                                            </Grid>
                                        ) : (
                                            <>
                                                <Grid size={{ xs: 12, sm: 6 }}>
                                                    <TextField
                                                        fullWidth
                                                        label="اسم القالب"
                                                        value={messageForm.templateName}
                                                        onChange={e => setMessageForm({ ...messageForm, templateName: e.target.value })}
                                                        required
                                                    />
                                                </Grid>
                                                <Grid size={{ xs: 12, sm: 6 }}>
                                                    <TextField
                                                        fullWidth
                                                        label="كود اللغة"
                                                        value={messageForm.templateLanguage}
                                                        onChange={e => setMessageForm({ ...messageForm, templateLanguage: e.target.value })}
                                                        required
                                                    />
                                                </Grid>

                                                <Grid size={{ xs: 12 }}>
                                                    <Box sx={{ mt: 1, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                                            <Typography variant="subtitle2">المتغيرات (Body Parameters)</Typography>
                                                            <Button size="small" startIcon={<AddIcon />} onClick={addParam}>
                                                                إضافة
                                                            </Button>
                                                        </Box>

                                                        {getBodyParams().map((param, index) => (
                                                            <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                                                                <Typography variant="body2" color="text.secondary" sx={{ pt: 1, width: 30 }}>
                                                                    {`{{${index + 1}}}`}
                                                                </Typography>
                                                                <TextField
                                                                    fullWidth
                                                                    size="small"
                                                                    value={param.text}
                                                                    onChange={(e) => updateParam(index, e.target.value)}
                                                                />
                                                                <IconButton size="small" onClick={() => removeParam(index)} color="error">
                                                                    <DeleteIcon fontSize="small" />
                                                                </IconButton>
                                                            </Box>
                                                        ))}
                                                    </Box>
                                                </Grid>
                                            </>
                                        )}

                                        <Grid size={{ xs: 12 }}>
                                            <Button
                                                type="submit"
                                                variant="contained"
                                                size="large"
                                                fullWidth
                                                disabled={status === 'loading'}
                                                startIcon={status !== 'loading' && <SendIcon />}
                                            >
                                                {status === 'loading' ? 'جاري الاتصال...' : 'إرسال الآن'}
                                            </Button>
                                        </Grid>
                                    </Grid>
                                </form>
                            </CardContent>
                        </Card>
                    </Box>
                </Grid>

                <Grid size={{ xs: 12 }} md={4}>
                    <Card elevation={2} sx={{ height: '100%', maxHeight: 600, display: 'flex', flexDirection: 'column' }}>
                        <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 2 }}>
                            <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <TerminalIcon color="action" />
                                سجلات التشغيل
                            </Typography>

                            <Box sx={{
                                bgcolor: '#0d0d0d',
                                borderRadius: 2,
                                p: 2,
                                flex: 1,
                                overflowY: 'auto',
                                fontFamily: 'monospace',
                                fontSize: '0.875rem'
                            }}>
                                {logs.length === 0 && (
                                    <Typography color="text.secondary" variant="body2">بانتظار العمليات...</Typography>
                                )}
                                {logs.map((log, i) => (
                                    <Box key={i} sx={{
                                        color: log.includes('Success') ? '#4ade80' : '#f87171',
                                        borderBottom: '1px solid #333',
                                        pb: 1,
                                        mb: 1
                                    }}>
                                        {log}
                                    </Box>
                                ))}
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>
        </Box>
    );
};

export default WhatsAppConsole;
