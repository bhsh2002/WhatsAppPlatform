import { translations } from './translations';

const LANGUAGE_STORAGE_KEY = 'wa_savana_language';

const supported = new Set(['ar', 'en']);

const resolve = (dictionary, key) => {
    if (!dictionary || !key) return undefined;
    return String(key).split('.').reduce((value, part) => {
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

const currentLanguage = () => {
    try {
        const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (supported.has(stored)) return stored;
    } catch {
        // Best effort for non-browser or restricted storage contexts.
    }

    if (typeof document !== 'undefined') {
        const lang = document.documentElement.getAttribute('lang');
        if (supported.has(lang)) return lang;
    }

    if (typeof navigator !== 'undefined') {
        return String(navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
    }

    return 'en';
};

export const tx = (key, values) => {
    const language = currentLanguage();
    const current = resolve(translations[language], key);
    const fallback = resolve(translations.ar, key);
    return interpolate(current ?? fallback ?? key, values);
};
