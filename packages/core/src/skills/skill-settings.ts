/**
 * Skill catalog disclosure Lab settings.
 * Persisted in daemon_control KV. UI / PATCH /api/skills/settings is the
 * control plane — no new RAW_AGENT_* switch for disclosure.
 *
 * Orthogonal to RAW_AGENT_SKILL_ROUTING_MODE (how to score). This setting
 * only controls what the prompt lists:
 *   shortlist — top-K name+description (default hybrid)
 *   lazy      — no catalog in prompt; search_skills then load_skill
 *   full      — list every skill name+description
 *
 * Env fallback only when the UI has never saved: routing `legacy` → full,
 * otherwise shortlist. Lazy is never implied by env.
 */

import { nowIso } from '../id.js';
import { skillRoutingModeFromEnv } from './skill-router.js';

export const SKILL_SETTINGS_KEY = 'skill_settings';

export const SKILL_DISCLOSURE_MODES = ['shortlist', 'lazy', 'full'] as const;

export type SkillDisclosureMode = (typeof SKILL_DISCLOSURE_MODES)[number];

export interface SkillSettings {
  disclosureMode: SkillDisclosureMode;
  updatedAt: string;
}

export interface SkillSettingsPatch {
  disclosureMode?: SkillDisclosureMode;
}

export interface SkillSettingsStore {
  getDaemonControl(key: string): unknown;
  setDaemonControl?(key: string, value: unknown): void;
}

export function parseSkillDisclosureMode(raw: unknown): SkillDisclosureMode | undefined {
  if (typeof raw !== 'string') return undefined;
  return (SKILL_DISCLOSURE_MODES as readonly string[]).includes(raw)
    ? (raw as SkillDisclosureMode)
    : undefined;
}

export function defaultSkillSettings(): SkillSettings {
  return {
    disclosureMode: 'shortlist',
    updatedAt: nowIso()
  };
}

export function normalizeSkillSettings(
  raw: Partial<SkillSettings> | null | undefined
): SkillSettings {
  const base = defaultSkillSettings();
  if (!raw || typeof raw !== 'object') return base;
  return {
    disclosureMode: parseSkillDisclosureMode(raw.disclosureMode) ?? base.disclosureMode,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt
  };
}

function isReadStore(store: unknown): store is SkillSettingsStore {
  return !!store && typeof (store as SkillSettingsStore).getDaemonControl === 'function';
}

export function hasPersistedSkillSettings(
  store: { getDaemonControl?(key: string): unknown } | undefined
): boolean {
  if (!isReadStore(store)) return false;
  return store.getDaemonControl(SKILL_SETTINGS_KEY) != null;
}

export function readSkillSettings(store: SkillSettingsStore): SkillSettings {
  const saved = store.getDaemonControl(SKILL_SETTINGS_KEY);
  if (!saved) return defaultSkillSettings();
  return normalizeSkillSettings(saved as Partial<SkillSettings>);
}

export function writeSkillSettings(
  store: SkillSettingsStore,
  patch: SkillSettingsPatch
): SkillSettings {
  if (typeof store.setDaemonControl !== 'function') {
    throw new Error('skill settings store cannot persist');
  }
  const current = readSkillSettings(store);
  const next = normalizeSkillSettings({
    ...current,
    ...patch,
    updatedAt: nowIso()
  });
  store.setDaemonControl(SKILL_SETTINGS_KEY, next);
  return next;
}

function disclosureFromEnv(env: NodeJS.ProcessEnv | undefined): SkillDisclosureMode {
  return skillRoutingModeFromEnv(env) === 'legacy' ? 'full' : 'shortlist';
}

/** Effective disclosure: persisted Lab value wins after the first save. */
export function resolveSkillDisclosureMode(input: {
  store?: { getDaemonControl?(key: string): unknown };
  env?: NodeJS.ProcessEnv;
}): SkillDisclosureMode {
  if (!hasPersistedSkillSettings(input.store) || !input.store?.getDaemonControl) {
    return disclosureFromEnv(input.env);
  }
  return readSkillSettings({
    getDaemonControl: (key) => input.store!.getDaemonControl!(key)
  }).disclosureMode;
}
