import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Paper, Grid, Card, CardContent, Button, TextField, Chip, CircularProgress, Alert, Snackbar, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem } from '@mui/material';
import { TrendingUp as TrendingUpIcon, Add as AddIcon, ShoppingCart, PersonAdd, Visibility } from '@mui/icons-material';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { tx } from "../../i18n/tx";
import { PageTitle } from '../../components/Layout/PageTitle';
import { getCurrentLocale } from "../../utils/locale";
const getEventTypes = () => [{
  value: 'Purchase',
  label: tx("auto.k_c48e5f785436"),
  icon: <ShoppingCart />
}, {
  value: 'AddToCart',
  label: tx("auto.k_d20ea65fce87"),
  icon: <ShoppingCart />
}, {
  value: 'LeadSubmitted',
  label: tx("auto.k_8125ae6104d4"),
  icon: <PersonAdd />
}, {
  value: 'InitiateCheckout',
  label: tx("auto.k_9426678a5988"),
  icon: <ShoppingCart />
}, {
  value: 'ViewContent',
  label: tx("auto.k_9629872d2787"),
  icon: <Visibility />
}, {
  value: 'OrderCreated',
  label: tx("auto.k_01dc0720a866"),
  icon: <ShoppingCart />
}, {
  value: 'OrderShipped',
  label: tx("auto.k_c3c3c4dec39f"),
  icon: <ShoppingCart />
}];
const parseMetaResponse = value => {
  if (!value) return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
};
const formatMetaResponse = (value, status) => {
  const meta = parseMetaResponse(value);
  if (!meta) return '-';
  if (status === 'sent') {
    const parts = [];
    if (meta.events_received !== undefined) parts.push(`events: ${meta.events_received}`);
    if (meta.fbtrace_id) parts.push(`fbtrace_id: ${meta.fbtrace_id}`);
    return parts.join(' | ') || '-';
  }
  const error = meta.error || meta;
  if (!error || typeof error !== 'object') return String(error || '-');
  const parts = [];
  if (error.message) parts.push(error.message);
  if (error.code !== undefined) parts.push(`code: ${error.code}`);
  if (error.subcode !== undefined && error.subcode !== null) parts.push(`subcode: ${error.subcode}`);
  return parts.join(' | ') || '-';
};
const TenantConversions = () => {
  const {
    tenant
  } = useAuth();
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [datasetId, setDatasetId] = useState(tenant?.dataset_id || null);
  const [datasetInput, setDatasetInput] = useState(tenant?.dataset_id || '');
  const [wabaId, setWabaId] = useState(tenant?.waba_id || null);
  const [datasets, setDatasets] = useState([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetSaving, setDatasetSaving] = useState(false);
  const [eventsApiReady, setEventsApiReady] = useState(!!tenant?.dataset_id);
  const [whatsappTokenPresent, setWhatsappTokenPresent] = useState(false);
  const [lastSuccess, setLastSuccess] = useState(null);
  const [lastFailure, setLastFailure] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [logOpen, setLogOpen] = useState(false);
  const [logging, setLogging] = useState(false);
  const [form, setForm] = useState({
    event_name: 'Purchase',
    phone: '',
    ctwa_clid: '',
    value: '',
    currency: 'LYD'
  });
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getPortalConversionHistory();
      setEvents(data.events || []);
      setStats(data.stats || null);
      setDatasetId(data.dataset_id || tenant?.dataset_id || null);
      setDatasetInput(data.dataset_id || tenant?.dataset_id || '');
      setWabaId(data.waba_id || tenant?.waba_id || null);
      setEventsApiReady(!!data.events_api_ready);
      setWhatsappTokenPresent(!!data.whatsapp_token_present);
      setLastSuccess(data.last_success || null);
      setLastFailure(data.last_failure || null);
    } catch (err) {
      setError(err.message || tx("auto.k_419ded9ed797"));
    } finally {
      setLoading(false);
    }
  }, [tenant?.dataset_id, tenant?.waba_id]);
  useEffect(() => {
    loadData();
  }, [loadData]);
  const handleLog = async () => {
    try {
      setLogging(true);
      const payload = {
        event_name: form.event_name,
        phone: form.phone || undefined,
        ctwa_clid: form.ctwa_clid || undefined
      };
      if (form.value) {
        payload.custom_data = {
          value: parseFloat(form.value),
          currency: form.currency
        };
      }
      const result = await api.logPortalConversionEvent(payload);
      setSuccess(result.sent_to_meta ? tx("auto.k_af9f73697aae", {
        value1: result.fbtrace_id ? ` (${result.fbtrace_id})` : ''
      }) : result.note || tx("auto.k_9e7bd6c00bb4"));
      setLogOpen(false);
      setForm({
        event_name: 'Purchase',
        phone: '',
        ctwa_clid: '',
        value: '',
        currency: 'LYD'
      });
      loadData();
    } catch (err) {
      setError(err.message || tx("auto.k_1d75c829dbee"));
    } finally {
      setLogging(false);
    }
  };
  const handleLoadDatasets = async () => {
    try {
      setDatasetsLoading(true);
      setError('');
      const data = await api.getPortalConversionDatasets();
      setDatasets(data.datasets || []);
      if (!datasetInput && data.datasets?.[0]?.id) {
        setDatasetInput(data.datasets[0].id);
      }
      if (!data.datasets?.length) {
        setSuccess(tx("auto.k_c899702bfd7e"));
      }
    } catch (err) {
      setError(err.message || tx("auto.k_7a3a7ae49c07"));
    } finally {
      setDatasetsLoading(false);
    }
  };
  const handleSaveDataset = async () => {
    try {
      setDatasetSaving(true);
      setError('');
      const data = await api.updatePortalMetaSettings({
        dataset_id: datasetInput.trim() || null
      });
      setDatasetId(data.dataset_id || null);
      setSuccess(data.dataset_id ? tx("auto.k_eea549b614f0") : tx("auto.k_db0aa1bd599e"));
      await loadData();
    } catch (err) {
      setError(err.message || tx("auto.k_93e31b004ffe"));
    } finally {
      setDatasetSaving(false);
    }
  };
  if (loading) {
    return <Box sx={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: 400
    }}>
                <CircularProgress />
            </Box>;
  }
  const statCards = [{
    label: tx("auto.k_f21edd9e3149"),
    value: stats?.totalEvents || 0,
    color: '#2196f3'
  }, {
    label: tx("auto.k_893084c0bd0d"),
    value: stats?.sentEvents || 0,
    color: '#4caf50'
  }, {
    label: tx("auto.k_26b28ae8c06c"),
    value: stats?.failedEvents || 0,
    color: '#f44336'
  }, {
    label: tx("auto.k_56a01ae88b0a"),
    value: stats?.localOnlyEvents || 0,
    color: '#607d8b'
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
      alignItems: {
        xs: 'flex-start',
        md: 'center'
      },
      justifyContent: 'space-between',
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
                    <TrendingUpIcon sx={{
          fontSize: 32,
          color: 'secondary.main'
        }} />
                    <Box>
                        <PageTitle variant="h5" fontWeight={700}>{tx("auto.k_ab3289bb27af")}</PageTitle>
                        <Typography variant="body2" color="text.secondary">{tx("auto.k_796d07321412")}</Typography>
                    </Box>
                </Box>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => setLogOpen(true)}><Box component="span" sx={{
          display: {
            xs: 'none',
            md: 'inline'
          }
        }}>{tx("auto.k_2b92c925fbfa")}</Box></Button>
            </Box>

            <Grid container spacing={3} sx={{
      mb: 4
    }}>
                {statCards.map((card, i) => <Grid size={{
        xs: 12,
        sm: 6,
        md: 3
      }} key={i}>
                        <Card sx={{
          bgcolor: card.color + '10',
          border: `1px solid ${card.color}30`
        }}>
                            <CardContent sx={{
            textAlign: 'center'
          }}>
                                <Typography component="p" variant="h3" fontWeight={700} sx={{
              color: card.color
            }}>{card.value}</Typography>
                                <Typography variant="body2" color="text.secondary">{card.label}</Typography>
                            </CardContent>
                        </Card>
                    </Grid>)}
            </Grid>

            <Alert severity={eventsApiReady ? 'success' : 'warning'} sx={{
      mb: 3
    }}>
                <Typography variant="body2" fontWeight={600}>{tx("auto.k_c5fc0b66929f")}
          {eventsApiReady ? tx("auto.k_fd7a2ae336cc") : tx("auto.k_3ca833b33415")}
                </Typography>
                <Typography variant="caption" component="div">
                    Dataset ID: {datasetId || tx("auto.k_b2c702e73c91")}
                </Typography>
                <Typography variant="caption" component="div">
                    WhatsApp token: {whatsappTokenPresent ? tx("auto.k_5ad7cf172cdb") : tx("auto.k_99cfcee98cae")}
                </Typography>
                <Typography variant="caption" component="div">{tx("auto.k_b206645d4ddc")}
          {lastSuccess?.created_at ? new Date(lastSuccess.created_at).toLocaleString(getCurrentLocale()) : tx("auto.k_87e8e1d53a84")}
                    {lastSuccess?.fbtrace_id ? ` | fbtrace_id: ${lastSuccess.fbtrace_id}` : ''}
                </Typography>
                <Typography variant="caption" component="div">{tx("auto.k_b0924b2f23fd")}
          {lastFailure?.created_at ? new Date(lastFailure.created_at).toLocaleString(getCurrentLocale()) : tx("auto.k_87e8e1d53a84")}
                    {lastFailure?.error_message ? ` | ${lastFailure.error_message}` : ''}
                    {lastFailure?.error_code ? ` | code: ${lastFailure.error_code}` : ''}
                    {lastFailure?.error_subcode ? ` | subcode: ${lastFailure.error_subcode}` : ''}
                </Typography>
                <Typography variant="caption" component="div">{tx("auto.k_a5642c93484e")}

        </Typography>
            </Alert>

            <Paper sx={{
      p: 3,
      mb: 3
    }}>
                <Typography component="h2" variant="h6" fontWeight={700} gutterBottom>{tx("auto.k_bff5776b814d")}

        </Typography>
                <Typography variant="body2" color="text.secondary" sx={{
        mb: 2
      }}>
                    WABA ID: {wabaId || tx("auto.k_b2c702e73c91")}{tx("auto.k_65f21b8497d6")}
        </Typography>
                <Grid container spacing={2} alignItems="center">
                    <Grid size={{
          xs: 12,
          md: 5
        }}>
                        <TextField fullWidth size="small" label="Dataset ID" value={datasetInput} onChange={e => setDatasetInput(e.target.value)} placeholder={tx("auto.k_34b40f450796")} />

                    </Grid>
                    <Grid size={{
          xs: 12,
          md: 3
        }}>
                        <TextField fullWidth select size="small" label={tx("auto.k_fbbb5d876112")} value="" disabled={!datasets.length} onChange={e => setDatasetInput(e.target.value)}>

                            <MenuItem value="" disabled>{datasets.length ? tx("auto.k_e9075ffa78ae") : tx("auto.k_dbe0a73b8161")}</MenuItem>
                            {datasets.map(dataset => <MenuItem key={dataset.id} value={dataset.id}>
                                    {dataset.name || dataset.id}
                                </MenuItem>)}
                        </TextField>
                    </Grid>
                    <Grid size={{
          xs: 12,
          md: 4
        }}>
                        <Box sx={{
            display: 'flex',
            gap: 1,
            flexWrap: 'wrap'
          }}>
                            <Button variant="outlined" onClick={handleLoadDatasets} disabled={datasetsLoading || !wabaId}>

                                {datasetsLoading ? <CircularProgress size={18} /> : tx("auto.k_0f1e4741a346")}
                            </Button>
                            <Button variant="contained" onClick={handleSaveDataset} disabled={datasetSaving}>

                                {datasetSaving ? <CircularProgress size={18} color="inherit" /> : tx("auto.k_45ea3d94786d")}
                            </Button>
                        </Box>
                    </Grid>
                </Grid>
                {datasetId && <Typography variant="caption" color="text.secondary" component="div" sx={{
        mt: 1
      }}>{tx("auto.k_50e9fc8130a3")}
          {datasetId}
                    </Typography>}
            </Paper>

            {stats?.eventBreakdown?.length > 0 && <Paper sx={{
      p: 3,
      mb: 3
    }}>
                    <Typography component="h2" variant="h6" gutterBottom fontWeight={600}>{tx("auto.k_b19c413b6eb9")}</Typography>
                    <Box sx={{
        display: 'flex',
        gap: 2,
        flexWrap: 'wrap'
      }}>
                        {stats.eventBreakdown.map((item, i) => <Chip key={i} label={`${item.event_name}: ${item.count}`} variant="outlined" color="primary" />)}
                    </Box>
                </Paper>}

            <Paper>
                <TableContainer sx={{
        overflowX: 'auto'
      }}>
                    <Table sx={{ minWidth: 1120 }}>
                        <TableHead>
                            <TableRow>
                                <TableCell>{tx("auto.k_b6a6c9a527bb")}</TableCell>
                                <TableCell>{tx("auto.k_760c65a1fab6")}</TableCell>
                                <TableCell>CTWA</TableCell>
                                <TableCell>{tx("auto.k_3c75d6ed4a25")}</TableCell>
                                <TableCell>{tx("auto.k_d6370401145d")}</TableCell>
                                <TableCell>Meta</TableCell>
                                <TableCell>{tx("auto.k_d94d702d8343")}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {events.map(event => <TableRow key={event.id}>
                                    <TableCell>
                                        <Chip label={event.event_name} size="small" color="primary" variant="outlined" />
                                    </TableCell>
                                    <TableCell>{event.phone || '-'}</TableCell>
                                    <TableCell>
                                        {event.ctwa_clid ? <Chip label={tx("auto.k_5ad7cf172cdb")} size="small" color="success" variant="outlined" /> : '-'}
                                    </TableCell>
                                    <TableCell sx={{
                minWidth: 190,
                maxWidth: 240,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                overflowWrap: 'anywhere'
              }}>
                                        {event.custom_data || '-'}
                                    </TableCell>
                                    <TableCell>
                                        <Chip label={event.status} size="small" color={event.status === 'sent' ? 'success' : event.status === 'failed' ? 'error' : 'default'} />
                                    </TableCell>
                                    <TableCell sx={{
                minWidth: 300,
                maxWidth: 360
              }}>
                                        <Typography variant="caption" color="text.secondary" sx={{
                  wordBreak: 'break-word'
                }}>
                                            {formatMetaResponse(event.meta_response, event.status)}
                                        </Typography>
                                    </TableCell>
                                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(event.created_at).toLocaleString(getCurrentLocale())}</TableCell>
                                </TableRow>)}
                            {events.length === 0 && <TableRow>
                                    <TableCell colSpan={7} align="center" sx={{
                py: 6,
                color: 'text.secondary'
              }}>{tx("auto.k_2d5d1f14c1bc")}

                </TableCell>
                                </TableRow>}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>

            <Dialog open={logOpen} onClose={() => setLogOpen(false)} maxWidth="sm" fullWidth slotProps={{ paper: { 'aria-label': tx("auto.k_933706b569ef") } }}>
                <DialogTitle>{tx("auto.k_933706b569ef")}</DialogTitle>
                <DialogContent>
                    <Grid container spacing={2} sx={{
          mt: 1
        }}>
                        <Grid size={{
            xs: 12
          }}>
                            <TextField fullWidth select label={tx("auto.k_92704b9ecc04")} value={form.event_name} onChange={e => setForm({
              ...form,
              event_name: e.target.value
            })}>
                                {getEventTypes().map(et => <MenuItem key={et.value} value={et.value}>{et.label}</MenuItem>)}
                            </TextField>
                        </Grid>
                        <Grid size={{
            xs: 12
          }}>
                            <TextField fullWidth label={eventsApiReady ? tx("auto.k_99272d7489ba") : tx("auto.k_cb8667d3507a")} value={form.phone} onChange={e => setForm({
              ...form,
              phone: e.target.value
            })} placeholder="218xxxxxxxxx" helperText={eventsApiReady ? tx("auto.k_760720d663c4") : ''} />
                        </Grid>
                        <Grid size={{
            xs: 12
          }}>
                            <TextField fullWidth label={tx("auto.k_28c7f9a15e4f")} value={form.ctwa_clid} onChange={e => setForm({
              ...form,
              ctwa_clid: e.target.value
            })} placeholder="Click-to-WhatsApp click id" helperText={tx("auto.k_45a4e3b81a2b")} />
                        </Grid>
                        <Grid size={{
            xs: 8
          }}>
                            <TextField fullWidth label={tx("auto.k_2ff85580bd5d")} value={form.value} type="number" onChange={e => setForm({
              ...form,
              value: e.target.value
            })} />
                        </Grid>
                        <Grid size={{
            xs: 4
          }}>
                            <TextField fullWidth select label={tx("auto.k_b9357d9161f2")} value={form.currency} onChange={e => setForm({
              ...form,
              currency: e.target.value
            })}>
                                <MenuItem value="LYD">LYD</MenuItem>
                                <MenuItem value="USD">USD</MenuItem>
                                <MenuItem value="EUR">EUR</MenuItem>
                            </TextField>
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setLogOpen(false)}>{tx("auto.k_e776b0209b50")}</Button>
                    <Button variant="contained" onClick={handleLog} disabled={logging || eventsApiReady && !form.phone.trim() && !form.ctwa_clid.trim()}>
                        {logging ? tx("auto.k_ad7cb41f8ed7") : tx("auto.k_52e5aeffdb85")}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError('')}>
                <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
            </Snackbar>
            <Snackbar open={!!success} autoHideDuration={3000} onClose={() => setSuccess('')}>
                <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>
            </Snackbar>
        </Box>;
};
export default TenantConversions;
