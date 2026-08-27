/**
 * Agent-loop Lab settings (steer drain + inbox overflow cap).
 * Persisted in daemon_control KV. Same key/shape core resolvers read
 * (`loop_settings.steerDrainPolicy`, `loop_settings.inboxOverflowCap`).
 * No RAW_AGENT_* switches — UI / PATCH /api/loop/settings is the control plane.
 */

import {
  AGENT_LOOP_SETTINGS_KEY,
  DEFAULT_STEER_DRAIN_POLICY,
  parseInboxOverflowCap,
  parseSteerDrainPolicy,
  type SteerDrainPolicy
} from '@ppeng/agent-core';

export const LOOP_SETTINGS_KEY = AGENT_LOOP_SETTINGS_KEY;
export { parseInboxOverflowCap, parseSteerDrainPolicy };
export type { SteerDrainPolicy };

/** Default: steer lands on the next model shot only (kernel lock); inbox never drops. */
export interface LoopSettings {
  steerDrainPolicy: SteerDrainPolicy;
  /** null = unlimited (default). Positive integer = max unclaimed inbox items. */
  inboxOverflowCap: number | null;
  updatedAt: string;
}

export interface LoopSettingsPatch {
  steerDrainPolicy?: SteerDrainPolicy;
  inboxOverflowCap?: number | null;
}

export interface LoopSettingsStore {
  getDaemonControl<T>(key: string): T | undefined;
  setDaemonControl(key: string, value: unknown): void;
}

export function defaultLoopSettings(): LoopSettings {
  return {
    steerDrainPolicy: DEFAULT_STEER_DRAIN_POLICY,
    inboxOverflowCap: null,
    updatedAt: new Date().toISOString()
  };
}

export function normalizeLoopSettings(raw: Partial<LoopSettings> | null | undefined): LoopSettings {
  const base = defaultLoopSettings();
  if (!raw || typeof raw !== 'object') return base;
  const policy = parseSteerDrainPolicy(raw.steerDrainPolicy);
  const cap =
    'inboxOverflowCap' in raw ? parseInboxOverflowCap(raw.inboxOverflowCap) : undefined;
  return {
    steerDrainPolicy: policy ?? base.steerDrainPolicy,
    inboxOverflowCap: cap === undefined ? base.inboxOverflowCap : cap,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt
  };
}

export function readLoopSettings(store: LoopSettingsStore): LoopSettings {
  const saved = store.getDaemonControl<Partial<LoopSettings>>(LOOP_SETTINGS_KEY);
  if (!saved) return defaultLoopSettings();
  return normalizeLoopSettings(saved);
}

export function writeLoopSettings(store: LoopSettingsStore, patch: LoopSettingsPatch): LoopSettings {
  const current = readLoopSettings(store);
  const next = normalizeLoopSettings({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  });
  store.setDaemonControl(LOOP_SETTINGS_KEY, next);
  return next;
}

export function hasPersistedLoopSettings(store: LoopSettingsStore): boolean {
  return store.getDaemonControl(LOOP_SETTINGS_KEY) != null;
}

/** Explicit runSession option; kernel also reads the same KV as fallback. */
export function loopSettingsAsRuntimeHint(settings: LoopSettings): {
  steerDrainPolicy: SteerDrainPolicy;
  inboxOverflowCap: number | null;
} {
  return {
    steerDrainPolicy: settings.steerDrainPolicy,
    inboxOverflowCap: settings.inboxOverflowCap
  };
}
