import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ModelAdapter } from '../types.js';
import {
  loadReplayFixtures,
  replayApiKey,
  replayFixture,
  replayMismatches,
  replayTurnInput,
  runReplayTurn,
  startReplayServer,
  type ReplayFixture,
  type ReplayProvider
} from '../testing/upstream-replay.js';
import { AnthropicMessagesAdapter, OpenAiChatAdapter, OpenAiResponsesAdapter } from './model-adapters.js';
import { splitCumulativePromptTokens } from './usage.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../testing/upstream-fixtures');
const fixtures = loadReplayFixtures(FIXTURE_DIR);

const makers: Record<ReplayProvider, (baseUrl: string) => ModelAdapter> = {
  'openai-chat': (baseUrl) =>
    new OpenAiChatAdapter({ apiKey: replayApiKey(), baseUrl, model: 'replay-model', useJsonMode: false }),
  'openai-responses': (baseUrl) =>
    new OpenAiResponsesAdapter({ apiKey: replayApiKey(), baseUrl, model: 'replay-model', useJsonMode: false }),
  anthropic: (baseUrl) => new AnthropicMessagesAdapter({ apiKey: replayApiKey(), baseUrl, model: 'replay-model' })
};

function fixture(name: string): ReplayFixture {
  const found = fixtures.find((f) => f.name === name);
  if (!found) throw new Error(`missing fixture ${name}`);
  return found;
}

describe('upstream replay: @ppeng/agent-loop adapters', () => {
  it('loads every recorded scenario', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(30);
    expect(new Set(fixtures.map((f) => f.provider))).toEqual(new Set(['openai-chat', 'openai-responses', 'anthropic']));
  });

  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fx) => {
    const outcome = await replayFixture(fx, makers[fx.provider]);
    const mismatches = replayMismatches(outcome, fx.expect);
    expect(mismatches, mismatches.join('\n')).toEqual([]);
  });

  it('sends provider credentials the way each API expects', async () => {
    const chat = await replayFixture(fixture('chat-stream-text'), makers['openai-chat']);
    expect(chat.requests[0]?.headers.authorization).toBe(`Bearer ${replayApiKey()}`);
    const anth = await replayFixture(fixture('anthropic-stream-text'), makers.anthropic);
    expect(anth.requests[0]?.headers['x-api-key']).toBe(replayApiKey());
    expect(anth.requests[0]?.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('cumulative prompt-token gateway: raw figures per turn, split into per-turn shares', async () => {
    const fx = fixture('chat-stream-cumulative-prompt-gateway');
    const server = await startReplayServer(fx.responses);
    try {
      const adapter = makers['openai-chat'](server.baseUrl);
      const first = await runReplayTurn(adapter, fx, server);
      const second = await runReplayTurn(adapter, fx, server);
      expect(first.result?.usage?.inputTokens).toBe(30000);
      expect(second.result?.usage?.inputTokens).toBe(63000);
      const t1 = splitCumulativePromptTokens(first.result!.usage!.inputTokens, undefined);
      const t2 = splitCumulativePromptTokens(second.result!.usage!.inputTokens, t1.cumulativeInputTokens);
      expect(t2).toEqual({ turnInputTokens: 33000, cumulativeInputTokens: 63000, treatedAsCumulative: true });
    } finally {
      await server.close();
    }
  });

  it.each([
    ['openai-chat', { data: { error: { message: 'The server had an error', type: 'server_error' } } }],
    ['openai-responses', { event: 'error', data: { type: 'error', code: 'server_error', message: 'boom' } }],
    ['anthropic', { event: 'error', data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }]
  ] as const)('%s: a mid-stream error releases the upstream connection', async (provider, errorEvent) => {
    const server = await startReplayServer([{ status: 200, end: 'hang', events: [errorEvent] }]);
    try {
      const outcome = await runReplayTurn(makers[provider](server.baseUrl), { mode: 'stream' }, server, replayTurnInput());
      expect(outcome.error?.name).toBe('UpstreamStreamError');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(server.abandoned()).toBe(1);
    } finally {
      await server.close();
    }
  });

  it.each(['openai-chat', 'openai-responses', 'anthropic'] as const)(
    '%s: aborting the turn cancels the upstream request',
    async (provider) => {
      const server = await startReplayServer([
        { status: 200, end: 'hang', events: [{ raw: ': waiting for tokens\n\n' }] }
      ]);
      try {
        const ac = new AbortController();
        const pending = runReplayTurn(makers[provider](server.baseUrl), { mode: 'stream' }, server, replayTurnInput(ac.signal));
        await new Promise((resolve) => setTimeout(resolve, 50));
        ac.abort();
        const outcome = await pending;
        expect(outcome.error?.name).toBe('AbortError');
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(server.abandoned()).toBe(1);
      } finally {
        await server.close();
      }
    }
  );
});
