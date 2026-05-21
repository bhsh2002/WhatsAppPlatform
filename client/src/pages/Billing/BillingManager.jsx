import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    Grid,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Switch,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tabs,
    TextField,
    Typography,
} from '@mui/material';
import {
    AccountBalanceWallet as WalletIcon,
    Add as AddIcon,
    Payments as PaymentsIcon,
    PriceCheck as PriceIcon,
    ReceiptLong as InvoiceIcon,
    Refresh as RefreshIcon,
    Save as SaveIcon,
    CloudSync as SyncIcon,
    UploadFile as UploadIcon,
} from '@mui/icons-material';
import api from '../../api';

const number = (value) => Number(value || 0).toLocaleString('ar-LY');
const money = (value, currency = '') => `${Number(value || 0).toLocaleString('ar-LY', { minimumFractionDigits: 3, maximumFractionDigits: 4 })}${currency ? ` ${currency}` : ''}`;

const todayIso = () => new Date().toISOString().slice(0, 10);

const metaCategoriesForOperation = (operationKey) => {
    if (['whatsapp.text', 'whatsapp.media', 'whatsapp.interactive'].includes(operationKey)) {
        return { free: true, label: 'Service / free', note: 'تحسبها Meta كخدمة مجانية عند توفر نافذة الخدمة.' };
    }
    if (['whatsapp.template', 'whatsapp.broadcast_recipient', 'whatsapp.contact_verification_template'].includes(operationKey)) {
        return {
            categories: ['marketing', 'utility', 'authentication', 'authentication_international'],
            label: 'حسب فئة القالب',
            note: 'القيمة النهائية تعتمد على category وبلد المستلم وstatus webhook.',
        };
    }
    if (operationKey === 'whatsapp.event_conversion') {
        return { free: true, label: 'Events API', note: 'لا يستخدم rate card رسائل WhatsApp.' };
    }
    return null;
};

const isMetaRateEffective = (rate) => {
    const today = todayIso();
    const from = String(rate.effective_from || '').slice(0, 10);
    const to = String(rate.effective_to || '').slice(0, 10);
    return (!from || from <= today) && (!to || to >= today);
};

const getMetaReferenceForPrice = (price, metaRates, exchangeRate) => {
    const metaConfig = metaCategoriesForOperation(price.operation_key);
    if (!metaConfig) {
        return { label: 'غير مرتبط', caption: 'لا توجد تكلفة Meta مباشرة لهذه العملية.', color: 'default' };
    }
    if (metaConfig.free) {
        return { label: '0', caption: metaConfig.note, color: 'success' };
    }

    const rates = metaRates
        .filter((rate) => rate.is_active !== 0)
        .filter(isMetaRateEffective)
        .filter((rate) => metaConfig.categories.includes(String(rate.category || '').toLowerCase()));

    if (rates.length === 0) {
        return { label: 'غير محدد', caption: 'أضف أسعار Meta لهذه الفئات في تبويب المطابقة.', color: 'warning' };
    }

    const amounts = rates.map((rate) => Number(rate.rate_amount) || 0);
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    const currency = rates[0]?.currency || 'USD';
    const lydMin = min * exchangeRate;
    const lydMax = max * exchangeRate;
    const range = min === max ? money(min, currency) : `${money(min, currency)} - ${money(max, currency)}`;
    const lydRange = lydMin === lydMax ? money(lydMin, 'LYD') : `${money(lydMin, 'LYD')} - ${money(lydMax, 'LYD')}`;
    return {
        label: range,
        caption: `${metaConfig.label} | تقريبا ${lydRange}`,
        color: 'info',
    };
};

const StatCard = ({ title, value, icon, color = 'primary', caption }) => (
    <Card elevation={1} sx={{ height: '100%' }}>
        <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                <Box>
                    <Typography variant="body2" color="text.secondary">{title}</Typography>
                    <Typography variant="h5" fontWeight={800} sx={{ mt: 1 }}>{value}</Typography>
                    {caption && <Typography variant="caption" color="text.secondary">{caption}</Typography>}
                </Box>
                <Box sx={{ color: `${color}.main`, display: 'flex', alignItems: 'center' }}>{icon}</Box>
            </Box>
        </CardContent>
    </Card>
);

const BillingManager = () => {
    const [tab, setTab] = useState(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [plans, setPlans] = useState([]);
    const [prices, setPrices] = useState([]);
    const [metaRates, setMetaRates] = useState([]);
    const [metaSummary, setMetaSummary] = useState(null);
    const [metaUsage, setMetaUsage] = useState([]);
    const [metaInvoices, setMetaInvoices] = useState([]);
    const [metaSnapshots, setMetaSnapshots] = useState([]);
    const [metaComparison, setMetaComparison] = useState(null);
    const [metaReconciliation, setMetaReconciliation] = useState(null);
    const [metaSettings, setMetaSettings] = useState({
        meta_cost_exchange_rate_to_lyd: 1,
        meta_cost_margin_note: '',
    });
    const [tenants, setTenants] = useState([]);
    const [selectedTenantId, setSelectedTenantId] = useState('');
    const [billing, setBilling] = useState(null);
    const [planDialog, setPlanDialog] = useState(false);
    const [planForm, setPlanForm] = useState({
        code: '',
        name: '',
        description: '',
        monthly_price_lyd: 0,
        monthly_included_credits: 0,
        default_credit_limit: 0,
        is_active: true,
    });
    const [accountForm, setAccountForm] = useState({
        plan_id: '',
        credit_limit_credits: 0,
        status: 'active',
    });
    const [paymentForm, setPaymentForm] = useState({ credits: 100, amount_lyd: 0, method: 'manual', reference: '', note: '' });
    const [adjustmentForm, setAdjustmentForm] = useState({ credits_delta: 0, reason: '' });
    const [metaRateForm, setMetaRateForm] = useState({
        country_calling_code: '218',
        market_name: 'Libya',
        currency: 'USD',
        category: 'marketing',
        rate_amount: 0,
        effective_from: new Date().toISOString().slice(0, 10),
        source: 'manual',
    });
    const [metaInvoiceForm, setMetaInvoiceForm] = useState({
        invoice_number: '',
        currency: 'USD',
        subtotal_amount: 0,
        tax_amount: 0,
        total_amount: 0,
        period_start: '',
        period_end: '',
        notes: '',
    });
    const [metaSyncForm, setMetaSyncForm] = useState({
        start_date: '',
        end_date: '',
    });
    const [metaUsageSyncForm, setMetaUsageSyncForm] = useState({
        period_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
        period_end: new Date().toISOString().slice(0, 10),
        granularity: 'MONTHLY',
    });
    const [importResult, setImportResult] = useState(null);

    const selectedTenant = useMemo(
        () => tenants.find((tenant) => String(tenant.id) === String(selectedTenantId)),
        [tenants, selectedTenantId],
    );
    const latestMetaSnapshot = metaComparison?.latest_snapshot || metaSnapshots[0] || null;
    const reconciliationMetrics = metaReconciliation?.metrics || null;
    const reconciliationPeriod = metaReconciliation?.period || null;
    const activeMetaComparison = reconciliationMetrics?.comparison || metaComparison?.comparison || null;
    const metaDisplayCurrency = reconciliationMetrics?.currency || latestMetaSnapshot?.currency || metaSummary?.by_category?.[0]?.currency || '';
    const metaExchangeRate = Number(metaSettings.meta_cost_exchange_rate_to_lyd || 1) || 1;
    const metaCostLyd = (Number(reconciliationMetrics?.comparison?.meta_cost_amount || latestMetaSnapshot?.meta_cost_amount || 0) || 0) * metaExchangeRate;

    const fetchAll = async () => {
        try {
            setLoading(true);
            setError(null);
            const [plansData, pricesData, tenantsData] = await Promise.all([
                api.getBillingPlans(),
                api.getBillingPrices(),
                api.getTenants(),
            ]);
            const tenantRows = Array.isArray(tenantsData) ? tenantsData : [];
            setPlans(plansData.plans || []);
            setPrices(pricesData.prices || []);
            setTenants(tenantRows);
            const nextTenantId = selectedTenantId || tenantRows[0]?.id || '';
            setSelectedTenantId(nextTenantId);
            if (nextTenantId) {
                await fetchTenantBilling(nextTenantId);
            }
            await fetchMetaBilling(nextTenantId);
        } catch (err) {
            setError(err.message || 'فشل جلب بيانات الفوترة');
        } finally {
            setLoading(false);
        }
    };

    const fetchTenantBilling = async (tenantId) => {
        if (!tenantId) {
            setBilling(null);
            return;
        }
        const data = await api.getTenantBilling(tenantId);
        setBilling(data);
        setAccountForm({
            plan_id: data?.account?.plan_id || '',
            credit_limit_credits: data?.account?.credit_limit_credits || 0,
            status: data?.account?.status || 'active',
        });
    };

    const fetchMetaBilling = async (tenantId = selectedTenantId) => {
        const params = tenantId ? { tenant_id: tenantId } : {};
        const [ratesData, summaryData, usageData, invoicesData, settingsData] = await Promise.all([
            api.getMetaBillingRates(),
            api.getMetaBillingSummary(params),
            api.getMetaBillingUsage({ ...params, limit: 25 }),
            api.getMetaInvoices({ ...params, limit: 20 }),
            api.getMetaBillingSettings(),
        ]);
        const periodParams = {
            tenant_id: tenantId,
            period_start: metaUsageSyncForm.period_start,
            period_end: metaUsageSyncForm.period_end,
        };
        const [snapshotsData, comparisonData, reconciliationData] = tenantId
            ? await Promise.all([
                api.getMetaUsageSnapshots({ tenant_id: tenantId, limit: 5 }),
                api.getMetaUsageComparison(periodParams),
                api.getMetaReconciliation(periodParams),
            ])
            : [{ snapshots: [] }, null, null];
        setMetaRates(ratesData.rates || []);
        setMetaSummary(summaryData || null);
        setMetaUsage(usageData.usage || []);
        setMetaInvoices(invoicesData.invoices || []);
        setMetaSettings(settingsData.settings || { meta_cost_exchange_rate_to_lyd: 1, meta_cost_margin_note: '' });
        setMetaSnapshots(snapshotsData.snapshots || []);
        setMetaComparison(comparisonData || null);
        setMetaReconciliation(reconciliationData || null);
    };

    useEffect(() => {
        fetchAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleTenantChange = async (tenantId) => {
        setSelectedTenantId(tenantId);
        setError(null);
        try {
            await fetchTenantBilling(tenantId);
            await fetchMetaBilling(tenantId);
        } catch (err) {
            setError(err.message || 'فشل جلب حساب العميل');
        }
    };

    const createPlan = async () => {
        setSaving(true);
        try {
            await api.createBillingPlan(planForm);
            setPlanDialog(false);
            setPlanForm({ code: '', name: '', description: '', monthly_price_lyd: 0, monthly_included_credits: 0, default_credit_limit: 0, is_active: true });
            await fetchAll();
        } catch (err) {
            setError(err.message || 'فشل إنشاء الباقة');
        } finally {
            setSaving(false);
        }
    };

    const updatePrice = async (price, patch) => {
        const updated = { ...price, ...patch };
        setPrices((items) => items.map((item) => item.id === price.id ? updated : item));
        try {
            await api.updateBillingPrice(price.id, patch);
        } catch (err) {
            setError(err.message || 'فشل تحديث السعر');
            await fetchAll();
        }
    };

    const createMetaRate = async () => {
        setSaving(true);
        try {
            await api.createMetaBillingRate(metaRateForm);
            setMetaRateForm({ ...metaRateForm, rate_amount: 0 });
            await fetchMetaBilling();
        } catch (err) {
            setError(err.message || 'فشل إضافة سعر Meta');
        } finally {
            setSaving(false);
        }
    };

    const updateMetaRate = async (rate, patch) => {
        const updated = { ...rate, ...patch };
        setMetaRates((items) => items.map((item) => item.id === rate.id ? updated : item));
        try {
            await api.updateMetaBillingRate(rate.id, patch);
        } catch (err) {
            setError(err.message || 'فشل تحديث سعر Meta');
            await fetchMetaBilling();
        }
    };

    const updatePlan = async (plan, patch) => {
        const updated = { ...plan, ...patch };
        setPlans((items) => items.map((item) => item.id === plan.id ? updated : item));
        try {
            await api.updateBillingPlan(plan.id, patch);
        } catch (err) {
            setError(err.message || 'فشل تحديث الباقة');
            await fetchAll();
        }
    };

    const saveAccount = async () => {
        if (!selectedTenantId) return;
        setSaving(true);
        try {
            await api.updateTenantBillingAccount(selectedTenantId, {
                plan_id: accountForm.plan_id || null,
                credit_limit_credits: accountForm.credit_limit_credits,
                status: accountForm.status,
            });
            await fetchTenantBilling(selectedTenantId);
        } catch (err) {
            setError(err.message || 'فشل حفظ حساب الفوترة');
        } finally {
            setSaving(false);
        }
    };

    const recordPayment = async () => {
        if (!selectedTenantId) return;
        setSaving(true);
        try {
            const result = await api.recordTenantPayment(selectedTenantId, paymentForm);
            setBilling(result.summary);
            setPaymentForm({ credits: 100, amount_lyd: 0, method: 'manual', reference: '', note: '' });
        } catch (err) {
            setError(err.message || 'فشل تسجيل الدفعة');
        } finally {
            setSaving(false);
        }
    };

    const recordAdjustment = async () => {
        if (!selectedTenantId) return;
        setSaving(true);
        try {
            const result = await api.recordTenantAdjustment(selectedTenantId, adjustmentForm);
            setBilling(result.summary);
            setAdjustmentForm({ credits_delta: 0, reason: '' });
        } catch (err) {
            setError(err.message || 'فشل تسجيل التعديل');
        } finally {
            setSaving(false);
        }
    };

    const createInvoice = async () => {
        if (!selectedTenantId) return;
        setSaving(true);
        try {
            await api.createTenantBillingInvoice(selectedTenantId, {});
            await fetchTenantBilling(selectedTenantId);
        } catch (err) {
            setError(err.message || 'فشل إنشاء الفاتورة');
        } finally {
            setSaving(false);
        }
    };

    const createMetaInvoice = async () => {
        setSaving(true);
        try {
            await api.createMetaInvoice({
                tenant_id: selectedTenantId || null,
                business_id: selectedTenant?.business_id || null,
                waba_id: selectedTenant?.waba_id || null,
                ...metaInvoiceForm,
            });
            setMetaInvoiceForm({ invoice_number: '', currency: 'USD', subtotal_amount: 0, tax_amount: 0, total_amount: 0, period_start: '', period_end: '', notes: '' });
            await fetchMetaBilling();
        } catch (err) {
            setError(err.message || 'فشل تسجيل فاتورة Meta');
        } finally {
            setSaving(false);
        }
    };

    const syncMetaInvoices = async () => {
        if (!selectedTenantId) return;
        setSaving(true);
        try {
            await api.syncMetaInvoices({
                tenant_id: selectedTenantId,
                business_id: selectedTenant?.business_id || null,
                start_date: metaSyncForm.start_date,
                end_date: metaSyncForm.end_date,
            });
            await fetchMetaBilling();
        } catch (err) {
            setError(err.message || 'فشل مزامنة فواتير Meta');
        } finally {
            setSaving(false);
        }
    };

    const syncMetaUsage = async () => {
        if (!selectedTenantId) return;
        setSaving(true);
        try {
            await api.syncMetaReconciliation({
                tenant_id: selectedTenantId,
                ...metaUsageSyncForm,
            });
            await fetchMetaBilling();
        } catch (err) {
            setError(err.message || 'فشل مزامنة استهلاك Meta');
        } finally {
            setSaving(false);
        }
    };

    const saveMetaSettings = async () => {
        setSaving(true);
        try {
            const result = await api.updateMetaBillingSettings(metaSettings);
            setMetaSettings(result.settings || metaSettings);
        } catch (err) {
            setError(err.message || 'فشل حفظ إعدادات تكلفة Meta');
        } finally {
            setSaving(false);
        }
    };

    const markMetaReconciliationReviewed = async () => {
        if (!reconciliationPeriod?.id) return;
        setSaving(true);
        try {
            await api.markMetaReconciliationReviewed(reconciliationPeriod.id);
            await fetchMetaBilling();
        } catch (err) {
            setError(err.message || 'فشل تعليم فترة Meta كمراجعة');
        } finally {
            setSaving(false);
        }
    };

    const importMetaRates = async (file) => {
        if (!file) return;
        setSaving(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('currency', metaRateForm.currency || 'USD');
            formData.append('effective_from', metaRateForm.effective_from || '');
            const result = await api.importMetaBillingRates(formData);
            setImportResult(result);
            await fetchMetaBilling();
        } catch (err) {
            setError(err.message || 'فشل استيراد أسعار Meta');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography variant="h4" fontWeight={800}>الفوترة والتسعير</Typography>
                    <Typography variant="body2" color="text.secondary">
                        باقات شهرية، محفظة رصيد، سماحية ائتمانية، وسجل خصم مركزي.
                    </Typography>
                </Box>
                <Button startIcon={<RefreshIcon />} variant="outlined" onClick={fetchAll}>تحديث</Button>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            <Paper sx={{ mb: 3 }}>
                <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable">
                    <Tab label="حسابات العملاء" />
                    <Tab label="الباقات" />
                    <Tab label="كتالوج الأسعار" />
                    <Tab label="السجل والفواتير" />
                    <Tab label="مطابقة تكلفة Meta" />
                </Tabs>
            </Paper>

            {tab === 0 && (
                <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 4 }}>
                        <Paper sx={{ p: 2 }}>
                            <FormControl fullWidth sx={{ mb: 2 }}>
                                <InputLabel>العميل</InputLabel>
                                <Select value={selectedTenantId} label="العميل" onChange={(e) => handleTenantChange(e.target.value)}>
                                    {tenants.map((tenant) => (
                                        <MenuItem key={tenant.id} value={tenant.id}>{tenant.name}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <FormControl fullWidth sx={{ mb: 2 }}>
                                <InputLabel>الباقة</InputLabel>
                                <Select
                                    value={accountForm.plan_id}
                                    label="الباقة"
                                    onChange={(e) => setAccountForm({ ...accountForm, plan_id: e.target.value })}
                                >
                                    <MenuItem value="">بدون باقة</MenuItem>
                                    {plans.map((plan) => (
                                        <MenuItem key={plan.id} value={plan.id}>{plan.name}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <TextField
                                fullWidth
                                type="number"
                                label="السماحية الائتمانية"
                                value={accountForm.credit_limit_credits}
                                onChange={(e) => setAccountForm({ ...accountForm, credit_limit_credits: Number(e.target.value) || 0 })}
                                sx={{ mb: 2 }}
                            />
                            <FormControl fullWidth sx={{ mb: 2 }}>
                                <InputLabel>حالة الحساب</InputLabel>
                                <Select value={accountForm.status} label="حالة الحساب" onChange={(e) => setAccountForm({ ...accountForm, status: e.target.value })}>
                                    <MenuItem value="active">نشط</MenuItem>
                                    <MenuItem value="suspended">موقوف</MenuItem>
                                    <MenuItem value="closed">مغلق</MenuItem>
                                </Select>
                            </FormControl>
                            <Button fullWidth variant="contained" startIcon={<SaveIcon />} onClick={saveAccount} disabled={saving || !selectedTenantId}>
                                حفظ حساب الفوترة
                            </Button>
                        </Paper>
                    </Grid>
                    <Grid size={{ xs: 12, md: 8 }}>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <StatCard title="الرصيد المتاح" value={number(billing?.balances?.available_credits)} icon={<WalletIcon />} color="success" caption={selectedTenant?.name} />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <StatCard title="رصيد الباقة" value={number(billing?.balances?.plan_balance_credits)} icon={<PriceIcon />} caption={billing?.plan?.name || 'بدون باقة'} />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <StatCard title="رصيد المحفظة" value={number(billing?.balances?.wallet_balance_credits)} icon={<PaymentsIcon />} color="info" />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <StatCard title="السماحية المستخدمة" value={`${number(billing?.balances?.credit_used_credits)} / ${number(billing?.balances?.credit_limit_credits)}`} icon={<InvoiceIcon />} color="warning" />
                            </Grid>
                        </Grid>
                        <Grid container spacing={2} sx={{ mt: 0 }}>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <Paper sx={{ p: 2, mt: 2 }}>
                                    <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>إضافة رصيد / دفعة</Typography>
                                    <TextField fullWidth type="number" label="الرصيد" value={paymentForm.credits} onChange={(e) => setPaymentForm({ ...paymentForm, credits: Number(e.target.value) || 0 })} sx={{ mb: 1.5 }} />
                                    <TextField fullWidth type="number" label="المبلغ بالدينار" value={paymentForm.amount_lyd} onChange={(e) => setPaymentForm({ ...paymentForm, amount_lyd: Number(e.target.value) || 0 })} sx={{ mb: 1.5 }} />
                                    <TextField fullWidth label="مرجع الدفع" value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} sx={{ mb: 1.5 }} />
                                    <TextField fullWidth label="ملاحظة" value={paymentForm.note} onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })} sx={{ mb: 1.5 }} />
                                    <Button variant="contained" startIcon={<PaymentsIcon />} onClick={recordPayment} disabled={saving || paymentForm.credits <= 0}>تسجيل الدفعة</Button>
                                </Paper>
                            </Grid>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <Paper sx={{ p: 2, mt: 2 }}>
                                    <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>تعديل يدوي</Typography>
                                    <TextField fullWidth type="number" label="التعديل (+/-)" value={adjustmentForm.credits_delta} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, credits_delta: Number(e.target.value) || 0 })} sx={{ mb: 1.5 }} />
                                    <TextField fullWidth required label="سبب التعديل" value={adjustmentForm.reason} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, reason: e.target.value })} sx={{ mb: 1.5 }} />
                                    <Button variant="outlined" color="warning" onClick={recordAdjustment} disabled={saving || !adjustmentForm.reason || adjustmentForm.credits_delta === 0}>تسجيل التعديل</Button>
                                </Paper>
                            </Grid>
                        </Grid>
                    </Grid>
                </Grid>
            )}

            {tab === 1 && (
                <Paper sx={{ p: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                        <Typography variant="h6" fontWeight={700}>الباقات</Typography>
                        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setPlanDialog(true)}>باقة جديدة</Button>
                    </Box>
                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>الكود</TableCell>
                                    <TableCell>الاسم</TableCell>
                                    <TableCell>السعر الشهري</TableCell>
                                    <TableCell>الرصيد المضمن</TableCell>
                                    <TableCell>السماحية الافتراضية</TableCell>
                                    <TableCell>الحالة</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {plans.map((plan) => (
                                    <TableRow key={plan.id}>
                                        <TableCell>{plan.code}</TableCell>
                                        <TableCell>{plan.name}</TableCell>
                                        <TableCell sx={{ width: 140 }}>
                                            <TextField
                                                size="small"
                                                type="number"
                                                value={plan.monthly_price_lyd}
                                                onChange={(e) => setPlans((items) => items.map((item) => item.id === plan.id ? { ...item, monthly_price_lyd: Number(e.target.value) || 0 } : item))}
                                                onBlur={(e) => updatePlan(plan, { monthly_price_lyd: Number(e.target.value) || 0 })}
                                            />
                                        </TableCell>
                                        <TableCell sx={{ width: 140 }}>
                                            <TextField
                                                size="small"
                                                type="number"
                                                value={plan.monthly_included_credits}
                                                onChange={(e) => setPlans((items) => items.map((item) => item.id === plan.id ? { ...item, monthly_included_credits: Number(e.target.value) || 0 } : item))}
                                                onBlur={(e) => updatePlan(plan, { monthly_included_credits: Number(e.target.value) || 0 })}
                                            />
                                        </TableCell>
                                        <TableCell sx={{ width: 140 }}>
                                            <TextField
                                                size="small"
                                                type="number"
                                                value={plan.default_credit_limit}
                                                onChange={(e) => setPlans((items) => items.map((item) => item.id === plan.id ? { ...item, default_credit_limit: Number(e.target.value) || 0 } : item))}
                                                onBlur={(e) => updatePlan(plan, { default_credit_limit: Number(e.target.value) || 0 })}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <FormControlLabel
                                                control={<Switch checked={!!plan.is_active} onChange={(e) => updatePlan(plan, { is_active: e.target.checked })} />}
                                                label={plan.is_active ? 'نشطة' : 'متوقفة'}
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Paper>
            )}

            {tab === 2 && (
                <Paper sx={{ p: 2 }}>
                    <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>كتالوج أسعار العمليات</Typography>
                    <Alert severity="info" sx={{ mb: 2 }}>
                        السعر هنا هو سعر العميل بالرصيد. قيمة Meta تظهر للتوضيح وحساب الهامش فقط، ولا تخصم من رصيد العميل.
                    </Alert>
                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>القناة</TableCell>
                                    <TableCell>العملية</TableCell>
                                    <TableCell>الاسم</TableCell>
                                    <TableCell>سعر العميل</TableCell>
                                    <TableCell>طريقة الاحتساب</TableCell>
                                    <TableCell>قيمة Meta المرجعية</TableCell>
                                    <TableCell>مدفوعة</TableCell>
                                    <TableCell>نشطة</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {prices.map((price) => {
                                    const metaReference = getMetaReferenceForPrice(price, metaRates, metaExchangeRate);
                                    return (
                                        <TableRow key={price.id}>
                                            <TableCell>{price.channel}</TableCell>
                                            <TableCell>{price.operation_key}</TableCell>
                                            <TableCell>{price.display_name_ar}</TableCell>
                                            <TableCell sx={{ width: 120 }}>
                                                <TextField
                                                    size="small"
                                                    type="number"
                                                    value={price.unit_price_credits}
                                                    onChange={(e) => setPrices((items) => items.map((item) => item.id === price.id ? { ...item, unit_price_credits: Number(e.target.value) || 0 } : item))}
                                                    onBlur={(e) => updatePrice(price, { unit_price_credits: Number(e.target.value) || 0 })}
                                                />
                                            </TableCell>
                                            <TableCell sx={{ minWidth: 180 }}>
                                                <FormControl fullWidth size="small">
                                                    <Select
                                                        value={price.local_pricing_model || 'fixed'}
                                                        onChange={(e) => updatePrice(price, { local_pricing_model: e.target.value })}
                                                    >
                                                        <MenuItem value="fixed">ثابت</MenuItem>
                                                        <MenuItem value="meta_like">مثل Meta</MenuItem>
                                                    </Select>
                                                </FormControl>
                                                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                                                    {price.local_pricing_model === 'meta_like'
                                                        ? 'يدعم نافذة 24 ساعة وCTWA 72 ساعة.'
                                                        : 'يخصم حسب العدد والسعر فقط.'}
                                                </Typography>
                                            </TableCell>
                                            <TableCell sx={{ minWidth: 220 }}>
                                                <Chip size="small" label={metaReference.label} color={metaReference.color} sx={{ mb: 0.5 }} />
                                                <Typography variant="caption" color="text.secondary" display="block">
                                                    {metaReference.caption}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>
                                                <FormControlLabel
                                                    control={<Switch checked={!!price.is_billable} onChange={(e) => updatePrice(price, { is_billable: e.target.checked })} />}
                                                    label=""
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <FormControlLabel
                                                    control={<Switch checked={!!price.is_active} onChange={(e) => updatePrice(price, { is_active: e.target.checked })} />}
                                                    label=""
                                                />
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Paper>
            )}

            {tab === 3 && (
                <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 8 }}>
                        <Paper sx={{ p: 2 }}>
                            <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>آخر العمليات</Typography>
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>الوقت</TableCell>
                                            <TableCell>النوع</TableCell>
                                            <TableCell>الوصف</TableCell>
                                            <TableCell>التغيير</TableCell>
                                            <TableCell>الرصيد بعد العملية</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {(billing?.recent_ledger || []).map((entry) => (
                                            <TableRow key={entry.id}>
                                                <TableCell>{entry.created_at}</TableCell>
                                                <TableCell>{entry.entry_type}</TableCell>
                                                <TableCell>{entry.description}</TableCell>
                                                <TableCell>{number(entry.credits_delta)}</TableCell>
                                                <TableCell>{number(entry.balance_after_credits)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Paper>
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                        <Paper sx={{ p: 2 }}>
                            <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>الفواتير</Typography>
                            <Button fullWidth variant="contained" startIcon={<InvoiceIcon />} onClick={createInvoice} disabled={saving || !selectedTenantId} sx={{ mb: 2 }}>
                                إنشاء فاتورة من الاستهلاك
                            </Button>
                            {billing?.last_invoice ? (
                                <Box>
                                    <Typography variant="body2">آخر فاتورة: {billing.last_invoice.invoice_number}</Typography>
                                    <Typography variant="body2">الحالة: {billing.last_invoice.status}</Typography>
                                    <Typography variant="body2">الرصيد: {number(billing.last_invoice.subtotal_credits)}</Typography>
                                </Box>
                            ) : (
                                <Alert severity="info">لا توجد فواتير لهذا العميل بعد.</Alert>
                            )}
                        </Paper>
                    </Grid>
                </Grid>
            )}

            {tab === 4 && (
                <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 3 }}>
                        <StatCard
                            title="تكلفة Meta"
                            value={money(reconciliationMetrics?.comparison?.meta_cost_amount ?? latestMetaSnapshot?.meta_cost_amount, metaDisplayCurrency)}
                            icon={<InvoiceIcon />}
                            color="error"
                            caption={`${money(metaCostLyd, 'LYD')} بسعر التحويل الإداري`}
                        />
                    </Grid>
                    <Grid size={{ xs: 12, md: 3 }}>
                        <StatCard
                            title="مؤكد من Webhook"
                            value={number(reconciliationMetrics?.counts?.final_count ?? metaSummary?.totals?.priced_count)}
                            icon={<PriceIcon />}
                            color="warning"
                            caption={money(reconciliationMetrics?.comparison?.local_final_amount ?? metaSummary?.totals?.final_amount, metaDisplayCurrency)}
                        />
                    </Grid>
                    <Grid size={{ xs: 12, md: 3 }}>
                        <StatCard
                            title="بانتظار Webhook"
                            value={number(reconciliationMetrics?.counts?.pending_count ?? 0)}
                            icon={<RefreshIcon />}
                            color="warning"
                            caption="pending قبل delivered/read"
                        />
                    </Grid>
                    <Grid size={{ xs: 12, md: 3 }}>
                        <StatCard
                            title="يحتاج مراجعة"
                            value={number(reconciliationMetrics?.counts?.needs_action_count ?? metaSummary?.totals?.rate_missing_count)}
                            icon={<InvoiceIcon />}
                            color={reconciliationPeriod?.status === 'needs_review' ? 'error' : 'info'}
                            caption={`الفترة: ${reconciliationPeriod?.status || reconciliationMetrics?.status || 'open'}`}
                        />
                    </Grid>

                    <Grid size={{ xs: 12 }}>
                        <Paper sx={{ p: 2 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                                <Box>
                                    <Typography variant="h6" fontWeight={700}>Meta Cost Reconciliation</Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        تقارن الفترة بين Meta analytics، usage المحلي، تكلفة webhook، وفواتير Meta. لا يتم تعديل رصيد العميل من هذه المطابقة.
                                    </Typography>
                                </Box>
                                <Button startIcon={<SyncIcon />} variant="contained" onClick={syncMetaUsage} disabled={saving || !selectedTenantId || !metaUsageSyncForm.period_start || !metaUsageSyncForm.period_end}>
                                    مزامنة ومطابقة
                                </Button>
                            </Box>
                            <Grid container spacing={1.5}>
                                <Grid size={{ xs: 12, sm: 4 }}>
                                    <TextField fullWidth type="date" label="من" InputLabelProps={{ shrink: true }} value={metaUsageSyncForm.period_start} onChange={(e) => setMetaUsageSyncForm({ ...metaUsageSyncForm, period_start: e.target.value })} />
                                </Grid>
                                <Grid size={{ xs: 12, sm: 4 }}>
                                    <TextField fullWidth type="date" label="إلى" InputLabelProps={{ shrink: true }} value={metaUsageSyncForm.period_end} onChange={(e) => setMetaUsageSyncForm({ ...metaUsageSyncForm, period_end: e.target.value })} />
                                </Grid>
                                <Grid size={{ xs: 12, sm: 4 }}>
                                    <FormControl fullWidth>
                                        <InputLabel>التجميع</InputLabel>
                                        <Select value={metaUsageSyncForm.granularity} label="التجميع" onChange={(e) => setMetaUsageSyncForm({ ...metaUsageSyncForm, granularity: e.target.value })}>
                                            <MenuItem value="MONTHLY">شهري</MenuItem>
                                            <MenuItem value="DAILY">يومي</MenuItem>
                                        </Select>
                                    </FormControl>
                                </Grid>
                            </Grid>
                            {(reconciliationPeriod || reconciliationMetrics) && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 2 }}>
                                    <Chip
                                        label={reconciliationPeriod?.status || reconciliationMetrics?.status || 'open'}
                                        color={(reconciliationPeriod?.status || reconciliationMetrics?.status) === 'needs_review' ? 'error' : 'success'}
                                    />
                                    {reconciliationPeriod?.id && reconciliationPeriod.status === 'needs_review' && (
                                        <Button size="small" variant="outlined" onClick={markMetaReconciliationReviewed} disabled={saving}>
                                            تعليم كمراجعة
                                        </Button>
                                    )}
                                    <Typography variant="caption" color="text.secondary">
                                        threshold: 0.01 {metaDisplayCurrency || 'USD'} أو أي فرق sent/delivered
                                    </Typography>
                                </Box>
                            )}
                            {activeMetaComparison && (
                                <Grid container spacing={1.5} sx={{ mt: 2 }}>
                                    <Grid size={{ xs: 12, md: 3 }}>
                                        <Alert severity={Math.abs(activeMetaComparison.diff_sent) > 0 ? 'warning' : 'success'}>
                                            Meta sent: {number(activeMetaComparison.meta_sent)} / المحلي: {number(activeMetaComparison.local_sent)}
                                        </Alert>
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 3 }}>
                                        <Alert severity={Math.abs(activeMetaComparison.diff_delivered) > 0 ? 'warning' : 'success'}>
                                            Meta delivered: {number(activeMetaComparison.meta_delivered)} / المحلي: {number(activeMetaComparison.local_delivered)}
                                        </Alert>
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 3 }}>
                                        <Alert severity={Math.abs(activeMetaComparison.diff_meta_vs_local_cost) > 0.01 ? 'warning' : 'success'}>
                                            Meta cost: {money(activeMetaComparison.meta_cost_amount, metaDisplayCurrency)}
                                        </Alert>
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 3 }}>
                                        <Alert severity={Math.abs(activeMetaComparison.diff_invoice_vs_local_cost) > 0.01 ? 'warning' : 'info'}>
                                            Invoice total: {money(activeMetaComparison.invoice_total_amount, metaDisplayCurrency)}
                                        </Alert>
                                    </Grid>
                                </Grid>
                            )}
                        </Paper>
                    </Grid>

                    <Grid size={{ xs: 12, md: 5 }}>
                        <Paper sx={{ p: 2 }}>
                            <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>إعدادات تكلفة Meta</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                هذه القيم للعرض الإداري وحساب الهامش فقط، ولا تؤثر على رصيد العميل.
                            </Typography>
                            <Grid container spacing={1.5}>
                                <Grid size={{ xs: 12, sm: 5 }}>
                                    <TextField
                                        fullWidth
                                        type="number"
                                        label="سعر التحويل إلى LYD"
                                        value={metaSettings.meta_cost_exchange_rate_to_lyd}
                                        onChange={(e) => setMetaSettings({ ...metaSettings, meta_cost_exchange_rate_to_lyd: Number(e.target.value) || 1 })}
                                    />
                                </Grid>
                                <Grid size={{ xs: 12, sm: 7 }}>
                                    <TextField
                                        fullWidth
                                        label="ملاحظة الهامش"
                                        value={metaSettings.meta_cost_margin_note}
                                        onChange={(e) => setMetaSettings({ ...metaSettings, meta_cost_margin_note: e.target.value })}
                                    />
                                </Grid>
                            </Grid>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 2, flexWrap: 'wrap' }}>
                                <Button variant="contained" startIcon={<SaveIcon />} onClick={saveMetaSettings} disabled={saving}>
                                    حفظ الإعدادات
                                </Button>
                                <Typography variant="body2" color="text.secondary">
                                    Meta: {money(activeMetaComparison?.meta_cost_amount, metaDisplayCurrency)} / LYD: {money(metaCostLyd, 'LYD')}
                                </Typography>
                            </Box>
                        </Paper>
                    </Grid>

                    <Grid size={{ xs: 12, md: 7 }}>
                        <Paper sx={{ p: 2 }}>
                            <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>عمليات تحتاج إجراء</Typography>
                            {(metaReconciliation?.action_items || []).length === 0 ? (
                                <Alert severity="success">لا توجد عمليات معلقة في الفترة الحالية.</Alert>
                            ) : (
                                <TableContainer sx={{ maxHeight: 260 }}>
                                    <Table size="small" stickyHeader>
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>الوقت</TableCell>
                                                <TableCell>العملية</TableCell>
                                                <TableCell>السبب</TableCell>
                                                <TableCell>WAMID</TableCell>
                                                <TableCell>الحالة</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {(metaReconciliation?.action_items || []).map((item) => (
                                                <TableRow key={item.id}>
                                                    <TableCell>{item.committed_at || item.reserved_at}</TableCell>
                                                    <TableCell>{item.operation_key}</TableCell>
                                                    <TableCell>{item.action_reason}</TableCell>
                                                    <TableCell>{item.reference_id || '-'}</TableCell>
                                                    <TableCell>
                                                        <Chip size="small" label={item.meta_charge_status || '-'} />
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            )}
                        </Paper>
                    </Grid>

                    <Grid size={{ xs: 12, lg: 5 }}>
                        <Paper sx={{ p: 2 }}>
                            <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>إضافة سعر Meta WhatsApp</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                أدخل أسعار Meta المنشورة حسب كود الدولة وفئة الرسالة. لا يتم افتراض أسعار تلقائية.
                            </Typography>
                            <Grid container spacing={1.5}>
                                <Grid size={{ xs: 6 }}>
                                    <TextField fullWidth label="كود الدولة" value={metaRateForm.country_calling_code} onChange={(e) => setMetaRateForm({ ...metaRateForm, country_calling_code: e.target.value })} />
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <TextField fullWidth label="السوق" value={metaRateForm.market_name} onChange={(e) => setMetaRateForm({ ...metaRateForm, market_name: e.target.value })} />
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <FormControl fullWidth>
                                        <InputLabel>الفئة</InputLabel>
                                        <Select value={metaRateForm.category} label="الفئة" onChange={(e) => setMetaRateForm({ ...metaRateForm, category: e.target.value })}>
                                            <MenuItem value="marketing">marketing</MenuItem>
                                            <MenuItem value="utility">utility</MenuItem>
                                            <MenuItem value="authentication">authentication</MenuItem>
                                            <MenuItem value="authentication_international">authentication international</MenuItem>
                                            <MenuItem value="service">service</MenuItem>
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <TextField fullWidth label="العملة" value={metaRateForm.currency} onChange={(e) => setMetaRateForm({ ...metaRateForm, currency: e.target.value.toUpperCase() })} />
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <TextField fullWidth type="number" label="سعر Meta" value={metaRateForm.rate_amount} onChange={(e) => setMetaRateForm({ ...metaRateForm, rate_amount: Number(e.target.value) || 0 })} />
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <TextField fullWidth type="date" label="تاريخ السريان" InputLabelProps={{ shrink: true }} value={metaRateForm.effective_from} onChange={(e) => setMetaRateForm({ ...metaRateForm, effective_from: e.target.value })} />
                                </Grid>
                            </Grid>
                            <Button sx={{ mt: 2 }} variant="contained" onClick={createMetaRate} disabled={saving || !metaRateForm.country_calling_code || !metaRateForm.category}>
                                إضافة سعر Meta
                            </Button>
                            <Button sx={{ mt: 2, mx: 1 }} variant="outlined" startIcon={<UploadIcon />} component="label" disabled={saving}>
                                استيراد CSV
                                <input hidden type="file" accept=".csv,text/csv" onChange={(e) => importMetaRates(e.target.files?.[0])} />
                            </Button>
                            {importResult && (
                                <Alert severity={importResult.failed > 0 ? 'warning' : 'success'} sx={{ mt: 2 }}>
                                    تم الاستيراد: {number(importResult.imported)}، إنشاء: {number(importResult.created)}، تحديث: {number(importResult.updated)}، فشل: {number(importResult.failed)}
                                </Alert>
                            )}
                        </Paper>
                    </Grid>

                    <Grid size={{ xs: 12, lg: 7 }}>
                        <Paper sx={{ p: 2 }}>
                            <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>كتالوج أسعار Meta</Typography>
                            <TableContainer sx={{ maxHeight: 320 }}>
                                <Table size="small" stickyHeader>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>الدولة</TableCell>
                                            <TableCell>السوق</TableCell>
                                            <TableCell>الفئة</TableCell>
                                            <TableCell>العملة</TableCell>
                                            <TableCell>السعر</TableCell>
                                            <TableCell>نشط</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {metaRates.map((rate) => (
                                            <TableRow key={rate.id}>
                                                <TableCell>{rate.country_calling_code}</TableCell>
                                                <TableCell>{rate.market_name || '-'}</TableCell>
                                                <TableCell>{rate.category}</TableCell>
                                                <TableCell>{rate.currency}</TableCell>
                                                <TableCell sx={{ width: 130 }}>
                                                    <TextField
                                                        size="small"
                                                        type="number"
                                                        value={rate.rate_amount}
                                                        onChange={(e) => setMetaRates((items) => items.map((item) => item.id === rate.id ? { ...item, rate_amount: Number(e.target.value) || 0 } : item))}
                                                        onBlur={(e) => updateMetaRate(rate, { rate_amount: Number(e.target.value) || 0 })}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Switch checked={!!rate.is_active} onChange={(e) => updateMetaRate(rate, { is_active: e.target.checked })} />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Paper>
                    </Grid>

                    <Grid size={{ xs: 12, lg: 7 }}>
                        <Paper sx={{ p: 2 }}>
                            <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>آخر عمليات تكلفة Meta</Typography>
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>الوقت</TableCell>
                                            <TableCell>العميل</TableCell>
                                            <TableCell>الفئة</TableCell>
                                            <TableCell>الحالة</TableCell>
                                            <TableCell>التقديري</TableCell>
                                            <TableCell>المؤكد</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {metaUsage.map((usage) => (
                                            <TableRow key={usage.id}>
                                                <TableCell>{usage.meta_priced_at || usage.committed_at || usage.reserved_at}</TableCell>
                                                <TableCell>{usage.tenant_name || usage.tenant_id}</TableCell>
                                                <TableCell>{usage.meta_charge_category || '-'}</TableCell>
                                                <TableCell>
                                                    <Chip size="small" label={usage.meta_charge_status || '-'} />
                                                </TableCell>
                                                <TableCell>{money(usage.meta_estimated_amount, usage.meta_charge_currency)}</TableCell>
                                                <TableCell>{money(usage.meta_final_amount, usage.meta_charge_currency)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Paper>
                    </Grid>

                    <Grid size={{ xs: 12, lg: 5 }}>
                        <Paper sx={{ p: 2 }}>
                            <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>فواتير Meta</Typography>
                            <Grid container spacing={1.5} sx={{ mb: 2 }}>
                                <Grid size={{ xs: 6 }}>
                                    <TextField fullWidth type="date" label="من" InputLabelProps={{ shrink: true }} value={metaSyncForm.start_date} onChange={(e) => setMetaSyncForm({ ...metaSyncForm, start_date: e.target.value })} />
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <TextField fullWidth type="date" label="إلى" InputLabelProps={{ shrink: true }} value={metaSyncForm.end_date} onChange={(e) => setMetaSyncForm({ ...metaSyncForm, end_date: e.target.value })} />
                                </Grid>
                            </Grid>
                            <Button fullWidth variant="outlined" startIcon={<SyncIcon />} onClick={syncMetaInvoices} disabled={saving || !selectedTenantId || !metaSyncForm.start_date || !metaSyncForm.end_date} sx={{ mb: 2 }}>
                                مزامنة من Meta Business Invoices
                            </Button>

                            <Grid container spacing={1.5}>
                                <Grid size={{ xs: 12 }}>
                                    <TextField fullWidth label="رقم الفاتورة" value={metaInvoiceForm.invoice_number} onChange={(e) => setMetaInvoiceForm({ ...metaInvoiceForm, invoice_number: e.target.value })} />
                                </Grid>
                                <Grid size={{ xs: 4 }}>
                                    <TextField fullWidth label="العملة" value={metaInvoiceForm.currency} onChange={(e) => setMetaInvoiceForm({ ...metaInvoiceForm, currency: e.target.value.toUpperCase() })} />
                                </Grid>
                                <Grid size={{ xs: 4 }}>
                                    <TextField fullWidth type="number" label="الإجمالي" value={metaInvoiceForm.total_amount} onChange={(e) => setMetaInvoiceForm({ ...metaInvoiceForm, total_amount: Number(e.target.value) || 0 })} />
                                </Grid>
                                <Grid size={{ xs: 4 }}>
                                    <TextField fullWidth type="number" label="الضريبة" value={metaInvoiceForm.tax_amount} onChange={(e) => setMetaInvoiceForm({ ...metaInvoiceForm, tax_amount: Number(e.target.value) || 0 })} />
                                </Grid>
                            </Grid>
                            <Button sx={{ mt: 2 }} variant="contained" onClick={createMetaInvoice} disabled={saving || !selectedTenantId}>
                                تسجيل فاتورة Meta يدويا
                            </Button>

                            <Box sx={{ mt: 2, display: 'grid', gap: 1 }}>
                                {metaInvoices.map((invoice) => (
                                    <Paper key={invoice.id} variant="outlined" sx={{ p: 1.5 }}>
                                        <Typography variant="body2" fontWeight={700}>{invoice.invoice_number}</Typography>
                                        <Typography variant="caption" color="text.secondary">{invoice.period_start || '-'} → {invoice.period_end || '-'}</Typography>
                                        <Typography variant="body2">{money(invoice.total_amount, invoice.currency)}</Typography>
                                    </Paper>
                                ))}
                            </Box>
                        </Paper>
                    </Grid>

                    <Grid size={{ xs: 12 }}>
                        <Paper sx={{ p: 2 }}>
                            <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>آخر لقطات مطابقة Meta</Typography>
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>الوقت</TableCell>
                                            <TableCell>الفترة</TableCell>
                                            <TableCell>الحالة</TableCell>
                                            <TableCell>Meta sent</TableCell>
                                            <TableCell>Local sent</TableCell>
                                            <TableCell>Meta cost</TableCell>
                                            <TableCell>Local final</TableCell>
                                            <TableCell>Invoice</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {metaSnapshots.map((snapshot) => (
                                            <TableRow key={snapshot.id}>
                                                <TableCell>{snapshot.created_at}</TableCell>
                                                <TableCell>{snapshot.period_start} → {snapshot.period_end}</TableCell>
                                                <TableCell>
                                                    <Chip size="small" label={snapshot.status} color={snapshot.status === 'synced' ? 'success' : snapshot.status === 'partial' ? 'warning' : 'error'} />
                                                </TableCell>
                                                <TableCell>{number(snapshot.meta_sent)}</TableCell>
                                                <TableCell>{number(snapshot.local_sent)}</TableCell>
                                                <TableCell>{money(snapshot.meta_cost_amount, snapshot.currency)}</TableCell>
                                                <TableCell>{money(snapshot.local_final_amount, snapshot.currency)}</TableCell>
                                                <TableCell>{money(snapshot.invoice_total_amount, snapshot.currency)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Paper>
                    </Grid>
                </Grid>
            )}

            <Dialog open={planDialog} onClose={() => setPlanDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>إنشاء باقة جديدة</DialogTitle>
                <DialogContent sx={{ display: 'grid', gap: 2, pt: 2 }}>
                    <TextField label="الكود" value={planForm.code} onChange={(e) => setPlanForm({ ...planForm, code: e.target.value })} />
                    <TextField label="الاسم" value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} />
                    <TextField label="الوصف" value={planForm.description} onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })} />
                    <TextField type="number" label="السعر الشهري LYD" value={planForm.monthly_price_lyd} onChange={(e) => setPlanForm({ ...planForm, monthly_price_lyd: Number(e.target.value) || 0 })} />
                    <TextField type="number" label="الرصيد الشهري المضمن" value={planForm.monthly_included_credits} onChange={(e) => setPlanForm({ ...planForm, monthly_included_credits: Number(e.target.value) || 0 })} />
                    <TextField type="number" label="السماحية الافتراضية" value={planForm.default_credit_limit} onChange={(e) => setPlanForm({ ...planForm, default_credit_limit: Number(e.target.value) || 0 })} />
                    <FormControlLabel control={<Switch checked={planForm.is_active} onChange={(e) => setPlanForm({ ...planForm, is_active: e.target.checked })} />} label="نشطة" />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPlanDialog(false)}>إلغاء</Button>
                    <Button variant="contained" onClick={createPlan} disabled={saving || !planForm.code || !planForm.name}>إنشاء</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default BillingManager;
