import type {
  MessagePart,
  ModelAdapter,
  ModelStreamChunk,
  ModelTurnInput,
  ModelTurnResult,
  SessionMessage,
  SummaryInput,
  ToolContract
} from '../types.js';
import { parseModelToolArguments } from './parse-tool-arguments.js';
import { llmPromptDebugEnabled, maybeLogLlmRequest } from './llm-prompt-debug.js';
import { formatToolResultForLlm } from './tool-result-problem.js';
import { createLogger } from '../logger.js';

const responsesStreamLog = createLogger('openai-responses-stream');

/**
 * Many OpenAI-compatible reasoning models expose chain-of-thought on alternate keys
 * (`reasoning_content`, `reasoning`, `thinking`) on both stream deltas and non-stream
 * `message` objects. Centralize so non-stream turns persist the same ReasoningPart shape
 * as streaming turns.
 */
function coalesceOpenAiReasoningText(source: Record<string, unknown> | null | undefined): string {
  if (!source) return '';
  const rc = source.reasoning_content;
  const r = source.reasoning;
  const t = source.thinking;
  const rs = source.reasoning_summary;
  const thought = source.thought;
  if (typeof rc === 'string' && rc) return rc;
  if (typeof r === 'string' && r) return r;
  if (typeof t === 'string' && t) return t;
  if (typeof rs === 'string' && rs) return rs;
  if (typeof thought === 'string' && thought) return thought;
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    const o = r as Record<string, unknown>;
    const sum = o.summary;
    if (typeof sum === 'string' && sum.trim()) return sum.trim();
    if (Array.isArray(sum)) {
      const joined = sum
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const it = item as Record<string, unknown>;
            if (typeof it.text === 'string') return it.text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
      if (joined.trim()) return joined.trim();
    }
    const txt = o.text;
    if (typeof txt === 'string' && txt) return txt;
  }
  return '';
}

function textFromParts(parts: MessagePart[]): string {
  return parts
    .filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

/** OpenAI `assistant.content`: concatenate persisted reasoning + visible text (tool_call parts excluded). */
function assistantOpenAiTextFromParts(parts: MessagePart[]): string {
  const chunks: string[] = [];
  for (const part of parts) {
    if (part.type === 'reasoning') chunks.push(part.text ?? '');
    if (part.type === 'text') chunks.push(part.text ?? '');
  }
  return chunks.join('\n\n').trim();
}

/** Text + image placeholders for skill matching and summarization. */
export function textSummaryFromParts(parts: MessagePart[]): string {
  const lines: string[] = [];
  for (const part of parts) {
    if (part.type === 'reasoning') lines.push(part.text);
    else if (part.type === 'text') lines.push(part.text);
    else if (part.type === 'image') {
      lines.push(`[image ${part.assetId}${part.retentionTier ? ` tier=${part.retentionTier}` : ''}]`);
    } else if (part.type === 'tool_call') lines.push(`[tool ${part.name}]`);
    else if (part.type === 'tool_result') lines.push(`[result ${part.name}] ${part.content}`);
  }
  return lines.join('\n').trim();
}

function lastUserText(messages: SessionMessage[]): string {
  const reversed = [...messages].reverse();
  const message = reversed.find((candidate) => candidate.role === 'user');
  return message ? textFromParts(message.parts) : '';
}

function lastUserSummaryText(messages: SessionMessage[]): string {
  const reversed = [...messages].reverse();
  const message = reversed.find((candidate) => candidate.role === 'user');
  return message ? textSummaryFromParts(message.parts) : '';
}

let toolCallSeq = 0;
function createToolCallId(): string {
  toolCallSeq += 1;
  return `call_${toolCallSeq}_${Date.now()}`;
}

function isPlainObject(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-clone plain objects with sorted keys at every nesting level; arrays preserve order
 * but elements are canonicalized. Used so JSON.stringify yields stable bytes for nested args.
 */
function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (!isPlainObject(value)) return value;
  const obj = value as Record<string, unknown>;
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = canonicalize(obj[key]);
      return acc;
    }, {});
}

/** Returns a canonical JSON string with object keys sorted at every depth for stable serialization. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Builds the tool definitions array for the model, sorted by name for stable order.
 * Consistent ordering ensures the tools payload doesn't change between turns when
 * the same tool set is in use, enabling prompt-cache reuse.
 */
function toolDefinitions(tools: ToolContract[]): Array<Record<string, unknown>> {
  return [...tools].sort((a, b) => a.name.localeCompare(b.name)).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }));
}

/** Chat Completions vs OpenAI Responses (`/v1/responses`) — reasoning + tool interleaving per OpenAI guidance. */
type OpenAiHttpKind = 'chat_completions' | 'responses';

function normalizeOpenAiHttpKind(raw: string | undefined): OpenAiHttpKind {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'responses' || v === 'response') return 'responses';
  return 'chat_completions';
}

function mapToolDefinitionsToResponsesFormat(
  tools: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return tools.map((t) => {
    const fn = t.function as Record<string, unknown> | undefined;
    if (t.type === 'function' && fn && typeof fn === 'object') {
      return {
        type: 'function',
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters,
        strict: false
      };
    }
    return t;
  });
}

function openAiCompatEndpoint(baseUrl: string, kind: OpenAiHttpKind): string {
  const base = baseUrl.replace(/\/$/, '');
  return kind === 'responses' ? `${base}/responses` : `${base}/chat/completions`;
}

function extractReasoningSummaryFromResponsesItem(it: Record<string, unknown>): string {
  const summary = it.summary;
  if (typeof summary === 'string' && summary.trim()) return summary.trim();
  if (!Array.isArray(summary)) return '';
  const parts: string[] = [];
  for (const entry of summary) {
    if (typeof entry === 'string') parts.push(entry);
    else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const e = entry as Record<string, unknown>;
      if (typeof e.text === 'string') parts.push(e.text);
    }
  }
  return parts.join('\n').trim();
}

function extractAssistantTextFromResponsesMessage(it: Record<string, unknown>): string {
  const content = it.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const chunks: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'output_text' && typeof b.text === 'string') chunks.push(b.text);
  }
  return chunks.join('').trim();
}

function parseResponsesOutputToTurnResult(body: Record<string, unknown>): ModelTurnResult {
  const assistantParts: MessagePart[] = [];
  const output = body.output;
  let sawTool = false;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const it = item as Record<string, unknown>;
      if (it.type === 'reasoning') {
        const r = extractReasoningSummaryFromResponsesItem(it);
        if (r) assistantParts.push({ type: 'reasoning', text: r });
      } else if (it.type === 'message' && it.role === 'assistant') {
        const text = extractAssistantTextFromResponsesMessage(it);
        if (text) assistantParts.push({ type: 'text', text });
      } else if (it.type === 'function_call') {
        sawTool = true;
        const callId = String(it.call_id ?? it.id ?? createToolCallId());
        const name = String(it.name ?? 'unknown_tool');
        const rawArgs = it.arguments;
        const argsStr = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {});
        assistantParts.push({
          type: 'tool_call',
          toolCallId: callId,
          name,
          input: parseModelToolArguments(argsStr)
        });
      }
    }
  }
  if (assistantParts.length === 0 && typeof body.output_text === 'string' && body.output_text.trim()) {
    assistantParts.push({ type: 'text', text: body.output_text.trim() });
  }
  if (assistantParts.length === 0) {
    assistantParts.push({ type: 'text', text: '' });
  }
  return {
    stopReason: sawTool ? 'tool_use' : 'end',
    assistantParts
  };
}

type ResponsesStreamAgg = {
  textAcc: string;
  reasoningAcc: string;
  /** function_call item `id` → partial call */
  funcByItemId: Map<string, { callId: string; name: string; args: string; announced: boolean }>;
  /** Full `response` object from `response.completed` / `response.done` when it includes `output`. */
  completedResponse: Record<string, unknown> | null;
};

function deltaTextFromUnknown(delta: unknown): string {
  if (typeof delta === 'string') return delta;
  if (delta && typeof delta === 'object' && !Array.isArray(delta)) {
    const d = delta as Record<string, unknown>;
    if (typeof d.text === 'string') return d.text;
    if (typeof d.output_text === 'string') return d.output_text;
  }
  return '';
}

function handleResponsesStreamEvent(
  parsed: Record<string, unknown>,
  agg: ResponsesStreamAgg,
  onChunk: (chunk: ModelStreamChunk) => void,
  env: NodeJS.ProcessEnv
): void {
  const typ = typeof parsed.type === 'string' ? parsed.type : '';

  const logUnknown = () => {
    if (typ.startsWith('response.') && llmPromptDebugEnabled(env)) {
      responsesStreamLog.debug('unhandled responses stream event type', { type: typ });
    }
  };

  if (typ === 'response.output_text.delta') {
    const piece = deltaTextFromUnknown(parsed.delta);
    if (piece) {
      agg.textAcc += piece;
      onChunk({ type: 'text_delta', text: piece });
    }
    return;
  }
  if (typ === 'response.output_text.done') {
    const text =
      typeof parsed.text === 'string'
        ? parsed.text
        : deltaTextFromUnknown(parsed.delta) ||
          (typeof parsed.output_text === 'string' ? parsed.output_text : '');
    if (text && !agg.textAcc) {
      agg.textAcc = text;
      onChunk({ type: 'text_delta', text });
    }
    return;
  }
  /**
   * Some gateways emit `response.output_item.delta` instead of (or in addition to)
   * `response.output_text.delta` / `response.function_call_arguments.delta`.
   */
  if (typ === 'response.output_item.delta') {
    const itemId = String(
      parsed.item_id ?? (parsed.item as Record<string, unknown> | undefined)?.id ?? ''
    );
    const deltaRaw = parsed.delta;
    if (typeof deltaRaw === 'string' && deltaRaw) {
      const slot = itemId ? agg.funcByItemId.get(itemId) : undefined;
      if (slot) {
        slot.args += deltaRaw;
        onChunk({ type: 'tool_call_delta', toolCallId: slot.callId, argumentsFragment: deltaRaw });
        return;
      }
      agg.textAcc += deltaRaw;
      onChunk({ type: 'text_delta', text: deltaRaw });
      return;
    }
    if (deltaRaw && typeof deltaRaw === 'object' && !Array.isArray(deltaRaw)) {
      const d = deltaRaw as Record<string, unknown>;
      const textPiece = deltaTextFromUnknown(d);
      if (textPiece) {
        agg.textAcc += textPiece;
        onChunk({ type: 'text_delta', text: textPiece });
        return;
      }
      const reasoningPiece = coalesceOpenAiReasoningText(d).trim();
      if (reasoningPiece) {
        agg.reasoningAcc += reasoningPiece;
        onChunk({ type: 'reasoning_delta', text: reasoningPiece });
        return;
      }
      const argFrag = typeof d.arguments === 'string' ? d.arguments : '';
      if (itemId && argFrag) {
        let slot = agg.funcByItemId.get(itemId);
        if (!slot) {
          const callId = String(d.call_id ?? itemId);
          slot = {
            callId,
            name: typeof d.name === 'string' ? d.name : '',
            args: '',
            announced: false
          };
          agg.funcByItemId.set(itemId, slot);
          if (callId) agg.funcByItemId.set(callId, slot);
        }
        if (!slot.announced && slot.name) {
          onChunk({ type: 'tool_call_start', toolCallId: slot.callId, name: slot.name });
          slot.announced = true;
        }
        slot.args += argFrag;
        onChunk({ type: 'tool_call_delta', toolCallId: slot.callId, argumentsFragment: argFrag });
        return;
      }
    }
    logUnknown();
    return;
  }
  if (
    typ === 'response.reasoning_summary_text.delta' ||
    typ === 'response.reasoning_summary_part.delta' ||
    typ === 'response.reasoning_text.delta'
  ) {
    const piece = deltaTextFromUnknown(parsed.delta);
    if (piece) {
      agg.reasoningAcc += piece;
      onChunk({ type: 'reasoning_delta', text: piece });
    }
    return;
  }
  if (typ === 'response.output_item.added') {
    const item = parsed.item as Record<string, unknown> | undefined;
    if (item && item.type === 'function_call') {
      const itemId = String(item.id ?? '');
      const callId = String(item.call_id ?? item.id ?? createToolCallId());
      const name = String(item.name ?? 'unknown_tool');
      const initialArgs = typeof item.arguments === 'string' ? item.arguments : '';
      const slot = { callId, name, args: initialArgs, announced: false };
      if (itemId) agg.funcByItemId.set(itemId, slot);
      agg.funcByItemId.set(callId, slot);
      if (name) {
        onChunk({ type: 'tool_call_start', toolCallId: callId, name });
        slot.announced = true;
      }
    }
    return;
  }
  if (typ === 'response.output_item.done') {
    const item = parsed.item as Record<string, unknown> | undefined;
    if (item && item.type === 'function_call') {
      const itemId = String(item.id ?? '');
      const callId = String(item.call_id ?? item.id ?? '');
      const name = String(item.name ?? '');
      const rawArgs = item.arguments;
      const argsStr = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {});
      let slot = itemId ? agg.funcByItemId.get(itemId) : undefined;
      if (!slot && callId) slot = agg.funcByItemId.get(callId);
      if (!slot) {
        slot = { callId: callId || createToolCallId(), name, args: argsStr, announced: false };
        if (itemId) agg.funcByItemId.set(itemId, slot);
        if (callId) agg.funcByItemId.set(callId, slot);
      }
      slot.args = argsStr;
      slot.name = name || slot.name;
      if (!slot.announced && slot.name) {
        onChunk({ type: 'tool_call_start', toolCallId: slot.callId, name: slot.name });
        slot.announced = true;
      }
    }
    return;
  }
  if (typ === 'response.function_call_arguments.delta') {
    const itemId = String(parsed.item_id ?? '');
    const d = parsed.delta;
    const frag = typeof d === 'string' ? d : '';
    let slot = itemId ? agg.funcByItemId.get(itemId) : undefined;
    if (!slot && itemId && frag) {
      slot = { callId: itemId, name: '', args: '', announced: false };
      agg.funcByItemId.set(itemId, slot);
    }
    if (slot && frag) {
      if (!slot.announced && slot.name) {
        onChunk({ type: 'tool_call_start', toolCallId: slot.callId, name: slot.name });
        slot.announced = true;
      }
      slot.args += frag;
      onChunk({ type: 'tool_call_delta', toolCallId: slot.callId, argumentsFragment: frag });
    }
    return;
  }
  if (typ === 'response.function_call_arguments.done') {
    const item = parsed.item as Record<string, unknown> | undefined;
    if (item && item.type === 'function_call') {
      const itemId = String(item.id ?? '');
      const callId = String(item.call_id ?? item.id ?? '');
      const name = String(item.name ?? '');
      const rawArgs = item.arguments;
      const argsStr = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {});
      let slot = itemId ? agg.funcByItemId.get(itemId) : undefined;
      if (!slot && callId) slot = agg.funcByItemId.get(callId);
      if (!slot) {
        slot = { callId: callId || createToolCallId(), name, args: argsStr, announced: false };
        if (itemId) agg.funcByItemId.set(itemId, slot);
        if (callId) agg.funcByItemId.set(callId, slot);
      }
      slot.args = argsStr;
      slot.name = name || slot.name;
      if (!slot.announced && slot.name) {
        onChunk({ type: 'tool_call_start', toolCallId: slot.callId, name: slot.name });
        slot.announced = true;
      }
    } else if (typeof parsed.call_id === 'string') {
      const callId = String(parsed.call_id);
      const name = String(parsed.name ?? '');
      const rawArgs = parsed.arguments;
      const argsStr = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {});
      const itemId = String(parsed.item_id ?? '');
      let slot = itemId ? agg.funcByItemId.get(itemId) : agg.funcByItemId.get(callId);
      if (!slot) {
        slot = { callId, name, args: argsStr, announced: false };
        if (itemId) agg.funcByItemId.set(itemId, slot);
        agg.funcByItemId.set(callId, slot);
      }
      slot.args = argsStr;
      slot.name = name || slot.name;
      if (!slot.announced && slot.name) {
        onChunk({ type: 'tool_call_start', toolCallId: slot.callId, name: slot.name });
        slot.announced = true;
      }
    }
    return;
  }
  if (typ === 'response.completed' || typ === 'response.done') {
    const resp = parsed.response as Record<string, unknown> | undefined;
    if (resp && Array.isArray(resp.output)) {
      agg.completedResponse = resp;
    }
    return;
  }
  if (typ === 'error') {
    const msg = parsed.message ?? parsed.error;
    throw new Error(
      typeof msg === 'string' ? msg : `Responses stream error: ${JSON.stringify(msg).slice(0, 300)}`
    );
  }
  if (typ.startsWith('response.')) {
    logUnknown();
  }
}

async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  init?: { signal?: AbortSignal }
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body),
    signal: init?.signal
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Remote adapter request failed with ${response.status}: ${text.slice(0, 300)}`);
  }

  return JSON.parse(text) as T;
}

async function buildOpenAiMessages(
  systemPrompt: string,
  messages: SessionMessage[],
  resolveImage?: (assetId: string, signal?: AbortSignal) => Promise<string | undefined>,
  signal?: AbortSignal
): Promise<Array<Record<string, unknown>>> {
  const output: Array<Record<string, unknown>> = [
    {
      role: 'system',
      content: systemPrompt
    }
  ];

  for (const message of messages) {
    if (message.role === 'tool') {
      for (const part of message.parts) {
        if (part.type !== 'tool_result') continue;
        output.push({
          role: 'tool',
          tool_call_id: part.toolCallId,
          content: formatToolResultForLlm(part)
        });
      }
      continue;
    }

    const toolCalls = message.parts
      .filter((part): part is Extract<MessagePart, { type: 'tool_call' }> => part.type === 'tool_call')
      .map((part) => ({
        id: part.toolCallId,
        type: 'function',
        function: {
          name: part.name,
          arguments: canonicalJson(part.input)
        }
      }));

    if (message.role === 'assistant') {
      const text = assistantOpenAiTextFromParts(message.parts);
      output.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
      });
      continue;
    }

    if (message.role === 'system') {
      output.push({
        role: 'system',
        content: textFromParts(message.parts)
      });
      continue;
    }

    if (message.role === 'user') {
      const contentBlocks: Array<Record<string, unknown>> = [];
      let textAcc = '';
      for (const part of message.parts) {
        if (part.type === 'text') {
          textAcc += (textAcc ? '\n' : '') + part.text;
        } else if (part.type === 'image') {
          if (textAcc.trim()) {
            contentBlocks.push({ type: 'text', text: textAcc.trim() });
            textAcc = '';
          }
          if (resolveImage) {
            const url = await resolveImage(part.assetId, signal);
            if (url) {
              contentBlocks.push({
                type: 'image_url',
                image_url: { url }
              });
            } else {
              textAcc += `[missing image ${part.assetId}]`;
            }
          } else {
            textAcc += `[image ${part.assetId}]`;
          }
        }
      }
      if (textAcc.trim()) {
        contentBlocks.push({ type: 'text', text: textAcc.trim() });
      }
      let content: string | Array<Record<string, unknown>>;
      if (contentBlocks.length === 0) {
        content = '';
      } else if (contentBlocks.length === 1 && contentBlocks[0]!.type === 'text') {
        content = String((contentBlocks[0] as { text: string }).text);
      } else {
        content = contentBlocks;
      }
      output.push({
        role: 'user',
        content
      });
      continue;
    }

    output.push({
      role: message.role,
      content: textFromParts(message.parts)
    });
  }

  return output;
}

/**
 * Maps persisted session messages to OpenAI `/v1/responses` `input` items.
 * Do not pass Chat Completions `messages` here — Responses uses `function_call` /
 * `function_call_output` items and `message` content blocks (`input_text` / `input_image`),
 * not `role: tool` or `tool_calls` on assistant messages.
 *
 * Persisted assistant `reasoning` parts are **not** replayed as `type: 'reasoning'` input items
 * (many gateways reject that shape); they are folded into assistant `message` items as
 * `output_text` with a short prefix so multi-turn transcripts stay valid.
 */
async function buildResponsesApiInput(
  messages: SessionMessage[],
  resolveImage?: (assetId: string, signal?: AbortSignal) => Promise<string | undefined>,
  signal?: AbortSignal
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === 'tool') {
      for (const part of message.parts) {
        if (part.type !== 'tool_result') continue;
        out.push({
          type: 'function_call_output',
          call_id: part.toolCallId,
          output: formatToolResultForLlm(part)
        });
      }
      continue;
    }

    if (message.role === 'system') {
      const text = textFromParts(message.parts).trim();
      if (text) {
        out.push({
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text }]
        });
      }
      continue;
    }

    if (message.role === 'user') {
      const content: Array<Record<string, unknown>> = [];
      let textAcc = '';
      for (const part of message.parts) {
        if (part.type === 'text') {
          textAcc += (textAcc ? '\n' : '') + part.text;
        } else if (part.type === 'image') {
          if (textAcc.trim()) {
            content.push({ type: 'input_text', text: textAcc.trim() });
            textAcc = '';
          }
          if (resolveImage) {
            const url = await resolveImage(part.assetId, signal);
            if (url) {
              content.push({
                type: 'input_image',
                image_url: url,
                detail: 'auto' as const
              });
            } else {
              textAcc += `[missing image ${part.assetId}]`;
            }
          } else {
            textAcc += `[image ${part.assetId}]`;
          }
        }
      }
      if (textAcc.trim()) {
        content.push({ type: 'input_text', text: textAcc.trim() });
      }
      if (content.length > 0) {
        out.push({
          type: 'message',
          role: 'user',
          content
        });
      }
      continue;
    }

    if (message.role === 'assistant') {
      /**
       * `/v1/responses` `input` is not documented to accept replaying model `reasoning` items
       * (`{ type: 'reasoning', summary }` is output-shaped). Fold persisted reasoning into
       * assistant `message` `output_text` so strict gateways avoid 400 on multi-turn transcripts.
       */
      let reasoningBuf = '';
      const takeReasoningPrefix = (): string => {
        const r = reasoningBuf.trim();
        reasoningBuf = '';
        if (!r) return '';
        return `[Earlier reasoning]\n${r}\n\n`;
      };
      for (const part of message.parts) {
        if (part.type === 'reasoning') {
          const r = (part.text ?? '').trim();
          if (r) reasoningBuf += (reasoningBuf ? '\n\n' : '') + r;
        } else if (part.type === 'text') {
          const t = (part.text ?? '').trim();
          const combined = `${takeReasoningPrefix()}${t}`.trim();
          if (combined) {
            out.push({
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: combined }]
            });
          }
        } else if (part.type === 'tool_call') {
          const prefix = takeReasoningPrefix().trim();
          if (prefix) {
            out.push({
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: prefix }]
            });
          }
          out.push({
            type: 'function_call',
            call_id: part.toolCallId,
            name: part.name,
            arguments: canonicalJson(part.input),
            status: 'completed' as const
          });
        }
      }
      const tail = takeReasoningPrefix().trim();
      if (tail) {
        out.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: tail }]
        });
      }
      continue;
    }

    const fallback = textFromParts(message.parts).trim();
    if (fallback) {
      out.push({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: fallback }]
      });
    }
  }

  return out;
}

function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } | undefined {
  const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/is);
  if (!m?.[1] || !m[2]) return undefined;
  return { mediaType: m[1], base64: m[2] };
}

async function buildAnthropicMessages(
  messages: SessionMessage[],
  resolveImage?: (assetId: string, signal?: AbortSignal) => Promise<string | undefined>,
  signal?: AbortSignal
): Promise<{
  messages: Array<Record<string, unknown>>;
  refusalReminder: string | null;
}> {
  const output: Array<Record<string, unknown>> = [];
  let refusalReminder: string | null = null;

  for (const message of messages) {
    if (message.role === 'system') {
      // Extract refusal preservation reminder to fold into Anthropic system payload
      if (message.id === '__refusal_preservation__') {
        refusalReminder = textFromParts(message.parts);
      }
      continue;
    }

    if (message.role === 'tool') {
      for (const part of message.parts) {
        if (part.type !== 'tool_result') continue;
        output.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: part.toolCallId,
              content: formatToolResultForLlm(part),
              is_error: !part.ok
            }
          ]
        });
      }
      continue;
    }

    const content: Array<Record<string, unknown>> = [];
    for (const part of message.parts) {
      if (part.type === 'reasoning') {
        content.push({ type: 'text', text: part.text });
      }
      if (part.type === 'text') {
        content.push({ type: 'text', text: part.text });
      }
      if (part.type === 'image' && resolveImage) {
        const dataUrl = await resolveImage(part.assetId, signal);
        const parsed = dataUrl ? parseDataUrl(dataUrl) : undefined;
        if (parsed) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: parsed.mediaType,
              data: parsed.base64
            }
          });
        } else {
          content.push({ type: 'text', text: `[missing image ${part.assetId}]` });
        }
      } else if (part.type === 'image' && !resolveImage) {
        content.push({ type: 'text', text: `[image ${part.assetId}]` });
      }
      if (part.type === 'tool_call') {
        content.push({
          type: 'tool_use',
          id: part.toolCallId,
          name: part.name,
          input: part.input
        });
      }
    }

    output.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content
    });
  }

  return { messages: output, refusalReminder };
}

export class HeuristicModelAdapter implements ModelAdapter {
  readonly name = 'heuristic';

  async runTurn(input: ModelTurnInput): Promise<ModelTurnResult> {
    const lastSummary = lastUserSummaryText(input.messages).toLowerCase();
    const lastText = lastUserText(input.messages).toLowerCase();

    if (!lastSummary) {
      return {
        stopReason: 'end',
        assistantParts: [{ type: 'text', text: 'No input.' }]
      };
    }

    if (lastText.includes('hello') || lastText.includes('你好') || lastText.includes('hi')) {
      return {
        stopReason: 'end',
        assistantParts: [
          {
            type: 'text',
            text: '你好，我现在已经是一个基于工具循环的裸 agent runtime 了。你可以直接聊天，也可以让我读文件、跑命令、建任务。'
          }
        ]
      };
    }

    if (lastSummary.includes('[image') && !lastText) {
      return {
        stopReason: 'end',
        assistantParts: [
          {
            type: 'text',
            text: '收到图片。当前为 heuristic 模式，请配置 RAW_AGENT_MODEL_PROVIDER=openai-compatible 与 VL 环境变量以进行视觉理解；或使用 vision_analyze 工具（配置 VL 后）。'
          }
        ]
      };
    }

    if (lastText.includes('list files') || lastText.includes('列出文件')) {
      return {
        stopReason: 'tool_use',
        assistantParts: [
          {
            type: 'tool_call',
            toolCallId: 'heuristic_read_dir',
            name: 'read_file',
            input: {}
          }
        ]
      };
    }

    return {
      stopReason: 'end',
      assistantParts: [
        {
          type: 'text',
          text: `Heuristic adapter reply: ${lastUserSummaryText(input.messages)}`
        }
      ]
    };
  }

  async summarizeMessages(input: SummaryInput): Promise<string> {
    const recent = input.messages
      .slice(-8)
      .map((message) => `${message.role}: ${textSummaryFromParts(message.parts)}`);
    return `Summary for ${input.reason}: ${recent.join(' | ')}`.slice(0, 4000);
  }
}

export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly name = 'openai-compatible';

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      model: string;
      useJsonMode: boolean;
      /** When `responses`, POST `/v1/responses` with `input` (OpenAI reasoning / interleaved tools). */
      httpKind?: OpenAiHttpKind;
    }
  ) {}

  private get httpKind(): OpenAiHttpKind {
    return this.options.httpKind ?? 'chat_completions';
  }

  async runTurn(input: ModelTurnInput): Promise<ModelTurnResult> {
    type ChatResponse = {
      choices?: Array<{
        finish_reason?: string;
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
          reasoning?: string | null;
          thinking?: string | null;
          tool_calls?: Array<{
            id: string;
            function?: {
              name?: string;
              arguments?: string;
            };
          }>;
        };
      }>;
    };

    const tools = toolDefinitions(input.tools);
    const endpoint = openAiCompatEndpoint(this.options.baseUrl, this.httpKind);

    if (this.httpKind === 'responses') {
      const responsesInput = await buildResponsesApiInput(
        input.messages,
        input.resolveImageDataUrl,
        input.signal
      );
      const payload = {
        model: this.options.model,
        instructions: input.systemPrompt,
        input: responsesInput,
        tools: mapToolDefinitionsToResponsesFormat(tools),
        tool_choice: 'auto' as const
      };
      await maybeLogLlmRequest(process.env, input.debugLlmContext, this.name, {
        kind: 'responses',
        ...payload
      });
      const result = await postJson<Record<string, unknown>>(
        endpoint,
        payload,
        {
          authorization: `Bearer ${this.options.apiKey}`
        },
        { signal: input.signal }
      );
      return parseResponsesOutputToTurnResult(result);
    }

    const msgs = await buildOpenAiMessages(
      input.systemPrompt,
      input.messages,
      input.resolveImageDataUrl,
      input.signal
    );
    const payload = {
      model: this.options.model,
      messages: msgs,
      tools,
      tool_choice: 'auto'
    };

    await maybeLogLlmRequest(process.env, input.debugLlmContext, this.name, {
      kind: 'chat.completions',
      ...payload
    });

    const result = await postJson<ChatResponse>(
      endpoint,
      payload,
      {
        authorization: `Bearer ${this.options.apiKey}`
      },
      { signal: input.signal }
    );

    const choice = result.choices?.[0];
    const assistantParts: MessagePart[] = [];
    const msg = choice?.message;
    const reasoning = coalesceOpenAiReasoningText(
      msg as Record<string, unknown> | null | undefined
    ).trim();
    if (reasoning) {
      assistantParts.push({ type: 'reasoning', text: reasoning });
    }
    const content = msg?.content;
    if (typeof content === 'string' && content.trim()) {
      assistantParts.push({
        type: 'text',
        text: content
      });
    }

    for (const toolCall of choice?.message?.tool_calls ?? []) {
      assistantParts.push({
        type: 'tool_call',
        toolCallId: toolCall.id,
        name: toolCall.function?.name ?? 'unknown_tool',
        input: parseModelToolArguments(toolCall.function?.arguments)
      });
    }

    return {
      stopReason: (choice?.message?.tool_calls?.length ?? 0) > 0 ? 'tool_use' : 'end',
      assistantParts
    };
  }

  async runTurnStream(
    input: ModelTurnInput,
    onChunk: (chunk: ModelStreamChunk) => void
  ): Promise<ModelTurnResult> {
    const tools = toolDefinitions(input.tools);
    const endpoint = openAiCompatEndpoint(this.options.baseUrl, this.httpKind);
    const payload =
      this.httpKind === 'responses'
        ? {
            model: this.options.model,
            instructions: input.systemPrompt,
            input: await buildResponsesApiInput(
              input.messages,
              input.resolveImageDataUrl,
              input.signal
            ),
            tools: mapToolDefinitionsToResponsesFormat(tools),
            tool_choice: 'auto' as const,
            stream: true
          }
        : {
            model: this.options.model,
            messages: await buildOpenAiMessages(
              input.systemPrompt,
              input.messages,
              input.resolveImageDataUrl,
              input.signal
            ),
            tools,
            tool_choice: 'auto',
            stream: true
          };

    await maybeLogLlmRequest(process.env, input.debugLlmContext, this.name, {
      kind: this.httpKind === 'responses' ? 'responses.stream' : 'chat.completions.stream',
      ...payload
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: input.signal
    });

    if (!response.ok || !response.body) {
      const text = await response.text();
      throw new Error(`OpenAI stream failed ${response.status}: ${text.slice(0, 300)}`);
    }

    let textAcc = '';
    let reasoningAcc = '';
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: string | undefined;

    const rsAgg: ResponsesStreamAgg = {
      textAcc: '',
      reasoningAcc: '',
      funcByItemId: new Map(),
      completedResponse: null
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const flushLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) {
        return;
      }
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') {
        return;
      }
      let parsedUnknown: unknown;
      try {
        parsedUnknown = JSON.parse(data);
      } catch {
        return;
      }
      if (!parsedUnknown || typeof parsedUnknown !== 'object' || Array.isArray(parsedUnknown)) {
        return;
      }
      const parsed = parsedUnknown as Record<string, unknown>;

      if (this.httpKind === 'responses') {
        const typ = typeof parsed.type === 'string' ? parsed.type : '';
        if (typ.startsWith('response.') || typ === 'error') {
          handleResponsesStreamEvent(parsed, rsAgg, onChunk, process.env);
        }
        if (typ === 'response.completed' || typ === 'response.done') {
          const resp = parsed.response as Record<string, unknown> | undefined;
          const status = resp && typeof resp.status === 'string' ? resp.status : undefined;
          if (status === 'failed' || status === 'cancelled') {
            throw new Error(`Responses stream ended with status=${status}`);
          }
        }
        return;
      }

      let parsedChat: {
        choices?: Array<{
          finish_reason?: string | null;
          delta?: {
            content?: string | null;
            reasoning_content?: string | null;
            reasoning?: string | null;
            thinking?: string | null;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      parsedChat = parsed as typeof parsedChat;
      const choice = parsedChat.choices?.[0];
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason ?? undefined;
      }
      const delta = choice?.delta;
      const reasoningPiece = coalesceOpenAiReasoningText(
        delta as Record<string, unknown> | null | undefined
      );
      if (reasoningPiece) {
        reasoningAcc += reasoningPiece;
        onChunk({ type: 'reasoning_delta', text: reasoningPiece });
      }
      if (delta?.content) {
        textAcc += delta.content;
        onChunk({ type: 'text_delta', text: delta.content });
      }
      for (const tc of delta?.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        let slot = toolAcc.get(idx);
        if (!slot) {
          slot = { id: tc.id ?? '', name: '', args: '' };
          toolAcc.set(idx, slot);
          if (tc.id) {
            onChunk({ type: 'tool_call_start', toolCallId: tc.id, name: tc.function?.name ?? '' });
          }
        }
        if (tc.id) {
          slot.id = tc.id;
        }
        if (tc.function?.name) {
          slot.name = tc.function.name;
        }
        if (tc.function?.arguments) {
          slot.args += tc.function.arguments;
          onChunk({
            type: 'tool_call_delta',
            toolCallId: slot.id || String(idx),
            argumentsFragment: tc.function.arguments
          });
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        flushLine(line);
      }
    }
    if (buffer.trim()) {
      flushLine(buffer);
    }

    if (this.httpKind === 'responses') {
      let assistantParts: MessagePart[] = [];
      let stopReason: ModelTurnResult['stopReason'] = 'end';
      if (rsAgg.completedResponse && Array.isArray(rsAgg.completedResponse.output)) {
        const turn = parseResponsesOutputToTurnResult(rsAgg.completedResponse);
        assistantParts = turn.assistantParts;
        stopReason = turn.stopReason;
      } else {
        if (rsAgg.reasoningAcc.trim()) {
          assistantParts.push({ type: 'reasoning', text: rsAgg.reasoningAcc.trim() });
        }
        if (rsAgg.textAcc) {
          assistantParts.push({ type: 'text', text: rsAgg.textAcc });
        }
        const seenCall = new Set<string>();
        for (const slot of rsAgg.funcByItemId.values()) {
          if (!slot.name || !slot.callId || seenCall.has(slot.callId)) continue;
          seenCall.add(slot.callId);
          assistantParts.push({
            type: 'tool_call',
            toolCallId: slot.callId,
            name: slot.name,
            input: parseModelToolArguments(slot.args)
          });
        }
        stopReason = assistantParts.some((p) => p.type === 'tool_call') ? 'tool_use' : 'end';
      }
      if (assistantParts.length === 0) {
        assistantParts.push({ type: 'text', text: '' });
        stopReason = 'end';
      }
      onChunk({ type: 'done', stopReason });
      return { assistantParts, stopReason };
    }

    const assistantParts: MessagePart[] = [];
    if (reasoningAcc.trim()) {
      assistantParts.push({ type: 'reasoning', text: reasoningAcc.trim() });
    }
    if (textAcc.trim()) {
      assistantParts.push({ type: 'text', text: textAcc });
    }

    const sortedTools = [...toolAcc.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, slot] of sortedTools) {
      if (!slot.name) {
        continue;
      }
      const inputObj = parseModelToolArguments(slot.args);
      assistantParts.push({
        type: 'tool_call',
        toolCallId: slot.id || createToolCallId(),
        name: slot.name,
        input: inputObj
      });
    }

    const stopReason =
      assistantParts.some((p) => p.type === 'tool_call') || finishReason === 'tool_calls'
        ? 'tool_use'
        : 'end';
    onChunk({ type: 'done', stopReason });
    return { assistantParts, stopReason };
  }

  async summarizeMessages(input: SummaryInput): Promise<string> {
    type ChatResponse = {
      choices?: Array<{
        message?: { content?: string | null };
      }>;
    };

    // Under `/v1/responses` we take plain `output_text` (no `response_format`); summaries are
    // free-form prose, not guaranteed `{"summary":...}` JSON.
    const useJsonFormat = this.options.useJsonMode && this.httpKind !== 'responses';
    const summMessages = [
      {
        role: 'system',
        content: useJsonFormat
          ? 'Summarize the conversation state for continuation. Return JSON with a single "summary" string field. Preserve tasks, decisions, risks, and pending work.'
          : 'Summarize the conversation state for continuation. Preserve tasks, decisions, risks, and pending work.'
      },
      {
        role: 'user',
        content: JSON.stringify(
          input.messages.map((message) => ({
            role: message.role,
            text: textSummaryFromParts(message.parts)
          }))
        )
      }
    ];

    const endpoint = openAiCompatEndpoint(this.options.baseUrl, this.httpKind);

    if (this.httpKind === 'responses') {
      const payload = {
        model: this.options.model,
        instructions: summMessages[0]!.content as string,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: String(summMessages[1]!.content) }]
          }
        ]
      };
      const result = await postJson<Record<string, unknown>>(
        endpoint,
        payload,
        {
          authorization: `Bearer ${this.options.apiKey}`
        }
      );
      const turn = parseResponsesOutputToTurnResult(result);
      const text = turn.assistantParts
        .filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
        .trim();
      return text || 'Conversation compacted.';
    }

    const payload = {
      model: this.options.model,
      messages: summMessages,
      ...(useJsonFormat
        ? {
            response_format: {
              type: 'json_object'
            }
          }
        : {})
    };

    const result = await postJson<ChatResponse>(endpoint, payload, {
      authorization: `Bearer ${this.options.apiKey}`
    });

    const content = result.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return 'Conversation compacted.';
    }

    if (!useJsonFormat) {
      return content;
    }

    try {
      const parsed = JSON.parse(content) as { summary?: string };
      return parsed.summary?.trim() || content;
    } catch {
      return content;
    }
  }
}

export class AnthropicCompatibleAdapter implements ModelAdapter {
  readonly name = 'anthropic-compatible';

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      model: string;
    }
  ) {}

  async runTurn(input: ModelTurnInput): Promise<ModelTurnResult> {
    type MessagesResponse = {
      stop_reason?: string;
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      >;
    };

    const { messages: anthropicMsgs, refusalReminder } = await buildAnthropicMessages(
      input.messages,
      input.resolveImageDataUrl,
      input.signal
    );

    // Build system prompt array, merging refusal preservation reminder if present
    const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [];
    systemBlocks.push({
      type: 'text',
      text: input.systemPrompt
    });
    if (refusalReminder) {
      systemBlocks.push({
        type: 'text',
        text: refusalReminder
      });
    }
    // Only the last block gets cache_control so we can cache the base system prompt
    systemBlocks[systemBlocks.length - 1]!.cache_control = { type: 'ephemeral' };

    const payload = {
      model: this.options.model,
      // Use structured content blocks on system to enable Anthropic prompt caching.
      // The last block carries cache_control so the provider can cache everything
      // up to and including the system prompt prefix across turns.
      system: systemBlocks,
      max_tokens: 4000,
      messages: anthropicMsgs,
      tools: [...input.tools].sort((a, b) => a.name.localeCompare(b.name)).map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema
      }))
    };

    await maybeLogLlmRequest(process.env, input.debugLlmContext, this.name, {
      kind: 'anthropic.messages',
      ...(payload as Record<string, unknown>)
    });

    const result = await postJson<MessagesResponse>(
      `${this.options.baseUrl.replace(/\/$/, '')}/messages`,
      payload,
      {
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01'
      },
      { signal: input.signal }
    );

    const assistantParts: MessagePart[] = result.content.map((part) =>
      part.type === 'text'
        ? {
            type: 'text',
            text: part.text
          }
        : {
            type: 'tool_call',
            toolCallId: part.id,
            name: part.name,
            input: part.input
          }
    );

    return {
      stopReason: result.stop_reason === 'tool_use' ? 'tool_use' : 'end',
      assistantParts
    };
  }

  async summarizeMessages(input: SummaryInput): Promise<string> {
    type MessagesResponse = {
      content: Array<{ type: 'text'; text: string }>;
    };

    const result = await postJson<MessagesResponse>(
      `${this.options.baseUrl.replace(/\/$/, '')}/messages`,
      {
        model: this.options.model,
        max_tokens: 1000,
        system: 'Summarize the conversation state for continuation. Preserve tasks, decisions, risks, and pending work.',
        messages: [
          {
            role: 'user',
            content: JSON.stringify(
              input.messages.map((message) => ({
                role: message.role,
                text: textSummaryFromParts(message.parts)
              }))
            )
          }
        ]
      },
      {
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01'
      }
    );

    return result.content.find((part) => part.type === 'text')?.text?.trim() || 'Conversation compacted.';
  }
}

export class HybridModelRouterAdapter implements ModelAdapter {
  readonly name = 'hybrid-router';

  constructor(
    private readonly textAdapter: ModelAdapter,
    private readonly vlAdapter: ModelAdapter,
    private readonly routeScope: 'last_user' | 'any' = 'any'
  ) {}

  private needsVl(input: ModelTurnInput): boolean {
    if (this.routeScope === 'last_user') {
      const last = [...input.messages].reverse().find((m) => m.role === 'user');
      return last?.parts.some((p) => p.type === 'image') ?? false;
    }
    return input.messages.some((m) => m.parts.some((p) => p.type === 'image'));
  }

  async runTurn(input: ModelTurnInput): Promise<ModelTurnResult> {
    return this.needsVl(input) ? this.vlAdapter.runTurn(input) : this.textAdapter.runTurn(input);
  }

  async runTurnStream(
    input: ModelTurnInput,
    onChunk: (chunk: ModelStreamChunk) => void
  ): Promise<ModelTurnResult> {
    const vl = this.needsVl(input);
    if (vl && typeof this.vlAdapter.runTurnStream === 'function') {
      return this.vlAdapter.runTurnStream(input, onChunk);
    }
    if (!vl && typeof this.textAdapter.runTurnStream === 'function') {
      return this.textAdapter.runTurnStream(input, onChunk);
    }
    const result = vl ? await this.vlAdapter.runTurn(input) : await this.textAdapter.runTurn(input);
    if (result.assistantParts[0]?.type === 'text') {
      onChunk({ type: 'text_delta', text: result.assistantParts[0].text });
    }
    onChunk({ type: 'done', stopReason: result.stopReason });
    return result;
  }

  async summarizeMessages(input: SummaryInput): Promise<string> {
    return this.textAdapter.summarizeMessages(input);
  }
}

/** Single-turn VL call (OpenAI-style chat.completions) for tools / batch analysis. */
export async function runOpenAiVisionTurn(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  userPrompt: string;
  imageDataUrls: string[];
  signal?: AbortSignal;
}): Promise<string> {
  const content: Array<Record<string, unknown>> = [];
  if (options.userPrompt.trim()) {
    content.push({ type: 'text', text: options.userPrompt.trim() });
  }
  for (const url of options.imageDataUrls) {
    content.push({ type: 'image_url', image_url: { url } });
  }
  type ChatResponse = { choices?: Array<{ message?: { content?: string | null } }> };
  const result = await postJson<ChatResponse>(
    `${options.baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      model: options.model,
      messages: [
        {
          role: 'system',
          content: 'You are a vision assistant. Answer concisely in the same language as the user prompt.'
        },
        { role: 'user', content }
      ],
      max_tokens: 2048
    },
    { authorization: `Bearer ${options.apiKey}` },
    { signal: options.signal }
  );
  return result.choices?.[0]?.message?.content?.trim() ?? '';
}

export function createModelAdapterFromEnv(env: NodeJS.ProcessEnv): ModelAdapter {
  const provider = env.RAW_AGENT_MODEL_PROVIDER ?? 'heuristic';
  const useJsonMode = !['0', 'false', 'off'].includes(String(env.RAW_AGENT_USE_JSON_MODE ?? '1').toLowerCase());

  if (provider === 'openai-compatible') {
    const apiKey = env.RAW_AGENT_API_KEY;
    const baseUrl = env.RAW_AGENT_BASE_URL;
    const model = env.RAW_AGENT_MODEL_NAME;
    if (!apiKey || !baseUrl || !model) {
      throw new Error('Missing RAW_AGENT_API_KEY, RAW_AGENT_BASE_URL, or RAW_AGENT_MODEL_NAME');
    }
    const httpKind = normalizeOpenAiHttpKind(env.RAW_AGENT_OPENAI_HTTP_KIND);
    const textAdapter = new OpenAICompatibleAdapter({ apiKey, baseUrl, model, useJsonMode, httpKind });
    const vlModel = env.RAW_AGENT_VL_MODEL_NAME?.trim();
    if (vlModel) {
      const vlBase = (env.RAW_AGENT_VL_BASE_URL ?? baseUrl).trim();
      const vlKey = (env.RAW_AGENT_VL_API_KEY ?? apiKey).trim();
      const vlUseJson =
        !['0', 'false', 'off'].includes(String(env.RAW_AGENT_VL_USE_JSON_MODE ?? '0').toLowerCase());
      const vlHttpRaw = env.RAW_AGENT_VL_OPENAI_HTTP_KIND?.trim();
      const vlHttpKind = vlHttpRaw ? normalizeOpenAiHttpKind(vlHttpRaw) : httpKind;
      const vlAdapter = new OpenAICompatibleAdapter({
        apiKey: vlKey,
        baseUrl: vlBase,
        model: vlModel,
        useJsonMode: vlUseJson,
        httpKind: vlHttpKind
      });
      const scope: 'last_user' | 'any' =
        env.RAW_AGENT_VL_ROUTE_SCOPE === 'last_user' ? 'last_user' : 'any';
      return new HybridModelRouterAdapter(textAdapter, vlAdapter, scope);
    }
    return textAdapter;
  }

  if (provider === 'anthropic-compatible') {
    const apiKey = env.RAW_AGENT_API_KEY;
    const baseUrl = env.RAW_AGENT_ANTHROPIC_URL ?? env.RAW_AGENT_BASE_URL;
    const model = env.RAW_AGENT_MODEL_NAME;
    if (!apiKey || !baseUrl || !model) {
      throw new Error('Missing RAW_AGENT_API_KEY, RAW_AGENT_ANTHROPIC_URL/RAW_AGENT_BASE_URL, or RAW_AGENT_MODEL_NAME');
    }
    return new AnthropicCompatibleAdapter({ apiKey, baseUrl, model });
  }

  return new HeuristicModelAdapter();
}
