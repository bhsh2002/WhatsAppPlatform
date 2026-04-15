import React, { useState } from 'react';
import {
    Box, Typography, Paper, Grid, TextField, Button, Card, CardContent, Chip,
    CircularProgress, Alert, Snackbar, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, Dialog, DialogTitle, DialogContent, DialogActions, IconButton
} from '@mui/material';
import { Handshake as HandshakeIcon, Search as SearchIcon, Add as AddIcon, Delete as DeleteIcon, PersonAdd } from '@mui/icons-material';
import api from '../../api';

const PartnerSolutions = () => {
    const [businessId, setBusinessId] = useState('');
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [addOpen, setAddOpen] = useState(false);
    const [adding, setAdding] = useState(false);
    const [newClient, setNewClient] = useState({ name: '', existing_client_business_id: '' });

    const loadClients = async () => {
        if (!businessId.trim()) return;
        try {
            setLoading(true);
            setError('');
            const data = await api.getPartnerClients(businessId);
            setClients(data.clients || []);
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
            const payload = { business_id: businessId };
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
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField fullWidth label="معرف النشاط التجاري (Business ID)" value={businessId}
                        onChange={e => setBusinessId(e.target.value)} size="small" />
                    <Button variant="contained" startIcon={loading ? <CircularProgress size={18} /> : <SearchIcon />}
                        onClick={loadClients} disabled={loading || !businessId.trim()} sx={{ minWidth: 120 }}>بحث</Button>
                </Box>
            </Paper>

            {loaded && (
                <>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography variant="h6" fontWeight={600}>العملاء المُدارون ({clients.length})</Typography>
                        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)} size="small">إضافة عميل</Button>
                    </Box>

                    <Paper>
                        <TableContainer>
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>الاسم</TableCell>
                                        <TableCell>المعرف</TableCell>
                                        <TableCell>حالة التحقق</TableCell>
                                        <TableCell>تاريخ الإنشاء</TableCell>
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
                                        </TableRow>
                                    ))}
                                    {clients.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={4} align="center" sx={{ py: 6, color: 'text.secondary' }}>
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
