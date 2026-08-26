/**
 * Per-shot protocol recovery: decide continue / retry / end / abort from
 * stopReason + finishReason. Truncation is a control-flow event, not a clean end.
 *
 * Retry budgets are code constants (Lab settings can override later). No new
 * RAW_AGENT_* env vars.
 */

import { isTruncatedFinish } from '../model/usage.js';
import type { MessagePart } from '../types.js';

export const MAX_TRUNCATION_CONTINUES = 2;
export const MAX_PROTOCOL_RETRIES = 2;
export const MAX_EMPTY_RETRIES = 2;
/** LoopGuard critical hits before hard terminate (second strike). */
export const MAX_CRITICAL_HITS = 2;

export type RecoveryAction =
  | { action: 'continue' }
  | { action: 'retry-same-input' }
  | { action: 'retry-after-nudge'; nudge: string }
  | { action: 'end' }
  | { action: 'abort'; reason: string };

export interface TurnRecoveryState {
  truncatedContinues: number;
  protocolRetries: number;
  emptyRetries: number;
  criticalHits: number;
}

export function createTurnRecoveryState(): TurnRecoveryState {
  return { truncatedContinues: 0, protocolRetries: 0, emptyRetries: 0, criticalHits: 0 };
}

export function toolCallParts(parts: MessagePart[]): Extract<MessagePart, { type: 'tool_call' }>[] {
  return parts.filter((p): p is Extract<MessagePart, { type: 'tool_call' }> => p.type === 'tool_call');
}

export function isIncompleteToolCall(part: Extract<MessagePart, { type: 'tool_call' }>): boolean {
  if (!part.name || !part.toolCallId) return true;
  const keys = part.input && typeof part.input === 'object' ? Object.keys(part.input) : [];
  return keys.length === 0 && part.name.length === 0;
}

export function hasIncompleteToolCalls(parts: MessagePart[]): boolean {
  const calls = toolCallParts(parts);
  return calls.some((c) => !c.toolCallId || !c.name);
}

export function hasAssistantText(parts: MessagePart[]): boolean {
  return parts.some((p) => (p.type === 'text' || p.type === 'reasoning') && p.text.trim().length > 0);
}

export interface DecideTurnRecoveryInput {
  stopReason: string;
  finishReason?: string;
  truncated?: boolean;
  assistantParts: MessagePart[];
  state: TurnRecoveryState;
  userAborted?: boolean;
  contentFilter?: boolean;
}

export function decideTurnRecovery(input: DecideTurnRecoveryInput): RecoveryAction {
  if (input.userAborted) {
    return { action: 'abort', reason: 'user_abort' };
  }

  const parts = input.assistantParts ?? [];
  const truncated =
    input.truncated === true || isTruncatedFinish(input.finishReason);
  const calls = toolCallParts(parts);
  const empty = parts.length === 0 || (!hasAssistantText(parts) && calls.length === 0);
  const filtered =
    input.contentFilter === true ||
    (input.finishReason ?? '').toLowerCase().includes('content_filter');

  if (filtered || empty) {
    if (input.state.emptyRetries < MAX_EMPTY_RETRIES) {
      input.state.emptyRetries += 1;
      return {
        action: 'retry-after-nudge',
        nudge: '[recovery] Previous reply was empty or filtered. Retry with a concise answer.'
      };
    }
    return { action: 'abort', reason: filtered ? 'content_filter' : 'empty_assistant' };
  }

  if (input.stopReason === 'tool_use' && calls.length === 0) {
    if (input.state.protocolRetries < MAX_PROTOCOL_RETRIES) {
      input.state.protocolRetries += 1;
      return {
        action: 'retry-after-nudge',
        nudge: '[recovery] Protocol error: stopReason=tool_use but tool_calls was empty. Retry the same turn.'
      };
    }
    return { action: 'abort', reason: 'empty_tool_calls' };
  }

  if (truncated) {
    if (hasIncompleteToolCalls(parts) || (input.stopReason === 'tool_use' && hasIncompleteToolCalls(parts))) {
      if (input.state.protocolRetries < MAX_PROTOCOL_RETRIES) {
        input.state.protocolRetries += 1;
        return { action: 'retry-same-input' };
      }
      return { action: 'abort', reason: 'truncated_tool_call' };
    }
    if (input.state.truncatedContinues < MAX_TRUNCATION_CONTINUES) {
      input.state.truncatedContinues += 1;
      return {
        action: 'retry-after-nudge',
        nudge: '[recovery] Output was truncated. Continue the reply from the last sentence; do not restart.'
      };
    }
    return { action: 'end' };
  }

  if (input.stopReason === 'tool_use') {
    return { action: 'continue' };
  }
  return { action: 'end' };
}

export function noteCriticalHit(state: TurnRecoveryState): RecoveryAction | { action: 'continue' } {
  state.criticalHits += 1;
  if (state.criticalHits >= MAX_CRITICAL_HITS) {
    return { action: 'abort', reason: 'loop_guard_critical' };
  }
  return { action: 'continue' };
}
