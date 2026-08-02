import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Card,
    CardActions,
    CardContent,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    Grid,
    Stack,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import {
    Add as AddIcon,
    CheckCircle as CheckIcon,
    HealthAndSafety as HealthIcon,
    Sms as SmsIcon,
} from '@mui/icons-material';

import api from '../../api';
import { PageTitle } from '../../components/Layout/PageTitle';

const emptyForm = {
    name: '',
    base_url: '',
    api_key: '',
    default_devices: '',
    default_sim_slot: '',
    enabled: true,
    is_default: false,
};

const statusColor = status => ({
    active: 'success',
    pending: 'warning',
    error: 'error',
    disabled: 'default',
}[status] || 'default');

const TenantSmsAccounts = () => {
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [testAccount, setTestAccount] = useState(null);
    const [testForm, setTestForm] = useState({ recipient: '', message: 'رسالة اختبار من Wa Savana' });

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const result = await api.getSmsAccounts();
            setAccounts(result.data || []);
        } catch (loadError) {
            setError(loadError.message || 'تعذر تحميل حسابات SMS');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const openCreate = () => {
        setEditing(null);
        setForm({ ...emptyForm, is_default: accounts.length === 0 });
        setError('');
        setDialogOpen(true);
    };

    const openEdit = account => {
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
        try {
            setSaving(true);
            setError('');
            await api.testSmsAccount(testAccount.id, testForm);
            setTestAccount(null);
            setNotice('قُبلت رسالة الاختبار ويمكن متابعة حالتها من صندوق الوارد.');
        } catch (testError) {
            setError(testError.message || 'فشل إرسال رسالة الاختبار');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
            <PageTitle>حسابات SMS</PageTitle>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2} mb={3}>
                <Box>
                    <Typography variant="h4" fontWeight={800}>حسابات SMS</Typography>
                    <Typography color="text.secondary">
                        اربط عدة حسابات أو بوابات Android واختر الحساب الافتراضي لكل Tenant.
                    </Typography>
                </Box>
                <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
                    إضافة حساب SMS
                </Button>
            </Stack>

            {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
            {notice && <Alert severity="success" onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>}

            {loading ? (
                <Box textAlign="center" py={8}><CircularProgress /></Box>
            ) : accounts.length === 0 ? (
                <Card variant="outlined"><CardContent sx={{ textAlign: 'center', py: 7 }}>
                    <SmsIcon sx={{ fontSize: 64, color: 'text.disabled' }} />
                    <Typography variant="h6" mt={1}>لا توجد حسابات SMS مرتبطة</Typography>
                    <Typography color="text.secondary" mb={2}>أضف أول حساب لتفعيل قناة SMS في الصندوق الموحد.</Typography>
                    <Button variant="contained" onClick={openCreate}>إضافة الحساب الأول</Button>
                </CardContent></Card>
            ) : (
                <Grid container spacing={2}>
                    {accounts.map(account => (
                        <Grid item xs={12} md={6} key={account.id}>
                            <Card variant="outlined" sx={{ height: '100%' }}>
                                <CardContent>
                                    <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                                        <Stack direction="row" alignItems="center" gap={1}>
                                            <SmsIcon color="primary" />
                                            <Typography variant="h6" fontWeight={750}>{account.name}</Typography>
                                        </Stack>
                                        <Stack direction="row" gap={1}>
                                            {account.is_default && <Chip icon={<CheckIcon />} label="افتراضي" color="primary" size="small" />}
                                            <Chip label={account.status} color={statusColor(account.status)} size="small" />
                                        </Stack>
                                    </Stack>
                                    <Typography variant="body2" color="text.secondary" mt={2} sx={{ wordBreak: 'break-all' }}>
                                        {account.base_url}
                                    </Typography>
                                    <Typography variant="body2" mt={1}>
                                        الأجهزة: {(account.default_devices || []).join(', ') || 'الجهاز الأساسي'}
                                        {account.default_sim_slot != null ? ` • SIM ${account.default_sim_slot}` : ''}
                                    </Typography>
                                    {account.last_error && <Alert severity="error" sx={{ mt: 2 }}>{account.last_error}</Alert>}
                                </CardContent>
                                <CardActions sx={{ px: 2, pb: 2, flexWrap: 'wrap' }}>
                                    <Button onClick={() => openEdit(account)}>تعديل</Button>
                                    <Button startIcon={<HealthIcon />} onClick={() => checkHealth(account)}>فحص</Button>
                                    <Button onClick={() => setTestAccount(account)} disabled={!account.enabled}>اختبار إرسال</Button>
                                    <Button color="error" onClick={() => disable(account)} disabled={!account.enabled}>تعطيل</Button>
                                </CardActions>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            )}

            <Dialog
                open={dialogOpen}
                onClose={() => !saving && setDialogOpen(false)}
                fullWidth
                maxWidth="sm"
                aria-labelledby="sms-account-dialog-title"
            >
                <DialogTitle id="sms-account-dialog-title">
                    {editing ? 'تعديل حساب SMS' : 'إضافة حساب SMS'}
                </DialogTitle>
                <DialogContent>
                    <Stack spacing={2} mt={1}>
                        <TextField label="اسم الحساب" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
                        <TextField label="رابط بوابة SMS (HTTPS)" value={form.base_url} onChange={e => setForm(p => ({ ...p, base_url: e.target.value }))} placeholder="https://sms.example.com" required />
                        <TextField label={editing ? 'مفتاح API جديد (اتركه فارغًا للإبقاء على الحالي)' : 'مفتاح API'} type="password" value={form.api_key} onChange={e => setForm(p => ({ ...p, api_key: e.target.value }))} required={!editing} />
                        <TextField label="معرّفات الأجهزة الافتراضية" helperText="افصل بين الأجهزة بفاصلة، أو اتركها فارغة لاستخدام الجهاز الأساسي." value={form.default_devices} onChange={e => setForm(p => ({ ...p, default_devices: e.target.value }))} />
                        <TextField label="منفذ SIM الافتراضي" type="number" inputProps={{ min: 0 }} value={form.default_sim_slot} onChange={e => setForm(p => ({ ...p, default_sim_slot: e.target.value }))} />
                        <FormControlLabel
                            control={<Switch checked={form.enabled} onChange={e => setForm(p => ({
                                ...p,
                                enabled: e.target.checked,
                                is_default: e.target.checked ? p.is_default : false,
                            }))} />}
                            label="مفعّل"
                        />
                        <FormControlLabel
                            control={<Switch checked={form.is_default} disabled={!form.enabled} onChange={e => setForm(p => ({ ...p, is_default: e.target.checked }))} />}
                            label="الحساب الافتراضي للإرسال"
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={saving}>إلغاء</Button>
                    <Button variant="contained" onClick={save} disabled={saving || !form.name || !form.base_url || (!editing && !form.api_key)}>
                        {saving ? <CircularProgress size={20} /> : 'حفظ والتحقق'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={Boolean(testAccount)}
                onClose={() => !saving && setTestAccount(null)}
                fullWidth
                maxWidth="sm"
                aria-labelledby="sms-test-dialog-title"
            >
                <DialogTitle id="sms-test-dialog-title">اختبار {testAccount?.name}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} mt={1}>
                        <TextField label="رقم المستلم مع رمز الدولة" value={testForm.recipient} onChange={e => setTestForm(p => ({ ...p, recipient: e.target.value }))} required />
                        <TextField label="نص الرسالة" multiline minRows={3} value={testForm.message} onChange={e => setTestForm(p => ({ ...p, message: e.target.value }))} required />
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
