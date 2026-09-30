/**
 * Skill self-authoring (skill_propose + review queue) Lab settings — daemon_control KV.
 * No RAW_AGENT_* feature switch. Unconfigured → disabled, no reminders.
 */

import { nowIso } from '../id.js';

export const SKILL_PROPOSAL_SETTINGS_KEY = 'skill_proposal_settings';

export const SKILL_PROPOSAL_REMIND_MAX = 1000;

export interface SkillProposalSettings {
  /** Master switch: exposes skill_propose to the model. */
  enabled: boolean;
  /** Remind the model every N tool calls in a turn-tail user note; 0 = never. */
  remindEveryNToolCalls: number;
  updatedAt: string;
}

export interface SkillProposalSettingsPatch {
  enabled?: boolean;
  remindEveryNToolCalls?: number;
}

export interface SkillProposalSettingsStore {
  getDaemonControl?(key: string): unknown;
  setDaemonControl?(key: string, value: unknown): void;
}

export function defaultSkillProposalSettings(): SkillProposalSettings {
  return { enabled: false, remindEveryNToolCalls: 0, updatedAt: nowIso() };
}

export function parseRemindEvery(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > SKILL_PROPOSAL_REMIND_MAX) return undefined;
  return n;
}

export function normalizeSkillProposalSettings(
  raw: Partial<SkillProposalSettings> | null | undefined
): SkillProposalSettings {
  const base = defaultSkillProposalSettings();
  if (!raw || typeof raw !== 'object') return base;
  return {
    enabled: Boolean(raw.enabled),
    remindEveryNToolCalls: parseRemindEvery(raw.remindEveryNToolCalls) ?? base.remindEveryNToolCalls,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt
  };
}

function isReadStore(store: unknown): store is SkillProposalSettingsStore {
  return !!store && typeof (store as SkillProposalSettingsStore).getDaemonControl === 'function';
}

export function hasPersistedSkillProposalSettings(store: SkillProposalSettingsStore | undefined): boolean {
  if (!isReadStore(store)) return false;
  return store.getDaemonControl?.(SKILL_PROPOSAL_SETTINGS_KEY) != null;
}

export function readSkillProposalSettings(store: SkillProposalSettingsStore | undefined): SkillProposalSettings {
  if (!isReadStore(store)) return defaultSkillProposalSettings();
  const saved = store.getDaemonControl?.(SKILL_PROPOSAL_SETTINGS_KEY);
  if (!saved || typeof saved !== 'object') return defaultSkillProposalSettings();
  return normalizeSkillProposalSettings(saved as Partial<SkillProposalSettings>);
}

export function writeSkillProposalSettings(
  store: SkillProposalSettingsStore,
  patch: SkillProposalSettingsPatch
): SkillProposalSettings {
  if (typeof store.setDaemonControl !== 'function') {
    throw new Error('skill proposal settings store cannot persist');
  }
  const current = readSkillProposalSettings(store);
  const next = normalizeSkillProposalSettings({
    ...current,
    ...(patch.enabled !== undefined ? { enabled: Boolean(patch.enabled) } : {}),
    ...(parseRemindEvery(patch.remindEveryNToolCalls) !== undefined
      ? { remindEveryNToolCalls: parseRemindEvery(patch.remindEveryNToolCalls) }
      : {}),
    updatedAt: nowIso()
  });
  store.setDaemonControl(SKILL_PROPOSAL_SETTINGS_KEY, next);
  return next;
}

/** Effective master switch. Never reads a feature-switch env. */
export function resolveSkillProposalsEnabled(store: SkillProposalSettingsStore | undefined): boolean {
  return readSkillProposalSettings(store).enabled;
}
