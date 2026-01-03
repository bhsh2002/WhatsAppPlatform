import React, { useState } from 'react';
import { useTenants } from '../../context/TenantContext';
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
    ListItemIcon
} from '@mui/material';
import {
    Search as SearchIcon,
    Add as AddIcon,
    MoreVert as MoreVertIcon,
    Edit as EditIcon,
    Delete as DeleteIcon,
    WhatsApp as WhatsAppIcon
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
        access_token: ''
    });
    const [anchorEl, setAnchorEl] = useState(null);
    const [selectedTenantId, setSelectedTenantId] = useState(null);
    const [saving, setSaving] = useState(false);

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
                access_token: tenant.access_token || ''
            });
            setShowModal(true);
        }
        handleMenuClose();
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

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
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
                    إضافة عميل جديد
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

            <TableContainer component={Paper}>
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
                                    <TableCell>{tenant.credits?.toLocaleString()} SAR</TableCell>
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
                                    type="password"
                                    label="Access Token"
                                    value={formData.access_token}
                                    onChange={(e) => setFormData({ ...formData, access_token: e.target.value })}
                                    placeholder="EAA..."
                                />
                            </Grid>
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
        </Box>
    );
};

export default TenantList;
