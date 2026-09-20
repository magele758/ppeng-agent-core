/**
 * Protocol pairing for unpaired tool_call parts in the fold view.
 * Interrupted / empty-name / persist-gap calls get a synthetic tool_result
 * so the next model turn is not rejected as "Tool result is missing".
 */

import { unmatchedToolCallIds } from '../session/surface-invariants.js';
import type { MessagePart, SessionMessage } from '../types.js';

export const UNPAIRED_TOOL_RESULT_CONTENT = JSON.stringify({
  error: 'tool_result_missing',
  error_raw: 'Tool call had no result (interrupted, empty name, or persist gap).',
});

export type UnmatchedToolCall = { toolCallId: string; name: string };

export interface FoldPairableStore {
  foldMessages?: () => SessionMessage[];
  appendMessage?: (role: SessionMessage['role'], parts: MessagePart[]) => unknown;
}

export interface PairUnmatchedToolCallsResult {
  messages: SessionMessage[];
  paired: number;
  parts: MessagePart[];
}

export function unmatchedToolCallsFromMessages(
  messages: Array<{ parts: MessagePart[] }>
): UnmatchedToolCall[] {
  const ids = unmatchedToolCallIds(messages);
  if (ids.length === 0) return [];

  const names = new Map<string, string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'tool_call') {
        names.set(part.toolCallId, part.name.trim() || 'unknown');
      }
    }
  }

  return ids.map((toolCallId) => ({
    toolCallId,
    name: names.get(toolCallId) ?? 'unknown',
  }));
}

export function syntheticUnpairedToolResultParts(calls: UnmatchedToolCall[]): MessagePart[] {
  return calls.map((call) => ({
    type: 'tool_result',
    toolCallId: call.toolCallId,
    name: call.name,
    ok: false,
    content: UNPAIRED_TOOL_RESULT_CONTENT,
  }));
}

export function pairUnmatchedToolCalls(messages: SessionMessage[]): PairUnmatchedToolCallsResult {
  const unmatched = unmatchedToolCallsFromMessages(messages);
  if (unmatched.length === 0) {
    return { messages, paired: 0, parts: [] };
  }

  const parts = syntheticUnpairedToolResultParts(unmatched);
  const synthetic: SessionMessage = {
    id: `paired-${unmatched.map((c) => c.toolCallId).join('-')}`,
    sessionId: messages[0]?.sessionId || 'paired-session',
    role: 'tool',
    parts,
    createdAt: new Date().toISOString(),
  };

  return {
    messages: [...messages, synthetic],
    paired: unmatched.length,
    parts,
  };
}

/** Append synthetic tool_result parts for any unmatched fold tool_calls. Returns how many were paired. */
export function ensureFoldToolCallsPaired(store?: FoldPairableStore | null): number {
  if (!store || typeof store.foldMessages !== 'function' || typeof store.appendMessage !== 'function') {
    return 0;
  }
  const { paired, parts } = pairUnmatchedToolCalls(store.foldMessages());
  if (paired === 0) return 0;
  store.appendMessage('tool', parts);
  return paired;
}
