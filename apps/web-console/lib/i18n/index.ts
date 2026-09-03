export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_STORAGE_KEY,
  isLocale,
  localeFromNavigator,
  localeHtmlLang,
  parseLocale,
  readStoredLocale,
  resolveLocale,
  writeStoredLocale
} from './locales';
export type { Locale } from './locales';

export { getMessage, interpolate, translate } from './t';

export { I18nProvider } from './I18nProvider';
export type { I18nContextValue } from './I18nProvider';

export { useI18n } from './useI18n';

export type { MessageKey, Messages } from './messages/types';
export { en } from './messages/en';
export { zh } from './messages/zh';
