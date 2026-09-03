/**
 * Browser tool enablement — Lab KV first, existing RAW_AGENT_BROWSER_TOOLS as CI fallback.
 */

import { envBool } from '../env.js';
import { nowIso } from '../id.js';

export const BROWSER_SETTINGS_KEY = 'browser_settings';

export interface BrowserSettings {
  enabled: boolean;
  updatedAt: string;
}

export interface BrowserSettingsPatch {
  enabled?: boolean;
}

export interface BrowserSettingsStore {
  getDaemonControl<T>(key: string): T | undefined;
  setDaemonControl(key: string, value: unknown): void;
}

export function defaultBrowserSettings(): BrowserSettings {
  return { enabled: false, updatedAt: nowIso() };
}

export function normalizeBrowserSettings(raw: Partial<BrowserSettings> | null | undefined): BrowserSettings {
  const base = defaultBrowserSettings();
  if (!raw || typeof raw !== 'object') return base;
  return {
    enabled: Boolean(raw.enabled),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt
  };
}

export function readBrowserSettings(store: BrowserSettingsStore): BrowserSettings {
  const saved = store.getDaemonControl<Partial<BrowserSettings>>(BROWSER_SETTINGS_KEY);
  if (!saved) return defaultBrowserSettings();
  return normalizeBrowserSettings(saved);
}

export function writeBrowserSettings(store: BrowserSettingsStore, patch: BrowserSettingsPatch): BrowserSettings {
  const next = normalizeBrowserSettings({
    ...readBrowserSettings(store),
    ...patch,
    updatedAt: nowIso()
  });
  store.setDaemonControl(BROWSER_SETTINGS_KEY, next);
  return next;
}

function isStore(store: unknown): store is BrowserSettingsStore {
  return (
    !!store &&
    typeof (store as BrowserSettingsStore).getDaemonControl === 'function' &&
    typeof (store as BrowserSettingsStore).setDaemonControl === 'function'
  );
}

export function hasPersistedBrowserSettings(store: BrowserSettingsStore | undefined): boolean {
  return isStore(store) && store.getDaemonControl(BROWSER_SETTINGS_KEY) != null;
}

/** Lab persisted setting wins; otherwise existing env fallback. */
export function resolveBrowserToolsEnabled(
  store: BrowserSettingsStore | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (isStore(store) && hasPersistedBrowserSettings(store)) {
    return readBrowserSettings(store).enabled;
  }
  return envBool(env, 'RAW_AGENT_BROWSER_TOOLS', false);
}
