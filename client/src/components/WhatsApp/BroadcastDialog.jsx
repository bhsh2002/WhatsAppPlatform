import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box, Typography, IconButton, FormControl, InputLabel, Select, MenuItem, Chip, Alert, CircularProgress, Grid, Checkbox, ListItemText, Card, CardContent, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import { Close as CloseIcon, Send as SendIcon, TextFields as StaticIcon, Person as ContactIcon, AttachFile as AttachFileIcon } from '@mui/icons-material';
import api from '../../api';
import { tx } from "../../i18n/tx";
function extractAllVariables(template) {
  const result = {
    header: [],
    body: [],
    buttons: []
  };
  if (!template) return result;
  if (template.body) {
    const matches = template.body.match(/\{\{([^}]+)\}\}/g);
    if (matches) {
      result.body = [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))];
    }
  }
  if (template.header_type === 'text' && template.header_content) {
    const matches = template.header_content.match(/\{\{([^}]+)\}\}/g);
    if (matches) {
      result.header = [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))];
    }
  } else if (['image', 'video', 'document', 'audio'].includes(template.header_type?.toLowerCase())) {
    result.header = ['MEDIA_LINK'];
  }
  if (template.buttons) {
    try {
      const buttons = typeof template.buttons === 'string' ? JSON.parse(template.buttons) : template.buttons;
      if (Array.isArray(buttons)) {
        buttons.forEach((btn, index) => {
          if (btn.type === 'URL' && btn.url) {
            const matches = btn.url.match(/\{\{([^}]+)\}\}/g);
            if (matches) {
              result.buttons.push({
                index: String(index),
                sub_type: 'url',
                text: btn.text,
                url: btn.url,
                variables: [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))]
              });
            }
          }
          if (btn.type === 'OTP' || btn.type === 'COPY_CODE' || btn.type === 'otp') {
            result.buttons.push({
              index: String(index),
              sub_type: 'url',
              text: btn.text || 'Copy Code',
              isOtp: true,
              variables: ['1']
            });
          }
        });
      }
    } catch (_) {/* ignored */}
  }
  return result;
}
function previewBody(bodyText, variableValues) {
  if (!bodyText) return '';
  return bodyText.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
    const val = variableValues[`body_${varName}`];
    return val ? val : match;
  });
}
const BroadcastDialog = ({
  open,
  onClose,
  onSend,
  contacts = [],
  templates = []
}) => {
  const [step, setStep] = useState(1);
  const [selectedContacts, setSelectedContacts] = useState([]);
  const [customNumbers, setCustomNumbers] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [templateLanguage, setTemplateLanguage] = useState('ar');
  const [searchTerm, setSearchTerm] = useState('');
  const [sending, setSending] = useState(false);
  const [variableValues, setVariableValues] = useState({});
  const templateObj = useMemo(() => templates.find(t => t.name === selectedTemplate), [templates, selectedTemplate]);
  const allVars = useMemo(() => extractAllVariables(templateObj), [templateObj]);
  const allVariableKeys = useMemo(() => {
    const keys = [];
    allVars.header.forEach(v => keys.push(`header_${v}`));
    allVars.body.forEach(v => keys.push(`body_${v}`));
    allVars.buttons.forEach(btn => btn.variables.forEach(v => keys.push(`button_${btn.index}_${v}`)));
    return keys;
  }, [allVars]);
  const allVariablesFilled = useMemo(() => allVariableKeys.length === 0 || allVariableKeys.every(key => variableValues[key]?.trim()), [allVariableKeys, variableValues]);
  useEffect(() => {
    if (open) {
      setSelectedContacts([]);
      setCustomNumbers('');
      setSelectedTemplate('');
      setTemplateLanguage('ar');
      setSearchTerm('');
      setStep(1);
      setSending(false);
      setVariableValues({});
    }
  }, [open]);
  useEffect(() => {
    const defaults = {};
    allVariableKeys.forEach(key => {
      if (!(key in defaults)) defaults[key] = '';
    });
    setVariableValues(prev => {
      const next = {};
      allVariableKeys.forEach(key => {
        next[key] = prev[key] !== undefined ? prev[key] : '';
      });
      return next;
    });
  }, [selectedTemplate]);
  const filteredContacts = contacts.filter(c => c.phone?.includes(searchTerm) || c.profile_name?.toLowerCase().includes(searchTerm.toLowerCase()));
  const allRecipients = [...selectedContacts, ...customNumbers.split(/[,\n]/).map(n => n.trim()).filter(n => n.length >= 9)];
  const handleToggleContact = phone => {
    setSelectedContacts(prev => prev.includes(phone) ? prev.filter(p => p !== phone) : [...prev, phone]);
  };
  const handleSelectAll = () => {
    if (selectedContacts.length === filteredContacts.length) {
      setSelectedContacts([]);
    } else {
      setSelectedContacts(filteredContacts.map(c => c.phone));
    }
  };
  const handleVariableChange = (key, value) => {
    setVariableValues(prev => ({
      ...prev,
      [key]: value
    }));
  };
  const buildTemplateParams = (headerMediaId = null) => {
    const components = [];
    const isNamed = templateObj?.parameter_format === 'named';
    if (allVars.header.length > 0) {
      components.push({
        type: 'header',
        parameters: allVars.header.map(v => {
          if (v === 'MEDIA_LINK') {
            const hType = templateObj.header_type.toLowerCase();
            if (headerMediaId) {
              return {
                type: hType,
                [hType]: {
                  id: headerMediaId
                }
              };
            } else {
              // Fallback if string URL
              return {
                type: hType,
                [hType]: {
                  link: variableValues[`header_${v}`] || ''
                }
              };
            }
          }
          const param = {
            type: 'text',
            text: variableValues[`header_${v}`] || ''
          };
          if (isNamed) param.parameter_name = v;
          return param;
        })
      });
    }
    if (allVars.body.length > 0) {
      components.push({
        type: 'body',
        parameters: allVars.body.map(v => {
          const param = {
            type: 'text',
            text: variableValues[`body_${v}`] || ''
          };
          if (isNamed) param.parameter_name = v;
          return param;
        })
      });
    }
    allVars.buttons.forEach(btn => {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: btn.index,
        parameters: btn.variables.map(v => ({
          type: 'text',
          text: variableValues[`button_${btn.index}_${v}`] || ''
        }))
      });
    });
    return components.length > 0 ? components : undefined;
  };
  const handleSend = async () => {
    if (allRecipients.length === 0 || !selectedTemplate) return;
    setSending(true);
    try {
      let headerMediaId = null;
      if (templateObj?.header_type && ['image', 'video', 'document', 'audio'].includes(templateObj.header_type.toLowerCase())) {
        const fileOrLink = variableValues['header_MEDIA_LINK'];
        if (!fileOrLink) {
          alert(tx("auto.k_f5e1d306e752"));
          setSending(false);
          return;
        }
        if (fileOrLink instanceof File) {
          const res = await api.uploadPortalMediaToMeta(fileOrLink);
          headerMediaId = res.id;
        }
      }
      const payload = {
        recipients: allRecipients,
        template_name: selectedTemplate,
        template_language: templateLanguage
      };
      const templateParams = buildTemplateParams(headerMediaId);
      if (templateParams) {
        payload.template_params = templateParams;
      }
      await onSend(payload);
      onClose();
    } catch (err) {
      console.error('Broadcast error:', err);
    } finally {
      setSending(false);
    }
  };
  const handleClose = () => {
    if (!sending) {
      onClose();
    }
  };
  const renderVariableInput = (key, label) => {
    if (key === 'header_MEDIA_LINK') {
      return <Box key={key} sx={{
        mb: 2
      }}>
                    <Typography variant="subtitle2" sx={{
          mb: 1
        }}>{label}</Typography>
                    <Button variant="outlined" component="label" startIcon={<AttachFileIcon />} fullWidth color={variableValues[key] ? 'success' : 'primary'} sx={{
          textTransform: 'none',
          justifyContent: 'flex-start',
          px: 2
        }}>

                        <Box sx={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
                            {variableValues[key]?.name || tx("auto.k_70302e35b81e")}
                        </Box>
                        <input type="file" hidden accept={templateObj?.header_type === 'image' ? 'image/jpeg,image/png,image/webp' : templateObj?.header_type === 'video' ? 'video/mp4,video/3gpp' : '.pdf,.doc,.docx,.xls,.xlsx,.txt'} onChange={e => handleVariableChange('header_MEDIA_LINK', e.target.files[0])} />

                    </Button>
                </Box>;
    }
    return <TextField key={key} label={label} placeholder={tx("auto.k_8cfc5db9f49a", {
      value1: label
    })} value={variableValues[key] || ''} onChange={e => handleVariableChange(key, e.target.value)} fullWidth size="small" required error={!variableValues[key]} sx={{
      mb: 1.5
    }} />;
  };
  return <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
                <Typography variant="h6">{tx("auto.k_f72dbc53d202")}</Typography>
                <IconButton onClick={handleClose} disabled={sending}>
                    <CloseIcon />
                </IconButton>
            </DialogTitle>

            <DialogContent>
                {/* Step indicator */}
                <Box sx={{
        display: 'flex',
        gap: 2,
        mb: 3
      }}>
                    {[1, 2, 3].map(s => <Box key={s} sx={{
          flex: 1,
          p: 1,
          borderRadius: 1,
          bgcolor: step >= s ? 'primary.main' : 'grey.200',
          color: step >= s ? 'white' : 'text.secondary',
          textAlign: 'center',
          cursor: step < s ? 'pointer' : 'default'
        }} onClick={() => step > s && setStep(s)}>

                            {s === 1 && tx("auto.k_5cadd95cd0c6")}
                            {s === 2 && tx("auto.k_3975a5ce4681")}
                            {s === 3 && tx("auto.k_7f4f8c12c9c6")}
                        </Box>)}
                </Box>

                {/* Step 1: Select Recipients */}
                {step === 1 && <Box>
                        <TextField placeholder={tx("auto.k_54289add633a")} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} fullWidth size="small" sx={{
          mb: 2
        }} />


                        <Box sx={{
          display: 'flex',
          justifyContent: 'space-between',
          mb: 1
        }}>
                            <Typography variant="body2" color="text.secondary">{tx("auto.k_4dc0f13f3d07")}
              {filteredContacts.length})
                            </Typography>
                            <Button size="small" onClick={handleSelectAll}>
                                {selectedContacts.length === filteredContacts.length ? tx("auto.k_4755fb7e13e3") : tx("auto.k_4681d5d6a68c")}
                            </Button>
                        </Box>

                        <Box sx={{
          maxHeight: 300,
          overflow: 'auto',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          mb: 2
        }}>
                            {filteredContacts.map(contact => <Box key={contact.phone} sx={{
            display: 'flex',
            alignItems: 'center',
            p: 1,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: selectedContacts.includes(contact.phone) ? 'action.selected' : 'transparent',
            cursor: 'pointer',
            '&:hover': {
              bgcolor: 'action.hover'
            }
          }} onClick={() => handleToggleContact(contact.phone)}>

                                    <Checkbox checked={selectedContacts.includes(contact.phone)} size="small" />
                                    <Box sx={{
              ml: 1,
              flex: 1
            }}>
                                        <Typography variant="body2">{contact.profile_name || contact.phone}</Typography>
                                        <Typography variant="caption" color="text.secondary">{contact.phone}</Typography>
                                    </Box>
                                </Box>)}
                            {filteredContacts.length === 0 && <Typography variant="body2" color="text.secondary" sx={{
            p: 2,
            textAlign: 'center'
          }}>{tx("auto.k_730f15ca2de4")}</Typography>}
                        </Box>

                        <TextField label={tx("auto.k_495a6989d154")} placeholder="966501234567, 966501234568" value={customNumbers} onChange={e => setCustomNumbers(e.target.value)} fullWidth multiline rows={2} helperText={tx("auto.k_eb77df4071b4")} />


                        <Typography variant="body2" sx={{
          mt: 2
        }}>{tx("auto.k_7e451a626eb3")}{allRecipients.length}</Typography>
                    </Box>}

                {/* Step 2: Select Template + Fill Variables */}
                {step === 2 && <Box>
                        <FormControl fullWidth sx={{
          mb: 2
        }}>
                            <InputLabel>{tx("auto.k_4f4ec9f764bd")}</InputLabel>
                            <Select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} label={tx("auto.k_4f4ec9f764bd")}>

                                {templates.map(template => <MenuItem key={template.id || template.name} value={template.name}>
                                        {template.name}
                                        {template.status && ` (${template.status})`}
                                    </MenuItem>)}
                            </Select>
                        </FormControl>

                        <FormControl fullWidth sx={{
          mb: 2
        }}>
                            <InputLabel>{tx("auto.k_d76522a03537")}</InputLabel>
                            <Select value={templateLanguage} onChange={e => setTemplateLanguage(e.target.value)} label={tx("auto.k_d76522a03537")}>

                                <MenuItem value="ar">{tx("auto.k_9970632f55af")}</MenuItem>
                                <MenuItem value="en">English</MenuItem>
                            </Select>
                        </FormControl>

                        {templateObj && <Card variant="outlined" sx={{
          mb: 2
        }}>
                                <CardContent>
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>{tx("auto.k_ceb923673b44")}</Typography>
                                    {templateObj.header_type === 'text' && templateObj.header_content && <Typography variant="body2" sx={{
              fontWeight: 600,
              mb: 1,
              direction: 'auto'
            }}>
                                            {templateObj.header_content}
                                        </Typography>}
                                    <Typography variant="body2" sx={{
              whiteSpace: 'pre-wrap',
              bgcolor: 'grey.50',
              p: 1.5,
              borderRadius: 1,
              direction: 'auto'
            }}>
                                        {templateObj.body || tx("auto.k_614dbf701024")}
                                    </Typography>
                                    {templateObj.footer && <Typography variant="caption" color="text.secondary" sx={{
              mt: 1,
              display: 'block'
            }}>
                                            {templateObj.footer}
                                        </Typography>}
                                </CardContent>
                            </Card>}

                        {/* Variable Inputs */}
                        {allVariableKeys.length > 0 && <Box sx={{
          mt: 1
        }}>
                                <Alert severity="info" sx={{
            mb: 2
          }}>{tx("auto.k_ea1a3cdc0174")}
              {allVariableKeys.length}{tx("auto.k_fed803f685a6")}
            </Alert>

                                {allVars.header.length > 0 && <Box sx={{
            mb: 2
          }}>
                                        <Typography variant="subtitle2" color="text.secondary" sx={{
              mb: 1
            }}>{tx("auto.k_8fce03c0482d")}</Typography>
                                        {allVars.header.map(v => renderVariableInput(`header_${v}`, v === 'MEDIA_LINK' ? tx("auto.k_fdffee4a2bea", {
              value1: templateObj?.header_type === 'image' ? tx("auto.k_b941956874fe") : templateObj?.header_type === 'video' ? tx("auto.k_17daa024f2eb") : tx("auto.k_d9381107732e")
            }) : /^\d+$/.test(v) ? tx("auto.k_f3b8405ca275", {
              value1: v
            }) : v))}
                                    </Box>}
                                {allVars.body.map(v => renderVariableInput(`body_${v}`, /^\d+$/.test(v) ? tx("auto.k_e12dd24fd942", {
            value1: v
          }) : v))}
                                {allVars.buttons.length > 0 && <Box sx={{
            mt: 2
          }}>
                                        <Typography variant="subtitle2" color="text.secondary" sx={{
              mb: 1
            }}>{tx("auto.k_3bad6d496394")}</Typography>
                                        {allVars.buttons.map(btn => btn.variables.map(v => renderVariableInput(`button_${btn.index}_${v}`, /^\d+$/.test(v) ? tx("auto.k_7a68c543ae76", {
              value1: btn.text,
              value2: v
            }) : tx("auto.k_18cc2468d2c5", {
              value1: btn.text,
              value2: v
            }))))}
                                    </Box>}

                                <Card variant="outlined" sx={{
            mt: 1,
            bgcolor: '#e8f5e9'
          }}>
                                    <CardContent>
                                        <Typography variant="subtitle2" color="success.dark" gutterBottom>{tx("auto.k_336dfb8ff9b2")}</Typography>
                                        <Typography variant="body2" sx={{
                whiteSpace: 'pre-wrap',
                direction: 'auto'
              }}>
                                            {previewBody(templateObj?.body, variableValues)}
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Box>}

                        {selectedTemplate && allVariableKeys.length === 0 && <Alert severity="info" sx={{
          mt: 2
        }}>{tx("auto.k_898bbfe02122")}

          </Alert>}
                    </Box>}

                {/* Step 3: Preview */}
                {step === 3 && <Box>
                        <Typography variant="subtitle1" gutterBottom>{tx("auto.k_5f9f099fb2c0")}</Typography>

                        <Box sx={{
          bgcolor: 'grey.50',
          p: 2,
          borderRadius: 1,
          mb: 2
        }}>
                            <Grid container spacing={2}>
                                <Grid size={{
              xs: 6
            }}>
                                    <Typography variant="body2" color="text.secondary">{tx("auto.k_74aaa2a2c4d8")}</Typography>
                                    <Typography variant="h5">{allRecipients.length}</Typography>
                                </Grid>
                                <Grid size={{
              xs: 6
            }}>
                                    <Typography variant="body2" color="text.secondary">{tx("auto.k_430ee78592af")}</Typography>
                                    <Typography variant="body1">{selectedTemplate}</Typography>
                                </Grid>
                            </Grid>
                        </Box>

                        {templateObj && <Card variant="outlined" sx={{
          mb: 2
        }}>
                                <CardContent>
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>{tx("auto.k_4c0b25c8ab4d")}</Typography>
                                    <Typography variant="body2" sx={{
              whiteSpace: 'pre-wrap',
              bgcolor: '#f0f4f0',
              p: 1.5,
              borderRadius: 1,
              direction: 'auto'
            }}>
                                        {previewBody(templateObj.body, variableValues)}
                                    </Typography>
                                </CardContent>
                            </Card>}

                        {allVariableKeys.length > 0 && <Box sx={{
          mb: 2
        }}>
                                <Typography variant="body2" color="text.secondary" gutterBottom>{tx("auto.k_243df943fddd")}</Typography>
                                <Box sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1
          }}>
                                    {allVariableKeys.map(key => <Chip key={key} label={`${key} = ${variableValues[key] || '—'}`} size="small" color="primary" variant="outlined" />)}
                                </Box>
                            </Box>}

                        <Typography variant="body2" color="text.secondary" gutterBottom>{tx("auto.k_7e740598781f")}</Typography>
                        <Box sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0.5,
          maxHeight: 100,
          overflow: 'auto'
        }}>
                            {allRecipients.slice(0, 20).map(phone => <Chip key={phone} label={phone} size="small" />)}
                            {allRecipients.length > 20 && <Chip label={tx("auto.k_b5d9eac2491d", {
            value1: allRecipients.length - 20
          })} size="small" />}
                        </Box>

                        <Alert severity="warning" sx={{
          mt: 2
        }}>{tx("auto.k_4cca7c5c29c5")}{allRecipients.length}{tx("auto.k_050f8da34586")}</Alert>
                    </Box>}
            </DialogContent>

            <DialogActions sx={{
      px: 3,
      pb: 2,
      justifyContent: 'space-between'
    }}>
                <Button onClick={() => setStep(s => Math.max(1, s - 1))} disabled={step === 1 || sending}>{tx("auto.k_f533ebab64f4")}

        </Button>

                <Box sx={{
        display: 'flex',
        gap: 1
      }}>
                    {step < 3 ? <Button variant="contained" onClick={() => setStep(s => s + 1)} disabled={step === 1 && allRecipients.length === 0 || step === 2 && (!selectedTemplate || !allVariablesFilled)}>{tx("auto.k_2fa619787bcb")}


          </Button> : <Button variant="contained" onClick={handleSend} disabled={sending || allRecipients.length === 0} startIcon={sending ? <CircularProgress size={20} /> : <SendIcon />}>

                            {sending ? tx("auto.k_b303cc20c191") : tx("auto.k_c456680d98de", {
            value1: allRecipients.length
          })}
                        </Button>}
                </Box>
            </DialogActions>
        </Dialog>;
};
export default BroadcastDialog;
