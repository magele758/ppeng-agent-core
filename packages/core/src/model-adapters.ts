import type {
  MessagePart,
  ModelAdapter,
  ModelStreamChunk,
  ModelTurnInput,
  ModelTurnResult,
  SessionMessage,
  SummaryInput,
  ToolContract
} from './types.js';

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
          content: part.content
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

function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } | undefined {
  const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/is);
  if (!m?.[1] || !m[2]) return undefined;
  return { mediaType: m[1], base64: m[2] };
}

async function buildAnthropicMessages(
  messages: SessionMessage[],
  resolveImage?: (assetId: string, signal?: AbortSignal) => Promise<string | undefined>,
  signal?: AbortSignal
): Promise<Array<Record<string, unknown>>> {
  const output: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === 'system') {
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
              content: part.content,
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

  return output;
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
    }
  ) {}

  async runTurn(input: ModelTurnInput): Promise<ModelTurnResult> {
    type ChatResponse = {
      choices?: Array<{
        finish_reason?: string;
        message?: {
          content?: string | null;
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

    const msgs = await buildOpenAiMessages(
      input.systemPrompt,
      input.messages,
      input.resolveImageDataUrl,
      input.signal
    );
    const payload = {
      model: this.options.model,
      messages: msgs,
      tools: toolDefinitions(input.tools),
      tool_choice: 'auto'
    };

    const result = await postJson<ChatResponse>(
      `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`,
      payload,
      {
        authorization: `Bearer ${this.options.apiKey}`
      },
      { signal: input.signal }
    );

    const choice = result.choices?.[0];
    const assistantParts: MessagePart[] = [];
    const content = choice?.message?.content;
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
        input: JSON.parse(toolCall.function?.arguments ?? '{}') as Record<string, unknown>
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
    const base = this.options.baseUrl.replace(/\/$/, '');
    const msgs = await buildOpenAiMessages(
      input.systemPrompt,
      input.messages,
      input.resolveImageDataUrl,
      input.signal
    );
    const payload = {
      model: this.options.model,
      messages: msgs,
      tools: toolDefinitions(input.tools),
      tool_choice: 'auto',
      stream: true
    };

    const response = await fetch(`${base}/chat/completions`, {
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
    const toolAcc = new Map<
      number,
      { id: string; name: string; args: string }
    >();
    let finishReason: string | undefined;

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
      let parsed: {
        choices?: Array<{
          finish_reason?: string | null;
          delta?: {
            content?: string | null;
            /** 部分 OpenAI 兼容 / 推理模型流式字段 */
            reasoning_content?: string | null;
            reasoning?: string | null;
            /** 部分网关会单独传 thinking */
            thinking?: string | null;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      try {
        parsed = JSON.parse(data) as typeof parsed;
      } catch {
        return;
      }
      const choice = parsed.choices?.[0];
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason ?? undefined;
      }
      const delta = choice?.delta;
      const reasoningPiece =
        (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) ||
        (typeof delta?.reasoning === 'string' && delta.reasoning) ||
        (typeof delta?.thinking === 'string' && delta.thinking) ||
        '';
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
          onChunk({ type: 'tool_call_delta', toolCallId: slot.id || String(idx), argumentsFragment: tc.function.arguments });
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
      let inputObj: Record<string, unknown> = {};
      try {
        inputObj = JSON.parse(slot.args || '{}') as Record<string, unknown>;
      } catch {
        inputObj = { raw: slot.args };
      }
      assistantParts.push({
        type: 'tool_call',
        toolCallId: slot.id || createToolCallId(),
        name: slot.name,
        input: inputObj
      });
    }

    const stopReason =
      assistantParts.some((p) => p.type === 'tool_call') || finishReason === 'tool_calls' ? 'tool_use' : 'end';
    onChunk({ type: 'done', stopReason });
    return { assistantParts, stopReason };
  }

  async summarizeMessages(input: SummaryInput): Promise<string> {
    type ChatResponse = {
      choices?: Array<{
        message?: { content?: string | null };
      }>;
    };

    const payload = {
      model: this.options.model,
      messages: [
        {
          role: 'system',
          content: this.options.useJsonMode
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
      ],
      ...(this.options.useJsonMode
        ? {
            response_format: {
              type: 'json_object'
            }
          }
        : {})
    };

    const result = await postJson<ChatResponse>(
      `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`,
      payload,
      {
        authorization: `Bearer ${this.options.apiKey}`
      }
    );

    const content = result.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return 'Conversation compacted.';
    }

    if (!this.options.useJsonMode) {
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

    const anthropicMsgs = await buildAnthropicMessages(
      input.messages,
      input.resolveImageDataUrl,
      input.signal
    );
    const payload = {
      model: this.options.model,
      // Use structured content blocks on system to enable Anthropic prompt caching.
      // The last block carries cache_control so the provider can cache everything
      // up to and including the system prompt prefix across turns.
      system: [
        {
          type: 'text',
          text: input.systemPrompt,
          cache_control: { type: 'ephemeral' }
        }
      ],
      max_tokens: 4000,
      messages: anthropicMsgs,
      tools: [...input.tools].sort((a, b) => a.name.localeCompare(b.name)).map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema
      }))
    };

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
    const textAdapter = new OpenAICompatibleAdapter({ apiKey, baseUrl, model, useJsonMode });
    const vlModel = env.RAW_AGENT_VL_MODEL_NAME?.trim();
    if (vlModel) {
      const vlBase = (env.RAW_AGENT_VL_BASE_URL ?? baseUrl).trim();
      const vlKey = (env.RAW_AGENT_VL_API_KEY ?? apiKey).trim();
      const vlUseJson =
        !['0', 'false', 'off'].includes(String(env.RAW_AGENT_VL_USE_JSON_MODE ?? '0').toLowerCase());
      const vlAdapter = new OpenAICompatibleAdapter({
        apiKey: vlKey,
        baseUrl: vlBase,
        model: vlModel,
        useJsonMode: vlUseJson
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
