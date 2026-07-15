import React, { useState, useEffect, useCallback } from 'react';
import { Box, Card, CardContent, Typography, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton, Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, FormControl, InputLabel, MenuItem, CircularProgress, Alert, Tooltip, Tab, Tabs, Paper } from '@mui/material';
import Select from '../../components/Form/AccessibleSelect';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon, Refresh as RefreshIcon, Sync as SyncIcon, ContentCopy as CopyIcon, CloudUpload as CloudUploadIcon } from '@mui/icons-material';
import api from '../../api';
import { tx } from "../../i18n/tx";
import { buildMetaTemplateComponents, createTemplateDraft, getTemplateCategoryLabel } from './templateConfig';
import { TemplateQualityChip, TemplateStatusChip } from './TemplatePresentation';
import { getCurrentLocale } from "../../utils/locale";
const AdminTemplates = () => {
  const [templates, setTemplates] = useState([]);
  const [metaTemplates, setMetaTemplates] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [saving, setSaving] = useState(false);
  const [submittingToMeta, setSubmittingToMeta] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [tabValue, setTabValue] = useState(0);
  const [formData, setFormData] = useState(createTemplateDraft());
  const fetchTenants = useCallback(async () => {
    try {
      const data = await api.getTenants();
      setTenants(data);
      if (data.length > 0) {
        setSelectedTenantId(data[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch tenants:', err);
      setError(err.message);
    }
  }, []);
  const fetchTemplates = useCallback(async () => {
    if (!selectedTenantId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await api.getAdminTemplates(selectedTenantId);
      setTemplates(data || []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedTenantId]);
  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);
  useEffect(() => {
    if (selectedTenantId) {
      fetchTemplates();
    }
  }, [selectedTenantId, fetchTemplates]);
  const syncFromMeta = async () => {
    if (!selectedTenantId) return;
    try {
      setSyncing(true);
      setError(null);
      const result = await api.syncTemplatesFromMeta(selectedTenantId);
      setMetaTemplates(result.templates || []);
      // Refresh templates list after sync - they're now in database
      fetchTemplates();
      setSuccess(tx("auto.k_b2620e5fdce4", {
        value1: result.synced || 0,
        value2: result.created || 0,
        value3: result.updated || 0
      }));
    } catch (err) {
      console.error('Failed to sync from Meta:', err);
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };
  const importTemplate = async metaTemplate => {
    if (!selectedTenantId) return;
    try {
      await api.importTemplateFromMeta(selectedTenantId, metaTemplate);
      setSuccess(tx("auto.k_92a59417096b", {
        value1: metaTemplate.name
      }));
      fetchTemplates();
    } catch (err) {
      setError(err.message);
    }
  };
  const handleOpenDialog = (template = null) => {
    setSelectedTemplate(template);
    setFormData(createTemplateDraft(template));
    setDialogOpen(true);
  };
  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedTemplate(null);
  };
  const handleSave = async () => {
    if (!formData.name || !formData.body) {
      setError(tx("auto.k_ac7675859baf"));
      return;
    }
    try {
      setSaving(true);
      setError(null);
      if (selectedTemplate) {
        await api.updateAdminTemplate(selectedTenantId, selectedTemplate.id, formData);
      } else {
        await api.createAdminTemplate(selectedTenantId, formData);
      }
      handleCloseDialog();
      fetchTemplates();
      setSuccess(selectedTemplate ? tx("auto.k_ff8c4b3fe86a") : tx("auto.k_5bc3eb531111"));
    } catch (err) {
      console.error('Failed to save template:', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  const handleDelete = async () => {
    if (!selectedTemplate) return;
    try {
      setSaving(true);
      await api.deleteAdminTemplate(selectedTenantId, selectedTemplate.id);
      setDeleteDialogOpen(false);
      setSelectedTemplate(null);
      fetchTemplates();
      setSuccess(tx("auto.k_bbd60396437c"));
    } catch (err) {
      console.error('Failed to delete template:', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  const openDeleteDialog = template => {
    setSelectedTemplate(template);
    setDeleteDialogOpen(true);
  };

  const handleSubmitToMeta = async (data = null) => {
    const templateData = data || formData;
    if (!templateData.name || !templateData.body) {
      setError(tx("auto.k_ac7675859baf"));
      return;
    }
    try {
      setSubmittingToMeta(true);
      setError(null);
      const components = buildMetaTemplateComponents(templateData);
      await api.createMetaTemplate(selectedTenantId, {
        name: templateData.name,
        language: templateData.language || 'ar',
        category: templateData.category || 'UTILITY',
        parameter_format: 'positional',
        components
      });
      handleCloseDialog();
      setSuccess(tx("auto.k_2bcf4d926fe5", {
        value1: templateData.name
      }));

      // Auto-sync to pull the new template with its meta_template_id
      try {
        await api.syncTemplatesFromMeta(selectedTenantId);
      } catch (_) {/* silent */}
      fetchTemplates();
    } catch (err) {
      console.error('Failed to submit template to Meta:', err);
      setError(err.message || tx("auto.k_a2f2f6c8514a"));
    } finally {
      setSubmittingToMeta(false);
    }
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
                    <Typography variant="h4" component="h1" fontWeight={700} gutterBottom>{tx("auto.k_7ff4c896ae19")}

          </Typography>
                    <Typography variant="body2" color="text.secondary">{tx("auto.k_267095c0eeaf")}

          </Typography>
                </Box>
                <Box sx={{
        display: 'flex',
        gap: 2
      }}>
                    <FormControl size="small" sx={{
          minWidth: {
            xs: 140,
            md: 200
          }
        }}>
                        <InputLabel>{tx("auto.k_e9df516899c6")}</InputLabel>
                        <Select value={selectedTenantId} label={tx("auto.k_e9df516899c6")} onChange={e => setSelectedTenantId(e.target.value)}>

                            {tenants.map(tenant => <MenuItem key={tenant.id} value={tenant.id}>
                                    {tenant.name}
                                </MenuItem>)}
                        </Select>
                    </FormControl>
                </Box>
            </Box>

            {error && <Alert severity="error" sx={{
      mb: 3
    }} onClose={() => setError(null)}>
                    {error}
                </Alert>}

            {success && <Alert severity="success" sx={{
      mb: 3
    }} onClose={() => setSuccess(null)}>
                    {success}
                </Alert>}

            {/* Action Buttons */}
            <Box sx={{
      display: 'flex',
      gap: 2,
      mb: 3
    }}>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenDialog()} disabled={!selectedTenantId}>{tx("auto.k_5c77b8c820e0")}


        </Button>
                <Button variant="outlined" startIcon={syncing ? <CircularProgress size={20} /> : <SyncIcon />} onClick={syncFromMeta} disabled={!selectedTenantId || syncing}>{tx("auto.k_c9fb11dbbc3d")}


        </Button>
                <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchTemplates} disabled={loading}>{tx("auto.k_4309a75e6882")}


        </Button>
            </Box>

            {/* Tabs */}
            <Paper sx={{
      mb: 3
    }}>
                <Tabs value={tabValue} onChange={(e, v) => setTabValue(v)}>
                    <Tab label={tx("auto.k_b0c35a0e6e1b", {
          value1: templates.length
        })} />
                    <Tab label={tx("auto.k_65f7a8abdee4", {
          value1: metaTemplates.length
        })} />
                </Tabs>
            </Paper>

            {/* Local Templates */}
            {tabValue === 0 && <Card elevation={2}>
                    {loading ? <Box sx={{
        p: 4,
        textAlign: 'center'
      }}>
                            <CircularProgress />
                        </Box> : templates.length === 0 ? <Box sx={{
        p: 4,
        textAlign: 'center',
        color: 'text.secondary'
      }}>
                            <Typography variant="h6" component="p" gutterBottom>{tx("auto.k_8cdc5c893daa")}</Typography>
                            <Typography variant="body2">
                                {selectedTenantId ? tx("auto.k_14c062b8dbf2") : tx("auto.k_9044401eb033")}
                            </Typography>
                        </Box> : <TableContainer sx={{
        overflowX: 'auto'
      }}>
                            <Table sx={{ minWidth: 1040 }}>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>{tx("auto.k_0a92494ea1eb")}</TableCell>
                                        <TableCell>{tx("auto.k_59de6a8f17f5")}</TableCell>
                                        <TableCell>{tx("auto.k_d76522a03537")}</TableCell>
                                        <TableCell>{tx("auto.k_d6370401145d")}</TableCell>
                                        <TableCell>{tx("auto.k_a3035054d6c1")}</TableCell>
                                        <TableCell>{tx("auto.k_ab6343bb6a44")}</TableCell>
                                        <TableCell>{tx("auto.k_070d26e18efd")}</TableCell>
                                        <TableCell align="center">{tx("auto.k_732b0b6afc30")}</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {templates.map(template => <TableRow key={template.id} hover>
                                            <TableCell sx={{ minWidth: 190 }}>
                                                <Typography fontWeight={500} sx={{ overflowWrap: 'anywhere' }}>{template.name}</Typography>
                                                <Typography variant="caption" color="text.secondary" sx={{
                  display: 'block',
                  maxWidth: 300,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                                                    {template.body}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>{getTemplateCategoryLabel(template.category)}</TableCell>
                                            <TableCell><Chip label={template.language?.toUpperCase()} size="small" variant="outlined" /></TableCell>
                                            <TableCell><TemplateStatusChip status={template.status} /></TableCell>
                                            <TableCell><TemplateQualityChip qualityScore={template.quality_score} /></TableCell>
                                            <TableCell>
                                                <Chip label={template.parameter_format === 'named' ? tx("auto.k_790fc61f2706") : tx("auto.k_b30e373c4eb3")} size="small" color={template.parameter_format === 'named' ? 'primary' : 'default'} variant="outlined" />

                                            </TableCell>
                                            <TableCell>
                                                {new Date(template.created_at).toLocaleDateString(getCurrentLocale())}
                                            </TableCell>
                                            <TableCell align="center">
                                                <Box sx={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: 0.5
                }}>
                                                    {!template.meta_template_id && template.status === 'draft' && <Tooltip title={tx("auto.k_e93eeb4f4787")}>
                                                            <IconButton size="small" color="primary" aria-label={tx("auto.k_e93eeb4f4787")} onClick={() => handleSubmitToMeta(template)} disabled={submittingToMeta}>

                                                                <CloudUploadIcon fontSize="small" />
                                                            </IconButton>
                                                        </Tooltip>}
                                                    <Tooltip title={tx("auto.k_b4f76c3aa21e")}>
                                                        <IconButton size="small" aria-label={tx("auto.k_b4f76c3aa21e")} onClick={() => handleOpenDialog(template)}>

                                                            <EditIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                    <Tooltip title={tx("auto.k_2d2bbdc2d694")}>
                                                        <IconButton size="small" color="error" aria-label={tx("auto.k_2d2bbdc2d694")} onClick={() => openDeleteDialog(template)}>

                                                            <DeleteIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                </Box>
                                            </TableCell>
                                        </TableRow>)}
                                </TableBody>
                            </Table>
                        </TableContainer>}
                </Card>}

            {/* Meta Templates */}
            {tabValue === 1 && <Card elevation={2}>
                    {metaTemplates.length === 0 ? <Box sx={{
        p: 4,
        textAlign: 'center',
        color: 'text.secondary'
      }}>
                            <Typography variant="h6" component="p" gutterBottom>{tx("auto.k_3260f9e2e9f5")}</Typography>
                            <Typography variant="body2">{tx("auto.k_da712a35c9a5")}

          </Typography>
                        </Box> : <TableContainer sx={{
        overflowX: 'auto'
      }}>
                            <Table sx={{ minWidth: 760 }}>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>{tx("auto.k_0a92494ea1eb")}</TableCell>
                                        <TableCell>{tx("auto.k_59de6a8f17f5")}</TableCell>
                                        <TableCell>{tx("auto.k_d76522a03537")}</TableCell>
                                        <TableCell>{tx("auto.k_d6370401145d")}</TableCell>
                                        <TableCell align="center">{tx("auto.k_732b0b6afc30")}</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {metaTemplates.map((template, idx) => <TableRow key={template.id || idx} hover>
                                            <TableCell sx={{ minWidth: 190 }}>
                                                <Typography fontWeight={500} sx={{ overflowWrap: 'anywhere' }}>{template.name}</Typography>
                                            </TableCell>
                                            <TableCell>{getTemplateCategoryLabel(template.category)}</TableCell>
                                            <TableCell>{template.language?.toUpperCase()}</TableCell>
                                            <TableCell><TemplateStatusChip status={template.status} /></TableCell>
                                            <TableCell align="center">
                                                <Button size="small" variant="outlined" onClick={() => importTemplate(template)}>{tx("auto.k_5e029fef2ea5")}


                  </Button>
                                            </TableCell>
                                        </TableRow>)}
                                </TableBody>
                            </Table>
                        </TableContainer>}
                </Card>}

            {/* Create/Edit Dialog */}
            <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth slotProps={{ paper: { 'aria-label': selectedTemplate ? tx("auto.k_d175d9e8ca42") : tx("auto.k_551325b3d0d0") } }}>
                <DialogTitle>
                    {selectedTemplate ? tx("auto.k_d175d9e8ca42") : tx("auto.k_551325b3d0d0")}
                </DialogTitle>
                <DialogContent dividers>
                    <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          pt: 1
        }}>
                        <TextField label={tx("auto.k_658266a2fac1")} value={formData.name} onChange={e => setFormData({
            ...formData,
            name: e.target.value
          })} fullWidth required placeholder={tx("auto.k_4725f329f16f")} />


                        <Box sx={{
            display: 'flex',
            gap: 2
          }}>
                            <FormControl fullWidth>
                                <InputLabel>{tx("auto.k_59de6a8f17f5")}</InputLabel>
                                <Select value={formData.category} label={tx("auto.k_59de6a8f17f5")} onChange={e => setFormData({
                ...formData,
                category: e.target.value
              })}>

                                    <MenuItem value="UTILITY">{tx("auto.k_24db4b5a9540")}</MenuItem>
                                    <MenuItem value="MARKETING">{tx("auto.k_c0ce6624f02c")}</MenuItem>
                                    <MenuItem value="AUTHENTICATION">{tx("auto.k_fe79250b3ff2")}</MenuItem>
                                </Select>
                            </FormControl>

                            <FormControl fullWidth>
                                <InputLabel>{tx("auto.k_d76522a03537")}</InputLabel>
                                <Select value={formData.language} label={tx("auto.k_d76522a03537")} onChange={e => setFormData({
                ...formData,
                language: e.target.value
              })}>

                                    <MenuItem value="ar">{tx("auto.k_9970632f55af")}</MenuItem>
                                    <MenuItem value="en">{tx("auto.k_10c4fe323fdb")}</MenuItem>
                                </Select>
                            </FormControl>
                        </Box>

                        <FormControl fullWidth>
                            <InputLabel>{tx("auto.k_1c13ab704a81")}</InputLabel>
                            <Select value={formData.header_type} label={tx("auto.k_1c13ab704a81")} onChange={e => setFormData({
              ...formData,
              header_type: e.target.value
            })}>

                                <MenuItem value="none">{tx("auto.k_00d9b9d2047a")}</MenuItem>
                                <MenuItem value="text">{tx("auto.k_4ddc2135457a")}</MenuItem>
                                <MenuItem value="image">{tx("auto.k_b941956874fe")}</MenuItem>
                                <MenuItem value="video">{tx("auto.k_17daa024f2eb")}</MenuItem>
                                <MenuItem value="document">{tx("auto.k_d9381107732e")}</MenuItem>
                                <MenuItem value="location">{tx("auto.k_5be2764392bc")}</MenuItem>
                                <MenuItem value="gif">GIF</MenuItem>
                            </Select>
                        </FormControl>

                        {formData.header_type !== 'none' && <TextField label={formData.header_type === 'text' ? tx("auto.k_c9581751d501") : tx("auto.k_15991c96809e")} value={formData.header_content} onChange={e => setFormData({
            ...formData,
            header_content: e.target.value
          })} fullWidth />}

                        <TextField label={tx("auto.k_d40056b85e0a")} value={formData.body} onChange={e => setFormData({
            ...formData,
            body: e.target.value
          })} fullWidth required multiline rows={4} placeholder={tx("auto.k_47be40921ba7")} helperText={tx("auto.k_1cf41fa40ac1")} />


                        <TextField label={tx("auto.k_53290c5a76fb")} value={formData.footer} onChange={e => setFormData({
            ...formData,
            footer: e.target.value
          })} fullWidth placeholder={tx("auto.k_a529f2799f98")} />

                    </Box>
                </DialogContent>
                <DialogActions sx={{
        justifyContent: 'space-between'
      }}>
                    <Button onClick={handleCloseDialog}>{tx("auto.k_e776b0209b50")}</Button>
                    <Box sx={{
          display: 'flex',
          gap: 1
        }}>
                        <Button variant="outlined" onClick={handleSave} disabled={saving || submittingToMeta || !formData.name || !formData.body}>

                            {saving ? <CircularProgress size={24} /> : selectedTemplate ? tx("auto.k_33081e44cb7c") : tx("auto.k_d3d271a99ec6")}
                        </Button>
                        <Button variant="contained" startIcon={submittingToMeta ? <CircularProgress size={20} /> : <CloudUploadIcon />} onClick={() => handleSubmitToMeta()} disabled={saving || submittingToMeta || !formData.name || !formData.body}>

                            {submittingToMeta ? tx("auto.k_1f75aaa9f053") : tx("auto.k_e93eeb4f4787")}
                        </Button>
                    </Box>
                </DialogActions>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} slotProps={{ paper: { 'aria-label': tx("auto.k_107bd07072b8") } }}>
                <DialogTitle>{tx("auto.k_107bd07072b8")}</DialogTitle>
                <DialogContent>
                    <Typography>{tx("auto.k_28f5fea376e6")}
            {selectedTemplate?.name}{tx("auto.k_35d364226bb5")}
          </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteDialogOpen(false)}>{tx("auto.k_e776b0209b50")}</Button>
                    <Button variant="contained" color="error" onClick={handleDelete} disabled={saving}>

                        {saving ? <CircularProgress size={24} /> : tx("auto.k_2d2bbdc2d694")}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>;
};
export default AdminTemplates;
