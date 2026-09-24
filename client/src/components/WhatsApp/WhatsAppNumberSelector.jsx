import React, { useId } from 'react';
import { Box, Chip, FormControl, InputLabel, MenuItem, Typography } from '@mui/material';
import Select from '../Form/AccessibleSelect';
import { useWhatsAppNumbers } from '../../context/WhatsAppNumberContext';
import { useLanguage } from '../../context/LanguageContext';

const numberLabel = number => (
  number.label
  || number.verified_name
  || number.display_phone_number
  || number.phone_number_id
);

const WhatsAppNumberSelector = ({ compact = false }) => {
  const selectorId = useId();
  const { t } = useLanguage();
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
    width: '100%',
    minWidth: 0,
    maxWidth: compact ? '100%' : 420,
    overflow: 'hidden'
  }}>
    {!compact && <Box sx={{ minWidth: 0, flex: '0 1 180px', overflow: 'hidden' }}>
      <Typography variant="caption" color="text.secondary" display="block">{t('layout.activeWhatsAppNumber')}</Typography>
      <Typography variant="body2" fontWeight={700} noWrap>
        {selectedNumber ? numberLabel(selectedNumber) : t('layout.chooseWhatsAppNumber')}
      </Typography>
    </Box>}
    <FormControl size="small" sx={{ minWidth: 0, maxWidth: '100%', flex: 1, overflow: 'hidden' }}>
      <InputLabel id={`${selectorId}-label`}>{t('layout.whatsAppNumber')}</InputLabel>
      <Select
        labelId={`${selectorId}-label`}
        value={selectedPhoneNumberId || ''}
        label={t('layout.whatsAppNumber')}
        disabled={loading}
        onChange={event => selectNumber(event.target.value)}
        renderValue={() => (
          <Typography component="span" variant="body2" noWrap dir="auto" sx={{ display: 'block', minWidth: 0 }}>
            {selectedNumber ? numberLabel(selectedNumber) : t('layout.chooseWhatsAppNumber')}
          </Typography>
        )}
        sx={{
          width: '100%',
          minWidth: 0,
          maxWidth: '100%',
          '& .MuiSelect-select': {
            minWidth: '0 !important',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }
        }}
      >
        {numbers.map(number => <MenuItem key={number.phone_number_id} value={String(number.phone_number_id)} sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', minWidth: 0, overflow: 'hidden' }}>
            <Typography variant="body2" noWrap dir="auto" sx={{ flex: 1, minWidth: 0 }}>{numberLabel(number)}</Typography>
            {number.is_default === 1 && <Chip label={t('layout.defaultNumber')} size="small" color="success" variant="outlined" sx={{ flexShrink: 0 }} />}
          </Box>
        </MenuItem>)}
      </Select>
    </FormControl>
  </Box>;
};

export default WhatsAppNumberSelector;
