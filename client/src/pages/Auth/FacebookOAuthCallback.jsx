import React, { useEffect } from 'react';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import { Facebook as FacebookIcon } from '@mui/icons-material';

const FacebookOAuthCallback = () => {
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');
        const errorParam = params.get('error');

        if (window.opener) {
            if (code && state) {
                window.opener.postMessage({
                    type: 'FB_OAUTH_CALLBACK',
                    code,
                    state,
                }, window.location.origin);
            } else if (errorParam) {
                window.opener.postMessage({
                    type: 'FB_OAUTH_ERROR',
                    error: errorParam,
                    error_description: params.get('error_description') || '',
                }, window.location.origin);
            }
            window.close();
        }
    }, []);

    return (
        <Box sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.default'
        }}>
            <Box sx={{ textAlign: 'center' }}>
                <FacebookIcon sx={{ fontSize: 48, color: '#1877f2', mb: 2 }} />
                <CircularProgress sx={{ mb: 2 }} />
                <Typography variant="h6">جاري معالجة التفويض...</Typography>
                <Typography variant="body2" color="text.secondary">
                    سيتم إغلاق هذه النافذة تلقائياً
                </Typography>
            </Box>
        </Box>
    );
};

export default FacebookOAuthCallback;
