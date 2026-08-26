/**
 * Agent-loop Lab settings (steer drain policy). Persisted in daemon_control KV.
 * Same key/shape core `resolveSteerDrainPolicy` reads (`loop_settings.steerDrainPolicy`).
 * No RAW_AGENT_* switches — UI / PATCH /api/loop/settings is the control plane.
 */

import {
  AGENT_LOOP_SETTINGS_KEY,
  DEFAULT_STEER_DRAIN_POLICY,
  parseSteerDrainPolicy,
  type SteerDrainPolicy
} from '@ppeng/agent-core';

export const LOOP_SETTINGS_KEY = AGENT_LOOP_SETTINGS_KEY;
export { parseSteerDrainPolicy };
export type { SteerDrainPolicy };

/** Default: steer lands on the next model shot only (kernel lock). */
export interface LoopSettings {
  steerDrainPolicy: SteerDrainPolicy;
  updatedAt: string;
}

export interface LoopSettingsPatch {
  steerDrainPolicy?: SteerDrainPolicy;
}

export interface LoopSettingsStore {
  getDaemonControl<T>(key: string): T | undefined;
  setDaemonControl(key: string, value: unknown): void;
}

export function defaultLoopSettings(): LoopSettings {
  return {
    steerDrainPolicy: DEFAULT_STEER_DRAIN_POLICY,
    updatedAt: new Date().toISOString()
  };
}

export function normalizeLoopSettings(raw: Partial<LoopSettings> | null | undefined): LoopSettings {
  const base = defaultLoopSettings();
  if (!raw || typeof raw !== 'object') return base;
  const policy = parseSteerDrainPolicy(raw.steerDrainPolicy);
  return {
    steerDrainPolicy: policy ?? base.steerDrainPolicy,
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
} {
  return { steerDrainPolicy: settings.steerDrainPolicy };
}
