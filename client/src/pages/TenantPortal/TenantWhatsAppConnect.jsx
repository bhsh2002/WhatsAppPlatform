import React from 'react';
import { Box, Typography } from '@mui/material';
import { WhatsApp as WhatsAppIcon } from '@mui/icons-material';
import WhatsAppConnect from '../../components/WhatsApp/WhatsAppConnect';
import { tx } from "../../i18n/tx";
const TenantWhatsAppConnect = () => {
  return <Box sx={{
    p: {
      xs: 1.5,
      md: 3
    }
  }}>
            <Box sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      mb: 3
    }}>
                <WhatsAppIcon sx={{
        fontSize: 32,
        color: '#25D366'
      }} />
                <Box>
                    <Typography variant="h4" fontWeight={700}>{tx("auto.k_60c6c16e6831")}</Typography>
                    <Typography variant="body2" color="text.secondary">{tx("auto.k_38daa4c05435")}

          </Typography>
                </Box>
            </Box>

            <WhatsAppConnect />
        </Box>;
};
export default TenantWhatsAppConnect;
