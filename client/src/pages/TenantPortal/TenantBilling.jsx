import React, { useCallback, useEffect, useState } from 'react';
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
import {
    formatPortalInvoiceValue,
    portalInvoiceColumnKey,
    presentPortalInvoices,
} from './billingInvoicePresentation';
import {
    centralCheckoutQuotesMatch,
    centralPlanOfferState,
    currentCentralOffer,
    formatCentralOfferPrice,
    formatCentralQuoteAmount,
    isCentralCheckoutQuote,
    selectCentralPlanPrice,
} from './centralOfferPresentation';
import { availableCentralPaymentMethods, centralInvoiceIsPaid, centralInvoicePaymentState } from './paymentMethods';

const PAYMENT_RETURN_INVOICE_KEY = 'wa-savana-payment-return-invoice';
const PAYMENT_POLL_ATTEMPTS = 6;
const PAYMENT_POLL_INTERVAL_MS = 2000;

const rememberPaymentInvoice = (invoiceId, checkoutUrl) => {
    try {
        const paymentIntentId = new URL(checkoutUrl).pathname.split('/').filter(Boolean).pop();
        window.sessionStorage.setItem(
            PAYMENT_RETURN_INVOICE_KEY,
            JSON.stringify({ invoiceId, paymentIntentId })
        );
    } catch {
        // Payment can still proceed when browser storage is unavailable.
    }
};

const returnedPayment = () => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('payment_status') !== 'paid') return null;
    let invoiceId = null;
    try {
        const saved = JSON.parse(window.sessionStorage.getItem(PAYMENT_RETURN_INVOICE_KEY) || 'null');
        if (saved?.paymentIntentId && saved.paymentIntentId === query.get('payment_intent_id')) {
            invoiceId = saved.invoiceId;
        }
    } catch {
        // The invoice cannot be correlated without browser storage.
    }
    return { status: invoiceId ? 'checking' : 'unknown_invoice', invoiceId };
};

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
    const [checkoutPreview, setCheckoutPreview] = useState(null);
    const [checkoutPreviewChanged, setCheckoutPreviewChanged] = useState(false);
    const [checkoutPreviewError, setCheckoutPreviewError] = useState('');
    const [paymentWorking, setPaymentWorking] = useState('');
    const [checkoutMessage, setCheckoutMessage] = useState('');
    const [paymentReturn, setPaymentReturn] = useState(returnedPayment);

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
            setInvoices(presentPortalInvoices({
                managedCentrally: centralData?.managed_centrally,
                centralInvoices: centralData?.invoices,
                legacyInvoices: invoicesData.invoices,
            }));
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

    useEffect(() => {
        if (loading || paymentReturn?.status !== 'checking') return undefined;
        let cancelled = false;
        let timerId;
        let attempts = 0;
        const refreshPayment = async () => {
            attempts += 1;
            try {
                const context = await api.getPortalCentralSubscription();
                if (cancelled) return;
                if (context?.managed_centrally) {
                    setCentralSubscription(context);
                    setInvoices((context.invoices || []).map(invoice => ({
                        ...invoice,
                        invoice_number: invoice.number,
                    })));
                }
                if (centralInvoiceIsPaid(context, paymentReturn.invoiceId)) {
                    try {
                        window.sessionStorage.removeItem(PAYMENT_RETURN_INVOICE_KEY);
                    } catch {
                        // Browser storage may be unavailable.
                    }
                    const url = new URL(window.location.href);
                    url.searchParams.delete('payment_status');
                    url.searchParams.delete('payment_intent_id');
                    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
                    setPaymentReturn({ status: 'confirmed', invoiceId: paymentReturn.invoiceId });
                    return;
                }
            } catch {
                if (cancelled) return;
            }
            if (attempts >= PAYMENT_POLL_ATTEMPTS) {
                setPaymentReturn({ status: 'timeout', invoiceId: paymentReturn.invoiceId });
                return;
            }
            timerId = window.setTimeout(refreshPayment, PAYMENT_POLL_INTERVAL_MS);
        };
        refreshPayment();
        return () => {
            cancelled = true;
            window.clearTimeout(timerId);
        };
    }, [loading, paymentReturn?.invoiceId, paymentReturn?.status]);

    const resumeMoamalatPayment = (invoiceId, checkoutUrl) => {
        rememberPaymentInvoice(invoiceId, checkoutUrl);
        window.location.assign(checkoutUrl);
    };

    const startPayment = async (invoiceId, provider) => {
        setPaymentWorking(`${provider}:${invoiceId}`);
        setError(null);
        try {
            const intent = await api.createPortalCentralPaymentIntent({
                invoice_id: invoiceId,
                provider,
            });
            if (provider === 'cash') {
                setCheckoutMessage('تم تسجيل طلب السداد النقدي. ستبقى الفاتورة بانتظار تأكيد الاستلام من الإدارة.');
                await fetchBilling();
                return;
            }
            if (!intent?.checkout_url) throw new Error('رابط الدفع غير متاح لهذه الفاتورة.');
            resumeMoamalatPayment(invoiceId, intent.checkout_url);
        } catch (paymentError) {
            setError(paymentError.message || 'تعذر بدء الدفع الإلكتروني.');
        } finally {
            setPaymentWorking('');
        }
    };

    const prepareCheckout = async (kind, offer) => {
        setCheckoutWorking(offer.id);
        setCheckoutMessage('');
        setError(null);
        try {
            const price = kind === 'plan' ? selectCentralPlanPrice(offer) : null;
            const selection = kind === 'plan'
                ? { plan_id: offer.id, price_id: price?.id }
                : { bundle_id: offer.id };
            const quote = await api.quotePortalCentralSubscription(selection);
            if (!isCentralCheckoutQuote(quote)) {
                throw new Error('تعذر عرض تكلفة الاشتراك. أعد المحاولة لاحقًا.');
            }
            setCheckoutPreview({ kind, offer, selection, quote });
            setCheckoutPreviewChanged(false);
            setCheckoutPreviewError('');
        } catch (quoteError) {
            setError(quoteError.message || 'تعذر عرض تكلفة الاشتراك.');
        } finally {
            setCheckoutWorking('');
        }
    };

    const checkout = async () => {
        if (!checkoutPreview) return;
        const { offer, selection, quote } = checkoutPreview;
        setCheckoutWorking(offer.id);
        setCheckoutPreviewError('');
        try {
            const currentQuote = await api.quotePortalCentralSubscription(selection);
            if (!isCentralCheckoutQuote(currentQuote)) {
                throw new Error('تعذر التحقق من تكلفة الاشتراك. أعد المحاولة لاحقًا.');
            }
            if (!centralCheckoutQuotesMatch(quote, currentQuote)) {
                setCheckoutPreview({ ...checkoutPreview, quote: currentQuote });
                setCheckoutPreviewChanged(true);
                return;
            }
            const result = await api.checkoutPortalCentralSubscription({
                ...selection,
                expected_total_minor: currentQuote.total_minor,
                idempotency_key: `wa-savana-checkout-${crypto.randomUUID()}`,
            });
            setCheckoutPreview(null);
            setCheckoutPreviewChanged(false);
            setCheckoutPreviewError('');
            const invoice = result?.invoice;
            const invoiceAmount = invoice?.total_minor != null
                ? formatPortalInvoiceValue(invoice, true, locale)
                : null;
            setCheckoutMessage(
                invoice
                    ? currentQuote.payment_required === false
                        ? `تم تفعيل الاشتراك وإنشاء الفاتورة ${invoice.number} دون مبلغ مستحق.`
                        : `تم إنشاء طلب الاشتراك والفاتورة ${invoice.number}${invoiceAmount ? ` بقيمة ${invoiceAmount}` : ''}. اختر طريقة الدفع من قائمة الفواتير.`
                    : 'تم إنشاء طلب الاشتراك المركزي بنجاح.'
            );
            await fetchBilling();
        } catch (checkoutError) {
            if (checkoutError?.data?.code === 'checkout_quote_changed') {
                try {
                    const updatedQuote = await api.quotePortalCentralSubscription(selection);
                    if (isCentralCheckoutQuote(updatedQuote)) {
                        setCheckoutPreview({ ...checkoutPreview, quote: updatedQuote });
                        setCheckoutPreviewChanged(true);
                        return;
                    }
                } catch {
                    // Keep the checkout error visible if the new quote cannot be loaded.
                }
            }
            setCheckoutPreviewError(checkoutError.message || 'تعذر إنشاء الاشتراك المركزي.');
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
    const plan = summary?.plan;
    const currentOffer = currentCentralOffer(centralSubscription);
    const centralItem = centralSubscription?.current_plan_item
        || centralSubscription?.active_items?.[0] || null;
    const centralRecord = centralSubscription?.current_subscription || (centralItem
        ? centralSubscription.subscriptions?.find(subscription =>
            subscription.items.some(item => item.id === centralItem.id)
        )
        : null);
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
    const paymentMethods = availableCentralPaymentMethods(centralSubscription?.payment_methods);
    const number = (value) => Number(value || 0).toLocaleString(locale);
    const money = (value) => `${Number(value || 0).toLocaleString(locale)} LYD`;
    const formatDateTime = (value) => {
        if (!value) return t('common.notSet');
        const parsed = new Date(String(value).replace(' ', 'T'));
        if (Number.isNaN(parsed.getTime())) return value;
        return parsed.toLocaleString(locale);
    };

    const renderInvoicePayment = (invoice) => {
        if (invoice.status !== 'open') return null;
        const paymentState = centralInvoicePaymentState(
            centralSubscription?.payment_intents, invoice.id,
        );
        if (paymentState.kind === 'cash_pending') {
            return <Chip size="small" color="warning" label="السداد النقدي بانتظار تأكيد الإدارة" />;
        }
        if (paymentState.kind === 'moamalat_resume') {
            return <Button size="small" variant="contained" onClick={() => resumeMoamalatPayment(invoice.id, paymentState.intent.checkout_url)}>متابعة الدفع عبر معاملات</Button>;
        }
        if (paymentState.kind === 'moamalat_pending') {
            return <Button size="small" variant="outlined" disabled={Boolean(paymentWorking)} onClick={() => startPayment(invoice.id, 'moamalat')}>إعادة محاولة رابط معاملات</Button>;
        }
        if (paymentState.kind === 'needs_review') {
            return <Typography variant="body2" color="text.secondary">نية الدفع تحتاج مراجعة الإدارة</Typography>;
        }
        return (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {paymentMethods.includes('moamalat') && (
                    <Button
                        size="small"
                        variant="contained"
                        disabled={Boolean(paymentWorking)}
                        onClick={() => startPayment(invoice.id, 'moamalat')}
                    >
                        {paymentWorking === `moamalat:${invoice.id}` ? <CircularProgress size={18} color="inherit" /> : 'الدفع عبر معاملات'}
                    </Button>
                )}
                {paymentMethods.includes('cash') && (
                    <Button
                        size="small"
                        variant="outlined"
                        disabled={Boolean(paymentWorking)}
                        onClick={() => startPayment(invoice.id, 'cash')}
                    >
                        {paymentWorking === `cash:${invoice.id}` ? <CircularProgress size={18} color="inherit" /> : 'طلب سداد نقدي'}
                    </Button>
                )}
                {paymentMethods.length === 0 && <Typography variant="body2" color="text.secondary">لا تتوفر طريقة دفع حالياً</Typography>}
            </Box>
        );
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
            {paymentReturn?.status === 'checking' && (
                <Alert severity="info" sx={{ mb: 2 }}>جارٍ تحديث الفاتورة من نظام الاشتراكات بعد العودة من معاملات...</Alert>
            )}
            {paymentReturn?.status === 'confirmed' && (
                <Alert severity="success" sx={{ mb: 2 }}>تأكد سداد الفاتورة في نظام الاشتراكات.</Alert>
            )}
            {paymentReturn?.status === 'timeout' && (
                <Alert
                    severity="warning"
                    sx={{ mb: 2 }}
                    action={<Button color="inherit" size="small" onClick={() => setPaymentReturn(current => ({ ...current, status: 'checking' }))}>إعادة التحقق</Button>}
                >
                    لم يصل تأكيد سداد الفاتورة إلى نظام الاشتراكات بعد. أعد التحقق بعد قليل؛ ستبقى حالة الفاتورة كما يعرضها النظام.
                </Alert>
            )}
            {paymentReturn?.status === 'unknown_invoice' && (
                <Alert severity="warning" sx={{ mb: 2 }}>تعذر تحديد الفاتورة المرتبطة بعملية الدفع. راجع حالة الفواتير أدناه أو حدّث الصفحة.</Alert>
            )}
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
                        السعر المعروض أساسي، وتظهر القيمة النهائية بعد الخصومات والضرائب في الفاتورة.
                    </Typography>
                    <Grid container spacing={2}>
                        {(centralSubscription.plans || []).map(offer => {
                            const price = selectCentralPlanPrice(offer);
                            const displayPrice = formatCentralOfferPrice(price, locale);
                            const offerState = centralPlanOfferState(offer, centralSubscription);
                            const isCurrent = offerState === 'current';
                            const isIncluded = offerState === 'included';
                            const isPending = offerState === 'pending';
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
                                                {displayPrice || 'السعر غير متاح'}
                                            </Typography>
                                            <Button
                                                variant={isCurrent ? 'outlined' : 'contained'}
                                                disabled={!displayPrice || Boolean(checkoutWorking) || offer.checkout_available === false}
                                                onClick={() => prepareCheckout('plan', offer)}
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
                            const isCurrent = currentOffer
                                ? currentOffer.kind === 'bundle' && currentOffer.id === offer.id
                                : offer.is_current;
                            const isIncluded = offer.is_subscribed && !isCurrent;
                            const isPending = offer.checkout_state === 'pending';
                            const displayPrice = formatCentralOfferPrice(offer, locale);
                            const checkoutPriced = offer.price_available === true
                                && ['monthly', 'yearly'].includes(offer.billing_period)
                                && Boolean(displayPrice);
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
                                        <Typography fontWeight={800} sx={{ mb: 1.5 }}>
                                            {displayPrice ? `السعر الأساسي: ${displayPrice}` : 'السعر غير متاح حالياً'}
                                        </Typography>
                                        <Button
                                            color="secondary"
                                            variant={isCurrent ? 'outlined' : 'contained'}
                                            disabled={Boolean(checkoutWorking) || offer.checkout_available === false || !checkoutPriced}
                                            onClick={() => prepareCheckout('bundle', offer)}
                                        >
                                            {checkoutWorking === offer.id
                                                ? <CircularProgress size={20} color="inherit" />
                                                : isCurrent
                                                    ? 'الباقة الحالية'
                                                    : isIncluded
                                                        ? 'مشمولة في اشتراكك'
                                                        : isPending
                                                            ? 'يوجد طلب قيد السداد'
                                                            : !checkoutPriced
                                                                ? 'تسعير الباقة غير متاح'
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
                    <StatCard
                        title={t('billing.currentPlan')}
                        value={centralSubscription?.managed_centrally
                            ? currentOffer?.name || t('billing.noPlan')
                            : plan?.name || t('billing.noPlan')}
                        icon={<UsageIcon />}
                        caption={centralSubscription?.managed_centrally
                            ? formatCentralOfferPrice(currentOffer, locale) || t('common.notSet')
                            : plan ? money(plan.monthly_price_lyd ?? ((plan.prices?.find(item => item.active)?.amount_minor || 0) / 100)) : t('common.notSet')}
                    />
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
                                            <TableCell>{t(portalInvoiceColumnKey(centralSubscription?.managed_centrally))}</TableCell>
                                            <TableCell>{t('common.createdAt')}</TableCell>
                                            {centralSubscription?.managed_centrally && <TableCell>الدفع</TableCell>}
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {invoices.map((invoice) => (
                                            <TableRow key={invoice.id}>
                                                <TableCell><InvoiceIcon fontSize="small" sx={{ verticalAlign: 'middle', mr: 1 }} />{invoice.invoice_number}</TableCell>
                                                <TableCell><Chip size="small" label={invoice.status} /></TableCell>
                                                <TableCell>{formatPortalInvoiceValue(invoice, centralSubscription?.managed_centrally, locale)}</TableCell>
                                                <TableCell>{invoice.created_at}</TableCell>
                                                {centralSubscription?.managed_centrally && (
                                                    <TableCell>{renderInvoicePayment(invoice)}</TableCell>
                                                )}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </Paper>
                </Grid>
            </Grid>
            <Dialog
                open={Boolean(checkoutPreview)}
                aria-labelledby="central-checkout-preview-title"
                onClose={() => {
                    if (!checkoutWorking) {
                        setCheckoutPreview(null);
                        setCheckoutPreviewError('');
                    }
                }}
                fullWidth
                maxWidth="sm"
            >
                <DialogTitle id="central-checkout-preview-title">مراجعة تكلفة الاشتراك</DialogTitle>
                <DialogContent dividers>
                    {checkoutPreview && (
                        <Box sx={{ display: 'grid', gap: 1.5 }}>
                            <Typography fontWeight={700}>{checkoutPreview.offer.name}</Typography>
                            <Typography variant="body2" color="text.secondary">
                                {checkoutPreview.quote.period_starts_after_payment
                                    ? 'تبدأ دورة الباقة الجديدة بعد تأكيد السداد.'
                                    : 'تبدأ دورة الباقة الجديدة فور تأكيد الاشتراك.'}
                                {' '}مدة الدورة {checkoutPreview.quote.period_days} يومًا.
                            </Typography>
                            {checkoutPreviewChanged && (
                                <Alert severity="warning">
                                    تغيرت تكلفة الاشتراك منذ عرضها. راجع المبلغ الجديد ثم أكد مرة أخرى.
                                </Alert>
                            )}
                            {checkoutPreviewError && <Alert severity="error">{checkoutPreviewError}</Alert>}
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                                <Typography>السعر الأساسي</Typography>
                                <Typography fontWeight={700}>{formatCentralQuoteAmount(checkoutPreview.quote.base_amount_minor, checkoutPreview.quote.currency, locale)}</Typography>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                                <Typography>رصيد الأيام غير المستعملة</Typography>
                                <Typography fontWeight={700}>− {formatCentralQuoteAmount(checkoutPreview.quote.upgrade_credit_minor, checkoutPreview.quote.currency, locale)}</Typography>
                            </Box>
                            {checkoutPreview.quote.discount_minor > 0 && (
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                                    <Typography>خصومات إضافية</Typography>
                                    <Typography fontWeight={700}>− {formatCentralQuoteAmount(checkoutPreview.quote.discount_minor, checkoutPreview.quote.currency, locale)}</Typography>
                                </Box>
                            )}
                            {checkoutPreview.quote.tax_minor > 0 && (
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                                    <Typography>الضريبة</Typography>
                                    <Typography fontWeight={700}>+ {formatCentralQuoteAmount(checkoutPreview.quote.tax_minor, checkoutPreview.quote.currency, locale)}</Typography>
                                </Box>
                            )}
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, pt: 1, borderTop: 1, borderColor: 'divider' }}>
                                <Typography fontWeight={800}>المبلغ المستحق</Typography>
                                <Typography fontWeight={800}>{formatCentralQuoteAmount(checkoutPreview.quote.total_minor, checkoutPreview.quote.currency, locale)}</Typography>
                            </Box>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button disabled={Boolean(checkoutWorking)} onClick={() => {
                        setCheckoutPreview(null);
                        setCheckoutPreviewError('');
                    }}>إلغاء</Button>
                    <Button variant="contained" disabled={Boolean(checkoutWorking)} onClick={checkout}>
                        {checkoutWorking ? <CircularProgress size={20} color="inherit" /> : 'تأكيد الاشتراك'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default TenantBilling;
