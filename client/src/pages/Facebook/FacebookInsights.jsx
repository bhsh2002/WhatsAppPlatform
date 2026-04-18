import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Typography, Paper, Grid, Card, CardContent, CircularProgress,
    Alert, Snackbar, FormControl, InputLabel, Select, MenuItem, TextField,
    Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Chip, Avatar
} from '@mui/material';
import {
    BarChart as BarChartIcon, Visibility as ViewsIcon,
    ThumbUp as ReactionsIcon, Videocam as VideoIcon,
    People as FollowersIcon, Refresh as RefreshIcon
} from '@mui/icons-material';
import api from '../../api';

const FacebookInsights = () => {
    const [allPages, setAllPages] = useState([]);
    const [selectedPageId, setSelectedPageId] = useState('');
    const [pagesLoading, setPagesLoading] = useState(true);

    const [overview, setOverview] = useState(null);
    const [overviewLoading, setOverviewLoading] = useState(false);

    const [daily, setDaily] = useState([]);
    const [dailyLoading, setDailyLoading] = useState(false);
    const [since, setSince] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().split('T')[0];
    });
    const [until, setUntil] = useState(new Date().toISOString().split('T')[0]);

    const [posts, setPosts] = useState([]);
    const [postsLoading, setPostsLoading] = useState(false);

    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    const loadAllPages = useCallback(async () => {
        try {
            setPagesLoading(true);
            const data = await api.getFbAllPages();
            setAllPages(Array.isArray(data) ? data : []);
            if (data.length > 0 && !selectedPageId) {
                setSelectedPageId(data[0].id);
            }
        } catch (err) {
            console.error('Failed to load pages:', err);
        } finally {
            setPagesLoading(false);
        }
    }, []);

    useEffect(() => { loadAllPages(); }, [loadAllPages]);

    const loadOverview = useCallback(async () => {
        if (!selectedPageId) return;
        try {
            setOverviewLoading(true);
            const data = await api.getFbPageOverview(selectedPageId);
            setOverview(data);
        } catch (err) {
            console.error('Failed to load overview:', err);
        } finally {
            setOverviewLoading(false);
        }
    }, [selectedPageId]);

    const loadDaily = useCallback(async () => {
        if (!selectedPageId) return;
        try {
            setDailyLoading(true);
            const data = await api.getFbPageDaily(selectedPageId, { since, until });
            setDaily(data.daily || []);
        } catch (err) {
            console.error('Failed to load daily:', err);
        } finally {
            setDailyLoading(false);
        }
    }, [selectedPageId, since, until]);

    const loadPosts = useCallback(async () => {
        if (!selectedPageId) return;
        try {
            setPostsLoading(true);
            const data = await api.getFbPostInsights(selectedPageId, { limit: 10 });
            setPosts(data.posts || []);
        } catch (err) {
            console.error('Failed to load posts:', err);
        } finally {
            setPostsLoading(false);
        }
    }, [selectedPageId]);

    useEffect(() => { if (selectedPageId) loadOverview(); }, [selectedPageId, loadOverview]);
    useEffect(() => { if (selectedPageId) loadDaily(); }, [selectedPageId, loadDaily]);
    useEffect(() => { if (selectedPageId) loadPosts(); }, [selectedPageId, loadPosts]);

    const refreshAll = () => {
        if (selectedPageId) {
            loadOverview();
            loadDaily();
            loadPosts();
        }
    };

    const formatNumber = (n) => {
        if (n === null || n === undefined) return '—';
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toLocaleString();
    };

    if (pagesLoading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}><CircularProgress /></Box>;
    }

    const statCards = [
        { label: 'مشاهدات (28 يوم)', value: overview?.metrics?.views_28d ?? '—', color: '#2196f3', icon: <ViewsIcon /> },
        { label: 'تفاعلات (28 يوم)', value: overview?.metrics?.reactions_28d ?? '—', color: '#4caf50', icon: <ReactionsIcon /> },
        { label: 'مشاهدات فيديو (28 يوم)', value: overview?.metrics?.video_views_28d ?? '—', color: '#ff9800', icon: <VideoIcon /> },
        { label: 'متابعين', value: formatNumber(overview?.page?.followers_count) ?? '—', color: '#9c27b0', icon: <FollowersIcon /> },
    ];

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, mb: 3, gap: { xs: 1, md: 0 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <BarChartIcon sx={{ fontSize: 32, color: '#1877f2' }} />
                    <Box>
                        <Typography variant="h5" fontWeight={700}>تحليلات فيسبوك</Typography>
                        <Typography variant="body2" color="text.secondary">إحصائيات الصفحات وأداء المنشورات</Typography>
                    </Box>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <FormControl size="small" sx={{ minWidth: 250 }}>
                        <InputLabel>اختر صفحة</InputLabel>
                        <Select value={selectedPageId} onChange={(e) => setSelectedPageId(e.target.value)} label="اختر صفحة">
                            {allPages.length === 0 ? (
                                <MenuItem value="" disabled>لا توجد صفحات مربوطة</MenuItem>
                            ) : (
                                allPages.map(page => (
                                    <MenuItem key={page.id} value={page.id}>
                                        {page.page_name || page.page_id}
                                        {page.tenant_name && <Chip label={page.tenant_name} size="small" sx={{ ml: 1 }} />}
                                    </MenuItem>
                                ))
                            )}
                        </Select>
                    </FormControl>
                    <Button startIcon={<RefreshIcon />} onClick={refreshAll} variant="outlined" disabled={!selectedPageId}>
                        تحديث
                    </Button>
                </Box>
            </Box>

            {selectedPageId && (
                <>
                    {/* KPI Cards */}
                    {overviewLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                    ) : (
                        <Grid container spacing={3} sx={{ mb: 4 }}>
                            {statCards.map((card, i) => (
                                <Grid size={{ xs: 6, md: 3 }} key={i}>
                                    <Card sx={{ bgcolor: card.color + '10', border: `1px solid ${card.color}30` }}>
                                        <CardContent sx={{ textAlign: 'center' }}>
                                            <Box sx={{ color: card.color, mb: 1 }}>{card.icon}</Box>
                                            <Typography variant="h4" fontWeight={700} sx={{ color: card.color }}>
                                                {typeof card.value === 'number' ? formatNumber(card.value) : card.value}
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">{card.label}</Typography>
                                        </CardContent>
                                    </Card>
                                </Grid>
                            ))}
                        </Grid>
                    )}

                    {/* Daily Metrics */}
                    <Paper sx={{ p: 3, mb: 4 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                            <Typography variant="h6" fontWeight={600}>النشاط اليومي</Typography>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                <TextField type="date" size="small" label="من" value={since} onChange={(e) => setSince(e.target.value)} InputLabelProps={{ shrink: true }} />
                                <TextField type="date" size="small" label="إلى" value={until} onChange={(e) => setUntil(e.target.value)} InputLabelProps={{ shrink: true }} />
                                <Button size="small" variant="contained" onClick={loadDaily} disabled={dailyLoading}>تطبيق</Button>
                            </Box>
                        </Box>
                        {dailyLoading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={24} /></Box>
                        ) : daily.length === 0 ? (
                            <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>لا تتوفر بيانات كافية</Typography>
                        ) : (
                            <TableContainer sx={{ overflowX: 'auto' }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>التاريخ</TableCell>
                                            <TableCell align="center">مشاهدات</TableCell>
                                            <TableCell align="center">تفاعلات</TableCell>
                                            <TableCell align="center">مشاهدات فيديو</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {daily.map((row, i) => (
                                            <TableRow key={i}>
                                                <TableCell>{row.date}</TableCell>
                                                <TableCell align="center"><Chip label={row.views} size="small" color="primary" variant="outlined" /></TableCell>
                                                <TableCell align="center"><Chip label={row.reactions} size="small" color="success" variant="outlined" /></TableCell>
                                                <TableCell align="center"><Chip label={row.video_views} size="small" color="warning" variant="outlined" /></TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </Paper>

                    {/* Post Performance */}
                    <Paper sx={{ p: 3 }}>
                        <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>أداء المنشورات</Typography>
                        {postsLoading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={24} /></Box>
                        ) : posts.length === 0 ? (
                            <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>لا توجد منشورات</Typography>
                        ) : (
                            <TableContainer sx={{ overflowX: 'auto' }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>المنشور</TableCell>
                                            <TableCell align="center">تفاعلات</TableCell>
                                            <TableCell align="center">نقرات</TableCell>
                                            <TableCell>التاريخ</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {posts.map((post) => (
                                            <TableRow key={post.id}>
                                                <TableCell sx={{ maxWidth: 300 }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        {post.full_picture && (
                                                            <Box component="img" src={post.full_picture} sx={{ width: 40, height: 40, borderRadius: 1, objectFit: 'cover' }} alt="" />
                                                        )}
                                                        <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {post.message || '(منشور بدون نص)'}
                                                        </Typography>
                                                    </Box>
                                                </TableCell>
                                                <TableCell align="center">
                                                    {post.insights ? (
                                                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                                                            <Chip label={post.insights.reactions.total} size="small" color="success" />
                                                            <Typography variant="caption" color="text.secondary">
                                                                👍{post.insights.reactions.like} ❤️{post.insights.reactions.love} 😮{post.insights.reactions.wow}
                                                            </Typography>
                                                        </Box>
                                                    ) : (
                                                        <Typography variant="body2" color="text.secondary">—</Typography>
                                                    )}
                                                </TableCell>
                                                <TableCell align="center">
                                                    {post.insights ? (
                                                        <Chip label={post.insights.clicks} size="small" color="primary" variant="outlined" />
                                                    ) : (
                                                        <Typography variant="body2" color="text.secondary">—</Typography>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant="body2">
                                                        {post.created_time ? new Date(post.created_time).toLocaleDateString('ar-LY') : '—'}
                                                    </Typography>
                                                    {post.permalink_url && (
                                                        <Typography variant="caption" component="a" href={post.permalink_url} target="_blank" rel="noopener" sx={{ color: 'primary.main', textDecoration: 'none' }}>
                                                            عرض المنشور
                                                        </Typography>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </Paper>
                </>
            )}

            <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default FacebookInsights;
