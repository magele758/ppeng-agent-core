/**
 * Inbox overflow `drop=summarize` (Phase 3 / OpenClaw queue cap).
 *
 * Default cap is unlimited (null): never drop, kernel-lock "steer next shot"
 * stays. When Lab persists `loop_settings.inboxOverflowCap` as a positive
 * integer, unclaimed > cap folds the oldest items into one system inbox
 * (deterministic concat/truncate — not an LLM). Same-key overlay is unchanged
 * at claim. Does not mutate in-flight model HTTP.
 *
 * No RAW_AGENT_* env vars — control plane is GET/PATCH /api/loop/settings.
 */

import type { EnqueueSteerOptions, InboxItem } from './step-inbox.js';

/** Must match `AGENT_LOOP_SETTINGS_KEY` in steer-drain.ts (avoid import cycle). */
const LOOP_SETTINGS_KV_KEY = 'loop_settings';

/** Stable key so later overflow summaries overlay earlier ones at claim. */
export const INBOX_OVERFLOW_KEY = 'inbox-overflow';
export const INBOX_OVERFLOW_PREFIX = '[inbox overflow]';
/** Suggested Lab value when the operator turns the feature on. */
export const SUGGESTED_INBOX_OVERFLOW_CAP = 20;
/** Default: off / ∞ — never drop. */
export const DEFAULT_INBOX_OVERFLOW_CAP: number | null = null;

const ITEM_TEXT_MAX = 240;
const SUMMARY_MAX = 2400;

export interface InboxOverflowHost {
  listUnclaimed(sessionId: string): InboxItem[];
  markClaimed(ids: string[]): void;
  enqueueSummary(sessionId: string, text: string, opts: EnqueueSteerOptions): InboxItem;
}

export interface InboxOverflowSettingsStore {
  getDaemonControl?(key: string): unknown;
}

/**
 * Valid cap: positive integer.
 * Explicit off: null (also 0 / false / 'off' / 'unlimited' / Infinity).
 * Omitted or invalid: undefined.
 */
export function parseInboxOverflowCap(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === false) return null;
  if (raw === true) return SUGGESTED_INBOX_OVERFLOW_CAP;
  if (typeof raw === 'number') {
    if (raw === 0) return null;
    if (!Number.isFinite(raw)) return null;
    if (Number.isInteger(raw) && raw > 0) return raw;
    return undefined;
  }
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    if (s === '' || s === 'off' || s === 'unlimited' || s === 'infinity' || s === 'inf' || s === 'null') {
      return null;
    }
    if (!/^\d+$/.test(s)) return undefined;
    const n = Number(s);
    if (n === 0) return null;
    return n;
  }
  return undefined;
}

/**
 * option > session.metadata > loop_settings KV > unlimited (null).
 */
export function resolveInboxOverflowCap(input: {
  option?: number | null;
  sessionMetadata?: Record<string, unknown>;
  store?: InboxOverflowSettingsStore;
}): number | null {
  if (input.option !== undefined) {
    const fromOption = parseInboxOverflowCap(input.option);
    if (fromOption !== undefined) return fromOption;
  }
  const fromSession = parseInboxOverflowCap(input.sessionMetadata?.inboxOverflowCap);
  if (fromSession !== undefined) return fromSession;
  const saved = input.store?.getDaemonControl?.(LOOP_SETTINGS_KV_KEY);
  if (saved && typeof saved === 'object') {
    const fromKv = parseInboxOverflowCap((saved as Record<string, unknown>).inboxOverflowCap);
    if (fromKv !== undefined) return fromKv;
  }
  return DEFAULT_INBOX_OVERFLOW_CAP;
}

/**
 * Oldest items to claim/drop so that after inserting one summary,
 * unclaimed.length === cap. Empty when cap is off or not exceeded.
 */
export function planInboxOverflow<T>(unclaimed: readonly T[], cap: number | null | undefined): T[] {
  if (cap == null || !Number.isInteger(cap) || cap <= 0) return [];
  if (unclaimed.length <= cap) return [];
  const foldCount = unclaimed.length - cap + 1;
  return unclaimed.slice(0, foldCount) as T[];
}

export function summarizeInboxOverflow(
  items: ReadonlyArray<Pick<InboxItem, 'role' | 'text' | 'target'>>
): string {
  const lines = items.map((item, i) => {
    const role = item.role ?? 'user';
    const target = item.target ?? 'next-step';
    return `${i + 1}. [${role}/${target}] ${clip(item.text ?? '', ITEM_TEXT_MAX)}`;
  });
  const head = `${INBOX_OVERFLOW_PREFIX} ${items.length} older unclaimed item(s) summarized (drop=summarize):`;
  return clip([head, ...lines].join('\n'), SUMMARY_MAX);
}

/**
 * Fold overflow into one system inbox. No-op when cap is off / not exceeded.
 * Caller must enqueue the triggering item *before* calling this.
 */
export function applyInboxOverflow(
  host: InboxOverflowHost,
  sessionId: string,
  cap: number | null | undefined
): InboxItem | undefined {
  const fold = planInboxOverflow(host.listUnclaimed(sessionId), cap);
  if (fold.length === 0) return undefined;
  host.markClaimed(fold.map((item) => item.id));
  return host.enqueueSummary(sessionId, summarizeInboxOverflow(fold), {
    target: 'next-step',
    role: 'system',
    key: INBOX_OVERFLOW_KEY
  });
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}
