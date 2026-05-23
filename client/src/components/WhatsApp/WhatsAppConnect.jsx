import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, Button, CircularProgress, Alert, Snackbar, Stepper, Step, StepLabel, TextField, Divider } from '@mui/material';
import { WhatsApp as WhatsAppIcon, CheckCircle as CheckCircleIcon } from '@mui/icons-material';
import api from '../../api';
import { tx } from "../../i18n/tx";
const getSteps = () => [tx("auto.k_db4f24f2031d"), tx("auto.k_d5b468e399c4"), tx("auto.k_e6537128f021")];
const WhatsAppConnect = ({
  onComplete
}) => {
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState(null);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success'
  });
  const [formData, setFormData] = useState({
    code: '',
    phone_number_id: '',
    waba_id: '',
    business_id: ''
  });
  const [sdkReady, setSdkReady] = useState(false);
  useEffect(() => {
    api.getMetaConfig().then(cfg => {
      setConfig(cfg);
      if (cfg.whatsapp_signup_available && cfg.app_id) {
        if (window.FB) {
          setSdkReady(true);
          return;
        }
        window.fbAsyncInit = function () {
          window.FB.init({
            appId: cfg.app_id,
            autoLogAppEvents: true,
            xfbml: false,
            version: cfg.api_version || 'v25.0'
          });
          setSdkReady(true);
        };
        if (document.getElementById('facebook-jssdk')) return;
        const script = document.createElement('script');
        script.id = 'facebook-jssdk';
        script.src = 'https://connect.facebook.net/en_US/sdk.js';
        script.async = true;
        script.onerror = () => setError(tx("auto.k_79c770866e1b"));
        document.head.appendChild(script);
        setTimeout(() => {
          if (!window.FB) {
            setError(tx("auto.k_3e341d6a9586"));
          }
        }, 15000);
      }
    }).catch(() => {});
  }, []);
  const handleEmbeddedSignup = () => {
    if (!window.FB || !config?.config_id) {
      setError(tx("auto.k_ee56c8749b16"));
      return;
    }
    setError('');

    // Session info (phone_number_id, waba_id) arrives via sessionInfoListener,
    // NOT in authResponse. We capture it here and combine with the code.
    let sessionInfo = {
      phone_number_id: '',
      waba_id: ''
    };

    // Also listen for the WA_EMBEDDED_SIGNUP message event as fallback
    const messageHandler = event => {
      if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data.type === 'WA_EMBEDDED_SIGNUP') {
          sessionInfo.phone_number_id = data.data?.phone_number_id || '';
          sessionInfo.waba_id = data.data?.waba_id || '';
        }
      } catch {/* ignore non-JSON messages */}
    };
    window.addEventListener('message', messageHandler);
    window.FB.login(response => {
      window.removeEventListener('message', messageHandler);
      if (response.authResponse?.code) {
        const code = response.authResponse.code;
        const phoneId = sessionInfo.phone_number_id;
        const wabaId = sessionInfo.waba_id;
        if (!wabaId || !phoneId) {
          // Auto-fill what we have so user can complete manually
          setFormData(prev => ({
            ...prev,
            code,
            phone_number_id: phoneId,
            waba_id: wabaId
          }));
          setError(tx("auto.k_de1444b932b3"));
          return;
        }
        setFormData({
          code,
          phone_number_id: phoneId,
          waba_id: wabaId,
          business_id: ''
        });
        setActiveStep(2);
        handleSubmitConnect(code, phoneId, wabaId, '');
      } else if (response.status === 'not_authorized') {
        setError(tx("auto.k_a50b09067579"));
      } else {
        setError(tx("auto.k_3866451bd775"));
      }
    }, {
      config_id: config.config_id,
      response_type: 'code',
      override_default_response_type: true,
      extras: {
        setup: {},
        featureType: '',
        sessionInfoListener: info => {
          // Meta sends phone_number_id and waba_id here
          sessionInfo.phone_number_id = info.phone_number_id || '';
          sessionInfo.waba_id = info.waba_id || '';
        }
      }
    });
  };
  const handleSubmitConnect = async (code, phoneId, wabaId, bizId) => {
    try {
      setLoading(true);
      setError('');
      setActiveStep(2);
      await api.connectWhatsApp(code, phoneId, wabaId, bizId);
      setActiveStep(3);
      setSnackbar({
        open: true,
        message: tx("auto.k_1185048de67b"),
        severity: 'success'
      });
      if (onComplete) onComplete();
    } catch (err) {
      setError(err.message || tx("auto.k_171dcead3182"));
      setActiveStep(1);
    } finally {
      setLoading(false);
    }
  };
  const handleManualSubmit = () => {
    if (!formData.code || !formData.phone_number_id || !formData.waba_id) {
      setError(tx("auto.k_b11534fcd58e"));
      return;
    }
    handleSubmitConnect(formData.code, formData.phone_number_id, formData.waba_id, formData.business_id);
  };
  if (!config) {
    return <Paper sx={{
      p: 4,
      textAlign: 'center'
    }}>
                <CircularProgress />
            </Paper>;
  }
  if (!config.whatsapp_signup_available) {
    return <Paper sx={{
      p: 4,
      textAlign: 'center'
    }}>
                <WhatsAppIcon sx={{
        fontSize: 48,
        color: 'grey.400',
        mb: 2
      }} />
                <Typography color="text.secondary">{tx("auto.k_47c49f241b0b")}

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
                    <WhatsAppIcon sx={{
        fontSize: 48,
        color: '#25D366',
        mb: 2
      }} />
                    <Typography variant="h6" gutterBottom>{tx("auto.k_5e0863869cd2")}</Typography>
                    <Typography color="text.secondary" sx={{
        mb: 3
      }}>{tx("auto.k_4b44582e744d")}

        </Typography>
                    <Button variant="contained" size="large" startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <WhatsAppIcon />} onClick={handleEmbeddedSignup} disabled={loading || !sdkReady} sx={{
        bgcolor: '#25D366',
        '&:hover': {
          bgcolor: '#1da851'
        }
      }}>{tx("auto.k_cfd849df69a2")}


        </Button>
                    {!sdkReady && <Typography variant="caption" color="text.secondary" sx={{
        display: 'block',
        mt: 1
      }}>{tx("auto.k_dc9b7a91600f")}

        </Typography>}

                    <Divider sx={{
        my: 3
      }}>{tx("auto.k_737be522c9b1")}</Divider>

                    <Box sx={{
        maxWidth: 500,
        mx: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 2
      }}>
                        <TextField label={tx("auto.k_e5d1a2079ffd")} value={formData.code} onChange={e => setFormData(prev => ({
          ...prev,
          code: e.target.value
        }))} size="small" fullWidth />

                        <TextField label={tx("auto.k_21bfb4487326")} value={formData.phone_number_id} onChange={e => setFormData(prev => ({
          ...prev,
          phone_number_id: e.target.value
        }))} size="small" fullWidth />

                        <TextField label={tx("auto.k_499dc6058c91")} value={formData.waba_id} onChange={e => setFormData(prev => ({
          ...prev,
          waba_id: e.target.value
        }))} size="small" fullWidth />

                        <TextField label={tx("auto.k_09d3e72f7373")} value={formData.business_id} onChange={e => setFormData(prev => ({
          ...prev,
          business_id: e.target.value
        }))} size="small" fullWidth />

                        <Button variant="outlined" onClick={handleManualSubmit} disabled={loading}>{tx("auto.k_7857e2b7fbc0")}

          </Button>
                    </Box>
                </Box>}

            {activeStep === 2 && <Box sx={{
      textAlign: 'center',
      py: 4
    }}>
                    <CircularProgress sx={{
        mb: 2
      }} />
                    <Typography>{tx("auto.k_d4c6128a9a48")}</Typography>
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
                    <Typography color="text.secondary">{tx("auto.k_b8800a83510e")}

        </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{
        mt: 1
      }}>
                        WABA: {formData.waba_id} | Phone: {formData.phone_number_id}
                    </Typography>
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
export default WhatsAppConnect;
