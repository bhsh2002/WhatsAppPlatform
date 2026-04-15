import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Typography, Paper, Grid, Card, CardContent, Button, TextField, Chip,
    CircularProgress, Alert, Snackbar, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem
} from '@mui/material';
import { TrendingUp as TrendingUpIcon, Add as AddIcon, ShoppingCart, PersonAdd, Visibility } from '@mui/icons-material';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';

const eventTypes = [
    { value: 'Purchase', label: 'شراء', icon: <ShoppingCart /> },
    { value: 'AddToCart', label: 'إضافة لعربة التسوق', icon: <ShoppingCart /> },
    { value: 'Lead', label: 'عميل محتمل', icon: <PersonAdd /> },
    { value: 'CompleteRegistration', label: 'إكمال تسجيل', icon: <PersonAdd /> },
    { value: 'InitiateCheckout', label: 'بدء الدفع', icon: <ShoppingCart /> },
    { value: 'Subscribe', label: 'اشتراك', icon: <PersonAdd /> },
    { value: 'ViewContent', label: 'مشاهدة محتوى', icon: <Visibility /> },
];

const TenantConversions = () => {
    const { tenant } = useAuth();
    const [events, setEvents] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [logOpen, setLogOpen] = useState(false);
    const [logging, setLogging] = useState(false);
    const [form, setForm] = useState({
        event_name: 'Purchase', phone: '', value: '', currency: 'LYD'
    });

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const data = await api.getPortalConversionHistory();
            setEvents(data.events || []);
            setStats(data.stats || null);
        } catch (err) {
            setError(err.message || 'فشل تحميل البيانات');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const handleLog = async () => {
        try {
            setLogging(true);
            const payload = {
                event_name: form.event_name,
                phone: form.phone || undefined,
            };
            if (form.value) {
                payload.custom_data = { value: parseFloat(form.value), currency: form.currency };
            }
            await api.logPortalConversionEvent(payload);
            setSuccess('تم تسجيل الحدث بنجاح');
            setLogOpen(false);
            setForm({ event_name: 'Purchase', phone: '', value: '', currency: 'LYD' });
            loadData();
        } catch (err) {
            setError(err.message || 'فشل تسجيل الحدث');
        } finally {
            setLogging(false);
        }
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
                <CircularProgress />
            </Box>
        );
    }

    const statCards = [
        { label: 'إجمالي الأحداث', value: stats?.totalEvents || 0, color: '#2196f3' },
        { label: 'أحداث مُرسلة', value: stats?.sentEvents || 0, color: '#4caf50' },
        { label: 'أحداث فاشلة', value: stats?.failedEvents || 0, color: '#f44336' },
    ];

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'flex-start', md: 'center' }, justifyContent: 'space-between', mb: 3, gap: { xs: 1, md: 0 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <TrendingUpIcon sx={{ fontSize: 32, color: 'secondary.main' }} />
                    <Box>
                        <Typography variant="h5" fontWeight={700}>أحداث التحويل</Typography>
                        <Typography variant="body2" color="text.secondary">تسجيل وتتبع أحداث الأعمال (Conversions API)</Typography>
                    </Box>
                </Box>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => setLogOpen(true)}><Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>تسجيل حدث</Box></Button>
            </Box>

            <Grid container spacing={3} sx={{ mb: 4 }}>
                {statCards.map((card, i) => (
                    <Grid size={{ xs: 12, md: 4 }} key={i}>
                        <Card sx={{ bgcolor: card.color + '10', border: `1px solid ${card.color}30` }}>
                            <CardContent sx={{ textAlign: 'center' }}>
                                <Typography variant="h3" fontWeight={700} sx={{ color: card.color }}>{card.value}</Typography>
                                <Typography variant="body2" color="text.secondary">{card.label}</Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                ))}
            </Grid>

            {stats?.eventBreakdown?.length > 0 && (
                <Paper sx={{ p: 3, mb: 3 }}>
                    <Typography variant="h6" gutterBottom fontWeight={600}>توزيع الأحداث</Typography>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        {stats.eventBreakdown.map((item, i) => (
                            <Chip key={i} label={`${item.event_name}: ${item.count}`} variant="outlined" color="primary" />
                        ))}
                    </Box>
                </Paper>
            )}

            <Paper>
                <TableContainer sx={{ overflowX: 'auto' }}>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>الحدث</TableCell>
                                <TableCell>الهاتف</TableCell>
                                <TableCell>البيانات المخصصة</TableCell>
                                <TableCell>الحالة</TableCell>
                                <TableCell>التاريخ</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {events.map((event) => (
                                <TableRow key={event.id}>
                                    <TableCell>
                                        <Chip label={event.event_name} size="small" color="primary" variant="outlined" />
                                    </TableCell>
                                    <TableCell>{event.phone || '-'}</TableCell>
                                    <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {event.custom_data || '-'}
                                    </TableCell>
                                    <TableCell>
                                        <Chip label={event.status} size="small"
                                            color={event.status === 'sent' ? 'success' : event.status === 'failed' ? 'error' : 'default'} />
                                    </TableCell>
                                    <TableCell>{new Date(event.created_at).toLocaleString('ar-LY')}</TableCell>
                                </TableRow>
                            ))}
                            {events.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                        لا توجد أحداث مسجلة بعد
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>

            <Dialog open={logOpen} onClose={() => setLogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>تسجيل حدث تحويل</DialogTitle>
                <DialogContent>
                    <Grid container spacing={2} sx={{ mt: 1 }}>
                        <Grid size={{ xs: 12 }}>
                            <TextField fullWidth select label="نوع الحدث" value={form.event_name}
                                onChange={e => setForm({ ...form, event_name: e.target.value })}>
                                {eventTypes.map(et => <MenuItem key={et.value} value={et.value}>{et.label}</MenuItem>)}
                            </TextField>
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                            <TextField fullWidth label="رقم الهاتف (اختياري)" value={form.phone}
                                onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="218xxxxxxxxx" />
                        </Grid>
                        <Grid size={{ xs: 8 }}>
                            <TextField fullWidth label="القيمة (اختياري)" value={form.value} type="number"
                                onChange={e => setForm({ ...form, value: e.target.value })} />
                        </Grid>
                        <Grid size={{ xs: 4 }}>
                            <TextField fullWidth select label="العملة" value={form.currency}
                                onChange={e => setForm({ ...form, currency: e.target.value })}>
                                <MenuItem value="LYD">LYD</MenuItem>
                                <MenuItem value="USD">USD</MenuItem>
                                <MenuItem value="EUR">EUR</MenuItem>
                            </TextField>
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setLogOpen(false)}>إلغاء</Button>
                    <Button variant="contained" onClick={handleLog} disabled={logging}>
                        {logging ? 'جاري التسجيل...' : 'تسجيل'}
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

export default TenantConversions;
