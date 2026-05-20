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
} from '@mui/icons-material';
import api from '../../api';

const number = (value) => Number(value || 0).toLocaleString('ar-LY');

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

    const selectedTenant = useMemo(
        () => tenants.find((tenant) => String(tenant.id) === String(selectedTenantId)),
        [tenants, selectedTenantId],
    );

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

    useEffect(() => {
        fetchAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleTenantChange = async (tenantId) => {
        setSelectedTenantId(tenantId);
        setError(null);
        try {
            await fetchTenantBilling(tenantId);
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
            const result = await api.updateTenantBillingAccount(selectedTenantId, {
                plan_id: accountForm.plan_id || null,
                credit_limit_credits: accountForm.credit_limit_credits,
                status: accountForm.status,
            });
            setBilling(result.summary);
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
                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>القناة</TableCell>
                                    <TableCell>العملية</TableCell>
                                    <TableCell>الاسم</TableCell>
                                    <TableCell>السعر</TableCell>
                                    <TableCell>مدفوعة</TableCell>
                                    <TableCell>نشطة</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {prices.map((price) => (
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
                                ))}
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
