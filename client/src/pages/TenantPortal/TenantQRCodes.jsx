import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Paper, Button, TextField, CircularProgress, Alert, Snackbar, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Chip } from '@mui/material';
import { QrCode as QrCodeIcon, Add as AddIcon, Delete as DeleteIcon, ContentCopy as CopyIcon } from '@mui/icons-material';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { tx } from "../../i18n/tx";
const TenantQRCodes = () => {
  const {
    tenant
  } = useAuth();
  const [qrCodes, setQrCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const loadQRCodes = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getPortalQRCodes();
      setQrCodes(data.qr_codes || []);
    } catch (err) {
      setError(err.message || tx("auto.k_97885fc2ab1f"));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    loadQRCodes();
  }, [loadQRCodes]);
  const handleCreate = async () => {
    if (!newMessage.trim()) return;
    try {
      setCreating(true);
      await api.createPortalQRCode({
        prefilled_message: newMessage
      });
      setSuccess(tx("auto.k_b1738433aa03"));
      setCreateOpen(false);
      setNewMessage('');
      loadQRCodes();
    } catch (err) {
      setError(err.message || tx("auto.k_242b272bb4e2"));
    } finally {
      setCreating(false);
    }
  };
  const handleDelete = async qrCodeId => {
    if (!window.confirm(tx("auto.k_72c0e0ffe845"))) return;
    try {
      await api.deletePortalQRCode(qrCodeId);
      setSuccess(tx("auto.k_1a25abfddb52"));
      loadQRCodes();
    } catch (err) {
      setError(err.message || tx("auto.k_e141ac0ffa1f"));
    }
  };
  if (loading) {
    return <Box sx={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: 400
    }}>
                <CircularProgress />
            </Box>;
  }
  if (!tenant?.phone_number_id) {
    return <Box sx={{
      p: 3,
      textAlign: 'center'
    }}>
                <Alert severity="warning">{tx("auto.k_caf47d3992f0")}</Alert>
            </Box>;
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
      alignItems: {
        xs: 'flex-start',
        md: 'center'
      },
      justifyContent: 'space-between',
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
                    <QrCodeIcon sx={{
          fontSize: 32,
          color: 'secondary.main'
        }} />
                    <Box>
                        <Typography variant="h5" fontWeight={700}>{tx("auto.k_dab7cf0eed77")}</Typography>
                        <Typography variant="body2" color="text.secondary">{tx("auto.k_04b7033424c2")}</Typography>
                    </Box>
                </Box>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}><Box component="span" sx={{
          display: {
            xs: 'none',
            md: 'inline'
          }
        }}>{tx("auto.k_62b18e242d95")}</Box></Button>
            </Box>

            <Paper>
                <TableContainer sx={{
        overflowX: 'auto'
      }}>
                    <Table sx={{
          '& .MuiTableCell-root': {
            px: {
              xs: 1,
              md: 2
            },
            fontSize: {
              xs: '0.8rem',
              md: '0.875rem'
            }
          }
        }}>
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{
                whiteSpace: 'nowrap'
              }}>{tx("auto.k_e96b9b9bc60a")}</TableCell>
                                <TableCell sx={{
                whiteSpace: 'nowrap'
              }}>{tx("auto.k_33b77bf272d7")}</TableCell>
                                <TableCell sx={{
                whiteSpace: 'nowrap'
              }}>{tx("auto.k_d6370401145d")}</TableCell>
                                <TableCell align="center" sx={{
                whiteSpace: 'nowrap'
              }}>{tx("auto.k_8edfb81a349f")}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {qrCodes.map(qr => <TableRow key={qr.id || qr.code}>
                                    <TableCell sx={{
                maxWidth: {
                  xs: 120,
                  md: 300
                },
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                                        {qr.prefilled_message || '-'}
                                    </TableCell>
                                    <TableCell>
                                        <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1
                }}>
                                            <Typography variant="body2" sx={{
                    maxWidth: {
                      xs: 120,
                      md: 200
                    },
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                                                {qr.deep_link_url || '-'}
                                            </Typography>
                                            {qr.deep_link_url && <IconButton size="small" onClick={() => {
                    navigator.clipboard.writeText(qr.deep_link_url);
                    setSuccess(tx("auto.k_12601ae12494"));
                  }}>
                                                    <CopyIcon fontSize="small" />
                                                </IconButton>}
                                        </Box>
                                    </TableCell>
                                    <TableCell>
                                        <Chip label={tx("auto.k_41b054617ef6")} size="small" color="success" />
                                    </TableCell>
                                    <TableCell align="center">
                                        <IconButton color="error" onClick={() => handleDelete(qr.id || qr.code)}>
                                            <DeleteIcon />
                                        </IconButton>
                                    </TableCell>
                                </TableRow>)}
                            {qrCodes.length === 0 && <TableRow>
                                    <TableCell colSpan={4} align="center" sx={{
                py: 6,
                color: 'text.secondary'
              }}>{tx("auto.k_689a0bd595cb")}

                </TableCell>
                                </TableRow>}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>

            <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{tx("auto.k_594377e2cfcd")}</DialogTitle>
                <DialogContent>
                    <TextField fullWidth multiline rows={3} label={tx("auto.k_e96b9b9bc60a")} value={newMessage} onChange={e => setNewMessage(e.target.value)} sx={{
          mt: 2
        }} helperText={tx("auto.k_1bc3927ebaca")} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCreateOpen(false)}>{tx("auto.k_e776b0209b50")}</Button>
                    <Button variant="contained" onClick={handleCreate} disabled={creating || !newMessage.trim()}>
                        {creating ? tx("auto.k_b9480022049d") : tx("auto.k_8a1d0b74e145")}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError('')}>
                <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
            </Snackbar>
            <Snackbar open={!!success} autoHideDuration={3000} onClose={() => setSuccess('')}>
                <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>
            </Snackbar>
        </Box>;
};
export default TenantQRCodes;
