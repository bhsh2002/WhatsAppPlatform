import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, Button, CircularProgress, Alert, Stepper, Step, StepLabel, Checkbox, FormControlLabel, Avatar, List, ListItem, ListItemAvatar, ListItemText, ListItemSecondaryAction, Snackbar, Divider } from '@mui/material';
import { Facebook as FacebookIcon, Link as LinkIcon, CheckCircle as CheckCircleIcon } from '@mui/icons-material';
import api from '../../api';
import { tx } from "../../i18n/tx";
const getSteps = () => [tx("auto.k_8c6117b67c8b"), tx("auto.k_5c9ce184e9eb"), tx("auto.k_af9a0b2ae503")];
const FacebookConnect = ({
  onComplete
}) => {
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [available, setAvailable] = useState(false);
  const [oauthState, setOauthState] = useState('');
  const [code, setCode] = useState('');
  const [pages, setPages] = useState([]);
  const [selectedPages, setSelectedPages] = useState([]);
  const [linkState, setLinkState] = useState('');
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success'
  });
  useEffect(() => {
    api.getMetaConfig().then(cfg => {
      setAvailable(cfg.facebook_oauth_available);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    const handleMessage = event => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'FB_OAUTH_CALLBACK') {
        const {
          code: fbCode,
          state: fbState
        } = event.data;
        setCode(fbCode);
        setOauthState(fbState);
        handleConnect(fbCode, fbState);
      } else if (event.data?.type === 'FB_OAUTH_ERROR') {
        setError(event.data.error_description || event.data.error || tx("auto.k_a95d4366b1ac"));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);
  const handleStartAuth = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await api.getFacebookAuthUrl();
      setOauthState(data.state);
      window.open(data.url, '_blank', 'width=600,height=700');
      setActiveStep(1);
    } catch (err) {
      setError(err.message || tx("auto.k_dca9f4d201f6"));
    } finally {
      setLoading(false);
    }
  };
  const handleConnect = async (fbCode, fbState) => {
    try {
      setLoading(true);
      setError('');
      setActiveStep(1);
      const data = await api.connectFacebook(fbCode, fbState);
      setPages(data.pages || []);
      setLinkState(data.link_state);
      if (data.pages.length > 0) {
        setActiveStep(2);
      } else {
        setError(tx("auto.k_97e20304a7f6"));
      }
    } catch (err) {
      setError(err.message || tx("auto.k_263517a5acf7"));
      setActiveStep(0);
    } finally {
      setLoading(false);
    }
  };
  const handleLinkPages = async () => {
    if (selectedPages.length === 0) {
      setError(tx("auto.k_5d2b602c6307"));
      return;
    }
    try {
      setLoading(true);
      setError('');
      await api.linkFacebookPages(linkState, selectedPages);
      setActiveStep(3);
      setSnackbar({
        open: true,
        message: tx("auto.k_c13056d1a78e"),
        severity: 'success'
      });
      if (onComplete) onComplete();
    } catch (err) {
      setError(err.message || tx("auto.k_fae7a2aae64d"));
    } finally {
      setLoading(false);
    }
  };
  const togglePage = pageId => {
    setSelectedPages(prev => prev.includes(pageId) ? prev.filter(id => id !== pageId) : [...prev, pageId]);
  };
  const handleManualSubmit = () => {
    if (!code || !oauthState) {
      setError(tx("auto.k_a2107f8759c5"));
      return;
    }
    handleConnect(code, oauthState);
  };
  if (!available) {
    return <Paper sx={{
      p: 4,
      textAlign: 'center'
    }}>
                <FacebookIcon sx={{
        fontSize: 48,
        color: 'grey.400',
        mb: 2
      }} />
                <Typography color="text.secondary">{tx("auto.k_a8a59d1c368f")}

        </Typography>
            </Paper>;
  }
  return <Paper sx={{
    p: 3
  }}>
            <Stepper activeStep={activeStep} sx={{
      mb: 3
    }}>
                {getSteps().map(label => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
            </Stepper>

            {error && <Alert severity="error" sx={{
      mb: 2
    }}>{error}</Alert>}

            {activeStep === 0 && <Box sx={{
      textAlign: 'center',
      py: 3
    }}>
                    <FacebookIcon sx={{
        fontSize: 48,
        color: '#1877f2',
        mb: 2
      }} />
                    <Typography variant="h6" gutterBottom>{tx("auto.k_dd460b2dcb9c")}</Typography>
                    <Typography color="text.secondary" sx={{
        mb: 3
      }}>{tx("auto.k_fe7910cfbdda")}

        </Typography>
                    <Button variant="contained" size="large" startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <FacebookIcon />} onClick={handleStartAuth} disabled={loading} sx={{
        bgcolor: '#1877f2',
        '&:hover': {
          bgcolor: '#1565c0'
        }
      }}>{tx("auto.k_b7ddcb49b454")}


        </Button>

                    <Divider sx={{
        my: 3
      }}>{tx("auto.k_48a9a932513d")}</Divider>

                    <Box sx={{
        display: 'flex',
        gap: 2,
        maxWidth: 500,
        mx: 'auto'
      }}>
                        <input placeholder={tx("auto.k_e5d1a2079ffd")} value={code} onChange={e => setCode(e.target.value)} style={{
          flex: 1,
          padding: '8px 12px',
          borderRadius: 4,
          border: '1px solid #ccc'
        }} />

                        <input placeholder={tx("auto.k_60a8e4bc3992")} value={oauthState} onChange={e => setOauthState(e.target.value)} style={{
          flex: 1,
          padding: '8px 12px',
          borderRadius: 4,
          border: '1px solid #ccc'
        }} />

                        <Button variant="outlined" onClick={handleManualSubmit} disabled={loading}>{tx("auto.k_c91b0e1d24de")}

          </Button>
                    </Box>
                </Box>}

            {activeStep === 1 && <Box sx={{
      textAlign: 'center',
      py: 4
    }}>
                    <CircularProgress sx={{
        mb: 2
      }} />
                    <Typography>{tx("auto.k_243dd8e4366e")}</Typography>
                </Box>}

            {activeStep === 2 && <Box>
                    <Typography variant="h6" gutterBottom>{tx("auto.k_c1d34ed80310")}</Typography>
                    <List>
                        {pages.map(page => <ListItem key={page.id} dense button onClick={() => togglePage(page.id)}>
                                <ListItemAvatar>
                                    <Avatar src={page.picture_url} sx={{
              bgcolor: '#1877f2'
            }}>
                                        <FacebookIcon />
                                    </Avatar>
                                </ListItemAvatar>
                                <ListItemText primary={page.name} secondary={page.category || `ID: ${page.id}`} />

                                <ListItemSecondaryAction>
                                    <Checkbox checked={selectedPages.includes(page.id)} onChange={() => togglePage(page.id)} color="primary" />

                                </ListItemSecondaryAction>
                            </ListItem>)}
                    </List>
                    {pages.length === 0 && <Typography color="text.secondary" sx={{
        textAlign: 'center',
        py: 2
      }}>{tx("auto.k_e82839ee3f4b")}

        </Typography>}
                    <Box sx={{
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 1,
        mt: 2
      }}>
                        <Button onClick={() => setActiveStep(0)}>{tx("auto.k_328ddce5bbca")}</Button>
                        <Button variant="contained" onClick={handleLinkPages} disabled={loading || selectedPages.length === 0} startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <LinkIcon />}>{tx("auto.k_c91b0e1d24de")}

            {selectedPages.length > 0 ? `(${selectedPages.length})` : ''}
                        </Button>
                    </Box>
                </Box>}

            {activeStep === 3 && <Box sx={{
      textAlign: 'center',
      py: 3
    }}>
                    <CheckCircleIcon sx={{
        fontSize: 64,
        color: 'success.main',
        mb: 2
      }} />
                    <Typography variant="h6" gutterBottom>{tx("auto.k_1d13848b5c89")}</Typography>
                    <Typography color="text.secondary">{tx("auto.k_3971687e7824")}
          {selectedPages.length}{tx("auto.k_61e00284d031")}
        </Typography>
                    <Button sx={{
        mt: 2
      }} variant="outlined" onClick={() => {
        setActiveStep(0);
        setPages([]);
        setSelectedPages([]);
        setCode('');
        setOauthState('');
      }}>{tx("auto.k_f30eaffd1418")}

        </Button>
                </Box>}

            <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar(prev => ({
      ...prev,
      open: false
    }))}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({
        ...prev,
        open: false
      }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Paper>;
};
export default FacebookConnect;
