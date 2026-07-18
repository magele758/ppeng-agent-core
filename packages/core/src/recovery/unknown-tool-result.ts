/**
 * Structured synthetic tool_result for unknown / unavailable tool calls.
 * Keeps the protocol paired (tool_call → tool_result) while giving the model
 * recovery hints — mirrors ai-agent-node `buildSyntheticResult`.
 */

import { findSimilarToolName } from './find-similar-tool-name.js';

const SAMPLE_LIMIT = 20;
const HINT =
  'This tool may be disabled by configuration or not registered. ' +
  'If the failure looks like a configuration issue, inform the user instead of silently switching tools.';

export interface UnknownToolResultPayload {
  error: string;
  error_code: 'UNKNOWN_TOOL';
  available_tools_sample: string[];
  did_you_mean: string | null;
  hint: string;
}

export function buildUnknownToolResultContent(
  toolName: string,
  availableToolNames: string[]
): string {
  const payload: UnknownToolResultPayload = {
    error: `Tool '${toolName}' is not available in this agent.`,
    error_code: 'UNKNOWN_TOOL',
    available_tools_sample: availableToolNames.slice(0, SAMPLE_LIMIT),
    did_you_mean: findSimilarToolName(toolName, availableToolNames),
    hint: HINT
  };
  return JSON.stringify(payload);
}
