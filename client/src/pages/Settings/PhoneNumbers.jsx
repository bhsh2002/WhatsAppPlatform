import React, { useState, useEffect } from 'react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Button,
    Grid,
    Chip,
    Alert,
    CircularProgress,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    IconButton,
    Tooltip
} from '@mui/material';
import {
    Phone as PhoneIcon,
    Refresh as RefreshIcon,
    AppRegistration as RegisterIcon,
    Info as InfoIcon,
    CheckCircle as CheckCircleIcon,
    Warning as WarningIcon,
    Error as ErrorIcon,
    VerifiedUser as VerifiedIcon,
    Close as CloseIcon
} from '@mui/icons-material';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';

const PhoneNumbers = () => {
    const { user } = useAuth();
    const [phoneNumbers, setPhoneNumbers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [wabaId, setWabaId] = useState('');
    const [tenants, setTenants] = useState([]);
    const [selectedTenant, setSelectedTenant] = useState('');

    // Register dialog
    const [registerDialog, setRegisterDialog] = useState(false);
    const [registerPhoneId, setRegisterPhoneId] = useState('');
    const [registerPin, setRegisterPin] = useState('');
    const [registerLoading, setRegisterLoading] = useState(false);

    // Info dialog
    const [infoDialog, setInfoDialog] = useState(false);
    const [phoneInfo, setPhoneInfo] = useState(null);
    const [infoLoading, setInfoLoading] = useState(false);

    useEffect(() => {
        fetchTenants();
    }, []);

    const fetchTenants = async () => {
        try {
            const data = await api.getTenants();
            setTenants(data);
            // Auto-select first tenant with waba_id
            const tenantWithWaba = data.find(t => t.waba_id);
            if (tenantWithWaba) {
                setSelectedTenant(tenantWithWaba.id);
                setWabaId(tenantWithWaba.waba_id);
            }
        } catch (err) {
            setError('فشل جلب قائمة العملاء');
        }
    };

    const handleTenantChange = (e) => {
        const tenantId = e.target.value;
        setSelectedTenant(tenantId);
        const tenant = tenants.find(t => t.id === tenantId);
        setWabaId(tenant?.waba_id || '');
        setPhoneNumbers([]);
    };

    const fetchPhoneNumbers = async () => {
        if (!wabaId) {
            setError('يرجى اختيار عميل يملك WABA ID');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const data = await api.getPhoneNumbers(wabaId, selectedTenant || null);
            setPhoneNumbers(data.phone_numbers || []);
        } catch (err) {
            setError(err.message || 'فشل جلب أرقام الهاتف');
        } finally {
            setLoading(false);
        }
    };

    const handleRegister = async () => {
        if (!registerPhoneId) return;
        setRegisterLoading(true);
        setError('');
        setSuccess('');
        try {
            await api.registerPhoneNumber(registerPhoneId, {
                pin: registerPin || undefined,
                tenant_id: selectedTenant || undefined
            });
            setSuccess('تم تسجيل رقم الهاتف بنجاح');
            setRegisterDialog(false);
            setRegisterPin('');
            fetchPhoneNumbers();
        } catch (err) {
            setError(err.message || 'فشل تسجيل رقم الهاتف');
        } finally {
            setRegisterLoading(false);
        }
    };

    const fetchPhoneInfo = async (phoneNumberId) => {
        setInfoLoading(true);
        setInfoDialog(true);
        setPhoneInfo(null);
        try {
            const data = await api.getPhoneNumberInfo(phoneNumberId, selectedTenant || null);
            setPhoneInfo(data);
        } catch (err) {
            setError(err.message || 'فشل جلب معلومات الرقم');
            setInfoDialog(false);
        } finally {
            setInfoLoading(false);
        }
    };

    const getQualityColor = (quality) => {
        switch (quality?.toUpperCase()) {
            case 'GREEN': return 'success';
            case 'YELLOW': return 'warning';
            case 'RED': return 'error';
            default: return 'default';
        }
    };

    const getStatusIcon = (status) => {
        switch (status?.toUpperCase()) {
            case 'CONNECTED': return <CheckCircleIcon color="success" fontSize="small" />;
            case 'WARNING': return <WarningIcon color="warning" fontSize="small" />;
            case 'FLAGGED': return <ErrorIcon color="error" fontSize="small" />;
            default: return <InfoIcon color="info" fontSize="small" />;
        }
    };

    return (
        <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" fontWeight={700} gutterBottom>
                    إدارة أرقام الهواتف
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    عرض وتسجيل وإدارة أرقام الهواتف المرتبطة بحسابات WhatsApp Business.
                </Typography>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
            {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

            {/* Tenant & WABA Selection */}
            <Card elevation={2} sx={{ mb: 3 }}>
                <CardContent>
                    <Grid container spacing={2} alignItems="center">
                        <Grid size={{ xs: 12, md: 4 }}>
                            <FormControl fullWidth size="small">
                                <InputLabel>اختر العميل</InputLabel>
                                <Select value={selectedTenant} onChange={handleTenantChange} label="اختر العميل">
                                    {tenants.map(t => (
                                        <MenuItem key={t.id} value={t.id}>
                                            {t.name} {t.waba_id ? '' : '(بدون WABA)'}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <TextField
                                fullWidth
                                size="small"
                                label="WABA ID"
                                value={wabaId}
                                onChange={(e) => setWabaId(e.target.value)}
                                placeholder="مثال: 123456789"
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Button
                                variant="contained"
                                onClick={fetchPhoneNumbers}
                                disabled={loading || !wabaId}
                                startIcon={loading ? <CircularProgress size={18} /> : <RefreshIcon />}
                                fullWidth
                            >
                                جلب الأرقام
                            </Button>
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>

            {/* Phone Numbers Table */}
            <Card elevation={2}>
                <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <PhoneIcon color="primary" />
                            <Typography variant="h6">أرقام الهواتف</Typography>
                            <Chip label={phoneNumbers.length} size="small" color="primary" />
                        </Box>
                    </Box>

                    {phoneNumbers.length === 0 ? (
                        <Alert severity="info">
                            لا توجد أرقام. اختر عميل واضغط "جلب الأرقام".
                        </Alert>
                    ) : (
                        <TableContainer component={Paper} variant="outlined">
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>الرقم</TableCell>
                                        <TableCell>الاسم</TableCell>
                                        <TableCell>الجودة</TableCell>
                                        <TableCell>الحالة</TableCell>
                                        <TableCell>Phone Number ID</TableCell>
                                        <TableCell align="center">إجراءات</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {phoneNumbers.map((phone) => (
                                        <TableRow key={phone.id} hover>
                                            <TableCell sx={{ direction: 'ltr', fontFamily: 'monospace' }}>
                                                {phone.display_phone_number}
                                            </TableCell>
                                            <TableCell>{phone.verified_name || '—'}</TableCell>
                                            <TableCell>
                                                <Chip
                                                    label={phone.quality_rating || 'غير محدد'}
                                                    size="small"
                                                    color={getQualityColor(phone.quality_rating)}
                                                    variant="outlined"
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                    {getStatusIcon(phone.code_verification_status)}
                                                    <Typography variant="body2">
                                                        {phone.code_verification_status || phone.status || '—'}
                                                    </Typography>
                                                </Box>
                                            </TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                                                {phone.id}
                                            </TableCell>
                                            <TableCell align="center">
                                                <Tooltip title="معلومات تفصيلية">
                                                    <IconButton size="small" onClick={() => fetchPhoneInfo(phone.id)}>
                                                        <InfoIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                                <Tooltip title="تسجيل الرقم">
                                                    <IconButton size="small" color="primary" onClick={() => {
                                                        setRegisterPhoneId(phone.id);
                                                        setRegisterDialog(true);
                                                    }}>
                                                        <RegisterIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </CardContent>
            </Card>

            {/* Register Dialog */}
            <Dialog open={registerDialog} onClose={() => setRegisterDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <RegisterIcon color="primary" />
                            <span>تسجيل رقم الهاتف</span>
                        </Box>
                        <IconButton onClick={() => setRegisterDialog(false)} size="small">
                            <CloseIcon />
                        </IconButton>
                    </Box>
                </DialogTitle>
                <DialogContent>
                    <Alert severity="info" sx={{ mb: 2 }}>
                        تسجيل الرقم مع Meta لتفعيل إرسال/استقبال الرسائل عبر WhatsApp Cloud API.
                    </Alert>
                    <TextField
                        fullWidth
                        label="Phone Number ID"
                        value={registerPhoneId}
                        InputProps={{ readOnly: true }}
                        sx={{ mb: 2, mt: 1 }}
                    />
                    <TextField
                        fullWidth
                        label="PIN (التحقق بخطوتين — اختياري)"
                        value={registerPin}
                        onChange={(e) => setRegisterPin(e.target.value)}
                        placeholder="6 أرقام"
                        inputProps={{ maxLength: 6 }}
                        helperText="أدخل PIN التحقق بخطوتين إذا كان مفعّلاً"
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRegisterDialog(false)}>إلغاء</Button>
                    <Button
                        variant="contained"
                        onClick={handleRegister}
                        disabled={registerLoading}
                        startIcon={registerLoading ? <CircularProgress size={18} /> : <VerifiedIcon />}
                    >
                        تسجيل
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Phone Info Dialog */}
            <Dialog open={infoDialog} onClose={() => setInfoDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>معلومات رقم الهاتف</span>
                        <IconButton onClick={() => setInfoDialog(false)} size="small">
                            <CloseIcon />
                        </IconButton>
                    </Box>
                </DialogTitle>
                <DialogContent>
                    {infoLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress />
                        </Box>
                    ) : phoneInfo ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
                            {Object.entries(phoneInfo).map(([key, value]) => (
                                <Box key={key} sx={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider', pb: 1 }}>
                                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
                                        {key}
                                    </Typography>
                                    <Typography variant="body2" sx={{ direction: 'ltr', maxWidth: '60%', wordBreak: 'break-all' }}>
                                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                    ) : (
                        <Alert severity="warning">لا توجد بيانات</Alert>
                    )}
                </DialogContent>
            </Dialog>
        </Box>
    );
};

export default PhoneNumbers;
