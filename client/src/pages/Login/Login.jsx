import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Link as RouterLink } from 'react-router-dom';
import {
    Box,
    Card,
    CardContent,
    Typography,
    TextField,
    Button,
    InputAdornment,
    IconButton,
    Alert,
    Link,
    CircularProgress,
    Tabs,
    Tab
} from '@mui/material';
import {
    Person as PersonIcon,
    Lock as LockIcon,
    Visibility,
    VisibilityOff,
    Email as EmailIcon,
    Badge as BadgeIcon,
    Login as LoginIcon,
    Business as BusinessIcon,
    Phone as PhoneIcon,
    Language as LanguageIcon
} from '@mui/icons-material';
import api from '../../api';
import { useLanguage } from '../../context/LanguageContext';

const Login = () => {
    const { login, loading, error } = useAuth();
    const { language, setLanguage, t } = useLanguage();
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        name: '',
        email: ''
    });
    const [tenantFormData, setTenantFormData] = useState({
        business_name: '',
        phone: '',
        username: '',
        password: '',
        email: '',
        contact_name: ''
    });
    const [showPassword, setShowPassword] = useState(false);
    const [localError, setLocalError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [tenantLoading, setTenantLoading] = useState(false);

    // Current tab: 0 = login, 1 = tenant register
    const [tabValue, setTabValue] = useState(0);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLocalError('');
        setSuccessMessage('');

        const result = await login(formData.username, formData.password);
        if (!result.success) {
            setLocalError(result.error);
        }
    };

    const handleTenantRegister = async (e) => {
        e.preventDefault();
        setLocalError('');
        setSuccessMessage('');

        if (!tenantFormData.business_name || !tenantFormData.phone || !tenantFormData.username || !tenantFormData.password) {
            setLocalError(t('auth.requiredFields'));
            return;
        }
        if (tenantFormData.password.length < 8) {
            setLocalError(t('auth.weakPassword'));
            return;
        }

        try {
            setTenantLoading(true);
            const result = await api.registerTenant(tenantFormData);
            setSuccessMessage(result.message || t('auth.registerSuccess'));
            setTenantFormData({ business_name: '', phone: '', username: '', password: '', email: '', contact_name: '' });
        } catch (err) {
            setLocalError(err.message || t('auth.registerFailed'));
        } finally {
            setTenantLoading(false);
        }
    };

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    return (
        <Box component="main" sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.default',
            p: 2,
            background: 'linear-gradient(135deg, #008069 0%, #005c4b 100%)' // WhatsApp-like gradient
        }}>
            <Button
                variant="outlined"
                startIcon={<LanguageIcon />}
                onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                sx={{
                    position: 'fixed',
                    top: 16,
                    insetInlineEnd: 16,
                    color: 'white',
                    borderColor: 'rgba(255,255,255,0.7)',
                    '&:hover': {
                        borderColor: 'white',
                        bgcolor: 'rgba(255,255,255,0.08)',
                    },
                }}
                aria-label={t('language.toggleLabel')}
            >
                {language === 'ar' ? t('language.switchToEnglish') : t('language.switchToArabic')}
            </Button>
            <Box sx={{ width: '100%', maxWidth: 420 }}>
                {/* Logo */}
                <Box sx={{ textAlign: 'center', mb: 4, color: 'white' }}>
                    <Box sx={{
                        width: 64,
                        height: 64,
                        bgcolor: 'white',
                        borderRadius: 3,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        mb: 2,
                        boxShadow: 3
                    }}>
                        <Typography component="span" aria-hidden="true" variant="h3">⚡</Typography>
                    </Box>
                    <Typography component="h1" variant="h5" fontWeight={700}>
                        Wa Savana
                    </Typography>
                    <Typography variant="body2" sx={{ opacity: 0.8 }}>
                        {t('auth.subtitle')}
                    </Typography>
                </Box>

                <Card elevation={8} sx={{ borderRadius: 3 }}>
                    <CardContent sx={{ p: 4 }}>
                        <Tabs
                            aria-label={t('auth.loginTab')}
                            value={tabValue}
                            onChange={(_, v) => { setTabValue(v); setLocalError(''); setSuccessMessage(''); }}
                            variant="fullWidth"
                            sx={{ mb: 2 }}
                        >
                            <Tab label={t('auth.loginTab')} />
                            <Tab label={t('auth.registerTab')} />
                        </Tabs>

                        {successMessage && (
                            <Alert severity="success" sx={{ mb: 2, borderRadius: 2 }}>
                                {successMessage}
                            </Alert>
                        )}

                        {(localError || error) && (
                            <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                                {localError || error}
                            </Alert>
                        )}

                        {tabValue === 0 ? (
                            <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <TextField
                                    fullWidth
                                    label={t('auth.username')}
                                    name="username"
                                    autoComplete="username"
                                    value={formData.username}
                                    onChange={handleChange}
                                    required
                                    InputProps={{
                                        startAdornment: (
                                            <InputAdornment position="start">
                                                <PersonIcon color="action" />
                                            </InputAdornment>
                                        ),
                                    }}
                                />

                                <TextField
                                    fullWidth
                                    label={t('auth.password')}
                                    name="password"
                                    autoComplete="current-password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={formData.password}
                                    onChange={handleChange}
                                    required
                                    InputProps={{
                                        startAdornment: (
                                            <InputAdornment position="start">
                                                <LockIcon color="action" />
                                            </InputAdornment>
                                        ),
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton
                                                    type="button"
                                                    onClick={() => setShowPassword(!showPassword)}
                                                    edge="end"
                                                    aria-label={language === 'ar'
                                                        ? (showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور')
                                                        : (showPassword ? 'Hide password' : 'Show password')}
                                                >
                                                    {showPassword ? <VisibilityOff /> : <Visibility />}
                                                </IconButton>
                                            </InputAdornment>
                                        ),
                                    }}
                                />

                                <Button
                                    type="submit"
                                    variant="contained"
                                    size="large"
                                    disabled={loading}
                                    startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <LoginIcon />}
                                    sx={{
                                        mt: 1,
                                        py: 1.5,
                                        bgcolor: 'primary.main',
                                        '&:hover': { bgcolor: 'primary.dark' }
                                    }}
                                >
                                    {loading ? t('common.loading') : t('auth.loginButton')}
                                </Button>
                            </Box>
                        ) : (
                            <Box component="form" onSubmit={handleTenantRegister} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <TextField
                                    fullWidth
                                    label={t('auth.businessName')}
                                    name="organization"
                                    autoComplete="organization"
                                    value={tenantFormData.business_name}
                                    onChange={(e) => setTenantFormData({ ...tenantFormData, business_name: e.target.value })}
                                    required
                                    InputProps={{
                                        startAdornment: (
                                            <InputAdornment position="start">
                                                <BusinessIcon color="action" />
                                            </InputAdornment>
                                        ),
                                    }}
                                />
                                <TextField
                                    fullWidth
                                    label={t('auth.phone')}
                                    name="tel"
                                    autoComplete="tel"
                                    value={tenantFormData.phone}
                                    onChange={(e) => setTenantFormData({ ...tenantFormData, phone: e.target.value })}
                                    required
                                    placeholder="+218911234567"
                                    InputProps={{
                                        startAdornment: (
                                            <InputAdornment position="start">
                                                <PhoneIcon color="action" />
                                            </InputAdornment>
                                        ),
                                    }}
                                />
                                <TextField
                                    fullWidth
                                    label={t('auth.contactName')}
                                    name="name"
                                    autoComplete="name"
                                    value={tenantFormData.contact_name}
                                    onChange={(e) => setTenantFormData({ ...tenantFormData, contact_name: e.target.value })}
                                    InputProps={{
                                        startAdornment: (
                                            <InputAdornment position="start">
                                                <BadgeIcon color="action" />
                                            </InputAdornment>
                                        ),
                                    }}
                                />
                                <TextField
                                    fullWidth
                                    label={t('auth.username')}
                                    name="username"
                                    autoComplete="username"
                                    value={tenantFormData.username}
                                    onChange={(e) => setTenantFormData({ ...tenantFormData, username: e.target.value })}
                                    required
                                    InputProps={{
                                        startAdornment: (
                                            <InputAdornment position="start">
                                                <PersonIcon color="action" />
                                            </InputAdornment>
                                        ),
                                    }}
                                />
                                <TextField
                                    fullWidth
                                    label={t('auth.email')}
                                    type="email"
                                    name="email"
                                    autoComplete="email"
                                    value={tenantFormData.email}
                                    onChange={(e) => setTenantFormData({ ...tenantFormData, email: e.target.value })}
                                    InputProps={{
                                        startAdornment: (
                                            <InputAdornment position="start">
                                                <EmailIcon color="action" />
                                            </InputAdornment>
                                        ),
                                    }}
                                />
                                <TextField
                                    fullWidth
                                    label={t('auth.passwordWithHint')}
                                    type={showPassword ? 'text' : 'password'}
                                    name="password"
                                    autoComplete="new-password"
                                    value={tenantFormData.password}
                                    onChange={(e) => setTenantFormData({ ...tenantFormData, password: e.target.value })}
                                    required
                                    InputProps={{
                                        startAdornment: (
                                            <InputAdornment position="start">
                                                <LockIcon color="action" />
                                            </InputAdornment>
                                        ),
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton
                                                    type="button"
                                                    onClick={() => setShowPassword(!showPassword)}
                                                    edge="end"
                                                    aria-label={language === 'ar'
                                                        ? (showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور')
                                                        : (showPassword ? 'Hide password' : 'Show password')}
                                                >
                                                    {showPassword ? <VisibilityOff /> : <Visibility />}
                                                </IconButton>
                                            </InputAdornment>
                                        ),
                                    }}
                                />
                                <Button
                                    type="submit"
                                    variant="contained"
                                    size="large"
                                    disabled={tenantLoading}
                                    startIcon={tenantLoading ? <CircularProgress size={20} color="inherit" /> : <BusinessIcon />}
                                    sx={{
                                        mt: 1,
                                        py: 1.5,
                                        bgcolor: 'secondary.main',
                                        '&:hover': { bgcolor: 'secondary.dark' }
                                    }}
                                >
                                    {tenantLoading ? t('common.registering') : t('auth.registerButton')}
                                </Button>
                                <Alert severity="info" sx={{ borderRadius: 2 }}>
                                    {t('auth.registerInfo')}
                                </Alert>
                            </Box>
                        )}

                        {/* Privacy Policy Link */}
                        <Box sx={{ textAlign: 'center', mt: 1 }}>
                            <Link
                                component={RouterLink}
                                to="/privacy-policy"
                                variant="caption"
                                color="text.secondary"
                                underline="hover"
                                sx={{ '&:hover': { color: 'primary.main' } }}
                            >
                                {t('common.privacyPolicyFull')}
                            </Link>
                        </Box>
                    </CardContent>
                </Card>
            </Box>
        </Box>
    );
};

export default Login;
