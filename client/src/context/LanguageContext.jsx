import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { translations } from '../i18n/translations';

export const LANGUAGE_STORAGE_KEY = 'wa_savana_language';

const SUPPORTED_LANGUAGES = ['ar', 'en'];

const LanguageContext = createContext(null);

const isSupportedLanguage = (language) => SUPPORTED_LANGUAGES.includes(language);

const resolveTranslation = (dictionary, key) => {
    if (!dictionary || !key) return undefined;
    return key.split('.').reduce((value, part) => {
        if (value && Object.prototype.hasOwnProperty.call(value, part)) {
            return value[part];
        }
        return undefined;
    }, dictionary);
};

const interpolate = (template, values) => {
    if (typeof template !== 'string' || !values) return template;
    return template.replace(/\{(\w+)\}/g, (_, name) => {
        const value = values[name];
        return value === undefined || value === null ? '' : String(value);
    });
};

// eslint-disable-next-line react-refresh/only-export-components
export const getInitialLanguage = () => {
    try {
        const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (isSupportedLanguage(stored)) return stored;
    } catch {
        // Ignore storage restrictions and fall back to browser language.
    }

    const browserLanguage = typeof navigator !== 'undefined' ? navigator.language || '' : '';
    return browserLanguage.toLowerCase().startsWith('ar') ? 'ar' : 'en';
};

export const LanguageProvider = ({ children }) => {
    const [language, setLanguageState] = useState(getInitialLanguage);

    const setLanguage = useCallback((nextLanguage) => {
        if (!isSupportedLanguage(nextLanguage)) return;
        setLanguageState(nextLanguage);
        try {
            window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
        } catch {
            // Local preference persistence is best-effort.
        }
    }, []);

    const t = useCallback((key, values) => {
        const currentValue = resolveTranslation(translations[language], key);
        const fallbackValue = resolveTranslation(translations.ar, key);
        const value = currentValue ?? fallbackValue ?? key;
        return interpolate(value, values);
    }, [language]);

    const direction = language === 'ar' ? 'rtl' : 'ltr';
    const locale = language === 'ar' ? 'ar-LY' : 'en-US';

    useEffect(() => {
        document.documentElement.setAttribute('lang', language);
        document.documentElement.setAttribute('dir', direction);
    }, [direction, language]);

    const value = useMemo(() => ({
        language,
        direction,
        locale,
        setLanguage,
        t,
    }), [direction, language, locale, setLanguage, t]);

    return (
        <LanguageContext.Provider value={value}>
            {children}
        </LanguageContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within LanguageProvider');
    }
    return context;
};
