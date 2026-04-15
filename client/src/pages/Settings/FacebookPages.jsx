import React, { useState } from 'react';
import {
    Box, Typography, Paper, Button, CircularProgress, Alert, Snackbar,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, Avatar
} from '@mui/material';
import { Facebook as FacebookIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import api from '../../api';

const FacebookPages = () => {
    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState('');

    const loadPages = async () => {
        try {
            setLoading(true);
            setError('');
            const data = await api.getMyPages();
            setPages(data.pages || []);
            setLoaded(true);
        } catch (err) {
            setError(err.message || 'فشل جلب الصفحات');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'flex-start', md: 'center' }, justifyContent: 'space-between', mb: 3, gap: { xs: 1, md: 0 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <FacebookIcon sx={{ fontSize: 32, color: '#1877f2' }} />
                    <Box>
                        <Typography variant="h5" fontWeight={700}>صفحات فيسبوك</Typography>
                        <Typography variant="body2" color="text.secondary">الصفحات المرتبطة بحسابك (pages_show_list)</Typography>
                    </Box>
                </Box>
                <Button variant="contained" startIcon={loading ? <CircularProgress size={18} /> : <RefreshIcon />}
                    onClick={loadPages} disabled={loading} sx={{ bgcolor: '#1877f2' }}>
                    {loaded ? 'تحديث' : 'جلب الصفحات'}
                </Button>
            </Box>

            {!loaded && !loading && (
                <Paper sx={{ p: 6, textAlign: 'center' }}>
                    <FacebookIcon sx={{ fontSize: 64, color: '#1877f2', mb: 2, opacity: 0.5 }} />
                    <Typography variant="h6" gutterBottom>اضغط &quot;جلب الصفحات&quot; لعرض الصفحات المرتبطة</Typography>
                    <Typography variant="body2" color="text.secondary">يتطلب هذا إذن pages_show_list من Meta</Typography>
                </Paper>
            )}

            {loaded && (
                <Paper>
                    <TableContainer>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>الصفحة</TableCell>
                                    <TableCell>التصنيف</TableCell>
                                    <TableCell>المتابعين</TableCell>
                                    <TableCell>الحالة</TableCell>
                                    <TableCell>التحقق</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {pages.map((page, i) => (
                                    <TableRow key={i}>
                                        <TableCell>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                                <Avatar src={page.picture?.data?.url} sx={{ width: 36, height: 36 }}>
                                                    <FacebookIcon />
                                                </Avatar>
                                                <Box>
                                                    <Typography fontWeight={600}>{page.name}</Typography>
                                                    <Typography variant="caption" color="text.secondary">ID: {page.id}</Typography>
                                                </Box>
                                            </Box>
                                        </TableCell>
                                        <TableCell>{page.category || '-'}</TableCell>
                                        <TableCell>{page.fan_count?.toLocaleString() || '0'}</TableCell>
                                        <TableCell>
                                            <Chip label={page.is_published ? 'منشورة' : 'غير منشورة'} size="small"
                                                color={page.is_published ? 'success' : 'default'} />
                                        </TableCell>
                                        <TableCell>
                                            <Chip label={page.verification_status || 'غير محقق'} size="small"
                                                color={page.verification_status === 'blue_verified' ? 'primary' : 'default'} variant="outlined" />
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {pages.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                            لا توجد صفحات مرتبطة
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Paper>
            )}

            <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError('')}>
                <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
            </Snackbar>
        </Box>
    );
};

export default FacebookPages;
