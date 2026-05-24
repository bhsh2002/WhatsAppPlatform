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

const TenantBilling = () => {
    const { locale, t } = useLanguage();
    const [summary, setSummary] = useState(null);
    const [ledger, setLedger] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchBilling = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const [summaryData, ledgerData, invoicesData] = await Promise.all([
                api.getPortalBillingSummary(),
                api.getPortalBillingLedger({ limit: 10 }),
                api.getPortalBillingInvoices({ limit: 5 }),
            ]);
            setSummary(summaryData);
            setLedger(ledgerData.ledger || []);
            setInvoices(invoicesData.invoices || []);
        } catch (err) {
            setError(err.message || t('billing.fetchFailed'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        fetchBilling();
    }, [fetchBilling]);

    if (loading) {
        return (
            <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress />
            </Box>
        );
    }

    const balances = summary?.balances || {};
    const plan = summary?.plan;
    const lowBalance = Number(balances.available_credits || 0) < 10;
    const usingCreditLimit = Number(balances.credit_used_credits || 0) > 0;
    const number = (value) => Number(value || 0).toLocaleString(locale);
    const money = (value) => `${Number(value || 0).toLocaleString(locale)} LYD`;

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 3 }}>
                <Box>
                    <Typography variant="h4" fontWeight={800}>{t('billing.tenantTitle')}</Typography>
                    <Typography variant="body2" color="text.secondary">
                        {t('billing.tenantSubtitle')}
                    </Typography>
                </Box>
                <Button startIcon={<RefreshIcon />} variant="outlined" onClick={fetchBilling}>{t('common.refresh')}</Button>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
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

            <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard title={t('billing.availableCredits')} value={number(balances.available_credits)} icon={<WalletIcon />} color={lowBalance ? 'warning' : 'success'} caption={t('billing.availableCreditsCaption')} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard title={t('billing.currentPlan')} value={plan?.name || t('billing.noPlan')} icon={<UsageIcon />} caption={plan ? money(plan.monthly_price_lyd) : t('common.notSet')} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard title={t('billing.planCredits')} value={number(balances.plan_balance_credits)} icon={<PaymentsIcon />} color="info" caption={t('billing.planCreditsCaption')} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard title={t('billing.walletCredits')} value={number(balances.wallet_balance_credits)} icon={<WalletIcon />} color="secondary" caption={t('billing.walletCreditsCaption')} />
                </Grid>
            </Grid>

            <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 5 }}>
                    <Paper sx={{ p: 2 }}>
                        <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>{t('billing.monthlyUsageByChannel')}</Typography>
                        {(summary?.usage_month || []).length === 0 ? (
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
                                        {summary.usage_month.map((row) => (
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
                        <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>{t('billing.latestLedger')}</Typography>
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
                        <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>{t('billing.invoices')}</Typography>
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
