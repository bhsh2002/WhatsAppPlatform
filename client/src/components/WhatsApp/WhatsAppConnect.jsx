import React, { useState, useEffect } from 'react';
import {
    Box, Paper, Typography, Button, CircularProgress, Alert, Snackbar,
    Stepper, Step, StepLabel, TextField, Divider
} from '@mui/material';
import {
    WhatsApp as WhatsAppIcon,
    CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import api from '../../api';

const steps = ['تشغيل التسجيل', 'إدخال البيانات', 'ربط الحساب'];

const WhatsAppConnect = ({ onComplete }) => {
    const [activeStep, setActiveStep] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [config, setConfig] = useState(null);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
    const [formData, setFormData] = useState({
        code: '',
        phone_number_id: '',
        waba_id: '',
        business_id: '',
    });
    const [sdkReady, setSdkReady] = useState(false);

    useEffect(() => {
        api.getMetaConfig().then(cfg => {
            setConfig(cfg);
            if (cfg.whatsapp_signup_available && cfg.app_id) {
                if (window.FB) {
                    setSdkReady(true);
                    return;
                }

                window.fbAsyncInit = function () {
                    window.FB.init({
                        appId: cfg.app_id,
                        autoLogAppEvents: true,
                        xfbml: false,
                        version: cfg.api_version || 'v25.0',
                    });
                    setSdkReady(true);
                };

                if (document.getElementById('facebook-jssdk')) return;

                const script = document.createElement('script');
                script.id = 'facebook-jssdk';
                script.src = 'https://connect.facebook.net/en_US/sdk.js';
                script.async = true;
                script.onerror = () => setError('فشل تحميل Facebook SDK. تحقق من اتصال الإنترنت.');
                document.head.appendChild(script);

                setTimeout(() => {
                    if (!window.FB) {
                        setError('تعذر تحميل Facebook SDK. تحقق من إعدادات الشبكة أو حاول لاحقاً.');
                    }
                }, 15000);
            }
        }).catch(() => {});
    }, []);

    const handleEmbeddedSignup = () => {
        if (!window.FB || !config?.config_id) {
            setError('Facebook SDK غير متاح. أعد تحميل الصفحة وحاول مرة أخرى.');
            return;
        }

        setError('');

        // Session info (phone_number_id, waba_id) arrives via sessionInfoListener,
        // NOT in authResponse. We capture it here and combine with the code.
        let sessionInfo = { phone_number_id: '', waba_id: '' };

        // Also listen for the WA_EMBEDDED_SIGNUP message event as fallback
        const messageHandler = (event) => {
            if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return;
            try {
                const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                if (data.type === 'WA_EMBEDDED_SIGNUP') {
                    sessionInfo.phone_number_id = data.data?.phone_number_id || '';
                    sessionInfo.waba_id = data.data?.waba_id || '';
                }
            } catch (e) { /* ignore non-JSON messages */ }
        };
        window.addEventListener('message', messageHandler);

        window.FB.login(response => {
            window.removeEventListener('message', messageHandler);

            if (response.authResponse?.code) {
                const code = response.authResponse.code;
                const phoneId = sessionInfo.phone_number_id;
                const wabaId = sessionInfo.waba_id;

                if (!wabaId || !phoneId) {
                    // Auto-fill what we have so user can complete manually
                    setFormData(prev => ({
                        ...prev,
                        code,
                        phone_number_id: phoneId,
                        waba_id: wabaId,
                    }));
                    setError('تم التسجيل بنجاح لكن لم يتم استلام معرفات WhatsApp تلقائياً. أدخلها يدوياً أدناه.');
                    return;
                }

                setFormData({
                    code,
                    phone_number_id: phoneId,
                    waba_id: wabaId,
                    business_id: '',
                });
                setActiveStep(2);
                handleSubmitConnect(code, phoneId, wabaId, '');
            } else if (response.status === 'not_authorized') {
                setError('تم رفض صلاحية التسجيل');
            } else {
                setError('لم يتم إكمال التسجيل');
            }
        }, {
            config_id: config.config_id,
            response_type: 'code',
            override_default_response_type: true,
            extras: {
                setup: {},
                featureType: '',
                sessionInfoListener: (info) => {
                    // Meta sends phone_number_id and waba_id here
                    sessionInfo.phone_number_id = info.phone_number_id || '';
                    sessionInfo.waba_id = info.waba_id || '';
                },
            },
        });
    };

    const handleSubmitConnect = async (code, phoneId, wabaId, bizId) => {
        try {
            setLoading(true);
            setError('');
            setActiveStep(2);
            await api.connectWhatsApp(code, phoneId, wabaId, bizId);
            setActiveStep(3);
            setSnackbar({ open: true, message: 'تم ربط حساب WhatsApp بنجاح', severity: 'success' });
            if (onComplete) onComplete();
        } catch (err) {
            setError(err.message || 'فشل ربط حساب WhatsApp');
            setActiveStep(1);
        } finally {
            setLoading(false);
        }
    };

    const handleManualSubmit = () => {
        if (!formData.code || !formData.phone_number_id || !formData.waba_id) {
            setError('جميع الحقول مطلوبة (رمز التفويض، معرف رقم الهاتف، معرف WABA)');
            return;
        }
        handleSubmitConnect(formData.code, formData.phone_number_id, formData.waba_id, formData.business_id);
    };

    if (!config) {
        return (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
                <CircularProgress />
            </Paper>
        );
    }

    if (!config.whatsapp_signup_available) {
        return (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
                <WhatsAppIcon sx={{ fontSize: 48, color: 'grey.400', mb: 2 }} />
                <Typography color="text.secondary">
                    ربط WhatsApp غير متاح حالياً. تواصل مع المدير.
                </Typography>
            </Paper>
        );
    }

    return (
        <Paper sx={{ p: 3 }}>
            <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
                {steps.map(label => (
                    <Step key={label}><StepLabel>{label}</StepLabel></Step>
                ))}
            </Stepper>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            {activeStep === 0 && (
                <Box sx={{ textAlign: 'center', py: 3 }}>
                    <WhatsAppIcon sx={{ fontSize: 48, color: '#25D366', mb: 2 }} />
                    <Typography variant="h6" gutterBottom>ربط حساب WhatsApp Business</Typography>
                    <Typography color="text.secondary" sx={{ mb: 3 }}>
                        قم بتسجيل الدخول عبر Meta لإعداد حساب WhatsApp Business الخاص بك
                    </Typography>
                    <Button
                        variant="contained"
                        size="large"
                        startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <WhatsAppIcon />}
                        onClick={handleEmbeddedSignup}
                        disabled={loading || !sdkReady}
                        sx={{ bgcolor: '#25D366', '&:hover': { bgcolor: '#1da851' } }}
                    >
                        بدء التسجيل عبر Meta
                    </Button>
                    {!sdkReady && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                            جاري تحميل Facebook SDK...
                        </Typography>
                    )}

                    <Divider sx={{ my: 3 }}>أو أدخل البيانات يدوياً</Divider>

                    <Box sx={{ maxWidth: 500, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <TextField
                            label="رمز التفويض (code)"
                            value={formData.code}
                            onChange={e => setFormData(prev => ({ ...prev, code: e.target.value }))}
                            size="small"
                            fullWidth
                        />
                        <TextField
                            label="معرف رقم الهاتف (phone_number_id)"
                            value={formData.phone_number_id}
                            onChange={e => setFormData(prev => ({ ...prev, phone_number_id: e.target.value }))}
                            size="small"
                            fullWidth
                        />
                        <TextField
                            label="معرف WABA (waba_id)"
                            value={formData.waba_id}
                            onChange={e => setFormData(prev => ({ ...prev, waba_id: e.target.value }))}
                            size="small"
                            fullWidth
                        />
                        <TextField
                            label="معرف النشاط التجاري (business_id) — اختياري"
                            value={formData.business_id}
                            onChange={e => setFormData(prev => ({ ...prev, business_id: e.target.value }))}
                            size="small"
                            fullWidth
                        />
                        <Button variant="outlined" onClick={handleManualSubmit} disabled={loading}>
                            ربط يدوي
                        </Button>
                    </Box>
                </Box>
            )}

            {activeStep === 2 && (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                    <CircularProgress sx={{ mb: 2 }} />
                    <Typography>جاري ربط حساب WhatsApp...</Typography>
                </Box>
            )}

            {activeStep === 3 && (
                <Box sx={{ textAlign: 'center', py: 3 }}>
                    <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
                    <Typography variant="h6" gutterBottom>تم الربط بنجاح</Typography>
                    <Typography color="text.secondary">
                        تم ربط حساب WhatsApp Business بحسابك
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        WABA: {formData.waba_id} | Phone: {formData.phone_number_id}
                    </Typography>
                </Box>
            )}

            <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Paper>
    );
};

export default WhatsAppConnect;
