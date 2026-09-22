import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, Card, CardActions, CardContent, Chip,
    CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
    FormControlLabel, Grid, MenuItem, Paper, Stack, Switch, TextField, Typography,
} from '@mui/material';
import {
    Add as AddIcon, CheckCircle as CheckIcon, Devices as DevicesIcon,
    HealthAndSafety as HealthIcon, QueryStats as StatsIcon,
    SimCard as SimCardIcon, Sms as SmsIcon,
} from '@mui/icons-material';

import api from '../../api';
import { PageTitle } from '../../components/Layout/PageTitle';
import {
    canRequestSmsStats,
    isManagedSmsAccount,
    managedSmsResources,
    normalizeSmsSummary,
    smsStatusPresentation,
} from './smsAccountPresentation';

const emptyForm = {
    name: '',
    base_url: '',
    api_key: '',
    default_devices: '',
    default_sim_slot: '',
    enabled: true,
    is_default: false,
};

const isoDate = (offsetDays = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    return date.toISOString().slice(0, 10);
};

const RANGE_OPTIONS = [
    ['today', 'اليوم'],
    ['7d', 'آخر 7 أيام'],
    ['30d', 'آخر 30 يومًا'],
    ['custom', 'فترة مخصصة'],
];

const STAT_CARDS = [
    ['total_outgoing', 'الرسائل الصادرة', 'primary.main'],
    ['delivered', 'تم التسليم', 'success.main'],
    ['sent', 'أُرسلت', 'info.main'],
    ['pending', 'قيد الإرسال', 'warning.main'],
    ['failed', 'فشلت', 'error.main'],
    ['canceled', 'ملغاة', 'text.secondary'],
    ['received', 'الرسائل الواردة', 'secondary.main'],
];

const formatDateTime = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ar-LY');
};

const ManagedAccountDetails = ({ account }) => {
    const resources = managedSmsResources(account);
    return (
        <Stack spacing={1.5} mt={2}>
            <Alert severity="info" icon={false}>
                تدير Savana إعدادات الاتصال لهذا الحساب. يمكنك متابعة حالته واستخدامه دون التعامل مع مفاتيح أو معرّفات تقنية.
            </Alert>
            {resources.devices.length > 0 ? resources.devices.map((device, index) => (
                <Paper key={`${device.name}-${index}`} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                        <Stack direction="row" alignItems="center" gap={1} minWidth={0}>
                            <DevicesIcon color="action" />
                            <Box minWidth={0}>
                                <Typography fontWeight={700} noWrap>{device.name}</Typography>
                                {device.model && <Typography variant="caption" color="text.secondary">{device.model}</Typography>}
                            </Box>
                        </Stack>
                        <Chip size="small" label={device.status.label} color={device.status.color} variant="outlined" />
                    </Stack>
                </Paper>
            )) : (
                <Typography variant="body2" color="text.secondary">جهاز SMS المُدار قيد التجهيز.</Typography>
            )}
            {resources.sim && (
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Stack direction="row" alignItems="center" gap={1}>
                        <SimCardIcon color="action" />
                        <Box>
                            <Typography fontWeight={700}>{resources.sim.name}</Typography>
                            <Typography variant="body2" color="text.secondary">
                                {[resources.sim.carrier, resources.sim.number].filter(Boolean).join(' • ')}
                            </Typography>
                        </Box>
                    </Stack>
                </Paper>
            )}
        </Stack>
    );
};

const TenantSmsAccounts = () => {
    const [accounts, setAccounts] = useState([]);
    const [manualConfigurationAllowed, setManualConfigurationAllowed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [testAccount, setTestAccount] = useState(null);
    const [testForm, setTestForm] = useState({ recipient: '', message: 'رسالة اختبار من Wa Savana' });
    const pendingTestRequestRef = useRef(null);
    const [stats, setStats] = useState(null);
    const [statsLoading, setStatsLoading] = useState(true);
    const [statsError, setStatsError] = useState('');
    const [accountFilter, setAccountFilter] = useState('all');
    const [range, setRange] = useState('7d');
    const [customFrom, setCustomFrom] = useState(isoDate(-6));
    const [customTo, setCustomTo] = useState(isoDate());

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const result = await api.getSmsAccounts();
            setAccounts(result.data || []);
            setManualConfigurationAllowed(Boolean(result.manual_configuration_allowed));
        } catch (loadError) {
            setError(loadError.message || 'تعذر تحميل حسابات SMS');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (accountFilter !== 'all' && !accounts.some(account => String(account.id) === String(accountFilter))) {
            setAccountFilter('all');
        }
    }, [accountFilter, accounts]);
    useEffect(() => {
        let cancelled = false;
        if (!canRequestSmsStats({ range, from: customFrom, to: customTo })) {
            setStats(null);
            setStatsLoading(false);
            setStatsError('تأكد من اختيار تاريخ بداية يسبق تاريخ النهاية.');
            return () => { cancelled = true; };
        }
        setStatsLoading(true);
        setStatsError('');
        api.getSmsStats({
            accountId: accountFilter,
            range,
            ...(range === 'custom' ? { from: customFrom, to: customTo } : {}),
            groupBy: 'day',
        }).then(result => {
            if (!cancelled) setStats(result?.data || result || null);
        }).catch(statsLoadError => {
            if (!cancelled) {
                setStats(null);
                setStatsError(statsLoadError.message || 'تعذر تحميل إحصاءات SMS');
            }
        }).finally(() => {
            if (!cancelled) setStatsLoading(false);
        });
        return () => { cancelled = true; };
    }, [accountFilter, customFrom, customTo, range]);

    const summary = useMemo(() => normalizeSmsSummary(stats?.summary), [stats]);

    const openCreate = () => {
        setEditing(null);
        setForm({ ...emptyForm, is_default: accounts.length === 0 });
        setError('');
        setDialogOpen(true);
    };

    const openEdit = account => {
        if (isManagedSmsAccount(account)) return;
        setEditing(account);
        setForm({
            name: account.name,
            base_url: account.base_url,
            api_key: '',
            default_devices: (account.default_devices || []).join(', '),
            default_sim_slot: account.default_sim_slot ?? '',
            enabled: account.enabled,
            is_default: account.is_default,
        });
        setError('');
        setDialogOpen(true);
    };

    const save = async () => {
        try {
            setSaving(true);
            setError('');
            const payload = {
                ...form,
                default_devices: form.default_devices.split(',').map(value => value.trim()).filter(Boolean),
                default_sim_slot: form.default_sim_slot === '' ? null : Number(form.default_sim_slot),
            };
            if (!payload.api_key) delete payload.api_key;
            if (editing) await api.updateSmsAccount(editing.id, payload);
            else await api.createSmsAccount(payload);
            setDialogOpen(false);
            setNotice(editing ? 'تم تحديث حساب SMS والتحقق من الاتصال.' : 'تم ربط حساب SMS بنجاح.');
            await load();
        } catch (saveError) {
            setError(saveError.message || 'فشل حفظ حساب SMS');
        } finally {
            setSaving(false);
        }
    };

    const checkHealth = async account => {
        if (isManagedSmsAccount(account)) return;
        try {
            setError('');
            await api.checkSmsAccount(account.id);
            setNotice(`حساب ${account.name} متصل ويعمل.`);
            await load();
        } catch (healthError) {
            setError(healthError.message || 'فشل فحص الاتصال');
            await load();
        }
    };

    const disable = async account => {
        if (isManagedSmsAccount(account)) return;
        if (!window.confirm(`تعطيل حساب SMS «${account.name}»؟ ستبقى الرسائل السابقة محفوظة.`)) return;
        try {
            await api.disableSmsAccount(account.id);
            setNotice('تم تعطيل الحساب مع الاحتفاظ بالسجل.');
            await load();
        } catch (disableError) {
            setError(disableError.message || 'فشل تعطيل الحساب');
        }
    };

    const sendTest = async () => {
        if (!testAccount || isManagedSmsAccount(testAccount)) return;
        const fingerprint = `${testAccount.id}\u0000${testForm.recipient.trim()}\u0000${testForm.message}`;
        if (pendingTestRequestRef.current?.fingerprint !== fingerprint) {
            pendingTestRequestRef.current = {
                fingerprint,
                key: `wa-test:${crypto.randomUUID()}`,
            };
        }
        try {
            setSaving(true);
            setError('');
            await api.testSmsAccount(
                testAccount.id,
                testForm,
                pendingTestRequestRef.current.key,
            );
            pendingTestRequestRef.current = null;
            setTestAccount(null);
            setNotice('قُبلت رسالة الاختبار ويمكن متابعة حالتها من صندوق الوارد.');
        } catch (testError) {
            if (!testError.data?.retry_same_request) pendingTestRequestRef.current = null;
            setError(testError.message || 'فشل إرسال رسالة الاختبار');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2} mb={3}>
                <Box>
                    <PageTitle fontWeight={800}>حسابات SMS</PageTitle>
                    <Typography color="text.secondary">
                        تابع الحسابات والأجهزة والإرسال من مكان واحد. تتولى Savana إعداد الحسابات المُدارة وحمايتها.
                    </Typography>
                </Box>
                {manualConfigurationAllowed && (
                    <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>إضافة بوابة يدوية</Button>
                )}
            </Stack>

            {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
            {notice && <Alert severity="success" onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>}

            <Card variant="outlined" sx={{ mb: 3 }}>
                <CardContent>
                    <Stack direction="row" alignItems="center" gap={1} mb={2}>
                        <StatsIcon color="primary" />
                        <Typography component="h2" variant="h6" fontWeight={800}>إحصاءات SMS</Typography>
                    </Stack>
                    <Grid container spacing={1.5} alignItems="center">
                        <Grid item xs={12} md={4}>
                            <TextField select fullWidth size="small" label="الحساب" value={accountFilter} onChange={event => setAccountFilter(event.target.value)}>
                                <MenuItem value="all">كل الحسابات</MenuItem>
                                {accounts.map(account => <MenuItem key={account.id} value={String(account.id)}>{account.name}</MenuItem>)}
                            </TextField>
                        </Grid>
                        <Grid item xs={12} md={4}>
                            <TextField select fullWidth size="small" label="الفترة" value={range} onChange={event => setRange(event.target.value)}>
                                {RANGE_OPTIONS.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                            </TextField>
                        </Grid>
                        {range === 'custom' && (
                            <>
                                <Grid item xs={12} sm={6} md={2}>
                                    <TextField fullWidth size="small" type="date" label="من" value={customFrom} onChange={event => setCustomFrom(event.target.value)} InputLabelProps={{ shrink: true }} />
                                </Grid>
                                <Grid item xs={12} sm={6} md={2}>
                                    <TextField fullWidth size="small" type="date" label="إلى" value={customTo} onChange={event => setCustomTo(event.target.value)} InputLabelProps={{ shrink: true }} />
                                </Grid>
                            </>
                        )}
                    </Grid>
                    {statsError && <Alert severity="warning" sx={{ mt: 2 }}>{statsError}</Alert>}
                    {stats?.partial && <Alert severity="warning" sx={{ mt: 2 }}>بعض الحسابات لم تُرجع إحصاءاتها؛ الأرقام تشمل النتائج المتاحة فقط.</Alert>}
                    {statsLoading ? (
                        <Box textAlign="center" py={4}><CircularProgress size={28} /></Box>
                    ) : stats && (
                        <>
                            {stats.range?.from && stats.range?.to && (
                                <Typography variant="caption" color="text.secondary" display="block" mt={2}>
                                    الفترة: {stats.range.from} — {stats.range.to}{stats.range.timezone ? ` (${stats.range.timezone})` : ''}
                                </Typography>
                            )}
                            {stats.summary ? (
                                <Grid container spacing={1.5} mt={0.5}>
                                    {STAT_CARDS.map(([key, label, color]) => (
                                        <Grid item xs={6} sm={4} lg key={key}>
                                            <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
                                                <Typography variant="h5" fontWeight={800} color={color}>{summary[key].toLocaleString('ar-LY')}</Typography>
                                                <Typography variant="caption" color="text.secondary">{label}</Typography>
                                            </Paper>
                                        </Grid>
                                    ))}
                                </Grid>
                            ) : (
                                <Alert severity="info" sx={{ mt: 2 }}>
                                    لا تتوفر إحصاءات من أي حساب في الفترة المختارة حاليًا.
                                </Alert>
                            )}
                            {accountFilter === 'all' && Array.isArray(stats.accounts) && stats.accounts.length > 0 && (
                                <Box mt={2.5}>
                                    <Typography fontWeight={800} mb={1}>حسب الحساب</Typography>
                                    <Grid container spacing={1.5}>
                                        {stats.accounts.map(accountStats => {
                                            const accountSummary = normalizeSmsSummary(accountStats.summary);
                                            return (
                                                <Grid item xs={12} md={6} key={accountStats.account_id || accountStats.name}>
                                                    <Paper variant="outlined" sx={{ p: 1.5 }}>
                                                        <Typography fontWeight={750}>{accountStats.name || 'حساب SMS'}</Typography>
                                                        {accountStats.error ? (
                                                            <Typography variant="body2" color="warning.main" mt={0.5}>تعذر تحميل إحصاءات هذا الحساب.</Typography>
                                                        ) : (
                                                            <Typography variant="body2" color="text.secondary" mt={0.5}>
                                                                صادر: {accountSummary.total_outgoing.toLocaleString('ar-LY')}
                                                                {' • '}تم التسليم: {accountSummary.delivered.toLocaleString('ar-LY')}
                                                                {' • '}فشل: {accountSummary.failed.toLocaleString('ar-LY')}
                                                                {' • '}وارد: {accountSummary.received.toLocaleString('ar-LY')}
                                                            </Typography>
                                                        )}
                                                    </Paper>
                                                </Grid>
                                            );
                                        })}
                                    </Grid>
                                </Box>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>

            {loading ? (
                <Box textAlign="center" py={8}><CircularProgress /></Box>
            ) : accounts.length === 0 ? (
                <Card variant="outlined"><CardContent sx={{ textAlign: 'center', py: 7 }}>
                    <SmsIcon sx={{ fontSize: 64, color: 'text.disabled' }} />
                    <Typography variant="h6" mt={1}>لا توجد حسابات SMS مرتبطة</Typography>
                    <Typography color="text.secondary" mb={manualConfigurationAllowed ? 2 : 0}>
                        ستظهر الحسابات هنا تلقائيًا بعد أن تربط الإدارة جهاز SMS بحسابك.
                    </Typography>
                    {manualConfigurationAllowed && <Button variant="contained" onClick={openCreate}>إضافة بوابة يدوية</Button>}
                </CardContent></Card>
            ) : (
                <Grid container spacing={2}>
                    {accounts.map(account => {
                        const managed = isManagedSmsAccount(account);
                        const status = smsStatusPresentation(account.status);
                        return (
                            <Grid item xs={12} md={6} key={account.id}>
                                <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                                    <CardContent sx={{ flex: 1 }}>
                                        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1}>
                                            <Stack direction="row" alignItems="center" gap={1} minWidth={0}>
                                                <SmsIcon color="primary" />
                                                <Box minWidth={0}>
                                                    <Typography variant="h6" fontWeight={750} noWrap>{account.name}</Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {managed || !manualConfigurationAllowed ? 'حساب تديره Savana' : 'بوابة مرتبطة يدويًا'}
                                                    </Typography>
                                                </Box>
                                            </Stack>
                                            <Stack direction="row" gap={0.75} flexWrap="wrap" justifyContent="flex-end" useFlexGap>
                                                {account.is_default && <Chip icon={<CheckIcon />} label="افتراضي" color="primary" size="small" />}
                                                <Chip label={status.label} color={status.color} size="small" />
                                            </Stack>
                                        </Stack>
                                        {managed ? <ManagedAccountDetails account={account} /> : manualConfigurationAllowed ? (
                                            <>
                                                <Typography variant="body2" color="text.secondary" mt={2} sx={{ wordBreak: 'break-all' }}>{account.base_url}</Typography>
                                                <Typography variant="body2" mt={1}>
                                                    الأجهزة: {(account.default_devices || []).join(', ') || 'الجهاز الأساسي'}
                                                    {account.default_sim_slot != null ? ` • SIM ${account.default_sim_slot}` : ''}
                                                </Typography>
                                            </>
                                        ) : (
                                            <Alert severity="info" icon={false} sx={{ mt: 2 }}>
                                                تتولى Savana إعداد الاتصال والتوجيه لهذا الحساب؛ لا تحتاج إلى مفاتيح أو معرّفات أجهزة.
                                            </Alert>
                                        )}
                                        {account.last_health_at && <Typography variant="caption" color="text.secondary" display="block" mt={1.5}>آخر فحص: {formatDateTime(account.last_health_at)}</Typography>}
                                        {account.last_error && <Alert severity="error" sx={{ mt: 2 }}>{managed ? 'الخدمة تحتاج متابعة من فريق Savana.' : account.last_error}</Alert>}
                                    </CardContent>
                                    {!managed && manualConfigurationAllowed && (
                                        <CardActions sx={{ px: 2, pb: 2, flexWrap: 'wrap' }}>
                                            <Button onClick={() => openEdit(account)}>تعديل</Button>
                                            <Button startIcon={<HealthIcon />} onClick={() => checkHealth(account)}>فحص</Button>
                                            <Button onClick={() => setTestAccount(account)} disabled={!account.enabled}>اختبار إرسال</Button>
                                            <Button color="error" onClick={() => disable(account)} disabled={!account.enabled}>تعطيل</Button>
                                        </CardActions>
                                    )}
                                </Card>
                            </Grid>
                        );
                    })}
                </Grid>
            )}

            <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm" aria-labelledby="sms-account-dialog-title">
                <DialogTitle id="sms-account-dialog-title">{editing ? 'تعديل بوابة SMS اليدوية' : 'إضافة بوابة SMS يدوية'}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} mt={1}>
                        <TextField label="اسم الحساب" value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} required />
                        <TextField label="رابط بوابة SMS (HTTPS)" value={form.base_url} onChange={event => setForm(previous => ({ ...previous, base_url: event.target.value }))} placeholder="https://sms.example.com" required />
                        <TextField label={editing ? 'مفتاح API جديد (اتركه فارغًا للإبقاء على الحالي)' : 'مفتاح API'} type="password" value={form.api_key} onChange={event => setForm(previous => ({ ...previous, api_key: event.target.value }))} required={!editing} />
                        <TextField label="معرّفات الأجهزة الافتراضية" helperText="افصل بين الأجهزة بفاصلة، أو اتركها فارغة لاستخدام الجهاز الأساسي." value={form.default_devices} onChange={event => setForm(previous => ({ ...previous, default_devices: event.target.value }))} />
                        <TextField label="منفذ SIM الافتراضي" type="number" inputProps={{ min: 0 }} value={form.default_sim_slot} onChange={event => setForm(previous => ({ ...previous, default_sim_slot: event.target.value }))} />
                        <FormControlLabel control={<Switch checked={form.enabled} onChange={event => setForm(previous => ({ ...previous, enabled: event.target.checked, is_default: event.target.checked ? previous.is_default : false }))} />} label="مفعّل" />
                        <FormControlLabel control={<Switch checked={form.is_default} disabled={!form.enabled} onChange={event => setForm(previous => ({ ...previous, is_default: event.target.checked }))} />} label="الحساب الافتراضي للإرسال" />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={saving}>إلغاء</Button>
                    <Button variant="contained" onClick={save} disabled={saving || !form.name || !form.base_url || (!editing && !form.api_key)}>{saving ? <CircularProgress size={20} /> : 'حفظ والتحقق'}</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={Boolean(testAccount)} onClose={() => !saving && setTestAccount(null)} fullWidth maxWidth="sm" aria-labelledby="sms-test-dialog-title">
                <DialogTitle id="sms-test-dialog-title">اختبار {testAccount?.name}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} mt={1}>
                        <TextField label="رقم المستلم مع رمز الدولة" value={testForm.recipient} onChange={event => setTestForm(previous => ({ ...previous, recipient: event.target.value }))} required />
                        <TextField label="نص الرسالة" multiline minRows={3} value={testForm.message} onChange={event => setTestForm(previous => ({ ...previous, message: event.target.value }))} required />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setTestAccount(null)} disabled={saving}>إلغاء</Button>
                    <Button variant="contained" onClick={sendTest} disabled={saving || !testForm.recipient || !testForm.message}>إرسال</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default TenantSmsAccounts;
