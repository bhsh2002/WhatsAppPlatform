import React, { useState, useEffect } from 'react';
import {
    Box,
    Paper,
    Typography,
    Button,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    FormControl,
    Select,
    MenuItem,
    CircularProgress,
    IconButton,
    InputLabel,
    Collapse,
    Alert,
    Card,
    CardContent,
    Grid
} from '@mui/material';
import {
    Refresh as RefreshIcon,
    Replay as ReplayIcon,
    Delete as DeleteIcon,
    ExpandMore as ExpandMoreIcon,
    ExpandLess as ExpandLessIcon,
    Warning as WarningIcon,
    CheckCircle as CheckCircleIcon,
    Error as ErrorIcon,
    HourglassEmpty as HourglassEmptyIcon
} from '@mui/icons-material';
import api from '../../api';

const WebhookFailures = () => {
    const [failures, setFailures] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [filterTenant, setFilterTenant] = useState('');
    const [filterType, setFilterType] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [tenants, setTenants] = useState([]);
    const [eventTypes, setEventTypes] = useState([]);
    const [expandedRow, setExpandedRow] = useState(null);
    const [actionLoading, setActionLoading] = useState({});
    const [message, setMessage] = useState(null);

    const fetchData = async () => {
        try {
            setLoading(true);
            const params = { page, limit: 20 };
            if (filterTenant) params.tenant_id = filterTenant;
            if (filterType) params.event_type = filterType;
            if (filterStatus) params.status = filterStatus;

            const data = await api.getWebhookFailures(params);
            setFailures(data.failures || []);
            setTotal(data.total || 0);
            setTotalPages(data.totalPages || 1);

            const statsData = await api.getWebhookFailureStats();
            setStats(statsData);
        } catch (error) {
            console.error('Failed to fetch failures:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [page, filterTenant, filterType, filterStatus]);

    useEffect(() => {
        api.getWebhookFailures({ limit: 1000 }).then(data => {
            const tSet = new Set();
            const eSet = new Set();
            (data.failures || []).forEach(f => {
                if (f.tenant_name) tSet.add(f.tenant_name);
                if (f.event_type) eSet.add(f.event_type);
            });
            setTenants([...tSet]);
            setEventTypes([...eSet]);
        });
    }, []);

    const handleRetry = async (id) => {
        setActionLoading(prev => ({ ...prev, [id]: true }));
        try {
            await api.retryWebhookFailure(id);
            setMessage({ type: 'success', text: 'تم إعادة المحاولة بنجاح' });
            fetchData();
        } catch (err) {
            setMessage({ type: 'error', text: 'فشلت إعادة المحاولة' });
        } finally {
            setActionLoading(prev => ({ ...prev, [id]: false }));
        }
    };

    const handleDelete = async (id) => {
        setActionLoading(prev => ({ ...prev, [`del-${id}`]: true }));
        try {
            await api.deleteWebhookFailure(id);
            setMessage({ type: 'success', text: 'تم حذف العطل' });
            fetchData();
        } catch (err) {
            setMessage({ type: 'error', text: 'فشل حذف العطل' });
        } finally {
            setActionLoading(prev => ({ ...prev, [`del-${id}`]: false }));
        }
    };

    const handleClearResolved = async () => {
        try {
            const result = await api.clearResolvedFailures();
            setMessage({ type: 'success', text: `تم مسح ${result.deleted} عطل محلول` });
            fetchData();
        } catch (err) {
            setMessage({ type: 'error', text: 'فشل مسح الأعطال' });
        }
    };

    const formatTime = (dateStr) => {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        return d.toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
    };

    const formatPayload = (payloadStr) => {
        try {
            return JSON.stringify(JSON.parse(payloadStr), null, 2);
        } catch {
            return payloadStr;
        }
    };

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h5" fontWeight="bold">
                    ⚠️ أعطال Webhook
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button variant="outlined" startIcon={<DeleteIcon />} onClick={handleClearResolved}>
                        مسح المحلولة
                    </Button>
                    <Button variant="contained" startIcon={<RefreshIcon />} onClick={fetchData}>
                        تحديث
                    </Button>
                </Box>
            </Box>

            {message && (
                <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
                    {message.text}
                </Alert>
            )}

            {stats && (
                <Grid container spacing={2} sx={{ mb: 3 }}>
                    <Grid size={{ xs: 4 }}>
                        <Card>
                            <CardContent sx={{ textAlign: 'center', py: 1 }}>
                                <ErrorIcon color="error" sx={{ fontSize: 30 }} />
                                <Typography variant="h4" fontWeight="bold" color="error.main">
                                    {stats.byStatus?.pending || 0}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">فشل / معلق</Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid size={{ xs: 4 }}>
                        <Card>
                            <CardContent sx={{ textAlign: 'center', py: 1 }}>
                                <HourglassEmptyIcon color="warning" sx={{ fontSize: 30 }} />
                                <Typography variant="h4" fontWeight="bold" color="warning.main">
                                    {stats.byStatus?.resolved || 0}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">تم الحل</Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid size={{ xs: 4 }}>
                        <Card>
                            <CardContent sx={{ textAlign: 'center', py: 1 }}>
                                <CheckCircleIcon color="success" sx={{ fontSize: 30 }} />
                                <Typography variant="h4" fontWeight="bold">
                                    {stats.byStatus?.total || 0}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">الإجمالي</Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>
            )}

            <Paper sx={{ p: 2, mb: 2 }}>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <InputLabel>العميل</InputLabel>
                        <Select value={filterTenant} label="العميل" onChange={e => { setFilterTenant(e.target.value); setPage(1); }}>
                            <MenuItem value="">الكل</MenuItem>
                            {tenants.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <InputLabel>نوع الحدث</InputLabel>
                        <Select value={filterType} label="نوع الحدث" onChange={e => { setFilterType(e.target.value); setPage(1); }}>
                            <MenuItem value="">الكل</MenuItem>
                            {eventTypes.map(e => <MenuItem key={e} value={e}>{e}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 120 }}>
                        <InputLabel>الحالة</InputLabel>
                        <Select value={filterStatus} label="الحالة" onChange={e => { setFilterStatus(e.target.value); setPage(1); }}>
                            <MenuItem value="">الكل</MenuItem>
                            <MenuItem value="pending">معلق</MenuItem>
                            <MenuItem value="resolved">محلول</MenuItem>
                        </Select>
                    </FormControl>
                </Box>
            </Paper>

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>#</TableCell>
                            <TableCell>العميل</TableCell>
                            <TableCell>النوع</TableCell>
                            <TableCell>الخطأ</TableCell>
                            <TableCell>المحاولات</TableCell>
                            <TableCell>الوقت</TableCell>
                            <TableCell>الحالة</TableCell>
                            <TableCell>إجراءات</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={8} align="center" sx={{ py: 3 }}>
                                    <CircularProgress />
                                </TableCell>
                            </TableRow>
                        ) : failures.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} align="center" sx={{ py: 3 }}>
                                    <Typography color="text.secondary">لا توجد أعطال</Typography>
                                </TableCell>
                            </TableRow>
                        ) : (
                            failures.map((f, idx) => (
                                <React.Fragment key={f.id}>
                                    <TableRow hover>
                                        <TableCell>{(page - 1) * 20 + idx + 1}</TableCell>
                                        <TableCell>{f.tenant_name || '—'}</TableCell>
                                        <TableCell><Chip label={f.event_type} size="small" /></TableCell>
                                        <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {f.error_message}
                                        </TableCell>
                                        <TableCell>{f.retry_count}</TableCell>
                                        <TableCell>{formatTime(f.created_at)}</TableCell>
                                        <TableCell>
                                            {f.resolved_at
                                                ? <Chip label="محلول" color="success" size="small" />
                                                : <Chip label="معلق" color="error" size="small" />}
                                        </TableCell>
                                        <TableCell>
                                            {!f.resolved_at && (
                                                <IconButton size="small" onClick={() => handleRetry(f.id)} disabled={actionLoading[f.id]} title="إعادة المحاولة">
                                                    <ReplayIcon fontSize="small" />
                                                </IconButton>
                                            )}
                                            <IconButton size="small" onClick={() => setExpandedRow(expandedRow === f.id ? null : f.id)} title="عرض الحمولة">
                                                {expandedRow === f.id ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                            </IconButton>
                                            <IconButton size="small" onClick={() => handleDelete(f.id)} disabled={actionLoading[`del-${f.id}`]} title="حذف">
                                                <DeleteIcon fontSize="small" color="error" />
                                            </IconButton>
                                        </TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell colSpan={8} sx={{ py: 0 }}>
                                            <Collapse in={expandedRow === f.id}>
                                                <Box sx={{ p: 2, bgcolor: 'grey.50', maxWidth: '100%', overflow: 'auto' }}>
                                                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>الحمولة:</Typography>
                                                    <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 }}>
                                                        {formatPayload(f.payload)}
                                                    </pre>
                                                </Box>
                                            </Collapse>
                                        </TableCell>
                                    </TableRow>
                                </React.Fragment>
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            {totalPages > 1 && (
                <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 2 }}>
                    <Button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>السابق</Button>
                    <Typography sx={{ py: 1 }}>{page} / {totalPages}</Typography>
                    <Button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>التالي</Button>
                </Box>
            )}
        </Box>
    );
};

export default WebhookFailures;