/**
 * Control-flow stop reason from provider finish + parsed tool calls.
 *
 * DSML / DeepSeek-class models (and some gateways) emit `finish_reason=stop`
 * or `stop_sequence` while still producing structured tool_calls. That is a
 * wrong STOP: the loop must continue and execute the calls.
 *
 * `finishReason` on ModelTurnResult stays the raw provider value (observability).
 * This helper only decides `stopReason`. Truncation is not rewritten here —
 * `isTruncatedFinish` / turn-recovery own that path.
 */

export type ModelStopReason = 'end' | 'tool_use';

const TOOL_USE_FINISH = new Set([
  'tool_calls',
  'tool-calls',
  'tool_use',
  'tool-use',
  'function_call'
]);

export function isToolUseFinish(finishReason?: string | null): boolean {
  const r = (finishReason ?? '').trim().toLowerCase();
  return TOOL_USE_FINISH.has(r);
}

/** Parsed tool calls win over a false `stop` / `end_turn` / `stop_sequence`. */
export function resolveModelStopReason(
  finishReason: string | undefined | null,
  toolCallCount: number
): ModelStopReason {
  if (toolCallCount > 0) return 'tool_use';
  if (isToolUseFinish(finishReason)) return 'tool_use';
  return 'end';
}
