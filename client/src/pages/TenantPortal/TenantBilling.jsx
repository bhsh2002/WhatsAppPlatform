import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Grid,
    Paper,
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
    AccountBalanceWallet as WalletIcon,
    Payments as PaymentsIcon,
    ReceiptLong as InvoiceIcon,
    Refresh as RefreshIcon,
    TrendingUp as UsageIcon,
} from '@mui/icons-material';
import api from '../../api';
import { useLanguage } from '../../context/LanguageContext';
import { MetricValue, PageTitle, SectionTitle } from '../../components/Layout/PageTitle';

const StatCard = ({ title, value, icon, color = 'primary', caption }) => (
    <Card elevation={1} sx={{ height: '100%' }}>
        <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                <Box>
                    <Typography variant="body2" color="text.secondary">{title}</Typography>
                    <MetricValue variant="h5" fontWeight={800} sx={{ mt: 1 }}>{value}</MetricValue>
                    {caption && <Typography variant="caption" color="text.secondary">{caption}</Typography>}
                </Box>
                <Box sx={{ color: `${color}.main`, display: 'flex', alignItems: 'center' }}>{icon}</Box>
            </Box>
        </CardContent>
    </Card>
);

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
};
const defaultPeriod = () => ({
    period_start: monthStartIso(),
    period_end: todayIso(),
});

const TenantBilling = () => {
    const { locale, t } = useLanguage();
    const [summary, setSummary] = useState(null);
    const [ledger, setLedger] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [centralSubscription, setCentralSubscription] = useState(null);
    const [periodForm, setPeriodForm] = useState(defaultPeriod);
    const [appliedPeriod, setAppliedPeriod] = useState(defaultPeriod);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [checkoutWorking, setCheckoutWorking] = useState('');
    const [checkoutMessage, setCheckoutMessage] = useState('');

    const fetchBilling = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const [summaryData, ledgerData, invoicesData, centralData] = await Promise.all([
                api.getPortalBillingSummary(appliedPeriod),
                api.getPortalBillingLedger({ limit: 10 }),
                api.getPortalBillingInvoices({ limit: 5 }),
                api.getPortalCentralSubscription(),
            ]);
            setSummary(summaryData);
            setLedger(ledgerData.ledger || []);
            setCentralSubscription(centralData);
            setInvoices(
                centralData?.managed_centrally
                    ? (centralData.invoices || []).map(invoice => ({
                        ...invoice,
                        invoice_number: invoice.number,
                        subtotal_credits: invoice.total_minor,
                    }))
                    : (invoicesData.invoices || [])
            );
        } catch (err) {
            setError(err.message || t('billing.fetchFailed'));
        } finally {
            setLoading(false);
        }
    }, [appliedPeriod, t]);

    const applyPeriod = useCallback(() => {
        const nextPeriod = { ...periodForm };
        if (
            nextPeriod.period_start === appliedPeriod.period_start
            && nextPeriod.period_end === appliedPeriod.period_end
        ) {
            fetchBilling();
            return;
        }
        setAppliedPeriod(nextPeriod);
    }, [appliedPeriod, fetchBilling, periodForm]);

    useEffect(() => {
        fetchBilling();
    }, [fetchBilling]);

    const checkout = async (kind, offer) => {
        setCheckoutWorking(offer.id);
        setCheckoutMessage('');
        setError(null);
        try {
            const price = kind === 'plan'
                ? offer.prices?.find(item => item.active)
                : null;
            const result = await api.checkoutPortalCentralSubscription({
                ...(kind === 'plan'
                    ? { plan_id: offer.id, price_id: price?.id }
                    : { bundle_id: offer.id }),
                idempotency_key: `wa-savana-checkout-${crypto.randomUUID()}`,
            });
            const invoice = result?.invoice;
            setCheckoutMessage(
                invoice
                    ? `تم إنشاء طلب الاشتراك والفاتورة ${invoice.number}.`
                    : 'تم إنشاء طلب الاشتراك المركزي بنجاح.'
            );
            await fetchBilling();
        } catch (checkoutError) {
            setError(checkoutError.message || 'تعذر إنشاء الاشتراك المركزي.');
        } finally {
            setCheckoutWorking('');
        }
    };

    if (loading) {
        return (
            <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress />
            </Box>
        );
    }

    const balances = summary?.balances || {};
    const plan = centralSubscription?.managed_centrally
        ? centralSubscription.active_plan
        : summary?.plan;
    const centralItem = centralSubscription?.active_items?.[0] || null;
    const centralRecord = centralItem
        ? centralSubscription.subscriptions?.find(subscription =>
            subscription.items.some(item => item.id === centralItem.id)
        )
        : null;
    const account = centralSubscription?.managed_centrally ? {
        ...(summary?.account || {}),
        billing_cycle_start: centralRecord?.current_period_start || null,
        billing_cycle_end: centralRecord?.current_period_end || null,
        status: centralSubscription.subscription_status,
    } : (summary?.account || {});
    const usageRows = summary?.usage_period || summary?.usage_month || [];
    const cycleBlocked = centralSubscription?.managed_centrally
        ? !['active', 'trialing', 'past_due'].includes(centralSubscription.subscription_status)
        : Boolean(balances.billing_cycle_blocked);
    const lowBalance = !cycleBlocked && Number(balances.available_credits || 0) < 10;
    const usingCreditLimit = Number(balances.credit_used_credits || 0) > 0;
    const number = (value) => Number(value || 0).toLocaleString(locale);
    const money = (value) => `${Number(value || 0).toLocaleString(locale)} LYD`;
    const formatDateTime = (value) => {
        if (!value) return t('common.notSet');
        const parsed = new Date(String(value).replace(' ', 'T'));
        if (Number.isNaN(parsed.getTime())) return value;
        return parsed.toLocaleString(locale);
    };

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 3 }}>
                <Box>
                    <PageTitle variant="h4" fontWeight={800}>{t('billing.tenantTitle')}</PageTitle>
                    <Typography variant="body2" color="text.secondary">
                        {t('billing.tenantSubtitle')}
                    </Typography>
                </Box>
                <Button startIcon={<RefreshIcon />} variant="outlined" onClick={fetchBilling}>{t('common.refresh')}</Button>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {checkoutMessage && (
                <Alert severity="success" onClose={() => setCheckoutMessage('')} sx={{ mb: 2 }}>
                    {checkoutMessage}
                </Alert>
            )}
            {centralSubscription?.managed_centrally && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    الخطة ودورة الاشتراك والفواتير تدار من نظام اشتراكات سافانا المركزي. تحتفظ Wa Savana بسجل الاستخدام والرصيد التشغيلي فقط.
                </Alert>
            )}
            {centralSubscription?.managed_centrally && !centralSubscription?.bound && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    اربط هذا الحساب بمؤسسة سافانا المركزية أولاً حتى تظهر الباقات ويتاح الاشتراك من داخل المنصة.
                </Alert>
            )}
            {centralSubscription?.pending_checkout && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    يوجد طلب تغيير باقة قيد السداد. لن يُنشأ طلب آخر حتى يُسدّد أو يُلغى الطلب الحالي.
                </Alert>
            )}
            {cycleBlocked && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    انتهت دورة الاشتراك الحالية، ولا يمكن تنفيذ عمليات جديدة حتى يتم تجديد الباقة من الإدارة.
                </Alert>
            )}
            {lowBalance && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    {t('billing.lowBalanceWarning')}
                </Alert>
            )}
            {usingCreditLimit && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    {t('billing.creditLimitInfo', { used: number(balances.credit_used_credits), limit: number(balances.credit_limit_credits) })}
                </Alert>
            )}

            {centralSubscription?.managed_centrally && centralSubscription?.bound && (
                <Paper sx={{ p: 2, mb: 3 }}>
                    <SectionTitle variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
                        باقات سافانا المركزية
                    </SectionTitle>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        يمكنك الاشتراك في باقة Wa Savana مستقلة أو اختيار باقة مجمّعة من داخل المنصة.
                    </Typography>
                    <Grid container spacing={2}>
                        {(centralSubscription.plans || []).map(offer => {
                            const price = offer.prices?.find(item => item.active);
                            const isCurrent = offer.is_current;
                            const isIncluded = offer.is_subscribed && !isCurrent;
                            const isPending = offer.checkout_state === 'pending';
                            return (
                                <Grid key={offer.id} size={{ xs: 12, sm: 6, md: 4 }}>
                                    <Card variant="outlined" sx={{ height: '100%', borderColor: isCurrent ? 'primary.main' : 'divider' }}>
                                        <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                                            <Chip size="small" color="primary" label="باقة Wa Savana" sx={{ alignSelf: 'flex-start', mb: 1 }} />
                                            <Typography variant="h6" fontWeight={800}>{offer.name}</Typography>
                                            <Typography variant="body2" color="text.secondary" sx={{ my: 1, flexGrow: 1 }}>
                                                {offer.description || 'اشتراك مركزي مستقل للمنصة.'}
                                            </Typography>
                                            <Typography fontWeight={800} sx={{ mb: 1.5 }}>
                                                {price
                                                    ? `${money(Number(price.amount_minor) / 100)} / ${price.billing_period === 'yearly' ? 'سنة' : 'شهر'}`
                                                    : 'السعر غير متاح'}
                                            </Typography>
                                            <Button
                                                variant={isCurrent ? 'outlined' : 'contained'}
                                                disabled={!price || Boolean(checkoutWorking) || offer.checkout_available === false}
                                                onClick={() => checkout('plan', offer)}
                                            >
                                                {checkoutWorking === offer.id
                                                    ? <CircularProgress size={20} color="inherit" />
                                                    : isCurrent
                                                        ? 'الخطة الحالية'
                                                        : isIncluded
                                                            ? 'مشمولة في اشتراكك'
                                                            : isPending
                                                                ? 'يوجد طلب قيد السداد'
                                                                : centralSubscription.active_plan
                                                                    ? 'تغيير الباقة'
                                                                    : 'اشترك الآن'}
                                            </Button>
                                        </CardContent>
                                    </Card>
                                </Grid>
                            );
                        })}
                        {(centralSubscription.bundles || []).map(offer => {
                            const isCurrent = offer.is_current;
                            const isIncluded = offer.is_subscribed && !isCurrent;
                            const isPending = offer.checkout_state === 'pending';
                            return (
                            <Grid key={offer.id} size={{ xs: 12, sm: 6, md: 4 }}>
                                <Card variant="outlined" sx={{ height: '100%', borderColor: isCurrent ? 'secondary.main' : 'divider' }}>
                                    <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                                        <Chip size="small" color="secondary" label="باقة مجمّعة" sx={{ alignSelf: 'flex-start', mb: 1 }} />
                                        <Typography variant="h6" fontWeight={800}>{offer.name}</Typography>
                                        <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
                                            {offer.description || 'اشتراك موحّد لعدة منصات سافانا.'}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, flexGrow: 1 }}>
                                            {(offer.items || []).map(item => item.plan_name).join(' • ')}
                                        </Typography>
                                        <Button
                                            color="secondary"
                                            variant={isCurrent ? 'outlined' : 'contained'}
                                            disabled={Boolean(checkoutWorking) || offer.checkout_available === false}
                                            onClick={() => checkout('bundle', offer)}
                                        >
                                            {checkoutWorking === offer.id
                                                ? <CircularProgress size={20} color="inherit" />
                                                : isCurrent
                                                    ? 'الباقة الحالية'
                                                    : isIncluded
                                                        ? 'مشمولة في اشتراكك'
                                                        : isPending
                                                            ? 'يوجد طلب قيد السداد'
                                                            : 'الترقية إلى الباقة المجمعة'}
                                        </Button>
                                    </CardContent>
                                </Card>
                            </Grid>
                            );
                        })}
                    </Grid>
                </Paper>
            )}

            <Paper sx={{ p: 2, mb: 3 }}>
                <Grid container spacing={1.5} alignItems="center">
                    <Grid size={{ xs: 12, sm: 5 }}>
                        <TextField
                            fullWidth
                            type="date"
                            label="من تاريخ"
                            InputLabelProps={{ shrink: true }}
                            value={periodForm.period_start}
                            onChange={(e) => setPeriodForm((prev) => ({ ...prev, period_start: e.target.value }))}
                        />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 5 }}>
                        <TextField
                            fullWidth
                            type="date"
                            label="إلى تاريخ"
                            InputLabelProps={{ shrink: true }}
                            value={periodForm.period_end}
                            onChange={(e) => setPeriodForm((prev) => ({ ...prev, period_end: e.target.value }))}
                        />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 2 }}>
                        <Button fullWidth variant="contained" onClick={applyPeriod}>
                            تطبيق
                        </Button>
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                        <Typography variant="caption" color="text.secondary">
                            فترة الاستخدام: {summary?.period?.start_date || appliedPeriod.period_start} - {summary?.period?.end_date || appliedPeriod.period_end}
                        </Typography>
                    </Grid>
                </Grid>
            </Paper>

            <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard title={t('billing.availableCredits')} value={number(balances.available_credits)} icon={<WalletIcon />} color={lowBalance ? 'warning' : 'success'} caption={t('billing.availableCreditsCaption')} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard title={t('billing.currentPlan')} value={plan?.name || t('billing.noPlan')} icon={<UsageIcon />} caption={plan ? money(plan.monthly_price_lyd ?? ((plan.prices?.find(item => item.active)?.amount_minor || 0) / 100)) : t('common.notSet')} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard title={t('billing.planCredits')} value={number(balances.plan_balance_credits)} icon={<PaymentsIcon />} color="info" caption={t('billing.planCreditsCaption')} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard title={t('billing.walletCredits')} value={number(balances.wallet_balance_credits)} icon={<WalletIcon />} color="secondary" caption={t('billing.walletCreditsCaption')} />
                </Grid>
            </Grid>

            <Paper sx={{ p: 2, mb: 3 }}>
                <SectionTitle variant="h6" fontWeight={700} sx={{ mb: 2 }}>دورة الاشتراك</SectionTitle>
                <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <Typography variant="body2" color="text.secondary">تاريخ التفعيل</Typography>
                        <Typography fontWeight={700}>{formatDateTime(account.billing_cycle_start)}</Typography>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <Typography variant="body2" color="text.secondary">تاريخ الانتهاء</Typography>
                        <Typography fontWeight={700}>{formatDateTime(account.billing_cycle_end)}</Typography>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <Typography variant="body2" color="text.secondary">حالة الفوترة</Typography>
                        <Chip size="small" label={account.status || t('common.notSet')} color={account.status === 'active' ? 'success' : 'warning'} />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <Typography variant="body2" color="text.secondary">حد الائتمان</Typography>
                        <Typography fontWeight={700}>{number(balances.credit_limit_credits)}</Typography>
                    </Grid>
                </Grid>
            </Paper>

            <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 5 }}>
                    <Paper sx={{ p: 2 }}>
                        <SectionTitle variant="h6" fontWeight={700} sx={{ mb: 2 }}>الاستخدام حسب الفترة</SectionTitle>
                        {usageRows.length === 0 ? (
                            <Alert severity="info">{t('billing.noPaidUsage')}</Alert>
                        ) : (
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                            <TableRow>
                                                <TableCell>{t('common.channel')}</TableCell>
                                                <TableCell>{t('common.type')}</TableCell>
                                                <TableCell>{t('common.quantity')}</TableCell>
                                                <TableCell>{t('common.credit')}</TableCell>
                                            </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {usageRows.map((row) => (
                                            <TableRow key={`${row.channel}-${row.operation_type}`}>
                                                <TableCell><Chip size="small" label={row.channel} /></TableCell>
                                                <TableCell>{row.operation_type}</TableCell>
                                                <TableCell>{number(row.quantity)}</TableCell>
                                                <TableCell>{number(row.credits)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </Paper>
                </Grid>

                <Grid size={{ xs: 12, md: 7 }}>
                    <Paper sx={{ p: 2 }}>
                        <SectionTitle variant="h6" fontWeight={700} sx={{ mb: 2 }}>{t('billing.latestLedger')}</SectionTitle>
                        <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>{t('common.time')}</TableCell>
                                        <TableCell>{t('common.type')}</TableCell>
                                        <TableCell>{t('common.description')}</TableCell>
                                        <TableCell>{t('common.change')}</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {ledger.map((entry) => (
                                        <TableRow key={entry.id}>
                                            <TableCell>{entry.created_at}</TableCell>
                                            <TableCell>{entry.entry_type}</TableCell>
                                            <TableCell>{entry.description}</TableCell>
                                            <TableCell>{number(entry.credits_delta)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </Paper>
                </Grid>

                <Grid size={{ xs: 12 }}>
                    <Paper sx={{ p: 2 }}>
                        <SectionTitle variant="h6" fontWeight={700} sx={{ mb: 2 }}>{t('billing.invoices')}</SectionTitle>
                        {invoices.length === 0 ? (
                            <Alert severity="info">{t('billing.noInvoices')}</Alert>
                        ) : (
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>{t('billing.invoiceNumber')}</TableCell>
                                            <TableCell>{t('common.status')}</TableCell>
                                            <TableCell>{t('common.credit')}</TableCell>
                                            <TableCell>{t('common.createdAt')}</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {invoices.map((invoice) => (
                                            <TableRow key={invoice.id}>
                                                <TableCell><InvoiceIcon fontSize="small" sx={{ verticalAlign: 'middle', mr: 1 }} />{invoice.invoice_number}</TableCell>
                                                <TableCell><Chip size="small" label={invoice.status} /></TableCell>
                                                <TableCell>{number(invoice.subtotal_credits)}</TableCell>
                                                <TableCell>{invoice.created_at}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default TenantBilling;
