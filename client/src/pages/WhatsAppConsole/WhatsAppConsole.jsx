import React, { useEffect, useMemo, useState } from 'react';
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
    Select,
    MenuItem,
    InputLabel,
    IconButton,
    Chip,
    Alert,
    CircularProgress,
} from '@mui/material';
import {
    Send as SendIcon,
    Smartphone as SmartphoneIcon,
    Add as AddIcon,
    Delete as DeleteIcon,
    CheckCircle as CheckCircleIcon,
    Error as ErrorIcon,
    Terminal as TerminalIcon,
    Refresh as RefreshIcon,
} from '@mui/icons-material';
import api from '../../api';
import { useTenants } from '../../context/TenantContext';

const WhatsAppConsole = () => {
    const { tenants, loading: tenantsLoading, fetchTenants } = useTenants();
    const [messageForm, setMessageForm] = useState({
        recipient: '',
        type: 'text',
        message: 'مرحبا، هذه رسالة اختبار من منصة واتساب.',
        templateName: 'delivery_confirmation',
        templateLanguage: 'ar',
        templateParams: [],
        tenantId: '',
    });
    const [status, setStatus] = useState('idle');
    const [logs, setLogs] = useState([]);
    const [serverOnline, setServerOnline] = useState(null);

    const selectedTenant = useMemo(
        () => tenants.find(t => String(t.id) === String(messageForm.tenantId)),
        [tenants, messageForm.tenantId],
    );

    useEffect(() => {
        const tenantWithWhatsapp = tenants.find(t => t.phone_number_id && t.waba_id);
        if (!messageForm.tenantId && tenantWithWhatsapp) {
            setMessageForm(prev => ({ ...prev, tenantId: String(tenantWithWhatsapp.id) }));
        }
    }, [tenants, messageForm.tenantId]);

    const checkServer = async () => {
        try {
            await api.checkHealth();
            setServerOnline(true);
        } catch {
            setServerOnline(false);
        }
    };

    useEffect(() => {
        checkServer();
    }, []);

    const addParam = () => {
        setMessageForm(prev => {
            const components = [...(prev.templateParams || [])];
            const bodyIndex = components.findIndex(c => c.type === 'body');

            if (bodyIndex === -1) {
                components.push({ type: 'body', parameters: [{ type: 'text', text: '' }] });
            } else {
                components[bodyIndex].parameters.push({ type: 'text', text: '' });
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
                if (components[bodyIndex].parameters.length === 0) components.splice(bodyIndex, 1);
            }
            return { ...prev, templateParams: components };
        });
    };

    const getBodyParams = () => {
        const bodyComponent = messageForm.templateParams?.find(c => c.type === 'body');
        return bodyComponent ? bodyComponent.parameters : [];
    };

    const handleSend = async (event) => {
        event.preventDefault();
        if (!selectedTenant) return;

        const timestamp = new Date().toLocaleTimeString('ar-LY');
        setStatus('loading');

        try {
            const payload = {
                recipient: messageForm.recipient,
                type: messageForm.type,
                message: messageForm.message,
                templateName: messageForm.templateName,
                templateLanguage: messageForm.templateLanguage,
                templateParams: messageForm.templateParams,
                tenant_id: selectedTenant.id,
            };

            const result = await api.sendMessage(payload);
            setStatus('success');
            setLogs(prev => [`[${timestamp}] Success: ${result.message_id || 'تم الإرسال'}`, ...prev]);
        } catch (error) {
            setStatus('error');
            setLogs(prev => [`[${timestamp}] Error: ${error.message || error.toString()}`, ...prev]);
        }
    };

    const readiness = {
        phone: !!selectedTenant?.phone_number_id,
        waba: !!selectedTenant?.waba_id,
        token: selectedTenant?.token_status === 'valid' || selectedTenant?.token_status === 'unchecked' || !selectedTenant?.token_status,
    };
    const readyToSend = selectedTenant && readiness.phone && readiness.waba && serverOnline;

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' }, mb: 3, gap: 1.5 }}>
                <Box>
                    <Typography variant="h4" fontWeight={700} gutterBottom>
                        منصة واتساب للتشخيص
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        إرسال اختبار عبر backend باستخدام بيانات العميل المخزنة. لا يتم حفظ أو استخدام tokens من المتصفح.
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip
                        icon={serverOnline ? <CheckCircleIcon /> : <ErrorIcon />}
                        label={serverOnline === null ? 'فحص الخادم' : serverOnline ? 'الخادم متصل' : 'الخادم غير متصل'}
                        color={serverOnline ? 'success' : 'error'}
                        variant="outlined"
                    />
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<RefreshIcon />}
                        onClick={() => { fetchTenants?.(); checkServer(); }}
                    >
                        تحديث
                    </Button>
                </Box>
            </Box>

            <Grid container spacing={3}>
                <Grid size={{ xs: 12, lg: 8 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <Card>
                            <CardContent>
                                <Typography variant="h6" gutterBottom>جاهزية العميل</Typography>
                                <Grid container spacing={2}>
                                    <Grid size={{ xs: 12, md: 5 }}>
                                        <FormControl fullWidth size="small">
                                            <InputLabel>العميل</InputLabel>
                                            <Select
                                                value={messageForm.tenantId}
                                                label="العميل"
                                                onChange={(e) => setMessageForm({ ...messageForm, tenantId: e.target.value })}
                                                disabled={tenantsLoading}
                                            >
                                                {tenants.map(t => (
                                                    <MenuItem key={t.id} value={String(t.id)}>
                                                        {t.name} {t.phone_number_id ? '' : '(بدون رقم واتساب)'}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 7 }}>
                                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                            <Chip label={readiness.phone ? 'Phone Number ID موجود' : 'Phone Number ID مفقود'} color={readiness.phone ? 'success' : 'warning'} variant="outlined" />
                                            <Chip label={readiness.waba ? 'WABA ID موجود' : 'WABA ID مفقود'} color={readiness.waba ? 'success' : 'warning'} variant="outlined" />
                                            <Chip label={`Token: ${selectedTenant?.token_status || 'unchecked'}`} color={readiness.token ? 'success' : 'error'} variant="outlined" />
                                        </Box>
                                    </Grid>
                                </Grid>
                                {!readyToSend && (
                                    <Alert severity="warning" sx={{ mt: 2 }}>
                                        اختر عميلا لديه Phone Number ID وWABA ID وتأكد من اتصال الخادم قبل إرسال الاختبار.
                                    </Alert>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
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
                                                placeholder="مثال: 2189XXXXXXXX"
                                                required
                                            />
                                        </Grid>

                                        <Grid size={{ xs: 12 }}>
                                            <FormControl>
                                                <RadioGroup row value={messageForm.type} onChange={(e) => setMessageForm({ ...messageForm, type: e.target.value })}>
                                                    <FormControlLabel value="text" control={<Radio />} label="نص" />
                                                    <FormControlLabel value="template" control={<Radio />} label="قالب" />
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
                                                    <TextField fullWidth label="اسم القالب" value={messageForm.templateName} onChange={e => setMessageForm({ ...messageForm, templateName: e.target.value })} required />
                                                </Grid>
                                                <Grid size={{ xs: 12, sm: 6 }}>
                                                    <TextField fullWidth label="كود اللغة" value={messageForm.templateLanguage} onChange={e => setMessageForm({ ...messageForm, templateLanguage: e.target.value })} required />
                                                </Grid>
                                                <Grid size={{ xs: 12 }}>
                                                    <Box sx={{ mt: 1, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                                            <Typography variant="subtitle2">متغيرات Body</Typography>
                                                            <Button size="small" startIcon={<AddIcon />} onClick={addParam}>إضافة</Button>
                                                        </Box>
                                                        {getBodyParams().map((param, index) => (
                                                            <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                                                                <Typography variant="body2" color="text.secondary" sx={{ pt: 1, width: 42 }}>{`{{${index + 1}}}`}</Typography>
                                                                <TextField fullWidth size="small" value={param.text} onChange={(e) => updateParam(index, e.target.value)} />
                                                                <IconButton size="small" onClick={() => removeParam(index)} color="error"><DeleteIcon fontSize="small" /></IconButton>
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
                                                disabled={status === 'loading' || !readyToSend}
                                                startIcon={status === 'loading' ? <CircularProgress size={18} color="inherit" /> : <SendIcon />}
                                            >
                                                {status === 'loading' ? 'جاري الإرسال...' : 'إرسال عبر الخادم'}
                                            </Button>
                                        </Grid>
                                    </Grid>
                                </form>
                            </CardContent>
                        </Card>
                    </Box>
                </Grid>

                <Grid size={{ xs: 12, lg: 4 }}>
                    <Card sx={{ height: '100%', minHeight: 420, display: 'flex', flexDirection: 'column' }}>
                        <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 2 }}>
                            <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <TerminalIcon color="action" />
                                سجلات الاختبار
                            </Typography>
                            <Box sx={{ bgcolor: '#0d0d0d', borderRadius: 1, p: 2, flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.875rem' }}>
                                {logs.length === 0 && <Typography color="text.secondary" variant="body2">بانتظار العمليات...</Typography>}
                                {logs.map((log, i) => (
                                    <Box key={i} sx={{ color: log.includes('Success') ? '#4ade80' : '#f87171', borderBottom: '1px solid #333', pb: 1, mb: 1 }}>
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
