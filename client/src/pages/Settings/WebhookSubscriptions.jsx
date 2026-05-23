import React, { useEffect, useMemo, useState } from 'react';
import { Box, Card, CardContent, Typography, Button, Grid, Chip, Alert, CircularProgress, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { Webhook as WebhookIcon, Refresh as RefreshIcon, PlayArrow as SubscribeIcon, CheckCircle as CheckCircleIcon, Cancel as CancelIcon } from '@mui/icons-material';
import api from '../../api';
import { tx } from "../../i18n/tx";
import { getCurrentLocale } from "../../utils/locale";
const getFieldLabel = () => ({
  messages: tx("auto.k_1a1814493410"),
  message_template_status_update: tx("auto.k_79897bf776d8"),
  account_alerts: tx("auto.k_39451f882e4a")
});
const WebhookSubscriptions = () => {
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [diagnostic, setDiagnostic] = useState(null);
  const [loading, setLoading] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const selectedTenantData = useMemo(() => tenants.find(t => String(t.id) === String(selectedTenant)), [tenants, selectedTenant]);
  const fetchTenants = async () => {
    try {
      const data = await api.getTenants();
      setTenants(data);
      const tenantWithWaba = data.find(t => t.waba_id);
      if (tenantWithWaba) setSelectedTenant(String(tenantWithWaba.id));
    } catch {
      setError(tx("auto.k_98585c51b956"));
    }
  };
  const fetchSubscriptions = async () => {
    if (!selectedTenant) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.getWebhookSubscriptions(selectedTenant);
      setDiagnostic(data);
    } catch (err) {
      setError(err.message || tx("auto.k_f1e3a6d62665"));
      setDiagnostic(null);
    } finally {
      setLoading(false);
    }
  };
  const handleSubscribe = async () => {
    if (!selectedTenant) return;
    setSubscribing(true);
    setError('');
    setSuccess('');
    try {
      await api.subscribeWebhook(selectedTenant);
      setSuccess(tx("auto.k_6d0f2642d078"));
      await fetchSubscriptions();
    } catch (err) {
      setError(err.message || tx("auto.k_e0964a88726d"));
    } finally {
      setSubscribing(false);
    }
  };
  useEffect(() => {
    fetchTenants();
  }, []);
  useEffect(() => {
    if (selectedTenant) fetchSubscriptions();
  }, [selectedTenant]);
  const requiredFields = diagnostic?.required_fields || ['messages', 'message_template_status_update', 'account_alerts'];
  const subscribedFields = diagnostic?.subscribed_fields || [];
  const missingFields = diagnostic?.missing_fields || [];
  const evidence = diagnostic?.evidence?.by_field || {};
  return <Box sx={{
    p: {
      xs: 1.5,
      md: 3
    },
    maxWidth: 1100,
    mx: 'auto'
  }}>
            <Box sx={{
      mb: 3
    }}>
                <Typography variant="h4" fontWeight={700} gutterBottom>{tx("auto.k_f08615f44c97")}

        </Typography>
                <Typography variant="body2" color="text.secondary">{tx("auto.k_5478353331ea")}

        </Typography>
            </Box>

            {error && <Alert severity="error" sx={{
      mb: 2
    }} onClose={() => setError('')}>{error}</Alert>}
            {success && <Alert severity="success" sx={{
      mb: 2
    }} onClose={() => setSuccess('')}>{success}</Alert>}

            <Card sx={{
      mb: 3
    }}>
                <CardContent>
                    <Grid container spacing={2} alignItems="center">
                        <Grid size={{
            xs: 12,
            md: 5
          }}>
                            <FormControl fullWidth size="small">
                                <InputLabel>{tx("auto.k_8adba91e1d87")}</InputLabel>
                                <Select value={selectedTenant} onChange={e => setSelectedTenant(e.target.value)} label={tx("auto.k_8adba91e1d87")}>
                                    {tenants.map(t => <MenuItem key={t.id} value={String(t.id)}>
                                            {t.name} {t.waba_id ? `(${t.waba_id})` : tx("auto.k_6934702c12b3")}
                                        </MenuItem>)}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid size={{
            xs: 12,
            md: 3.5
          }}>
                            <Button variant="contained" onClick={handleSubscribe} disabled={subscribing || !selectedTenantData?.waba_id} startIcon={subscribing ? <CircularProgress size={18} color="inherit" /> : <SubscribeIcon />} fullWidth>{tx("auto.k_4e5b545e930e")}


              </Button>
                        </Grid>
                        <Grid size={{
            xs: 12,
            md: 3.5
          }}>
                            <Button variant="outlined" onClick={fetchSubscriptions} disabled={loading || !selectedTenant} startIcon={loading ? <CircularProgress size={18} /> : <RefreshIcon />} fullWidth>{tx("auto.k_e97c2829cf49")}


              </Button>
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>

            {selectedTenantData && <Grid container spacing={3}>
                    <Grid size={{
        xs: 12,
        md: 5
      }}>
                        <Card sx={{
          height: '100%'
        }}>
                            <CardContent>
                                <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              mb: 2
            }}>
                                    <WebhookIcon color="primary" />
                                    <Typography variant="h6">{tx("auto.k_7bf84a779bb5")}</Typography>
                                </Box>
                                <Grid container spacing={1.5}>
                                    <Grid size={{
                xs: 6
              }}>
                                        <Typography variant="caption" color="text.secondary">WABA ID</Typography>
                                        <Typography variant="body2" fontFamily="monospace">{diagnostic?.waba_id || selectedTenantData.waba_id || '-'}</Typography>
                                    </Grid>
                                    <Grid size={{
                xs: 6
              }}>
                                        <Typography variant="caption" color="text.secondary">Phone Number ID</Typography>
                                        <Typography variant="body2" fontFamily="monospace">{diagnostic?.phone_number_id || selectedTenantData.phone_number_id || '-'}</Typography>
                                    </Grid>
                                    <Grid size={{
                xs: 6
              }}>
                                        <Typography variant="caption" color="text.secondary">Token</Typography>
                                        <Typography variant="body2">{diagnostic?.token_status || selectedTenantData.token_status || 'unchecked'}</Typography>
                                    </Grid>
                                    <Grid size={{
                xs: 6
              }}>
                                        <Typography variant="caption" color="text.secondary">Meta subscriptions</Typography>
                                        <Typography variant="body2">{diagnostic?.subscriptions?.length || 0}</Typography>
                                    </Grid>
                                </Grid>
                                {missingFields.length > 0 && <Alert severity="warning" sx={{
              mt: 2
            }}>{tx("auto.k_957be022ea6e")}
                {missingFields.join(', ')}
                                    </Alert>}
                            </CardContent>
                        </Card>
                    </Grid>

                    <Grid size={{
        xs: 12,
        md: 7
      }}>
                        <Card sx={{
          height: '100%'
        }}>
                            <CardContent>
                                <Typography variant="h6" gutterBottom>{tx("auto.k_f8dd300b0e1f")}</Typography>
                                <Grid container spacing={1.5}>
                                    {requiredFields.map(field => {
                const fieldEvidence = evidence[field];
                const subscribed = subscribedFields.includes(field) || diagnostic?.subscriptions?.length > 0;
                return <Grid size={{
                  xs: 12,
                  sm: 6
                }} key={field}>
                                                <Paper variant="outlined" sx={{
                    p: 1.5,
                    height: '100%'
                  }}>
                                                    <Box sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 1,
                      mb: 1
                    }}>
                                                        <Typography variant="subtitle2">{getFieldLabel()[field] || field}</Typography>
                                                        <Chip size="small" icon={subscribed ? <CheckCircleIcon /> : <CancelIcon />} label={subscribed ? tx("auto.k_6e73793ec3cc") : tx("auto.k_47f45479ef7d")} color={subscribed ? 'success' : 'warning'} variant="outlined" />

                                                    </Box>
                                                    <Typography variant="caption" color="text.secondary" display="block">{tx("auto.k_be0b4a2db413")}</Typography>
                                                    <Typography variant="body2" fontWeight={600}>
                                                        {fieldEvidence?.latest_at ? new Date(fieldEvidence.latest_at).toLocaleString(getCurrentLocale()) : tx("auto.k_62cbcc20935d")}
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary">{tx("auto.k_779caa96b734")}
                          {fieldEvidence?.count || 0}
                                                    </Typography>
                                                </Paper>
                                            </Grid>;
              })}
                                </Grid>
                            </CardContent>
                        </Card>
                    </Grid>

                    <Grid size={{
        xs: 12
      }}>
                        <Card>
                            <CardContent>
                                <Typography variant="h6" gutterBottom>{tx("auto.k_6f407577b873")}</Typography>
                                {loading ? <Box sx={{
              display: 'flex',
              justifyContent: 'center',
              py: 4
            }}><CircularProgress /></Box> : <TableContainer component={Paper} variant="outlined" sx={{
              overflowX: 'auto'
            }}>
                                        <Table size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell>{tx("auto.k_2fa035aee896")}</TableCell>
                                                    <TableCell>{tx("auto.k_11683ccddac9")}</TableCell>
                                                    <TableCell align="center">{tx("auto.k_d6370401145d")}</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {(diagnostic?.subscriptions || []).map((sub, index) => <TableRow key={sub.id || index}>
                                                        <TableCell>{sub.name || sub.id || `Subscription ${index + 1}`}</TableCell>
                                                        <TableCell>
                                                            <Box sx={{
                        display: 'flex',
                        gap: 0.5,
                        flexWrap: 'wrap'
                      }}>
                                                                {(sub.subscribed_fields || sub.fields?.map(field => field.name) || ['messages']).map(field => <Chip key={field} label={field} size="small" variant="outlined" />)}
                                                            </Box>
                                                        </TableCell>
                                                        <TableCell align="center"><CheckCircleIcon color="success" fontSize="small" /></TableCell>
                                                    </TableRow>)}
                                                {(!diagnostic?.subscriptions || diagnostic.subscriptions.length === 0) && <TableRow>
                                                        <TableCell colSpan={3} align="center" sx={{
                      py: 4
                    }}>{tx("auto.k_75ad10f026b7")}

                      </TableCell>
                                                    </TableRow>}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>}
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>}
        </Box>;
};
export default WebhookSubscriptions;
