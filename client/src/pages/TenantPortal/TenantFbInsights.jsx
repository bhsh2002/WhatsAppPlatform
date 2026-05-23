import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Paper, Grid, Card, CardContent, CircularProgress, Alert, Snackbar, FormControl, InputLabel, Select, MenuItem, TextField, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip } from '@mui/material';
import { BarChart as BarChartIcon, Visibility as ViewsIcon, ThumbUp as ReactionsIcon, ChatBubble as CommentsIcon, People as FollowersIcon, Refresh as RefreshIcon, Share as ShareIcon } from '@mui/icons-material';
import api from '../../api';
import { tx } from "../../i18n/tx";
import { getCurrentLocale } from "../../utils/locale";
const TenantFbInsights = () => {
  const [pages, setPages] = useState([]);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [pagesLoading, setPagesLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewWarning, setOverviewWarning] = useState('');
  const [daily, setDaily] = useState([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyWarning, setDailyWarning] = useState('');
  const [since, setSince] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [until, setUntil] = useState(new Date().toISOString().split('T')[0]);
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsWarning, setPostsWarning] = useState('');
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success'
  });
  const loadPages = useCallback(async () => {
    try {
      setPagesLoading(true);
      const data = await api.getPortalPages();
      setPages(Array.isArray(data) ? data : []);
      setSelectedPageId(prev => prev || (data.length > 0 ? data[0].id : ''));
    } catch (err) {
      console.error('Failed to load pages:', err);
    } finally {
      setPagesLoading(false);
    }
  }, []);
  useEffect(() => {
    loadPages();
  }, [loadPages]);
  const loadOverview = useCallback(async () => {
    if (!selectedPageId) return;
    try {
      setOverviewLoading(true);
      const data = await api.getPortalFbOverview(selectedPageId);
      setOverview(data);
      setOverviewWarning(data.insights_error || '');
    } catch (err) {
      setOverviewWarning('');
      setSnackbar({
        open: true,
        message: err.message || tx("auto.k_89aa354d481e"),
        severity: 'error'
      });
    } finally {
      setOverviewLoading(false);
    }
  }, [selectedPageId]);
  const loadDaily = useCallback(async () => {
    if (!selectedPageId) return;
    try {
      setDailyLoading(true);
      const data = await api.getPortalFbDaily(selectedPageId, {
        since,
        until
      });
      setDaily(data.daily || []);
      setDailyWarning(data.insights_error || '');
    } catch (err) {
      setDailyWarning('');
      setSnackbar({
        open: true,
        message: err.message || tx("auto.k_f2b84148b823"),
        severity: 'error'
      });
    } finally {
      setDailyLoading(false);
    }
  }, [selectedPageId, since, until]);
  const loadPosts = useCallback(async () => {
    if (!selectedPageId) return;
    try {
      setPostsLoading(true);
      const data = await api.getPortalFbPostInsights(selectedPageId, {
        limit: 10
      });
      setPosts(data.posts || []);
      const failedCount = (data.posts || []).filter(post => post.insights_error).length;
      setPostsWarning(failedCount ? tx("auto.k_4feebc41ff55", {
        value1: failedCount
      }) : '');
    } catch (err) {
      setPostsWarning('');
      setSnackbar({
        open: true,
        message: err.message || tx("auto.k_9b52ef1426d6"),
        severity: 'error'
      });
    } finally {
      setPostsLoading(false);
    }
  }, [selectedPageId]);
  useEffect(() => {
    if (selectedPageId) loadOverview();
  }, [selectedPageId, loadOverview]);
  useEffect(() => {
    if (selectedPageId) loadDaily();
  }, [selectedPageId, loadDaily]);
  useEffect(() => {
    if (selectedPageId) loadPosts();
  }, [selectedPageId, loadPosts]);
  const refreshAll = () => {
    if (selectedPageId) {
      loadOverview();
      loadDaily();
      loadPosts();
    }
  };
  const formatNumber = n => {
    if (n === null || n === undefined) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
  };
  if (pagesLoading) {
    return <Box sx={{
      display: 'flex',
      justifyContent: 'center',
      p: 6
    }}><CircularProgress /></Box>;
  }
  const statCards = [{
    label: tx("auto.k_111b3f5b0f7c"),
    value: overview?.metrics?.views_28d ?? '—',
    color: '#2196f3',
    icon: <ViewsIcon />
  }, {
    label: tx("auto.k_0b97e0306a84"),
    value: overview?.metrics?.post_likes_28d ?? '—',
    color: '#4caf50',
    icon: <ReactionsIcon />
  }, {
    label: tx("auto.k_ea77f13669e0"),
    value: overview?.metrics?.post_comments_28d ?? '—',
    color: '#ff9800',
    icon: <CommentsIcon />
  }, {
    label: tx("auto.k_08752d4e659a"),
    value: overview?.metrics?.post_shares_28d ?? '—',
    color: '#00acc1',
    icon: <ShareIcon />
  }, {
    label: tx("auto.k_2d9a80bdda0a"),
    value: overview?.metrics?.reactions_28d ?? '—',
    color: '#7e57c2',
    icon: <BarChartIcon />
  }, {
    label: tx("auto.k_af74bc1f1dd9"),
    value: formatNumber(overview?.page?.followers_count) ?? '—',
    color: '#9c27b0',
    icon: <FollowersIcon />
  }];
  return <Box sx={{
    p: {
      xs: 1.5,
      md: 3
    }
  }}>
            <Box sx={{
      display: 'flex',
      flexDirection: {
        xs: 'column',
        md: 'row'
      },
      justifyContent: 'space-between',
      alignItems: {
        xs: 'flex-start',
        md: 'center'
      },
      mb: 3,
      gap: {
        xs: 1,
        md: 0
      }
    }}>
                <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2
      }}>
                    <BarChartIcon sx={{
          fontSize: 32,
          color: '#1877f2'
        }} />
                    <Box>
                        <Typography variant="h5" fontWeight={700}>{tx("auto.k_d96818c8ec20")}</Typography>
                        <Typography variant="body2" color="text.secondary">{tx("auto.k_bab80653a0c9")}</Typography>
                    </Box>
                </Box>
                <Box sx={{
        display: 'flex',
        gap: 1,
        alignItems: 'center'
      }}>
                    <FormControl size="small" sx={{
          minWidth: 250
        }}>
                        <InputLabel>{tx("auto.k_338c505c00b5")}</InputLabel>
                        <Select value={selectedPageId} onChange={e => setSelectedPageId(e.target.value)} label={tx("auto.k_338c505c00b5")}>
                            {pages.length === 0 ? <MenuItem value="" disabled>{tx("auto.k_43a46f260ab6")}</MenuItem> : pages.map(page => <MenuItem key={page.id} value={page.id}>
                                        {page.page_name || page.page_id}
                                    </MenuItem>)}
                        </Select>
                    </FormControl>
                    <Button startIcon={<RefreshIcon />} onClick={refreshAll} variant="outlined" disabled={!selectedPageId}>{tx("auto.k_4309a75e6882")}

          </Button>
                </Box>
            </Box>

            {selectedPageId && <>
                    {overviewWarning && <Alert severity="warning" sx={{
        mb: 2
      }}>{overviewWarning}</Alert>}
                    {overviewLoading ? <Box sx={{
        display: 'flex',
        justifyContent: 'center',
        p: 4
      }}><CircularProgress /></Box> : <Grid container spacing={3} sx={{
        mb: 4
      }}>
                            {statCards.map((card, i) => <Grid size={{
          xs: 6,
          md: 2
        }} key={i}>
                                    <Card sx={{
            bgcolor: card.color + '10',
            border: `1px solid ${card.color}30`
          }}>
                                        <CardContent sx={{
              textAlign: 'center'
            }}>
                                            <Box sx={{
                color: card.color,
                mb: 1
              }}>{card.icon}</Box>
                                            <Typography variant="h4" fontWeight={700} sx={{
                color: card.color
              }}>
                                                {typeof card.value === 'number' ? formatNumber(card.value) : card.value}
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">{card.label}</Typography>
                                        </CardContent>
                                    </Card>
                                </Grid>)}
                        </Grid>}

                    <Paper sx={{
        p: 3,
        mb: 4
      }}>
                        <Box sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
          flexWrap: 'wrap',
          gap: 1
        }}>
                            <Typography variant="h6" fontWeight={600}>{tx("auto.k_afb391de4935")}</Typography>
                            <Box sx={{
            display: 'flex',
            gap: 1,
            alignItems: 'center'
          }}>
                                <TextField type="date" size="small" label={tx("auto.k_aa7099e27834")} value={since} onChange={e => setSince(e.target.value)} InputLabelProps={{
              shrink: true
            }} />
                                <TextField type="date" size="small" label={tx("auto.k_8ab80326e0b9")} value={until} onChange={e => setUntil(e.target.value)} InputLabelProps={{
              shrink: true
            }} />
                                <Button size="small" variant="contained" onClick={loadDaily} disabled={dailyLoading}>{tx("auto.k_b177f0b389bb")}</Button>
                            </Box>
                        </Box>
                        {dailyWarning && <Alert severity="warning" sx={{
          mb: 2
        }}>{dailyWarning}</Alert>}
                        {dailyLoading ? <Box sx={{
          display: 'flex',
          justifyContent: 'center',
          p: 4
        }}><CircularProgress size={24} /></Box> : daily.length === 0 ? <Typography color="text.secondary" sx={{
          textAlign: 'center',
          py: 4
        }}>{tx("auto.k_7160a26a43a0")}</Typography> : <TableContainer sx={{
          overflowX: 'auto'
        }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>{tx("auto.k_d94d702d8343")}</TableCell>
                                            <TableCell align="center">{tx("auto.k_80edf8765b89")}</TableCell>
                                            <TableCell align="center">{tx("auto.k_5883cddbd20d")}</TableCell>
                                            <TableCell align="center">{tx("auto.k_209d8ef22f5f")}</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {daily.map((row, i) => <TableRow key={i}>
                                                <TableCell>{row.date}</TableCell>
                                                <TableCell align="center"><Chip label={row.views} size="small" color="primary" variant="outlined" /></TableCell>
                                                <TableCell align="center"><Chip label={row.reactions} size="small" color="success" variant="outlined" /></TableCell>
                                                <TableCell align="center"><Chip label={row.video_views} size="small" color="warning" variant="outlined" /></TableCell>
                                            </TableRow>)}
                                    </TableBody>
                                </Table>
                            </TableContainer>}
                    </Paper>

                    <Paper sx={{
        p: 3
      }}>
                        <Typography variant="h6" fontWeight={600} sx={{
          mb: 2
        }}>{tx("auto.k_bc3c2ae694da")}</Typography>
                        {postsWarning && <Alert severity="warning" sx={{
          mb: 2
        }}>{postsWarning}</Alert>}
                        {postsLoading ? <Box sx={{
          display: 'flex',
          justifyContent: 'center',
          p: 4
        }}><CircularProgress size={24} /></Box> : posts.length === 0 ? <Typography color="text.secondary" sx={{
          textAlign: 'center',
          py: 4
        }}>{tx("auto.k_38782c1ee3bb")}</Typography> : <TableContainer sx={{
          overflowX: 'auto'
        }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>{tx("auto.k_be784686fb34")}</TableCell>
                                            <TableCell align="center">{tx("auto.k_f7a81acc6a00")}</TableCell>
                                            <TableCell align="center">{tx("auto.k_aa42bdc894b4")}</TableCell>
                                            <TableCell align="center">{tx("auto.k_193951738f31")}</TableCell>
                                            <TableCell align="center">{tx("auto.k_5883cddbd20d")}</TableCell>
                                            <TableCell align="center">{tx("auto.k_83769c9b9ca6")}</TableCell>
                                            <TableCell>{tx("auto.k_d94d702d8343")}</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {posts.map(post => <TableRow key={post.id}>
                                                <TableCell sx={{
                  maxWidth: 300
                }}>
                                                    <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1
                  }}>
                                                        {post.full_picture && <Box component="img" src={post.full_picture} sx={{
                      width: 40,
                      height: 40,
                      borderRadius: 1,
                      objectFit: 'cover'
                    }} alt="" />}
                                                        <Typography variant="body2" sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                                                            {post.message || tx("auto.k_ac0609a6f3f8")}
                                                        </Typography>
                                                    </Box>
                                                </TableCell>
                                                <TableCell align="center"><Chip label={formatNumber(post.engagement?.likes || 0)} size="small" color="success" variant="outlined" /></TableCell>
                                                <TableCell align="center"><Chip label={formatNumber(post.engagement?.comments || 0)} size="small" color="warning" variant="outlined" /></TableCell>
                                                <TableCell align="center"><Chip label={formatNumber(post.engagement?.shares || 0)} size="small" color="info" variant="outlined" /></TableCell>
                                                <TableCell align="center"><Chip label={formatNumber(post.engagement?.reactions || 0)} size="small" color="secondary" /></TableCell>
                                                <TableCell align="center">
                                                    {post.insights?.clicks !== null && post.insights?.clicks !== undefined ? <Chip label={formatNumber(post.insights.clicks)} size="small" color="primary" variant="outlined" /> : <Typography variant="body2" color="text.secondary">{post.insights_error ? tx("auto.k_e0578dbdc1e1") : '—'}</Typography>}
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant="body2">
                                                        {post.created_time ? new Date(post.created_time).toLocaleDateString(getCurrentLocale()) : '—'}
                                                    </Typography>
                                                    {post.permalink_url && <Typography variant="caption" component="a" href={post.permalink_url} target="_blank" rel="noopener" sx={{
                    color: 'primary.main',
                    textDecoration: 'none'
                  }}>{tx("auto.k_2deae737e147")}

                    </Typography>}
                                                </TableCell>
                                            </TableRow>)}
                                    </TableBody>
                                </Table>
                            </TableContainer>}
                    </Paper>
                </>}

            {!selectedPageId && pages.length === 0 && <Paper sx={{
      p: 6,
      textAlign: 'center'
    }}>
                    <BarChartIcon sx={{
        fontSize: 60,
        color: 'grey.300',
        mb: 2
      }} />
                    <Typography variant="h6" color="text.secondary">{tx("auto.k_43a46f260ab6")}</Typography>
                    <Typography variant="body2" color="text.secondary">{tx("auto.k_ffaf9692ed80")}</Typography>
                </Paper>}

            <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar(prev => ({
      ...prev,
      open: false
    }))}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({
        ...prev,
        open: false
      }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>;
};
export default TenantFbInsights;
