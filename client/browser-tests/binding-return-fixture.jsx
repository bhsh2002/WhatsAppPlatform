import React from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { LanguageProvider } from '../src/context/LanguageContext';
import { createAppTheme } from '../src/theme';
import ConnectionsDataController from '../src/pages/TenantPortal/ConnectionsDataController';

// The real product controller and API client, served by the dedicated loopback
// regression runner. Its synthetic HTTP boundary cannot reach any backend.
window.localStorage.setItem('wa_savana_language', 'ar');
createRoot(document.getElementById('root')).render(<LanguageProvider>
    <ThemeProvider theme={createAppTheme('ar')}><CssBaseline /><ConnectionsDataController /></ThemeProvider>
</LanguageProvider>);
