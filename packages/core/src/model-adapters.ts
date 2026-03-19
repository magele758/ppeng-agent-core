import type {
  MessagePart,
  ModelAdapter,
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

function lastUserText(messages: SessionMessage[]): string {
  const reversed = [...messages].reverse();
  const message = reversed.find((candidate) => candidate.role === 'user');
  return message ? textFromParts(message.parts) : '';
}

function toolDefinitions(tools: ToolContract[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }));
}

async function postJson<T>(url: string, body: unknown, headers: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Remote adapter request failed with ${response.status}: ${text.slice(0, 300)}`);
  }

  return JSON.parse(text) as T;
}

function openAiMessages(systemPrompt: string, messages: SessionMessage[]): Array<Record<string, unknown>> {
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

    const text = textFromParts(message.parts);
    const toolCalls = message.parts
      .filter((part): part is Extract<MessagePart, { type: 'tool_call' }> => part.type === 'tool_call')
      .map((part) => ({
        id: part.toolCallId,
        type: 'function',
        function: {
          name: part.name,
          arguments: JSON.stringify(part.input)
        }
      }));

    if (message.role === 'assistant') {
      output.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
      });
      continue;
    }

    output.push({
      role: message.role,
      content: text
    });
  }

  return output;
}

function anthropicMessages(messages: SessionMessage[]): Array<Record<string, unknown>> {
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
      if (part.type === 'text') {
        content.push({ type: 'text', text: part.text });
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
    const lastText = lastUserText(input.messages).toLowerCase();

    if (!lastText) {
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
          text: `Heuristic adapter reply: ${lastUserText(input.messages)}`
        }
      ]
    };
  }

  async summarizeMessages(input: SummaryInput): Promise<string> {
    const recent = input.messages.slice(-8).map((message) => `${message.role}: ${textFromParts(message.parts)}`);
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

    const payload = {
      model: this.options.model,
      messages: openAiMessages(input.systemPrompt, input.messages),
      tools: toolDefinitions(input.tools),
      tool_choice: 'auto'
    };

    const result = await postJson<ChatResponse>(
      `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`,
      payload,
      {
        authorization: `Bearer ${this.options.apiKey}`
      }
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
              text: textFromParts(message.parts)
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

    const payload = {
      model: this.options.model,
      system: input.systemPrompt,
      max_tokens: 4000,
      messages: anthropicMessages(input.messages),
      tools: input.tools.map((tool) => ({
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
      }
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
                text: textFromParts(message.parts)
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
    return new OpenAICompatibleAdapter({ apiKey, baseUrl, model, useJsonMode });
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
