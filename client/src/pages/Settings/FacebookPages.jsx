import React, { useState } from 'react';
import { Box, Typography, Paper, Button, CircularProgress, Alert, Snackbar, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, Avatar } from '@mui/material';
import { Facebook as FacebookIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import api from '../../api';
import { tx } from "../../i18n/tx";
const FacebookPages = () => {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const loadPages = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await api.getMyPages();
      setPages(data.pages || []);
      setLoaded(true);
    } catch (err) {
      setError(err.message || tx("auto.k_8d3fc6a39a23"));
    } finally {
      setLoading(false);
    }
  };
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
                    <FacebookIcon sx={{
          fontSize: 32,
          color: '#1877f2'
        }} />
                    <Box>
                        <Typography variant="h5" fontWeight={700}>{tx("auto.k_b77cc799dc2a")}</Typography>
                        <Typography variant="body2" color="text.secondary">{tx("auto.k_d949ac003f7a")}</Typography>
                    </Box>
                </Box>
                <Button variant="contained" startIcon={loading ? <CircularProgress size={18} /> : <RefreshIcon />} onClick={loadPages} disabled={loading} sx={{
        bgcolor: '#1877f2'
      }}>
                    {loaded ? tx("auto.k_4309a75e6882") : <Box component="span" sx={{
          display: {
            xs: 'none',
            md: 'inline'
          }
        }}>{tx("auto.k_f1b42b583367")}</Box>}
                </Button>
            </Box>

            {!loaded && !loading && <Paper sx={{
      p: 6,
      textAlign: 'center'
    }}>
                    <FacebookIcon sx={{
        fontSize: 64,
        color: '#1877f2',
        mb: 2,
        opacity: 0.5
      }} />
                    <Typography variant="h6" gutterBottom>{tx("auto.k_b2bdf1b7d433")}</Typography>
                    <Typography variant="body2" color="text.secondary">{tx("auto.k_3debe16a6cf5")}</Typography>
                </Paper>}

            {loaded && <Paper>
                    <TableContainer sx={{
        overflowX: 'auto'
      }}>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>{tx("auto.k_6d9919fa1682")}</TableCell>
                                    <TableCell>{tx("auto.k_7c75fec5c0f8")}</TableCell>
                                    <TableCell>{tx("auto.k_480eefa5872e")}</TableCell>
                                    <TableCell>{tx("auto.k_d6370401145d")}</TableCell>
                                    <TableCell>{tx("auto.k_db94cf89d6b4")}</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {pages.map((page, i) => <TableRow key={i}>
                                        <TableCell>
                                            <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5
                }}>
                                                <Avatar src={page.picture?.data?.url} sx={{
                    width: 36,
                    height: 36
                  }}>
                                                    <FacebookIcon />
                                                </Avatar>
                                                <Box>
                                                    <Typography fontWeight={600}>{page.name}</Typography>
                                                    <Typography variant="caption" color="text.secondary">ID: {page.id}</Typography>
                                                </Box>
                                            </Box>
                                        </TableCell>
                                        <TableCell>{page.category || '-'}</TableCell>
                                        <TableCell>{page.fan_count?.toLocaleString() || '0'}</TableCell>
                                        <TableCell>
                                            <Chip label={page.is_published ? tx("auto.k_7cbd3b1206a5") : tx("auto.k_9be7b41497f7")} size="small" color={page.is_published ? 'success' : 'default'} />
                                        </TableCell>
                                        <TableCell>
                                            <Chip label={page.verification_status || tx("auto.k_3a5ee7e1aa21")} size="small" color={page.verification_status === 'blue_verified' ? 'primary' : 'default'} variant="outlined" />
                                        </TableCell>
                                    </TableRow>)}
                                {pages.length === 0 && <TableRow>
                                        <TableCell colSpan={5} align="center" sx={{
                py: 6,
                color: 'text.secondary'
              }}>{tx("auto.k_bbd487bee5cd")}

                </TableCell>
                                    </TableRow>}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Paper>}

            <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError('')}>
                <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
            </Snackbar>
        </Box>;
};
export default FacebookPages;
