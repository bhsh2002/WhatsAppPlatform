import React, { useEffect, useState } from 'react';
import { Box, Typography, Paper, Grid, TextField, Button, Card, CardContent, Chip, CircularProgress, Alert, Snackbar, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Divider, Avatar, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { Business as BusinessIcon, Search as SearchIcon, AccountBalance, Store } from '@mui/icons-material';
import api from '../../api';
import { tx } from "../../i18n/tx";
const BusinessManager = () => {
  const [businessId, setBusinessId] = useState('');
  const [info, setInfo] = useState(null);
  const [adAccounts, setAdAccounts] = useState([]);
  const [assets, setAssets] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [permissionWarnings, setPermissionWarnings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState('info');
  const [claimAdAccountId, setClaimAdAccountId] = useState('');
  const [claimLoading, setClaimLoading] = useState(false);
  const [savingBusinessId, setSavingBusinessId] = useState(false);
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
  const handleTenantChange = event => {
    const tenantId = event.target.value;
    setSelectedTenant(tenantId);
    const tenant = tenants.find(t => String(t.id) === String(tenantId));
    setBusinessId(tenant?.business_id || '');
    setInfo(null);
    setAdAccounts([]);
    setAssets(null);
    setPermissionWarnings([]);
  };
  const selectedTenantData = tenants.find(t => String(t.id) === String(selectedTenant));
  const businessScopes = (() => {
    try {
      return JSON.parse(selectedTenantData?.facebook_user_token_scopes || '[]');
    } catch {
      return [];
    }
  })();
  const hasBusinessToken = !!selectedTenantData?.facebook_user_access_token_encrypted || selectedTenantData?.facebook_user_token_status === 'valid' || businessScopes.length > 0;
  const hasBusinessManagement = businessScopes.includes('business_management');
  const businessIdSaved = !!selectedTenantData?.business_id && String(selectedTenantData.business_id) === String(businessId).trim();
  const handleSearch = async () => {
    if (!businessId.trim() || !selectedTenant) return;
    try {
      setLoading(true);
      setError('');
      const [infoData, adData, assetsData] = await Promise.all([api.getBusinessManagerInfo(businessId, selectedTenant).catch(err => ({
        permission_error: err.message,
        id: businessId
      })), api.getAdAccounts(businessId, selectedTenant).catch(err => ({
        ad_accounts: [],
        permission_error: err.message
      })), api.getBusinessAssets(businessId, selectedTenant).catch(err => ({
        pages: [],
        whatsapp_accounts: [],
        permission_errors: {
          pages: err.message,
          whatsapp_accounts: null
        }
      }))]);
      setInfo(infoData);
      setAdAccounts(adData?.ad_accounts || []);
      setAssets(assetsData);
      setPermissionWarnings([infoData?.permission_error, adData?.permission_error, assetsData?.permission_errors?.pages, assetsData?.permission_errors?.whatsapp_accounts].filter(Boolean));
    } catch (err) {
      setError(err.message || tx("auto.k_4a42e035daf2"));
    } finally {
      setLoading(false);
    }
  };
  const handleSaveBusinessId = async () => {
    if (!selectedTenant || !businessId.trim()) return;
    try {
      setSavingBusinessId(true);
      setError('');
      const result = await api.updateTenantMetaSettings(selectedTenant, {
        business_id: businessId.trim()
      });
      setTenants(prev => prev.map(tenant => String(tenant.id) === String(selectedTenant) ? {
        ...tenant,
        business_id: result.tenant?.business_id || businessId.trim()
      } : tenant));
      setSuccess(tx("auto.k_67323b831ff4"));
      await handleSearch();
    } catch (err) {
      setError(err.message || tx("auto.k_fd1194082ebe"));
    } finally {
      setSavingBusinessId(false);
    }
  };
  const handleClaimAdAccount = async () => {
    if (!businessId || !selectedTenant || !claimAdAccountId.trim()) return;
    try {
      setClaimLoading(true);
      setError('');
      await api.claimAdAccount(businessId, selectedTenant, claimAdAccountId.trim());
      setSuccess(tx("auto.k_1211840dab30"));
      setClaimAdAccountId('');
      handleSearch();
    } catch (err) {
      setError(err.message || tx("auto.k_ccb841e3ec71"));
    } finally {
      setClaimLoading(false);
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
                <BusinessIcon sx={{
        fontSize: 32,
        color: 'primary.main'
      }} />
                <Box>
                    <Typography variant="h5" fontWeight={700}>{tx("auto.k_564bfedbff1b")}</Typography>
                    <Typography variant="body2" color="text.secondary">{tx("auto.k_d5042a53f126")}</Typography>
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
                    <TextField fullWidth label={tx("auto.k_8dfcf16b8399")} value={businessId} onChange={e => setBusinessId(e.target.value)} placeholder={tx("auto.k_5d2d5f2a3ad0")} size="small" />
                    <Button variant="outlined" onClick={handleSaveBusinessId} disabled={savingBusinessId || !businessId.trim() || !selectedTenant || businessIdSaved} sx={{
          minWidth: 150
        }}>

                        {savingBusinessId ? <CircularProgress size={18} /> : tx("auto.k_35f5c17f2ebc")}
                    </Button>
                    <Button variant="contained" startIcon={loading ? <CircularProgress size={18} /> : <SearchIcon />} onClick={handleSearch} disabled={loading || !businessId.trim() || !selectedTenant} sx={{
          minWidth: 120
        }}>{tx("auto.k_ba3add142098")}

          </Button>
                </Box>
                {!businessIdSaved && businessId.trim() && selectedTenant && <Alert severity="info" sx={{
        mt: 2
      }}>{tx("auto.k_96e2fe94aa0d")}

        </Alert>}
                <Alert severity={hasBusinessToken && hasBusinessManagement ? 'success' : 'warning'} sx={{
        mt: 2
      }}>
                    {hasBusinessToken && hasBusinessManagement ? tx("auto.k_fc56d4ff87ac") : tx("auto.k_7ae84dd14f00")}
                </Alert>
            </Paper>

            {info && <>
                    {permissionWarnings.length > 0 && <Alert severity="warning" sx={{
        mb: 2
      }}>
                            {permissionWarnings.map((msg, index) => <Typography key={index} variant="body2">{msg}</Typography>)}
                        </Alert>}

                    <Box sx={{
        display: 'flex',
        gap: 1,
        mb: 3
      }}>
                        {['info', 'ads', 'assets'].map(tab => <Button key={tab} variant={activeTab === tab ? 'contained' : 'outlined'} size="small" onClick={() => setActiveTab(tab)}>
                                {tab === 'info' ? tx("auto.k_47f3cc6c8d5a") : tab === 'ads' ? tx("auto.k_938e9045842d") : tx("auto.k_e6d9c293a7ce")}
                            </Button>)}
                    </Box>

                    {activeTab === 'info' && <Card>
                            <CardContent>
                                <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            mb: 3
          }}>
                                    <Avatar sx={{
              bgcolor: 'primary.main',
              width: 56,
              height: 56
            }}><BusinessIcon /></Avatar>
                                    <Box>
                                        <Typography variant="h6" fontWeight={700}>{info.name || tx("auto.k_e0578dbdc1e1")}</Typography>
                                        <Typography variant="body2" color="text.secondary">ID: {info.id}</Typography>
                                    </Box>
                                    <Chip label={info.verification_status || tx("auto.k_3a5ee7e1aa21")} color={info.verification_status === 'verified' ? 'success' : 'warning'} sx={{
              ml: 'auto'
            }} />
                                </Box>
                                <Divider sx={{
            mb: 2
          }} />
                                <Grid container spacing={2}>
                                    <Grid size={{
              xs: 6
            }}><Typography variant="body2" color="text.secondary">{tx("auto.k_070d26e18efd")}</Typography><Typography>{info.created_time || '-'}</Typography></Grid>
                                    <Grid size={{
              xs: 6
            }}><Typography variant="body2" color="text.secondary">{tx("auto.k_fb2f81379630")}</Typography><Typography>{info.timezone_id || '-'}</Typography></Grid>
                                    <Grid size={{
              xs: 6
            }}><Typography variant="body2" color="text.secondary">{tx("auto.k_ca1e582768c3")}</Typography><Typography>{info.two_factor_type || '-'}</Typography></Grid>
                                </Grid>
                            </CardContent>
                        </Card>}

                    {activeTab === 'ads' && <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2
      }}>
                            <Paper sx={{
          p: 2
        }}>
                                <Typography variant="subtitle2" sx={{
            mb: 1
          }}>{tx("auto.k_7171f8c06188")}</Typography>
                                <Box sx={{
            display: 'flex',
            gap: 1,
            flexDirection: {
              xs: 'column',
              md: 'row'
            }
          }}>
                                    <TextField fullWidth size="small" label="Ad Account ID" value={claimAdAccountId} onChange={e => setClaimAdAccountId(e.target.value)} placeholder={tx("auto.k_b307f6512d16")} />
                                    <Button variant="outlined" onClick={handleClaimAdAccount} disabled={claimLoading || !claimAdAccountId.trim() || !selectedTenant}>
                                        {claimLoading ? <CircularProgress size={18} /> : tx("auto.k_a8fc51825f8c")}
                                    </Button>
                                </Box>
                            </Paper>
                            <Paper>
                                <TableContainer sx={{
            overflowX: 'auto'
          }}>
                                    <Table>
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>{tx("auto.k_0a92494ea1eb")}</TableCell>
                                                <TableCell>{tx("auto.k_d72110a8e9fa")}</TableCell>
                                                <TableCell>{tx("auto.k_d6370401145d")}</TableCell>
                                                <TableCell>{tx("auto.k_b9357d9161f2")}</TableCell>
                                                <TableCell>{tx("auto.k_6890e63e08bd")}</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {adAccounts.map((acc, i) => <TableRow key={i}>
                                                    <TableCell>{acc.name || '-'}</TableCell>
                                                    <TableCell><Chip label={acc.account_id} size="small" /></TableCell>
                                                    <TableCell><Chip label={acc.account_status === 1 ? tx("auto.k_41b054617ef6") : tx("auto.k_cbc187374175")} size="small" color={acc.account_status === 1 ? 'success' : 'default'} /></TableCell>
                                                    <TableCell>{acc.currency || '-'}</TableCell>
                                                    <TableCell>{acc.amount_spent ? (parseInt(acc.amount_spent, 10) / 100).toFixed(2) : '0'}</TableCell>
                                                </TableRow>)}
                                            {adAccounts.length === 0 && <TableRow><TableCell colSpan={5} align="center" sx={{
                    py: 4
                  }}>{tx("auto.k_fe34abdc7e3f")}</TableCell></TableRow>}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            </Paper>
                        </Box>}

                    {activeTab === 'assets' && assets && <Grid container spacing={3}>
                            <Grid size={{
          xs: 12,
          md: 6
        }}>
                                <Paper sx={{
            p: 3
          }}>
                                    <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              mb: 2
            }}>
                                        <Store />
                                        <Typography variant="h6" fontWeight={600}>{tx("auto.k_6d6e6d668957")}{assets.pages?.length || 0})</Typography>
                                    </Box>
                                    {(assets.pages || []).map((page, i) => <Box key={i} sx={{
              py: 1.5,
              borderBottom: '1px solid rgba(0,0,0,0.06)'
            }}>
                                            <Typography fontWeight={600}>{page.name}</Typography>
                                            <Typography variant="body2" color="text.secondary">{page.category} • ID: {page.id}</Typography>
                                        </Box>)}
                                    {(!assets.pages || assets.pages.length === 0) && <Typography color="text.secondary">{tx("auto.k_f69a436f7e9c")}</Typography>}
                                </Paper>
                            </Grid>
                            <Grid size={{
          xs: 12,
          md: 6
        }}>
                                <Paper sx={{
            p: 3
          }}>
                                    <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              mb: 2
            }}>
                                        <AccountBalance />
                                        <Typography variant="h6" fontWeight={600}>{tx("auto.k_d2d723a32f14")}{assets.whatsapp_accounts?.length || 0})</Typography>
                                    </Box>
                                    {(assets.whatsapp_accounts || []).map((wa, i) => <Box key={i} sx={{
              py: 1.5,
              borderBottom: '1px solid rgba(0,0,0,0.06)'
            }}>
                                            <Typography fontWeight={600}>{wa.name}</Typography>
                                            <Typography variant="body2" color="text.secondary">ID: {wa.id} • {wa.currency}</Typography>
                                        </Box>)}
                                    {(!assets.whatsapp_accounts || assets.whatsapp_accounts.length === 0) && <Typography color="text.secondary">{tx("auto.k_8c950f4b9b8c")}</Typography>}
                                </Paper>
                            </Grid>
                        </Grid>}
                </>}

            <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError('')}>
                <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
            </Snackbar>
            <Snackbar open={!!success} autoHideDuration={3500} onClose={() => setSuccess('')}>
                <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>
            </Snackbar>
        </Box>;
};
export default BusinessManager;
