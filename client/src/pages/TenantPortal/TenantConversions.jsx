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

const parseMetaResponse = (value) => {
    if (!value) return null;
    try {
        return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        return null;
    }
};

const TenantConversions = () => {
    const { tenant } = useAuth();
    const [events, setEvents] = useState([]);
    const [stats, setStats] = useState(null);
    const [datasetId, setDatasetId] = useState(tenant?.dataset_id || null);
    const [datasetInput, setDatasetInput] = useState(tenant?.dataset_id || '');
    const [wabaId, setWabaId] = useState(tenant?.waba_id || null);
    const [datasets, setDatasets] = useState([]);
    const [datasetsLoading, setDatasetsLoading] = useState(false);
    const [datasetSaving, setDatasetSaving] = useState(false);
    const [eventsApiReady, setEventsApiReady] = useState(!!tenant?.dataset_id);
    const [whatsappTokenPresent, setWhatsappTokenPresent] = useState(false);
    const [lastSuccess, setLastSuccess] = useState(null);
    const [lastFailure, setLastFailure] = useState(null);
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
            setDatasetId(data.dataset_id || tenant?.dataset_id || null);
            setDatasetInput(data.dataset_id || tenant?.dataset_id || '');
            setWabaId(data.waba_id || tenant?.waba_id || null);
            setEventsApiReady(!!data.events_api_ready);
            setWhatsappTokenPresent(!!data.whatsapp_token_present);
            setLastSuccess(data.last_success || null);
            setLastFailure(data.last_failure || null);
        } catch (err) {
            setError(err.message || 'فشل تحميل البيانات');
        } finally {
            setLoading(false);
        }
    }, [tenant?.dataset_id, tenant?.waba_id]);

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
            const result = await api.logPortalConversionEvent(payload);
            setSuccess(result.sent_to_meta
                ? `تم إرسال الحدث إلى Meta${result.fbtrace_id ? ` (${result.fbtrace_id})` : ''}`
                : (result.note || 'تم حفظ الحدث محلياً')
            );
            setLogOpen(false);
            setForm({ event_name: 'Purchase', phone: '', value: '', currency: 'LYD' });
            loadData();
        } catch (err) {
            setError(err.message || 'فشل تسجيل الحدث');
        } finally {
            setLogging(false);
        }
    };

    const handleLoadDatasets = async () => {
        try {
            setDatasetsLoading(true);
            setError('');
            const data = await api.getPortalConversionDatasets();
            setDatasets(data.datasets || []);
            if (!datasetInput && data.datasets?.[0]?.id) {
                setDatasetInput(data.datasets[0].id);
            }
            if (!data.datasets?.length) {
                setSuccess('لم ترجع Meta أي Dataset لهذا WABA. يمكنك إدخال Dataset ID يدويا.');
            }
        } catch (err) {
            setError(err.message || 'فشل جلب Datasets من Meta. يمكنك إدخال Dataset ID يدويا.');
        } finally {
            setDatasetsLoading(false);
        }
    };

    const handleSaveDataset = async () => {
        try {
            setDatasetSaving(true);
            setError('');
            const data = await api.updatePortalMetaSettings({ dataset_id: datasetInput.trim() || null });
            setDatasetId(data.dataset_id || null);
            setSuccess(data.dataset_id ? 'تم حفظ Dataset ID' : 'تم مسح Dataset ID');
            await loadData();
        } catch (err) {
            setError(err.message || 'فشل حفظ Dataset ID');
        } finally {
            setDatasetSaving(false);
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
        { label: 'محلية فقط', value: stats?.localOnlyEvents || 0, color: '#607d8b' },
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
                    <Grid size={{ xs: 12, sm: 6, md: 3 }} key={i}>
                        <Card sx={{ bgcolor: card.color + '10', border: `1px solid ${card.color}30` }}>
                            <CardContent sx={{ textAlign: 'center' }}>
                                <Typography variant="h3" fontWeight={700} sx={{ color: card.color }}>{card.value}</Typography>
                                <Typography variant="body2" color="text.secondary">{card.label}</Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                ))}
            </Grid>

            <Alert severity={eventsApiReady ? 'success' : 'warning'} sx={{ mb: 3 }}>
                <Typography variant="body2" fontWeight={600}>
                    حالة WhatsApp Events API: {eventsApiReady ? 'جاهز للإرسال إلى Meta' : 'غير مكتمل'}
                </Typography>
                <Typography variant="caption" component="div">
                    Dataset ID: {datasetId || 'غير محدد'}
                </Typography>
                <Typography variant="caption" component="div">
                    WhatsApp token: {whatsappTokenPresent ? 'موجود' : 'غير موجود'}
                </Typography>
                <Typography variant="caption" component="div">
                    آخر نجاح: {lastSuccess?.created_at ? new Date(lastSuccess.created_at).toLocaleString('ar-LY') : 'لا يوجد'}
                    {lastSuccess?.fbtrace_id ? ` | fbtrace_id: ${lastSuccess.fbtrace_id}` : ''}
                </Typography>
                <Typography variant="caption" component="div">
                    آخر فشل: {lastFailure?.created_at ? new Date(lastFailure.created_at).toLocaleString('ar-LY') : 'لا يوجد'}
                    {lastFailure?.error_message ? ` | ${lastFailure.error_message}` : ''}
                    {lastFailure?.fbtrace_id ? ` | fbtrace_id: ${lastFailure.fbtrace_id}` : ''}
                </Typography>
            </Alert>

            <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6" fontWeight={700} gutterBottom>
                    إعداد Dataset ID
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    WABA ID: {wabaId || 'غير محدد'} — يجب حفظ Dataset ID ثم إرسال حدث ناجح حتى تصبح WhatsApp Events API جاهزة في Meta Review.
                </Typography>
                <Grid container spacing={2} alignItems="center">
                    <Grid size={{ xs: 12, md: 5 }}>
                        <TextField
                            fullWidth
                            size="small"
                            label="Dataset ID"
                            value={datasetInput}
                            onChange={e => setDatasetInput(e.target.value)}
                            placeholder="أدخل Dataset ID أو اختره من القائمة"
                        />
                    </Grid>
                    <Grid size={{ xs: 12, md: 3 }}>
                        <TextField
                            fullWidth
                            select
                            size="small"
                            label="Datasets من Meta"
                            value=""
                            disabled={!datasets.length}
                            onChange={e => setDatasetInput(e.target.value)}
                        >
                            <MenuItem value="" disabled>{datasets.length ? 'اختر Dataset' : 'لا توجد بيانات محملة'}</MenuItem>
                            {datasets.map(dataset => (
                                <MenuItem key={dataset.id} value={dataset.id}>
                                    {dataset.name || dataset.id}
                                </MenuItem>
                            ))}
                        </TextField>
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            <Button
                                variant="outlined"
                                onClick={handleLoadDatasets}
                                disabled={datasetsLoading || !wabaId}
                            >
                                {datasetsLoading ? <CircularProgress size={18} /> : 'جلب Datasets'}
                            </Button>
                            <Button
                                variant="contained"
                                onClick={handleSaveDataset}
                                disabled={datasetSaving}
                            >
                                {datasetSaving ? <CircularProgress size={18} color="inherit" /> : 'حفظ Dataset ID'}
                            </Button>
                        </Box>
                    </Grid>
                </Grid>
                {datasetId && (
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
                        Dataset الحالي المحفوظ: {datasetId}
                    </Typography>
                )}
            </Paper>

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
                                <TableCell>Meta</TableCell>
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
                                    <TableCell sx={{ maxWidth: 260 }}>
                                        {(() => {
                                            const meta = parseMetaResponse(event.meta_response);
                                            const text = event.status === 'sent'
                                                ? (meta?.fbtrace_id || meta?.events_received ? `events: ${meta?.events_received ?? '-'}${meta?.fbtrace_id ? ` | ${meta.fbtrace_id}` : ''}` : '-')
                                                : (meta?.error?.message || meta?.error || '-');
                                            return (
                                                <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                                                    {text}
                                                </Typography>
                                            );
                                        })()}
                                    </TableCell>
                                    <TableCell>{new Date(event.created_at).toLocaleString('ar-LY')}</TableCell>
                                </TableRow>
                            ))}
                            {events.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>
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
                            <TextField fullWidth label={eventsApiReady ? 'رقم الهاتف (مطلوب للإرسال إلى Meta)' : 'رقم الهاتف (اختياري)'} value={form.phone}
                                onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="218xxxxxxxxx"
                                helperText={eventsApiReady ? 'لا يتم إرسال الحدث إلى Meta بدون user_data قابلة للمطابقة.' : ''} />
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
                    <Button variant="contained" onClick={handleLog} disabled={logging || (eventsApiReady && !form.phone.trim())}>
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
