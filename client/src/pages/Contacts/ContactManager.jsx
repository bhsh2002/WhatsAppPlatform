import React, { useState, useEffect, useCallback } from 'react';
import { Box, Paper, Typography, TextField, InputAdornment, Chip, IconButton, Button, FormControl, MenuItem, CircularProgress, Alert, Dialog, DialogTitle, DialogContent, DialogActions, FormControlLabel, Checkbox } from '@mui/material';
import Select from '../../components/Form/AccessibleSelect';
import { Search as SearchIcon, Refresh as RefreshIcon, Label as LabelIcon, Save as SaveIcon, Close as CloseIcon, Add as AddIcon, ContactPhone as ContactPhoneIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import { tx } from "../../i18n/tx";
import { getContactLabelOptions } from './contactConfig';
import { ContactDeleteDialog, ContactIdentitySummary, ContactTable } from './ContactPresentation';
const ContactManager = () => {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [labelFilter, setLabelFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [tenants, setTenants] = useState([]);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [total, setTotal] = useState(0);

  // Edit dialog state
  const [editContact, setEditContact] = useState(null);
  const [editForm, setEditForm] = useState({
    label: '',
    notes: '',
    profile_name: ''
  });
  const [saving, setSaving] = useState(false);

  // Add dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({
    phone: '',
    tenant_id: '',
    label: '',
    notes: '',
    verify: true
  });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState(null);
  const [addSuccess, setAddSuccess] = useState(null);

  // Delete confirmation
  const [deleteContact, setDeleteContact] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = {
        page: page + 1,
        limit: rowsPerPage
      };
      if (search) params.search = search;
      if (labelFilter) params.label = labelFilter;
      if (tenantFilter) params.tenant_id = tenantFilter;
      const data = await api.getContacts(params);
      setContacts(data.contacts || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, search, labelFilter, tenantFilter]);
  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);
  useEffect(() => {
    const loadTenants = async () => {
      try {
        const data = await api.getTenants();
        setTenants(data);
      } catch (err) {
        console.error('Failed to load tenants:', err);
      }
    };
    loadTenants();
  }, []);
  const handleSearchSubmit = e => {
    e.preventDefault();
    setPage(0);
    fetchContacts();
  };
  const openEditDialog = contact => {
    setEditContact(contact);
    setEditForm({
      label: contact.label || '',
      notes: contact.notes || '',
      profile_name: contact.profile_name || ''
    });
  };
  const handleSaveContact = async () => {
    if (!editContact) return;
    try {
      setSaving(true);
      await api.updateContact(editContact.id, editForm);
      setEditContact(null);
      fetchContacts();
    } catch (err) {
      alert(tx("auto.k_ce3180675675") + err.message);
    } finally {
      setSaving(false);
    }
  };
  const handleAddContact = async () => {
    if (!addForm.phone?.trim()) return;
    try {
      setAddSaving(true);
      setAddError(null);
      setAddSuccess(null);
      const result = await api.createContact({
        phone: addForm.phone.replace(/[^0-9+]/g, '').trim(),
        tenant_id: addForm.tenant_id || null,
        label: addForm.label || null,
        notes: addForm.notes || null,
        verify: addForm.verify && !!addForm.tenant_id
      });
      if (result.template_sent) {
        setAddSuccess('Number verified on WhatsApp and greeting template sent');
      } else {
        setAddSuccess('Contact added successfully');
      }
      setAddForm({
        phone: '',
        tenant_id: '',
        label: '',
        notes: '',
        verify: true
      });
      fetchContacts();
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAddSaving(false);
    }
  };
  const handleDeleteContact = async () => {
    if (!deleteContact) return;
    try {
      setDeleting(true);
      await api.deleteContact(deleteContact.id);
      setDeleteContact(null);
      fetchContacts();
    } catch (err) {
      alert(tx("auto.k_fc43c603666e") + err.message);
    } finally {
      setDeleting(false);
    }
  };
  const openConversation = contact => {
    const query = new URLSearchParams({
      channel: 'whatsapp',
      contact: contact.phone
    });
    if (contact.tenant_id) query.set('tenant_id', String(contact.tenant_id));
    if (contact.profile_name) query.set('name', contact.profile_name);
    navigate(`/inbox?${query.toString()}`);
  };
  return <Box sx={{
    p: {
      xs: 1.5,
      md: 3
    }
  }}>
            {/* Header */}
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
                    <Typography variant="h4" component="h1" fontWeight={700} gutterBottom sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1
        }}>
                        <ContactPhoneIcon fontSize="large" color="primary" />{tx("auto.k_1c0785dfe87c")}

          </Typography>
                    <Typography variant="body2" color="text.secondary">{tx("auto.k_e702faa357a0")}

          </Typography>
                </Box>
                <Box sx={{
        display: 'flex',
        gap: 1,
        flexWrap: {
          xs: 'wrap',
          md: 'nowrap'
        }
      }}>
                    <Button
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={() => setShowAddDialog(true)}
                      aria-label={tx("auto.k_3fafc0e9d048")}
                    >

                        <Box component="span" sx={{
            display: {
              xs: 'none',
              md: 'inline'
            }
          }}>{tx("auto.k_3fafc0e9d048")}</Box>
                    </Button>
                    <Button variant="outlined" startIcon={loading ? <CircularProgress size={20} /> : <RefreshIcon />} onClick={fetchContacts} disabled={loading}>{tx("auto.k_4309a75e6882")}


          </Button>
                </Box>
            </Box>

            {/* Filters */}
            <Paper sx={{
      p: 2,
      mb: 3
    }}>
                <Box component="form" onSubmit={handleSearchSubmit} sx={{
        display: 'flex',
        gap: 2,
        flexWrap: 'wrap'
      }}>
                    <TextField size="small" placeholder={tx("auto.k_d41cf8b2eaee")} inputProps={{ 'aria-label': tx("auto.k_d41cf8b2eaee") }} value={search} onChange={e => setSearch(e.target.value)} sx={{
          flex: 1,
          minWidth: 250
        }} InputProps={{
          startAdornment: <InputAdornment position="start">
                                    <SearchIcon color="action" />
                                </InputAdornment>
        }} />

                    <FormControl size="small" sx={{
          minWidth: 150
        }}>
                        <Select inputProps={{ 'aria-label': tx("auto.k_7c75fec5c0f8") }} value={labelFilter} onChange={e => {
            setLabelFilter(e.target.value);
            setPage(0);
          }} displayEmpty>

                            <MenuItem value="">{tx("auto.k_2df7f1049565")}</MenuItem>
                            {getContactLabelOptions().filter(o => o.value).map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <FormControl size="small" sx={{
          minWidth: 180
        }}>
                        <Select inputProps={{ 'aria-label': tx("auto.k_8adba91e1d87") }} value={tenantFilter} onChange={e => {
            setTenantFilter(e.target.value);
            setPage(0);
          }} displayEmpty>

                            <MenuItem value="">{tx("auto.k_aad59ea9f020")}</MenuItem>
                            {tenants.map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                        </Select>
                    </FormControl>
                </Box>
            </Paper>

            {error && <Alert severity="error" sx={{
      mb: 3
    }} onClose={() => setError(null)}>
                    {error}
                </Alert>}

            <ContactTable
                accentColor="primary"
                contacts={contacts}
                emptyMessageKey="auto.k_730f15ca2de4"
                loading={loading}
                onDelete={setDeleteContact}
                onEdit={openEditDialog}
                onOpenConversation={openConversation}
                onPageChange={(_, newPage) => setPage(newPage)}
                onRowsPerPageChange={event => {
                  setRowsPerPage(parseInt(event.target.value, 10));
                  setPage(0);
                }}
                page={page}
                rowsPerPage={rowsPerPage}
                showTenant={true}
                total={total}
            />

            {/* Edit Contact Dialog */}
            <Dialog open={!!editContact} onClose={() => !saving && setEditContact(null)} maxWidth="sm" fullWidth aria-labelledby="admin-edit-contact-heading">
                <DialogTitle id="admin-edit-contact-title" component="div" sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
                    <Typography id="admin-edit-contact-heading" component="h2" variant="h6" sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1
        }}>
                        <LabelIcon color="primary" />{tx("auto.k_6351670dcbdd")}

          </Typography>
                    <IconButton aria-label={tx("auto.k_e776b0209b50")} onClick={() => setEditContact(null)} disabled={saving}>
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers>
                    {editContact && <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2.5,
          pt: 1
        }}>
                            <ContactIdentitySummary contact={editContact} />

                            <TextField fullWidth label={tx("auto.k_0a92494ea1eb")} value={editForm.profile_name} onChange={e => setEditForm({
            ...editForm,
            profile_name: e.target.value
          })} />


                            <FormControl fullWidth>
                                <Select inputProps={{ 'aria-label': tx("auto.k_7c75fec5c0f8") }} value={editForm.label} onChange={e => setEditForm({
              ...editForm,
              label: e.target.value
            })} displayEmpty renderValue={v => v || tx("auto.k_d423b992b608")}>

                                    {getContactLabelOptions().map(o => <MenuItem key={o.value} value={o.value}>
                                            <Chip label={o.label} size="small" color={o.color} sx={{
                  mr: 1
                }} />
                                        </MenuItem>)}
                                </Select>
                            </FormControl>

                            <TextField fullWidth label={tx("auto.k_480656340410")} value={editForm.notes} onChange={e => setEditForm({
            ...editForm,
            notes: e.target.value
          })} multiline rows={3} placeholder={tx("auto.k_c8628f83d036")} />

                        </Box>}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setEditContact(null)} disabled={saving}>{tx("auto.k_e776b0209b50")}</Button>
                    <Button variant="contained" onClick={handleSaveContact} disabled={saving} startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}>

                        {saving ? tx("auto.k_898769fc464a") : tx("auto.k_56ee6e0d206b")}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Add Contact Dialog */}
            <Dialog open={showAddDialog} onClose={() => !addSaving && setShowAddDialog(false)} maxWidth="sm" fullWidth aria-labelledby="admin-add-contact-heading">
                <DialogTitle id="admin-add-contact-title" component="div" sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
                    <Typography id="admin-add-contact-heading" component="h2" variant="h6" sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1
        }}>
                        <AddIcon color="primary" />{tx("auto.k_858536f1fe74")}

          </Typography>
                    <IconButton aria-label={tx("auto.k_e776b0209b50")} onClick={() => setShowAddDialog(false)} disabled={addSaving}>
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers>
                    {addError && <Alert severity="error" sx={{
          mb: 2
        }} onClose={() => setAddError(null)}>
                            {addError}
                        </Alert>}
                    {addSuccess && <Alert severity="success" sx={{
          mb: 2
        }} onClose={() => setAddSuccess(null)}>
                            {addSuccess}
                        </Alert>}
                    <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2.5,
          pt: 1
        }}>
                        <TextField fullWidth label={tx("auto.k_211cce4ca4ef")} placeholder="966501234567" value={addForm.phone} onChange={e => setAddForm({
            ...addForm,
            phone: e.target.value
          })} required inputProps={{
            dir: 'ltr',
            style: {
              fontFamily: 'monospace'
            }
          }} />

                        <FormControl fullWidth>
                            <Select inputProps={{ 'aria-label': tx("auto.k_8adba91e1d87") }} value={addForm.tenant_id} onChange={e => setAddForm({
              ...addForm,
              tenant_id: e.target.value
            })} displayEmpty renderValue={v => {
              if (!v) return tx("auto.k_1dcf5303ae4a");
              const t = tenants.find(t => t.id === v);
              return t?.name || v;
            }}>

                                <MenuItem value="">{tx("auto.k_1eda0ec97fe6")}</MenuItem>
                                {tenants.map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                            </Select>
                        </FormControl>
                        {addForm.tenant_id && <FormControlLabel control={<Checkbox checked={addForm.verify} onChange={e => setAddForm({
            ...addForm,
            verify: e.target.checked
          })} />} label={tx("auto.k_b2e1a8639c2f")} />}
                        <FormControl fullWidth>
                            <Select inputProps={{ 'aria-label': tx("auto.k_7c75fec5c0f8") }} value={addForm.label} onChange={e => setAddForm({
              ...addForm,
              label: e.target.value
            })} displayEmpty renderValue={v => v || tx("auto.k_54329104ae94")}>

                                {getContactLabelOptions().map(o => <MenuItem key={o.value} value={o.value}>
                                        <Chip label={o.label} size="small" color={o.color} sx={{
                  mr: 1
                }} />
                                    </MenuItem>)}
                            </Select>
                        </FormControl>
                        <TextField fullWidth label={tx("auto.k_480656340410")} value={addForm.notes} onChange={e => setAddForm({
            ...addForm,
            notes: e.target.value
          })} multiline rows={2} placeholder={tx("auto.k_09255c22659b")} />

                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowAddDialog(false)} disabled={addSaving}>{tx("auto.k_e776b0209b50")}</Button>
                    <Button variant="contained" onClick={handleAddContact} disabled={addSaving || !addForm.phone?.trim()} startIcon={addSaving ? <CircularProgress size={16} /> : <AddIcon />}>

                        {addSaving ? tx("auto.k_a786bc53bb3e") : addForm.verify && addForm.tenant_id ? tx("auto.k_4d0d693e8f2c") : tx("auto.k_5e3a3fdfce20")}
                    </Button>
                </DialogActions>
            </Dialog>

            <ContactDeleteDialog
                contact={deleteContact}
                deleting={deleting}
                onCancel={() => setDeleteContact(null)}
                onConfirm={handleDeleteContact}
            />
        </Box>;
};
export default ContactManager;
