import React, { useEffect, useState } from 'react';
import { Box, Typography, Paper, Grid, TextField, Button, Card, CardContent, Chip, CircularProgress, Alert, Snackbar, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, FormControl, InputLabel, MenuItem } from '@mui/material';
import Select from '../../components/Form/AccessibleSelect';
import { Handshake as HandshakeIcon, Search as SearchIcon, Add as AddIcon, Delete as DeleteIcon, PersonAdd } from '@mui/icons-material';
import api from '../../api';
import { tx } from "../../i18n/tx";
import { PageTitle } from '../../components/Layout/PageTitle';
import { getCurrentLocale } from "../../utils/locale";
const PartnerSolutions = () => {
  const [businessId, setBusinessId] = useState('');
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [clients, setClients] = useState([]);
  const [permissionWarning, setPermissionWarning] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newClient, setNewClient] = useState({
    name: '',
    existing_client_business_id: ''
  });
  const [actionLoading, setActionLoading] = useState('');
  const [wabaDialog, setWabaDialog] = useState({
    open: false,
    client: null,
    accounts: []
  });
  const [systemUserDialog, setSystemUserDialog] = useState({
    open: false,
    client: null,
    name: '',
    role: 'ADMIN'
  });
  const [partnerEvidence, setPartnerEvidence] = useState(null);
  useEffect(() => {
    const loadTenants = async () => {
      try {
        const data = await api.getTenants();
        setTenants(data || []);
        const tenantWithBusiness = (data || []).find(t => t.business_id);
        if (tenantWithBusiness) {
          setSelectedTenant(String(tenantWithBusiness.id));
          setBusinessId(tenantWithBusiness.business_id);
        }
      } catch (err) {
        setError(err.message || tx("auto.k_98585c51b956"));
      }
    };
    loadTenants();
  }, []);
  useEffect(() => {
    if (!selectedTenant) {
      setPartnerEvidence(null);
      return undefined;
    }
    let mounted = true;
    api.getPartnerEvidence(selectedTenant).then(data => {
      if (mounted) setPartnerEvidence(data);
    }).catch(() => {
      if (mounted) setPartnerEvidence(null);
    });
    return () => {
      mounted = false;
    };
  }, [selectedTenant]);
  const handleTenantChange = event => {
    const tenantId = event.target.value;
    setSelectedTenant(tenantId);
    const tenant = tenants.find(t => String(t.id) === String(tenantId));
    setBusinessId(tenant?.business_id || '');
    setClients([]);
    setLoaded(false);
    setPermissionWarning('');
  };
  const refreshPartnerEvidence = async () => {
    if (!selectedTenant) return;
    try {
      const data = await api.getPartnerEvidence(selectedTenant);
      setPartnerEvidence(data);
    } catch {
      setPartnerEvidence(null);
    }
  };
  const loadClients = async () => {
    if (!businessId.trim()) return;
    try {
      setLoading(true);
      setError('');
      const data = await api.getPartnerClients(businessId, selectedTenant);
      setClients(data.clients || []);
      setPermissionWarning(data.permission_error || '');
      setLoaded(true);
    } catch (err) {
      setError(err.message || tx("auto.k_e540435f3737"));
    } finally {
      setLoading(false);
    }
  };
  const handleAdd = async () => {
    try {
      setAdding(true);
      const payload = {
        business_id: businessId,
        tenant_id: selectedTenant
      };
      if (newClient.existing_client_business_id) {
        payload.existing_client_business_id = newClient.existing_client_business_id;
      } else {
        payload.name = newClient.name;
      }
      await api.addPartnerClient(payload);
      setSuccess(tx("auto.k_4787210117d6"));
      setAddOpen(false);
      setNewClient({
        name: '',
        existing_client_business_id: ''
      });
      refreshPartnerEvidence();
      loadClients();
    } catch (err) {
      setError(err.message || tx("auto.k_72f6aa4a3a3b"));
    } finally {
      setAdding(false);
    }
  };
  const selectedTenantData = tenants.find(t => String(t.id) === String(selectedTenant));
  const businessScopes = (() => {
    try {
      return JSON.parse(selectedTenantData?.facebook_user_token_scopes || '[]');
    } catch {
      return [];
    }
  })();
  const readyForPartner = !!selectedTenant && businessScopes.includes('business_management');
  const handleRemoveClient = async client => {
    if (!window.confirm(tx("auto.k_896dbeb90617", {
      value1: client.name || client.id
    }))) return;
    try {
      setActionLoading(`remove:${client.id}`);
      await api.removePartnerClient(businessId, selectedTenant, client.id);
      setSuccess(tx("auto.k_afc38b7fd579"));
      refreshPartnerEvidence();
      loadClients();
    } catch (err) {
      setError(err.message || tx("auto.k_86000ba4950f"));
    } finally {
      setActionLoading('');
    }
  };
  const handleLoadWaba = async client => {
    try {
      setActionLoading(`waba:${client.id}`);
      const data = await api.getPartnerClientWaba(client.id, selectedTenant);
      setWabaDialog({
        open: true,
        client,
        accounts: data.whatsapp_accounts || []
      });
      refreshPartnerEvidence();
    } catch (err) {
      setError(err.message || tx("auto.k_b7e21ae91bc0"));
    } finally {
      setActionLoading('');
    }
  };
  const handleCreateSystemUser = async () => {
    const client = systemUserDialog.client;
    if (!client || !systemUserDialog.name.trim()) return;
    try {
      setActionLoading(`system-user:${client.id}`);
      await api.createPartnerSystemUser(client.id, {
        tenant_id: selectedTenant,
        name: systemUserDialog.name.trim(),
        role: systemUserDialog.role
      });
      setSuccess(tx("auto.k_c28c4a25ef1a"));
      setSystemUserDialog({
        open: false,
        client: null,
        name: '',
        role: 'ADMIN'
      });
      refreshPartnerEvidence();
    } catch (err) {
      setError(err.message || tx("auto.k_756237cb50ec"));
    } finally {
      setActionLoading('');
    }
  };
  return <Box sx={{
    p: {
      xs: 1.5,
      md: 3
    }
  }}>
            <Box sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      mb: 3
    }}>
                <HandshakeIcon sx={{
        fontSize: 32,
        color: 'primary.main'
      }} />
                <Box>
                    <PageTitle variant="h5" fontWeight={700}>{tx("auto.k_2cbbfa7bdd03")}</PageTitle>
                    <Typography variant="body2" color="text.secondary">{tx("auto.k_0b3bde6bfcf8")}</Typography>
                </Box>
            </Box>

            <Paper sx={{
      p: 3,
      mb: 3
    }}>
                <Box sx={{
        display: 'flex',
        gap: 2,
        flexDirection: {
          xs: 'column',
          md: 'row'
        }
      }}>
                    <FormControl fullWidth size="small">
                        <InputLabel>{tx("auto.k_8adba91e1d87")}</InputLabel>
                        <Select value={selectedTenant} label={tx("auto.k_8adba91e1d87")} onChange={handleTenantChange}>
                            {tenants.map(tenant => <MenuItem key={tenant.id} value={String(tenant.id)}>
                                    {tenant.name} {tenant.business_id ? '' : tx("auto.k_f8e8bec6356e")}
                                </MenuItem>)}
                        </Select>
                    </FormControl>
                    <TextField fullWidth label={tx("auto.k_0aebe4b62833")} value={businessId} onChange={e => setBusinessId(e.target.value)} size="small" />
                    <Button variant="contained" startIcon={loading ? <CircularProgress size={18} /> : <SearchIcon />} onClick={loadClients} disabled={loading || !businessId.trim() || !selectedTenant} sx={{
          minWidth: 120
        }}>{tx("auto.k_ba3add142098")}</Button>
                </Box>
                <Alert severity={readyForPartner ? 'success' : 'warning'} sx={{
        mt: 2
      }}>
                    {readyForPartner ? tx("auto.k_a98b0065f64a") : tx("auto.k_48d54981287c")}
                </Alert>
                {partnerEvidence && <Paper variant="outlined" sx={{
        mt: 2,
        p: 2
      }}>
                        <Typography variant="subtitle2" fontWeight={700} sx={{
          mb: 1
        }}>{tx("auto.k_58e4a3b46838")}

          </Typography>
                        <Grid container spacing={1.5}>
                            <Grid size={{
            xs: 6,
            md: 3
          }}>
                                <Chip label={partnerEvidence.readiness?.business_id_present ? tx("auto.k_45998ee8c523") : tx("auto.k_97a943e5eabd")} color={partnerEvidence.readiness?.business_id_present ? 'success' : 'warning'} size="small" variant="outlined" />

                            </Grid>
                            <Grid size={{
            xs: 6,
            md: 3
          }}>
                                <Chip label={partnerEvidence.readiness?.facebook_user_token_present ? tx("auto.k_43a2bf793c83") : tx("auto.k_7cd800bb1276")} color={partnerEvidence.readiness?.facebook_user_token_present ? 'success' : 'warning'} size="small" variant="outlined" />

                            </Grid>
                            <Grid size={{
            xs: 6,
            md: 3
          }}>
                                <Chip label={partnerEvidence.readiness?.business_management_granted ? tx("auto.k_91b30ddbe23c") : tx("auto.k_c00e7293d20e")} color={partnerEvidence.readiness?.business_management_granted ? 'success' : 'warning'} size="small" variant="outlined" />

                            </Grid>
                            <Grid size={{
            xs: 6,
            md: 3
          }}>
                                <Chip label={`Token: ${partnerEvidence.readiness?.facebook_user_token_status || 'unchecked'}`} color={partnerEvidence.readiness?.facebook_user_token_status === 'valid' ? 'success' : 'warning'} size="small" variant="outlined" />

                            </Grid>
                        </Grid>
                        <Typography variant="caption" color="text.secondary" component="div" sx={{
          mt: 1
        }}>{tx("auto.k_b206645d4ddc")}
            {partnerEvidence.latest_success?.created_at ? new Date(partnerEvidence.latest_success.created_at).toLocaleString(getCurrentLocale()) : tx("auto.k_87e8e1d53a84")}
                            {partnerEvidence.latest_success?.description ? ` | ${partnerEvidence.latest_success.description}` : ''}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" component="div">{tx("auto.k_b0924b2f23fd")}
            {partnerEvidence.latest_failure?.created_at ? new Date(partnerEvidence.latest_failure.created_at).toLocaleString(getCurrentLocale()) : tx("auto.k_87e8e1d53a84")}
                            {partnerEvidence.latest_failure?.description ? ` | ${partnerEvidence.latest_failure.description}` : ''}
                        </Typography>
                    </Paper>}
            </Paper>

            {loaded && <>
                    {permissionWarning && <Alert severity="warning" sx={{
        mb: 2
      }}>{permissionWarning}</Alert>}

                    <Box sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        mb: 2
      }}>
                        <Typography variant="h6" fontWeight={600}>{tx("auto.k_ecad32067735")}{clients.length})</Typography>
                        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)} size="small">{tx("auto.k_52a61a0d0d74")}</Button>
                    </Box>

                    <Paper>
                        <TableContainer sx={{
          overflowX: 'auto'
        }}>
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>{tx("auto.k_0a92494ea1eb")}</TableCell>
                                        <TableCell>{tx("auto.k_d72110a8e9fa")}</TableCell>
                                        <TableCell>{tx("auto.k_b28809ddb86c")}</TableCell>
                                        <TableCell>{tx("auto.k_070d26e18efd")}</TableCell>
                                        <TableCell align="right">{tx("auto.k_8edfb81a349f")}</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {clients.map((client, i) => <TableRow key={i}>
                                            <TableCell>
                                                <Typography fontWeight={600}>{client.name || '-'}</Typography>
                                            </TableCell>
                                            <TableCell><Chip label={client.id} size="small" variant="outlined" /></TableCell>
                                            <TableCell>
                                                <Chip label={client.verification_status || tx("auto.k_3a5ee7e1aa21")} size="small" color={client.verification_status === 'verified' ? 'success' : 'warning'} />
                                            </TableCell>
                                            <TableCell>{client.created_time ? new Date(client.created_time).toLocaleDateString(getCurrentLocale()) : '-'}</TableCell>
                                            <TableCell align="right">
                                                <Button size="small" onClick={() => handleLoadWaba(client)} disabled={actionLoading === `waba:${client.id}`}>
                                                    WABA
                                                </Button>
                                                <Button size="small" startIcon={<PersonAdd />} onClick={() => setSystemUserDialog({
                    open: true,
                    client,
                    name: '',
                    role: 'ADMIN'
                  })}>
                                                    System user
                                                </Button>
                                                <IconButton size="small" color="error" aria-label={tx("auto.k_2d2bbdc2d694")} onClick={() => handleRemoveClient(client)} disabled={actionLoading === `remove:${client.id}`}>
                                                    {actionLoading === `remove:${client.id}` ? <CircularProgress size={16} /> : <DeleteIcon fontSize="small" />}
                                                </IconButton>
                                            </TableCell>
                                        </TableRow>)}
                                    {clients.length === 0 && <TableRow>
                                            <TableCell colSpan={5} align="center" sx={{
                  py: 6,
                  color: 'text.secondary'
                }}>{tx("auto.k_1bcfc91e3ee2")}

                  </TableCell>
                                        </TableRow>}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </Paper>
                </>}

            <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth slotProps={{ paper: { 'aria-label': tx("auto.k_52a61a0d0d74") } }}>
                <DialogTitle>{tx("auto.k_52a61a0d0d74")}</DialogTitle>
                <DialogContent>
                    <Alert severity="info" sx={{
          mb: 2,
          mt: 1
        }}>{tx("auto.k_8ec5f72584fc")}

          </Alert>
                    <TextField fullWidth label={tx("auto.k_da499e55b5d4")} value={newClient.existing_client_business_id} onChange={e => setNewClient({
          ...newClient,
          existing_client_business_id: e.target.value
        })} sx={{
          mb: 2
        }} helperText={tx("auto.k_bd748c65477d")} />
                    <Typography variant="body2" sx={{
          textAlign: 'center',
          my: 1,
          color: 'text.secondary'
        }}>{tx("auto.k_4249de3e6d3c")}</Typography>
                    <TextField fullWidth label={tx("auto.k_bd74015c2b39")} value={newClient.name} onChange={e => setNewClient({
          ...newClient,
          name: e.target.value
        })} disabled={!!newClient.existing_client_business_id} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAddOpen(false)}>{tx("auto.k_e776b0209b50")}</Button>
                    <Button variant="contained" onClick={handleAdd} disabled={adding || !newClient.name && !newClient.existing_client_business_id}>
                        {adding ? tx("auto.k_0ca4319bb9bb") : tx("auto.k_5e3a3fdfce20")}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={wabaDialog.open} onClose={() => setWabaDialog({
      open: false,
      client: null,
      accounts: []
    })} maxWidth="sm" fullWidth slotProps={{ paper: { 'aria-label': tx("auto.k_fda4a89312d1") } }}>
                <DialogTitle>{tx("auto.k_fda4a89312d1")}</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="subtitle2" sx={{
          mb: 2
        }}>
                        {wabaDialog.client?.name || wabaDialog.client?.id}
                    </Typography>
                    {wabaDialog.accounts.length === 0 ? <Alert severity="info">{tx("auto.k_6e22b286bbb2")}</Alert> : wabaDialog.accounts.map(account => <Paper key={account.id} variant="outlined" sx={{
          p: 1.5,
          mb: 1
        }}>
                                <Typography fontWeight={600}>{account.name || 'WABA'}</Typography>
                                <Typography variant="body2" color="text.secondary">ID: {account.id} • {account.currency || '-'}</Typography>
                            </Paper>)}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setWabaDialog({
          open: false,
          client: null,
          accounts: []
        })}>{tx("auto.k_5bf826c5e57c")}</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={systemUserDialog.open} onClose={() => setSystemUserDialog({
      open: false,
      client: null,
      name: '',
      role: 'ADMIN'
    })} maxWidth="sm" fullWidth slotProps={{ paper: { 'aria-label': tx("auto.k_86e911e6b44e") } }}>
                <DialogTitle>{tx("auto.k_86e911e6b44e")}</DialogTitle>
                <DialogContent>
                    <Alert severity="info" sx={{
          mb: 2,
          mt: 1
        }}>{tx("auto.k_50d4bd8310a9")}

          </Alert>
                    <TextField fullWidth label={tx("auto.k_b5bfed072096")} value={systemUserDialog.name} onChange={e => setSystemUserDialog(prev => ({
          ...prev,
          name: e.target.value
        }))} sx={{
          mb: 2
        }} />

                    <FormControl fullWidth>
                        <InputLabel>{tx("auto.k_c46562fdc5e5")}</InputLabel>
                        <Select value={systemUserDialog.role} label={tx("auto.k_c46562fdc5e5")} onChange={e => setSystemUserDialog(prev => ({
            ...prev,
            role: e.target.value
          }))}>

                            <MenuItem value="ADMIN">ADMIN</MenuItem>
                            <MenuItem value="EMPLOYEE">EMPLOYEE</MenuItem>
                        </Select>
                    </FormControl>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setSystemUserDialog({
          open: false,
          client: null,
          name: '',
          role: 'ADMIN'
        })}>{tx("auto.k_e776b0209b50")}</Button>
                    <Button variant="contained" onClick={handleCreateSystemUser} disabled={actionLoading.startsWith('system-user') || !systemUserDialog.name.trim()}>
                        {actionLoading.startsWith('system-user') ? tx("auto.k_b9480022049d") : tx("auto.k_8a1d0b74e145")}
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
export default PartnerSolutions;
