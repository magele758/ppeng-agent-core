/**
 * Threshold-driven compaction as a range replace on the session surface.
 *
 * Fold tokens (not WAL length) decide when to fire. A contiguous closed-turn
 * seq range is summarized and appended as a replace node; WAL rows stay. If
 * the remaining window is still over budget, prune the oldest closed
 * tool_result via a single-seq replace — never pretend we compacted by
 * returning early.
 */

import { estimateMessageTokens } from '../model/token-estimate.js';
import {
  SurfaceInvariantError,
  assertNoOpenToolWaveForCompact,
  isToolWaveOpen,
  unmatchedToolCallIds
} from './surface-invariants.js';
import type { AgentSpec, SessionMessage, SessionRecord } from '../types.js';

export const COMPACT_KEEP_RECENT = 24;
const PRUNE_MIN_CHARS = 500;
const PRUNE_KEEP_CHARS = 400;

export interface AutoCompactStore {
  foldMessages(sessionId: string): SessionMessage[];
  appendReplacement(
    sessionId: string,
    input: {
      startSeq: number;
      endSeq: number;
      role: SessionMessage['role'];
      parts: SessionMessage['parts'];
      key?: string;
    }
  ): SessionMessage;
  appendMessage(
    sessionId: string,
    role: SessionMessage['role'],
    parts: SessionMessage['parts']
  ): SessionMessage;
  updateSession(
    sessionId: string,
    patch: Partial<Pick<SessionRecord, 'summary' | 'metadata'>>
  ): SessionRecord;
}

export interface AutoCompactResult {
  didCompact: boolean;
  pruned: boolean;
  replaced?: { startSeq: number; endSeq: number };
  skippedReason?: string;
  summary?: string;
}

export function isContextOverflowError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const s = msg.toLowerCase();
  return (
    /\b413\b/.test(s) ||
    s.includes('context_length') ||
    s.includes('prompt is too long') ||
    s.includes('maximum context') ||
    s.includes('payload too large') ||
    s.includes('context window')
  );
}

/** Closed prefix of fold that we can replace without splitting a tool wave. */
export function selectClosedPrefixRange(
  folded: SessionMessage[],
  keepRecent = COMPACT_KEEP_RECENT
): { startSeq: number; endSeq: number; older: SessionMessage[] } | null {
  const withSeq = folded.filter((m): m is SessionMessage & { seq: number } => typeof m.seq === 'number');
  if (withSeq.length < 2) return null;
  const keep = Math.min(keepRecent, Math.max(1, withSeq.length - 1));
  let cut = withSeq.length - keep;
  while (cut > 0) {
    const prefix = withSeq.slice(0, cut);
    if (!isToolWaveOpen(prefix)) {
      const last = prefix[prefix.length - 1]!;
      const next = withSeq[cut];
      if (!next || next.role === 'user' || last.role !== 'assistant' || unmatchedToolCallIds(prefix).length === 0) {
        return {
          startSeq: prefix[0]!.seq,
          endSeq: last.seq,
          older: prefix
        };
      }
    }
    cut -= 1;
  }
  return null;
}

export function findPrunableToolResult(
  folded: SessionMessage[]
): (SessionMessage & { seq: number }) | undefined {
  if (isToolWaveOpen(folded)) return undefined;
  for (const message of folded) {
    if (typeof message.seq !== 'number') continue;
    for (const part of message.parts) {
      if (part.type === 'tool_result' && part.content.length >= PRUNE_MIN_CHARS) {
        return message as SessionMessage & { seq: number };
      }
    }
  }
  return undefined;
}

export interface RunAutoCompactInput {
  store: AutoCompactStore;
  session: SessionRecord;
  agent: AgentSpec;
  tokenThreshold: number;
  summarize: (messages: SessionMessage[]) => Promise<string>;
  archive?: (messages: SessionMessage[]) => Promise<string | undefined>;
  prepareView?: (messages: SessionMessage[]) => Promise<SessionMessage[]>;
  /** Compact even when under threshold (overflow retry). */
  force?: boolean;
  /** Throw on open tool wave instead of no-op. */
  strict?: boolean;
  capSummary?: (text: string) => string;
  keepRecent?: number;
}

export async function runAutoCompact(input: RunAutoCompactInput): Promise<AutoCompactResult> {
  const folded = input.store.foldMessages(input.session.id);
  if (input.strict) {
    assertNoOpenToolWaveForCompact(folded);
  } else if (isToolWaveOpen(folded)) {
    return { didCompact: false, pruned: false, skippedReason: 'open_tool_wave' };
  }

  const viewed = input.prepareView ? await input.prepareView(folded) : folded;
  const est = estimateMessageTokens(viewed);
  if (!input.force && est < input.tokenThreshold) {
    return { didCompact: false, pruned: false };
  }

  const range = selectClosedPrefixRange(folded, input.keepRecent ?? COMPACT_KEEP_RECENT);
  if (range && range.older.length > 0) {
    const summary = await input.summarize(range.older);
    const capped = input.capSummary ? input.capSummary(summary) : summary;
    input.store.appendReplacement(input.session.id, {
      startSeq: range.startSeq,
      endSeq: range.endSeq,
      role: 'system',
      parts: [{ type: 'text', text: capped }],
      key: 'compact-summary'
    });
    const merged = input.session.summary ? `${input.session.summary}\n\n${capped}` : capped;
    input.store.updateSession(input.session.id, { summary: merged });
    if (input.archive) {
      await input.archive(range.older);
    }
    return {
      didCompact: true,
      pruned: false,
      replaced: { startSeq: range.startSeq, endSeq: range.endSeq },
      summary: capped
    };
  }

  const prunable = findPrunableToolResult(folded);
  if (!prunable) {
    return { didCompact: false, pruned: false, skippedReason: 'no_closed_range' };
  }
  const resultPart = prunable.parts.find((p) => p.type === 'tool_result');
  if (!resultPart || resultPart.type !== 'tool_result') {
    return { didCompact: false, pruned: false, skippedReason: 'no_closed_range' };
  }
  const prunedContent = `${resultPart.content.slice(0, PRUNE_KEEP_CHARS)}\n…[pruned ${resultPart.content.length - PRUNE_KEEP_CHARS} chars]`;
  input.store.appendReplacement(input.session.id, {
    startSeq: prunable.seq,
    endSeq: prunable.seq,
    role: prunable.role,
    parts: prunable.parts.map((p) =>
      p.type === 'tool_result' && p.toolCallId === resultPart.toolCallId
        ? { ...p, content: prunedContent }
        : p
    )
  });
  return {
    didCompact: false,
    pruned: true,
    replaced: { startSeq: prunable.seq, endSeq: prunable.seq }
  };
}
