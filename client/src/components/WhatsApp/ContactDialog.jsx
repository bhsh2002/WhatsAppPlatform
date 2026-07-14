import React, { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box, Typography, IconButton, Alert } from '@mui/material';
import { Close as CloseIcon, PersonAdd as PersonAddIcon } from '@mui/icons-material';
import { tx } from "../../i18n/tx";
const ContactDialog = ({
  open,
  onClose,
  onSave,
  contact = null,
  loading = false
}) => {
  const [formData, setFormData] = useState(() => ({
    phone: contact?.phone || '',
    profile_name: contact?.profile_name || '',
    label: contact?.label || '',
    notes: contact?.notes || ''
  }));
  const [error, setError] = useState('');
  const resetKey = `${open}:${contact?.id ?? contact?.phone ?? 'new'}`;
  const [previousResetKey, setPreviousResetKey] = useState(resetKey);
  if (resetKey !== previousResetKey) {
    setPreviousResetKey(resetKey);
    setFormData({
      phone: contact?.phone || '',
      profile_name: contact?.profile_name || '',
      label: contact?.label || '',
      notes: contact?.notes || ''
    });
    setError('');
  }
  const handleChange = field => e => {
    setFormData(prev => ({
      ...prev,
      [field]: e.target.value
    }));
    setError('');
  };
  const handleSubmit = () => {
    const phone = formData.phone.replace(/[\s+-]/g, '').trim();
    if (!phone) {
      setError(tx("auto.k_e9030fa52cf6"));
      return;
    }
    if (phone.length < 9) {
      setError(tx("auto.k_75e4c6f9bd29"));
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
      setFormData({
        phone: '',
        profile_name: '',
        label: '',
        notes: ''
      });
      setError('');
      onClose();
    }
  };
  return <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth slotProps={{ paper: { 'aria-label': contact ? tx("auto.k_55f2ecfdc6cc") : tx("auto.k_3fafc0e9d048") } }}>
            <DialogTitle sx={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
                <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1
      }}>
                    <PersonAddIcon />
                    <Typography variant="h6">
                        {contact ? tx("auto.k_55f2ecfdc6cc") : tx("auto.k_3fafc0e9d048")}
                    </Typography>
                </Box>
                <IconButton aria-label={tx("auto.k_e776b0209b50")} onClick={handleClose} disabled={loading}>
                    <CloseIcon />
                </IconButton>
            </DialogTitle>

            <DialogContent>
                {error && <Alert severity="error" sx={{
        mb: 2
      }}>
                        {error}
                    </Alert>}

                <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        mt: 1
      }}>
                    <TextField label={tx("auto.k_211cce4ca4ef")} placeholder="966501234567" value={formData.phone} onChange={handleChange('phone')} fullWidth required disabled={loading || !!contact} helperText={contact ? tx("auto.k_aee684675de6") : tx("auto.k_bf29c781fbcc")} />


                    <TextField label={tx("auto.k_0a92494ea1eb")} placeholder={tx("auto.k_28fc609bc67b")} value={formData.profile_name} onChange={handleChange('profile_name')} fullWidth disabled={loading} />


                    <TextField label={tx("auto.k_7c75fec5c0f8")} placeholder={tx("auto.k_757c18a88fe1")} value={formData.label} onChange={handleChange('label')} fullWidth disabled={loading} />


                    <TextField label={tx("auto.k_480656340410")} placeholder={tx("auto.k_f05125201dc0")} value={formData.notes} onChange={handleChange('notes')} fullWidth multiline rows={3} disabled={loading} />

                </Box>
            </DialogContent>

            <DialogActions sx={{
      px: 3,
      pb: 2
    }}>
                <Button onClick={handleClose} disabled={loading}>{tx("auto.k_e776b0209b50")}

        </Button>
                <Button variant="contained" onClick={handleSubmit} disabled={loading} startIcon={loading ? null : <PersonAddIcon />}>

                    {loading ? tx("auto.k_898769fc464a") : contact ? tx("auto.k_56ee6e0d206b") : tx("auto.k_5e3a3fdfce20")}
                </Button>
            </DialogActions>
        </Dialog>;
};
export default ContactDialog;
