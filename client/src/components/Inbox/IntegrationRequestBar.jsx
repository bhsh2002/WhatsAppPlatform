import React from 'react';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import { Chat, Close, SyncAlt } from '@mui/icons-material';
import { useLanguage } from '../../context/LanguageContext';

const sourceLabels = {
  catalog: 'Catalog',
  pos: 'POS',
  sawemly: 'Sawemly',
};

const IntegrationRequestBar = ({ requests, busyId, onOpen, onDismiss }) => {
  const { t } = useLanguage();
  if (!requests.length) return null;
  const request = requests[0];
  const payload = request.payload || {};
  const recipient = payload.recipient?.phone_e164 || payload.customer_phone || '';
  const source = sourceLabels[request.platform_code] || request.platform_code;

  return (
    <Alert
      severity="info"
      icon={<SyncAlt />}
      sx={{ m: 1, mb: 0, alignItems: 'center' }}
      action={(
        <Stack direction="row" spacing={1} alignItems="center">
          {requests.length > 1 && <Chip size="small" label={`+${requests.length - 1}`} />}
          <Button
            size="small"
            variant="contained"
            startIcon={<Chat />}
            disabled={busyId === request.id}
            onClick={() => onOpen(request)}
          >
            {request.status === 'approved'
              ? t('inbox.integrationRequestContinue')
              : t('inbox.integrationRequestReview')}
          </Button>
          <Button
            size="small"
            color="inherit"
            startIcon={<Close />}
            disabled={busyId === request.id}
            onClick={() => onDismiss(request)}
          >
            {t('inbox.integrationRequestReject')}
          </Button>
        </Stack>
      )}
    >
      <Box>
        <Typography variant="subtitle2">
          {t('inbox.integrationRequestTitle', { source })}{' '}
          {recipient ? t('inbox.integrationRequestRecipient', { recipient }) : ''}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', maxWidth: 520 }}>
          {payload.message || t('inbox.integrationRequestReference', { key: request.request_key })}
        </Typography>
      </Box>
    </Alert>
  );
};

export default IntegrationRequestBar;
