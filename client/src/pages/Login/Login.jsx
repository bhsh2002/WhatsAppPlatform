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
    Language as LanguageIcon,
    WhatsApp as WhatsAppIcon
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
            bgcolor: '#f7f2e8',
            p: { xs: 2, sm: 4 },
            position: 'relative',
            overflowX: 'hidden',
            background: 'radial-gradient(circle at 12% 15%, rgba(229,107,79,0.17) 0 130px, transparent 132px), radial-gradient(circle at 88% 84%, rgba(8,127,91,0.15) 0 180px, transparent 182px), #f7f2e8'
        }}>
            <Button
                variant="outlined"
                startIcon={<LanguageIcon />}
                onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                sx={{
                    position: 'fixed',
                    top: 16,
                    insetInlineEnd: 16,
                    color: '#16352f',
                    borderColor: '#b8aa94',
                    bgcolor: 'rgba(255,253,248,0.8)',
                    '&:hover': {
                        borderColor: '#087f5b',
                        bgcolor: '#fffdf8',
                    },
                }}
                aria-label={t('language.toggleLabel')}
            >
                {language === 'ar' ? t('language.switchToEnglish') : t('language.switchToArabic')}
            </Button>
            <Box sx={{ width: '100%', maxWidth: 460, position: 'relative', zIndex: 1 }}>
                {/* Logo */}
                <Box component={RouterLink} to="/" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, mb: 3, color: '#16352f', textDecoration: 'none' }}>
                    <Box sx={{
                        width: 48,
                        height: 48,
                        bgcolor: '#087f5b',
                        color: 'white',
                        borderRadius: '16px 16px 5px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transform: 'rotate(-3deg)'
                    }}>
                        <WhatsAppIcon sx={{ fontSize: 28, transform: 'rotate(3deg)' }} />
                    </Box>
                    <Box>
                        <Typography component="h1" variant="h5" fontWeight={850}>Wa Savana</Typography>
                        <Typography variant="body2" color="text.secondary">{t('auth.subtitle')}</Typography>
                    </Box>
                </Box>

                <Card elevation={0} sx={{ border: '1px solid #16352f', borderRadius: '26px 8px 26px 26px', boxShadow: '12px 14px 0 #e56b4f', bgcolor: '#fffdf8' }}>
                    <CardContent sx={{ p: { xs: 2.5, sm: 4 } }}>
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
