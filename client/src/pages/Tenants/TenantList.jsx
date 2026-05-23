import React, { useState } from 'react';
import { useTenants } from '../../context/TenantContext';
import api from '../../api';
import { Box, Paper, Typography, Button, TextField, InputAdornment, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, IconButton, Menu, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, Grid, FormControl, InputLabel, Select, CircularProgress, Alert, ListItemIcon, Divider } from '@mui/material';
import { Search as SearchIcon, Add as AddIcon, MoreVert as MoreVertIcon, Edit as EditIcon, Delete as DeleteIcon, WhatsApp as WhatsAppIcon, PersonAdd as PersonAddIcon, Key as KeyIcon, CheckCircle as CheckCircleIcon, AccountBalanceWallet as CreditsIcon, Facebook as FacebookIcon, Link as LinkIcon, Cancel as CancelIcon, Refresh as RefreshIcon, VerifiedUser as VerifiedUserIcon, WarningAmber as WarningAmberIcon, Cancel as CancelIconR, RemoveCircleOutline as UncheckedIcon } from '@mui/icons-material';
import { tx } from "../../i18n/tx";
import { getCurrentLocale } from "../../utils/locale";
const TenantList = () => {
  const {
    tenants,
    loading,
    error,
    createTenant,
    updateTenant,
    deleteTenant
  } = useTenants();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingTenant, setEditingTenant] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    tier: '1K',
    credits: 0,
    status: 'Active',
    quality: 'High',
    phone_number_id: '',
    access_token: '',
    waba_id: ''
  });
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedTenantId, setSelectedTenantId] = useState(null);
  const [saving, setSaving] = useState(false);

  // Account creation state
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [accountFormData, setAccountFormData] = useState({
    username: '',
    password: '',
    email: ''
  });
  const [accountInfo, setAccountInfo] = useState(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState(null);

  // Credits top-up state
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [creditsAmount, setCreditsAmount] = useState(100);
  const [creditsLoading, setCreditsLoading] = useState(false);

  // Facebook Pages state
  const [showFbPagesModal, setShowFbPagesModal] = useState(false);
  const [fbPages, setFbPages] = useState([]);
  const [fbPagesLoading, setFbPagesLoading] = useState(false);
  const [fbPagesError, setFbPagesError] = useState(null);
  const [fbLinkMode, setFbLinkMode] = useState(false);
  const [fbLinking, setFbLinking] = useState(false);
  const [fbLinkForm, setFbLinkForm] = useState({
    page_id: '',
    page_access_token: ''
  });
  const [fbLinkId, setFbLinkId] = useState(null);
  const [checkingToken, setCheckingToken] = useState(false);
  const filteredTenants = tenants.filter(tenant => {
    const matchesSearch = tenant.name.toLowerCase().includes(searchQuery.toLowerCase()) || tenant.phone?.includes(searchQuery) || tenant.id.toString().includes(searchQuery);
    const matchesStatus = !statusFilter || statusFilter === 'active' && tenant.status === 'Active' || statusFilter === 'suspended' && tenant.status === 'Suspended';
    return matchesSearch && matchesStatus;
  });
  const getStatusChip = (status, quality) => {
    if (status === 'Suspended' || quality === 'Low') return <Chip label={tx("auto.k_1374ecc595b6")} color="error" size="small" />;
    if (status === 'Warning' || quality === 'Medium') return <Chip label={tx("auto.k_8835d57fcf86")} color="warning" size="small" />;
    return <Chip label={tx("auto.k_41b054617ef6")} color="success" size="small" />;
  };
  const getTokenStatusChip = tokenStatus => {
    switch (tokenStatus) {
      case 'valid':
        return <Chip icon={<CheckCircleIcon />} label={tx("auto.k_b32b6c91f5cd")} color="success" size="small" />;
      case 'expiring':
        return <Chip icon={<WarningAmberIcon />} label={tx("auto.k_ffc3af745b8e")} color="warning" size="small" />;
      case 'expired':
        return <Chip icon={<CancelIconR />} label={tx("auto.k_a6ed2a716238")} color="error" size="small" />;
      case 'invalid':
        return <Chip icon={<CancelIconR />} label={tx("auto.k_ed30afad4c57")} color="error" size="small" />;
      default:
        return <Chip icon={<UncheckedIcon />} label={tx("auto.k_63a6185ac2bc")} size="small" variant="outlined" />;
    }
  };
  const handleCheckToken = async () => {
    if (!selectedTenantId) return;
    setCheckingToken(true);
    try {
      await api.checkTokenHealth(selectedTenantId);
      window.location.reload();
    } catch (err) {
      console.error('Token check failed:', err);
    } finally {
      setCheckingToken(false);
    }
  };
  const handleMenuOpen = (event, tenantId) => {
    setAnchorEl(event.currentTarget);
    setSelectedTenantId(tenantId);
  };
  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedTenantId(null);
  };
  const openCreateModal = () => {
    setEditingTenant(null);
    setFormData({
      name: '',
      phone: '',
      tier: '1K',
      credits: 0,
      status: 'Active',
      quality: 'High',
      phone_number_id: '',
      access_token: ''
    });
    setShowModal(true);
  };
  const openEditModal = () => {
    const tenant = tenants.find(t => t.id === selectedTenantId);
    if (tenant) {
      setEditingTenant(tenant);
      setFormData({
        name: tenant.name,
        phone: tenant.phone || '',
        tier: tenant.tier,
        credits: tenant.credits,
        status: tenant.status,
        quality: tenant.quality,
        phone_number_id: tenant.phone_number_id || '',
        waba_id: tenant.waba_id || '',
        access_token: tenant.access_token || ''
      });
      setShowModal(true);
    }
    handleMenuClose();
  };
  const openAccountModal = async () => {
    const tenantId = selectedTenantId;
    const tenant = tenants.find(t => t.id === tenantId);
    if (!tenant) return;

    // Close menu first, but save the tenant ID
    setAnchorEl(null);
    // Don't clear selectedTenantId here - we still need it

    setAccountError(null);
    setAccountInfo(null);
    setAccountFormData({
      username: tenant.name.toLowerCase().replace(/\s+/g, '_'),
      password: '',
      email: ''
    });
    setAccountError(null);
    setAccountInfo(null);
    setAccountFormData({
      username: tenant.name.toLowerCase().replace(/\s+/g, '_'),
      password: '',
      email: ''
    });

    // Check if tenant already has an account
    try {
      setAccountLoading(true);
      const data = await api.getTenantAccount(tenantId);
      setAccountInfo(data);
    } catch (err) {
      console.error('Failed to fetch account info:', err);
    } finally {
      setAccountLoading(false);
    }
    setShowAccountModal(true);
  };
  const handleCreateAccount = async () => {
    if (!selectedTenantId || !accountFormData.username || !accountFormData.password) {
      setAccountError(tx("auto.k_e93d0a3e4ab5"));
      return;
    }
    if (accountFormData.password.length < 6) {
      setAccountError(tx("auto.k_e3b07c2e5732"));
      return;
    }
    try {
      setAccountLoading(true);
      setAccountError(null);
      await api.createTenantAccount(selectedTenantId, accountFormData);
      // Refresh account info
      const data = await api.getTenantAccount(selectedTenantId);
      setAccountInfo(data);
      setAccountFormData({
        ...accountFormData,
        password: ''
      });
    } catch (err) {
      setAccountError(err.message);
    } finally {
      setAccountLoading(false);
    }
  };
  const handleResetPassword = async () => {
    const newPassword = prompt(tx("auto.k_16044131a121"));
    if (!newPassword) return;
    if (newPassword.length < 6) {
      alert(tx("auto.k_e3b07c2e5732"));
      return;
    }
    try {
      setAccountLoading(true);
      await api.updateTenantPassword(selectedTenantId, newPassword);
      alert(tx("auto.k_4401e2022693"));
    } catch (err) {
      alert(tx("auto.k_d5cebc00644a") + err.message);
    } finally {
      setAccountLoading(false);
    }
  };
  const handleToggleAccount = async () => {
    try {
      setAccountLoading(true);
      const result = await api.toggleTenantAccount(selectedTenantId);
      // Refresh account info
      const data = await api.getTenantAccount(selectedTenantId);
      setAccountInfo(data);
      alert(result.message);
    } catch (err) {
      alert(tx("auto.k_47603f1fd7c0") + err.message);
    } finally {
      setAccountLoading(false);
    }
  };
  const handleSubmit = async e => {
    e.preventDefault();
    try {
      setSaving(true);
      if (editingTenant) {
        await updateTenant(editingTenant.id, formData);
      } else {
        await createTenant(formData);
      }
      setShowModal(false);
    } catch (error) {
      alert(tx("auto.k_7f67b3128c20") + error.message);
    } finally {
      setSaving(false);
    }
  };
  const handleDelete = async () => {
    const tenant = tenants.find(t => t.id === selectedTenantId);
    if (tenant && window.confirm(tx("auto.k_dc2968660070", {
      value1: tenant.name
    }))) {
      try {
        await deleteTenant(tenant.id);
      } catch (error) {
        alert(tx("auto.k_7f67b3128c20") + error.message);
      }
    }
    handleMenuClose();
  };
  const openCreditsModal = () => {
    setCreditsAmount(100);
    setShowCreditsModal(true);
    setAnchorEl(null);
  };
  const handleAddCredits = async () => {
    if (!selectedTenantId || creditsAmount <= 0) return;
    try {
      setCreditsLoading(true);
      const result = await api.addTenantCredits(selectedTenantId, creditsAmount);
      alert(tx("auto.k_53ee92529990", {
        value1: creditsAmount,
        value2: result.credits
      }));
      setShowCreditsModal(false);
      window.location.reload();
    } catch (err) {
      alert(tx("auto.k_f8f1a92b4cc0") + err.message);
    } finally {
      setCreditsLoading(false);
    }
  };
  const openFbPagesModal = async () => {
    const tenantId = selectedTenantId;
    if (!tenantId) return;
    setAnchorEl(null);
    setFbPagesError(null);
    setFbLinkMode(false);
    setFbLinkForm({
      page_id: '',
      page_access_token: ''
    });
    setShowFbPagesModal(true);
    await loadFbPages(tenantId);
  };
  const loadFbPages = async tenantId => {
    try {
      setFbPagesLoading(true);
      const data = await api.getTenantPages(tenantId || selectedTenantId);
      setFbPages(Array.isArray(data) ? data : []);
    } catch (err) {
      setFbPagesError(err.message || tx("auto.k_1ed9ae47d39b"));
      setFbPages([]);
    } finally {
      setFbPagesLoading(false);
    }
  };
  const handleLinkFbPage = async () => {
    if (!fbLinkForm.page_id || !fbLinkForm.page_access_token) {
      setFbPagesError(tx("auto.k_90f808fdf3f4"));
      return;
    }
    try {
      setFbLinking(true);
      setFbPagesError(null);
      const result = await api.linkTenantPage(selectedTenantId, fbLinkForm);
      if (result._webhook_warning) {
        setFbPagesError(tx("auto.k_08ebb839ff4c", {
          value1: result._webhook_warning
        }));
      }
      setFbLinkForm({
        page_id: '',
        page_access_token: ''
      });
      setFbLinkMode(false);
      await loadFbPages();
    } catch (err) {
      setFbPagesError(err.message || tx("auto.k_98ed866c0ac5"));
    } finally {
      setFbLinking(false);
    }
  };
  const handleUnlinkFbPage = async pageId => {
    if (!window.confirm(tx("auto.k_0fda0f3353a4"))) return;
    try {
      await api.unlinkTenantPage(pageId);
      await loadFbPages();
    } catch (err) {
      setFbPagesError(err.message || tx("auto.k_1eac1b60549f"));
    }
  };
  const handleToggleFbPageActive = async (pageDbId, currentActive) => {
    try {
      await api.updateTenantPage(pageDbId, {
        is_active: !currentActive
      });
      await loadFbPages();
    } catch (err) {
      setFbPagesError(err.message || tx("auto.k_7eb2f777049a"));
    }
  };
  const handleSubscribeFbPage = async pageDbId => {
    try {
      await api.subscribeTenantPage(pageDbId);
      await loadFbPages();
    } catch (err) {
      setFbPagesError(err.message || tx("auto.k_b8b38516d86d"));
    }
  };
  const handleVerifyFbPage = async pageDbId => {
    try {
      const result = await api.verifyTenantPage(pageDbId);
      if (result.valid) {
        alert(tx("auto.k_1f89df9e891f"));
        await loadFbPages();
      } else {
        alert(tx("auto.k_b43bf0c1c8ca") + (result.error || ''));
      }
    } catch (err) {
      alert(tx("auto.k_22949a3cbd9e") + (err.message || ''));
    }
  };
  const openFbPagesFromEdit = async tenantId => {
    setFbPagesError(null);
    setFbLinkMode(false);
    setFbLinkForm({
      page_id: '',
      page_access_token: ''
    });
    setShowFbPagesModal(true);
    setFbLinkId(tenantId);
    try {
      setFbPagesLoading(true);
      const data = await api.getTenantPages(tenantId);
      setFbPages(Array.isArray(data) ? data : []);
    } catch (err) {
      setFbPagesError(err.message || tx("auto.k_1ed9ae47d39b"));
      setFbPages([]);
    } finally {
      setFbPagesLoading(false);
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
      flexDirection: {
        xs: 'column',
        md: 'row'
      },
      justifyContent: 'space-between',
      alignItems: {
        xs: 'flex-start',
        md: 'center'
      },
      mb: 4,
      gap: {
        xs: 1,
        md: 0
      }
    }}>
                <Box>
                    <Typography variant="h4" fontWeight={700} gutterBottom>{tx("auto.k_32564e22337c")}

          </Typography>
                    <Typography variant="body2" color="text.secondary">{tx("auto.k_0c59bcec711f")}

          </Typography>
                </Box>
                <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateModal}>

                    <Box component="span" sx={{
          display: {
            xs: 'none',
            md: 'inline'
          }
        }}>{tx("auto.k_302fd8913419")}</Box>
                </Button>
            </Box>

            <Paper sx={{
      p: 2,
      mb: 3
    }}>
                <Box sx={{
        display: 'flex',
        gap: 2
      }}>
                    <TextField fullWidth size="small" placeholder={tx("auto.k_a4cdcf571535")} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} InputProps={{
          startAdornment: <InputAdornment position="start">
                                    <SearchIcon color="action" />
                                </InputAdornment>
        }} />

                    <FormControl size="small" sx={{
          minWidth: 200
        }}>
                        <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} displayEmpty>

                            <MenuItem value="">{tx("auto.k_8029f660a234")}</MenuItem>
                            <MenuItem value="active">{tx("auto.k_41b054617ef6")}</MenuItem>
                            <MenuItem value="suspended">{tx("auto.k_499473f337a4")}</MenuItem>
                        </Select>
                    </FormControl>
                </Box>
            </Paper>

            {error && <Alert severity="error" sx={{
      mb: 3
    }}>
                    {error}
                </Alert>}

            <TableContainer component={Paper} sx={{
      overflowX: 'auto'
    }}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>{tx("auto.k_9de8ce86e6cf")}</TableCell>
                            <TableCell>{tx("auto.k_211cce4ca4ef")}</TableCell>
                            <TableCell>{tx("auto.k_7d1db84621b0")}</TableCell>
                            <TableCell>{tx("auto.k_f96a754ed8d1")}</TableCell>
                            <TableCell>{tx("auto.k_7f722995e57f")}</TableCell>
                            <TableCell>{tx("auto.k_d6370401145d")}</TableCell>
                            <TableCell>{tx("auto.k_9c64331d31ea")}</TableCell>
                            <TableCell align="right">{tx("auto.k_8edfb81a349f")}</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {loading ? <TableRow>
                                <TableCell colSpan={8} align="center" sx={{
              py: 3
            }}>
                                    <CircularProgress />
                                </TableCell>
                            </TableRow> : filteredTenants.length === 0 ? <TableRow>
                                <TableCell colSpan={8} align="center" sx={{
              py: 3
            }}>
                                    <Typography color="text.secondary">{tx("auto.k_edac8a028c10")}</Typography>
                                </TableCell>
                            </TableRow> : filteredTenants.map(tenant => <TableRow key={tenant.id} hover>
                                    <TableCell sx={{
              fontWeight: 600
            }}>{tenant.name}</TableCell>
                                    <TableCell sx={{
              fontFamily: 'monospace'
            }}>{tenant.phone}</TableCell>
                                    <TableCell>{tenant.tier}</TableCell>
                                    <TableCell>{tenant.credits?.toLocaleString()} Credits</TableCell>
                                    <TableCell>
                                        <Typography variant="body2" fontWeight={600} color={tenant.quality === 'High' ? 'success.main' : tenant.quality === 'Medium' ? 'warning.main' : 'error.main'}>

                                            {tenant.quality}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>{getStatusChip(tenant.status, tenant.quality)}</TableCell>
                                    <TableCell>{getTokenStatusChip(tenant.token_status)}</TableCell>
                                    <TableCell align="right">
                                        <IconButton size="small" onClick={e => handleMenuOpen(e, tenant.id)}>
                                            <MoreVertIcon />
                                        </IconButton>
                                    </TableCell>
                                </TableRow>)}
                    </TableBody>
                </Table>
            </TableContainer>

            <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>

                <MenuItem onClick={openEditModal}>
                    <ListItemIcon>
                        <EditIcon fontSize="small" />
                    </ListItemIcon>{tx("auto.k_b4f76c3aa21e")}

        </MenuItem>
                <MenuItem onClick={openAccountModal}>
                    <ListItemIcon>
                        <PersonAddIcon fontSize="small" color="primary" />
                    </ListItemIcon>{tx("auto.k_dda2988c3041")}

        </MenuItem>
                <MenuItem onClick={openCreditsModal}>
                    <ListItemIcon>
                        <CreditsIcon fontSize="small" color="success" />
                    </ListItemIcon>{tx("auto.k_f59fc10a27f4")}

        </MenuItem>
                <MenuItem onClick={openFbPagesModal}>
                    <ListItemIcon>
                        <FacebookIcon fontSize="small" sx={{
            color: '#1877f2'
          }} />
                    </ListItemIcon>{tx("auto.k_b77cc799dc2a")}

        </MenuItem>
                <MenuItem onClick={handleCheckToken} disabled={checkingToken}>
                    <ListItemIcon>
                        <VerifiedUserIcon fontSize="small" color={checkingToken ? 'disabled' : 'primary'} />
                    </ListItemIcon>
                    {checkingToken ? tx("auto.k_67ee063d701b") : tx("auto.k_ff396c240cb7")}
                </MenuItem>
                <Divider />
                <MenuItem onClick={handleDelete} sx={{
        color: 'error.main'
      }}>
                    <ListItemIcon>
                        <DeleteIcon fontSize="small" color="error" />
                    </ListItemIcon>{tx("auto.k_2d2bbdc2d694")}

        </MenuItem>
            </Menu>

            {/* Edit/Create Dialog */}
            <Dialog open={showModal} onClose={() => setShowModal(false)} maxWidth="sm" fullWidth>
                <form onSubmit={handleSubmit}>
                    <DialogTitle>
                        {editingTenant ? tx("auto.k_f58bd40274e3") : tx("auto.k_302fd8913419")}
                    </DialogTitle>
                    <DialogContent dividers>
                        <Grid container spacing={2}>
                            <Grid size={{
              xs: 12
            }}>
                                <TextField fullWidth label={tx("auto.k_9de8ce86e6cf")} value={formData.name} onChange={e => setFormData({
                ...formData,
                name: e.target.value
              })} required />

                            </Grid>
                            <Grid size={{
              xs: 12
            }}>
                                <TextField fullWidth label={tx("auto.k_211cce4ca4ef")} value={formData.phone} onChange={e => setFormData({
                ...formData,
                phone: e.target.value
              })} placeholder="+966500000000" />

                            </Grid>
                            <Grid size={{
              xs: 6
            }}>
                                <FormControl fullWidth>
                                    <InputLabel>{tx("auto.k_6ffd81e2c547")}</InputLabel>
                                    <Select value={formData.tier} label={tx("auto.k_6ffd81e2c547")} onChange={e => setFormData({
                  ...formData,
                  tier: e.target.value
                })}>

                                        <MenuItem value="1K">1K</MenuItem>
                                        <MenuItem value="10K">10K</MenuItem>
                                        <MenuItem value="100K">100K</MenuItem>
                                        <MenuItem value="Unlimited">Unlimited</MenuItem>
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid size={{
              xs: 6
            }}>
                                <TextField fullWidth type="number" label={tx("auto.k_f96a754ed8d1")} value={formData.credits} onChange={e => setFormData({
                ...formData,
                credits: parseInt(e.target.value) || 0
              })} />

                            </Grid>
                            <Grid size={{
              xs: 6
            }}>
                                <FormControl fullWidth>
                                    <InputLabel>{tx("auto.k_d6370401145d")}</InputLabel>
                                    <Select value={formData.status} label={tx("auto.k_d6370401145d")} onChange={e => setFormData({
                  ...formData,
                  status: e.target.value
                })}>

                                        <MenuItem value="Active">{tx("auto.k_41b054617ef6")}</MenuItem>
                                        <MenuItem value="Warning">{tx("auto.k_8835d57fcf86")}</MenuItem>
                                        <MenuItem value="Suspended">{tx("auto.k_499473f337a4")}</MenuItem>
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid size={{
              xs: 6
            }}>
                                <FormControl fullWidth>
                                    <InputLabel>{tx("auto.k_a3035054d6c1")}</InputLabel>
                                    <Select value={formData.quality} label={tx("auto.k_a3035054d6c1")} onChange={e => setFormData({
                  ...formData,
                  quality: e.target.value
                })}>

                                        <MenuItem value="High">High</MenuItem>
                                        <MenuItem value="Medium">Medium</MenuItem>
                                        <MenuItem value="Low">Low</MenuItem>
                                    </Select>
                                </FormControl>
                            </Grid>

                            <Grid size={{
              xs: 12
            }}>
                                <Box sx={{
                mt: 2,
                pt: 2,
                borderTop: 1,
                borderColor: 'divider'
              }}>
                                    <Typography variant="subtitle2" gutterBottom sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1
                }}>
                                        <WhatsAppIcon fontSize="small" />{tx("auto.k_9354cdbf790e")}
                  </Typography>
                                </Box>
                            </Grid>

                            <Grid size={{
              xs: 12
            }}>
                                <TextField fullWidth label="Phone Number ID" value={formData.phone_number_id} onChange={e => setFormData({
                ...formData,
                phone_number_id: e.target.value
              })} placeholder="105956789012345" />

                            </Grid>

                            <Grid size={{
              xs: 12
            }}>
                                <TextField fullWidth label={tx("auto.k_ee6af2bc6042")} value={formData.waba_id} onChange={e => setFormData({
                ...formData,
                waba_id: e.target.value
              })} placeholder="100595678901234" helperText={tx("auto.k_4c65d610ff11")} />

                            </Grid>

                            <Grid size={{
              xs: 12
            }}>
                                <TextField fullWidth type="password" label="Access Token" value={formData.access_token} onChange={e => setFormData({
                ...formData,
                access_token: e.target.value
              })} placeholder="EAA..." />

                            </Grid>

                            {editingTenant && <Grid size={{
              xs: 12
            }}>
                                    <Box sx={{
                mt: 2,
                pt: 2,
                borderTop: 1,
                borderColor: 'divider'
              }}>
                                        <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                                            <Typography variant="subtitle2" sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1
                  }}>
                                                <FacebookIcon fontSize="small" sx={{
                      color: '#1877f2'
                    }} />{tx("auto.k_fbc00016e89a")}
                    </Typography>
                                            <Button size="small" startIcon={<LinkIcon />} onClick={() => openFbPagesFromEdit(editingTenant.id)}>{tx("auto.k_c3bc9d762bb6")}


                    </Button>
                                        </Box>
                                    </Box>
                                </Grid>}
                        </Grid>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setShowModal(false)} color="inherit">{tx("auto.k_e776b0209b50")}

            </Button>
                        <Button type="submit" variant="contained" disabled={saving} startIcon={saving ? <CircularProgress size={20} /> : null}>

                            {saving ? tx("auto.k_898769fc464a") : editingTenant ? tx("auto.k_41097c7fa74d") : tx("auto.k_e061cf161664")}
                        </Button>
                    </DialogActions>
                </form>
            </Dialog>

            {/* Account Management Dialog */}
            <Dialog open={showAccountModal} onClose={() => setShowAccountModal(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1
      }}>
                    <PersonAddIcon color="primary" />{tx("auto.k_c57a4a9a3946")}

        </DialogTitle>
                <DialogContent dividers>
                    {accountLoading && <Box sx={{
          textAlign: 'center',
          py: 3
        }}>
                            <CircularProgress />
                        </Box>}

                    {!accountLoading && accountInfo?.hasAccount ?
        // Account exists - show management options
        <Box>
                            <Alert severity="info" icon={<CheckCircleIcon />} sx={{
            mb: 3
          }}>{tx("auto.k_819b0c196232")}

            </Alert>

                            <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2
          }}>
                                <Box sx={{
              p: 2,
              bgcolor: 'grey.50',
              borderRadius: 2
            }}>
                                    <Typography variant="body2" color="text.secondary">{tx("auto.k_794f68a24741")}</Typography>
                                    <Typography variant="h6" fontFamily="monospace">
                                        {accountInfo.account.username}
                                    </Typography>
                                </Box>

                                <Box sx={{
              p: 2,
              bgcolor: 'grey.50',
              borderRadius: 2
            }}>
                                    <Typography variant="body2" color="text.secondary">{tx("auto.k_b2b02f1745b7")}</Typography>
                                    <Chip label={accountInfo.account.is_active ? tx("auto.k_41b054617ef6") : tx("auto.k_01813f1fbf17")} color={accountInfo.account.is_active ? 'success' : 'error'} size="small" sx={{
                mt: 0.5
              }} />

                                </Box>

                                <Box sx={{
              p: 2,
              bgcolor: 'grey.50',
              borderRadius: 2
            }}>
                                    <Typography variant="body2" color="text.secondary">{tx("auto.k_8ae0f595756e")}</Typography>
                                    <Typography>
                                        {accountInfo.account.last_login ? new Date(accountInfo.account.last_login).toLocaleString(getCurrentLocale()) : tx("auto.k_8391f65dffdb")}
                                    </Typography>
                                </Box>

                                <Divider sx={{
              my: 2
            }} />

                                <Box sx={{
              display: 'flex',
              gap: 2
            }}>
                                    <Button variant="outlined" startIcon={<KeyIcon />} onClick={handleResetPassword} disabled={accountLoading}>{tx("auto.k_f779e19d8133")}


                </Button>
                                    <Button variant="outlined" color={accountInfo.account.is_active ? 'error' : 'success'} onClick={handleToggleAccount} disabled={accountLoading}>

                                        {accountInfo.account.is_active ? tx("auto.k_fe43996f8b68") : tx("auto.k_4ec1e97fccb3")}
                                    </Button>
                                </Box>
                            </Box>
                        </Box> : !accountLoading ?
        // No account - show creation form
        <Box>
                            <Alert severity="warning" sx={{
            mb: 3
          }}>{tx("auto.k_0b2ab6103fe9")}

            </Alert>

                            {accountError && <Alert severity="error" sx={{
            mb: 2
          }} onClose={() => setAccountError(null)}>
                                    {accountError}
                                </Alert>}

                            <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2
          }}>
                                <TextField fullWidth label={tx("auto.k_794f68a24741")} value={accountFormData.username} onChange={e => setAccountFormData({
              ...accountFormData,
              username: e.target.value
            })} required helperText={tx("auto.k_982ca133cb9c")} />

                                <TextField fullWidth type="password" label={tx("auto.k_7ba22cf7e99d")} value={accountFormData.password} onChange={e => setAccountFormData({
              ...accountFormData,
              password: e.target.value
            })} required helperText={tx("auto.k_b9509a00a55a")} />

                                <TextField fullWidth type="email" label={tx("auto.k_73698845baf7")} value={accountFormData.email} onChange={e => setAccountFormData({
              ...accountFormData,
              email: e.target.value
            })} />


                                <Button variant="contained" startIcon={accountLoading ? <CircularProgress size={20} /> : <PersonAddIcon />} onClick={handleCreateAccount} disabled={accountLoading || !accountFormData.username || !accountFormData.password} fullWidth sx={{
              mt: 2
            }}>{tx("auto.k_a40a6e99a30b")}


              </Button>
                            </Box>
                        </Box> : null}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowAccountModal(false)}>{tx("auto.k_5bf826c5e57c")}

          </Button>
                </DialogActions>
            </Dialog>

            {/* Credits Top-Up Dialog */}
            <Dialog open={showCreditsModal} onClose={() => !creditsLoading && setShowCreditsModal(false)} maxWidth="xs" fullWidth>
                <DialogTitle sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1
      }}>
                    <CreditsIcon color="success" />{tx("auto.k_f59fc10a27f4")}

        </DialogTitle>
                <DialogContent dividers>
                    <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          pt: 1
        }}>
                        <Box sx={{
            p: 2,
            bgcolor: 'grey.50',
            borderRadius: 2
          }}>
                            <Typography variant="body2" color="text.secondary">{tx("auto.k_8adba91e1d87")}</Typography>
                            <Typography variant="h6">
                                {tenants.find(t => t.id === selectedTenantId)?.name || '—'}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{
              mt: 1
            }}>{tx("auto.k_5875698d9570")}
                {tenants.find(t => t.id === selectedTenantId)?.credits?.toLocaleString() || 0}
                            </Typography>
                        </Box>

                        <TextField fullWidth type="number" label={tx("auto.k_3e43a1d33b2a")} value={creditsAmount} onChange={e => setCreditsAmount(Math.max(1, parseInt(e.target.value) || 0))} inputProps={{
            min: 1,
            max: 100000
          }} helperText={tx("auto.k_8b4f17b1de98")} />


                        <Box sx={{
            display: 'flex',
            gap: 1,
            flexWrap: 'wrap'
          }}>
                            {[50, 100, 500, 1000, 5000].map(amt => <Chip key={amt} label={`+${amt}`} onClick={() => setCreditsAmount(amt)} color={creditsAmount === amt ? 'success' : 'default'} clickable />)}
                        </Box>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowCreditsModal(false)} disabled={creditsLoading}>{tx("auto.k_e776b0209b50")}</Button>
                    <Button variant="contained" color="success" onClick={handleAddCredits} disabled={creditsLoading || creditsAmount <= 0} startIcon={creditsLoading ? <CircularProgress size={16} /> : <CreditsIcon />}>

                        {creditsLoading ? tx("auto.k_0ca4319bb9bb") : tx("auto.k_8a5ac0d52771", {
            value1: creditsAmount
          })}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Facebook Pages Management Dialog */}
            <Dialog open={showFbPagesModal} onClose={() => setShowFbPagesModal(false)} maxWidth="md" fullWidth>
                <DialogTitle sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1
      }}>
                    <FacebookIcon sx={{
          color: '#1877f2'
        }} />{tx("auto.k_fbc00016e89a")}

          {fbPagesLoading && <CircularProgress size={18} sx={{
          ml: 1
        }} />}
                </DialogTitle>
                <DialogContent dividers>
                    {fbPagesError && <Alert severity="error" sx={{
          mb: 2
        }} onClose={() => setFbPagesError(null)}>
                            {fbPagesError}
                        </Alert>}

                    {!fbLinkMode ? <Box>
                            {fbPages.length === 0 && !fbPagesLoading ? <Box sx={{
            textAlign: 'center',
            py: 4
          }}>
                                    <FacebookIcon sx={{
              fontSize: 48,
              color: '#1877f2',
              opacity: 0.4,
              mb: 1
            }} />
                                    <Typography color="text.secondary">{tx("auto.k_43a46f260ab6")}</Typography>
                                    <Typography variant="body2" color="text.secondary">{tx("auto.k_9e159a018e50")}</Typography>
                                </Box> : <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2
          }}>
                                    {fbPages.map(page => <Paper key={page.id} variant="outlined" sx={{
              p: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2
            }}>
                                            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                flex: 1
              }}>
                                                {page.page_picture_url ? <Box component="img" src={page.page_picture_url} sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  objectFit: 'cover'
                }} alt={page.page_name} /> : <FacebookIcon sx={{
                  fontSize: 40,
                  color: '#1877f2'
                }} />}
                                                <Box sx={{
                  flex: 1
                }}>
                                                    <Typography fontWeight={600}>{page.page_name || page.page_id}</Typography>
                                                    <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    mt: 0.5
                  }}>
                                                        <Typography variant="caption" color="text.secondary">
                                                            {page.page_category || '—'}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary">•</Typography>
                                                        <Typography variant="caption" color="text.secondary" fontFamily="monospace">
                                                            {page.page_id}
                                                        </Typography>
                                                    </Box>
                                                </Box>
                                            </Box>
                                            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                flexShrink: 0,
                flexWrap: 'wrap'
              }}>
                                                <Chip label={page.webhook_subscribed ? 'Webhook ✓' : 'Webhook ✗'} size="small" color={page.webhook_subscribed ? 'success' : 'default'} variant={page.webhook_subscribed ? 'filled' : 'outlined'} />

                                                <Chip label={page.is_active ? tx("auto.k_6cf44b8c32d1") : tx("auto.k_7ac8f21ec817")} size="small" color={page.is_active ? 'success' : 'error'} />

                                                <Button size="small" onClick={() => handleVerifyFbPage(page.id)} variant="outlined">{tx("auto.k_fe79250b3ff2")}

                  </Button>
                                                {!page.webhook_subscribed && <Button size="small" onClick={() => handleSubscribeFbPage(page.id)} variant="outlined">{tx("auto.k_c5822564f83f")}

                  </Button>}
                                                <Button size="small" onClick={() => handleToggleFbPageActive(page.id, page.is_active)} variant="outlined" color={page.is_active ? 'warning' : 'success'}>
                                                    {page.is_active ? tx("auto.k_f0dbb04f3319") : tx("auto.k_c08b684fee53")}
                                                </Button>
                                                <Button size="small" onClick={() => handleUnlinkFbPage(page.id)} variant="outlined" color="error">{tx("auto.k_7dfff2403f93")}

                  </Button>
                                            </Box>
                                        </Paper>)}
                                </Box>}

                            <Box sx={{
            mt: 3
          }}>
                                <Button variant="contained" startIcon={<AddIcon />} onClick={() => setFbLinkMode(true)} sx={{
              bgcolor: '#1877f2',
              '&:hover': {
                bgcolor: '#1565c0'
              }
            }}>{tx("auto.k_137d14ec3a81")}


              </Button>
                            </Box>
                        </Box> : <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2
        }}>
                            <Typography variant="subtitle2">{tx("auto.k_e186242db2aa")}</Typography>
                            <TextField fullWidth label={tx("auto.k_03e2c3cc4542")} value={fbLinkForm.page_id} onChange={e => setFbLinkForm({
            ...fbLinkForm,
            page_id: e.target.value
          })} placeholder="1234567890" helperText={tx("auto.k_3e46ba6b6337")} />

                            <TextField fullWidth type="password" label={tx("auto.k_d98e93134d05")} value={fbLinkForm.page_access_token} onChange={e => setFbLinkForm({
            ...fbLinkForm,
            page_access_token: e.target.value
          })} placeholder="EAA..." helperText={tx("auto.k_5a87ff1b9799")} />

                            <Box sx={{
            display: 'flex',
            gap: 1,
            justifyContent: 'flex-end'
          }}>
                                <Button onClick={() => {
              setFbLinkMode(false);
              setFbLinkForm({
                page_id: '',
                page_access_token: ''
              });
            }} disabled={fbLinking}>{tx("auto.k_e776b0209b50")}

              </Button>
                                <Button variant="contained" onClick={handleLinkFbPage} disabled={fbLinking || !fbLinkForm.page_id || !fbLinkForm.page_access_token} startIcon={fbLinking ? <CircularProgress size={18} /> : <LinkIcon />} sx={{
              bgcolor: '#1877f2',
              '&:hover': {
                bgcolor: '#1565c0'
              }
            }}>

                                    {fbLinking ? tx("auto.k_170db7087cd8") : tx("auto.k_21019a65e440")}
                                </Button>
                            </Box>
                        </Box>}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowFbPagesModal(false)}>{tx("auto.k_5bf826c5e57c")}</Button>
                    {!fbLinkMode && fbPages.length > 0 && <Button startIcon={<RefreshIcon />} onClick={() => loadFbPages(fbLinkId || selectedTenantId)} disabled={fbPagesLoading}>{tx("auto.k_4309a75e6882")}

          </Button>}
                </DialogActions>
            </Dialog>
        </Box>;
};
export default TenantList;
