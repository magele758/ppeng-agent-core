import { findSimilarToolName } from './find-similar-tool-name.js';

const SAMPLE_LIMIT = 20;
const HINT =
  'This tool may be disabled by configuration. If the failure looks like a configuration ' +
  'issue, inform the user instead of silently switching to another tool.';

export type PendingToolCall = { toolCallId: string; name: string };

export type SyntheticBehaviorResult = {
  toolCallId: string;
  name: string;
  ok: false;
  content: string;
};

export interface RecoverFromModelBehaviorInput {
  error: Error;
  pending: PendingToolCall[];
  currentToolNames: string[];
  appendResults?: (results: SyntheticBehaviorResult[]) => void | Promise<void>;
}

export interface RecoverFromModelBehaviorResult {
  recovered: boolean;
  results: SyntheticBehaviorResult[];
}

export function isToolAvailabilityError(error: Error): boolean {
  return /\btool\b.+\b(not found|not available|unavailable|disabled)\b/i.test(error.message);
}

/**
 * Structured synthetic tool_result payload for a pending call that never
 * received a real result because the model/runtime threw.
 */
export function buildSyntheticBehaviorResult(
  pending: PendingToolCall,
  error: Error,
  currentToolNames: string[]
): SyntheticBehaviorResult {
  const toolAvailability = isToolAvailabilityError(error);
  const payload: Record<string, unknown> = {
    error: toolAvailability
      ? `Tool '${pending.name}' is not available in this agent.`
      : `Model behavior error while handling tool call '${pending.name}'.`,
    error_raw: error.message,
    available_tools_sample: currentToolNames.slice(0, SAMPLE_LIMIT),
    did_you_mean: findSimilarToolName(pending.name, currentToolNames),
  };
  if (toolAvailability) payload.hint = HINT;

  return {
    toolCallId: pending.toolCallId,
    name: pending.name,
    ok: false,
    content: JSON.stringify(payload),
  };
}

/**
 * Pair pending tool_calls with synthetic failure results after a model-behavior error.
 * recovered=true only when appendResults ran successfully.
 */
export async function recoverFromModelBehavior(
  input: RecoverFromModelBehaviorInput
): Promise<RecoverFromModelBehaviorResult> {
  const { error, pending, currentToolNames, appendResults } = input;
  if (pending.length === 0) {
    return { recovered: false, results: [] };
  }

  const results = pending.map((p) => buildSyntheticBehaviorResult(p, error, currentToolNames));
  if (typeof appendResults !== 'function') {
    return { recovered: false, results };
  }

  try {
    await appendResults(results);
    return { recovered: true, results };
  } catch {
    return { recovered: false, results };
  }
}
