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
    HowToReg as HowToRegIcon,
    Business as BusinessIcon,
    Phone as PhoneIcon
} from '@mui/icons-material';
import api from '../../api';

const Login = () => {
    const { login, register, loading, error } = useAuth();
    const [isRegister, setIsRegister] = useState(false);
    const [isTenantRegister, setIsTenantRegister] = useState(false);
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

        if (isRegister) {
            if (formData.password.length < 6) {
                setLocalError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
                return;
            }
            const result = await register(formData);
            if (!result.success) {
                setLocalError(result.error);
            }
        } else {
            const result = await login(formData.username, formData.password);
            if (!result.success) {
                setLocalError(result.error);
            }
        }
    };

    const handleTenantRegister = async (e) => {
        e.preventDefault();
        setLocalError('');
        setSuccessMessage('');

        if (!tenantFormData.business_name || !tenantFormData.phone || !tenantFormData.username || !tenantFormData.password) {
            setLocalError('جميع الحقول المطلوبة يجب تعبئتها');
            return;
        }
        if (tenantFormData.password.length < 8) {
            setLocalError('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
            return;
        }

        try {
            setTenantLoading(true);
            const result = await api.registerTenant(tenantFormData);
            setSuccessMessage(result.message || 'تم التسجيل بنجاح. حسابك في انتظار موافقة المدير.');
            setTenantFormData({ business_name: '', phone: '', username: '', password: '', email: '', contact_name: '' });
        } catch (err) {
            setLocalError(err.message || 'فشل التسجيل');
        } finally {
            setTenantLoading(false);
        }
    };

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    return (
        <Box sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.default',
            p: 2,
            background: 'linear-gradient(135deg, #008069 0%, #005c4b 100%)' // WhatsApp-like gradient
        }}>
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
                        <Typography variant="h3">⚡</Typography>
                    </Box>
                    <Typography variant="h5" fontWeight={700}>
                        Wa Savana
                    </Typography>
                    <Typography variant="body2" sx={{ opacity: 0.8 }}>
                        لوحة الإدارة المركزية
                    </Typography>
                </Box>

                <Card elevation={8} sx={{ borderRadius: 3 }}>
                    <CardContent sx={{ p: 4 }}>
                        <Tabs
                            value={tabValue}
                            onChange={(_, v) => { setTabValue(v); setLocalError(''); setSuccessMessage(''); }}
                            variant="fullWidth"
                            sx={{ mb: 2 }}
                        >
                            <Tab label="تسجيل الدخول" />
                            <Tab label="تسجيل نشاط تجاري" />
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
                                    label="اسم المستخدم"
                                    name="username"
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
                                    label="كلمة المرور"
                                    name="password"
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
                                                <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
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
                                    {loading ? 'جاري التحميل...' : 'دخول'}
                                </Button>
                            </Box>
                        ) : (
                            <Box component="form" onSubmit={handleTenantRegister} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <TextField
                                    fullWidth
                                    label="اسم النشاط التجاري *"
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
                                    label="رقم الهاتف *"
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
                                    label="اسم جهة الاتصال"
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
                                    label="اسم المستخدم *"
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
                                    label="البريد الإلكتروني"
                                    type="email"
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
                                    label="كلمة المرور * (8 أحرف على الأقل)"
                                    type={showPassword ? 'text' : 'password'}
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
                                                <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
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
                                    {tenantLoading ? 'جاري التسجيل...' : 'تسجيل النشاط التجاري'}
                                </Button>
                                <Alert severity="info" sx={{ borderRadius: 2 }}>
                                    بعد التسجيل، سيتم مراجعة طلبك من قبل المدير. ستتمكن من الدخول بعد الموافقة.
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
                                سياسة الخصوصية وحماية البيانات
                            </Link>
                        </Box>
                    </CardContent>
                </Card>
            </Box>
        </Box>
    );
};

export default Login;
