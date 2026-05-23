import React, { useMemo } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import rtlPlugin from 'stylis-plugin-rtl';
import { prefixer } from 'stylis';
import { createAppTheme } from './theme';
import { useLanguage } from './context/LanguageContext';
import { useStaticDomTranslation } from './i18n/useStaticDomTranslation';
import App from './App.jsx';

const cacheLtr = createCache({
    key: 'muiltr',
});

const cacheRtl = createCache({
    key: 'muirtl',
    stylisPlugins: [prefixer, rtlPlugin],
});

const AppProviders = () => {
    const { direction, language } = useLanguage();
    const theme = useMemo(() => createAppTheme(direction), [direction]);
    const cache = direction === 'rtl' ? cacheRtl : cacheLtr;
    useStaticDomTranslation(language);

    return (
        <CacheProvider value={cache}>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <App />
            </ThemeProvider>
        </CacheProvider>
    );
};

export default AppProviders;
