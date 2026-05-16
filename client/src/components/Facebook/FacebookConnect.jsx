import React, { useState, useEffect } from 'react';
import {
    Box, Paper, Typography, Button, CircularProgress, Alert, Stepper, Step, StepLabel,
    Checkbox, FormControlLabel, Avatar, List, ListItem, ListItemAvatar, ListItemText,
    ListItemSecondaryAction, Snackbar, Divider
} from '@mui/material';
import {
    Facebook as FacebookIcon,
    Link as LinkIcon,
    CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import api from '../../api';

const steps = ['تسجيل الدخول', 'اختيار الصفحات', 'ربط الصفحات'];

const FacebookConnect = ({ onComplete }) => {
    const [activeStep, setActiveStep] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [available, setAvailable] = useState(false);
    const [oauthState, setOauthState] = useState('');
    const [code, setCode] = useState('');
    const [pages, setPages] = useState([]);
    const [selectedPages, setSelectedPages] = useState([]);
    const [linkState, setLinkState] = useState('');
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    useEffect(() => {
        api.getMetaConfig().then(cfg => {
            setAvailable(cfg.facebook_oauth_available);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        const handleMessage = (event) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type === 'FB_OAUTH_CALLBACK') {
                const { code: fbCode, state: fbState } = event.data;
                setCode(fbCode);
                setOauthState(fbState);
                handleConnect(fbCode, fbState);
            } else if (event.data?.type === 'FB_OAUTH_ERROR') {
                setError(event.data.error_description || event.data.error || 'تم رفض التفويض');
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const handleStartAuth = async () => {
        try {
            setLoading(true);
            setError('');
            const data = await api.getFacebookAuthUrl();
            setOauthState(data.state);
            window.open(data.url, '_blank', 'width=600,height=700');
            setActiveStep(1);
        } catch (err) {
            setError(err.message || 'فشل بدء عملية الربط');
        } finally {
            setLoading(false);
        }
    };

    const handleConnect = async (fbCode, fbState) => {
        try {
            setLoading(true);
            setError('');
            setActiveStep(1);
            const data = await api.connectFacebook(fbCode, fbState);
            setPages(data.pages || []);
            setLinkState(data.link_state);
            if (data.pages.length > 0) {
                setActiveStep(2);
            } else {
                setError('لم يتم العثور على صفحات فيسبوك مرتبطة بحسابك');
            }
        } catch (err) {
            setError(err.message || 'فشل الاتصال بفيسبوك');
            setActiveStep(0);
        } finally {
            setLoading(false);
        }
    };

    const handleLinkPages = async () => {
        if (selectedPages.length === 0) {
            setError('اختر صفحة واحدة على الأقل');
            return;
        }
        try {
            setLoading(true);
            setError('');
            await api.linkFacebookPages(linkState, selectedPages);
            setActiveStep(3);
            setSnackbar({ open: true, message: 'تم ربط الصفحات بنجاح', severity: 'success' });
            if (onComplete) onComplete();
        } catch (err) {
            setError(err.message || 'فشل ربط الصفحات');
        } finally {
            setLoading(false);
        }
    };

    const togglePage = (pageId) => {
        setSelectedPages(prev =>
            prev.includes(pageId)
                ? prev.filter(id => id !== pageId)
                : [...prev, pageId]
        );
    };

    const handleManualSubmit = () => {
        if (!code || !oauthState) {
            setError('أدخل رمز التفويض والحالة');
            return;
        }
        handleConnect(code, oauthState);
    };

    if (!available) {
        return (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
                <FacebookIcon sx={{ fontSize: 48, color: 'grey.400', mb: 2 }} />
                <Typography color="text.secondary">
                    ربط فيسبوك غير متاح حالياً. تواصل مع المدير.
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
                    <FacebookIcon sx={{ fontSize: 48, color: '#1877f2', mb: 2 }} />
                    <Typography variant="h6" gutterBottom>ربط صفحة فيسبوك</Typography>
                    <Typography color="text.secondary" sx={{ mb: 3 }}>
                        سجل الدخول بحساب فيسبوك لربط صفحتك
                    </Typography>
                    <Button
                        variant="contained"
                        size="large"
                        startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <FacebookIcon />}
                        onClick={handleStartAuth}
                        disabled={loading}
                        sx={{ bgcolor: '#1877f2', '&:hover': { bgcolor: '#1565c0' } }}
                    >
                        تسجيل الدخول بفيسبوك
                    </Button>

                    <Divider sx={{ my: 3 }}>أو أدخل رمز التفويض يدوياً</Divider>

                    <Box sx={{ display: 'flex', gap: 2, maxWidth: 500, mx: 'auto' }}>
                        <input
                            placeholder="رمز التفويض (code)"
                            value={code}
                            onChange={e => setCode(e.target.value)}
                            style={{ flex: 1, padding: '8px 12px', borderRadius: 4, border: '1px solid #ccc' }}
                        />
                        <input
                            placeholder="الحالة (state)"
                            value={oauthState}
                            onChange={e => setOauthState(e.target.value)}
                            style={{ flex: 1, padding: '8px 12px', borderRadius: 4, border: '1px solid #ccc' }}
                        />
                        <Button variant="outlined" onClick={handleManualSubmit} disabled={loading}>
                            ربط
                        </Button>
                    </Box>
                </Box>
            )}

            {activeStep === 1 && (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                    <CircularProgress sx={{ mb: 2 }} />
                    <Typography>جاري الاتصال بفيسبوك...</Typography>
                </Box>
            )}

            {activeStep === 2 && (
                <Box>
                    <Typography variant="h6" gutterBottom>اختر الصفحات للربط</Typography>
                    <List>
                        {pages.map(page => (
                            <ListItem key={page.id} dense button onClick={() => togglePage(page.id)}>
                                <ListItemAvatar>
                                    <Avatar src={page.picture_url} sx={{ bgcolor: '#1877f2' }}>
                                        <FacebookIcon />
                                    </Avatar>
                                </ListItemAvatar>
                                <ListItemText
                                    primary={page.name}
                                    secondary={page.category || `ID: ${page.id}`}
                                />
                                <ListItemSecondaryAction>
                                    <Checkbox
                                        checked={selectedPages.includes(page.id)}
                                        onChange={() => togglePage(page.id)}
                                        color="primary"
                                    />
                                </ListItemSecondaryAction>
                            </ListItem>
                        ))}
                    </List>
                    {pages.length === 0 && (
                        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                            لم يتم العثور على صفحات
                        </Typography>
                    )}
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
                        <Button onClick={() => setActiveStep(0)}>رجوع</Button>
                        <Button
                            variant="contained"
                            onClick={handleLinkPages}
                            disabled={loading || selectedPages.length === 0}
                            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <LinkIcon />}
                        >
                            ربط {selectedPages.length > 0 ? `(${selectedPages.length})` : ''}
                        </Button>
                    </Box>
                </Box>
            )}

            {activeStep === 3 && (
                <Box sx={{ textAlign: 'center', py: 3 }}>
                    <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
                    <Typography variant="h6" gutterBottom>تم الربط بنجاح</Typography>
                    <Typography color="text.secondary">
                        تم ربط {selectedPages.length} صفحة فيسبوك بحسابك
                    </Typography>
                    <Button sx={{ mt: 2 }} variant="outlined" onClick={() => {
                        setActiveStep(0);
                        setPages([]);
                        setSelectedPages([]);
                        setCode('');
                        setOauthState('');
                    }}>
                        ربط صفحة أخرى
                    </Button>
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

export default FacebookConnect;
