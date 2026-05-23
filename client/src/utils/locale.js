import { LANGUAGE_STORAGE_KEY } from '../context/LanguageContext';

export const getCurrentLanguage = () => {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'ar' || stored === 'en') return stored;
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }

  if (typeof document !== 'undefined') {
    const lang = document.documentElement.getAttribute('lang');
    if (lang === 'ar' || lang === 'en') return lang;
  }

  return 'en';
};

export const getCurrentLocale = () => getCurrentLanguage() === 'ar' ? 'ar-LY' : 'en-US';
