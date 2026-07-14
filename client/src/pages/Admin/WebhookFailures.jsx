import React, { useState, useEffect, useCallback } from 'react';
import { Box, Paper, Typography, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, FormControl, MenuItem, CircularProgress, IconButton, InputLabel, Collapse, Alert, Card, CardContent, Grid } from '@mui/material';
import Select from '../../components/Form/AccessibleSelect';
import { Refresh as RefreshIcon, Replay as ReplayIcon, Delete as DeleteIcon, ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon, Warning as WarningIcon, CheckCircle as CheckCircleIcon, Error as ErrorIcon, HourglassEmpty as HourglassEmptyIcon } from '@mui/icons-material';
import api from '../../api';
import { tx } from "../../i18n/tx";
import { PageTitle } from '../../components/Layout/PageTitle';
import { getCurrentLocale } from "../../utils/locale";
const WebhookFailures = () => {
  const [failures, setFailures] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filterTenant, setFilterTenant] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [tenants, setTenants] = useState([]);
  const [eventTypes, setEventTypes] = useState([]);
  const [expandedRow, setExpandedRow] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const [message, setMessage] = useState(null);
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page,
        limit: 20
      };
      if (filterTenant) params.tenant_id = filterTenant;
      if (filterType) params.event_type = filterType;
      if (filterStatus) params.status = filterStatus;
      const data = await api.getWebhookFailures(params);
      setFailures(data.failures || []);
      setTotalPages(data.totalPages || 1);
      const statsData = await api.getWebhookFailureStats();
      setStats(statsData);
    } catch (error) {
      console.error('Failed to fetch failures:', error);
    } finally {
      setLoading(false);
    }
  }, [page, filterTenant, filterType, filterStatus]);
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  useEffect(() => {
    api.getWebhookFailures({
      limit: 1000
    }).then(data => {
      const tSet = new Set();
      const eSet = new Set();
      (data.failures || []).forEach(f => {
        if (f.tenant_name) tSet.add(f.tenant_name);
        if (f.event_type) eSet.add(f.event_type);
      });
      setTenants([...tSet]);
      setEventTypes([...eSet]);
    });
  }, []);
  const handleRetry = async id => {
    setActionLoading(prev => ({
      ...prev,
      [id]: true
    }));
    try {
      await api.retryWebhookFailure(id);
      setMessage({
        type: 'success',
        text: tx("auto.k_59fb9a96176a")
      });
      fetchData();
    } catch (_err) {
      setMessage({
        type: 'error',
        text: tx("auto.k_0686ba14a728")
      });
    } finally {
      setActionLoading(prev => ({
        ...prev,
        [id]: false
      }));
    }
  };
  const handleDelete = async id => {
    setActionLoading(prev => ({
      ...prev,
      [`del-${id}`]: true
    }));
    try {
      await api.deleteWebhookFailure(id);
      setMessage({
        type: 'success',
        text: tx("auto.k_ff042400f7cd")
      });
      fetchData();
    } catch (_err) {
      setMessage({
        type: 'error',
        text: tx("auto.k_53551aaf96a4")
      });
    } finally {
      setActionLoading(prev => ({
        ...prev,
        [`del-${id}`]: false
      }));
    }
  };
  const handleClearResolved = async () => {
    try {
      const result = await api.clearResolvedFailures();
      setMessage({
        type: 'success',
        text: tx("auto.k_b927b74451ef", {
          value1: result.deleted
        })
      });
      fetchData();
    } catch (_err) {
      setMessage({
        type: 'error',
        text: tx("auto.k_c217bcd407f2")
      });
    }
  };
  const formatTime = dateStr => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleString(getCurrentLocale(), {
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short'
    });
  };
  const formatPayload = payloadStr => {
    try {
      return JSON.stringify(JSON.parse(payloadStr), null, 2);
    } catch {
      return payloadStr;
    }
  };
  return <Box sx={{
    p: 3
  }}>
            <Box sx={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      mb: 3
    }}>
                <PageTitle variant="h5" fontWeight="bold">{tx("auto.k_87641ff22da7")}

        </PageTitle>
                <Box sx={{
        display: 'flex',
        gap: 1
      }}>
                    <Button variant="outlined" startIcon={<DeleteIcon />} onClick={handleClearResolved}>{tx("auto.k_260e9cca3252")}

          </Button>
                    <Button variant="contained" startIcon={<RefreshIcon />} onClick={fetchData}>{tx("auto.k_4309a75e6882")}

          </Button>
                </Box>
            </Box>

            {message && <Alert severity={message.type} sx={{
      mb: 2
    }} onClose={() => setMessage(null)}>
                    {message.text}
                </Alert>}

            {stats && <Grid container spacing={2} sx={{
      mb: 3
    }}>
                    <Grid size={{
        xs: 4
      }}>
                        <Card>
                            <CardContent sx={{
            textAlign: 'center',
            py: 1
          }}>
                                <ErrorIcon color="error" sx={{
              fontSize: 30
            }} />
                                <Typography component="p" variant="h4" fontWeight="bold" color="error.main">
                                    {stats.byStatus?.pending || 0}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">{tx("auto.k_2fa782fb9348")}</Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid size={{
        xs: 4
      }}>
                        <Card>
                            <CardContent sx={{
            textAlign: 'center',
            py: 1
          }}>
                                <HourglassEmptyIcon color="warning" sx={{
              fontSize: 30
            }} />
                                <Typography component="p" variant="h4" fontWeight="bold" color="warning.main">
                                    {stats.byStatus?.resolved || 0}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">{tx("auto.k_2ff7397b3e05")}</Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid size={{
        xs: 4
      }}>
                        <Card>
                            <CardContent sx={{
            textAlign: 'center',
            py: 1
          }}>
                                <CheckCircleIcon color="success" sx={{
              fontSize: 30
            }} />
                                <Typography component="p" variant="h4" fontWeight="bold">
                                    {stats.byStatus?.total || 0}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">{tx("auto.k_413c51af19b5")}</Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>}

            <Paper sx={{
      p: 2,
      mb: 2
    }}>
                <Box sx={{
        display: 'flex',
        gap: 2,
        flexWrap: 'wrap',
        alignItems: 'center'
      }}>
                    <FormControl size="small" sx={{
          minWidth: 150
        }}>
                        <InputLabel>{tx("auto.k_8adba91e1d87")}</InputLabel>
                        <Select value={filterTenant} label={tx("auto.k_8adba91e1d87")} onChange={e => {
            setFilterTenant(e.target.value);
            setPage(1);
          }}>
                            <MenuItem value="">{tx("auto.k_11fdef2dc5f8")}</MenuItem>
                            {tenants.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <FormControl size="small" sx={{
          minWidth: 150
        }}>
                        <InputLabel>{tx("auto.k_92704b9ecc04")}</InputLabel>
                        <Select value={filterType} label={tx("auto.k_92704b9ecc04")} onChange={e => {
            setFilterType(e.target.value);
            setPage(1);
          }}>
                            <MenuItem value="">{tx("auto.k_11fdef2dc5f8")}</MenuItem>
                            {eventTypes.map(e => <MenuItem key={e} value={e}>{e}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <FormControl size="small" sx={{
          minWidth: 120
        }}>
                        <InputLabel>{tx("auto.k_d6370401145d")}</InputLabel>
                        <Select value={filterStatus} label={tx("auto.k_d6370401145d")} onChange={e => {
            setFilterStatus(e.target.value);
            setPage(1);
          }}>
                            <MenuItem value="">{tx("auto.k_11fdef2dc5f8")}</MenuItem>
                            <MenuItem value="pending">{tx("auto.k_303e2749dc14")}</MenuItem>
                            <MenuItem value="resolved">{tx("auto.k_eebc94e2ad19")}</MenuItem>
                        </Select>
                    </FormControl>
                </Box>
            </Paper>

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>#</TableCell>
                            <TableCell>{tx("auto.k_8adba91e1d87")}</TableCell>
                            <TableCell>{tx("auto.k_033626158b17")}</TableCell>
                            <TableCell>{tx("auto.k_f88ae854cdea")}</TableCell>
                            <TableCell>{tx("auto.k_0c099a1262ea")}</TableCell>
                            <TableCell>{tx("auto.k_ba6b401d8f75")}</TableCell>
                            <TableCell>{tx("auto.k_d6370401145d")}</TableCell>
                            <TableCell>{tx("auto.k_8edfb81a349f")}</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {loading ? <TableRow>
                                <TableCell colSpan={8} align="center" sx={{
              py: 3
            }}>
                                    <CircularProgress />
                                </TableCell>
                            </TableRow> : failures.length === 0 ? <TableRow>
                                <TableCell colSpan={8} align="center" sx={{
              py: 3
            }}>
                                    <Typography color="text.secondary">{tx("auto.k_b29d04e6873a")}</Typography>
                                </TableCell>
                            </TableRow> : failures.map((f, idx) => <React.Fragment key={f.id}>
                                    <TableRow hover>
                                        <TableCell>{(page - 1) * 20 + idx + 1}</TableCell>
                                        <TableCell>{f.tenant_name || '—'}</TableCell>
                                        <TableCell><Chip label={f.event_type} size="small" /></TableCell>
                                        <TableCell sx={{
                maxWidth: 200,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                                            {f.error_message}
                                        </TableCell>
                                        <TableCell>{f.retry_count}</TableCell>
                                        <TableCell>{formatTime(f.created_at)}</TableCell>
                                        <TableCell>
                                            {f.resolved_at ? <Chip label={tx("auto.k_eebc94e2ad19")} color="success" size="small" /> : <Chip label={tx("auto.k_303e2749dc14")} color="error" size="small" />}
                                        </TableCell>
                                        <TableCell>
                                            {!f.resolved_at && <IconButton size="small" onClick={() => handleRetry(f.id)} disabled={actionLoading[f.id]} title={tx("auto.k_2e47b5f289f1")}>
                                                    <ReplayIcon fontSize="small" />
                                                </IconButton>}
                                            <IconButton size="small" onClick={() => setExpandedRow(expandedRow === f.id ? null : f.id)} title={tx("auto.k_bc58ad8f1bce")}>
                                                {expandedRow === f.id ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                            </IconButton>
                                            <IconButton size="small" onClick={() => handleDelete(f.id)} disabled={actionLoading[`del-${f.id}`]} title={tx("auto.k_2d2bbdc2d694")}>
                                                <DeleteIcon fontSize="small" color="error" />
                                            </IconButton>
                                        </TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell colSpan={8} sx={{
                py: 0
              }}>
                                            <Collapse in={expandedRow === f.id}>
                                                <Box sx={{
                    p: 2,
                    bgcolor: 'grey.50',
                    maxWidth: '100%',
                    overflow: 'auto'
                  }}>
                                                    <Typography variant="caption" color="text.secondary" sx={{
                      mb: 1,
                      display: 'block'
                    }}>{tx("auto.k_c95c582f992e")}</Typography>
                                                    <pre style={{
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      margin: 0
                    }}>
                                                        {formatPayload(f.payload)}
                                                    </pre>
                                                </Box>
                                            </Collapse>
                                        </TableCell>
                                    </TableRow>
                                </React.Fragment>)}
                    </TableBody>
                </Table>
            </TableContainer>

            {totalPages > 1 && <Box sx={{
      display: 'flex',
      justifyContent: 'center',
      gap: 1,
      mt: 2
    }}>
                    <Button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{tx("auto.k_f533ebab64f4")}</Button>
                    <Typography sx={{
        py: 1
      }}>{page} / {totalPages}</Typography>
                    <Button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{tx("auto.k_2fa619787bcb")}</Button>
                </Box>}
        </Box>;
};
export default WebhookFailures;
