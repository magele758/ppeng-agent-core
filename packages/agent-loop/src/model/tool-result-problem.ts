import type { HttpProblemDetails, ToolResultPart } from '../types.js';

const PROBLEM_SEPARATOR = '\n\n---\nContent-Type: application/problem+json\n';

/** Default `type` URI for runtime-generated tool infrastructure failures. */
export const TOOL_INFRA_PROBLEM_TYPE = 'https://ppeng.dev/problem/agent-tool';

/**
 * When building LLM request bodies, append a compact RFC 9457 JSON object so
 * models and downstream parsers can recover structured fields from failures.
 */
export function formatToolResultForLlm(part: Pick<ToolResultPart, 'content' | 'ok' | 'problem'>): string {
  if (part.ok || !part.problem) return part.content;
  return part.content + PROBLEM_SEPARATOR + JSON.stringify(part.problem);
}

export function toolInfraProblem(
  toolName: string,
  toolCallId: string,
  code: string,
  detail: string,
  opts?: { title?: string; status?: number; type?: string }
): HttpProblemDetails {
  return {
    type: opts?.type ?? TOOL_INFRA_PROBLEM_TYPE,
    title: opts?.title ?? 'Tool execution failed',
    status: opts?.status ?? 422,
    detail,
    instance: `urn:ppeng:agent-core:tool:${encodeURIComponent(toolName)}:${toolCallId}`,
    code
  };
}
