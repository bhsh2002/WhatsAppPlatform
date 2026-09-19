import React from 'react';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import { Chat, Close, SyncAlt } from '@mui/icons-material';

const sourceLabels = {
  catalog: 'Catalog',
  pos: 'POS',
  sawemly: 'Sawemly',
};

const IntegrationRequestBar = ({ requests, busyId, onOpen, onDismiss }) => {
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
            {request.status === 'approved' ? 'متابعة الرسالة' : 'مراجعة في المحادثة'}
          </Button>
          <Button
            size="small"
            color="inherit"
            startIcon={<Close />}
            disabled={busyId === request.id}
            onClick={() => onDismiss(request)}
          >
            رفض
          </Button>
        </Stack>
      )}
    >
      <Box>
        <Typography variant="subtitle2">
          طلب رسالة من {source} {recipient ? `إلى ${recipient}` : ''}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', maxWidth: 520 }}>
          {payload.message || `مرجع الطلب: ${request.request_key}`}
        </Typography>
      </Box>
    </Alert>
  );
};

export default IntegrationRequestBar;
