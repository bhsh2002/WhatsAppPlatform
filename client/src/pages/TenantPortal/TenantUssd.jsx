import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    FormControl,
    InputLabel,
    MenuItem,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from '@mui/material';
import {
    Dialpad as UssdIcon,
    Refresh as RefreshIcon,
    Send as SendIcon,
} from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';

import api from '../../api';
import Select from '../../components/Form/AccessibleSelect';
import { PageTitle } from '../../components/Layout/PageTitle';

const statusPresentation = {
    pending: { label: 'قيد التنفيذ', color: 'warning' },
    completed: { label: 'مكتمل', color: 'success' },
    failed: { label: 'فشل', color: 'error' },
};

const formatDate = value => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ar-LY');
};

const requestKey = () => {
    if (globalThis.crypto?.randomUUID) return `wa-ussd:${globalThis.crypto.randomUUID()}`;
    return `wa-ussd:${Date.now()}:${Math.random().toString(36).slice(2)}`;
};

const TenantUssd = () => {
    const [accounts, setAccounts] = useState([]);
    const [accountId, setAccountId] = useState('');
    const [request, setRequest] = useState('');
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [refreshingId, setRefreshingId] = useState(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const pendingRequestRef = useRef(null);

    const activeAccounts = useMemo(
        () => accounts.filter(account => account.enabled && account.status === 'active'),
        [accounts]
    );

    const loadHistory = useCallback(async ({ silent = false, selectedAccountId = '' } = {}) => {
        try {
            if (!silent) setLoading(true);
            const result = await api.getUssdRequests({
                accountId: selectedAccountId || undefined,
                limit: 100,
            });
            setHistory(result.data || []);
        } catch (loadError) {
            if (!silent) setError(loadError.message || 'تعذر تحميل سجل USSD');
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => {
        let active = true;
        const load = async () => {
            try {
                setLoading(true);
                const accountsResult = await api.getSmsAccounts();
                if (!active) return;
                const loadedAccounts = accountsResult.data || [];
                const preferred = loadedAccounts.find(account => account.is_default && account.enabled && account.status === 'active')
                    || loadedAccounts.find(account => account.enabled && account.status === 'active');
                const historyResult = await api.getUssdRequests({
                    accountId: preferred?.id,
                    limit: 100,
                });
                if (!active) return;
                setAccounts(loadedAccounts);
                setHistory(historyResult.data || []);
                if (preferred) setAccountId(String(preferred.id));
            } catch (loadError) {
                if (active) setError(loadError.message || 'تعذر تحميل وحدة USSD');
            } finally {
                if (active) setLoading(false);
            }
        };
        load();
        return () => { active = false; };
    }, []);

    useEffect(() => {
        const timer = window.setInterval(() => {
            loadHistory({ silent: true, selectedAccountId: accountId });
        }, 5000);
        return () => window.clearInterval(timer);
    }, [accountId, loadHistory]);

    const changeAccount = value => {
        setAccountId(value);
        loadHistory({ selectedAccountId: value });
    };

    const send = async () => {
        const normalizedRequest = request.trim();
        const fingerprint = [accountId, normalizedRequest].join('\u0000');
        if (pendingRequestRef.current?.fingerprint !== fingerprint) {
            pendingRequestRef.current = { fingerprint, key: requestKey() };
        }
        try {
            setSending(true);
            setError('');
            setNotice('');
            const result = await api.sendUssdRequest(accountId, {
                request: normalizedRequest,
            }, pendingRequestRef.current.key);
            pendingRequestRef.current = null;
            setRequest('');
            setNotice(`تم قبول ${result.data?.request_code || 'طلب USSD'} للتنفيذ.`);
            await loadHistory({ selectedAccountId: accountId });
        } catch (sendError) {
            if (!sendError.data?.retry_same_request) pendingRequestRef.current = null;
            setError(sendError.message || 'فشل إرسال طلب USSD');
        } finally {
            setSending(false);
        }
    };

    const refresh = async item => {
        try {
            setRefreshingId(item.id);
            setError('');
            await api.refreshUssdRequest(item.sms_account_id, item.gateway_ussd_id);
            await loadHistory({ selectedAccountId: accountId });
        } catch (refreshError) {
            setError(refreshError.message || 'تعذر تحديث نتيجة USSD');
        } finally {
            setRefreshingId(null);
        }
    };

    if (loading && accounts.length === 0) {
        return <Box textAlign="center" py={10}><CircularProgress /></Box>;
    }

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
            <PageTitle>USSD</PageTitle>
            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                <UssdIcon color="primary" />
                <Typography variant="h5" fontWeight={800}>تنفيذ ومتابعة طلبات USSD</Typography>
            </Stack>
            <Typography color="text.secondary" mb={3}>
                اختر حساب SMS وأرسل رمز USSD. تظهر النتيجة تلقائيًا عند اكتمال التنفيذ.
            </Typography>

            {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
            {notice && <Alert severity="success" onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>}

            {activeAccounts.length === 0 ? (
                <Alert severity="warning" action={(
                    <Button component={RouterLink} to="/portal/integrations/sms" color="inherit">
                        حسابات SMS
                    </Button>
                )}>
                    يلزم ربط حساب SMS مفعّل وسليم قبل استخدام USSD.
                </Alert>
            ) : (
                <Card variant="outlined" sx={{ mb: 3 }}>
                    <CardContent>
                        <Stack spacing={2}>
                            <FormControl fullWidth>
                                <InputLabel id="ussd-account-label">حساب SMS</InputLabel>
                                <Select
                                    labelId="ussd-account-label"
                                    label="حساب SMS"
                                    value={accountId}
                                    onChange={event => changeAccount(event.target.value)}
                                >
                                    {activeAccounts.map(account => (
                                        <MenuItem key={account.id} value={String(account.id)}>{account.name}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                                <TextField
                                    fullWidth
                                    label="رمز USSD"
                                    value={request}
                                    onChange={event => setRequest(event.target.value)}
                                    placeholder="*121#"
                                    inputProps={{ maxLength: 182, dir: 'ltr' }}
                                    helperText="يجب أن يبدأ بـ * أو # وينتهي بـ #"
                                />
                                <Button
                                    variant="contained"
                                    startIcon={sending ? <CircularProgress size={18} color="inherit" /> : <SendIcon />}
                                    onClick={send}
                                    disabled={sending || !accountId || !/^[*#][0-9*#+]{0,180}#$/.test(request.trim())}
                                    sx={{ minWidth: 170 }}
                                >
                                    تنفيذ الطلب
                                </Button>
                            </Stack>
                        </Stack>
                    </CardContent>
                </Card>
            )}

            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                <Typography variant="h6" fontWeight={750}>السجل</Typography>
                <Button startIcon={<RefreshIcon />} onClick={() => loadHistory({ selectedAccountId: accountId })}>
                    تحديث
                </Button>
            </Stack>
            <TableContainer component={Card} variant="outlined">
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>الحالة</TableCell>
                            <TableCell>الحساب</TableCell>
                            <TableCell>الطلب</TableCell>
                            <TableCell>النتيجة</TableCell>
                            <TableCell>وقت الإرسال</TableCell>
                            <TableCell align="center">إجراء</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {history.length === 0 ? (
                            <TableRow><TableCell colSpan={6} align="center" sx={{ py: 6 }}>لا توجد طلبات USSD بعد.</TableCell></TableRow>
                        ) : history.map(item => {
                            const presentation = statusPresentation[item.status] || { label: item.status, color: 'default' };
                            return (
                                <TableRow key={item.id} hover>
                                    <TableCell><Chip size="small" label={presentation.label} color={presentation.color} /></TableCell>
                                    <TableCell>{item.sms_account_name}</TableCell>
                                    <TableCell sx={{ direction: 'ltr', fontFamily: 'monospace', fontWeight: 700 }}>{item.request_code}</TableCell>
                                    <TableCell sx={{ whiteSpace: 'pre-wrap', minWidth: 220 }}>{item.response_text || '—'}</TableCell>
                                    <TableCell>{formatDate(item.sent_at || item.created_at)}</TableCell>
                                    <TableCell align="center">
                                        <Button
                                            size="small"
                                            startIcon={refreshingId === item.id ? <CircularProgress size={16} /> : <RefreshIcon />}
                                            onClick={() => refresh(item)}
                                            disabled={refreshingId === item.id}
                                        >
                                            تحديث
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};

export default TenantUssd;
