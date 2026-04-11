import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Typography, Paper, Grid, TextField, Button, Chip, Alert, Snackbar,
    CircularProgress, Divider, Card, CardContent, Avatar, Stack
} from '@mui/material';
import { Store as StoreIcon, Edit as EditIcon, Save as SaveIcon, Cancel as CancelIcon } from '@mui/icons-material';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';

const TenantBusinessProfile = () => {
    const { tenant } = useAuth();
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [form, setForm] = useState({
        about: '', address: '', description: '', email: '', vertical: '', websites: ''
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
            setError(err.message || 'فشل تحميل ملف النشاط التجاري');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadProfile(); }, [loadProfile]);

    const handleSave = async () => {
        try {
            setSaving(true);
            const payload = { ...form };
            if (payload.websites) {
                payload.websites = payload.websites.split(',').map(w => w.trim()).filter(Boolean);
            } else {
                payload.websites = [];
            }
            await api.updateMyBusinessProfile(payload);
            setSuccess('تم تحديث ملف النشاط التجاري بنجاح');
            setEditing(false);
            loadProfile();
        } catch (err) {
            setError(err.message || 'فشل تحديث ملف النشاط التجاري');
        } finally {
            setSaving(false);
        }
    };

    const verticalOptions = [
        'AUTOMOTIVE', 'BEAUTY_SPA_SALON', 'CLOTHING_APPAREL', 'EDUCATION',
        'ENTERTAINMENT', 'EVENT_PLANNING', 'FINANCE_BANKING', 'FOOD_GROCERY',
        'GOVERNMENT', 'HOTEL_LODGING', 'MEDICAL_HEALTH', 'NON_PROFIT',
        'PROFESSIONAL_SERVICES', 'RESTAURANT', 'RETAIL', 'TRAVEL_TRANSPORTATION', 'OTHER'
    ];

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Avatar sx={{ bgcolor: 'secondary.main', width: 48, height: 48 }}>
                        <StoreIcon />
                    </Avatar>
                    <Box>
                        <Typography variant="h5" fontWeight={700}>ملف النشاط التجاري</Typography>
                        <Typography variant="body2" color="text.secondary">إدارة معلومات ملف واتساب التجاري</Typography>
                    </Box>
                </Box>
                {!editing ? (
                    <Button variant="contained" startIcon={<EditIcon />} onClick={() => setEditing(true)}>تعديل</Button>
                ) : (
                    <Stack direction="row" spacing={1}>
                        <Button variant="contained" color="success" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
                            {saving ? 'جاري الحفظ...' : 'حفظ'}
                        </Button>
                        <Button variant="outlined" startIcon={<CancelIcon />} onClick={() => setEditing(false)}>إلغاء</Button>
                    </Stack>
                )}
            </Box>

            {profile?.profile_picture_url && (
                <Card sx={{ mb: 3 }}>
                    <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Avatar src={profile.profile_picture_url} sx={{ width: 80, height: 80 }} />
                        <Box>
                            <Typography variant="h6">{tenant?.name || 'النشاط التجاري'}</Typography>
                            <Chip label="واتساب للأعمال" size="small" color="success" />
                        </Box>
                    </CardContent>
                </Card>
            )}

            <Paper sx={{ p: 3 }}>
                <Grid container spacing={3}>
                    <Grid item xs={12}>
                        <TextField fullWidth label="نبذة عن النشاط" value={form.about} disabled={!editing}
                            onChange={e => setForm({ ...form, about: e.target.value })}
                            helperText="حد أقصى 139 حرف" inputProps={{ maxLength: 139 }} />
                    </Grid>
                    <Grid item xs={12}>
                        <TextField fullWidth multiline rows={3} label="الوصف" value={form.description} disabled={!editing}
                            onChange={e => setForm({ ...form, description: e.target.value })}
                            helperText="وصف مفصل عن النشاط التجاري" />
                    </Grid>
                    <Grid item xs={12} md={6}>
                        <TextField fullWidth label="البريد الإلكتروني" value={form.email} disabled={!editing}
                            onChange={e => setForm({ ...form, email: e.target.value })} type="email" />
                    </Grid>
                    <Grid item xs={12} md={6}>
                        <TextField fullWidth label="العنوان" value={form.address} disabled={!editing}
                            onChange={e => setForm({ ...form, address: e.target.value })} />
                    </Grid>
                    <Grid item xs={12} md={6}>
                        <TextField fullWidth select label="قطاع النشاط" value={form.vertical} disabled={!editing}
                            onChange={e => setForm({ ...form, vertical: e.target.value })}
                            SelectProps={{ native: true }}>
                            <option value="">اختر القطاع</option>
                            {verticalOptions.map(v => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
                        </TextField>
                    </Grid>
                    <Grid item xs={12} md={6}>
                        <TextField fullWidth label="المواقع الإلكترونية" value={form.websites} disabled={!editing}
                            onChange={e => setForm({ ...form, websites: e.target.value })}
                            helperText="افصل بين عدة مواقع بفاصلة" />
                    </Grid>
                </Grid>
            </Paper>

            <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError('')}>
                <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
            </Snackbar>
            <Snackbar open={!!success} autoHideDuration={3000} onClose={() => setSuccess('')}>
                <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>
            </Snackbar>
        </Box>
    );
};

export default TenantBusinessProfile;
