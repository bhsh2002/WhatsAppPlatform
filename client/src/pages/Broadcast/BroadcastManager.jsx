import React, { useState, useEffect, useMemo } from 'react';
import { Box, Paper, Typography, TextField, Button, FormControl, InputLabel, Select, MenuItem, CircularProgress, Alert, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Stepper, Step, StepLabel, Card, CardContent, Divider, LinearProgress, ToggleButton, ToggleButtonGroup, Tooltip, Checkbox, InputAdornment, Tabs, Tab } from '@mui/material';
import { Campaign as CampaignIcon, Send as SendIcon, People as PeopleIcon, CheckCircle as SuccessIcon, Error as ErrorIcon, TextFields as StaticIcon, Person as ContactIcon, Search as SearchIcon, SelectAll as SelectAllIcon, AttachFile as AttachFileIcon } from '@mui/icons-material';
import api from '../../api';
import { tx } from "../../i18n/tx";
const getCONTACT_FIELDS = () => [{
  value: 'profile_name',
  label: tx("auto.k_28fc609bc67b"),
  icon: '👤'
}, {
  value: 'phone',
  label: tx("auto.k_211cce4ca4ef"),
  icon: '📱'
}, {
  value: 'label',
  label: tx("auto.k_7c75fec5c0f8"),
  icon: '🏷️'
}, {
  value: 'notes',
  label: tx("auto.k_b172fc1d3b6d"),
  icon: '📝'
}];
const MEDIA_HEADER_TYPES = ['image', 'video', 'document', 'audio'];
const MEDIA_ACCEPT = {
  image: 'image/jpeg,image/png,image/webp',
  video: 'video/mp4,video/3gpp',
  document: '.pdf,.doc,.docx,.xls,.xlsx,.txt',
  audio: 'audio/aac,audio/mp4,audio/mpeg,audio/amr,audio/ogg'
};
const getMEDIA_LABEL = () => ({
  image: tx("auto.k_b941956874fe"),
  video: tx("auto.k_17daa024f2eb"),
  document: tx("auto.k_d9381107732e"),
  audio: tx("auto.k_06d9927a57ae")
});
function extractVariables(bodyText) {
  if (!bodyText) return [];
  const matches = bodyText.match(/\{\{(\d+)\}\}/g);
  if (!matches) return [];
  const nums = [...new Set(matches.map(m => parseInt(m.replace(/[{}]/g, ''))))];
  return nums.sort((a, b) => a - b);
}
function previewBody(bodyText, variableConfigs) {
  if (!bodyText) return '';
  return bodyText.replace(/\{\{(\d+)\}\}/g, (match, num) => {
    const config = variableConfigs[parseInt(num)];
    if (!config) return match;
    if (config.source === 'static') return config.value || match;
    if (config.source === 'contact') {
      const field = getCONTACT_FIELDS().find(f => f.value === config.field);
      return `[${field?.label || config.field}]`;
    }
    return match;
  });
}
const BroadcastManager = () => {
  const [activeStep, setActiveStep] = useState(0);
  const [tenants, setTenants] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateLanguage, setTemplateLanguage] = useState('ar');
  const [variableConfigs, setVariableConfigs] = useState({});

  // Recipients
  const [recipientsTab, setRecipientsTab] = useState(0); // 0=contacts, 1=manual
  const [recipientsText, setRecipientsText] = useState('');
  const [contacts, setContacts] = useState([]);
  const [selectedContactIds, setSelectedContactIds] = useState(new Set());
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [labelFilter, setLabelFilter] = useState('');
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [progressPct, setProgressPct] = useState(0);
  const variables = useMemo(() => extractVariables(selectedTemplate?.body), [selectedTemplate]);
  const headerMediaType = selectedTemplate?.header_type?.toLowerCase?.();
  const hasMediaHeader = MEDIA_HEADER_TYPES.includes(headerMediaType);
  const allVariablesFilled = useMemo(() => {
    const mediaConfig = variableConfigs.header_MEDIA_LINK;
    const mediaReady = !hasMediaHeader || mediaConfig?.source === 'upload' && Boolean(mediaConfig.file) || mediaConfig?.source === 'static' && /^https?:\/\//i.test(mediaConfig.value || '') || mediaConfig?.source === 'contact' && Boolean(mediaConfig.field);
    if (!mediaReady) return false;
    if (variables.length === 0) return true;
    return variables.every(v => {
      const config = variableConfigs[v];
      if (!config) return false;
      if (config.source === 'static') return config.value?.trim();
      if (config.source === 'contact') return !!config.field;
      return false;
    });
  }, [hasMediaHeader, variables, variableConfigs]);

  // Unique labels from contacts for filtering
  const uniqueLabels = useMemo(() => {
    const labels = contacts.map(c => c.label).filter(Boolean);
    return [...new Set(labels)].sort();
  }, [contacts]);

  // Filtered contacts based on search and label filter
  const filteredContacts = useMemo(() => {
    return contacts.filter(c => {
      const matchesSearch = !contactSearch || (c.profile_name || '').toLowerCase().includes(contactSearch.toLowerCase()) || (c.phone || '').includes(contactSearch);
      const matchesLabel = !labelFilter || c.label === labelFilter;
      return matchesSearch && matchesLabel;
    });
  }, [contacts, contactSearch, labelFilter]);

  // Merge selected contacts + manual numbers into unique recipients
  const manualRecipients = recipientsText.split(/[\n,;]+/).map(r => r.replace(/[^0-9+]/g, '').trim()).filter(r => r.length >= 8);
  const selectedContactPhones = contacts.filter(c => selectedContactIds.has(c.id)).map(c => c.phone);
  const uniqueRecipients = [...new Set([...selectedContactPhones, ...manualRecipients])];
  const selectedTenant = tenants.find(t => t.id === parseInt(selectedTenantId));
  const canProceedStep0 = selectedTenantId && selectedTemplate && allVariablesFilled;
  const canProceedStep1 = uniqueRecipients.length > 0 && uniqueRecipients.length <= 500;

  // Load tenants
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

  // Load templates + contacts when tenant changes
  useEffect(() => {
    if (!selectedTenantId) {
      setTemplates([]);
      setSelectedTemplate(null);
      setContacts([]);
      setSelectedContactIds(new Set());
      return;
    }
    const load = async () => {
      try {
        const data = await api.getAdminTemplates(selectedTenantId);
        setTemplates(data || []);
      } catch (_err) {
        setTemplates([]);
      }
      try {
        setContactsLoading(true);
        const data = await api.getContacts({
          tenant_id: selectedTenantId
        });
        setContacts(data.contacts || data || []);
      } catch (_err) {
        setContacts([]);
      } finally {
        setContactsLoading(false);
      }
    };
    load();
    setSelectedContactIds(new Set());
  }, [selectedTenantId]);

  // Reset variable configs when template changes
  useEffect(() => {
    const newConfigs = {};
    if (hasMediaHeader) {
      newConfigs.header_MEDIA_LINK = {
        source: 'upload',
        value: '',
        file: null,
        field: '',
        fallback: ''
      };
    }
    variables.forEach(v => {
      newConfigs[v] = {
        source: 'static',
        value: '',
        field: '',
        fallback: ''
      };
    });
    setVariableConfigs(newConfigs);
  }, [selectedTemplate, hasMediaHeader, variables]);

  // Contact selection handlers
  const handleToggleContact = contactId => {
    setSelectedContactIds(prev => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);else next.add(contactId);
      return next;
    });
  };
  const handleSelectAll = () => {
    const allFilteredIds = filteredContacts.map(c => c.id);
    setSelectedContactIds(prev => {
      const next = new Set(prev);
      allFilteredIds.forEach(id => next.add(id));
      return next;
    });
  };
  const handleDeselectAll = () => {
    const allFilteredIds = new Set(filteredContacts.map(c => c.id));
    setSelectedContactIds(prev => {
      const next = new Set(prev);
      allFilteredIds.forEach(id => next.delete(id));
      return next;
    });
  };
  const handleSelectByLabel = label => {
    const labelContactIds = contacts.filter(c => c.label === label).map(c => c.id);
    setSelectedContactIds(prev => {
      const next = new Set(prev);
      labelContactIds.forEach(id => next.add(id));
      return next;
    });
  };
  const allFilteredSelected = filteredContacts.length > 0 && filteredContacts.every(c => selectedContactIds.has(c.id));
  const handleConfigChange = (varNum, key, value) => {
    setVariableConfigs(prev => ({
      ...prev,
      [varNum]: {
        ...prev[varNum],
        [key]: value
      }
    }));
  };
  const buildHeaderMediaParameter = async config => {
    if (config.source === 'upload') {
      const uploaded = await api.uploadAdminMediaToMeta(selectedTenantId, config.file);
      const media = {
        id: uploaded.id
      };
      if (headerMediaType === 'document' && uploaded.filename) media.filename = uploaded.filename;
      return {
        type: headerMediaType,
        [headerMediaType]: media
      };
    }
    const media = {
      link: config.value?.trim() || ''
    };
    if (headerMediaType === 'document') media.filename = selectedTemplate?.name ? `${selectedTemplate.name}.pdf` : undefined;
    return {
      type: headerMediaType,
      [headerMediaType]: media
    };
  };
  const buildPayload = async () => {
    const hasContactSource = Object.values(variableConfigs).some(c => c?.source === 'contact');
    const payload = {
      tenant_id: parseInt(selectedTenantId),
      recipients: uniqueRecipients,
      template_name: selectedTemplate.name,
      template_language: templateLanguage
    };
    const staticComponents = [];
    if (hasMediaHeader) {
      const mediaConfig = variableConfigs.header_MEDIA_LINK;
      if (mediaConfig?.source === 'contact') {
        payload.variable_mapping = [{
          source: 'contact',
          field: mediaConfig.field,
          fallback: mediaConfig.fallback || '',
          section: 'header',
          index: 'MEDIA_LINK',
          media_type: headerMediaType,
          media_source: 'contact_url'
        }];
      } else if (mediaConfig) {
        staticComponents.push({
          type: 'header',
          parameters: [await buildHeaderMediaParameter(mediaConfig)]
        });
      }
    }
    if (variables.length > 0) {
      if (hasContactSource) {
        payload.variable_mapping = [...(payload.variable_mapping || []), ...variables.map(v => {
          const config = variableConfigs[v];
          if (config.source === 'contact') {
            return {
              source: 'contact',
              field: config.field,
              fallback: config.fallback || ''
            };
          }
          return {
            source: 'static',
            value: config.value || ''
          };
        })];
        if (staticComponents.length > 0) {
          payload.template_params = staticComponents;
        }
      } else {
        payload.template_params = [...staticComponents, {
          type: 'body',
          parameters: variables.map(v => ({
            type: 'text',
            text: variableConfigs[v]?.value || ''
          }))
        }];
      }
    } else if (staticComponents.length > 0) {
      payload.template_params = staticComponents;
    }
    return payload;
  };
  const renderMediaHeaderInput = () => {
    const config = variableConfigs.header_MEDIA_LINK || {
      source: 'upload',
      value: '',
      file: null,
      field: '',
      fallback: ''
    };
    return <Card variant="outlined" sx={{
      mb: 2,
      p: 2
    }}>
                <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        mb: 1.5
      }}>
                    <Chip label={tx("auto.k_ce4f7438a89f", {
          value1: getMEDIA_LABEL()[headerMediaType] || tx("auto.k_e68d8fac0b6f")
        })} size="small" color="secondary" />
                    <ToggleButtonGroup value={config.source} exclusive onChange={(_, val) => val && handleConfigChange('header_MEDIA_LINK', 'source', val)} size="small">
                        <ToggleButton value="upload">
                            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5
            }}><AttachFileIcon fontSize="small" /><span>{tx("auto.k_94d3b7396486")}</span></Box>
                        </ToggleButton>
                        <ToggleButton value="static">
                            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5
            }}><StaticIcon fontSize="small" /><span>{tx("auto.k_94f0482663cf")}</span></Box>
                        </ToggleButton>
                        <ToggleButton value="contact">
                            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5
            }}><ContactIcon fontSize="small" /><span>{tx("auto.k_67719bfce04d")}</span></Box>
                        </ToggleButton>
                    </ToggleButtonGroup>
                </Box>

                {config.source === 'upload' && <Button variant="outlined" component="label" startIcon={<AttachFileIcon />} fullWidth color={config.file ? 'success' : 'primary'} sx={{
        justifyContent: 'flex-start',
        textTransform: 'none'
      }}>

                        <Box sx={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
                            {config.file?.name || tx("auto.k_0e55291e5349", {
            value1: getMEDIA_LABEL()[headerMediaType] || tx("auto.k_ae56c3a546e8")
          })}
                        </Box>
                        <input type="file" hidden accept={MEDIA_ACCEPT[headerMediaType] || '*/*'} onChange={e => handleConfigChange('header_MEDIA_LINK', 'file', e.target.files?.[0] || null)} />

                    </Button>}

                {config.source === 'static' && <TextField label={tx("auto.k_8bdf1b0ed3e1", {
        value1: getMEDIA_LABEL()[headerMediaType] || tx("auto.k_b9755ec895c4")
      })} value={config.value} onChange={e => handleConfigChange('header_MEDIA_LINK', 'value', e.target.value)} fullWidth size="small" required error={Boolean(config.value) && !/^https?:\/\//i.test(config.value)} helperText={tx("auto.k_18c735391bf9")} />}

                {config.source === 'contact' && <Box sx={{
        display: 'flex',
        gap: 2
      }}>
                        <FormControl size="small" sx={{
          flex: 1
        }}>
                            <InputLabel>{tx("auto.k_a63d4f7fb41e")}</InputLabel>
                            <Select value={config.field} label={tx("auto.k_a63d4f7fb41e")} onChange={e => handleConfigChange('header_MEDIA_LINK', 'field', e.target.value)}>
                                {getCONTACT_FIELDS().map(f => <MenuItem key={f.value} value={f.value}>{f.icon} {f.label}</MenuItem>)}
                            </Select>
                        </FormControl>
                        <TextField label={tx("auto.k_f473cee84052")} value={config.fallback} onChange={e => handleConfigChange('header_MEDIA_LINK', 'fallback', e.target.value)} size="small" sx={{
          flex: 1
        }} helperText={tx("auto.k_8caeb8e89d11")} />
                    </Box>}
            </Card>;
  };
  const handleSend = async () => {
    if (!selectedTenantId || !selectedTemplate || uniqueRecipients.length === 0) return;
    try {
      setSending(true);
      setError(null);
      setResults(null);
      setProgressPct(0);
      const data = await api.broadcastMessage(await buildPayload());
      if (data.job_id) {
        pollJobStatus(data.job_id);
      } else {
        setResults(data);
        setActiveStep(3);
        setSending(false);
      }
    } catch (err) {
      setError(err.message);
      setSending(false);
    }
  };
  const pollJobStatus = id => {
    const interval = setInterval(async () => {
      try {
        const job = await api.getBroadcastJob(id);
        setProgressPct(job.progress_pct || 0);
        if (job.status === 'completed') {
          clearInterval(interval);
          const parsedResults = job.results ? typeof job.results === 'string' ? JSON.parse(job.results) : job.results : [];
          setResults({
            total: job.total_recipients,
            sent: job.sent_count,
            failed: job.failed_count,
            results: parsedResults
          });
          setActiveStep(3);
          setSending(false);
        } else if (job.status === 'failed') {
          clearInterval(interval);
          setError(job.error || tx("auto.k_e5ac673f50a7"));
          setSending(false);
        }
      } catch {

        // Continue polling on transient errors
      }
    }, 1500);
  };
  const handleReset = () => {
    setActiveStep(0);
    setSelectedTenantId('');
    setSelectedTemplate(null);
    setRecipientsText('');
    setResults(null);
    setError(null);
    setVariableConfigs({});
    setSelectedContactIds(new Set());
    setContactSearch('');
    setLabelFilter('');
    setProgressPct(0);
  };
  const steps = [tx("auto.k_3975a5ce4681"), tx("auto.k_5cadd95cd0c6"), tx("auto.k_7f4f8c12c9c6"), tx("auto.k_4b4f3b3d2948")];
  return <Box sx={{
    p: {
      xs: 1.5,
      md: 3
    }
  }}>
            <Box sx={{
      mb: 4
    }}>
                <Typography variant="h4" fontWeight={700} gutterBottom sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1
      }}>
                    <CampaignIcon fontSize="large" color="primary" />{tx("auto.k_0bf69f9a30fb")}

        </Typography>
                <Typography variant="body2" color="text.secondary">{tx("auto.k_228131112f00")}

        </Typography>
            </Box>

            <Paper sx={{
      p: 3,
      mb: 3
    }}>
                <Stepper activeStep={activeStep} alternativeLabel>
                    {steps.map(label => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
                </Stepper>
            </Paper>

            {error && <Alert severity="error" sx={{
      mb: 3
    }} onClose={() => setError(null)}>{error}</Alert>}

            {/* ========== Step 0: Select tenant, template & variables ========== */}
            {activeStep === 0 && <Paper sx={{
      p: 3
    }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>{tx("auto.k_6271957673f9")}</Typography>
                    <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        mt: 2
      }}>
                        <FormControl fullWidth>
                            <InputLabel>{tx("auto.k_8adba91e1d87")}</InputLabel>
                            <Select value={selectedTenantId} label={tx("auto.k_8adba91e1d87")} onChange={e => {
            setSelectedTenantId(e.target.value);
            setSelectedTemplate(null);
            setVariableConfigs({});
          }}>
                                {tenants.map(t => <MenuItem key={t.id} value={t.id}>{t.name}{tx("auto.k_6a5627a22dce")}{t.credits?.toLocaleString() || 0}</MenuItem>)}
                            </Select>
                        </FormControl>

                        {templates.length > 0 && <FormControl fullWidth>
                                <InputLabel>{tx("auto.k_4f4ec9f764bd")}</InputLabel>
                                <Select value={selectedTemplate?.id || ''} label={tx("auto.k_4f4ec9f764bd")} onChange={e => {
            setSelectedTemplate(templates.find(t => t.id === e.target.value));
          }}>
                                    {templates.filter(t => t.status === 'approved').map(t => <MenuItem key={t.id} value={t.id}>{t.name} ({t.language || 'ar'})</MenuItem>)}
                                </Select>
                            </FormControl>}

                        {selectedTemplate && <Card variant="outlined">
                                <CardContent>
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>{tx("auto.k_7aa6f6121247")}</Typography>
                                    <Typography variant="body1" sx={{
              whiteSpace: 'pre-wrap',
              bgcolor: 'grey.50',
              p: 2,
              borderRadius: 1,
              direction: 'auto'
            }}>
                                        {selectedTemplate.body || tx("auto.k_614dbf701024")}
                                    </Typography>
                                </CardContent>
                            </Card>}

                        {hasMediaHeader && <Box>
                                <Alert severity="info" sx={{
            mb: 2
          }}>{tx("auto.k_e1e8f51ee087")}
              {getMEDIA_LABEL()[headerMediaType] || tx("auto.k_e68d8fac0b6f")}{tx("auto.k_a623e90be45f")}
            </Alert>
                                {renderMediaHeaderInput()}
                            </Box>}

                        {variables.length > 0 && <Box>
                                <Alert severity="info" sx={{
            mb: 2
          }}>{tx("auto.k_ea1a3cdc0174")}
              {variables.length}{tx("auto.k_44f8e8b990e9")}
            </Alert>
                                {variables.map(varNum => {
            const config = variableConfigs[varNum] || {
              source: 'static',
              value: '',
              field: '',
              fallback: ''
            };
            return <Card key={varNum} variant="outlined" sx={{
              mb: 2,
              p: 2
            }}>
                                            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                mb: 1.5
              }}>
                                                <Chip label={`{{${varNum}}}`} size="small" color="primary" />
                                                <ToggleButtonGroup value={config.source} exclusive onChange={(_, val) => val && handleConfigChange(varNum, 'source', val)} size="small">
                                                    <ToggleButton value="static">
                                                        <Tooltip title={tx("auto.k_e309b1c5b723")}>
                                                            <Box sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5
                      }}><StaticIcon fontSize="small" /><span>{tx("auto.k_bf448471f8b5")}</span></Box>
                                                        </Tooltip>
                                                    </ToggleButton>
                                                    <ToggleButton value="contact">
                                                        <Tooltip title={tx("auto.k_9e000a8ce423")}>
                                                            <Box sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5
                      }}><ContactIcon fontSize="small" /><span>{tx("auto.k_5d3f93aa219c")}</span></Box>
                                                        </Tooltip>
                                                    </ToggleButton>
                                                </ToggleButtonGroup>
                                            </Box>
                                            {config.source === 'static' ? <TextField label={tx("auto.k_83ca170948b9", {
                value1: varNum
              })} value={config.value} onChange={e => handleConfigChange(varNum, 'value', e.target.value)} fullWidth size="small" required error={!config.value?.trim()} /> : <Box sx={{
                display: 'flex',
                gap: 2
              }}>
                                                    <FormControl size="small" sx={{
                  flex: 1
                }}>
                                                        <InputLabel>{tx("auto.k_0f05187d2257")}</InputLabel>
                                                        <Select value={config.field} label={tx("auto.k_0f05187d2257")} onChange={e => handleConfigChange(varNum, 'field', e.target.value)}>
                                                            {getCONTACT_FIELDS().map(f => <MenuItem key={f.value} value={f.value}>{f.icon} {f.label}</MenuItem>)}
                                                        </Select>
                                                    </FormControl>
                                                    <TextField label={tx("auto.k_b895ad8558e1")} value={config.fallback} onChange={e => handleConfigChange(varNum, 'fallback', e.target.value)} size="small" sx={{
                  flex: 1
                }} helperText={tx("auto.k_12fe750259e6")} />
                                                </Box>}
                                        </Card>;
          })}
                                <Card variant="outlined" sx={{
            bgcolor: '#e8f5e9'
          }}>
                                    <CardContent>
                                        <Typography variant="subtitle2" color="success.dark" gutterBottom>{tx("auto.k_336dfb8ff9b2")}</Typography>
                                        <Typography variant="body2" sx={{
                whiteSpace: 'pre-wrap',
                direction: 'auto'
              }}>{previewBody(selectedTemplate?.body, variableConfigs)}</Typography>
                                        {variables.some(v => variableConfigs[v]?.source === 'contact') && <Typography variant="caption" color="text.secondary" sx={{
                mt: 1,
                display: 'block'
              }}>{tx("auto.k_cee91a04c54c")}</Typography>}
                                    </CardContent>
                                </Card>
                            </Box>}

                        <FormControl fullWidth size="small">
                            <InputLabel>{tx("auto.k_d76522a03537")}</InputLabel>
                            <Select value={templateLanguage} label={tx("auto.k_d76522a03537")} onChange={e => setTemplateLanguage(e.target.value)}>
                                <MenuItem value="ar">{tx("auto.k_9970632f55af")}</MenuItem>
                                <MenuItem value="en">English</MenuItem>
                                <MenuItem value="en_US">English (US)</MenuItem>
                            </Select>
                        </FormControl>
                    </Box>
                    <Box sx={{
        mt: 3,
        display: 'flex',
        justifyContent: 'flex-end'
      }}>
                        <Button variant="contained" disabled={!canProceedStep0} onClick={() => setActiveStep(1)}>{tx("auto.k_2fa619787bcb")}</Button>
                    </Box>
                </Paper>}

            {/* ========== Step 1: Select recipients ========== */}
            {activeStep === 1 && <Paper sx={{
      p: 3
    }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>{tx("auto.k_5cadd95cd0c6")}</Typography>

                    <Tabs value={recipientsTab} onChange={(_, v) => setRecipientsTab(v)} sx={{
        mb: 2
      }}>
                        <Tab icon={<PeopleIcon />} iconPosition="start" label={tx("auto.k_e0f85c990efc", {
          value1: contacts.length
        })} />
                        <Tab icon={<StaticIcon />} iconPosition="start" label={tx("auto.k_3fcbc349597c")} />
                    </Tabs>

                    {/* Tab 0: Select from contacts */}
                    {recipientsTab === 0 && <Box>
                            {contactsLoading ? <Box sx={{
          display: 'flex',
          justifyContent: 'center',
          p: 4
        }}><CircularProgress /></Box> : contacts.length === 0 ? <Alert severity="info" sx={{
          mb: 2
        }}>{tx("auto.k_38409ada00d2")}</Alert> : <>
                                    {/* Search & Filter Bar */}
                                    <Box sx={{
            display: 'flex',
            gap: 2,
            mb: 2,
            flexWrap: 'wrap'
          }}>
                                        <TextField size="small" placeholder={tx("auto.k_6781448a8fb6")} value={contactSearch} onChange={e => setContactSearch(e.target.value)} sx={{
              flex: 1,
              minWidth: 200
            }} InputProps={{
              startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
            }} />

                                        <FormControl size="small" sx={{
              minWidth: 150
            }}>
                                            <InputLabel>{tx("auto.k_d580c3a35b18")}</InputLabel>
                                            <Select value={labelFilter} label={tx("auto.k_d580c3a35b18")} onChange={e => setLabelFilter(e.target.value)}>
                                                <MenuItem value="">{tx("auto.k_11fdef2dc5f8")}</MenuItem>
                                                {uniqueLabels.map(l => <MenuItem key={l} value={l}>{l}</MenuItem>)}
                                            </Select>
                                        </FormControl>
                                    </Box>

                                    {/* Action Buttons */}
                                    <Box sx={{
            display: 'flex',
            gap: 1,
            mb: 2,
            flexWrap: 'wrap',
            alignItems: 'center'
          }}>
                                        <Button size="small" variant="outlined" startIcon={<SelectAllIcon />} onClick={handleSelectAll}>{tx("auto.k_b04117b1dfee")}
                {filteredContacts.length})
                                        </Button>
                                        <Button size="small" variant="outlined" color="inherit" onClick={handleDeselectAll}>{tx("auto.k_41640caf219b")}

              </Button>
                                        {uniqueLabels.length > 0 && <>
                                                <Divider orientation="vertical" flexItem sx={{
                mx: 1
              }} />
                                                <Typography variant="caption" color="text.secondary" sx={{
                mr: 1
              }}>{tx("auto.k_2f7d3481d42f")}</Typography>
                                                {uniqueLabels.map(label => <Chip key={label} label={label} size="small" variant="outlined" onClick={() => handleSelectByLabel(label)} sx={{
                cursor: 'pointer'
              }} />)}
                                            </>}
                                    </Box>

                                    {/* Contacts Table */}
                                    <TableContainer sx={{
            maxHeight: 400,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1
          }}>
                                        <Table stickyHeader size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell padding="checkbox">
                                                        <Checkbox checked={allFilteredSelected} indeterminate={!allFilteredSelected && filteredContacts.some(c => selectedContactIds.has(c.id))} onChange={() => allFilteredSelected ? handleDeselectAll() : handleSelectAll()} />

                                                    </TableCell>
                                                    <TableCell>{tx("auto.k_0a92494ea1eb")}</TableCell>
                                                    <TableCell>{tx("auto.k_3a4ffd0856f9")}</TableCell>
                                                    <TableCell>{tx("auto.k_7c75fec5c0f8")}</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {filteredContacts.map(contact => <TableRow key={contact.id} hover onClick={() => handleToggleContact(contact.id)} sx={{
                  cursor: 'pointer'
                }} selected={selectedContactIds.has(contact.id)}>

                                                        <TableCell padding="checkbox">
                                                            <Checkbox checked={selectedContactIds.has(contact.id)} />
                                                        </TableCell>
                                                        <TableCell>{contact.profile_name || '—'}</TableCell>
                                                        <TableCell sx={{
                    fontFamily: 'monospace',
                    direction: 'ltr'
                  }}>{contact.phone}</TableCell>
                                                        <TableCell>
                                                            {contact.label && <Chip label={contact.label} size="small" variant="outlined" />}
                                                        </TableCell>
                                                    </TableRow>)}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                </>}
                        </Box>}

                    {/* Tab 1: Manual entry */}
                    {recipientsTab === 1 && <Box>
                            <Typography variant="body2" color="text.secondary" sx={{
          mb: 2
        }}>{tx("auto.k_931420b83c83")}

          </Typography>
                            <TextField fullWidth multiline rows={8} placeholder={"218911234567\n218921234567\n+218931234567"} value={recipientsText} onChange={e => setRecipientsText(e.target.value)} sx={{
          fontFamily: 'monospace'
        }} />

                        </Box>}

                    {/* Summary */}
                    <Box sx={{
        mt: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap'
      }}>
                        {selectedContactIds.size > 0 && <Chip icon={<PeopleIcon />} label={tx("auto.k_a56483eb6608", {
          value1: selectedContactIds.size
        })} color="primary" size="small" />}
                        {manualRecipients.length > 0 && <Chip icon={<StaticIcon />} label={tx("auto.k_4a828e378d8b", {
          value1: manualRecipients.length
        })} color="default" size="small" />}
                        <Chip icon={<SendIcon />} label={tx("auto.k_6ea51819a496", {
          value1: uniqueRecipients.length
        })} color={uniqueRecipients.length > 500 ? 'error' : uniqueRecipients.length > 0 ? 'success' : 'default'} />

                        {uniqueRecipients.length > 500 && <Alert severity="error" sx={{
          flex: 1
        }}>{tx("auto.k_d1986b1d4e6a")}</Alert>}
                        {selectedTenant && selectedTenant.credits !== null && selectedTenant.credits < uniqueRecipients.length && <Alert severity="warning" sx={{
          flex: 1
        }}>{tx("auto.k_84269774a62c")}{selectedTenant.credits}{tx("auto.k_f317159163b6")}</Alert>}
                    </Box>

                    <Box sx={{
        mt: 3,
        display: 'flex',
        justifyContent: 'space-between'
      }}>
                        <Button onClick={() => setActiveStep(0)}>{tx("auto.k_f533ebab64f4")}</Button>
                        <Button variant="contained" disabled={!canProceedStep1} onClick={() => setActiveStep(2)}>{tx("auto.k_2fa619787bcb")}</Button>
                    </Box>
                </Paper>}

            {/* ========== Step 2: Review & Send ========== */}
            {activeStep === 2 && <Paper sx={{
      p: 3
    }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>{tx("auto.k_dc466ec07afb")}</Typography>
                    <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        mt: 2
      }}>
                        <Box sx={{
          display: 'flex',
          gap: 3,
          flexWrap: 'wrap'
        }}>
                            <Card variant="outlined" sx={{
            flex: 1,
            minWidth: 200
          }}>
                                <CardContent>
                                    <Typography variant="caption" color="text.secondary">{tx("auto.k_8adba91e1d87")}</Typography>
                                    <Typography variant="h6">{selectedTenant?.name}</Typography>
                                </CardContent>
                            </Card>
                            <Card variant="outlined" sx={{
            flex: 1,
            minWidth: 200
          }}>
                                <CardContent>
                                    <Typography variant="caption" color="text.secondary">{tx("auto.k_4f4ec9f764bd")}</Typography>
                                    <Typography variant="h6">{selectedTemplate?.name}</Typography>
                                </CardContent>
                            </Card>
                            <Card variant="outlined" sx={{
            flex: 1,
            minWidth: 200
          }}>
                                <CardContent>
                                    <Typography variant="caption" color="text.secondary">{tx("auto.k_38ee0acbedd8")}</Typography>
                                    <Typography variant="h6">{uniqueRecipients.length}</Typography>
                                </CardContent>
                            </Card>
                        </Box>

                        {selectedTemplate && <Card variant="outlined">
                                <CardContent>
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>{tx("auto.k_bf04bed9b3fa")}</Typography>
                                    <Typography variant="body2" sx={{
              whiteSpace: 'pre-wrap',
              bgcolor: '#f0f4f0',
              p: 1.5,
              borderRadius: 1,
              direction: 'auto'
            }}>
                                        {previewBody(selectedTemplate.body, variableConfigs)}
                                    </Typography>
                                </CardContent>
                            </Card>}

                        {(hasMediaHeader || variables.length > 0) && <Box>
                                <Typography variant="body2" color="text.secondary" gutterBottom>{tx("auto.k_243df943fddd")}</Typography>
                                <Box sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1
          }}>
                                    {hasMediaHeader && (() => {
              const config = variableConfigs.header_MEDIA_LINK;
              const label = config?.source === 'upload' ? config?.file?.name || tx("auto.k_ae56c3a546e8") : config?.source === 'contact' ? getCONTACT_FIELDS().find(f => f.value === config.field)?.label || config.field : config?.value || '—';
              return <Chip label={tx("auto.k_af6f1f3211ec", {
                value1: label
              })} size="small" color="secondary" variant="outlined" />;
            })()}
                                    {variables.map(v => {
              const config = variableConfigs[v];
              const label = config?.source === 'contact' ? getCONTACT_FIELDS().find(f => f.value === config.field)?.label || config.field : config?.value || '—';
              return <Chip key={v} label={`{{${v}}} = ${label}`} size="small" color={config?.source === 'contact' ? 'secondary' : 'primary'} variant="outlined" icon={config?.source === 'contact' ? <ContactIcon /> : <StaticIcon />} />;
            })}
                                </Box>
                            </Box>}
                        <Divider />
                        <Alert severity="info">{tx("auto.k_5ee4189b4b93")}{Math.ceil(uniqueRecipients.length / 10)}{tx("auto.k_8fdf716e8c2d")}</Alert>
                    </Box>

                    {sending && <Box sx={{
        mt: 3
      }}>
                            <LinearProgress variant="determinate" value={progressPct} sx={{
          height: 8,
          borderRadius: 4
        }} />
                            <Typography variant="body2" color="text.secondary" sx={{
          mt: 1,
          textAlign: 'center'
        }}>
                                {progressPct > 0 ? tx("auto.k_48db4b19ef44", {
            value1: progressPct
          }) : tx("auto.k_65e6177e70ae")}
                            </Typography>
                        </Box>}

                    <Box sx={{
        mt: 3,
        display: 'flex',
        justifyContent: 'space-between'
      }}>
                        <Button onClick={() => setActiveStep(1)} disabled={sending}>{tx("auto.k_f533ebab64f4")}</Button>
                        <Button variant="contained" color="success" startIcon={sending ? <CircularProgress size={20} color="inherit" /> : <SendIcon />} onClick={handleSend} disabled={sending} size="large">
                            {sending ? tx("auto.k_b303cc20c191") : tx("auto.k_c456680d98de", {
            value1: uniqueRecipients.length
          })}
                        </Button>
                    </Box>
                </Paper>}

            {/* ========== Step 3: Results ========== */}
            {activeStep === 3 && results && <Paper sx={{
      p: 3
    }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>{tx("auto.k_1e7bc3076360")}
          {results.sent}{tx("auto.k_2eb748dcb5b1")}{results.failed > 0 ? tx("auto.k_5055aa295fb0", {
          value1: results.failed
        }) : ''}
                    </Typography>
                    <Box sx={{
        display: 'flex',
        gap: 3,
        mb: 3,
        flexWrap: 'wrap'
      }}>
                        <Card variant="outlined" sx={{
          flex: 1,
          minWidth: 150
        }}>
                            <CardContent sx={{
            textAlign: 'center'
          }}>
                                <Typography variant="h3" fontWeight={700}>{results.total}</Typography>
                                <Typography variant="body2" color="text.secondary">{tx("auto.k_a0b6607217fc")}</Typography>
                            </CardContent>
                        </Card>
                        <Card variant="outlined" sx={{
          flex: 1,
          minWidth: 150
        }}>
                            <CardContent sx={{
            textAlign: 'center'
          }}>
                                <Typography variant="h3" fontWeight={700} color="success.main">{results.sent}</Typography>
                                <Typography variant="body2" color="text.secondary">{tx("auto.k_2eb748dcb5b1")}</Typography>
                            </CardContent>
                        </Card>
                        <Card variant="outlined" sx={{
          flex: 1,
          minWidth: 150
        }}>
                            <CardContent sx={{
            textAlign: 'center'
          }}>
                                <Typography variant="h3" fontWeight={700} color="error.main">{results.failed}</Typography>
                                <Typography variant="body2" color="text.secondary">{tx("auto.k_9fa00bdb7453")}</Typography>
                            </CardContent>
                        </Card>
                    </Box>

                    {results.results?.length > 0 && <TableContainer sx={{
        maxHeight: 400
      }}>
                            <Table stickyHeader size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>{tx("auto.k_5fdb14e93b82")}</TableCell>
                                        <TableCell>{tx("auto.k_d6370401145d")}</TableCell>
                                        <TableCell>{tx("auto.k_b2959a3376cc")}</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {results.results.map((r, i) => <TableRow key={i}>
                                            <TableCell sx={{
                fontFamily: 'monospace'
              }}>{r.recipient}</TableCell>
                                            <TableCell>
                                                <Chip icon={r.status === 'sent' ? <SuccessIcon /> : <ErrorIcon />} label={r.status === 'sent' ? tx("auto.k_2eb748dcb5b1") : tx("auto.k_9fa00bdb7453")} color={r.status === 'sent' ? 'success' : 'error'} size="small" />
                                            </TableCell>
                                            <TableCell>{r.message_id || r.error || '—'}</TableCell>
                                        </TableRow>)}
                                </TableBody>
                            </Table>
                        </TableContainer>}

                    <Box sx={{
        mt: 3,
        display: 'flex',
        justifyContent: 'center'
      }}>
                        <Button variant="contained" onClick={handleReset}>{tx("auto.k_db509c67de95")}</Button>
                    </Box>
                </Paper>}
        </Box>;
};
export default BroadcastManager;
