/**
 * EventLog / Saga settings — daemon_control KV. No RAW_AGENT_* switch.
 */

import { nowIso } from '../id.js';

export const EVENT_LOG_SETTINGS_KEY = 'event_log_settings';

export interface EventLogSettings {
  /** When false, kernel skips EventLog writes. Default on (additive, WAL unchanged). */
  enabled: boolean;
  updatedAt: string;
}

export interface EventLogSettingsPatch {
  enabled?: boolean;
}

export interface EventLogSettingsStore {
  getDaemonControl?(key: string): unknown;
  setDaemonControl?(key: string, value: unknown): void;
}

export function defaultEventLogSettings(): EventLogSettings {
  return { enabled: true, updatedAt: nowIso() };
}

export function normalizeEventLogSettings(
  raw: Partial<EventLogSettings> | null | undefined
): EventLogSettings {
  const base = defaultEventLogSettings();
  if (!raw || typeof raw !== 'object') return base;
  return {
    enabled: raw.enabled !== false,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt
  };
}

export function hasPersistedEventLogSettings(store?: EventLogSettingsStore): boolean {
  return store?.getDaemonControl?.(EVENT_LOG_SETTINGS_KEY) != null;
}

export function readEventLogSettings(store?: EventLogSettingsStore): EventLogSettings {
  const saved = store?.getDaemonControl?.(EVENT_LOG_SETTINGS_KEY);
  if (!saved) return defaultEventLogSettings();
  return normalizeEventLogSettings(saved as Partial<EventLogSettings>);
}

export function writeEventLogSettings(
  store: EventLogSettingsStore,
  patch: EventLogSettingsPatch
): EventLogSettings {
  if (typeof store.setDaemonControl !== 'function') {
    throw new Error('event-log settings store cannot persist');
  }
  const next = normalizeEventLogSettings({
    ...readEventLogSettings(store),
    ...patch,
    updatedAt: nowIso()
  });
  store.setDaemonControl(EVENT_LOG_SETTINGS_KEY, next);
  return next;
}

export function isEventLogEnabled(store?: EventLogSettingsStore): boolean {
  return readEventLogSettings(store).enabled;
}
