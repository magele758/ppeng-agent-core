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
  | { action: 'retry-after-nudge'; nudge: string; discardAssistant?: boolean }
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

/** Upstream said it was calling tools (Chat Completions / Anthropic / Responses). */
export function finishAskedForTools(finishReason?: string, stopReason?: string): boolean {
  if (stopReason === 'tool_use') return true;
  const fr = (finishReason ?? '').toLowerCase();
  return fr === 'tool_calls' || fr === 'tool_use' || fr === 'function_call';
}

/**
 * Model dumped tool XML/DSML into reasoning or visible text instead of
 * structured `tool_calls`. Must not be treated as a clean `end`.
 */
export const TOOL_CALL_LEAK_RE =
  /tool_call|<invoke\s|<\/?minimax:|function_call|<\|?DSML\|?|<\/?tool_calls>/i;

export function assistantHasToolCallLeak(parts: MessagePart[]): boolean {
  return parts.some(
    (p) => (p.type === 'text' || p.type === 'reasoning') && TOOL_CALL_LEAK_RE.test(p.text ?? '')
  );
}

function emptyUnparsedToolNudge(): string {
  return '[recovery] Previous shot had no usable output (tool markup leaked into thinking/text, or tool_calls was empty). Discard it and continue the task. Use the function-calling API.';
}

function retryAsEmpty(
  state: TurnRecoveryState,
  nudge: string,
  exhaustedReason = 'empty_assistant'
): RecoveryAction {
  if (state.emptyRetries < MAX_EMPTY_RETRIES) {
    state.emptyRetries += 1;
    return { action: 'retry-after-nudge', nudge, discardAssistant: true };
  }
  return { action: 'abort', reason: exhaustedReason };
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

  if (filtered) {
    return retryAsEmpty(
      input.state,
      '[recovery] Previous reply was empty or filtered. Retry with a concise answer.',
      'content_filter'
    );
  }
  if (empty) {
    return retryAsEmpty(
      input.state,
      '[recovery] Previous reply was empty or filtered. Retry with a concise answer.'
    );
  }

  const missingStructuredCalls =
    calls.length === 0 &&
    (finishAskedForTools(input.finishReason, input.stopReason) || assistantHasToolCallLeak(parts));
  if (missingStructuredCalls) {
    return retryAsEmpty(input.state, emptyUnparsedToolNudge());
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
