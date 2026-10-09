export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme';
export const THEME_CHANGED_EVENT = 'ppeng-theme-changed';

export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export function resolveTheme(pref: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (pref === 'system') return prefersDark ? 'dark' : 'light';
  return pref;
}

export function readThemePreference(): ThemePreference {
  return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
}

export function currentTheme(): ResolvedTheme {
  return resolveTheme(readThemePreference(), window.matchMedia('(prefers-color-scheme: dark)').matches);
}

/** `system` removes the stored key so the pre-hydration script keeps following the OS. */
export function applyThemePreference(pref: ThemePreference): void {
  if (pref === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
  else window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  document.documentElement.setAttribute('data-theme', currentTheme());
  window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
}
