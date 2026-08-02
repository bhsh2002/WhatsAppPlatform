import React from 'react';
import { Box, Chip, FormControl, InputLabel, MenuItem, Typography } from '@mui/material';
import Select from '../Form/AccessibleSelect';
import { useWhatsAppNumbers } from '../../context/WhatsAppNumberContext';

const numberLabel = number => (
  number.label
  || number.verified_name
  || number.display_phone_number
  || number.phone_number_id
);

const WhatsAppNumberSelector = ({ compact = false }) => {
  const {
    numbers,
    selectedPhoneNumberId,
    selectedNumber,
    loading,
    selectNumber
  } = useWhatsAppNumbers();

  if (numbers.length === 0) return null;

  return <Box sx={{
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    minWidth: compact ? 150 : 260,
    maxWidth: compact ? 210 : 420
  }}>
    {!compact && <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" display="block">رقم WhatsApp النشط</Typography>
      <Typography variant="body2" fontWeight={700} noWrap>
        {selectedNumber ? numberLabel(selectedNumber) : 'اختر رقماً'}
      </Typography>
    </Box>}
    <FormControl size="small" sx={{ minWidth: compact ? 150 : 190, flex: 1 }}>
      <InputLabel id="whatsapp-number-selector-label">رقم WhatsApp</InputLabel>
      <Select
        labelId="whatsapp-number-selector-label"
        value={selectedPhoneNumberId || ''}
        label="رقم WhatsApp"
        disabled={loading}
        onChange={event => selectNumber(event.target.value)}
      >
        {numbers.map(number => <MenuItem key={number.phone_number_id} value={String(number.phone_number_id)}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
            <Typography variant="body2" noWrap sx={{ flex: 1 }}>{numberLabel(number)}</Typography>
            {number.is_default === 1 && <Chip label="افتراضي" size="small" color="success" variant="outlined" />}
          </Box>
        </MenuItem>)}
      </Select>
    </FormControl>
  </Box>;
};

export default WhatsAppNumberSelector;
