import React, { useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { WhatsApp as WhatsAppIcon } from '@mui/icons-material';
import GuidedWhatsAppSetupPanel from './GuidedWhatsAppSetupPanel';
import WhatsAppNumberManager from './WhatsAppNumberManager';
import { useLanguage } from '../../context/LanguageContext';
import { PageTitle } from '../../components/Layout/PageTitle';
const TenantWhatsAppConnect = () => {
  const { language } = useLanguage();
  const [refreshKey, setRefreshKey] = useState(0);
  const ar = language === 'ar';
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
                    <PageTitle variant="h4" fontWeight={700}>{ar ? 'حسابات واتساب' : 'WhatsApp accounts'}</PageTitle>
                    <Typography variant="body2" color="text.secondary">{ar ? 'اربط حساباتك من Meta، ثم أدر الأرقام المحفوظة.' : 'Connect your accounts through Meta, then manage saved numbers.'}

          </Typography>
                </Box>
            </Box>

            <Stack spacing={3}><GuidedWhatsAppSetupPanel language={language} onConnected={() => setRefreshKey(value => value + 1)} /><WhatsAppNumberManager language={language} refreshKey={refreshKey} /></Stack>
        </Box>;
};
export default TenantWhatsAppConnect;
