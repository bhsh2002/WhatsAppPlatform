import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Typography, Paper, Button, TextField, CircularProgress, Alert, Snackbar,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton,
    Dialog, DialogTitle, DialogContent, DialogActions, Chip
} from '@mui/material';
import { QrCode as QrCodeIcon, Add as AddIcon, Delete as DeleteIcon, ContentCopy as CopyIcon } from '@mui/icons-material';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';

const TenantQRCodes = () => {
    const { tenant } = useAuth();
    const [qrCodes, setQrCodes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [createOpen, setCreateOpen] = useState(false);
    const [newMessage, setNewMessage] = useState('');
    const [creating, setCreating] = useState(false);

    const loadQRCodes = useCallback(async () => {
        try {
            setLoading(true);
            const data = await api.getPortalQRCodes();
            setQrCodes(data.qr_codes || []);
        } catch (err) {
            setError(err.message || 'فشل تحميل رموز QR');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadQRCodes(); }, [loadQRCodes]);

    const handleCreate = async () => {
        if (!newMessage.trim()) return;
        try {
            setCreating(true);
            await api.createPortalQRCode({ prefilled_message: newMessage });
            setSuccess('تم إنشاء رمز QR بنجاح');
            setCreateOpen(false);
            setNewMessage('');
            loadQRCodes();
        } catch (err) {
            setError(err.message || 'فشل إنشاء رمز QR');
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (qrCodeId) => {
        if (!window.confirm('هل أنت متأكد من حذف رمز QR؟')) return;
        try {
            await api.deletePortalQRCode(qrCodeId);
            setSuccess('تم حذف رمز QR');
            loadQRCodes();
        } catch (err) {
            setError(err.message || 'فشل حذف رمز QR');
        }
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!tenant?.phone_number_id) {
        return (
            <Box sx={{ p: 3, textAlign: 'center' }}>
                <Alert severity="warning">يجب إعداد رقم الهاتف (Phone Number ID) أولاً لاستخدام رموز QR</Alert>
            </Box>
        );
    }

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <QrCodeIcon sx={{ fontSize: 32, color: 'secondary.main' }} />
                    <Box>
                        <Typography variant="h5" fontWeight={700}>رموز QR</Typography>
                        <Typography variant="body2" color="text.secondary">إنشاء وإدارة رموز QR لبدء المحادثات</Typography>
                    </Box>
                </Box>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>إنشاء رمز QR</Button>
            </Box>

            <Paper>
                <TableContainer>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>الرسالة المعبأة مسبقاً</TableCell>
                                <TableCell>الرابط المختصر</TableCell>
                                <TableCell>الحالة</TableCell>
                                <TableCell align="center">إجراءات</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {qrCodes.map((qr) => (
                                <TableRow key={qr.id || qr.code}>
                                    <TableCell>{qr.prefilled_message || '-'}</TableCell>
                                    <TableCell>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Typography variant="body2" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {qr.deep_link_url || '-'}
                                            </Typography>
                                            {qr.deep_link_url && (
                                                <IconButton size="small" onClick={() => { navigator.clipboard.writeText(qr.deep_link_url); setSuccess('تم نسخ الرابط'); }}>
                                                    <CopyIcon fontSize="small" />
                                                </IconButton>
                                            )}
                                        </Box>
                                    </TableCell>
                                    <TableCell>
                                        <Chip label="نشط" size="small" color="success" />
                                    </TableCell>
                                    <TableCell align="center">
                                        <IconButton color="error" onClick={() => handleDelete(qr.id || qr.code)}>
                                            <DeleteIcon />
                                        </IconButton>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {qrCodes.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={4} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                        لا توجد رموز QR بعد. أنشئ أول رمز QR للبدء.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>

            <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>إنشاء رمز QR جديد</DialogTitle>
                <DialogContent>
                    <TextField fullWidth multiline rows={3} label="الرسالة المعبأة مسبقاً" value={newMessage}
                        onChange={e => setNewMessage(e.target.value)} sx={{ mt: 2 }}
                        helperText="الرسالة التي ستظهر للمستخدم عند مسح رمز QR" />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCreateOpen(false)}>إلغاء</Button>
                    <Button variant="contained" onClick={handleCreate} disabled={creating || !newMessage.trim()}>
                        {creating ? 'جاري الإنشاء...' : 'إنشاء'}
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

export default TenantQRCodes;
