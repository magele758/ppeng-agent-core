/**
 * Attachment / artifact ingestion settings — persisted in daemon_control KV.
 * Lab UI is the control plane; no new RAW_AGENT_* env switches.
 */

import { nowIso } from '../id.js';

export const INGESTION_SETTINGS_KEY = 'ingestion_settings';

export const DEFAULT_DOWNLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_INLINE_TEXT_MAX_BYTES = 100 * 1024;
export const DEFAULT_ARCHIVE_PREVIEW_CHARS = 1000;
export const DEFAULT_PAGE_SIZE_CHARS = 12_000;
export const DEFAULT_TOOL_RESULT_ARCHIVE_CHARS = 80_000;

export interface IngestionSettings {
  /** Master switch. When false, ingest APIs still accept but pipeline can skip archive. */
  enabled: boolean;
  maxBytes: number;
  inlineTextMaxBytes: number;
  archivePreviewChars: number;
  pageSizeChars: number;
  gbkFallback: boolean;
  /** Tool results longer than this become paged artifacts (retrieve still works). */
  toolResultArchiveChars: number;
  updatedAt: string;
}

export interface IngestionSettingsPatch {
  enabled?: boolean;
  maxBytes?: number;
  inlineTextMaxBytes?: number;
  archivePreviewChars?: number;
  pageSizeChars?: number;
  gbkFallback?: boolean;
  toolResultArchiveChars?: number;
}

export interface IngestionSettingsStore {
  getDaemonControl<T>(key: string): T | undefined;
  setDaemonControl(key: string, value: unknown): void;
}

export function defaultIngestionSettings(): IngestionSettings {
  return {
    enabled: true,
    maxBytes: DEFAULT_DOWNLOAD_MAX_BYTES,
    inlineTextMaxBytes: DEFAULT_INLINE_TEXT_MAX_BYTES,
    archivePreviewChars: DEFAULT_ARCHIVE_PREVIEW_CHARS,
    pageSizeChars: DEFAULT_PAGE_SIZE_CHARS,
    gbkFallback: true,
    toolResultArchiveChars: DEFAULT_TOOL_RESULT_ARCHIVE_CHARS,
    updatedAt: nowIso()
  };
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function normalizeIngestionSettings(
  raw: Partial<IngestionSettings> | null | undefined
): IngestionSettings {
  const base = defaultIngestionSettings();
  if (!raw || typeof raw !== 'object') return base;
  return {
    enabled: raw.enabled !== false,
    maxBytes: clampInt(raw.maxBytes, base.maxBytes, 1024, 80 * 1024 * 1024),
    inlineTextMaxBytes: clampInt(raw.inlineTextMaxBytes, base.inlineTextMaxBytes, 1024, 2 * 1024 * 1024),
    archivePreviewChars: clampInt(raw.archivePreviewChars, base.archivePreviewChars, 100, 20_000),
    pageSizeChars: clampInt(raw.pageSizeChars, base.pageSizeChars, 1000, 80_000),
    gbkFallback: raw.gbkFallback !== false,
    toolResultArchiveChars: clampInt(
      raw.toolResultArchiveChars,
      base.toolResultArchiveChars,
      2000,
      500_000
    ),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt
  };
}

export function readIngestionSettings(store: IngestionSettingsStore): IngestionSettings {
  const saved = store.getDaemonControl<Partial<IngestionSettings>>(INGESTION_SETTINGS_KEY);
  if (!saved) return defaultIngestionSettings();
  return normalizeIngestionSettings(saved);
}

export function writeIngestionSettings(
  store: IngestionSettingsStore,
  patch: IngestionSettingsPatch
): IngestionSettings {
  const current = readIngestionSettings(store);
  const next = normalizeIngestionSettings({
    ...current,
    ...patch,
    updatedAt: nowIso()
  });
  store.setDaemonControl(INGESTION_SETTINGS_KEY, next);
  return next;
}

function isSettingsStore(store: unknown): store is IngestionSettingsStore {
  return (
    !!store &&
    typeof (store as IngestionSettingsStore).getDaemonControl === 'function' &&
    typeof (store as IngestionSettingsStore).setDaemonControl === 'function'
  );
}

export function hasPersistedIngestionSettings(store: IngestionSettingsStore | undefined): boolean {
  if (!isSettingsStore(store)) return false;
  return store.getDaemonControl(INGESTION_SETTINGS_KEY) != null;
}

export function resolveIngestionSettings(
  store: IngestionSettingsStore | undefined
): IngestionSettings {
  if (isSettingsStore(store)) return readIngestionSettings(store);
  return defaultIngestionSettings();
}
