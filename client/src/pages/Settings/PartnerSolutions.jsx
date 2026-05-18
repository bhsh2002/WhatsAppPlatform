import React, { useEffect, useState } from 'react';
import {
    Box, Typography, Paper, Grid, TextField, Button, Card, CardContent, Chip,
    CircularProgress, Alert, Snackbar, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, Dialog, DialogTitle, DialogContent, DialogActions, IconButton,
    FormControl, InputLabel, Select, MenuItem
} from '@mui/material';
import { Handshake as HandshakeIcon, Search as SearchIcon, Add as AddIcon, Delete as DeleteIcon, PersonAdd } from '@mui/icons-material';
import api from '../../api';

const PartnerSolutions = () => {
    const [businessId, setBusinessId] = useState('');
    const [tenants, setTenants] = useState([]);
    const [selectedTenant, setSelectedTenant] = useState('');
    const [clients, setClients] = useState([]);
    const [permissionWarning, setPermissionWarning] = useState('');
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [addOpen, setAddOpen] = useState(false);
    const [adding, setAdding] = useState(false);
    const [newClient, setNewClient] = useState({ name: '', existing_client_business_id: '' });
    const [actionLoading, setActionLoading] = useState('');
    const [wabaDialog, setWabaDialog] = useState({ open: false, client: null, accounts: [] });
    const [systemUserDialog, setSystemUserDialog] = useState({ open: false, client: null, name: '', role: 'ADMIN' });

    useEffect(() => {
        const loadTenants = async () => {
            try {
                const data = await api.getTenants();
                setTenants(data || []);
                const tenantWithBusiness = (data || []).find(t => t.business_id);
                if (tenantWithBusiness) {
                    setSelectedTenant(String(tenantWithBusiness.id));
                    setBusinessId(tenantWithBusiness.business_id);
                }
            } catch (err) {
                setError(err.message || 'فشل جلب قائمة العملاء');
            }
        };
        loadTenants();
    }, []);

    const handleTenantChange = (event) => {
        const tenantId = event.target.value;
        setSelectedTenant(tenantId);
        const tenant = tenants.find(t => String(t.id) === String(tenantId));
        setBusinessId(tenant?.business_id || '');
        setClients([]);
        setLoaded(false);
        setPermissionWarning('');
    };

    const loadClients = async () => {
        if (!businessId.trim()) return;
        try {
            setLoading(true);
            setError('');
            const data = await api.getPartnerClients(businessId, selectedTenant);
            setClients(data.clients || []);
            setPermissionWarning(data.permission_error || '');
            setLoaded(true);
        } catch (err) {
            setError(err.message || 'فشل جلب العملاء');
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async () => {
        try {
            setAdding(true);
            const payload = { business_id: businessId, tenant_id: selectedTenant };
            if (newClient.existing_client_business_id) {
                payload.existing_client_business_id = newClient.existing_client_business_id;
            } else {
                payload.name = newClient.name;
            }
            await api.addPartnerClient(payload);
            setSuccess('تم إضافة العميل بنجاح');
            setAddOpen(false);
            setNewClient({ name: '', existing_client_business_id: '' });
            loadClients();
        } catch (err) {
            setError(err.message || 'فشل إضافة العميل');
        } finally {
            setAdding(false);
        }
    };

    const selectedTenantData = tenants.find(t => String(t.id) === String(selectedTenant));
    const businessScopes = (() => {
        try {
            return JSON.parse(selectedTenantData?.facebook_user_token_scopes || '[]');
        } catch {
            return [];
        }
    })();
    const readyForPartner = !!selectedTenant && businessScopes.includes('business_management');

    const handleRemoveClient = async (client) => {
        if (!window.confirm(`إزالة العميل المُدار ${client.name || client.id}؟`)) return;
        try {
            setActionLoading(`remove:${client.id}`);
            await api.removePartnerClient(businessId, selectedTenant, client.id);
            setSuccess('تمت إزالة العميل المُدار');
            loadClients();
        } catch (err) {
            setError(err.message || 'فشل إزالة العميل');
        } finally {
            setActionLoading('');
        }
    };

    const handleLoadWaba = async (client) => {
        try {
            setActionLoading(`waba:${client.id}`);
            const data = await api.getPartnerClientWaba(client.id, selectedTenant);
            setWabaDialog({ open: true, client, accounts: data.whatsapp_accounts || [] });
        } catch (err) {
            setError(err.message || 'فشل جلب حسابات واتساب للعميل');
        } finally {
            setActionLoading('');
        }
    };

    const handleCreateSystemUser = async () => {
        const client = systemUserDialog.client;
        if (!client || !systemUserDialog.name.trim()) return;
        try {
            setActionLoading(`system-user:${client.id}`);
            await api.createPartnerSystemUser(client.id, {
                tenant_id: selectedTenant,
                name: systemUserDialog.name.trim(),
                role: systemUserDialog.role,
            });
            setSuccess('تم إنشاء مستخدم النظام');
            setSystemUserDialog({ open: false, client: null, name: '', role: 'ADMIN' });
        } catch (err) {
            setError(err.message || 'فشل إنشاء مستخدم النظام');
        } finally {
            setActionLoading('');
        }
    };

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                <HandshakeIcon sx={{ fontSize: 32, color: 'primary.main' }} />
                <Box>
                    <Typography variant="h5" fontWeight={700}>حلول الشركاء</Typography>
                    <Typography variant="body2" color="text.secondary">إدارة العملاء المُدارين (Partner Solutions API)</Typography>
                </Box>
            </Box>

            <Paper sx={{ p: 3, mb: 3 }}>
                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
                    <FormControl fullWidth size="small">
                        <InputLabel>العميل</InputLabel>
                        <Select value={selectedTenant} label="العميل" onChange={handleTenantChange}>
                            {tenants.map(tenant => (
                                <MenuItem key={tenant.id} value={String(tenant.id)}>
                                    {tenant.name} {tenant.business_id ? '' : '(بدون Business ID)'}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <TextField fullWidth label="معرف النشاط التجاري (Business ID)" value={businessId}
                        onChange={e => setBusinessId(e.target.value)} size="small" />
                    <Button variant="contained" startIcon={loading ? <CircularProgress size={18} /> : <SearchIcon />}
                        onClick={loadClients} disabled={loading || !businessId.trim() || !selectedTenant} sx={{ minWidth: 120 }}>بحث</Button>
                </Box>
                <Alert severity={readyForPartner ? 'success' : 'warning'} sx={{ mt: 2 }}>
                    {readyForPartner
                        ? 'العميل المحدد لديه business_management حسب البيانات المخزنة. بعض عمليات الشركاء قد تتطلب حالة Partner لدى Meta.'
                        : 'حلول الشركاء تتطلب عميلا محددا مع Facebook user token وصلاحية business_management.'}
                </Alert>
            </Paper>

            {loaded && (
                <>
                    {permissionWarning && (
                        <Alert severity="warning" sx={{ mb: 2 }}>{permissionWarning}</Alert>
                    )}

                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography variant="h6" fontWeight={600}>العملاء المُدارون ({clients.length})</Typography>
                        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)} size="small">إضافة عميل</Button>
                    </Box>

                    <Paper>
                        <TableContainer sx={{ overflowX: 'auto' }}>
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>الاسم</TableCell>
                                        <TableCell>المعرف</TableCell>
                                        <TableCell>حالة التحقق</TableCell>
                                        <TableCell>تاريخ الإنشاء</TableCell>
                                        <TableCell align="right">إجراءات</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {clients.map((client, i) => (
                                        <TableRow key={i}>
                                            <TableCell>
                                                <Typography fontWeight={600}>{client.name || '-'}</Typography>
                                            </TableCell>
                                            <TableCell><Chip label={client.id} size="small" variant="outlined" /></TableCell>
                                            <TableCell>
                                                <Chip label={client.verification_status || 'غير محقق'} size="small"
                                                    color={client.verification_status === 'verified' ? 'success' : 'warning'} />
                                            </TableCell>
                                            <TableCell>{client.created_time ? new Date(client.created_time).toLocaleDateString('ar-LY') : '-'}</TableCell>
                                            <TableCell align="right">
                                                <Button size="small" onClick={() => handleLoadWaba(client)} disabled={actionLoading === `waba:${client.id}`}>
                                                    WABA
                                                </Button>
                                                <Button size="small" startIcon={<PersonAdd />} onClick={() => setSystemUserDialog({ open: true, client, name: '', role: 'ADMIN' })}>
                                                    System user
                                                </Button>
                                                <IconButton size="small" color="error" onClick={() => handleRemoveClient(client)} disabled={actionLoading === `remove:${client.id}`}>
                                                    {actionLoading === `remove:${client.id}` ? <CircularProgress size={16} /> : <DeleteIcon fontSize="small" />}
                                                </IconButton>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {clients.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                                لا يوجد عملاء مُدارون
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </Paper>
                </>
            )}

            <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>إضافة عميل</DialogTitle>
                <DialogContent>
                    <Alert severity="info" sx={{ mb: 2, mt: 1 }}>
                        يمكنك إضافة عميل موجود بمعرفه أو إنشاء عميل جديد باسمه
                    </Alert>
                    <TextField fullWidth label="معرف عميل موجود (اختياري)" value={newClient.existing_client_business_id}
                        onChange={e => setNewClient({ ...newClient, existing_client_business_id: e.target.value })}
                        sx={{ mb: 2 }} helperText="أدخل Business ID لعميل موجود" />
                    <Typography variant="body2" sx={{ textAlign: 'center', my: 1, color: 'text.secondary' }}>— أو —</Typography>
                    <TextField fullWidth label="اسم عميل جديد" value={newClient.name}
                        onChange={e => setNewClient({ ...newClient, name: e.target.value })}
                        disabled={!!newClient.existing_client_business_id} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAddOpen(false)}>إلغاء</Button>
                    <Button variant="contained" onClick={handleAdd} disabled={adding || (!newClient.name && !newClient.existing_client_business_id)}>
                        {adding ? 'جاري الإضافة...' : 'إضافة'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={wabaDialog.open} onClose={() => setWabaDialog({ open: false, client: null, accounts: [] })} maxWidth="sm" fullWidth>
                <DialogTitle>حسابات واتساب للعميل</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="subtitle2" sx={{ mb: 2 }}>
                        {wabaDialog.client?.name || wabaDialog.client?.id}
                    </Typography>
                    {wabaDialog.accounts.length === 0 ? (
                        <Alert severity="info">لا توجد حسابات WABA مرجعة من Meta لهذا العميل.</Alert>
                    ) : (
                        wabaDialog.accounts.map(account => (
                            <Paper key={account.id} variant="outlined" sx={{ p: 1.5, mb: 1 }}>
                                <Typography fontWeight={600}>{account.name || 'WABA'}</Typography>
                                <Typography variant="body2" color="text.secondary">ID: {account.id} • {account.currency || '-'}</Typography>
                            </Paper>
                        ))
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setWabaDialog({ open: false, client: null, accounts: [] })}>إغلاق</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={systemUserDialog.open} onClose={() => setSystemUserDialog({ open: false, client: null, name: '', role: 'ADMIN' })} maxWidth="sm" fullWidth>
                <DialogTitle>إنشاء مستخدم نظام</DialogTitle>
                <DialogContent>
                    <Alert severity="info" sx={{ mb: 2, mt: 1 }}>
                        سيتم إنشاء مستخدم نظام على business الخاص بالعميل المحدد إذا كانت صلاحيات Meta تسمح بذلك.
                    </Alert>
                    <TextField
                        fullWidth
                        label="اسم مستخدم النظام"
                        value={systemUserDialog.name}
                        onChange={e => setSystemUserDialog(prev => ({ ...prev, name: e.target.value }))}
                        sx={{ mb: 2 }}
                    />
                    <FormControl fullWidth>
                        <InputLabel>الدور</InputLabel>
                        <Select
                            value={systemUserDialog.role}
                            label="الدور"
                            onChange={e => setSystemUserDialog(prev => ({ ...prev, role: e.target.value }))}
                        >
                            <MenuItem value="ADMIN">ADMIN</MenuItem>
                            <MenuItem value="EMPLOYEE">EMPLOYEE</MenuItem>
                        </Select>
                    </FormControl>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setSystemUserDialog({ open: false, client: null, name: '', role: 'ADMIN' })}>إلغاء</Button>
                    <Button variant="contained" onClick={handleCreateSystemUser} disabled={actionLoading.startsWith('system-user') || !systemUserDialog.name.trim()}>
                        {actionLoading.startsWith('system-user') ? 'جاري الإنشاء...' : 'إنشاء'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError('')}>
                <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
            </Snackbar>
            <Snackbar open={!!success} autoHideDuration={3000} onClose={() => setSuccess('')}>
                <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>
            </Snackbar>
        </Box>
    );
};

export default PartnerSolutions;
