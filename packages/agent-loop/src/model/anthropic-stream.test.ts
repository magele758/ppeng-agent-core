import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicMessagesAdapter } from './model-adapters.js';
import type { ModelStreamChunk, ModelTurnInput } from '../types.js';

function sse(events: Array<[string, unknown]>, opts: { chunkSize?: number; requestId?: string } = {}): Response {
  const chunkSize = opts.chunkSize ?? 37;
  const text = events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  return new Response(body, { status: 200, headers: opts.requestId ? { 'request-id': opts.requestId } : {} });
}

const input: ModelTurnInput = {
  agent: { id: 'a', name: 'a' } as ModelTurnInput['agent'],
  systemPrompt: 'sys',
  messages: [
    { id: 'm1', sessionId: 's', role: 'user', parts: [{ type: 'text', text: 'hi' }], createdAt: 't', seq: 1 },
  ],
  tools: [
    { name: 'bash', description: 'run', inputSchema: { type: 'object' }, approvalMode: 'never', sideEffectLevel: 'none', execute: async () => ({ ok: true, content: '' }) },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AnthropicMessagesAdapter.runTurnStream', () => {
  it('streams text / thinking / tool_use blocks and assembles the turn result with usage', async () => {
    let captured: { url: string; body: Record<string, unknown>; headers: Record<string, string> } | undefined;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = {
        url,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
        headers: init.headers as Record<string, string>,
      };
      return sse([
        ['message_start', { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 12, cache_read_input_tokens: 4 } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'let me ' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'think' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Running ' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'ls…' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 1 }],
        ['content_block_start', { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'bash', input: {} } }],
        ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"comm' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: 'and": "ls"}' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 2 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } }],
        ['message_stop', { type: 'message_stop' }],
      ], { requestId: 'req_stream_1' });
    });

    const adapter = new AnthropicMessagesAdapter({ apiKey: 'k', baseUrl: 'https://api.test/v1/', model: 'claude-x' });
    const chunks: ModelStreamChunk[] = [];
    const result = await adapter.runTurnStream(input, (c) => chunks.push(c));

    expect(captured?.url).toBe('https://api.test/v1/messages');
    expect(captured?.body.stream).toBe(true);
    expect(captured?.headers['x-api-key']).toBe('k');

    expect(chunks.filter((c) => c.type === 'reasoning_delta').map((c) => (c as { text: string }).text).join('')).toBe('let me think');
    expect(chunks.filter((c) => c.type === 'text_delta').map((c) => (c as { text: string }).text).join('')).toBe('Running ls…');
    expect(chunks.find((c) => c.type === 'tool_call_start')).toEqual({ type: 'tool_call_start', toolCallId: 'toolu_1', name: 'bash' });
    expect(
      chunks.filter((c) => c.type === 'tool_call_delta').map((c) => (c as { argumentsFragment: string }).argumentsFragment).join('')
    ).toBe('{"command": "ls"}');
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });

    expect(result.stopReason).toBe('tool_use');
    expect(result.finishReason).toBe('tool_use');
    expect(result.assistantParts).toEqual([
      { type: 'reasoning', text: 'let me think' },
      { type: 'text', text: 'Running ls…' },
      { type: 'tool_call', toolCallId: 'toolu_1', name: 'bash', input: { command: 'ls' } },
    ]);
    // normalizeAnthropicUsage folds cache reads into inputTokens (12 + 4).
    expect(result.usage).toMatchObject({ inputTokens: 16, outputTokens: 9, cachedInputTokens: 4 });
    expect(result.requestId).toBe('req_stream_1');
  });

  it('marks max_tokens as truncated and ends with stopReason end when no tool calls', async () => {
    vi.stubGlobal('fetch', async () =>
      sse([
        ['message_start', { type: 'message_start', message: { id: 'msg_2', usage: { input_tokens: 1 } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'partial' } }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 2 } }],
        ['message_stop', { type: 'message_stop' }],
      ])
    );
    const adapter = new AnthropicMessagesAdapter({ apiKey: 'k', baseUrl: 'https://api.test/v1', model: 'm' });
    const result = await adapter.runTurnStream(input, () => undefined);
    expect(result.assistantParts).toEqual([{ type: 'text', text: 'partial' }]);
    expect(result.stopReason).toBe('end');
    expect(result.truncated).toBe(true);
    expect(result.requestId).toBe('msg_2');
  });

  it('surfaces stream error events and non-2xx responses', async () => {
    vi.stubGlobal('fetch', async () =>
      sse([['error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]])
    );
    const adapter = new AnthropicMessagesAdapter({ apiKey: 'k', baseUrl: 'https://api.test/v1', model: 'm' });
    await expect(adapter.runTurnStream(input, () => undefined)).rejects.toThrow(/Overloaded/);

    vi.stubGlobal('fetch', async () => new Response('{"error":"bad key"}', { status: 401, headers: { 'request-id': 'req_401' } }));
    await expect(adapter.runTurnStream(input, () => undefined)).rejects.toThrow(/401.*req_401/);
  });
});
