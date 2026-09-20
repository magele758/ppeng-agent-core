/**
 * Kernel wrong_stop_signal correction, extracted as a pure function.
 *
 * DSML / gateway models emit `finish_reason=stop` while still producing
 * tool_calls. Parsed calls win; `finishReason` stays raw for observability.
 */

import { resolveModelStopReason } from './stop-reason.js';

export function correctWrongStopSignal(input: {
  stopReason: string;
  finishReason?: string;
  toolCallCount: number;
}): { stopReason: string; corrected: boolean } {
  const resolved = resolveModelStopReason(input.finishReason, input.toolCallCount);
  if (resolved === 'tool_use' && input.stopReason !== 'tool_use' && input.toolCallCount > 0) {
    return { stopReason: 'tool_use', corrected: true };
  }
  return { stopReason: input.stopReason, corrected: false };
}
