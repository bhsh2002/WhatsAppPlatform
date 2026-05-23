import React, { useState, useEffect, useCallback } from 'react';
import { Box, Paper, Typography, TextField, InputAdornment, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, IconButton, Button, FormControl, Select, MenuItem, CircularProgress, Alert, Dialog, DialogTitle, DialogContent, DialogActions, TablePagination, Tooltip } from '@mui/material';
import { Search as SearchIcon, Edit as EditIcon, Chat as ChatIcon, Refresh as RefreshIcon, Label as LabelIcon, Save as SaveIcon, Close as CloseIcon, Add as AddIcon, Delete as DeleteIcon, ContactPhone as ContactPhoneIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import { tx } from "../../i18n/tx";
import { getCurrentLocale } from "../../utils/locale";
const getLABEL_OPTIONS = () => [{
  value: '',
  label: tx("auto.k_2aa3693faed8"),
  color: 'default'
}, {
  value: '\u0639\u0645\u064a\u0644',
  label: tx("auto.k_8898da70bb4c"),
  color: 'primary'
}, {
  value: 'VIP',
  label: 'VIP',
  color: 'secondary'
}, {
  value: '\u0645\u0648\u0631\u062f',
  label: tx("auto.k_f3418b3a2d50"),
  color: 'info'
}, {
  value: '\u062f\u0639\u0645',
  label: tx("auto.k_6d8ade865335"),
  color: 'warning'
}, {
  value: '\u0645\u062d\u0638\u0648\u0631',
  label: tx("auto.k_bd3a43ab3c0a"),
  color: 'error'
}];
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
  const getLabelChip = label => {
    if (!label) return <Chip label="—" size="small" variant="outlined" />;
    const opt = getLABEL_OPTIONS().find(o => o.value === label);
    return <Chip label={label} size="small" color={opt?.color || 'default'} />;
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
                    <Typography variant="h4" fontWeight={700} gutterBottom sx={{
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
                    <Button variant="contained" color="secondary" startIcon={<AddIcon />} onClick={() => setShowAddDialog(true)}>

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
                    <TextField size="small" placeholder={tx("auto.k_d41cf8b2eaee")} value={search} onChange={e => {
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
                        <Select value={labelFilter} onChange={e => {
            setLabelFilter(e.target.value);
            setPage(0);
          }} displayEmpty>

                            <MenuItem value="">{tx("auto.k_2df7f1049565")}</MenuItem>
                            {getLABEL_OPTIONS().filter(o => o.value).map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                        </Select>
                    </FormControl>
                </Box>
            </Paper>

            {error && <Alert severity="error" sx={{
      mb: 3
    }} onClose={() => setError(null)}>
                    {error}
                </Alert>}

            {/* Table */}
            <TableContainer component={Paper} sx={{
      overflowX: 'auto'
    }}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>{tx("auto.k_211cce4ca4ef")}</TableCell>
                            <TableCell>{tx("auto.k_0a92494ea1eb")}</TableCell>
                            <TableCell>{tx("auto.k_7c75fec5c0f8")}</TableCell>
                            <TableCell>CTWA</TableCell>
                            <TableCell>{tx("auto.k_434e1cb2e6b0")}</TableCell>
                            <TableCell>{tx("auto.k_2723fb0ddcdf")}</TableCell>
                            <TableCell align="right">{tx("auto.k_8edfb81a349f")}</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {loading ? <TableRow>
                                <TableCell colSpan={7} align="center" sx={{
              py: 4
            }}>
                                    <CircularProgress />
                                </TableCell>
                            </TableRow> : contacts.length === 0 ? <TableRow>
                                <TableCell colSpan={7} align="center" sx={{
              py: 4
            }}>
                                    <Typography color="text.secondary">{tx("auto.k_5070251cecc4")}</Typography>
                                </TableCell>
                            </TableRow> : contacts.map(contact => <TableRow key={contact.id || contact.phone} hover>
                                    <TableCell sx={{
              fontFamily: 'monospace',
              fontWeight: 600
            }}>
                                        {contact.phone}
                                    </TableCell>
                                    <TableCell>{contact.profile_name || '—'}</TableCell>
                                    <TableCell>{getLabelChip(contact.label)}</TableCell>
                                    <TableCell>
                                        {contact.last_ctwa_clid ? <Tooltip title={tx("auto.k_e785b4075213", {
                value1: contact.last_ctwa_received_at ? new Date(contact.last_ctwa_received_at).toLocaleString(getCurrentLocale()) : tx("auto.k_b2c702e73c91")
              })}>
                                                <Chip label={tx("auto.k_5ad7cf172cdb")} size="small" color="success" variant="outlined" />
                                            </Tooltip> : <Chip label={tx("auto.k_87e8e1d53a84")} size="small" variant="outlined" />}
                                    </TableCell>
                                    <TableCell>
                                        <Chip label={contact.message_count || 0} size="small" variant="outlined" color="secondary" />
                                    </TableCell>
                                    <TableCell sx={{
              whiteSpace: 'nowrap'
            }}>
                                        {contact.updated_at ? new Date(contact.updated_at).toLocaleDateString(getCurrentLocale()) : '—'}
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title={tx("auto.k_b4f76c3aa21e")}>
                                            <IconButton size="small" onClick={() => openEditDialog(contact)}>
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title={tx("auto.k_3e5e6412e5dd")}>
                                            <IconButton size="small" color="secondary" onClick={() => openConversation(contact)}>
                                                <ChatIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title={tx("auto.k_2d2bbdc2d694")}>
                                            <IconButton size="small" color="error" onClick={() => setDeleteContact(contact)}>

                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>)}
                    </TableBody>
                </Table>
                <TablePagination component="div" count={total} page={page} onPageChange={(_, newPage) => setPage(newPage)} rowsPerPage={rowsPerPage} onRowsPerPageChange={e => {
        setRowsPerPage(parseInt(e.target.value, 10));
        setPage(0);
      }} labelRowsPerPage={tx("auto.k_cbae7baf21a2")} labelDisplayedRows={({
        from,
        to,
        count
      }) => tx("auto.k_dd273d63f7ed", {
        value1: from,
        value2: to,
        value3: count
      })} />

            </TableContainer>

            {/* Edit Dialog */}
            <Dialog open={!!editContact} onClose={() => !saving && setEditContact(null)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
                    <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1
        }}>
                        <LabelIcon color="secondary" />{tx("auto.k_6351670dcbdd")}

          </Box>
                    <IconButton onClick={() => setEditContact(null)} disabled={saving}>
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
                            <Box sx={{
            p: 2,
            bgcolor: 'grey.50',
            borderRadius: 2
          }}>
                                <Typography variant="caption" color="text.secondary">{tx("auto.k_211cce4ca4ef")}</Typography>
                                <Typography variant="h6" fontFamily="monospace">{editContact.phone}</Typography>
                            </Box>

                            <Box sx={{
            p: 2,
            bgcolor: editContact.last_ctwa_clid ? 'rgba(46, 125, 50, 0.08)' : 'grey.50',
            borderRadius: 2
          }}>
                                <Typography variant="caption" color="text.secondary">Click-to-WhatsApp</Typography>
                                <Typography variant="body2" fontWeight={700}>
                                    {editContact.last_ctwa_clid ? tx("auto.k_7703b47ee7b2") : tx("auto.k_d8af21485f4f")}
                                </Typography>
                                {editContact.last_ctwa_clid && <>
                                        <Typography variant="caption" component="div" sx={{
                fontFamily: 'monospace',
                wordBreak: 'break-all',
                mt: 0.5
              }}>
                                            {editContact.last_ctwa_clid}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" component="div">
                                            {editContact.last_ctwa_source_type || 'source'}{editContact.last_ctwa_source_url ? ` • ${editContact.last_ctwa_source_url}` : ''}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" component="div">{tx("auto.k_7ccbdd62be55")}
                  {editContact.last_ctwa_received_at ? new Date(editContact.last_ctwa_received_at).toLocaleString(getCurrentLocale()) : tx("auto.k_b2c702e73c91")}
                                        </Typography>
                                    </>}
                            </Box>

                            <FormControl fullWidth>
                                <Select value={editForm.label} onChange={e => setEditForm({
              ...editForm,
              label: e.target.value
            })} displayEmpty renderValue={v => v || tx("auto.k_d423b992b608")}>

                                    {getLABEL_OPTIONS().map(o => <MenuItem key={o.value} value={o.value}>
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
            <Dialog open={showAddDialog} onClose={() => !addSaving && setShowAddDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
                    <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1
        }}>
                        <AddIcon color="secondary" />{tx("auto.k_858536f1fe74")}

          </Box>
                    <IconButton onClick={() => setShowAddDialog(false)} disabled={addSaving}>
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
                            <Select value={addForm.label} onChange={e => setAddForm({
              ...addForm,
              label: e.target.value
            })} displayEmpty renderValue={v => v || tx("auto.k_54329104ae94")}>

                                {getLABEL_OPTIONS().map(o => <MenuItem key={o.value} value={o.value}>
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

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!deleteContact} onClose={() => !deleting && setDeleteContact(null)}>
                <DialogTitle>{tx("auto.k_107bd07072b8")}</DialogTitle>
                <DialogContent>
                    <Typography>{tx("auto.k_a37f4e636a64")}
            <strong>{deleteContact?.profile_name || deleteContact?.phone}</strong>{tx("auto.k_d14862b0be83")}
          </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{
          mt: 1
        }}>{tx("auto.k_b34b205af566")}

          </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteContact(null)} disabled={deleting}>{tx("auto.k_e776b0209b50")}</Button>
                    <Button variant="contained" color="error" onClick={handleDeleteContact} disabled={deleting} startIcon={deleting ? <CircularProgress size={16} /> : <DeleteIcon />}>

                        {deleting ? tx("auto.k_8e2d11bd1ef2") : tx("auto.k_2d2bbdc2d694")}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>;
};
export default TenantContacts;
