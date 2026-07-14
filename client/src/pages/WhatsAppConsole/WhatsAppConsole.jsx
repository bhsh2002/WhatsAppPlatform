import React, { useEffect, useMemo, useState } from 'react';
import { Box, Grid, Card, CardContent, Typography, TextField, Button, FormControl, FormControlLabel, Radio, RadioGroup, MenuItem, InputLabel, IconButton, Chip, Alert, CircularProgress } from '@mui/material';
import Select from '../../components/Form/AccessibleSelect';
import { Send as SendIcon, Smartphone as SmartphoneIcon, Add as AddIcon, Delete as DeleteIcon, CheckCircle as CheckCircleIcon, Error as ErrorIcon, Terminal as TerminalIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import api from '../../api';
import { useTenants } from '../../context/TenantContext';
import { tx } from "../../i18n/tx";
import { PageTitle } from '../../components/Layout/PageTitle';
import { getCurrentLocale } from "../../utils/locale";
const WhatsAppConsole = () => {
  const {
    tenants,
    loading: tenantsLoading,
    fetchTenants
  } = useTenants();
  const [messageForm, setMessageForm] = useState({
    recipient: '',
    type: 'text',
    message: tx("auto.k_400e12610d56"),
    templateName: 'delivery_confirmation',
    templateLanguage: 'ar',
    templateParams: [],
    tenantId: ''
  });
  const [status, setStatus] = useState('idle');
  const [logs, setLogs] = useState([]);
  const [serverOnline, setServerOnline] = useState(null);
  const selectedTenant = useMemo(() => tenants.find(t => String(t.id) === String(messageForm.tenantId)), [tenants, messageForm.tenantId]);
  useEffect(() => {
    const tenantWithWhatsapp = tenants.find(t => t.phone_number_id && t.waba_id);
    if (!messageForm.tenantId && tenantWithWhatsapp) {
      setMessageForm(prev => ({
        ...prev,
        tenantId: String(tenantWithWhatsapp.id)
      }));
    }
  }, [tenants, messageForm.tenantId]);
  const checkServer = async () => {
    try {
      await api.checkHealth();
      setServerOnline(true);
    } catch {
      setServerOnline(false);
    }
  };
  useEffect(() => {
    checkServer();
  }, []);
  const addParam = () => {
    setMessageForm(prev => {
      const components = [...(prev.templateParams || [])];
      const bodyIndex = components.findIndex(c => c.type === 'body');
      if (bodyIndex === -1) {
        components.push({
          type: 'body',
          parameters: [{
            type: 'text',
            text: ''
          }]
        });
      } else {
        components[bodyIndex].parameters.push({
          type: 'text',
          text: ''
        });
      }
      return {
        ...prev,
        templateParams: components
      };
    });
  };
  const updateParam = (paramIndex, value) => {
    setMessageForm(prev => {
      const components = [...prev.templateParams];
      const bodyIndex = components.findIndex(c => c.type === 'body');
      if (bodyIndex !== -1) {
        components[bodyIndex].parameters[paramIndex].text = value;
      }
      return {
        ...prev,
        templateParams: components
      };
    });
  };
  const removeParam = paramIndex => {
    setMessageForm(prev => {
      const components = [...prev.templateParams];
      const bodyIndex = components.findIndex(c => c.type === 'body');
      if (bodyIndex !== -1) {
        components[bodyIndex].parameters = components[bodyIndex].parameters.filter((_, i) => i !== paramIndex);
        if (components[bodyIndex].parameters.length === 0) components.splice(bodyIndex, 1);
      }
      return {
        ...prev,
        templateParams: components
      };
    });
  };
  const getBodyParams = () => {
    const bodyComponent = messageForm.templateParams?.find(c => c.type === 'body');
    return bodyComponent ? bodyComponent.parameters : [];
  };
  const handleSend = async event => {
    event.preventDefault();
    if (!selectedTenant) return;
    const timestamp = new Date().toLocaleTimeString(getCurrentLocale());
    setStatus('loading');
    try {
      const payload = {
        recipient: messageForm.recipient,
        type: messageForm.type,
        message: messageForm.message,
        templateName: messageForm.templateName,
        templateLanguage: messageForm.templateLanguage,
        templateParams: messageForm.templateParams,
        tenant_id: selectedTenant.id
      };
      const result = await api.sendMessage(payload);
      setStatus('success');
      setLogs(prev => [`[${timestamp}] Success: ${result.message_id || tx("auto.k_471f24ef6b23")}`, ...prev]);
    } catch (error) {
      setStatus('error');
      setLogs(prev => [`[${timestamp}] Error: ${error.message || error.toString()}`, ...prev]);
    }
  };
  const readiness = {
    phone: !!selectedTenant?.phone_number_id,
    waba: !!selectedTenant?.waba_id,
    token: selectedTenant?.token_status === 'valid' || selectedTenant?.token_status === 'unchecked' || !selectedTenant?.token_status
  };
  const readyToSend = selectedTenant && readiness.phone && readiness.waba && serverOnline;
  return <Box sx={{
    p: {
      xs: 1.5,
      md: 3
    }
  }}>
            <Box sx={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: {
        xs: 'flex-start',
        md: 'center'
      },
      flexDirection: {
        xs: 'column',
        md: 'row'
      },
      mb: 3,
      gap: 1.5
    }}>
                <Box>
                    <PageTitle variant="h4" fontWeight={700} gutterBottom>{tx("auto.k_bea6ddddbceb")}

          </PageTitle>
                    <Typography variant="body2" color="text.secondary">{tx("auto.k_081a4cf45e36")}

          </Typography>
                </Box>
                <Box sx={{
        display: 'flex',
        gap: 1,
        flexWrap: 'wrap'
      }}>
                    <Chip icon={serverOnline ? <CheckCircleIcon /> : <ErrorIcon />} label={serverOnline === null ? tx("auto.k_f1fb20228a59") : serverOnline ? tx("auto.k_299df173478e") : tx("auto.k_e8fbb43d032d")} color={serverOnline ? 'success' : 'error'} variant="outlined" />

                    <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={() => {
          fetchTenants?.();
          checkServer();
        }}>{tx("auto.k_4309a75e6882")}


          </Button>
                </Box>
            </Box>

            <Grid container spacing={3}>
                <Grid size={{
        xs: 12,
        lg: 8
      }}>
                    <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 3
        }}>
                        <Card>
                            <CardContent>
                                <Typography component="h2" variant="h6" gutterBottom>{tx("auto.k_e93a2c5b21c3")}</Typography>
                                <Grid container spacing={2}>
                                    <Grid size={{
                  xs: 12,
                  md: 5
                }}>
                                        <FormControl fullWidth size="small">
                                            <InputLabel>{tx("auto.k_8adba91e1d87")}</InputLabel>
                                            <Select value={messageForm.tenantId} label={tx("auto.k_8adba91e1d87")} onChange={e => setMessageForm({
                      ...messageForm,
                      tenantId: e.target.value
                    })} disabled={tenantsLoading}>

                                                {tenants.map(t => <MenuItem key={t.id} value={String(t.id)}>
                                                        {t.name} {t.phone_number_id ? '' : tx("auto.k_f8da151878eb")}
                                                    </MenuItem>)}
                                            </Select>
                                        </FormControl>
                                    </Grid>
                                    <Grid size={{
                  xs: 12,
                  md: 7
                }}>
                                        <Box sx={{
                    display: 'flex',
                    gap: 1,
                    flexWrap: 'wrap'
                  }}>
                                            <Chip label={readiness.phone ? tx("auto.k_74bea2f7158e") : tx("auto.k_05b0694ff00d")} color={readiness.phone ? 'success' : 'warning'} variant="outlined" />
                                            <Chip label={readiness.waba ? tx("auto.k_2eadf40a609d") : tx("auto.k_c20e195dd406")} color={readiness.waba ? 'success' : 'warning'} variant="outlined" />
                                            <Chip label={`Token: ${selectedTenant?.token_status || 'unchecked'}`} color={readiness.token ? 'success' : 'error'} variant="outlined" />
                                        </Box>
                                    </Grid>
                                </Grid>
                                {!readyToSend && <Alert severity="warning" sx={{
                mt: 2
              }}>{tx("auto.k_bb282ebc6d18")}

                </Alert>}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardContent>
                                <Typography component="h2" variant="h6" gutterBottom sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                mb: 2
              }}>
                                    <SmartphoneIcon color="primary" />{tx("auto.k_60d76a48827f")}

                </Typography>

                                <form onSubmit={handleSend}>
                                    <Grid container spacing={2}>
                                        <Grid size={{
                    xs: 12
                  }}>
                                            <TextField fullWidth label={tx("auto.k_cabc4369b269")} value={messageForm.recipient} onChange={e => setMessageForm({
                      ...messageForm,
                      recipient: e.target.value
                    })} placeholder={tx("auto.k_99be1c90e57a")} required />

                                        </Grid>

                                        <Grid size={{
                    xs: 12
                  }}>
                                            <FormControl>
                                                <RadioGroup row value={messageForm.type} onChange={e => setMessageForm({
                        ...messageForm,
                        type: e.target.value
                      })}>
                                                    <FormControlLabel value="text" control={<Radio />} label={tx("auto.k_4ddc2135457a")} />
                                                    <FormControlLabel value="template" control={<Radio />} label={tx("auto.k_ef5ae44f1b19")} />
                                                </RadioGroup>
                                            </FormControl>
                                        </Grid>

                                        {messageForm.type === 'text' ? <Grid size={{
                    xs: 12
                  }}>
                                                <TextField fullWidth multiline rows={4} label={tx("auto.k_691773aa9290")} value={messageForm.message} onChange={e => setMessageForm({
                      ...messageForm,
                      message: e.target.value
                    })} required />

                                            </Grid> : <>
                                                <Grid size={{
                      xs: 12,
                      sm: 6
                    }}>
                                                    <TextField fullWidth label={tx("auto.k_658266a2fac1")} value={messageForm.templateName} onChange={e => setMessageForm({
                        ...messageForm,
                        templateName: e.target.value
                      })} required />
                                                </Grid>
                                                <Grid size={{
                      xs: 12,
                      sm: 6
                    }}>
                                                    <TextField fullWidth label={tx("auto.k_41a7f4520484")} value={messageForm.templateLanguage} onChange={e => setMessageForm({
                        ...messageForm,
                        templateLanguage: e.target.value
                      })} required />
                                                </Grid>
                                                <Grid size={{
                      xs: 12
                    }}>
                                                    <Box sx={{
                        mt: 1,
                        pt: 2,
                        borderTop: 1,
                        borderColor: 'divider'
                      }}>
                                                        <Box sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          mb: 1
                        }}>
                                                            <Typography variant="subtitle2">{tx("auto.k_0ce4b0efaaaa")}</Typography>
                                                            <Button size="small" startIcon={<AddIcon />} onClick={addParam}>{tx("auto.k_5e3a3fdfce20")}</Button>
                                                        </Box>
                                                        {getBodyParams().map((param, index) => <Box key={index} sx={{
                          display: 'flex',
                          gap: 1,
                          mb: 1
                        }}>
                                                                <Typography variant="body2" color="text.secondary" sx={{
                            pt: 1,
                            width: 42
                          }}>{`{{${index + 1}}}`}</Typography>
                                                                <TextField fullWidth size="small" value={param.text} onChange={e => updateParam(index, e.target.value)} />
                                                                <IconButton size="small" aria-label="Remove template parameter" onClick={() => removeParam(index)} color="error"><DeleteIcon fontSize="small" /></IconButton>
                                                            </Box>)}
                                                    </Box>
                                                </Grid>
                                            </>}

                                        <Grid size={{
                    xs: 12
                  }}>
                                            <Button type="submit" variant="contained" size="large" fullWidth disabled={status === 'loading' || !readyToSend} startIcon={status === 'loading' ? <CircularProgress size={18} color="inherit" /> : <SendIcon />}>

                                                {status === 'loading' ? tx("auto.k_b303cc20c191") : tx("auto.k_04865e665deb")}
                                            </Button>
                                        </Grid>
                                    </Grid>
                                </form>
                            </CardContent>
                        </Card>
                    </Box>
                </Grid>

                <Grid size={{
        xs: 12,
        lg: 4
      }}>
                    <Card sx={{
          height: '100%',
          minHeight: 420,
          display: 'flex',
          flexDirection: 'column'
        }}>
                        <CardContent sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            p: 2
          }}>
                            <Typography component="h2" variant="h6" gutterBottom sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1
            }}>
                                <TerminalIcon color="action" />{tx("auto.k_77a31626380d")}

              </Typography>
                            <Box sx={{
              bgcolor: '#0d0d0d',
              borderRadius: 1,
              p: 2,
              flex: 1,
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: '0.875rem'
            }}>
                                {logs.length === 0 && <Typography sx={{ color: '#d1d5db' }} variant="body2">{tx("auto.k_a2f02bc5b97e")}</Typography>}
                                {logs.map((log, i) => <Box key={i} sx={{
                color: log.includes('Success') ? '#4ade80' : '#f87171',
                borderBottom: '1px solid #333',
                pb: 1,
                mb: 1
              }}>
                                        {log}
                                    </Box>)}
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>
        </Box>;
};
export default WhatsAppConsole;
