import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Box,
    Typography,
    IconButton,
    Alert
} from '@mui/material';
import {
    Close as CloseIcon,
    PersonAdd as PersonAddIcon
} from '@mui/icons-material';

const ContactDialog = ({ open, onClose, onSave, contact = null, loading = false }) => {
    const [formData, setFormData] = useState({
        phone: '',
        profile_name: '',
        label: '',
        notes: ''
    });
    const [error, setError] = useState('');

    useEffect(() => {
        if (contact) {
            setFormData({
                phone: contact.phone || '',
                profile_name: contact.profile_name || '',
                label: contact.label || '',
                notes: contact.notes || ''
            });
        } else {
            setFormData({
                phone: '',
                profile_name: '',
                label: '',
                notes: ''
            });
        }
        setError('');
    }, [contact, open]);

    const handleChange = (field) => (e) => {
        setFormData(prev => ({ ...prev, [field]: e.target.value }));
        setError('');
    };

    const handleSubmit = () => {
        const phone = formData.phone.replace(/[\s\-\+]/g, '').trim();
        
        if (!phone) {
            setError('رقم الهاتف مطلوب');
            return;
        }
        
        if (phone.length < 9) {
            setError('رقم الهاتف غير صالح');
            return;
        }

        onSave({
            phone,
            profile_name: formData.profile_name.trim() || null,
            label: formData.label.trim() || null,
            notes: formData.notes.trim() || null
        });
    };

    const handleClose = () => {
        if (!loading) {
            setFormData({ phone: '', profile_name: '', label: '', notes: '' });
            setError('');
            onClose();
        }
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PersonAddIcon />
                    <Typography variant="h6">
                        {contact ? 'تعديل جهة اتصال' : 'إضافة جهة اتصال'}
                    </Typography>
                </Box>
                <IconButton onClick={handleClose} disabled={loading}>
                    <CloseIcon />
                </IconButton>
            </DialogTitle>

            <DialogContent>
                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                    <TextField
                        label="رقم الهاتف"
                        placeholder="966501234567"
                        value={formData.phone}
                        onChange={handleChange('phone')}
                        fullWidth
                        required
                        disabled={loading || !!contact}
                        helperText={contact ? 'لا يمكن تعديل رقم الهاتف' : 'أدخل الرقم بدون رمز الدولة (+)'}
                    />

                    <TextField
                        label="الاسم"
                        placeholder="اسم جهة الاتصال"
                        value={formData.profile_name}
                        onChange={handleChange('profile_name')}
                        fullWidth
                        disabled={loading}
                    />

                    <TextField
                        label="التصنيف"
                        placeholder="عميل، مورد، إلخ"
                        value={formData.label}
                        onChange={handleChange('label')}
                        fullWidth
                        disabled={loading}
                    />

                    <TextField
                        label="ملاحظات"
                        placeholder="ملاحظات إضافية"
                        value={formData.notes}
                        onChange={handleChange('notes')}
                        fullWidth
                        multiline
                        rows={3}
                        disabled={loading}
                    />
                </Box>
            </DialogContent>

            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button onClick={handleClose} disabled={loading}>
                    إلغاء
                </Button>
                <Button
                    variant="contained"
                    onClick={handleSubmit}
                    disabled={loading}
                    startIcon={loading ? null : <PersonAddIcon />}
                >
                    {loading ? 'جاري الحفظ...' : (contact ? 'حفظ' : 'إضافة')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ContactDialog;