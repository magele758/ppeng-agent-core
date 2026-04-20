/**
 * Transport bridge scaffolding for A2UI envelopes.
 *
 * The protocol layer (./protocol.ts) is intentionally transport-agnostic; the
 * default surface in this project is the SSE + tool_result path through the
 * runtime. The two helpers below shape an envelope sequence into the wire
 * formats used by other transports so that downstream code can adopt them
 * without re-implementing the encoding.
 *
 * Both helpers are pure functions over the envelope sequence — there is no
 * runtime hookup yet. When MCP (resource subscriptions / tool outputs) or A2A
 * (Agent-to-Agent message Parts) integrations are wired in, call into these
 * helpers from the integration module and the envelope shape is guaranteed
 * to match the spec.
 *
 * References:
 *  - A2UI over MCP:  https://a2ui.org/guides/a2ui_over_mcp/
 *  - A2A binding:    https://a2ui.org/specification/v0.9-a2ui/#a2a-agent2agent-binding
 */

import type { A2uiMessage } from './protocol.js';

export const A2UI_MIME_TYPE = 'application/json+a2ui';

export interface McpEmbeddedResource {
  type: 'resource';
  resource: {
    uri: string;
    mimeType: string;
    text: string;
  };
  annotations?: { audience?: Array<'user' | 'assistant'> };
}

/**
 * Wrap an envelope stream as an MCP `EmbeddedResource` suitable for inclusion
 * in a `CallToolResult.content` array.
 *
 * `name` becomes the resource URI suffix (e.g. `name="recipe-card"` →
 * `a2ui://recipe-card`). The audience annotation lets you hide the raw JSON
 * from the LLM while still rendering for the user (recommended default).
 */
export function toMcpEmbeddedResource(
  name: string,
  messages: A2uiMessage[],
  options: { audience?: Array<'user' | 'assistant'> } = {}
): McpEmbeddedResource {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '-') || 'surface';
  return {
    type: 'resource',
    resource: {
      uri: `a2ui://${safe}`,
      mimeType: A2UI_MIME_TYPE,
      text: JSON.stringify(messages)
    },
    ...(options.audience ? { annotations: { audience: options.audience } } : {})
  };
}

export interface A2aMessagePart {
  kind: 'data';
  data: A2uiMessage;
  metadata?: Record<string, unknown>;
}

/**
 * Map an envelope stream to A2A message Parts. Per spec §"A2A binding" each
 * envelope corresponds to a single Part payload; clients flatten the Parts
 * back into the same per-surface state as the SSE path.
 */
export function toA2aMessageParts(messages: A2uiMessage[]): A2aMessagePart[] {
  return messages.map((m) => ({ kind: 'data', data: m }));
}
