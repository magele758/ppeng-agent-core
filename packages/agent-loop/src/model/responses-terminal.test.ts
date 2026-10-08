import { afterEach, expect, it, vi } from 'vitest';
import { OpenAiResponsesAdapter } from './model-adapters.js';
import type { ModelTurnInput } from '../types.js';

const input: ModelTurnInput = {
  agent: { id: 'a', name: 'a', role: 'test', instructions: '', capabilities: [] },
  systemPrompt: 'system', messages: [], tools: []
};
const adapter = () => new OpenAiResponsesAdapter({ apiKey: 'test', baseUrl: 'https://example.invalid/v1', model: 'test', useJsonMode: false });
afterEach(() => { vi.unstubAllGlobals(); });

it('incomplete without output keeps streamed text and terminal usage/truncation', async () => {
  const events = [
    { type: 'response.output_text.delta', delta: 'partial' },
    { type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } } }
  ];
  vi.stubGlobal('fetch', async () => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')));
  const result = await adapter().runTurnStream(input, () => {});
  expect(result.assistantParts).toContainEqual({ type: 'text', text: 'partial' });
  expect(result.truncated).toBe(true);
  expect(result.finishReason).toBe('max_output_tokens');
  expect(result.usage?.totalTokens).toBe(7);
});

it.each(['failed', 'cancelled'])('terminal %s without output rejects instead of completing', async status => {
  vi.stubGlobal('fetch', async () => new Response(`data: ${JSON.stringify({ type: `response.${status}`, response: { status } })}\n\n`));
  await expect(adapter().runTurnStream(input, () => {})).rejects.toThrow(`status=${status}`);
});

it.each([{}, { output: [] }])('terminal gateway output_text is preserved with %j', async output => {
  const response = { status: 'completed', ...output, output_text: 'terminal answer' };
  vi.stubGlobal('fetch', async () => new Response(`data: ${JSON.stringify({ type: 'response.completed', response })}\n\n`));
  const result = await adapter().runTurnStream(input, () => {});
  expect(result.assistantParts).toContainEqual({ type: 'text', text: 'terminal answer' });
  expect(result.stopReason).toBe('end');
});
