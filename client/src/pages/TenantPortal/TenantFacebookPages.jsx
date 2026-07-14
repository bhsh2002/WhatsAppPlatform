import React, { useState, useEffect, useCallback } from 'react';
import { Box, Paper, Typography, CircularProgress, Alert, Snackbar, Grid, Card, CardContent, Chip, Avatar, Button, Dialog, DialogTitle, DialogContent, DialogActions, Divider } from '@mui/material';
import { Facebook as FacebookIcon, CloudDone as CloudDoneIcon, CloudOff as CloudOffIcon, Refresh as RefreshIcon, CheckCircle as CheckCircleIcon, Cancel as CancelIcon, Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import api from '../../api';
import FacebookConnect from '../../components/Facebook/FacebookConnect';
import { tx } from "../../i18n/tx";
import { PageTitle } from '../../components/Layout/PageTitle';
import { getCurrentLocale } from "../../utils/locale";
const TenantFacebookPages = () => {
  const [pages, setPages] = useState([]);
  const [diagnostics, setDiagnostics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success'
  });
  const [subStatusPage, setSubStatusPage] = useState(null);
  const [subStatusData, setSubStatusData] = useState(null);
  const [subStatusLoading, setSubStatusLoading] = useState(false);
  const [disconnectDialog, setDisconnectDialog] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const fetchPages = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [data, diag] = await Promise.all([api.getPortalPages(), api.getFacebookDiagnostics().catch(() => null)]);
      setPages(Array.isArray(data) ? data : []);
      setDiagnostics(diag);
    } catch (err) {
      setError(err.message || tx("auto.k_1ed9ae47d39b"));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    fetchPages();
  }, [fetchPages]);
  const checkSubscription = async page => {
    try {
      setSubStatusLoading(true);
      setSubStatusPage(page.id);
      const data = await api.getPortalPageSubscriptionStatus(page.id);
      setSubStatusData(data);
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.message || tx("auto.k_587090b5cdd3"),
        severity: 'error'
      });
    } finally {
      setSubStatusLoading(false);
    }
  };
  const handleDisconnect = async () => {
    if (!disconnectDialog) return;
    try {
      setDisconnecting(true);
      await api.disconnectFacebookPage(disconnectDialog.id);
      setSnackbar({
        open: true,
        message: tx("auto.k_ea239141895e", {
          value1: disconnectDialog.page_name
        }),
        severity: 'success'
      });
      setDisconnectDialog(null);
      fetchPages();
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.message || tx("auto.k_eedb7a400f79"),
        severity: 'error'
      });
    } finally {
      setDisconnecting(false);
    }
  };
  const formatDate = ts => {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleDateString(getCurrentLocale());
    } catch {
      return ts;
    }
  };
  if (loading) {
    return <Box sx={{
      display: 'flex',
      justifyContent: 'center',
      p: 6
    }}><CircularProgress /></Box>;
  }
  return <Box sx={{
    p: {
      xs: 1.5,
      md: 3
    }
  }}>
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
      mb: 3,
      gap: {
        xs: 1,
        md: 0
      }
    }}>
                <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2
      }}>
                    <FacebookIcon sx={{
          fontSize: 32,
          color: '#1877f2'
        }} />
                    <Box>
                        <PageTitle variant="h4" fontWeight={700}>{tx("auto.k_b77cc799dc2a")}</PageTitle>
                        <Typography variant="body2" color="text.secondary">{tx("auto.k_fa9dfda659d6")}</Typography>
                    </Box>
                </Box>
            </Box>

            <Paper sx={{
      p: 2,
      mb: 3
    }}>
                <Box sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap'
      }}>
                    <Box>
                        <Typography component="h2" variant="h6">{tx("auto.k_fbc00016e89a")}</Typography>
                        <Typography variant="body2" color="text.secondary">{tx("auto.k_b2705c6a1390")}

            </Typography>
                    </Box>
                    <Box sx={{
          display: 'flex',
          gap: 1,
          flexWrap: 'wrap'
        }}>
                        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setShowConnect(!showConnect)}>
                            {showConnect ? tx("auto.k_0804220142f6") : tx("auto.k_137d14ec3a81")}
                        </Button>
                        <Button startIcon={<RefreshIcon />} onClick={fetchPages} variant="outlined">{tx("auto.k_4309a75e6882")}

            </Button>
                    </Box>
                </Box>
            </Paper>

            {showConnect && <Box sx={{
      mb: 3
    }}>
                    <FacebookConnect onComplete={() => {
        setShowConnect(false);
        fetchPages();
      }} />
                </Box>}

            {error && <Alert severity="error" sx={{
      mb: 2
    }}>{error}</Alert>}

            {diagnostics?.facebook_user_token_present && <Alert severity={diagnostics.missing_scopes?.length ? 'warning' : 'success'} sx={{
      mb: 2
    }}>
                    <Typography variant="body2" fontWeight={600}>{tx("auto.k_8239ec41f9b5")}
          {diagnostics.missing_scopes?.length ? tx("auto.k_6d25b66d46ed") : tx("auto.k_439f7dbbbbf8")}
                    </Typography>
                    <Typography variant="caption" component="div">{tx("auto.k_3516d6abe9bc")}
          {diagnostics.granted_scopes?.length || 0} / {diagnostics.requested_scopes?.length || 0}
                    </Typography>
                    {diagnostics.missing_scopes?.length > 0 && <Typography variant="caption" component="div">{tx("auto.k_9acb2d123c61")}
          {diagnostics.missing_scopes.join(', ')}
                        </Typography>}
                </Alert>}

            {diagnostics?.facebook_user_token_present && <Paper sx={{
      p: 2,
      mb: 3
    }}>
                    <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap'
      }}>
                        <Avatar src={diagnostics.facebook_user_identity?.picture_url || undefined} sx={{
          bgcolor: '#1877f2'
        }}>
                            {diagnostics.facebook_user_identity?.name?.charAt(0) || <FacebookIcon />}
                        </Avatar>
                        <Box sx={{
          flex: 1,
          minWidth: 220
        }}>
                            <Typography variant="subtitle1" fontWeight={700}>
                                {diagnostics.facebook_user_identity?.name || tx("auto.k_ddeddbc74f32")}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                {diagnostics.facebook_user_identity?.email || tx("auto.k_14e4cae13561")}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" component="div">
                                ID: {diagnostics.facebook_user_identity?.id || '-'}{tx("auto.k_3aed098998a0")}{formatDate(diagnostics.facebook_user_identity?.updated_at)}
                            </Typography>
                        </Box>
                        <Box sx={{
          display: 'flex',
          gap: 1,
          flexWrap: 'wrap'
        }}>
                            <Chip label={diagnostics.facebook_user_identity?.public_profile_ready ? tx("auto.k_3dd7ad8684e6") : tx("auto.k_ba165925b58d")} color={diagnostics.facebook_user_identity?.public_profile_ready ? 'success' : 'warning'} size="small" variant="outlined" />

                            <Chip label={diagnostics.facebook_user_identity?.email_ready ? tx("auto.k_9ff93183f88f") : diagnostics.facebook_user_identity?.email_granted ? tx("auto.k_a7e1aa943e01") : tx("auto.k_8244bebb4798")} color={diagnostics.facebook_user_identity?.email_ready ? 'success' : 'warning'} size="small" variant="outlined" />

                        </Box>
                    </Box>
                </Paper>}

            {pages.length === 0 ? <Paper sx={{
      p: 6,
      textAlign: 'center'
    }}>
                    <FacebookIcon sx={{
        fontSize: 60,
        color: 'grey.300',
        mb: 2
      }} />
                    <Typography component="p" variant="h6" color="text.secondary">{tx("auto.k_43a46f260ab6")}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{
        mb: 2
      }}>{tx("auto.k_0a6b03d9b9ac")}

        </Typography>
                    <Button variant="contained" startIcon={<AddIcon />} onClick={() => setShowConnect(true)}>{tx("auto.k_b106d1c69181")}

        </Button>
                </Paper> : <Grid container spacing={3}>
                    {pages.map(page => <Grid size={{
        xs: 12,
        md: 6
      }} key={page.id}>
                            <Card sx={{
          height: '100%'
        }}>
                                <CardContent>
                                    <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              mb: 2
            }}>
                                        <Avatar src={page.page_picture_url} sx={{
                width: 56,
                height: 56,
                bgcolor: '#1877f2'
              }}>

                                            <FacebookIcon />
                                        </Avatar>
                                        <Box sx={{
                flex: 1
              }}>
                                            <Typography component="h3" variant="h6" fontWeight={600}>
                                                {page.page_name || page.page_id}
                                            </Typography>
                                            {page.page_category && <Typography variant="body2" color="text.secondary">
                                                    {page.page_category}
                                                </Typography>}
                                        </Box>
                                        <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
                alignItems: 'flex-end'
              }}>
                                            {page.is_active ? <Chip icon={<CheckCircleIcon />} label={tx("auto.k_c9734087a2e1")} size="small" color="success" /> : <Chip icon={<CancelIcon />} label={tx("auto.k_7ac8f21ec817")} size="small" color="error" />}
                                            {page.webhook_subscribed ? <Chip icon={<CloudDoneIcon />} label={tx("auto.k_a57e024a0c7b")} size="small" color="primary" variant="outlined" /> : <Chip icon={<CloudOffIcon />} label={tx("auto.k_20f15d4c0ce9")} size="small" color="warning" variant="outlined" />}
                                        </Box>
                                    </Box>

                                    <Divider sx={{
              my: 1.5
            }} />

                                    <Box sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
                                        <Typography variant="caption" color="text.secondary">{tx("auto.k_8b2cd5c320e0")}
                  {formatDate(page.created_at)}
                                        </Typography>
                                        <Box sx={{
                display: 'flex',
                gap: 1
              }}>
                                            <Button size="small" variant="text" onClick={() => checkSubscription(page)} disabled={subStatusLoading && subStatusPage === page.id}>

                                                {subStatusLoading && subStatusPage === page.id ? tx("auto.k_a786bc53bb3e") : tx("auto.k_82c319206e6b")}
                                            </Button>
                                            <Button size="small" variant="text" color="error" startIcon={<DeleteIcon />} onClick={() => setDisconnectDialog(page)}>{tx("auto.k_1d0dc1931d03")}


                  </Button>
                                        </Box>
                                    </Box>

                                    {subStatusPage === page.id && subStatusData && <Alert severity="info" sx={{
              mt: 1.5,
              fontSize: '0.8rem'
            }}>
                                            <Typography variant="caption" component="div">{tx("auto.k_7c4878a98b0e")}
                  {subStatusData.webhook_subscribed_in_db ? tx("auto.k_6e73793ec3cc") : tx("auto.k_17ce54039308")}
                                            </Typography>
                                            {subStatusData.meta_response?.data?.length > 0 && <Typography variant="caption" component="div" sx={{
                mt: 0.5
              }}>{tx("auto.k_48916fb64987")}
                  {subStatusData.meta_response.data.map(s => s.name || s).join(', ')}
                                                </Typography>}
                                        </Alert>}
                                </CardContent>
                            </Card>
                        </Grid>)}
                </Grid>}


            <Dialog open={!!disconnectDialog} onClose={() => setDisconnectDialog(null)} slotProps={{ paper: { 'aria-label': tx("auto.k_827369dee439") } }}>
                <DialogTitle>{tx("auto.k_827369dee439")}</DialogTitle>
                <DialogContent>
                    <Typography>{tx("auto.k_14db208675a8")}
            {disconnectDialog?.page_name}{tx("auto.k_35d364226bb5")}
          </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{
          mt: 1
        }}>{tx("auto.k_427f77311a59")}

          </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDisconnectDialog(null)}>{tx("auto.k_e776b0209b50")}</Button>
                    <Button onClick={handleDisconnect} color="error" variant="contained" disabled={disconnecting}>
                        {disconnecting ? <CircularProgress size={20} /> : tx("auto.k_1d0dc1931d03")}
                    </Button>
                </DialogActions>
            </Dialog>

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
        </Box>;
};
export default TenantFacebookPages;
