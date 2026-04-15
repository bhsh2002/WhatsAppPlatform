import React, { useState } from 'react';
import {
    Box, Typography, Paper, Grid, TextField, Button, Card, CardContent, Chip,
    CircularProgress, Alert, Snackbar, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, Divider, Avatar
} from '@mui/material';
import { Business as BusinessIcon, Search as SearchIcon, AccountBalance, Store } from '@mui/icons-material';
import api from '../../api';

const BusinessManager = () => {
    const [businessId, setBusinessId] = useState('');
    const [info, setInfo] = useState(null);
    const [adAccounts, setAdAccounts] = useState([]);
    const [assets, setAssets] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState('info');

    const handleSearch = async () => {
        if (!businessId.trim()) return;
        try {
            setLoading(true);
            setError('');
            const [infoData, adData, assetsData] = await Promise.all([
                api.getBusinessManagerInfo(businessId).catch(() => null),
                api.getAdAccounts(businessId).catch(() => ({ ad_accounts: [] })),
                api.getBusinessAssets(businessId).catch(() => ({ pages: [], whatsapp_accounts: [] }))
            ]);
            setInfo(infoData);
            setAdAccounts(adData?.ad_accounts || []);
            setAssets(assetsData);
        } catch (err) {
            setError(err.message || 'فشل جلب البيانات');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                <BusinessIcon sx={{ fontSize: 32, color: 'primary.main' }} />
                <Box>
                    <Typography variant="h5" fontWeight={700}>مدير الأعمال</Typography>
                    <Typography variant="body2" color="text.secondary">عرض وإدارة أصول مدير الأعمال (Business Manager API)</Typography>
                </Box>
            </Box>

            <Paper sx={{ p: 3, mb: 3 }}>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField fullWidth label="معرف مدير الأعمال (Business ID)" value={businessId}
                        onChange={e => setBusinessId(e.target.value)} placeholder="أدخل Business ID" size="small" />
                    <Button variant="contained" startIcon={loading ? <CircularProgress size={18} /> : <SearchIcon />}
                        onClick={handleSearch} disabled={loading || !businessId.trim()} sx={{ minWidth: 120 }}>
                        بحث
                    </Button>
                </Box>
            </Paper>

            {info && (
                <>
                    <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
                        {['info', 'ads', 'assets'].map(tab => (
                            <Button key={tab} variant={activeTab === tab ? 'contained' : 'outlined'} size="small"
                                onClick={() => setActiveTab(tab)}>
                                {tab === 'info' ? 'المعلومات' : tab === 'ads' ? 'الحسابات الإعلانية' : 'الأصول'}
                            </Button>
                        ))}
                    </Box>

                    {activeTab === 'info' && (
                        <Card>
                            <CardContent>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                                    <Avatar sx={{ bgcolor: 'primary.main', width: 56, height: 56 }}><BusinessIcon /></Avatar>
                                    <Box>
                                        <Typography variant="h6" fontWeight={700}>{info.name || 'غير متاح'}</Typography>
                                        <Typography variant="body2" color="text.secondary">ID: {info.id}</Typography>
                                    </Box>
                                    <Chip label={info.verification_status || 'غير محقق'} color={info.verification_status === 'verified' ? 'success' : 'warning'} sx={{ ml: 'auto' }} />
                                </Box>
                                <Divider sx={{ mb: 2 }} />
                                <Grid container spacing={2}>
                                    <Grid size={{ xs: 6 }}><Typography variant="body2" color="text.secondary">تاريخ الإنشاء</Typography><Typography>{info.created_time || '-'}</Typography></Grid>
                                    <Grid size={{ xs: 6 }}><Typography variant="body2" color="text.secondary">المنطقة الزمنية</Typography><Typography>{info.timezone_id || '-'}</Typography></Grid>
                                    <Grid size={{ xs: 6 }}><Typography variant="body2" color="text.secondary">التحقق بخطوتين</Typography><Typography>{info.two_factor_type || '-'}</Typography></Grid>
                                </Grid>
                            </CardContent>
                        </Card>
                    )}

                    {activeTab === 'ads' && (
                        <Paper>
                            <TableContainer sx={{ overflowX: 'auto' }}>
                                <Table>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>الاسم</TableCell>
                                            <TableCell>المعرف</TableCell>
                                            <TableCell>الحالة</TableCell>
                                            <TableCell>العملة</TableCell>
                                            <TableCell>الإنفاق</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {adAccounts.map((acc, i) => (
                                            <TableRow key={i}>
                                                <TableCell>{acc.name || '-'}</TableCell>
                                                <TableCell><Chip label={acc.account_id} size="small" /></TableCell>
                                                <TableCell><Chip label={acc.account_status === 1 ? 'نشط' : 'غير نشط'} size="small" color={acc.account_status === 1 ? 'success' : 'default'} /></TableCell>
                                                <TableCell>{acc.currency || '-'}</TableCell>
                                                <TableCell>{acc.amount_spent ? (parseInt(acc.amount_spent) / 100).toFixed(2) : '0'}</TableCell>
                                            </TableRow>
                                        ))}
                                        {adAccounts.length === 0 && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}>لا توجد حسابات إعلانية</TableCell></TableRow>}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Paper>
                    )}

                    {activeTab === 'assets' && assets && (
                        <Grid container spacing={3}>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <Paper sx={{ p: 3 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                                        <Store />
                                        <Typography variant="h6" fontWeight={600}>الصفحات ({assets.pages?.length || 0})</Typography>
                                    </Box>
                                    {(assets.pages || []).map((page, i) => (
                                        <Box key={i} sx={{ py: 1.5, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                            <Typography fontWeight={600}>{page.name}</Typography>
                                            <Typography variant="body2" color="text.secondary">{page.category} • ID: {page.id}</Typography>
                                        </Box>
                                    ))}
                                    {(!assets.pages || assets.pages.length === 0) && <Typography color="text.secondary">لا توجد صفحات</Typography>}
                                </Paper>
                            </Grid>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <Paper sx={{ p: 3 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                                        <AccountBalance />
                                        <Typography variant="h6" fontWeight={600}>حسابات واتساب ({assets.whatsapp_accounts?.length || 0})</Typography>
                                    </Box>
                                    {(assets.whatsapp_accounts || []).map((wa, i) => (
                                        <Box key={i} sx={{ py: 1.5, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                            <Typography fontWeight={600}>{wa.name}</Typography>
                                            <Typography variant="body2" color="text.secondary">ID: {wa.id} • {wa.currency}</Typography>
                                        </Box>
                                    ))}
                                    {(!assets.whatsapp_accounts || assets.whatsapp_accounts.length === 0) && <Typography color="text.secondary">لا توجد حسابات واتساب</Typography>}
                                </Paper>
                            </Grid>
                        </Grid>
                    )}
                </>
            )}

            <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError('')}>
                <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
            </Snackbar>
        </Box>
    );
};

export default BusinessManager;
