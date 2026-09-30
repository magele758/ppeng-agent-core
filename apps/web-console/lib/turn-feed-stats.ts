/**
 * Per conversation-turn feed stats (user utterance → assistant reply end,
 * including tool calls). Usage comes from turn_end traces; elapsed prefers
 * turn_start…turn_end wall time, then message timestamps.
 */

import {
  formatChatFeedStatsLine,
  hasRealUsageTotals,
  parseTimeMs,
  parseUsageTotals,
  type ChatFeedStatsLabels,
  type SessionUsageTotals
} from './session-chrome.ts';

export type TurnFeedStatMessage = {
  role?: string;
  createdAt?: unknown;
};

export type TurnFeedTraceEvent = {
  kind: string;
  ts: string;
  payload?: unknown;
};

/** One user→assistant cycle in the chat feed (may cover multiple model turn_end events). */
export type ConversationTurnSlice = {
  /** Index of the leading user message in the feed array. */
  userIndex: number;
  /** Inclusive start index in the feed array (usually the user message). */
  startIndex: number;
  /** Inclusive end index of the last message belonging to this turn. */
  endIndex: number;
};

export type TurnFeedStat = {
  elapsedMs?: number;
  usageTotals?: SessionUsageTotals;
  usageCostUsd?: number;
};

function isUserRole(role: unknown): boolean {
  return role === 'user';
}

/**
 * Split chronological messages into conversation turns: each slice starts at a
 * user message and runs until the message before the next user (or end).
 */
export function sliceConversationTurns(messages: TurnFeedStatMessage[]): ConversationTurnSlice[] {
  const slices: ConversationTurnSlice[] = [];
  let userIndex = -1;
  for (let i = 0; i < messages.length; i += 1) {
    if (isUserRole(messages[i]?.role)) {
      if (userIndex >= 0) {
        slices.push({ userIndex, startIndex: userIndex, endIndex: i - 1 });
      }
      userIndex = i;
    }
  }
  if (userIndex >= 0) {
    slices.push({ userIndex, startIndex: userIndex, endIndex: messages.length - 1 });
  }
  return slices;
}

function readCostUsd(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const n = (payload as Record<string, unknown>).costUsd;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
}

type ModelTurnWindow = {
  startMs: number;
  endMs: number;
  usage?: SessionUsageTotals;
  costUsd?: number;
};

/**
 * Pair turn_start…turn_end (or cancel) into model-call windows with optional usage.
 * An unmatched trailing turn_start becomes an open window ending at `openEndMs`
 * (caller typically passes `now` while the session is still running).
 */
export function extractModelTurnWindows(
  events: TurnFeedTraceEvent[],
  opts?: { openEndMs?: number }
): ModelTurnWindow[] {
  const sorted = [...events].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const windows: ModelTurnWindow[] = [];
  let openStart: number | undefined;
  for (const ev of sorted) {
    const ts = parseTimeMs(ev.ts);
    if (ts == null) continue;
    if (ev.kind === 'turn_start') {
      openStart = ts;
      continue;
    }
    if (ev.kind === 'turn_end' || ev.kind === 'cancel') {
      const startMs = openStart ?? ts;
      const usage =
        ev.kind === 'turn_end'
          ? parseUsageTotals(
              ev.payload && typeof ev.payload === 'object'
                ? (ev.payload as Record<string, unknown>).usage
                : undefined
            )
          : undefined;
      const costUsd = ev.kind === 'turn_end' ? readCostUsd(ev.payload) : undefined;
      windows.push({ startMs, endMs: ts, usage, costUsd });
      openStart = undefined;
    }
  }
  if (openStart != null && typeof opts?.openEndMs === 'number' && opts.openEndMs >= openStart) {
    windows.push({ startMs: openStart, endMs: opts.openEndMs });
  }
  return windows;
}

function mergeUsageTotals(
  a: SessionUsageTotals | undefined,
  b: SessionUsageTotals | undefined
): SessionUsageTotals | undefined {
  if (!a && !b) return undefined;
  const inputTokens = (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0);
  const outputTokens = (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0);
  const totalTokens = (a?.totalTokens ?? 0) + (b?.totalTokens ?? 0);
  const out: SessionUsageTotals = {};
  if (inputTokens > 0) out.inputTokens = inputTokens;
  if (outputTokens > 0) out.outputTokens = outputTokens;
  if (totalTokens > 0) out.totalTokens = totalTokens;
  return hasRealUsageTotals(out) ? out : undefined;
}

function messageWindowBounds(
  messages: TurnFeedStatMessage[],
  slice: ConversationTurnSlice,
  nextSlice: ConversationTurnSlice | undefined
): { startMs?: number; endMsExclusive?: number; lastMsgMs?: number } {
  const startMs = parseTimeMs(messages[slice.userIndex]?.createdAt);
  const nextUserMs = nextSlice ? parseTimeMs(messages[nextSlice.userIndex]?.createdAt) : undefined;
  let lastMsgMs: number | undefined;
  for (let i = slice.startIndex; i <= slice.endIndex; i += 1) {
    const t = parseTimeMs(messages[i]?.createdAt);
    if (t != null) lastMsgMs = lastMsgMs == null ? t : Math.max(lastMsgMs, t);
  }
  return { startMs, endMsExclusive: nextUserMs, lastMsgMs };
}

function windowOverlaps(
  win: ModelTurnWindow,
  startMs: number | undefined,
  endMsExclusive: number | undefined
): boolean {
  if (startMs == null) return false;
  if (win.endMs < startMs) return false;
  if (endMsExclusive != null && win.startMs >= endMsExclusive) return false;
  return true;
}

/**
 * Build one stats object per conversation turn. Returns null entries when that
 * turn has neither elapsed nor real usage/cost (caller should not render).
 */
export function buildTurnFeedStats(input: {
  messages: TurnFeedStatMessage[];
  traces?: TurnFeedTraceEvent[];
  /** While the latest turn is still running, extend its end to `now`. */
  running?: boolean;
  now?: number;
}): Array<TurnFeedStat | null> {
  const slices = sliceConversationTurns(input.messages);
  if (!slices.length) return [];
  const now = input.now ?? Date.now();
  const modelWindows = extractModelTurnWindows(input.traces ?? [], {
    openEndMs: input.running ? now : undefined
  });
  const out: Array<TurnFeedStat | null> = [];

  for (let si = 0; si < slices.length; si += 1) {
    const slice = slices[si]!;
    const next = slices[si + 1];
    const bounds = messageWindowBounds(input.messages, slice, next);
    const isLiveTail = Boolean(input.running) && si === slices.length - 1;

    let usage: SessionUsageTotals | undefined;
    let costUsd = 0;
    let hasCost = false;
    let firstModelStart: number | undefined;
    let lastModelEnd: number | undefined;

    for (const win of modelWindows) {
      if (!windowOverlaps(win, bounds.startMs, bounds.endMsExclusive)) continue;
      usage = mergeUsageTotals(usage, win.usage);
      if (typeof win.costUsd === 'number') {
        costUsd += win.costUsd;
        hasCost = true;
      }
      firstModelStart =
        firstModelStart == null ? win.startMs : Math.min(firstModelStart, win.startMs);
      lastModelEnd = lastModelEnd == null ? win.endMs : Math.max(lastModelEnd, win.endMs);
    }

    let elapsedMs: number | undefined;
    if (firstModelStart != null) {
      const end = isLiveTail ? now : (lastModelEnd ?? bounds.lastMsgMs ?? firstModelStart);
      if (end >= firstModelStart) elapsedMs = end - firstModelStart;
    } else if (bounds.startMs != null) {
      const endMs = isLiveTail ? now : bounds.lastMsgMs;
      if (endMs != null && endMs >= bounds.startMs && (endMs > bounds.startMs || isLiveTail)) {
        elapsedMs = endMs - bounds.startMs;
      }
    }

    const stat: TurnFeedStat = {};
    if (typeof elapsedMs === 'number' && Number.isFinite(elapsedMs) && elapsedMs >= 0) {
      stat.elapsedMs = elapsedMs;
    }
    if (usage) stat.usageTotals = usage;
    if (hasCost && costUsd > 0) stat.usageCostUsd = Math.round(costUsd * 1e6) / 1e6;

    const hasAnything =
      stat.elapsedMs != null ||
      hasRealUsageTotals(stat.usageTotals) ||
      (typeof stat.usageCostUsd === 'number' && stat.usageCostUsd > 0);
    out.push(hasAnything ? stat : null);
  }

  return out;
}

export function formatTurnFeedStatsLine(
  stat: TurnFeedStat | null | undefined,
  labels?: ChatFeedStatsLabels
): string | null {
  if (!stat) return null;
  return formatChatFeedStatsLine({
    elapsedMs: stat.elapsedMs,
    usageTotals: stat.usageTotals,
    usageCostUsd: stat.usageCostUsd,
    labels
  });
}
