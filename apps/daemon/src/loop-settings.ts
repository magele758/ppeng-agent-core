/**
 * Agent-loop Lab settings (steer drain policy). Persisted in daemon_control KV.
 * No RAW_AGENT_* switches — UI / PATCH /api/loop/settings is the control plane.
 *
 * Phase 3 A3 (core) will read the same KV and pass `steerDrainPolicy` into
 * prepareTurnInput / tool-launch checks. Until then this module only stores
 * the policy; do not invent a second inbox here.
 */

export const LOOP_SETTINGS_KEY = 'loop_settings';

/** Default: steer lands on the next model shot only (kernel lock). */
export type SteerDrainPolicy = 'next_shot_only' | 'tool_launch';

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
    steerDrainPolicy: 'next_shot_only',
    updatedAt: new Date().toISOString()
  };
}

export function parseSteerDrainPolicy(raw: unknown): SteerDrainPolicy | undefined {
  if (raw === 'next_shot_only' || raw === 'tool_launch') return raw;
  return undefined;
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

/**
 * Hint object for a future RuntimeOptions.steerDrainPolicy field.
 * Main's prepareTurnInput does not consume this yet (Phase 3 A3).
 */
export function loopSettingsAsRuntimeHint(settings: LoopSettings): {
  steerDrainPolicy: SteerDrainPolicy;
} {
  return { steerDrainPolicy: settings.steerDrainPolicy };
}
