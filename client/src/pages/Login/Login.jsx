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
    CircularProgress
} from '@mui/material';
import {
    Person as PersonIcon,
    Lock as LockIcon,
    Visibility,
    VisibilityOff,
    Email as EmailIcon,
    Badge as BadgeIcon,
    Login as LoginIcon,
    HowToReg as HowToRegIcon
} from '@mui/icons-material';

const Login = () => {
    const { login, register, loading, error } = useAuth();
    const [isRegister, setIsRegister] = useState(false);
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        name: '',
        email: ''
    });
    const [showPassword, setShowPassword] = useState(false);
    const [localError, setLocalError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLocalError('');

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
                        مراقب واتساب
                    </Typography>
                    <Typography variant="body2" sx={{ opacity: 0.8 }}>
                        لوحة الإدارة المركزية
                    </Typography>
                </Box>

                <Card elevation={8} sx={{ borderRadius: 3 }}>
                    <CardContent sx={{ p: 4 }}>
                        <Typography variant="h5" align="center" fontWeight={600} gutterBottom>
                            {isRegister ? 'إنشاء حساب جديد' : 'تسجيل الدخول'}
                        </Typography>

                        {(localError || error) && (
                            <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                                {localError || error}
                            </Alert>
                        )}

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

                            {isRegister && (
                                <>
                                    <TextField
                                        fullWidth
                                        label="الاسم الكامل"
                                        name="name"
                                        value={formData.name}
                                        onChange={handleChange}
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
                                        label="البريد الإلكتروني"
                                        name="email"
                                        type="email"
                                        value={formData.email}
                                        onChange={handleChange}
                                        InputProps={{
                                            startAdornment: (
                                                <InputAdornment position="start">
                                                    <EmailIcon color="action" />
                                                </InputAdornment>
                                            ),
                                        }}
                                    />
                                </>
                            )}

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
                                startIcon={loading ? <CircularProgress size={20} color="inherit" /> : (isRegister ? <HowToRegIcon /> : <LoginIcon />)}
                                sx={{
                                    mt: 1,
                                    py: 1.5,
                                    bgcolor: 'primary.main',
                                    '&:hover': { bgcolor: 'primary.dark' }
                                }}
                            >
                                {loading ? 'جاري التحميل...' : (isRegister ? 'إنشاء الحساب' : 'دخول')}
                            </Button>
                        </Box>

                        <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider', textAlign: 'center' }}>
                            <Button
                                onClick={() => {
                                    setIsRegister(!isRegister);
                                    setLocalError('');
                                }}
                                color="primary"
                                sx={{ textTransform: 'none' }}
                            >
                                {isRegister ? 'لديك حساب؟ تسجيل الدخول' : 'ليس لديك حساب؟ إنشاء حساب جديد'}
                            </Button>
                        </Box>

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

                {!isRegister && (
                    <Box sx={{ mt: 3, textAlign: 'center', color: 'white', opacity: 0.9 }}>
                        <Typography variant="body2" sx={{ bgcolor: 'rgba(255,255,255,0.1)', py: 1, px: 2, borderRadius: 2, display: 'inline-block' }}>
                            بيانات الدخول الافتراضية: <strong>admin</strong> / <strong>admin123</strong>
                        </Typography>
                    </Box>
                )}
            </Box>
        </Box>
    );
};

export default Login;
