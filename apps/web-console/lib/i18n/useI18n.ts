'use client';

import { useContext } from 'react';
import { I18nContext, type I18nContextValue } from './I18nProvider';
import { DEFAULT_LOCALE } from './locales';
import { zh } from './messages/zh';
import { translate } from './t';

const fallbackValue: I18nContextValue = {
  locale: DEFAULT_LOCALE,
  setLocale: () => {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[i18n] setLocale called outside I18nProvider');
    }
  },
  t: (key, vars) => translate(zh, key, vars, zh),
  messages: zh
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[i18n] useI18n called outside I18nProvider; falling back to zh');
    }
    return fallbackValue;
  }
  return ctx;
}
