import React from 'react';
import { Box, Typography } from '@mui/material';
import { WhatsApp as WhatsAppIcon } from '@mui/icons-material';
import WhatsAppConnect from '../../components/WhatsApp/WhatsAppConnect';

const TenantWhatsAppConnect = () => {
    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                <WhatsAppIcon sx={{ fontSize: 32, color: '#25D366' }} />
                <Box>
                    <Typography variant="h4" fontWeight={700}>ربط WhatsApp Business</Typography>
                    <Typography variant="body2" color="text.secondary">
                        ربط رقم WhatsApp Business وحساب WABA الخاص بهذا العميل
                    </Typography>
                </Box>
            </Box>

            <WhatsAppConnect />
        </Box>
    );
};

export default TenantWhatsAppConnect;
