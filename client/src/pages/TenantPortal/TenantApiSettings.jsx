import React, { useState, useEffect } from 'react';
import { Box, Card, CardContent, Typography, Button, TextField, Switch, FormControlLabel, Alert, CircularProgress, Divider, IconButton, InputAdornment, Paper, Tooltip, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import { ContentCopy as CopyIcon, Visibility as VisibilityIcon, VisibilityOff as VisibilityOffIcon, Refresh as RefreshIcon, Save as SaveIcon, ExpandMore as ExpandMoreIcon, Code as CodeIcon } from '@mui/icons-material';
import api from '../../api';
import { tx } from "../../i18n/tx";
const TenantApiSettings = () => {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [formData, setFormData] = useState({
    webhook_url: '',
    callback_url: '',
    is_active: true
  });
  useEffect(() => {
    fetchSettings();
  }, []);
  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getPortalApiSettings();
      setSettings(data);
      setFormData({
        webhook_url: data.webhook_url || '',
        callback_url: data.callback_url || '',
        is_active: data.is_active ?? true
      });
    } catch (err) {
      console.error('Failed to fetch settings:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      await api.updatePortalApiSettings(formData);
      setSuccess(tx("auto.k_17764f5b6931"));
      fetchSettings();
    } catch (err) {
      console.error('Failed to save settings:', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  const handleRegenerateKey = async () => {
    if (!window.confirm(tx("auto.k_f6983313d26a"))) {
      return;
    }
    try {
      setRegenerating(true);
      setError(null);
      await api.regeneratePortalApiKey();
      setSuccess(tx("auto.k_7ac287780a8c"));
      fetchSettings();
    } catch (err) {
      console.error('Failed to regenerate key:', err);
      setError(err.message);
    } finally {
      setRegenerating(false);
    }
  };
  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    setSuccess(tx("auto.k_aa0fe1341a72", {
      value1: label
    }));
    setTimeout(() => setSuccess(null), 2000);
  };
  if (loading) {
    return <Box sx={{
      p: 3,
      textAlign: 'center'
    }}>
                <CircularProgress />
            </Box>;
  }
  const apiBaseUrl = window.location.origin;
  return <Box sx={{
    p: {
      xs: 1.5,
      md: 3
    }
  }}>
            {/* Header */}
            <Box sx={{
      mb: 4
    }}>
                <Typography variant="h4" fontWeight={700} gutterBottom>{tx("auto.k_dc090bbdeee1")}

        </Typography>
                <Typography variant="body2" color="text.secondary">{tx("auto.k_a4108c3b1449")}

        </Typography>
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

            {/* API Credentials */}
            <Card elevation={2} sx={{
      mb: 3
    }}>
                <CardContent>
                    <Typography variant="h6" fontWeight={600} gutterBottom>{tx("auto.k_fe7acea1037d")}

          </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{
          mb: 3
        }}>{tx("auto.k_353890e13f58")}

          </Typography>

                    <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 3
        }}>
                        <TextField label="API Key" value={showApiKey ? settings?.api_key || '' : '••••••••••••••••••••••••••••••••'} fullWidth InputProps={{
            readOnly: true,
            endAdornment: <InputAdornment position="end">
                                        <Tooltip title={showApiKey ? tx("auto.k_0804220142f6") : tx("auto.k_f2dde4fd8674")}>
                                            <IconButton onClick={() => setShowApiKey(!showApiKey)}>
                                                {showApiKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title={tx("auto.k_46e6841e2136")}>
                                            <IconButton onClick={() => copyToClipboard(settings?.api_key, 'API Key')}>
                                                <CopyIcon />
                                            </IconButton>
                                        </Tooltip>
                                    </InputAdornment>
          }} />


                        <TextField label="Webhook Secret" value={showWebhookSecret ? settings?.webhook_secret || '' : '••••••••••••••••'} fullWidth InputProps={{
            readOnly: true,
            endAdornment: <InputAdornment position="end">
                                        <Tooltip title={showWebhookSecret ? tx("auto.k_0804220142f6") : tx("auto.k_f2dde4fd8674")}>
                                            <IconButton onClick={() => setShowWebhookSecret(!showWebhookSecret)}>
                                                {showWebhookSecret ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title={tx("auto.k_46e6841e2136")}>
                                            <IconButton onClick={() => copyToClipboard(settings?.webhook_secret, 'Webhook Secret')}>
                                                <CopyIcon />
                                            </IconButton>
                                        </Tooltip>
                                    </InputAdornment>
          }} helperText={tx("auto.k_ce74c1aa8022")} />


                        <Button variant="outlined" color="warning" startIcon={regenerating ? <CircularProgress size={20} /> : <RefreshIcon />} onClick={handleRegenerateKey} disabled={regenerating} sx={{
            alignSelf: 'flex-start'
          }}>{tx("auto.k_f51ae960b133")}


            </Button>
                    </Box>
                </CardContent>
            </Card>

            {/* Webhook Settings */}
            <Card elevation={2} sx={{
      mb: 3
    }}>
                <CardContent>
                    <Typography variant="h6" fontWeight={600} gutterBottom>{tx("auto.k_ab70b8ee6e26")}

          </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{
          mb: 3
        }}>{tx("auto.k_cf56e2fc31ed")}

          </Typography>

                    <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 3
        }}>
                        <TextField label="Webhook URL" value={formData.webhook_url} onChange={e => setFormData({
            ...formData,
            webhook_url: e.target.value
          })} fullWidth placeholder="https://example.com/webhook" helperText={tx("auto.k_99c8c48ba8dc")} />


                        <TextField label={tx("auto.k_e1282da8be79")} value={formData.callback_url} onChange={e => setFormData({
            ...formData,
            callback_url: e.target.value
          })} fullWidth placeholder="https://example.com/callback" helperText={tx("auto.k_763e2bf8e078")} />


                        <FormControlLabel control={<Switch checked={formData.is_active} onChange={e => setFormData({
            ...formData,
            is_active: e.target.checked
          })} />} label={tx("auto.k_7156e850eb36")} />


                        <Button variant="contained" startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />} onClick={handleSave} disabled={saving} sx={{
            alignSelf: 'flex-start'
          }}>{tx("auto.k_a5b4472cdfcd")}


            </Button>
                    </Box>
                </CardContent>
            </Card>

            {/* API Documentation */}
            <Card elevation={2}>
                <CardContent>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                        <CodeIcon sx={{
            mr: 1,
            verticalAlign: 'middle'
          }} />{tx("auto.k_bdae0996e0f9")}

          </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{
          mb: 3
        }}>{tx("auto.k_ab5b9bf9bb9b")}
            <code>X-API-Key</code>{tx("auto.k_7ab59166aede")}
          </Typography>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>{tx("auto.k_f2b54a80c60f")}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{
              mb: 2
            }}>
                                <strong>POST</strong> {apiBaseUrl}/api/v1/messages/send
                            </Typography>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {tx("auto.k_335a4f1d8f2c")}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>{tx("auto.k_638a8b73b7f3")}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{
              mb: 2
            }}>
                                <strong>POST</strong> {apiBaseUrl}/api/v1/messages/send
                            </Typography>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {tx("auto.k_33056e4072e0")}
                                </pre>
                            </Paper>

                            <Typography variant="body2" sx={{
              mt: 2,
              mb: 1
            }}>{tx("auto.k_010cd450a27a")}

              </Typography>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {tx("auto.k_197fa3830906")}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>{tx("auto.k_5139ca423ca0")}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{
              mb: 2
            }}>
                                <strong>POST</strong> {apiBaseUrl}/api/v1/messages/send-media
                            </Typography>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {tx("auto.k_ecba3ef83cfd")}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>{tx("auto.k_e0b69f80f2f9")}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{
              mb: 2
            }}>
                                <strong>POST</strong> {apiBaseUrl}/api/v1/messages/send-interactive
                            </Typography>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {tx("auto.k_ebd0fcdd7b43")}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>{tx("auto.k_0160d5c48f36")}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{
              mb: 2
            }}>
                                <strong>POST</strong> {apiBaseUrl}/api/v1/messages/send-document
                            </Typography>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {tx("auto.k_eb7e6295c92a")}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>{tx("auto.k_319a086f30f6")}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{
              mb: 2
            }}>{tx("auto.k_6cbdd0b741b5")}

              </Typography>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {tx("auto.k_9ba9e48cd936")}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>{tx("auto.k_c31bfed8e2f2")}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{
              mb: 2
            }}>{tx("auto.k_9424e41d2aee")}

              </Typography>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {`Headers:
  Content-Type: application/json
  X-Signature: sha256=abc123...
  X-Tenant-Id: 6

Body:
{
  "event": "message_status",
  "timestamp": "2024-01-05T10:35:00Z",
  "tenant_id": 6,
  "data": {
    "message_id": "wamid.xxx",
    "status": "delivered",  // sent, delivered, read, failed
    "recipient": "218912345678",
    "timestamp": "2024-01-05T10:35:00Z"
  }
}`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>{tx("auto.k_b69979045084")}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{
              mb: 2
            }}>
                                <strong>GET</strong> {apiBaseUrl}/api/v1/conversations
                            </Typography>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {tx("auto.k_9b8e9a4727ed")}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>{tx("auto.k_06adb315a55b")}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{
              mb: 2
            }}>
                                <strong>GET</strong> {apiBaseUrl}/api/v1/conversations/:phone/messages
                            </Typography>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {tx("auto.k_7b3d8ba5a5d7")}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>{tx("auto.k_7412da26deb8")}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{
              mb: 2
            }}>
                                <strong>GET</strong> {apiBaseUrl}/api/v1/templates
                            </Typography>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {tx("auto.k_00b25705eaa1")}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>{tx("auto.k_788736dda059")}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{
              mb: 2
            }}>
                                <strong>GET</strong> {apiBaseUrl}/api/v1/templates/:id
                            </Typography>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {tx("auto.k_722b6f960cad", {
                  value1: apiBaseUrl
                })}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>{tx("auto.k_a062136eba7e")}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{
              mb: 2
            }}>
                                <strong>POST</strong> {apiBaseUrl}/api/v1/events
                            </Typography>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {tx("auto.k_149fa16c1c66")}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>{tx("auto.k_75efef7b35f9")}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{
              mb: 2
            }}>
                                <strong>GET</strong> {apiBaseUrl}/api/v1/events/history
                            </Typography>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {`Headers:
  X-API-Key: YOUR_API_KEY

Query Parameters:
  limit: 50 (optional, default: 50)
  offset: 0 (optional, default: 0)

Response:
{
  "events": [
    {
      "id": 1,
      "event_name": "purchase",
      "status": "sent",
      "phone": "218912345678",
      "created_at": "2024-01-05T10:30:00Z",
      "custom_data": "{\\"currency\\":\\"LYD\\",\\"value\\":\\"150\\"}"
    }
  ],
  "total": 120,
  "limit": 50,
  "offset": 0
}`}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>{tx("auto.k_abb636da2dd5")}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{
              mb: 2
            }}>
                                <strong>GET</strong> {apiBaseUrl}/api/v1/health
                            </Typography>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {tx("auto.k_87ab1fc6e15f")}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>{tx("auto.k_145afedf9a04")}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography variant="body2" sx={{
              mb: 2
            }}>{tx("auto.k_e7a477f7b2ed")}

              </Typography>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {tx("auto.k_8b287d835c3c")}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>

                    <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={500}>{tx("auto.k_1346b0ec041e")}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Paper sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              overflow: 'auto'
            }}>
                                <pre style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                  {tx("auto.k_8f29fb899169")}
                                </pre>
                            </Paper>
                        </AccordionDetails>
                    </Accordion>
                </CardContent>
            </Card>
        </Box>;
};
export default TenantApiSettings;
