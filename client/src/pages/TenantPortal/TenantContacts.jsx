import React, { useState, useEffect, useCallback } from 'react';
import {
    Box,
    Paper,
    Typography,
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
    Button,
    FormControl,
    Select,
    MenuItem,
    CircularProgress,
    Alert,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TablePagination,
    Tooltip
} from '@mui/material';
import {
    Search as SearchIcon,
    Edit as EditIcon,
    Chat as ChatIcon,
    Refresh as RefreshIcon,
    Label as LabelIcon,
    Save as SaveIcon,
    Close as CloseIcon,
    Add as AddIcon,
    Delete as DeleteIcon,
    ContactPhone as ContactPhoneIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import api from '../../api';

const LABEL_OPTIONS = [
    { value: '', label: 'بدون تصنيف', color: 'default' },
    { value: 'عميل', label: 'عميل', color: 'primary' },
    { value: 'VIP', label: 'VIP', color: 'secondary' },
    { value: 'مورد', label: 'مورد', color: 'info' },
    { value: 'دعم', label: 'دعم', color: 'warning' },
    { value: 'محظور', label: 'محظور', color: 'error' },
];

const TenantContacts = () => {
    const navigate = useNavigate();
    const [contacts, setContacts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [labelFilter, setLabelFilter] = useState('');
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);
    const [total, setTotal] = useState(0);

    // Edit dialog
    const [editContact, setEditContact] = useState(null);
    const [editForm, setEditForm] = useState({ label: '', notes: '' });
    const [saving, setSaving] = useState(false);

    // Add dialog state
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [addForm, setAddForm] = useState({ phone: '', profile_name: '', label: '', notes: '' });
    const [addSaving, setAddSaving] = useState(false);
    const [addError, setAddError] = useState(null);

    // Delete confirmation
    const [deleteContact, setDeleteContact] = useState(null);
    const [deleting, setDeleting] = useState(false);

    const fetchContacts = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const params = { page: page + 1, limit: rowsPerPage };
            if (search) params.search = search;
            if (labelFilter) params.label = labelFilter;

            const data = await api.getPortalContacts(params);
            setContacts(data.contacts || []);
            setTotal(data.total || 0);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [page, rowsPerPage, search, labelFilter]);

    useEffect(() => {
        fetchContacts();
    }, [fetchContacts]);

    const openEditDialog = (contact) => {
        setEditContact(contact);
        setEditForm({
            label: contact.label || '',
            notes: contact.notes || '',
        });
    };

    const handleSaveContact = async () => {
        if (!editContact) return;
        try {
            setSaving(true);
            await api.updatePortalContact(editContact.id, editForm);
            setEditContact(null);
            fetchContacts();
        } catch (err) {
            alert('فشل حفظ التعديلات: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleAddContact = async () => {
        if (!addForm.phone?.trim()) return;
        try {
            setAddSaving(true);
            setAddError(null);
            await api.createPortalContact({
                phone: addForm.phone.replace(/[^0-9+]/g, '').trim(),
                profile_name: addForm.profile_name || null,
                label: addForm.label || null,
                notes: addForm.notes || null,
            });
            setShowAddDialog(false);
            setAddForm({ phone: '', profile_name: '', label: '', notes: '' });
            fetchContacts();
        } catch (err) {
            setAddError(err.message);
        } finally {
            setAddSaving(false);
        }
    };

    const handleDeleteContact = async () => {
        if (!deleteContact) return;
        try {
            setDeleting(true);
            await api.deletePortalContact(deleteContact.id);
            setDeleteContact(null);
            fetchContacts();
        } catch (err) {
            alert('فشل حذف جهة الاتصال: ' + err.message);
        } finally {
            setDeleting(false);
        }
    };

    const getLabelChip = (label) => {
        if (!label) return <Chip label="—" size="small" variant="outlined" />;
        const opt = LABEL_OPTIONS.find(o => o.value === label);
        return <Chip label={label} size="small" color={opt?.color || 'default'} />;
    };

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            {/* Header */}
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, mb: 4, gap: { xs: 1, md: 0 } }}>
                <Box>
                    <Typography variant="h4" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <ContactPhoneIcon fontSize="large" color="secondary" />
                        جهات الاتصال
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        قائمة جهات الاتصال الخاصة بك مع إمكانية التصنيف والملاحظات
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                        variant="contained"
                        color="secondary"
                        startIcon={<AddIcon />}
                        onClick={() => setShowAddDialog(true)}
                    >
                        إضافة جهة اتصال
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={loading ? <CircularProgress size={20} /> : <RefreshIcon />}
                        onClick={fetchContacts}
                        disabled={loading}
                    >
                        تحديث
                    </Button>
                </Box>
            </Box>

            {/* Filters */}
            <Paper sx={{ p: 2, mb: 3 }}>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <TextField
                        size="small"
                        placeholder="بحث برقم الهاتف أو الاسم..."
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                        sx={{ flex: 1, minWidth: 250 }}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon color="action" />
                                </InputAdornment>
                            ),
                        }}
                    />
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <Select
                            value={labelFilter}
                            onChange={(e) => { setLabelFilter(e.target.value); setPage(0); }}
                            displayEmpty
                        >
                            <MenuItem value="">كل التصنيفات</MenuItem>
                            {LABEL_OPTIONS.filter(o => o.value).map(o => (
                                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Box>
            </Paper>

            {error && (
                <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {/* Table */}
            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>رقم الهاتف</TableCell>
                            <TableCell>الاسم</TableCell>
                            <TableCell>التصنيف</TableCell>
                            <TableCell>عدد الرسائل</TableCell>
                            <TableCell>آخر تحديث</TableCell>
                            <TableCell align="right">إجراءات</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                                    <CircularProgress />
                                </TableCell>
                            </TableRow>
                        ) : contacts.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                                    <Typography color="text.secondary">لا توجد جهات اتصال بعد</Typography>
                                </TableCell>
                            </TableRow>
                        ) : (
                            contacts.map((contact) => (
                                <TableRow key={contact.id || contact.phone} hover>
                                    <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                                        {contact.phone}
                                    </TableCell>
                                    <TableCell>{contact.profile_name || '—'}</TableCell>
                                    <TableCell>{getLabelChip(contact.label)}</TableCell>
                                    <TableCell>
                                        <Chip label={contact.message_count || 0} size="small" variant="outlined" color="secondary" />
                                    </TableCell>
                                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                        {contact.updated_at
                                            ? new Date(contact.updated_at).toLocaleDateString('ar-LY')
                                            : '—'}
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title="تعديل">
                                            <IconButton size="small" onClick={() => openEditDialog(contact)}>
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="فتح المحادثة">
                                            <IconButton size="small" color="secondary" onClick={() => navigate('/portal/chat')}>
                                                <ChatIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="حذف">
                                            <IconButton
                                                size="small"
                                                color="error"
                                                onClick={() => setDeleteContact(contact)}
                                            >
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
                <TablePagination
                    component="div"
                    count={total}
                    page={page}
                    onPageChange={(_, newPage) => setPage(newPage)}
                    rowsPerPage={rowsPerPage}
                    onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
                    labelRowsPerPage="صفوف لكل صفحة:"
                    labelDisplayedRows={({ from, to, count }) => `${from}–${to} من ${count}`}
                />
            </TableContainer>

            {/* Edit Dialog */}
            <Dialog open={!!editContact} onClose={() => !saving && setEditContact(null)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <LabelIcon color="secondary" />
                        تعديل جهة الاتصال
                    </Box>
                    <IconButton onClick={() => setEditContact(null)} disabled={saving}>
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers>
                    {editContact && (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 }}>
                            <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                                <Typography variant="caption" color="text.secondary">رقم الهاتف</Typography>
                                <Typography variant="h6" fontFamily="monospace">{editContact.phone}</Typography>
                            </Box>

                            <FormControl fullWidth>
                                <Select
                                    value={editForm.label}
                                    onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                                    displayEmpty
                                    renderValue={(v) => v || 'اختر تصنيف...'}
                                >
                                    {LABEL_OPTIONS.map(o => (
                                        <MenuItem key={o.value} value={o.value}>
                                            <Chip label={o.label} size="small" color={o.color} sx={{ mr: 1 }} />
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>

                            <TextField
                                fullWidth
                                label="ملاحظات"
                                value={editForm.notes}
                                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                                multiline
                                rows={3}
                                placeholder="أضف ملاحظات..."
                            />
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setEditContact(null)} disabled={saving}>إلغاء</Button>
                    <Button
                        variant="contained"
                        color="secondary"
                        onClick={handleSaveContact}
                        disabled={saving}
                        startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
                    >
                        {saving ? 'جاري الحفظ...' : 'حفظ'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Add Contact Dialog */}
            <Dialog open={showAddDialog} onClose={() => !addSaving && setShowAddDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <AddIcon color="secondary" />
                        إضافة جهة اتصال جديدة
                    </Box>
                    <IconButton onClick={() => setShowAddDialog(false)} disabled={addSaving}>
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers>
                    {addError && (
                        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setAddError(null)}>
                            {addError}
                        </Alert>
                    )}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 }}>
                        <TextField
                            fullWidth
                            label="رقم الهاتف"
                            placeholder="218911234567"
                            value={addForm.phone}
                            onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                            required
                            inputProps={{ dir: 'ltr', style: { fontFamily: 'monospace' } }}
                        />
                        <TextField
                            fullWidth
                            label="الاسم"
                            placeholder="اسم جهة الاتصال"
                            value={addForm.profile_name}
                            onChange={(e) => setAddForm({ ...addForm, profile_name: e.target.value })}
                        />
                        <FormControl fullWidth>
                            <Select
                                value={addForm.label}
                                onChange={(e) => setAddForm({ ...addForm, label: e.target.value })}
                                displayEmpty
                                renderValue={(v) => v || 'اختر تصنيف (اختياري)...'}
                            >
                                {LABEL_OPTIONS.map(o => (
                                    <MenuItem key={o.value} value={o.value}>
                                        <Chip label={o.label} size="small" color={o.color} sx={{ mr: 1 }} />
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <TextField
                            fullWidth
                            label="ملاحظات"
                            value={addForm.notes}
                            onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })}
                            multiline
                            rows={2}
                            placeholder="ملاحظات اختيارية..."
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowAddDialog(false)} disabled={addSaving}>إلغاء</Button>
                    <Button
                        variant="contained"
                        color="secondary"
                        onClick={handleAddContact}
                        disabled={addSaving || !addForm.phone?.trim()}
                        startIcon={addSaving ? <CircularProgress size={16} /> : <AddIcon />}
                    >
                        {addSaving ? 'جاري الإضافة...' : 'إضافة'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!deleteContact} onClose={() => !deleting && setDeleteContact(null)}>
                <DialogTitle>تأكيد الحذف</DialogTitle>
                <DialogContent>
                    <Typography>
                        هل أنت متأكد من حذف جهة الاتصال <strong>{deleteContact?.profile_name || deleteContact?.phone}</strong>؟
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        هذا الإجراء لا يمكن التراجع عنه.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteContact(null)} disabled={deleting}>إلغاء</Button>
                    <Button
                        variant="contained"
                        color="error"
                        onClick={handleDeleteContact}
                        disabled={deleting}
                        startIcon={deleting ? <CircularProgress size={16} /> : <DeleteIcon />}
                    >
                        {deleting ? 'جاري الحذف...' : 'حذف'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default TenantContacts;
