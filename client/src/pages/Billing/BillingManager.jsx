import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, Grid, InputLabel, MenuItem, Paper, Select, Switch, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Typography } from '@mui/material';
import { AccountBalanceWallet as WalletIcon, Add as AddIcon, Payments as PaymentsIcon, PriceCheck as PriceIcon, ReceiptLong as InvoiceIcon, Refresh as RefreshIcon, Save as SaveIcon, CloudSync as SyncIcon, UploadFile as UploadIcon } from '@mui/icons-material';
import api from '../../api';
import { useLanguage } from '../../context/LanguageContext';
import { tx } from "../../i18n/tx";
import { getCurrentLocale } from "../../utils/locale";
const number = value => Number(value || 0).toLocaleString(getCurrentLocale());
const money = (value, currency = '') => `${Number(value || 0).toLocaleString(getCurrentLocale(), {
  minimumFractionDigits: 3,
  maximumFractionDigits: 4
})}${currency ? ` ${currency}` : ''}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const metaCategoriesForOperation = operationKey => {
  if (['whatsapp.text', 'whatsapp.media', 'whatsapp.interactive'].includes(operationKey)) {
    return {
      free: true,
      label: 'Service / free',
      note: tx("auto.k_a0383761c875")
    };
  }
  if (['whatsapp.template', 'whatsapp.broadcast_recipient', 'whatsapp.contact_verification_template'].includes(operationKey)) {
    return {
      categories: ['marketing', 'utility', 'authentication', 'authentication_international'],
      label: tx("auto.k_4f323adb5865"),
      note: tx("auto.k_8cd81e9b09c6")
    };
  }
  if (operationKey === 'whatsapp.event_conversion') {
    return {
      free: true,
      label: 'Events API',
      note: tx("auto.k_048bdc4237e1")
    };
  }
  return null;
};
const isMetaRateEffective = rate => {
  const today = todayIso();
  const from = String(rate.effective_from || '').slice(0, 10);
  const to = String(rate.effective_to || '').slice(0, 10);
  return (!from || from <= today) && (!to || to >= today);
};
const getMetaReferenceForPrice = (price, metaRates, exchangeRate) => {
  const metaConfig = metaCategoriesForOperation(price.operation_key);
  if (!metaConfig) {
    return {
      label: tx("auto.k_3c02307ea09b"),
      caption: tx("auto.k_37d43894d83a"),
      color: 'default'
    };
  }
  if (metaConfig.free) {
    return {
      label: '0',
      caption: metaConfig.note,
      color: 'success'
    };
  }
  const rates = metaRates.filter(rate => rate.is_active !== 0).filter(isMetaRateEffective).filter(rate => metaConfig.categories.includes(String(rate.category || '').toLowerCase()));
  if (rates.length === 0) {
    return {
      label: tx("auto.k_b2c702e73c91"),
      caption: tx("auto.k_9895ec3da878"),
      color: 'warning'
    };
  }
  const amounts = rates.map(rate => Number(rate.rate_amount) || 0);
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const currency = rates[0]?.currency || 'USD';
  const lydMin = min * exchangeRate;
  const lydMax = max * exchangeRate;
  const range = min === max ? money(min, currency) : `${money(min, currency)} - ${money(max, currency)}`;
  const lydRange = lydMin === lydMax ? money(lydMin, 'LYD') : `${money(lydMin, 'LYD')} - ${money(lydMax, 'LYD')}`;
  return {
    label: range,
    caption: tx("auto.k_0dd9c7af5a99", {
      value1: metaConfig.label,
      value2: lydRange
    }),
    color: 'info'
  };
};
const StatCard = ({
  title,
  value,
  icon,
  color = 'primary',
  caption
}) => <Card elevation={1} sx={{
  height: '100%'
}}>
        <CardContent>
            <Box sx={{
      display: 'flex',
      justifyContent: 'space-between',
      gap: 2
    }}>
                <Box>
                    <Typography variant="body2" color="text.secondary">{title}</Typography>
                    <Typography variant="h5" fontWeight={800} sx={{
          mt: 1
        }}>{value}</Typography>
                    {caption && <Typography variant="caption" color="text.secondary">{caption}</Typography>}
                </Box>
                <Box sx={{
        color: `${color}.main`,
        display: 'flex',
        alignItems: 'center'
      }}>{icon}</Box>
            </Box>
        </CardContent>
    </Card>;
const BillingManager = () => {
  const {
    t
  } = useLanguage();
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
    credit_value_lyd: 0.1,
    meta_cost_margin_percent: 20,
    strict_meta_rate_required: true
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
    is_active: true
  });
  const [accountForm, setAccountForm] = useState({
    plan_id: '',
    credit_limit_credits: 0,
    status: 'active'
  });
  const [paymentForm, setPaymentForm] = useState({
    credits: 100,
    amount_lyd: 0,
    method: 'manual',
    reference: '',
    note: ''
  });
  const [adjustmentForm, setAdjustmentForm] = useState({
    credits_delta: 0,
    reason: ''
  });
  const [metaRateForm, setMetaRateForm] = useState({
    country_calling_code: '218',
    market_name: 'Libya',
    currency: 'USD',
    category: 'marketing',
    rate_amount: 0,
    effective_from: new Date().toISOString().slice(0, 10),
    source: 'manual'
  });
  const [metaInvoiceForm, setMetaInvoiceForm] = useState({
    invoice_number: '',
    currency: 'USD',
    subtotal_amount: 0,
    tax_amount: 0,
    total_amount: 0,
    period_start: '',
    period_end: '',
    notes: ''
  });
  const [metaSyncForm, setMetaSyncForm] = useState({
    start_date: '',
    end_date: ''
  });
  const [metaUsageSyncForm, setMetaUsageSyncForm] = useState({
    period_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
    period_end: new Date().toISOString().slice(0, 10),
    granularity: 'MONTHLY'
  });
  const [importResult, setImportResult] = useState(null);
  const selectedTenant = useMemo(() => tenants.find(tenant => String(tenant.id) === String(selectedTenantId)), [tenants, selectedTenantId]);
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
      const [plansData, pricesData, tenantsData] = await Promise.all([api.getBillingPlans(), api.getBillingPrices(), api.getTenants()]);
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
      setError(err.message || tx("auto.k_16d026007a0e"));
    } finally {
      setLoading(false);
    }
  };
  const fetchTenantBilling = async tenantId => {
    if (!tenantId) {
      setBilling(null);
      return;
    }
    const data = await api.getTenantBilling(tenantId);
    setBilling(data);
    setAccountForm({
      plan_id: data?.account?.plan_id || '',
      credit_limit_credits: data?.account?.credit_limit_credits || 0,
      status: data?.account?.status || 'active'
    });
  };
  const fetchMetaBilling = async (tenantId = selectedTenantId) => {
    const params = tenantId ? {
      tenant_id: tenantId
    } : {};
    const [ratesData, summaryData, usageData, invoicesData, settingsData] = await Promise.all([api.getMetaBillingRates(), api.getMetaBillingSummary(params), api.getMetaBillingUsage({
      ...params,
      limit: 25
    }), api.getMetaInvoices({
      ...params,
      limit: 20
    }), api.getMetaBillingSettings()]);
    const periodParams = {
      tenant_id: tenantId,
      period_start: metaUsageSyncForm.period_start,
      period_end: metaUsageSyncForm.period_end
    };
    const [snapshotsData, comparisonData, reconciliationData] = tenantId ? await Promise.all([api.getMetaUsageSnapshots({
      tenant_id: tenantId,
      limit: 5
    }), api.getMetaUsageComparison(periodParams), api.getMetaReconciliation(periodParams)]) : [{
      snapshots: []
    }, null, null];
    setMetaRates(ratesData.rates || []);
    setMetaSummary(summaryData || null);
    setMetaUsage(usageData.usage || []);
    setMetaInvoices(invoicesData.invoices || []);
    setMetaSettings(settingsData.settings || {
      meta_cost_exchange_rate_to_lyd: 1,
      meta_cost_margin_note: '',
      credit_value_lyd: 0.1,
      meta_cost_margin_percent: 20,
      strict_meta_rate_required: true
    });
    setMetaSnapshots(snapshotsData.snapshots || []);
    setMetaComparison(comparisonData || null);
    setMetaReconciliation(reconciliationData || null);
  };
  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleTenantChange = async tenantId => {
    setSelectedTenantId(tenantId);
    setError(null);
    try {
      await fetchTenantBilling(tenantId);
      await fetchMetaBilling(tenantId);
    } catch (err) {
      setError(err.message || tx("auto.k_fbaaf9c370c9"));
    }
  };
  const createPlan = async () => {
    setSaving(true);
    try {
      await api.createBillingPlan(planForm);
      setPlanDialog(false);
      setPlanForm({
        code: '',
        name: '',
        description: '',
        monthly_price_lyd: 0,
        monthly_included_credits: 0,
        default_credit_limit: 0,
        is_active: true
      });
      await fetchAll();
    } catch (err) {
      setError(err.message || tx("auto.k_693710a1e992"));
    } finally {
      setSaving(false);
    }
  };
  const updatePrice = async (price, patch) => {
    const updated = {
      ...price,
      ...patch
    };
    setPrices(items => items.map(item => item.id === price.id ? updated : item));
    try {
      await api.updateBillingPrice(price.id, patch);
    } catch (err) {
      setError(err.message || tx("auto.k_0dc20d224843"));
      await fetchAll();
    }
  };
  const createMetaRate = async () => {
    setSaving(true);
    try {
      await api.createMetaBillingRate(metaRateForm);
      setMetaRateForm({
        ...metaRateForm,
        rate_amount: 0
      });
      await fetchMetaBilling();
    } catch (err) {
      setError(err.message || tx("auto.k_584ee4d66dbb"));
    } finally {
      setSaving(false);
    }
  };
  const updateMetaRate = async (rate, patch) => {
    const updated = {
      ...rate,
      ...patch
    };
    setMetaRates(items => items.map(item => item.id === rate.id ? updated : item));
    try {
      await api.updateMetaBillingRate(rate.id, patch);
    } catch (err) {
      setError(err.message || tx("auto.k_0287890c2880"));
      await fetchMetaBilling();
    }
  };
  const updatePlan = async (plan, patch) => {
    const updated = {
      ...plan,
      ...patch
    };
    setPlans(items => items.map(item => item.id === plan.id ? updated : item));
    try {
      await api.updateBillingPlan(plan.id, patch);
    } catch (err) {
      setError(err.message || tx("auto.k_6c79c39c4c13"));
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
        status: accountForm.status
      });
      await fetchTenantBilling(selectedTenantId);
    } catch (err) {
      setError(err.message || tx("auto.k_ed4e42d58748"));
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
      setPaymentForm({
        credits: 100,
        amount_lyd: 0,
        method: 'manual',
        reference: '',
        note: ''
      });
    } catch (err) {
      setError(err.message || tx("auto.k_5708206ab3a8"));
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
      setAdjustmentForm({
        credits_delta: 0,
        reason: ''
      });
    } catch (err) {
      setError(err.message || tx("auto.k_b89a1f809d98"));
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
      setError(err.message || tx("auto.k_4a0cafc92b78"));
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
        ...metaInvoiceForm
      });
      setMetaInvoiceForm({
        invoice_number: '',
        currency: 'USD',
        subtotal_amount: 0,
        tax_amount: 0,
        total_amount: 0,
        period_start: '',
        period_end: '',
        notes: ''
      });
      await fetchMetaBilling();
    } catch (err) {
      setError(err.message || tx("auto.k_e79c505ccc14"));
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
        end_date: metaSyncForm.end_date
      });
      await fetchMetaBilling();
    } catch (err) {
      setError(err.message || tx("auto.k_095052c2cc0e"));
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
        ...metaUsageSyncForm
      });
      await fetchMetaBilling();
    } catch (err) {
      setError(err.message || tx("auto.k_a1c9dfb7a0e7"));
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
      setError(err.message || tx("auto.k_b52d13ea5a8d"));
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
      setError(err.message || tx("auto.k_dcc447093564"));
    } finally {
      setSaving(false);
    }
  };
  const importMetaRates = async file => {
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
      setError(err.message || tx("auto.k_2eaf1a968bbd"));
    } finally {
      setSaving(false);
    }
  };
  if (loading) {
    return <Box sx={{
      p: 3,
      display: 'flex',
      justifyContent: 'center'
    }}>
                <CircularProgress />
            </Box>;
  }
  return <Box sx={{
    p: {
      xs: 1.5,
      md: 3
    }
  }}>
            <Box sx={{
      display: 'flex',
      justifyContent: 'space-between',
      gap: 2,
      alignItems: 'center',
      mb: 3
    }}>
                <Box>
                    <Typography variant="h4" fontWeight={800}>{t('billing.adminTitle')}</Typography>
                    <Typography variant="body2" color="text.secondary">
                        {t('billing.adminSubtitle')}
                    </Typography>
                </Box>
                <Button startIcon={<RefreshIcon />} variant="outlined" onClick={fetchAll}>{t('common.refresh')}</Button>
            </Box>

            {error && <Alert severity="error" sx={{
      mb: 2
    }}>{error}</Alert>}

            <Paper sx={{
      mb: 3
    }}>
                <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable">
                    <Tab label={t('billing.tenantAccounts')} />
                    <Tab label={t('billing.plans')} />
                    <Tab label={t('billing.priceCatalog')} />
                    <Tab label={t('billing.ledgerInvoices')} />
                    <Tab label={t('billing.metaReconciliation')} />
                </Tabs>
            </Paper>

            {tab === 0 && <Grid container spacing={2}>
                    <Grid size={{
        xs: 12,
        md: 4
      }}>
                        <Paper sx={{
          p: 2
        }}>
                            <FormControl fullWidth sx={{
            mb: 2
          }}>
                                <InputLabel>{tx("auto.k_8adba91e1d87")}</InputLabel>
                                <Select value={selectedTenantId} label={tx("auto.k_8adba91e1d87")} onChange={e => handleTenantChange(e.target.value)}>
                                    {tenants.map(tenant => <MenuItem key={tenant.id} value={tenant.id}>{tenant.name}</MenuItem>)}
                                </Select>
                            </FormControl>
                            <FormControl fullWidth sx={{
            mb: 2
          }}>
                                <InputLabel>{tx("auto.k_bcbc8982094b")}</InputLabel>
                                <Select value={accountForm.plan_id} label={tx("auto.k_bcbc8982094b")} onChange={e => setAccountForm({
              ...accountForm,
              plan_id: e.target.value
            })}>

                                    <MenuItem value="">{tx("auto.k_668df42e5a10")}</MenuItem>
                                    {plans.map(plan => <MenuItem key={plan.id} value={plan.id}>{plan.name}</MenuItem>)}
                                </Select>
                            </FormControl>
                            <TextField fullWidth type="number" label={tx("auto.k_d806363e06a1")} value={accountForm.credit_limit_credits} onChange={e => setAccountForm({
            ...accountForm,
            credit_limit_credits: Number(e.target.value) || 0
          })} sx={{
            mb: 2
          }} />

                            <FormControl fullWidth sx={{
            mb: 2
          }}>
                                <InputLabel>{tx("auto.k_b2b02f1745b7")}</InputLabel>
                                <Select value={accountForm.status} label={tx("auto.k_b2b02f1745b7")} onChange={e => setAccountForm({
              ...accountForm,
              status: e.target.value
            })}>
                                    <MenuItem value="active">{tx("auto.k_41b054617ef6")}</MenuItem>
                                    <MenuItem value="suspended">{tx("auto.k_499473f337a4")}</MenuItem>
                                    <MenuItem value="closed">{tx("auto.k_d59687babb13")}</MenuItem>
                                </Select>
                            </FormControl>
                            <Button fullWidth variant="contained" startIcon={<SaveIcon />} onClick={saveAccount} disabled={saving || !selectedTenantId}>{tx("auto.k_04b4b72720b8")}

            </Button>
                        </Paper>
                    </Grid>
                    <Grid size={{
        xs: 12,
        md: 8
      }}>
                        <Grid container spacing={2}>
                            <Grid size={{
            xs: 12,
            sm: 6
          }}>
                                <StatCard title={tx("auto.k_19c61065a80f")} value={number(billing?.balances?.available_credits)} icon={<WalletIcon />} color="success" caption={selectedTenant?.name} />
                            </Grid>
                            <Grid size={{
            xs: 12,
            sm: 6
          }}>
                                <StatCard title={tx("auto.k_56ee8639d222")} value={number(billing?.balances?.plan_balance_credits)} icon={<PriceIcon />} caption={billing?.plan?.name || tx("auto.k_668df42e5a10")} />
                            </Grid>
                            <Grid size={{
            xs: 12,
            sm: 6
          }}>
                                <StatCard title={tx("auto.k_97935c71df7d")} value={number(billing?.balances?.wallet_balance_credits)} icon={<PaymentsIcon />} color="info" />
                            </Grid>
                            <Grid size={{
            xs: 12,
            sm: 6
          }}>
                                <StatCard title={tx("auto.k_924595cfad32")} value={`${number(billing?.balances?.credit_used_credits)} / ${number(billing?.balances?.credit_limit_credits)}`} icon={<InvoiceIcon />} color="warning" />
                            </Grid>
                        </Grid>
                        <Grid container spacing={2} sx={{
          mt: 0
        }}>
                            <Grid size={{
            xs: 12,
            md: 6
          }}>
                                <Paper sx={{
              p: 2,
              mt: 2
            }}>
                                    <Typography variant="h6" fontWeight={700} sx={{
                mb: 2
              }}>{tx("auto.k_f09fc7d9a59e")}</Typography>
                                    <TextField fullWidth type="number" label={tx("auto.k_f96a754ed8d1")} value={paymentForm.credits} onChange={e => setPaymentForm({
                ...paymentForm,
                credits: Number(e.target.value) || 0
              })} sx={{
                mb: 1.5
              }} />
                                    <TextField fullWidth type="number" label={tx("auto.k_c11d378314f1")} value={paymentForm.amount_lyd} onChange={e => setPaymentForm({
                ...paymentForm,
                amount_lyd: Number(e.target.value) || 0
              })} sx={{
                mb: 1.5
              }} />
                                    <TextField fullWidth label={tx("auto.k_09b0655d3971")} value={paymentForm.reference} onChange={e => setPaymentForm({
                ...paymentForm,
                reference: e.target.value
              })} sx={{
                mb: 1.5
              }} />
                                    <TextField fullWidth label={tx("auto.k_8fca520bb27c")} value={paymentForm.note} onChange={e => setPaymentForm({
                ...paymentForm,
                note: e.target.value
              })} sx={{
                mb: 1.5
              }} />
                                    <Button variant="contained" startIcon={<PaymentsIcon />} onClick={recordPayment} disabled={saving || paymentForm.credits <= 0}>{tx("auto.k_ecc36f8db0c3")}</Button>
                                </Paper>
                            </Grid>
                            <Grid size={{
            xs: 12,
            md: 6
          }}>
                                <Paper sx={{
              p: 2,
              mt: 2
            }}>
                                    <Typography variant="h6" fontWeight={700} sx={{
                mb: 2
              }}>{tx("auto.k_a7630d594814")}</Typography>
                                    <TextField fullWidth type="number" label={tx("auto.k_28ce80c8efbf")} value={adjustmentForm.credits_delta} onChange={e => setAdjustmentForm({
                ...adjustmentForm,
                credits_delta: Number(e.target.value) || 0
              })} sx={{
                mb: 1.5
              }} />
                                    <TextField fullWidth required label={tx("auto.k_77cca1b8184e")} value={adjustmentForm.reason} onChange={e => setAdjustmentForm({
                ...adjustmentForm,
                reason: e.target.value
              })} sx={{
                mb: 1.5
              }} />
                                    <Button variant="outlined" color="warning" onClick={recordAdjustment} disabled={saving || !adjustmentForm.reason || adjustmentForm.credits_delta === 0}>{tx("auto.k_9aef844e79db")}</Button>
                                </Paper>
                            </Grid>
                        </Grid>
                    </Grid>
                </Grid>}

            {tab === 1 && <Paper sx={{
      p: 2
    }}>
                    <Box sx={{
        display: 'flex',
        justifyContent: 'space-between',
        mb: 2
      }}>
                        <Typography variant="h6" fontWeight={700}>{tx("auto.k_bb94fce1191d")}</Typography>
                        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setPlanDialog(true)}>{tx("auto.k_92ad913d6acc")}</Button>
                    </Box>
                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>{tx("auto.k_9fcc5a6d609e")}</TableCell>
                                    <TableCell>{tx("auto.k_0a92494ea1eb")}</TableCell>
                                    <TableCell>{tx("auto.k_953cba636740")}</TableCell>
                                    <TableCell>{tx("auto.k_833cd32e86e2")}</TableCell>
                                    <TableCell>{tx("auto.k_5b7c2c9d7d0a")}</TableCell>
                                    <TableCell>{tx("auto.k_d6370401145d")}</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {plans.map(plan => <TableRow key={plan.id}>
                                        <TableCell>{plan.code}</TableCell>
                                        <TableCell>{plan.name}</TableCell>
                                        <TableCell sx={{
                width: 140
              }}>
                                            <TextField size="small" type="number" value={plan.monthly_price_lyd} onChange={e => setPlans(items => items.map(item => item.id === plan.id ? {
                  ...item,
                  monthly_price_lyd: Number(e.target.value) || 0
                } : item))} onBlur={e => updatePlan(plan, {
                  monthly_price_lyd: Number(e.target.value) || 0
                })} />

                                        </TableCell>
                                        <TableCell sx={{
                width: 140
              }}>
                                            <TextField size="small" type="number" value={plan.monthly_included_credits} onChange={e => setPlans(items => items.map(item => item.id === plan.id ? {
                  ...item,
                  monthly_included_credits: Number(e.target.value) || 0
                } : item))} onBlur={e => updatePlan(plan, {
                  monthly_included_credits: Number(e.target.value) || 0
                })} />

                                        </TableCell>
                                        <TableCell sx={{
                width: 140
              }}>
                                            <TextField size="small" type="number" value={plan.default_credit_limit} onChange={e => setPlans(items => items.map(item => item.id === plan.id ? {
                  ...item,
                  default_credit_limit: Number(e.target.value) || 0
                } : item))} onBlur={e => updatePlan(plan, {
                  default_credit_limit: Number(e.target.value) || 0
                })} />

                                        </TableCell>
                                        <TableCell>
                                            <FormControlLabel control={<Switch checked={!!plan.is_active} onChange={e => updatePlan(plan, {
                  is_active: e.target.checked
                })} />} label={plan.is_active ? tx("auto.k_6cf44b8c32d1") : tx("auto.k_5b23306afcb3")} />

                                        </TableCell>
                                    </TableRow>)}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Paper>}

            {tab === 2 && <Paper sx={{
      p: 2
    }}>
                    <Typography variant="h6" fontWeight={700} sx={{
        mb: 2
      }}>{tx("auto.k_ae688396bda1")}</Typography>
                    <Alert severity="info" sx={{
        mb: 2
      }}>{tx("auto.k_c8c97810efe4")}

        </Alert>
                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>{tx("auto.k_0b4273bee983")}</TableCell>
                                    <TableCell>{tx("auto.k_f8046d0fb62a")}</TableCell>
                                    <TableCell>{tx("auto.k_0a92494ea1eb")}</TableCell>
                                    <TableCell>{tx("auto.k_c998673fa80f")}</TableCell>
                                    <TableCell>{tx("auto.k_e86eeb2d427a")}</TableCell>
                                    <TableCell>{tx("auto.k_2dae571fb604")}</TableCell>
                                    <TableCell>{tx("auto.k_40af5dffb316")}</TableCell>
                                    <TableCell>{tx("auto.k_6cf44b8c32d1")}</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {prices.map(price => {
              const metaReference = getMetaReferenceForPrice(price, metaRates, metaExchangeRate);
              return <TableRow key={price.id}>
                                            <TableCell>{price.channel}</TableCell>
                                            <TableCell>{price.operation_key}</TableCell>
                                            <TableCell>{price.display_name_ar}</TableCell>
                                            <TableCell sx={{
                  width: 120
                }}>
                                                <TextField size="small" type="number" value={price.unit_price_credits} onChange={e => setPrices(items => items.map(item => item.id === price.id ? {
                    ...item,
                    unit_price_credits: Number(e.target.value) || 0
                  } : item))} onBlur={e => updatePrice(price, {
                    unit_price_credits: Number(e.target.value) || 0
                  })} />

                                            </TableCell>
                                            <TableCell sx={{
                  minWidth: 180
                }}>
                                                <FormControl fullWidth size="small">
                                                    <Select value={price.local_pricing_model || 'fixed'} onChange={e => updatePrice(price, {
                      local_pricing_model: e.target.value
                    })}>

                                                        <MenuItem value="fixed">{tx("auto.k_29117462682c")}</MenuItem>
                                                        <MenuItem value="meta_like">{tx("auto.k_53f8b7daf69f")}</MenuItem>
                                                        <MenuItem value="meta_cost_plus_credits">{t('billing.metaCostPlusCredits')}</MenuItem>
                                                    </Select>
                                                </FormControl>
                                                <Typography variant="caption" color="text.secondary" display="block" sx={{
                    mt: 0.5
                  }}>
                                                    {price.local_pricing_model === 'meta_cost_plus_credits' ? t('billing.metaCostPlusHint') : price.local_pricing_model === 'meta_like' ? tx("auto.k_d24f8118b42a") : tx("auto.k_42127c419fee")}
                                                </Typography>
                                            </TableCell>
                                            <TableCell sx={{
                  minWidth: 220
                }}>
                                                <Chip size="small" label={metaReference.label} color={metaReference.color} sx={{
                    mb: 0.5
                  }} />
                                                <Typography variant="caption" color="text.secondary" display="block">
                                                    {metaReference.caption}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>
                                                <FormControlLabel control={<Switch checked={!!price.is_billable} onChange={e => updatePrice(price, {
                    is_billable: e.target.checked
                  })} />} label="" />

                                            </TableCell>
                                            <TableCell>
                                                <FormControlLabel control={<Switch checked={!!price.is_active} onChange={e => updatePrice(price, {
                    is_active: e.target.checked
                  })} />} label="" />

                                            </TableCell>
                                        </TableRow>;
            })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Paper>}

            {tab === 3 && <Grid container spacing={2}>
                    <Grid size={{
        xs: 12,
        md: 8
      }}>
                        <Paper sx={{
          p: 2
        }}>
                            <Typography variant="h6" fontWeight={700} sx={{
            mb: 2
          }}>{tx("auto.k_e50acc511afa")}</Typography>
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>{tx("auto.k_ba6b401d8f75")}</TableCell>
                                            <TableCell>{tx("auto.k_033626158b17")}</TableCell>
                                            <TableCell>{tx("auto.k_a9965b94a4b8")}</TableCell>
                                            <TableCell>{tx("auto.k_5d5ee97e54a7")}</TableCell>
                                            <TableCell>{tx("auto.k_06ae16ece017")}</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {(billing?.recent_ledger || []).map(entry => <TableRow key={entry.id}>
                                                <TableCell>{entry.created_at}</TableCell>
                                                <TableCell>{entry.entry_type}</TableCell>
                                                <TableCell>{entry.description}</TableCell>
                                                <TableCell>{number(entry.credits_delta)}</TableCell>
                                                <TableCell>{number(entry.balance_after_credits)}</TableCell>
                                            </TableRow>)}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Paper>
                    </Grid>
                    <Grid size={{
        xs: 12,
        md: 4
      }}>
                        <Paper sx={{
          p: 2
        }}>
                            <Typography variant="h6" fontWeight={700} sx={{
            mb: 2
          }}>{tx("auto.k_38bd1a4075c9")}</Typography>
                            <Button fullWidth variant="contained" startIcon={<InvoiceIcon />} onClick={createInvoice} disabled={saving || !selectedTenantId} sx={{
            mb: 2
          }}>{tx("auto.k_4cd45c59045b")}

            </Button>
                            {billing?.last_invoice ? <Box>
                                    <Typography variant="body2">{tx("auto.k_642546926c1e")}{billing.last_invoice.invoice_number}</Typography>
                                    <Typography variant="body2">{tx("auto.k_80e0b0b9b798")}{billing.last_invoice.status}</Typography>
                                    <Typography variant="body2">{tx("auto.k_2ab1fed1ce3e")}{number(billing.last_invoice.subtotal_credits)}</Typography>
                                </Box> : <Alert severity="info">{tx("auto.k_755eecdefd8e")}</Alert>}
                        </Paper>
                    </Grid>
                </Grid>}

            {tab === 4 && <Grid container spacing={2}>
                    <Grid size={{
        xs: 12,
        md: 3
      }}>
                        <StatCard title={tx("auto.k_00375903c85b")} value={money(reconciliationMetrics?.comparison?.meta_cost_amount ?? latestMetaSnapshot?.meta_cost_amount, metaDisplayCurrency)} icon={<InvoiceIcon />} color="error" caption={tx("auto.k_71a62f0f271f", {
          value1: money(metaCostLyd, 'LYD')
        })} />

                    </Grid>
                    <Grid size={{
        xs: 12,
        md: 3
      }}>
                        <StatCard title={tx("auto.k_26b8103a9a16")} value={number(reconciliationMetrics?.counts?.final_count ?? metaSummary?.totals?.priced_count)} icon={<PriceIcon />} color="warning" caption={money(reconciliationMetrics?.comparison?.local_final_amount ?? metaSummary?.totals?.final_amount, metaDisplayCurrency)} />

                    </Grid>
                    <Grid size={{
        xs: 12,
        md: 3
      }}>
                        <StatCard title={tx("auto.k_820d500f0bdc")} value={number(reconciliationMetrics?.counts?.pending_count ?? 0)} icon={<RefreshIcon />} color="warning" caption={tx("auto.k_dfaf53eef717")} />

                    </Grid>
                    <Grid size={{
        xs: 12,
        md: 3
      }}>
                        <StatCard title={tx("auto.k_0a7ad48a4a62")} value={number(reconciliationMetrics?.counts?.needs_action_count ?? metaSummary?.totals?.rate_missing_count)} icon={<InvoiceIcon />} color={reconciliationPeriod?.status === 'needs_review' ? 'error' : 'info'} caption={tx("auto.k_e5656623d9d7", {
          value1: reconciliationPeriod?.status || reconciliationMetrics?.status || 'open'
        })} />

                    </Grid>

                    <Grid size={{
        xs: 12
      }}>
                        <Paper sx={{
          p: 2
        }}>
                            <Box sx={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 2,
            flexWrap: 'wrap',
            mb: 2
          }}>
                                <Box>
                                    <Typography variant="h6" fontWeight={700}>Meta Cost Reconciliation</Typography>
                                    <Typography variant="body2" color="text.secondary">{tx("auto.k_6aa481fce38d")}

                </Typography>
                                </Box>
                                <Button startIcon={<SyncIcon />} variant="contained" onClick={syncMetaUsage} disabled={saving || !selectedTenantId || !metaUsageSyncForm.period_start || !metaUsageSyncForm.period_end}>{tx("auto.k_6fe58f7ebf5a")}

              </Button>
                            </Box>
                            <Grid container spacing={1.5}>
                                <Grid size={{
              xs: 12,
              sm: 4
            }}>
                                    <TextField fullWidth type="date" label={tx("auto.k_aa7099e27834")} InputLabelProps={{
                shrink: true
              }} value={metaUsageSyncForm.period_start} onChange={e => setMetaUsageSyncForm({
                ...metaUsageSyncForm,
                period_start: e.target.value
              })} />
                                </Grid>
                                <Grid size={{
              xs: 12,
              sm: 4
            }}>
                                    <TextField fullWidth type="date" label={tx("auto.k_8ab80326e0b9")} InputLabelProps={{
                shrink: true
              }} value={metaUsageSyncForm.period_end} onChange={e => setMetaUsageSyncForm({
                ...metaUsageSyncForm,
                period_end: e.target.value
              })} />
                                </Grid>
                                <Grid size={{
              xs: 12,
              sm: 4
            }}>
                                    <FormControl fullWidth>
                                        <InputLabel>{tx("auto.k_6da4121902b3")}</InputLabel>
                                        <Select value={metaUsageSyncForm.granularity} label={tx("auto.k_6da4121902b3")} onChange={e => setMetaUsageSyncForm({
                  ...metaUsageSyncForm,
                  granularity: e.target.value
                })}>
                                            <MenuItem value="MONTHLY">{tx("auto.k_564ef2249a86")}</MenuItem>
                                            <MenuItem value="DAILY">{tx("auto.k_71f84fd265ec")}</MenuItem>
                                        </Select>
                                    </FormControl>
                                </Grid>
                            </Grid>
                            {(reconciliationPeriod || reconciliationMetrics) && <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
            mt: 2
          }}>
                                    <Chip label={reconciliationPeriod?.status || reconciliationMetrics?.status || 'open'} color={(reconciliationPeriod?.status || reconciliationMetrics?.status) === 'needs_review' ? 'error' : 'success'} />

                                    {reconciliationPeriod?.id && reconciliationPeriod.status === 'needs_review' && <Button size="small" variant="outlined" onClick={markMetaReconciliationReviewed} disabled={saving}>{tx("auto.k_1d77091113b0")}

              </Button>}
                                    <Typography variant="caption" color="text.secondary">
                                        threshold: 0.01 {metaDisplayCurrency || 'USD'}{tx("auto.k_8bbd0433fc05")}
              </Typography>
                                </Box>}
                            {activeMetaComparison && <Grid container spacing={1.5} sx={{
            mt: 2
          }}>
                                    <Grid size={{
              xs: 12,
              md: 3
            }}>
                                        <Alert severity={Math.abs(activeMetaComparison.diff_sent) > 0 ? 'warning' : 'success'}>
                                            Meta sent: {number(activeMetaComparison.meta_sent)}{tx("auto.k_01ad001d5557")}{number(activeMetaComparison.local_sent)}
                                        </Alert>
                                    </Grid>
                                    <Grid size={{
              xs: 12,
              md: 3
            }}>
                                        <Alert severity={Math.abs(activeMetaComparison.diff_delivered) > 0 ? 'warning' : 'success'}>
                                            Meta delivered: {number(activeMetaComparison.meta_delivered)}{tx("auto.k_01ad001d5557")}{number(activeMetaComparison.local_delivered)}
                                        </Alert>
                                    </Grid>
                                    <Grid size={{
              xs: 12,
              md: 3
            }}>
                                        <Alert severity={Math.abs(activeMetaComparison.diff_meta_vs_local_cost) > 0.01 ? 'warning' : 'success'}>
                                            Meta cost: {money(activeMetaComparison.meta_cost_amount, metaDisplayCurrency)}
                                        </Alert>
                                    </Grid>
                                    <Grid size={{
              xs: 12,
              md: 3
            }}>
                                        <Alert severity={Math.abs(activeMetaComparison.diff_invoice_vs_local_cost) > 0.01 ? 'warning' : 'info'}>
                                            Invoice total: {money(activeMetaComparison.invoice_total_amount, metaDisplayCurrency)}
                                        </Alert>
                                    </Grid>
                                </Grid>}
                        </Paper>
                    </Grid>

                    <Grid size={{
        xs: 12,
        md: 5
      }}>
                        <Paper sx={{
          p: 2
        }}>
                            <Typography variant="h6" fontWeight={700} sx={{
            mb: 1
          }}>{tx("auto.k_d9511638209e")}</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{
            mb: 2
          }}>{tx("auto.k_6b938adb4f19")}

            </Typography>
                            <Alert severity="warning" sx={{
              mb: 2
            }}>{t('billing.whatsappWindowPricingWarning')}</Alert>
                            <Grid container spacing={1.5}>
                                <Grid size={{
              xs: 12,
              sm: 6
            }}>
                                    <TextField fullWidth type="number" label={tx("auto.k_419632cdb375")} value={metaSettings.meta_cost_exchange_rate_to_lyd} onChange={e => setMetaSettings({
                ...metaSettings,
                meta_cost_exchange_rate_to_lyd: Number(e.target.value) || 1
              })} />

                                </Grid>
                                <Grid size={{
              xs: 12,
              sm: 6
            }}>
                                    <TextField fullWidth type="number" label={t('billing.creditValueLyd')} value={metaSettings.credit_value_lyd} onChange={e => setMetaSettings({
                ...metaSettings,
                credit_value_lyd: Number(e.target.value) || 0.1
              })} />

                                </Grid>
                                <Grid size={{
              xs: 12,
              sm: 6
            }}>
                                    <TextField fullWidth type="number" label={t('billing.metaMarginPercent')} value={metaSettings.meta_cost_margin_percent} onChange={e => setMetaSettings({
                ...metaSettings,
                meta_cost_margin_percent: Number(e.target.value) || 0
              })} />

                                </Grid>
                                <Grid size={{
              xs: 12,
              sm: 6
            }}>
                                    <FormControlLabel control={<Switch checked={!!metaSettings.strict_meta_rate_required} onChange={e => setMetaSettings({
                  ...metaSettings,
                  strict_meta_rate_required: e.target.checked
                })} />} label={t('billing.strictMetaRateRequired')} />

                                </Grid>
                                <Grid size={{
              xs: 12
            }}>
                                    <TextField fullWidth label={tx("auto.k_198a82b3b10b")} value={metaSettings.meta_cost_margin_note} onChange={e => setMetaSettings({
                ...metaSettings,
                meta_cost_margin_note: e.target.value
              })} />

                                </Grid>
                            </Grid>
                            <Box sx={{
            display: 'flex',
            gap: 1,
            alignItems: 'center',
            mt: 2,
            flexWrap: 'wrap'
          }}>
                                <Button variant="contained" startIcon={<SaveIcon />} onClick={saveMetaSettings} disabled={saving}>{tx("auto.k_a5b4472cdfcd")}

              </Button>
                                <Typography variant="body2" color="text.secondary">
                                    Meta: {money(activeMetaComparison?.meta_cost_amount, metaDisplayCurrency)} / LYD: {money(metaCostLyd, 'LYD')}
                                </Typography>
                            </Box>
                        </Paper>
                    </Grid>

                    <Grid size={{
        xs: 12,
        md: 7
      }}>
                        <Paper sx={{
          p: 2
        }}>
                            <Typography variant="h6" fontWeight={700} sx={{
            mb: 2
          }}>{tx("auto.k_f1cf3d56f4d6")}</Typography>
                            {(metaReconciliation?.action_items || []).length === 0 ? <Alert severity="success">{tx("auto.k_0e1d52d8555d")}</Alert> : <TableContainer sx={{
            maxHeight: 260
          }}>
                                    <Table size="small" stickyHeader>
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>{tx("auto.k_ba6b401d8f75")}</TableCell>
                                                <TableCell>{tx("auto.k_f8046d0fb62a")}</TableCell>
                                                <TableCell>{tx("auto.k_a2e93da9b043")}</TableCell>
                                                <TableCell>WAMID</TableCell>
                                                <TableCell>{tx("auto.k_d6370401145d")}</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {(metaReconciliation?.action_items || []).map(item => <TableRow key={item.id}>
                                                    <TableCell>{item.committed_at || item.reserved_at}</TableCell>
                                                    <TableCell>{item.operation_key}</TableCell>
                                                    <TableCell>{item.action_reason}</TableCell>
                                                    <TableCell>{item.reference_id || '-'}</TableCell>
                                                    <TableCell>
                                                        <Chip size="small" label={item.meta_charge_status || '-'} />
                                                    </TableCell>
                                                </TableRow>)}
                                        </TableBody>
                                    </Table>
                                </TableContainer>}
                        </Paper>
                    </Grid>

                    <Grid size={{
        xs: 12,
        lg: 5
      }}>
                        <Paper sx={{
          p: 2
        }}>
                            <Typography variant="h6" fontWeight={700} sx={{
            mb: 1
          }}>{tx("auto.k_d5c8692636a9")}</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{
            mb: 2
          }}>{tx("auto.k_173ed7b7454b")}

            </Typography>
                            <Grid container spacing={1.5}>
                                <Grid size={{
              xs: 6
            }}>
                                    <TextField fullWidth label={tx("auto.k_febe1c51b158")} value={metaRateForm.country_calling_code} onChange={e => setMetaRateForm({
                ...metaRateForm,
                country_calling_code: e.target.value
              })} />
                                </Grid>
                                <Grid size={{
              xs: 6
            }}>
                                    <TextField fullWidth label={tx("auto.k_d8b2c7d37096")} value={metaRateForm.market_name} onChange={e => setMetaRateForm({
                ...metaRateForm,
                market_name: e.target.value
              })} />
                                </Grid>
                                <Grid size={{
              xs: 6
            }}>
                                    <FormControl fullWidth>
                                        <InputLabel>{tx("auto.k_59de6a8f17f5")}</InputLabel>
                                        <Select value={metaRateForm.category} label={tx("auto.k_59de6a8f17f5")} onChange={e => setMetaRateForm({
                  ...metaRateForm,
                  category: e.target.value
                })}>
                                            <MenuItem value="marketing">marketing</MenuItem>
                                            <MenuItem value="utility">utility</MenuItem>
                                            <MenuItem value="authentication">authentication</MenuItem>
                                            <MenuItem value="authentication_international">authentication international</MenuItem>
                                            <MenuItem value="service">service</MenuItem>
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid size={{
              xs: 6
            }}>
                                    <TextField fullWidth label={tx("auto.k_b9357d9161f2")} value={metaRateForm.currency} onChange={e => setMetaRateForm({
                ...metaRateForm,
                currency: e.target.value.toUpperCase()
              })} />
                                </Grid>
                                <Grid size={{
              xs: 6
            }}>
                                    <TextField fullWidth type="number" label={tx("auto.k_4f8ed77246b1")} value={metaRateForm.rate_amount} onChange={e => setMetaRateForm({
                ...metaRateForm,
                rate_amount: Number(e.target.value) || 0
              })} />
                                </Grid>
                                <Grid size={{
              xs: 6
            }}>
                                    <TextField fullWidth type="date" label={tx("auto.k_f5edd731e691")} InputLabelProps={{
                shrink: true
              }} value={metaRateForm.effective_from} onChange={e => setMetaRateForm({
                ...metaRateForm,
                effective_from: e.target.value
              })} />
                                </Grid>
                            </Grid>
                            <Button sx={{
            mt: 2
          }} variant="contained" onClick={createMetaRate} disabled={saving || !metaRateForm.country_calling_code || !metaRateForm.category}>{tx("auto.k_592ec1bc9d4f")}

            </Button>
                            <Button sx={{
            mt: 2,
            mx: 1
          }} variant="outlined" startIcon={<UploadIcon />} component="label" disabled={saving}>{tx("auto.k_e551e1bff940")}

              <input hidden type="file" accept=".csv,text/csv" onChange={e => importMetaRates(e.target.files?.[0])} />
                            </Button>
                            {importResult && <Alert severity={importResult.failed > 0 ? 'warning' : 'success'} sx={{
            mt: 2
          }}>{tx("auto.k_92df2531b039")}
              {number(importResult.imported)}{tx("auto.k_bfbf845ea5d2")}{number(importResult.created)}{tx("auto.k_abfe0372d3ca")}{number(importResult.updated)}{tx("auto.k_6313ae1e7e02")}{number(importResult.failed)}
                                </Alert>}
                        </Paper>
                    </Grid>

                    <Grid size={{
        xs: 12,
        lg: 7
      }}>
                        <Paper sx={{
          p: 2
        }}>
                            <Typography variant="h6" fontWeight={700} sx={{
            mb: 2
          }}>{tx("auto.k_05831e8eabe0")}</Typography>
                            <TableContainer sx={{
            maxHeight: 320
          }}>
                                <Table size="small" stickyHeader>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>{tx("auto.k_fb92e7003c18")}</TableCell>
                                            <TableCell>{tx("auto.k_d8b2c7d37096")}</TableCell>
                                            <TableCell>{tx("auto.k_59de6a8f17f5")}</TableCell>
                                            <TableCell>{tx("auto.k_b9357d9161f2")}</TableCell>
                                            <TableCell>{tx("auto.k_b6aa0c7d7a21")}</TableCell>
                                            <TableCell>{tx("auto.k_41b054617ef6")}</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {metaRates.map(rate => <TableRow key={rate.id}>
                                                <TableCell>{rate.country_calling_code}</TableCell>
                                                <TableCell>{rate.market_name || '-'}</TableCell>
                                                <TableCell>{rate.category}</TableCell>
                                                <TableCell>{rate.currency}</TableCell>
                                                <TableCell sx={{
                    width: 130
                  }}>
                                                    <TextField size="small" type="number" value={rate.rate_amount} onChange={e => setMetaRates(items => items.map(item => item.id === rate.id ? {
                      ...item,
                      rate_amount: Number(e.target.value) || 0
                    } : item))} onBlur={e => updateMetaRate(rate, {
                      rate_amount: Number(e.target.value) || 0
                    })} />

                                                </TableCell>
                                                <TableCell>
                                                    <Switch checked={!!rate.is_active} onChange={e => updateMetaRate(rate, {
                      is_active: e.target.checked
                    })} />
                                                </TableCell>
                                            </TableRow>)}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Paper>
                    </Grid>

                    <Grid size={{
        xs: 12,
        lg: 7
      }}>
                        <Paper sx={{
          p: 2
        }}>
                            <Typography variant="h6" fontWeight={700} sx={{
            mb: 2
          }}>{tx("auto.k_eac86d7c9252")}</Typography>
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>{tx("auto.k_ba6b401d8f75")}</TableCell>
                                            <TableCell>{tx("auto.k_8adba91e1d87")}</TableCell>
                                            <TableCell>{tx("auto.k_59de6a8f17f5")}</TableCell>
                                            <TableCell>{tx("auto.k_d6370401145d")}</TableCell>
                                            <TableCell>{tx("auto.k_6f5f53d95ee3")}</TableCell>
                                            <TableCell>{tx("auto.k_087aa06ded3f")}</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {metaUsage.map(usage => <TableRow key={usage.id}>
                                                <TableCell>{usage.meta_priced_at || usage.committed_at || usage.reserved_at}</TableCell>
                                                <TableCell>{usage.tenant_name || usage.tenant_id}</TableCell>
                                                <TableCell>{usage.meta_charge_category || '-'}</TableCell>
                                                <TableCell>
                                                    <Chip size="small" label={usage.meta_charge_status || '-'} />
                                                </TableCell>
                                                <TableCell>{money(usage.meta_estimated_amount, usage.meta_charge_currency)}</TableCell>
                                                <TableCell>{money(usage.meta_final_amount, usage.meta_charge_currency)}</TableCell>
                                            </TableRow>)}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Paper>
                    </Grid>

                    <Grid size={{
        xs: 12,
        lg: 5
      }}>
                        <Paper sx={{
          p: 2
        }}>
                            <Typography variant="h6" fontWeight={700} sx={{
            mb: 2
          }}>{tx("auto.k_a7e84c720a24")}</Typography>
                            <Grid container spacing={1.5} sx={{
            mb: 2
          }}>
                                <Grid size={{
              xs: 6
            }}>
                                    <TextField fullWidth type="date" label={tx("auto.k_aa7099e27834")} InputLabelProps={{
                shrink: true
              }} value={metaSyncForm.start_date} onChange={e => setMetaSyncForm({
                ...metaSyncForm,
                start_date: e.target.value
              })} />
                                </Grid>
                                <Grid size={{
              xs: 6
            }}>
                                    <TextField fullWidth type="date" label={tx("auto.k_8ab80326e0b9")} InputLabelProps={{
                shrink: true
              }} value={metaSyncForm.end_date} onChange={e => setMetaSyncForm({
                ...metaSyncForm,
                end_date: e.target.value
              })} />
                                </Grid>
                            </Grid>
                            <Button fullWidth variant="outlined" startIcon={<SyncIcon />} onClick={syncMetaInvoices} disabled={saving || !selectedTenantId || !metaSyncForm.start_date || !metaSyncForm.end_date} sx={{
            mb: 2
          }}>{tx("auto.k_c82d23030bca")}

            </Button>

                            <Grid container spacing={1.5}>
                                <Grid size={{
              xs: 12
            }}>
                                    <TextField fullWidth label={tx("auto.k_58935da43b4a")} value={metaInvoiceForm.invoice_number} onChange={e => setMetaInvoiceForm({
                ...metaInvoiceForm,
                invoice_number: e.target.value
              })} />
                                </Grid>
                                <Grid size={{
              xs: 4
            }}>
                                    <TextField fullWidth label={tx("auto.k_b9357d9161f2")} value={metaInvoiceForm.currency} onChange={e => setMetaInvoiceForm({
                ...metaInvoiceForm,
                currency: e.target.value.toUpperCase()
              })} />
                                </Grid>
                                <Grid size={{
              xs: 4
            }}>
                                    <TextField fullWidth type="number" label={tx("auto.k_413c51af19b5")} value={metaInvoiceForm.total_amount} onChange={e => setMetaInvoiceForm({
                ...metaInvoiceForm,
                total_amount: Number(e.target.value) || 0
              })} />
                                </Grid>
                                <Grid size={{
              xs: 4
            }}>
                                    <TextField fullWidth type="number" label={tx("auto.k_80769ab29a75")} value={metaInvoiceForm.tax_amount} onChange={e => setMetaInvoiceForm({
                ...metaInvoiceForm,
                tax_amount: Number(e.target.value) || 0
              })} />
                                </Grid>
                            </Grid>
                            <Button sx={{
            mt: 2
          }} variant="contained" onClick={createMetaInvoice} disabled={saving || !selectedTenantId}>{tx("auto.k_b4baced949b8")}

            </Button>

                            <Box sx={{
            mt: 2,
            display: 'grid',
            gap: 1
          }}>
                                {metaInvoices.map(invoice => <Paper key={invoice.id} variant="outlined" sx={{
              p: 1.5
            }}>
                                        <Typography variant="body2" fontWeight={700}>{invoice.invoice_number}</Typography>
                                        <Typography variant="caption" color="text.secondary">{invoice.period_start || '-'} → {invoice.period_end || '-'}</Typography>
                                        <Typography variant="body2">{money(invoice.total_amount, invoice.currency)}</Typography>
                                    </Paper>)}
                            </Box>
                        </Paper>
                    </Grid>

                    <Grid size={{
        xs: 12
      }}>
                        <Paper sx={{
          p: 2
        }}>
                            <Typography variant="h6" fontWeight={700} sx={{
            mb: 2
          }}>{tx("auto.k_7848c6910def")}</Typography>
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>{tx("auto.k_ba6b401d8f75")}</TableCell>
                                            <TableCell>{tx("auto.k_42cd7d14646e")}</TableCell>
                                            <TableCell>{tx("auto.k_d6370401145d")}</TableCell>
                                            <TableCell>Meta sent</TableCell>
                                            <TableCell>Local sent</TableCell>
                                            <TableCell>Meta cost</TableCell>
                                            <TableCell>Local final</TableCell>
                                            <TableCell>Invoice</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {metaSnapshots.map(snapshot => <TableRow key={snapshot.id}>
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
                                            </TableRow>)}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Paper>
                    </Grid>
                </Grid>}

            <Dialog open={planDialog} onClose={() => setPlanDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{tx("auto.k_511bb0b3792a")}</DialogTitle>
                <DialogContent sx={{
        display: 'grid',
        gap: 2,
        pt: 2
      }}>
                    <TextField label={tx("auto.k_9fcc5a6d609e")} value={planForm.code} onChange={e => setPlanForm({
          ...planForm,
          code: e.target.value
        })} />
                    <TextField label={tx("auto.k_0a92494ea1eb")} value={planForm.name} onChange={e => setPlanForm({
          ...planForm,
          name: e.target.value
        })} />
                    <TextField label={tx("auto.k_a9965b94a4b8")} value={planForm.description} onChange={e => setPlanForm({
          ...planForm,
          description: e.target.value
        })} />
                    <TextField type="number" label={tx("auto.k_cf6667c37cb3")} value={planForm.monthly_price_lyd} onChange={e => setPlanForm({
          ...planForm,
          monthly_price_lyd: Number(e.target.value) || 0
        })} />
                    <TextField type="number" label={tx("auto.k_34934a8b3f39")} value={planForm.monthly_included_credits} onChange={e => setPlanForm({
          ...planForm,
          monthly_included_credits: Number(e.target.value) || 0
        })} />
                    <TextField type="number" label={tx("auto.k_5b7c2c9d7d0a")} value={planForm.default_credit_limit} onChange={e => setPlanForm({
          ...planForm,
          default_credit_limit: Number(e.target.value) || 0
        })} />
                    <FormControlLabel control={<Switch checked={planForm.is_active} onChange={e => setPlanForm({
          ...planForm,
          is_active: e.target.checked
        })} />} label={tx("auto.k_6cf44b8c32d1")} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPlanDialog(false)}>{tx("auto.k_e776b0209b50")}</Button>
                    <Button variant="contained" onClick={createPlan} disabled={saving || !planForm.code || !planForm.name}>{tx("auto.k_8a1d0b74e145")}</Button>
                </DialogActions>
            </Dialog>
        </Box>;
};
export default BillingManager;
