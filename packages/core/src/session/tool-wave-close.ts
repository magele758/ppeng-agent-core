/**
 * Close an open tool wave by synthesizing paired tool_result parts (A7).
 * Prefer synthetic results over hide+replace so fold `unmatchedToolCallIds` is empty.
 */

import type { MessagePart, SessionMessage } from '../types.js';
import { unmatchedToolCallIds } from './surface-invariants.js';

export type ToolWaveCloseReason = 'interrupted' | 'skipped_due_to_steer';

export const TOOL_WAVE_INTERRUPTED_CONTENT = '[interrupted] tool wave closed before completion';
export const TOOL_WAVE_SKIPPED_STEER_CONTENT =
  '[skipped_due_to_steer] tool not started; steer claimed at tool-launch boundary';

export interface ToolWaveCloseStore {
  foldMessages(sessionId: string): SessionMessage[];
  appendMessage(
    sessionId: string,
    role: SessionMessage['role'],
    parts: SessionMessage['parts'],
    opts?: { key?: string; expectedWriterRunId?: string }
  ): SessionMessage;
}

export interface CloseOpenToolWaveResult {
  closedIds: string[];
  message?: SessionMessage;
}

export function closeOpenToolWave(
  store: ToolWaveCloseStore,
  sessionId: string,
  reason: ToolWaveCloseReason,
  opts?: { onlyToolCallIds?: string[]; expectedWriterRunId?: string }
): CloseOpenToolWaveResult {
  const folded = store.foldMessages(sessionId);
  let ids = unmatchedToolCallIds(folded);
  if (opts?.onlyToolCallIds) {
    const allow = new Set(opts.onlyToolCallIds);
    ids = ids.filter((id) => allow.has(id));
  }
  if (ids.length === 0) return { closedIds: [] };

  const names = new Map<string, string>();
  for (const message of folded) {
    for (const part of message.parts) {
      if (part.type === 'tool_call' && ids.includes(part.toolCallId)) {
        names.set(part.toolCallId, part.name);
      }
    }
  }

  const content =
    reason === 'interrupted' ? TOOL_WAVE_INTERRUPTED_CONTENT : TOOL_WAVE_SKIPPED_STEER_CONTENT;
  const parts: MessagePart[] = ids.map((id) => ({
    type: 'tool_result',
    toolCallId: id,
    name: names.get(id) ?? 'unknown',
    ok: false,
    content
  }));

  const message = store.appendMessage(sessionId, 'tool', parts, {
    expectedWriterRunId: opts?.expectedWriterRunId
  });
  return { closedIds: ids, message };
}
