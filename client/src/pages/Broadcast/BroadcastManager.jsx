import React, { useState, useEffect, useMemo } from 'react';
import { Box, Paper, Typography, TextField, Button, FormControl, InputLabel, MenuItem, CircularProgress, Alert, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Stepper, Step, StepLabel, Card, CardContent, Divider, LinearProgress, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import Select from '../../components/Form/AccessibleSelect';
import { Campaign as CampaignIcon, Send as SendIcon, CheckCircle as SuccessIcon, Error as ErrorIcon, TextFields as StaticIcon, Person as ContactIcon, AttachFile as AttachFileIcon } from '@mui/icons-material';
import api from '../../api';
import { tx } from "../../i18n/tx";
import { BroadcastRecipientsStep } from './BroadcastRecipientsStep';
import {
  MEDIA_ACCEPT,
  MEDIA_HEADER_TYPES,
  buildBroadcastRecipients,
  extractNumberedVariables,
  filterBroadcastContacts,
  getBroadcastContactFields,
  getBroadcastContactLabels,
  getBroadcastMediaLabels,
  previewBroadcastBody
} from './broadcastConfig';
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
  const variables = useMemo(() => extractNumberedVariables(selectedTemplate?.body), [selectedTemplate]);
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
  const uniqueLabels = useMemo(() => getBroadcastContactLabels(contacts), [contacts]);
  const filteredContacts = useMemo(
    () => filterBroadcastContacts(contacts, contactSearch, labelFilter),
    [contacts, contactSearch, labelFilter]
  );
  const { manualRecipients, uniqueRecipients } = useMemo(
    () => buildBroadcastRecipients(contacts, selectedContactIds, recipientsText),
    [contacts, recipientsText, selectedContactIds]
  );
  const selectedTenant = tenants.find(t => t.id === parseInt(selectedTenantId, 10));
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
          value1: getBroadcastMediaLabels()[headerMediaType] || tx("auto.k_e68d8fac0b6f")
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

                {config.source === 'upload' && <Button variant="outlined" component="label" role={undefined} startIcon={<AttachFileIcon />} fullWidth color={config.file ? 'success' : 'primary'} sx={{
        justifyContent: 'flex-start',
        textTransform: 'none'
      }}>

                        <Box sx={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
                            {config.file?.name || tx("auto.k_0e55291e5349", {
            value1: getBroadcastMediaLabels()[headerMediaType] || tx("auto.k_ae56c3a546e8")
          })}
                        </Box>
                        <input type="file" hidden accept={MEDIA_ACCEPT[headerMediaType] || '*/*'} onChange={e => handleConfigChange('header_MEDIA_LINK', 'file', e.target.files?.[0] || null)} />

                    </Button>}

                {config.source === 'static' && <TextField label={tx("auto.k_8bdf1b0ed3e1", {
        value1: getBroadcastMediaLabels()[headerMediaType] || tx("auto.k_b9755ec895c4")
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
                                {getBroadcastContactFields().map(f => <MenuItem key={f.value} value={f.value}>{f.icon} {f.label}</MenuItem>)}
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
                <Typography variant="h4" component="h1" fontWeight={700} gutterBottom sx={{
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
                    <Typography variant="h6" component="h2" fontWeight={600} gutterBottom>{tx("auto.k_6271957673f9")}</Typography>
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
              {getBroadcastMediaLabels()[headerMediaType] || tx("auto.k_e68d8fac0b6f")}{tx("auto.k_a623e90be45f")}
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
                                                            {getBroadcastContactFields().map(f => <MenuItem key={f.value} value={f.value}>{f.icon} {f.label}</MenuItem>)}
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
              }}>{previewBroadcastBody(selectedTemplate?.body, variableConfigs)}</Typography>
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
            {activeStep === 1 && <BroadcastRecipientsStep
                accentColor="primary"
                allFilteredSelected={allFilteredSelected}
                availableCredits={selectedTenant?.credits ?? null}
                canProceed={canProceedStep1}
                contactSearch={contactSearch}
                contacts={contacts}
                contactsLoading={contactsLoading}
                emptyMessageKey="auto.k_38409ada00d2"
                filteredContacts={filteredContacts}
                labelFilter={labelFilter}
                manualHelpKey="auto.k_931420b83c83"
                manualRecipients={manualRecipients}
                maxRecipients={500}
                onBack={() => setActiveStep(0)}
                onContactSearchChange={setContactSearch}
                onDeselectAll={handleDeselectAll}
                onLabelFilterChange={setLabelFilter}
                onNext={() => setActiveStep(2)}
                onRecipientsTabChange={setRecipientsTab}
                onRecipientsTextChange={setRecipientsText}
                onSelectAll={handleSelectAll}
                onSelectByLabel={handleSelectByLabel}
                onToggleContact={handleToggleContact}
                overLimitMessageKey="auto.k_d1986b1d4e6a"
                recipientsTab={recipientsTab}
                recipientsText={recipientsText}
                selectedContactIds={selectedContactIds}
                uniqueLabels={uniqueLabels}
                uniqueRecipients={uniqueRecipients}
            />}

            {/* ========== Step 2: Review & Send ========== */}
            {activeStep === 2 && <Paper sx={{
      p: 3
    }}>
                    <Typography variant="h6" component="h2" fontWeight={600} gutterBottom>{tx("auto.k_dc466ec07afb")}</Typography>
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
                                        {previewBroadcastBody(selectedTemplate.body, variableConfigs)}
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
              const label = config?.source === 'upload' ? config?.file?.name || tx("auto.k_ae56c3a546e8") : config?.source === 'contact' ? getBroadcastContactFields().find(f => f.value === config.field)?.label || config.field : config?.value || '—';
              return <Chip label={tx("auto.k_af6f1f3211ec", {
                value1: label
              })} size="small" color="secondary" variant="outlined" />;
            })()}
                                    {variables.map(v => {
              const config = variableConfigs[v];
              const label = config?.source === 'contact' ? getBroadcastContactFields().find(f => f.value === config.field)?.label || config.field : config?.value || '—';
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
                            <LinearProgress aria-label={tx("auto.k_65e6177e70ae")} variant="determinate" value={progressPct} sx={{
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
                    <Typography variant="h6" component="h2" fontWeight={600} gutterBottom>{tx("auto.k_1e7bc3076360")}
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
