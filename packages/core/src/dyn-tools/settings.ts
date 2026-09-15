/**
 * Dynamic tool factory Lab settings — daemon_control KV.
 * No RAW_AGENT_* feature switch. Unconfigured → enabled=false.
 */

import { nowIso } from '../id.js';
import { DYN_TOOL_HYDRATE_TOP_K, DYN_TOOL_UNUSED_SUGGEST_TURNS } from './types.js';

export const DYN_TOOL_SETTINGS_KEY = 'dyn_tool_settings';

export interface DynToolSettings {
  enabled: boolean;
  allowPropose: boolean;
  allowSave: boolean;
  allowProjectPromote: boolean;
  hydrateTopK: number;
  unusedSuggestTurns: number;
  updatedAt: string;
}

export interface DynToolSettingsPatch {
  enabled?: boolean;
  allowPropose?: boolean;
  allowSave?: boolean;
  allowProjectPromote?: boolean;
  hydrateTopK?: number;
  unusedSuggestTurns?: number;
}

export interface DynToolSettingsStore {
  getDaemonControl?(key: string): unknown;
  setDaemonControl?(key: string, value: unknown): void;
}

export function defaultDynToolSettings(): DynToolSettings {
  return {
    enabled: false,
    allowPropose: true,
    allowSave: true,
    allowProjectPromote: true,
    hydrateTopK: DYN_TOOL_HYDRATE_TOP_K,
    unusedSuggestTurns: DYN_TOOL_UNUSED_SUGGEST_TURNS,
    updatedAt: nowIso()
  };
}

function parseBoundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

export function normalizeDynToolSettings(raw: Partial<DynToolSettings> | null | undefined): DynToolSettings {
  const base = defaultDynToolSettings();
  if (!raw || typeof raw !== 'object') return base;
  return {
    enabled: Boolean(raw.enabled),
    allowPropose: raw.allowPropose !== undefined ? Boolean(raw.allowPropose) : base.allowPropose,
    allowSave: raw.allowSave !== undefined ? Boolean(raw.allowSave) : base.allowSave,
    allowProjectPromote: raw.allowProjectPromote !== undefined ? Boolean(raw.allowProjectPromote) : base.allowProjectPromote,
    hydrateTopK: parseBoundedInt(raw.hydrateTopK, base.hydrateTopK, 1, 20),
    unusedSuggestTurns: parseBoundedInt(raw.unusedSuggestTurns, base.unusedSuggestTurns, 1, 10_000),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt
  };
}

function isSettingsStore(store: unknown): store is DynToolSettingsStore {
  return !!store && typeof (store as DynToolSettingsStore).getDaemonControl === 'function';
}

export function hasPersistedDynToolSettings(store: DynToolSettingsStore | undefined): boolean {
  if (!isSettingsStore(store)) return false;
  return store.getDaemonControl?.(DYN_TOOL_SETTINGS_KEY) != null;
}

export function readDynToolSettings(store: DynToolSettingsStore | undefined): DynToolSettings {
  if (!isSettingsStore(store)) return defaultDynToolSettings();
  const saved = store.getDaemonControl?.(DYN_TOOL_SETTINGS_KEY);
  if (!saved || typeof saved !== 'object') return defaultDynToolSettings();
  return normalizeDynToolSettings(saved as Partial<DynToolSettings>);
}

export function writeDynToolSettings(
  store: DynToolSettingsStore,
  patch: DynToolSettingsPatch
): DynToolSettings {
  if (typeof store.setDaemonControl !== 'function') {
    return readDynToolSettings(store);
  }
  const current = readDynToolSettings(store);
  const next = normalizeDynToolSettings({
    ...current,
    ...patch,
    updatedAt: nowIso()
  });
  store.setDaemonControl(DYN_TOOL_SETTINGS_KEY, next);
  return next;
}

/** Effective master switch. Never reads a feature-switch env. */
export function resolveDynToolsEnabled(store: DynToolSettingsStore | undefined): boolean {
  return readDynToolSettings(store).enabled;
}
