/**
 * Memory + Context Compiler Lab settings.
 * Persisted in daemon_control KV. No new RAW_AGENT_* feature switches.
 */

import { nowIso } from '../id.js';

export const MEMORY_SETTINGS_KEY = 'memory_settings';

export type MemoryCuratorMode = 'inline' | 'observe_only' | 'off';

export interface MemorySettings {
  /** inline = async curate; observe_only = record only; off = skip curator. */
  curatorMode: MemoryCuratorMode;
  /** Extract semantic facts at turn end. */
  dialogueExtract: boolean;
  /** Distill facts + journal after curator accept (throttled). */
  dreamerEnabled: boolean;
  /** Compile four-slot appendix by query in prepareTurnInput. */
  compilerEnabled: boolean;
  /**
   * Try OpenAI-compatible embeddings at recall (RRF with FTS).
   * Off / missing key → lexical FTS only. No new RAW_AGENT_* switch.
   */
  embeddingRecall: boolean;
  /** Min distinct tools before a task memory is worth writing. */
  minTaskTools: number;
  updatedAt: string;
}

export interface MemorySettingsPatch {
  curatorMode?: MemoryCuratorMode;
  dialogueExtract?: boolean;
  dreamerEnabled?: boolean;
  compilerEnabled?: boolean;
  embeddingRecall?: boolean;
  minTaskTools?: number;
}

export interface MemorySettingsStore {
  getDaemonControl(key: string): unknown;
  setDaemonControl?(key: string, value: unknown): void;
}

const CURATOR_MODES: readonly MemoryCuratorMode[] = ['inline', 'observe_only', 'off'];

export function parseCuratorMode(raw: unknown): MemoryCuratorMode | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  return (CURATOR_MODES as readonly string[]).includes(v) ? (v as MemoryCuratorMode) : undefined;
}

export function parseMinTaskTools(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 20) return undefined;
  return n;
}

export function defaultMemorySettings(): MemorySettings {
  return {
    curatorMode: 'inline',
    dialogueExtract: true,
    dreamerEnabled: true,
    compilerEnabled: true,
    embeddingRecall: false,
    minTaskTools: 3,
    updatedAt: nowIso()
  };
}

export function normalizeMemorySettings(raw: Partial<MemorySettings> | null | undefined): MemorySettings {
  const base = defaultMemorySettings();
  if (!raw || typeof raw !== 'object') return base;
  return {
    curatorMode: parseCuratorMode(raw.curatorMode) ?? base.curatorMode,
    dialogueExtract: raw.dialogueExtract !== undefined ? Boolean(raw.dialogueExtract) : base.dialogueExtract,
    dreamerEnabled: raw.dreamerEnabled !== undefined ? Boolean(raw.dreamerEnabled) : base.dreamerEnabled,
    compilerEnabled: raw.compilerEnabled !== undefined ? Boolean(raw.compilerEnabled) : base.compilerEnabled,
    embeddingRecall: raw.embeddingRecall !== undefined ? Boolean(raw.embeddingRecall) : base.embeddingRecall,
    minTaskTools: parseMinTaskTools(raw.minTaskTools) ?? base.minTaskTools,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt
  };
}

function isReadStore(store: unknown): store is MemorySettingsStore {
  return !!store && typeof (store as MemorySettingsStore).getDaemonControl === 'function';
}

export function hasPersistedMemorySettings(
  store: { getDaemonControl?(key: string): unknown } | undefined
): boolean {
  if (!isReadStore(store)) return false;
  return store.getDaemonControl(MEMORY_SETTINGS_KEY) != null;
}

export function readMemorySettings(store: MemorySettingsStore): MemorySettings {
  const saved = store.getDaemonControl(MEMORY_SETTINGS_KEY);
  if (!saved) return defaultMemorySettings();
  return normalizeMemorySettings(saved as Partial<MemorySettings>);
}

export function writeMemorySettings(store: MemorySettingsStore, patch: MemorySettingsPatch): MemorySettings {
  if (typeof store.setDaemonControl !== 'function') {
    throw new Error('memory settings store cannot persist');
  }
  const current = readMemorySettings(store);
  const next = normalizeMemorySettings({
    ...current,
    ...patch,
    updatedAt: nowIso()
  });
  store.setDaemonControl(MEMORY_SETTINGS_KEY, next);
  return next;
}

export function resolveMemorySettings(store?: { getDaemonControl?(key: string): unknown }): MemorySettings {
  if (!isReadStore(store)) return defaultMemorySettings();
  return readMemorySettings(store);
}
