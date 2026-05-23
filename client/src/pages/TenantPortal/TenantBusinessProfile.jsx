import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Paper, Grid, TextField, Button, Chip, Alert, Snackbar, CircularProgress, Divider, Card, CardContent, Avatar, Stack } from '@mui/material';
import { Store as StoreIcon, Edit as EditIcon, Save as SaveIcon, Cancel as CancelIcon } from '@mui/icons-material';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { tx } from "../../i18n/tx";
const TenantBusinessProfile = () => {
  const {
    tenant
  } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    about: '',
    address: '',
    description: '',
    email: '',
    vertical: '',
    websites: ''
  });
  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getMyBusinessProfile();
      setProfile(data);
      setForm({
        about: data.about || '',
        address: data.address || '',
        description: data.description || '',
        email: data.email || '',
        vertical: data.vertical || '',
        websites: (data.websites || []).join(', ')
      });
    } catch (err) {
      setError(err.message || tx("auto.k_2aad246e873d"));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    loadProfile();
  }, [loadProfile]);
  const handleSave = async () => {
    try {
      setSaving(true);
      const payload = {
        ...form
      };
      if (payload.websites) {
        payload.websites = payload.websites.split(',').map(w => w.trim()).filter(Boolean);
      } else {
        payload.websites = [];
      }
      await api.updateMyBusinessProfile(payload);
      setSuccess(tx("auto.k_d19cd5201938"));
      setEditing(false);
      loadProfile();
    } catch (err) {
      setError(err.message || tx("auto.k_dffa9720a0b7"));
    } finally {
      setSaving(false);
    }
  };
  const verticalOptions = ['AUTOMOTIVE', 'BEAUTY_SPA_SALON', 'CLOTHING_APPAREL', 'EDUCATION', 'ENTERTAINMENT', 'EVENT_PLANNING', 'FINANCE_BANKING', 'FOOD_GROCERY', 'GOVERNMENT', 'HOTEL_LODGING', 'MEDICAL_HEALTH', 'NON_PROFIT', 'PROFESSIONAL_SERVICES', 'RESTAURANT', 'RETAIL', 'TRAVEL_TRANSPORTATION', 'OTHER'];
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
  return <Box sx={{
    p: {
      xs: 1.5,
      md: 3
    },
    maxWidth: 900,
    mx: 'auto'
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
                    <Avatar sx={{
          bgcolor: 'secondary.main',
          width: 48,
          height: 48
        }}>
                        <StoreIcon />
                    </Avatar>
                    <Box>
                        <Typography variant="h5" fontWeight={700}>{tx("auto.k_252f7ceb9409")}</Typography>
                        <Typography variant="body2" color="text.secondary">{tx("auto.k_96c97ae403d8")}</Typography>
                    </Box>
                </Box>
                {!editing ? <Button variant="contained" startIcon={<EditIcon />} onClick={() => setEditing(true)}>{tx("auto.k_b4f76c3aa21e")}</Button> : <Stack direction="row" spacing={1}>
                        <Button variant="contained" color="success" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
                            {saving ? tx("auto.k_898769fc464a") : tx("auto.k_56ee6e0d206b")}
                        </Button>
                        <Button variant="outlined" startIcon={<CancelIcon />} onClick={() => setEditing(false)}>{tx("auto.k_e776b0209b50")}</Button>
                    </Stack>}
            </Box>

            {profile?.profile_picture_url && <Card sx={{
      mb: 3
    }}>
                    <CardContent sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 3
      }}>
                        <Avatar src={profile.profile_picture_url} sx={{
          width: 80,
          height: 80
        }} />
                        <Box>
                            <Typography variant="h6">{tenant?.name || tx("auto.k_1b4b3fc2d154")}</Typography>
                            <Chip label={tx("auto.k_9038e6fab313")} size="small" color="success" />
                        </Box>
                    </CardContent>
                </Card>}

            <Paper sx={{
      p: 3
    }}>
                <Grid container spacing={3}>
                    <Grid size={{
          xs: 12
        }}>
                        <TextField fullWidth label={tx("auto.k_8e461b65c171")} value={form.about} disabled={!editing} onChange={e => setForm({
            ...form,
            about: e.target.value
          })} helperText={tx("auto.k_7412b987b5e8")} inputProps={{
            maxLength: 139
          }} />
                    </Grid>
                    <Grid size={{
          xs: 12
        }}>
                        <TextField fullWidth multiline rows={3} label={tx("auto.k_a9965b94a4b8")} value={form.description} disabled={!editing} onChange={e => setForm({
            ...form,
            description: e.target.value
          })} helperText={tx("auto.k_1f9159e7493d")} />
                    </Grid>
                    <Grid size={{
          xs: 12,
          md: 6
        }}>
                        <TextField fullWidth label={tx("auto.k_0915ef8ea533")} value={form.email} disabled={!editing} onChange={e => setForm({
            ...form,
            email: e.target.value
          })} type="email" />
                    </Grid>
                    <Grid size={{
          xs: 12,
          md: 6
        }}>
                        <TextField fullWidth label={tx("auto.k_baffa49c77ea")} value={form.address} disabled={!editing} onChange={e => setForm({
            ...form,
            address: e.target.value
          })} />
                    </Grid>
                    <Grid size={{
          xs: 12,
          md: 6
        }}>
                        <TextField fullWidth select label={tx("auto.k_55dfbedb922c")} value={form.vertical} disabled={!editing} onChange={e => setForm({
            ...form,
            vertical: e.target.value
          })}>
                            <option value="">{tx("auto.k_d33bb65dadb2")}</option>
                            {verticalOptions.map(v => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
                        </TextField>
                    </Grid>
                    <Grid size={{
          xs: 12,
          md: 6
        }}>
                        <TextField fullWidth label={tx("auto.k_39437f65cfd0")} value={form.websites} disabled={!editing} onChange={e => setForm({
            ...form,
            websites: e.target.value
          })} helperText={tx("auto.k_ac4ba403f223")} />
                    </Grid>
                </Grid>
            </Paper>

            <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError('')}>
                <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
            </Snackbar>
            <Snackbar open={!!success} autoHideDuration={3000} onClose={() => setSuccess('')}>
                <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>
            </Snackbar>
        </Box>;
};
export default TenantBusinessProfile;
