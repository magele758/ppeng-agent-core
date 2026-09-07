/**
 * Web search URL template — Lab KV first, RAW_AGENT_WEB_SEARCH_URL as CI/bootstrap fallback.
 * No new env vars. Empty persisted template hides web_search from the model.
 */

import { nowIso } from '../id.js';
import { ValidationError } from '../errors.js';

export const WEB_SETTINGS_KEY = 'web_settings';

export interface WebSettings {
  /** GET template; must contain `{query}` when non-empty. */
  searchUrl: string;
  updatedAt: string;
}

export interface WebSettingsPatch {
  searchUrl?: string;
}

export interface WebSettingsReadStore {
  getDaemonControl?(key: string): unknown;
}

export interface WebSettingsStore extends WebSettingsReadStore {
  getDaemonControl<T>(key: string): T | undefined;
  setDaemonControl(key: string, value: unknown): void;
}

export function defaultWebSettings(): WebSettings {
  return { searchUrl: '', updatedAt: nowIso() };
}

export function normalizeWebSettings(raw: Partial<WebSettings> | null | undefined): WebSettings {
  const base = defaultWebSettings();
  if (!raw || typeof raw !== 'object') return base;
  return {
    searchUrl: typeof raw.searchUrl === 'string' ? raw.searchUrl.trim() : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt
  };
}

export function readWebSettings(store: WebSettingsReadStore): WebSettings {
  const saved = store.getDaemonControl?.(WEB_SETTINGS_KEY) as Partial<WebSettings> | undefined;
  if (!saved) return defaultWebSettings();
  return normalizeWebSettings(saved);
}

export function assertSearchUrlTemplate(url: string): void {
  const trimmed = url.trim();
  if (!trimmed) return;
  if (!trimmed.includes('{query}')) {
    throw new ValidationError('searchUrl must contain {query}');
  }
  try {
    const parsed = new URL(trimmed.replace(/\{query\}/g, 'q'));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ValidationError('searchUrl must be an http(s) URL template');
    }
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError('searchUrl must be an absolute URL template');
  }
}

export function writeWebSettings(store: WebSettingsStore, patch: WebSettingsPatch): WebSettings {
  const current = readWebSettings(store);
  const searchUrl = patch.searchUrl !== undefined ? patch.searchUrl.trim() : current.searchUrl;
  assertSearchUrlTemplate(searchUrl);
  const next = normalizeWebSettings({
    ...current,
    searchUrl,
    updatedAt: nowIso()
  });
  store.setDaemonControl(WEB_SETTINGS_KEY, next);
  return next;
}

function isReadStore(store: unknown): store is WebSettingsReadStore {
  return !!store && typeof (store as WebSettingsReadStore).getDaemonControl === 'function';
}

function isStore(store: unknown): store is WebSettingsStore {
  return (
    isReadStore(store) &&
    typeof (store as WebSettingsStore).setDaemonControl === 'function'
  );
}

export function hasPersistedWebSettings(store: WebSettingsReadStore | undefined): boolean {
  return isReadStore(store) && store.getDaemonControl?.(WEB_SETTINGS_KEY) != null;
}

/**
 * Effective search URL template.
 * Persisted Lab settings win when present (empty string disables the tool).
 * Otherwise CI/bootstrap env fallback.
 */
export function resolveWebSearchTemplate(
  store: WebSettingsReadStore | undefined,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (isReadStore(store) && hasPersistedWebSettings(store)) {
    const url = readWebSettings(store).searchUrl.trim();
    return url || undefined;
  }
  const fallback = env.RAW_AGENT_WEB_SEARCH_URL?.trim();
  return fallback || undefined;
}

export const WEB_SEARCH_NOT_CONFIGURED =
  'web_search is not configured. Set a search URL template in Lab → More → Attachments & browser (must contain {query}), or RAW_AGENT_WEB_SEARCH_URL as a CI fallback.';
