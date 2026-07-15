import React, { useState, useEffect, useCallback } from 'react';
import { Box, Paper, Typography, TextField, InputAdornment, Chip, IconButton, Button, FormControl, MenuItem, CircularProgress, Alert, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import Select from '../../components/Form/AccessibleSelect';
import { Search as SearchIcon, Refresh as RefreshIcon, Label as LabelIcon, Save as SaveIcon, Close as CloseIcon, Add as AddIcon, ContactPhone as ContactPhoneIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import { tx } from "../../i18n/tx";
import { getContactLabelOptions } from '../Contacts/contactConfig';
import { ContactDeleteDialog, ContactIdentitySummary, ContactTable } from '../Contacts/ContactPresentation';
import ContactTransferActions from '../Contacts/ContactTransferActions';
const TenantContacts = () => {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [labelFilter, setLabelFilter] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [total, setTotal] = useState(0);

  // Edit dialog
  const [editContact, setEditContact] = useState(null);
  const [editForm, setEditForm] = useState({
    label: '',
    notes: ''
  });
  const [saving, setSaving] = useState(false);

  // Add dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({
    phone: '',
    profile_name: '',
    label: '',
    notes: ''
  });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState(null);

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
      const data = await api.getPortalContacts(params);
      setContacts(data.contacts || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, search, labelFilter]);
  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);
  const openEditDialog = contact => {
    setEditContact(contact);
    setEditForm({
      label: contact.label || '',
      notes: contact.notes || ''
    });
  };
  const handleSaveContact = async () => {
    if (!editContact) return;
    try {
      setSaving(true);
      await api.updatePortalContact(editContact.id, editForm);
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
      await api.createPortalContact({
        phone: addForm.phone.replace(/[^0-9+]/g, '').trim(),
        profile_name: addForm.profile_name || null,
        label: addForm.label || null,
        notes: addForm.notes || null
      });
      setShowAddDialog(false);
      setAddForm({
        phone: '',
        profile_name: '',
        label: '',
        notes: ''
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
      await api.deletePortalContact(deleteContact.id);
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
    if (contact.profile_name) query.set('name', contact.profile_name);
    navigate(`/portal/inbox?${query.toString()}`);
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
                        <ContactPhoneIcon fontSize="large" color="secondary" />{tx("auto.k_1c0785dfe87c")}

          </Typography>
                    <Typography variant="body2" color="text.secondary">{tx("auto.k_ae0851735961")}

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
                    <ContactTransferActions
                      accentColor="secondary"
                      onImport={file => api.importPortalContactsCsv(file)}
                      onImported={fetchContacts}
                      onExport={() => api.exportPortalContactsCsv({
                        ...(search ? { search } : {}),
                        ...(labelFilter ? { label: labelFilter } : {}),
                      })}
                    />
                    <Button
                      variant="contained"
                      color="secondary"
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
                <Box sx={{
        display: 'flex',
        gap: 2,
        flexWrap: 'wrap'
      }}>
                    <TextField size="small" placeholder={tx("auto.k_d41cf8b2eaee")} inputProps={{ 'aria-label': tx("auto.k_d41cf8b2eaee") }} value={search} onChange={e => {
          setSearch(e.target.value);
          setPage(0);
        }} sx={{
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
                </Box>
            </Paper>

            {error && <Alert severity="error" sx={{
      mb: 3
    }} onClose={() => setError(null)}>
                    {error}
                </Alert>}

            <ContactTable
                accentColor="secondary"
                contacts={contacts}
                emptyMessageKey="auto.k_5070251cecc4"
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
                showTenant={false}
                total={total}
            />

            {/* Edit Dialog */}
            <Dialog open={!!editContact} onClose={() => !saving && setEditContact(null)} maxWidth="sm" fullWidth aria-labelledby="tenant-edit-contact-heading">
                <DialogTitle id="tenant-edit-contact-title" component="div" sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
                    <Typography id="tenant-edit-contact-heading" component="h2" variant="h6" sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1
        }}>
                        <LabelIcon color="secondary" />{tx("auto.k_6351670dcbdd")}

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
          })} multiline rows={3} placeholder={tx("auto.k_d8ded162f730")} />

                        </Box>}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setEditContact(null)} disabled={saving}>{tx("auto.k_e776b0209b50")}</Button>
                    <Button variant="contained" color="secondary" onClick={handleSaveContact} disabled={saving} startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}>

                        {saving ? tx("auto.k_898769fc464a") : tx("auto.k_56ee6e0d206b")}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Add Contact Dialog */}
            <Dialog open={showAddDialog} onClose={() => !addSaving && setShowAddDialog(false)} maxWidth="sm" fullWidth aria-labelledby="tenant-add-contact-heading">
                <DialogTitle id="tenant-add-contact-title" component="div" sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
                    <Typography id="tenant-add-contact-heading" component="h2" variant="h6" sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1
        }}>
                        <AddIcon color="secondary" />{tx("auto.k_858536f1fe74")}

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
                    <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2.5,
          pt: 1
        }}>
                        <TextField fullWidth label={tx("auto.k_211cce4ca4ef")} placeholder="218911234567" value={addForm.phone} onChange={e => setAddForm({
            ...addForm,
            phone: e.target.value
          })} required inputProps={{
            dir: 'ltr',
            style: {
              fontFamily: 'monospace'
            }
          }} />

                        <TextField fullWidth label={tx("auto.k_0a92494ea1eb")} placeholder={tx("auto.k_28fc609bc67b")} value={addForm.profile_name} onChange={e => setAddForm({
            ...addForm,
            profile_name: e.target.value
          })} />

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
                    <Button variant="contained" color="secondary" onClick={handleAddContact} disabled={addSaving || !addForm.phone?.trim()} startIcon={addSaving ? <CircularProgress size={16} /> : <AddIcon />}>

                        {addSaving ? tx("auto.k_0ca4319bb9bb") : tx("auto.k_5e3a3fdfce20")}
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
export default TenantContacts;
