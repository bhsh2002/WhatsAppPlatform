import React, { useState } from 'react';
import { useTenants } from '../../context/TenantContext';
import api from '../../api';
import {
    Box,
    Paper,
    Typography,
    Button,
    TextField,
    InputAdornment,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    IconButton,
    Menu,
    MenuItem,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Grid,
    FormControl,
    InputLabel,
    Select,
    CircularProgress,
    Alert,
    ListItemIcon,
    Divider
} from '@mui/material';
import {
    Search as SearchIcon,
    Add as AddIcon,
    MoreVert as MoreVertIcon,
    Edit as EditIcon,
    Delete as DeleteIcon,
    WhatsApp as WhatsAppIcon,
    PersonAdd as PersonAddIcon,
    Key as KeyIcon,
    CheckCircle as CheckCircleIcon,
    AccountBalanceWallet as CreditsIcon,
    Facebook as FacebookIcon,
    Link as LinkIcon,
    Cancel as CancelIcon,
    Refresh as RefreshIcon
} from '@mui/icons-material';

const TenantList = () => {
    const { tenants, loading, error, createTenant, updateTenant, deleteTenant } = useTenants();
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingTenant, setEditingTenant] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        phone: '',
        tier: '1K',
        credits: 0,
        status: 'Active',
        quality: 'High',
        phone_number_id: '',
        access_token: '',
        waba_id: ''
    });
    const [anchorEl, setAnchorEl] = useState(null);
    const [selectedTenantId, setSelectedTenantId] = useState(null);
    const [saving, setSaving] = useState(false);

    // Account creation state
    const [showAccountModal, setShowAccountModal] = useState(false);
    const [accountFormData, setAccountFormData] = useState({
        username: '',
        password: '',
        email: ''
    });
    const [accountInfo, setAccountInfo] = useState(null);
    const [accountLoading, setAccountLoading] = useState(false);
    const [accountError, setAccountError] = useState(null);

    // Credits top-up state
    const [showCreditsModal, setShowCreditsModal] = useState(false);
    const [creditsAmount, setCreditsAmount] = useState(100);
    const [creditsLoading, setCreditsLoading] = useState(false);

    // Facebook Pages state
    const [showFbPagesModal, setShowFbPagesModal] = useState(false);
    const [fbPages, setFbPages] = useState([]);
    const [fbPagesLoading, setFbPagesLoading] = useState(false);
    const [fbPagesError, setFbPagesError] = useState(null);
    const [fbLinkMode, setFbLinkMode] = useState(false);
    const [fbLinking, setFbLinking] = useState(false);
    const [fbLinkForm, setFbLinkForm] = useState({ page_id: '', page_access_token: '' });
    const [fbLinkId, setFbLinkId] = useState(null);

    const filteredTenants = tenants.filter(tenant => {
        const matchesSearch = tenant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            tenant.phone?.includes(searchQuery) ||
            tenant.id.toString().includes(searchQuery);
        const matchesStatus = !statusFilter ||
            (statusFilter === 'active' && tenant.status === 'Active') ||
            (statusFilter === 'suspended' && tenant.status === 'Suspended');
        return matchesSearch && matchesStatus;
    });

    const getStatusChip = (status, quality) => {
        if (status === 'Suspended' || quality === 'Low') return <Chip label="موقوف/حرج" color="error" size="small" />;
        if (status === 'Warning' || quality === 'Medium') return <Chip label="تحذير" color="warning" size="small" />;
        return <Chip label="نشط" color="success" size="small" />;
    };

    const handleMenuOpen = (event, tenantId) => {
        setAnchorEl(event.currentTarget);
        setSelectedTenantId(tenantId);
    };

    const handleMenuClose = () => {
        setAnchorEl(null);
        setSelectedTenantId(null);
    };

    const openCreateModal = () => {
        setEditingTenant(null);
        setFormData({
            name: '',
            phone: '',
            tier: '1K',
            credits: 0,
            status: 'Active',
            quality: 'High',
            phone_number_id: '',
            access_token: ''
        });
        setShowModal(true);
    };

    const openEditModal = () => {
        const tenant = tenants.find(t => t.id === selectedTenantId);
        if (tenant) {
            setEditingTenant(tenant);
            setFormData({
                name: tenant.name,
                phone: tenant.phone || '',
                tier: tenant.tier,
                credits: tenant.credits,
                status: tenant.status,
                quality: tenant.quality,
                phone_number_id: tenant.phone_number_id || '',
                waba_id: tenant.waba_id || '',
                access_token: tenant.access_token || ''
            });
            setShowModal(true);
        }
        handleMenuClose();
    };

    const openAccountModal = async () => {
        const tenantId = selectedTenantId;
        const tenant = tenants.find(t => t.id === tenantId);
        if (!tenant) return;

        // Close menu first, but save the tenant ID
        setAnchorEl(null);
        // Don't clear selectedTenantId here - we still need it


        setAccountError(null);
        setAccountInfo(null);
        setAccountFormData({
            username: tenant.name.toLowerCase().replace(/\s+/g, '_'),
            password: '',
            email: ''
        });

        setAccountError(null);
        setAccountInfo(null);
        setAccountFormData({
            username: tenant.name.toLowerCase().replace(/\s+/g, '_'),
            password: '',
            email: ''
        });

        // Check if tenant already has an account
        try {
            setAccountLoading(true);
            const data = await api.getTenantAccount(tenantId);
            setAccountInfo(data);
        } catch (err) {
            console.error('Failed to fetch account info:', err);
        } finally {
            setAccountLoading(false);
        }

        setShowAccountModal(true);
    };

    const handleCreateAccount = async () => {
        if (!selectedTenantId || !accountFormData.username || !accountFormData.password) {
            setAccountError('اسم المستخدم وكلمة المرور مطلوبان');
            return;
        }

        if (accountFormData.password.length < 6) {
            setAccountError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
            return;
        }

        try {
            setAccountLoading(true);
            setAccountError(null);
            await api.createTenantAccount(selectedTenantId, accountFormData);
            // Refresh account info
            const data = await api.getTenantAccount(selectedTenantId);
            setAccountInfo(data);
            setAccountFormData({ ...accountFormData, password: '' });
        } catch (err) {
            setAccountError(err.message);
        } finally {
            setAccountLoading(false);
        }
    };

    const handleResetPassword = async () => {
        const newPassword = prompt('أدخل كلمة المرور الجديدة (6 أحرف على الأقل):');
        if (!newPassword) return;

        if (newPassword.length < 6) {
            alert('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
            return;
        }

        try {
            setAccountLoading(true);
            await api.updateTenantPassword(selectedTenantId, newPassword);
            alert('تم تحديث كلمة المرور بنجاح');
        } catch (err) {
            alert('فشل تحديث كلمة المرور: ' + err.message);
        } finally {
            setAccountLoading(false);
        }
    };

    const handleToggleAccount = async () => {
        try {
            setAccountLoading(true);
            const result = await api.toggleTenantAccount(selectedTenantId);
            // Refresh account info
            const data = await api.getTenantAccount(selectedTenantId);
            setAccountInfo(data);
            alert(result.message);
        } catch (err) {
            alert('فشل تغيير حالة الحساب: ' + err.message);
        } finally {
            setAccountLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            setSaving(true);
            if (editingTenant) {
                await updateTenant(editingTenant.id, formData);
            } else {
                await createTenant(formData);
            }
            setShowModal(false);
        } catch (error) {
            alert('حدث خطأ: ' + error.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        const tenant = tenants.find(t => t.id === selectedTenantId);
        if (tenant && window.confirm(`هل أنت متأكد من حذف "${tenant.name}"؟`)) {
            try {
                await deleteTenant(tenant.id);
            } catch (error) {
                alert('حدث خطأ: ' + error.message);
            }
        }
        handleMenuClose();
    };

    const openCreditsModal = () => {
        setCreditsAmount(100);
        setShowCreditsModal(true);
        setAnchorEl(null);
    };

    const handleAddCredits = async () => {
        if (!selectedTenantId || creditsAmount <= 0) return;
        try {
            setCreditsLoading(true);
            const result = await api.addTenantCredits(selectedTenantId, creditsAmount);
            alert(`تم إضافة ${creditsAmount} رصيد بنجاح. الرصيد الجديد: ${result.credits}`);
            setShowCreditsModal(false);
            window.location.reload();
        } catch (err) {
            alert('فشل إضافة الرصيد: ' + err.message);
        } finally {
            setCreditsLoading(false);
        }
    };

    const openFbPagesModal = async () => {
        const tenantId = selectedTenantId;
        if (!tenantId) return;
        setAnchorEl(null);
        setFbPagesError(null);
        setFbLinkMode(false);
        setFbLinkForm({ page_id: '', page_access_token: '' });
        setShowFbPagesModal(true);
        await loadFbPages(tenantId);
    };

    const loadFbPages = async (tenantId) => {
        try {
            setFbPagesLoading(true);
            const data = await api.getTenantPages(tenantId || selectedTenantId);
            setFbPages(Array.isArray(data) ? data : []);
        } catch (err) {
            setFbPagesError(err.message || 'فشل جلب صفحات فيسبوك');
            setFbPages([]);
        } finally {
            setFbPagesLoading(false);
        }
    };

    const handleLinkFbPage = async () => {
        if (!fbLinkForm.page_id || !fbLinkForm.page_access_token) {
            setFbPagesError('معرف الصفحة ورمز الوصول مطلوبان');
            return;
        }
        try {
            setFbLinking(true);
            setFbPagesError(null);
            const result = await api.linkTenantPage(selectedTenantId, fbLinkForm);
            if (result._webhook_warning) {
                setFbPagesError(`تم ربط الصفحة لكن فشل اشتراك Webhook: ${result._webhook_warning}`);
            }
            setFbLinkForm({ page_id: '', page_access_token: '' });
            setFbLinkMode(false);
            await loadFbPages();
        } catch (err) {
            setFbPagesError(err.message || 'فشل ربط الصفحة');
        } finally {
            setFbLinking(false);
        }
    };

    const handleUnlinkFbPage = async (pageId) => {
        if (!window.confirm('هل أنت متأكد من فك ربط هذه الصفحة؟')) return;
        try {
            await api.unlinkTenantPage(pageId);
            await loadFbPages();
        } catch (err) {
            setFbPagesError(err.message || 'فشل فك ربط الصفحة');
        }
    };

    const handleToggleFbPageActive = async (pageDbId, currentActive) => {
        try {
            await api.updateTenantPage(pageDbId, { is_active: !currentActive });
            await loadFbPages();
        } catch (err) {
            setFbPagesError(err.message || 'فشل تحديث حالة الصفحة');
        }
    };

    const handleSubscribeFbPage = async (pageDbId) => {
        try {
            await api.subscribeTenantPage(pageDbId);
            await loadFbPages();
        } catch (err) {
            setFbPagesError(err.message || 'فشل اشتراك Webhook');
        }
    };

    const handleVerifyFbPage = async (pageDbId) => {
        try {
            const result = await api.verifyTenantPage(pageDbId);
            if (result.valid) {
                alert('رمز الوصول صالح ✓');
                await loadFbPages();
            } else {
                alert('رمز الوصول غير صالح: ' + (result.error || ''));
            }
        } catch (err) {
            alert('فشل التحقق: ' + (err.message || ''));
        }
    };

    const openFbPagesFromEdit = async (tenantId) => {
        setFbPagesError(null);
        setFbLinkMode(false);
        setFbLinkForm({ page_id: '', page_access_token: '' });
        setShowFbPagesModal(true);
        setFbLinkId(tenantId);
        try {
            setFbPagesLoading(true);
            const data = await api.getTenantPages(tenantId);
            setFbPages(Array.isArray(data) ? data : []);
        } catch (err) {
            setFbPagesError(err.message || 'فشل جلب صفحات فيسبوك');
            setFbPages([]);
        } finally {
            setFbPagesLoading(false);
        }
    };

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, mb: 4, gap: { xs: 1, md: 0 } }}>
                <Box>
                    <Typography variant="h4" fontWeight={700} gutterBottom>
                        إدارة العملاء
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        قائمة جميع المشتركين وحالتهم التقنية.
                    </Typography>
                </Box>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={openCreateModal}
                >
                    <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>إضافة عميل جديد</Box>
                </Button>
            </Box>

            <Paper sx={{ p: 2, mb: 3 }}>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField
                        fullWidth
                        size="small"
                        placeholder="بحث باسم الشركة، رقم الهاتف، أو المعرف..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon color="action" />
                                </InputAdornment>
                            ),
                        }}
                    />
                    <FormControl size="small" sx={{ minWidth: 200 }}>
                        <Select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            displayEmpty
                        >
                            <MenuItem value="">كل الحالات</MenuItem>
                            <MenuItem value="active">نشط</MenuItem>
                            <MenuItem value="suspended">موقوف</MenuItem>
                        </Select>
                    </FormControl>
                </Box>
            </Paper>

            {error && (
                <Alert severity="error" sx={{ mb: 3 }}>
                    {error}
                </Alert>
            )}

            <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>اسم العميل</TableCell>
                            <TableCell>رقم الهاتف</TableCell>
                            <TableCell>المستوى (Tier)</TableCell>
                            <TableCell>الرصيد</TableCell>
                            <TableCell>جودة الرقم</TableCell>
                            <TableCell>الحالة</TableCell>
                            <TableCell align="right">إجراءات</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={7} align="center" sx={{ py: 3 }}>
                                    <CircularProgress />
                                </TableCell>
                            </TableRow>
                        ) : filteredTenants.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} align="center" sx={{ py: 3 }}>
                                    <Typography color="text.secondary">لا يوجد عملاء</Typography>
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredTenants.map((tenant) => (
                                <TableRow key={tenant.id} hover>
                                    <TableCell sx={{ fontWeight: 600 }}>{tenant.name}</TableCell>
                                    <TableCell sx={{ fontFamily: 'monospace' }}>{tenant.phone}</TableCell>
                                    <TableCell>{tenant.tier}</TableCell>
                                    <TableCell>{tenant.credits?.toLocaleString()} Credits</TableCell>
                                    <TableCell>
                                        <Typography
                                            variant="body2"
                                            fontWeight={600}
                                            color={
                                                tenant.quality === 'High' ? 'success.main' :
                                                    tenant.quality === 'Medium' ? 'warning.main' : 'error.main'
                                            }
                                        >
                                            {tenant.quality}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>{getStatusChip(tenant.status, tenant.quality)}</TableCell>
                                    <TableCell align="right">
                                        <IconButton size="small" onClick={(e) => handleMenuOpen(e, tenant.id)}>
                                            <MoreVertIcon />
                                        </IconButton>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleMenuClose}
            >
                <MenuItem onClick={openEditModal}>
                    <ListItemIcon>
                        <EditIcon fontSize="small" />
                    </ListItemIcon>
                    تعديل
                </MenuItem>
                <MenuItem onClick={openAccountModal}>
                    <ListItemIcon>
                        <PersonAddIcon fontSize="small" color="primary" />
                    </ListItemIcon>
                    حساب الدخول
                </MenuItem>
                <MenuItem onClick={openCreditsModal}>
                    <ListItemIcon>
                        <CreditsIcon fontSize="small" color="success" />
                    </ListItemIcon>
                    إضافة رصيد
                </MenuItem>
                <MenuItem onClick={openFbPagesModal}>
                    <ListItemIcon>
                        <FacebookIcon fontSize="small" sx={{ color: '#1877f2' }} />
                    </ListItemIcon>
                    صفحات فيسبوك
                </MenuItem>
                <Divider />
                <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>
                    <ListItemIcon>
                        <DeleteIcon fontSize="small" color="error" />
                    </ListItemIcon>
                    حذف
                </MenuItem>
            </Menu>

            {/* Edit/Create Dialog */}
            <Dialog open={showModal} onClose={() => setShowModal(false)} maxWidth="sm" fullWidth>
                <form onSubmit={handleSubmit}>
                    <DialogTitle>
                        {editingTenant ? 'تعديل العميل' : 'إضافة عميل جديد'}
                    </DialogTitle>
                    <DialogContent dividers>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 12 }}>
                                <TextField
                                    fullWidth
                                    label="اسم العميل"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    required
                                />
                            </Grid>
                            <Grid size={{ xs: 12 }}>
                                <TextField
                                    fullWidth
                                    label="رقم الهاتف"
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    placeholder="+966500000000"
                                />
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <FormControl fullWidth>
                                    <InputLabel>المستوى</InputLabel>
                                    <Select
                                        value={formData.tier}
                                        label="المستوى"
                                        onChange={(e) => setFormData({ ...formData, tier: e.target.value })}
                                    >
                                        <MenuItem value="1K">1K</MenuItem>
                                        <MenuItem value="10K">10K</MenuItem>
                                        <MenuItem value="100K">100K</MenuItem>
                                        <MenuItem value="Unlimited">Unlimited</MenuItem>
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <TextField
                                    fullWidth
                                    type="number"
                                    label="الرصيد"
                                    value={formData.credits}
                                    onChange={(e) => setFormData({ ...formData, credits: parseInt(e.target.value) || 0 })}
                                />
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <FormControl fullWidth>
                                    <InputLabel>الحالة</InputLabel>
                                    <Select
                                        value={formData.status}
                                        label="الحالة"
                                        onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                    >
                                        <MenuItem value="Active">نشط</MenuItem>
                                        <MenuItem value="Warning">تحذير</MenuItem>
                                        <MenuItem value="Suspended">موقوف</MenuItem>
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <FormControl fullWidth>
                                    <InputLabel>الجودة</InputLabel>
                                    <Select
                                        value={formData.quality}
                                        label="الجودة"
                                        onChange={(e) => setFormData({ ...formData, quality: e.target.value })}
                                    >
                                        <MenuItem value="High">High</MenuItem>
                                        <MenuItem value="Medium">Medium</MenuItem>
                                        <MenuItem value="Low">Low</MenuItem>
                                    </Select>
                                </FormControl>
                            </Grid>

                            <Grid size={{ xs: 12 }}>
                                <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                                    <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <WhatsAppIcon fontSize="small" /> بيانات WhatsApp API (اختياري)
                                    </Typography>
                                </Box>
                            </Grid>

                            <Grid size={{ xs: 12 }}>
                                <TextField
                                    fullWidth
                                    label="Phone Number ID"
                                    value={formData.phone_number_id}
                                    onChange={(e) => setFormData({ ...formData, phone_number_id: e.target.value })}
                                    placeholder="105956789012345"
                                />
                            </Grid>

                            <Grid size={{ xs: 12 }}>
                                <TextField
                                    fullWidth
                                    label="WABA ID (معرف حساب واتساب للأعمال)"
                                    value={formData.waba_id}
                                    onChange={(e) => setFormData({ ...formData, waba_id: e.target.value })}
                                    placeholder="100595678901234"
                                    helperText="مطلوب لمزامنة القوالب"
                                />
                            </Grid>

                            <Grid size={{ xs: 12 }}>
                                <TextField
                                    fullWidth
                                    type="password"
                                    label="Access Token"
                                    value={formData.access_token}
                                    onChange={(e) => setFormData({ ...formData, access_token: e.target.value })}
                                    placeholder="EAA..."
                                />
                            </Grid>

                            {editingTenant && (
                                <Grid size={{ xs: 12 }}>
                                    <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <FacebookIcon fontSize="small" sx={{ color: '#1877f2' }} /> صفحات فيسبوك المربوطة
                                            </Typography>
                                            <Button
                                                size="small"
                                                startIcon={<LinkIcon />}
                                                onClick={() => openFbPagesFromEdit(editingTenant.id)}
                                            >
                                                إدارة الصفحات
                                            </Button>
                                        </Box>
                                    </Box>
                                </Grid>
                            )}
                        </Grid>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setShowModal(false)} color="inherit">
                            إلغاء
                        </Button>
                        <Button
                            type="submit"
                            variant="contained"
                            disabled={saving}
                            startIcon={saving ? <CircularProgress size={20} /> : null}
                        >
                            {saving ? 'جاري الحفظ...' : (editingTenant ? 'حفظ التعديلات' : 'إضافة العميل')}
                        </Button>
                    </DialogActions>
                </form>
            </Dialog>

            {/* Account Management Dialog */}
            <Dialog open={showAccountModal} onClose={() => setShowAccountModal(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PersonAddIcon color="primary" />
                    إدارة حساب الدخول
                </DialogTitle>
                <DialogContent dividers>
                    {accountLoading && (
                        <Box sx={{ textAlign: 'center', py: 3 }}>
                            <CircularProgress />
                        </Box>
                    )}

                    {!accountLoading && accountInfo?.hasAccount ? (
                        // Account exists - show management options
                        <Box>
                            <Alert severity="info" icon={<CheckCircleIcon />} sx={{ mb: 3 }}>
                                هذا العميل لديه حساب دخول بالفعل
                            </Alert>

                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                                    <Typography variant="body2" color="text.secondary">اسم المستخدم</Typography>
                                    <Typography variant="h6" fontFamily="monospace">
                                        {accountInfo.account.username}
                                    </Typography>
                                </Box>

                                <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                                    <Typography variant="body2" color="text.secondary">حالة الحساب</Typography>
                                    <Chip
                                        label={accountInfo.account.is_active ? 'نشط' : 'معطل'}
                                        color={accountInfo.account.is_active ? 'success' : 'error'}
                                        size="small"
                                        sx={{ mt: 0.5 }}
                                    />
                                </Box>

                                <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                                    <Typography variant="body2" color="text.secondary">آخر دخول</Typography>
                                    <Typography>
                                        {accountInfo.account.last_login
                                            ? new Date(accountInfo.account.last_login).toLocaleString('ar-LY')
                                            : 'لم يسجل دخول بعد'}
                                    </Typography>
                                </Box>

                                <Divider sx={{ my: 2 }} />

                                <Box sx={{ display: 'flex', gap: 2 }}>
                                    <Button
                                        variant="outlined"
                                        startIcon={<KeyIcon />}
                                        onClick={handleResetPassword}
                                        disabled={accountLoading}
                                    >
                                        إعادة تعيين كلمة المرور
                                    </Button>
                                    <Button
                                        variant="outlined"
                                        color={accountInfo.account.is_active ? 'error' : 'success'}
                                        onClick={handleToggleAccount}
                                        disabled={accountLoading}
                                    >
                                        {accountInfo.account.is_active ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                                    </Button>
                                </Box>
                            </Box>
                        </Box>
                    ) : !accountLoading ? (
                        // No account - show creation form
                        <Box>
                            <Alert severity="warning" sx={{ mb: 3 }}>
                                هذا العميل ليس لديه حساب دخول. أنشئ حساباً للسماح له بالدخول للبوابة.
                            </Alert>

                            {accountError && (
                                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setAccountError(null)}>
                                    {accountError}
                                </Alert>
                            )}

                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <TextField
                                    fullWidth
                                    label="اسم المستخدم"
                                    value={accountFormData.username}
                                    onChange={(e) => setAccountFormData({ ...accountFormData, username: e.target.value })}
                                    required
                                    helperText="سيستخدم العميل هذا الاسم لتسجيل الدخول"
                                />
                                <TextField
                                    fullWidth
                                    type="password"
                                    label="كلمة المرور"
                                    value={accountFormData.password}
                                    onChange={(e) => setAccountFormData({ ...accountFormData, password: e.target.value })}
                                    required
                                    helperText="6 أحرف على الأقل"
                                />
                                <TextField
                                    fullWidth
                                    type="email"
                                    label="البريد الإلكتروني (اختياري)"
                                    value={accountFormData.email}
                                    onChange={(e) => setAccountFormData({ ...accountFormData, email: e.target.value })}
                                />

                                <Button
                                    variant="contained"
                                    startIcon={accountLoading ? <CircularProgress size={20} /> : <PersonAddIcon />}
                                    onClick={handleCreateAccount}
                                    disabled={accountLoading || !accountFormData.username || !accountFormData.password}
                                    fullWidth
                                    sx={{ mt: 2 }}
                                >
                                    إنشاء الحساب
                                </Button>
                            </Box>
                        </Box>
                    ) : null}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowAccountModal(false)}>
                        إغلاق
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Credits Top-Up Dialog */}
            <Dialog open={showCreditsModal} onClose={() => !creditsLoading && setShowCreditsModal(false)} maxWidth="xs" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CreditsIcon color="success" />
                    إضافة رصيد
                </DialogTitle>
                <DialogContent dividers>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                        <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                            <Typography variant="body2" color="text.secondary">العميل</Typography>
                            <Typography variant="h6">
                                {tenants.find(t => t.id === selectedTenantId)?.name || '—'}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                الرصيد الحالي: {tenants.find(t => t.id === selectedTenantId)?.credits?.toLocaleString() || 0}
                            </Typography>
                        </Box>

                        <TextField
                            fullWidth
                            type="number"
                            label="عدد الرصيد المراد إضافته"
                            value={creditsAmount}
                            onChange={(e) => setCreditsAmount(Math.max(1, parseInt(e.target.value) || 0))}
                            inputProps={{ min: 1, max: 100000 }}
                            helperText="كل رسالة مرسلة تخصم 1 رصيد"
                        />

                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {[50, 100, 500, 1000, 5000].map(amt => (
                                <Chip
                                    key={amt}
                                    label={`+${amt}`}
                                    onClick={() => setCreditsAmount(amt)}
                                    color={creditsAmount === amt ? 'success' : 'default'}
                                    clickable
                                />
                            ))}
                        </Box>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowCreditsModal(false)} disabled={creditsLoading}>إلغاء</Button>
                    <Button
                        variant="contained"
                        color="success"
                        onClick={handleAddCredits}
                        disabled={creditsLoading || creditsAmount <= 0}
                        startIcon={creditsLoading ? <CircularProgress size={16} /> : <CreditsIcon />}
                    >
                        {creditsLoading ? 'جاري الإضافة...' : `إضافة ${creditsAmount} رصيد`}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Facebook Pages Management Dialog */}
            <Dialog open={showFbPagesModal} onClose={() => setShowFbPagesModal(false)} maxWidth="md" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <FacebookIcon sx={{ color: '#1877f2' }} />
                    صفحات فيسبوك المربوطة
                    {fbPagesLoading && <CircularProgress size={18} sx={{ ml: 1 }} />}
                </DialogTitle>
                <DialogContent dividers>
                    {fbPagesError && (
                        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setFbPagesError(null)}>
                            {fbPagesError}
                        </Alert>
                    )}

                    {!fbLinkMode ? (
                        <Box>
                            {fbPages.length === 0 && !fbPagesLoading ? (
                                <Box sx={{ textAlign: 'center', py: 4 }}>
                                    <FacebookIcon sx={{ fontSize: 48, color: '#1877f2', opacity: 0.4, mb: 1 }} />
                                    <Typography color="text.secondary">لا توجد صفحات مربوطة</Typography>
                                    <Typography variant="body2" color="text.secondary">اضغط "ربط صفحة جديدة" لربط صفحة فيسبوك</Typography>
                                </Box>
                            ) : (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    {fbPages.map((page) => (
                                        <Paper key={page.id} variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1 }}>
                                                {page.page_picture_url ? (
                                                    <Box
                                                        component="img"
                                                        src={page.page_picture_url}
                                                        sx={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }}
                                                        alt={page.page_name}
                                                    />
                                                ) : (
                                                    <FacebookIcon sx={{ fontSize: 40, color: '#1877f2' }} />
                                                )}
                                                <Box sx={{ flex: 1 }}>
                                                    <Typography fontWeight={600}>{page.page_name || page.page_id}</Typography>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                                                        <Typography variant="caption" color="text.secondary">
                                                            {page.page_category || '—'}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary">•</Typography>
                                                        <Typography variant="caption" color="text.secondary" fontFamily="monospace">
                                                            {page.page_id}
                                                        </Typography>
                                                    </Box>
                                                </Box>
                                            </Box>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, flexWrap: 'wrap' }}>
                                                <Chip
                                                    label={page.webhook_subscribed ? 'Webhook ✓' : 'Webhook ✗'}
                                                    size="small"
                                                    color={page.webhook_subscribed ? 'success' : 'default'}
                                                    variant={page.webhook_subscribed ? 'filled' : 'outlined'}
                                                />
                                                <Chip
                                                    label={page.is_active ? 'نشطة' : 'معطلة'}
                                                    size="small"
                                                    color={page.is_active ? 'success' : 'error'}
                                                />
                                                <Button size="small" onClick={() => handleVerifyFbPage(page.id)} variant="outlined">
                                                    تحقق
                                                </Button>
                                                {!page.webhook_subscribed && (
                                                    <Button size="small" onClick={() => handleSubscribeFbPage(page.id)} variant="outlined">
                                                        اشتراك
                                                    </Button>
                                                )}
                                                <Button size="small" onClick={() => handleToggleFbPageActive(page.id, page.is_active)} variant="outlined" color={page.is_active ? 'warning' : 'success'}>
                                                    {page.is_active ? 'تعطيل' : 'تفعيل'}
                                                </Button>
                                                <Button size="small" onClick={() => handleUnlinkFbPage(page.id)} variant="outlined" color="error">
                                                    فك الربط
                                                </Button>
                                            </Box>
                                        </Paper>
                                    ))}
                                </Box>
                            )}

                            <Box sx={{ mt: 3 }}>
                                <Button
                                    variant="contained"
                                    startIcon={<AddIcon />}
                                    onClick={() => setFbLinkMode(true)}
                                    sx={{ bgcolor: '#1877f2', '&:hover': { bgcolor: '#1565c0' } }}
                                >
                                    ربط صفحة جديدة
                                </Button>
                            </Box>
                        </Box>
                    ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <Typography variant="subtitle2">ربط صفحة فيسبوك جديدة</Typography>
                            <TextField
                                fullWidth
                                label="معرف الصفحة (Page ID)"
                                value={fbLinkForm.page_id}
                                onChange={(e) => setFbLinkForm({ ...fbLinkForm, page_id: e.target.value })}
                                placeholder="1234567890"
                                helperText="معرف صفحة فيسبوك من الإعدادات"
                            />
                            <TextField
                                fullWidth
                                type="password"
                                label="رمز الوصول (Page Access Token)"
                                value={fbLinkForm.page_access_token}
                                onChange={(e) => setFbLinkForm({ ...fbLinkForm, page_access_token: e.target.value })}
                                placeholder="EAA..."
                                helperText="رمز وصول الصفحة مع صلاحيات pages_manage_engagement و pages_messaging"
                            />
                            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                                <Button onClick={() => { setFbLinkMode(false); setFbLinkForm({ page_id: '', page_access_token: '' }); }} disabled={fbLinking}>
                                    إلغاء
                                </Button>
                                <Button
                                    variant="contained"
                                    onClick={handleLinkFbPage}
                                    disabled={fbLinking || !fbLinkForm.page_id || !fbLinkForm.page_access_token}
                                    startIcon={fbLinking ? <CircularProgress size={18} /> : <LinkIcon />}
                                    sx={{ bgcolor: '#1877f2', '&:hover': { bgcolor: '#1565c0' } }}
                                >
                                    {fbLinking ? 'جاري الربط...' : 'ربط الصفحة'}
                                </Button>
                            </Box>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowFbPagesModal(false)}>إغلاق</Button>
                    {!fbLinkMode && fbPages.length > 0 && (
                        <Button startIcon={<RefreshIcon />} onClick={() => loadFbPages(fbLinkId || selectedTenantId)} disabled={fbPagesLoading}>
                            تحديث
                        </Button>
                    )}
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default TenantList;

