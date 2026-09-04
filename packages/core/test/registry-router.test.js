import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  shouldFallbackProviderError,
  withProviderFallback,
  resolveRouteCandidates,
  resolveModelRoute
} from '../dist/model/registry-router.js';
import { HEURISTIC_PROVIDER_ID, upsertProvider } from '../dist/model/provider-catalog.js';
import { OpenAICompatibleAdapter } from '../dist/model/model-adapters.js';
import { SqliteStateStore } from '../dist/storage.js';

test('shouldFallbackProviderError accepts 503 / timeout, rejects 400', () => {
  assert.equal(shouldFallbackProviderError({ status: 503, message: 'unavailable' }), true);
  assert.equal(shouldFallbackProviderError(new Error('fetch failed ECONNRESET')), true);
  assert.equal(shouldFallbackProviderError({ status: 400, message: 'bad request' }), false);
});

test('withProviderFallback switches to the next adapter after a retryable error', async () => {
  const calls = [];
  const result = await withProviderFallback(
    [
      { adapter: { name: 'primary' }, label: 'a' },
      { adapter: { name: 'backup' }, label: 'b' }
    ],
    async (adapter) => {
      calls.push(adapter.name);
      if (adapter.name === 'primary') {
        const err = new Error('service unavailable');
        err.status = 503;
        throw err;
      }
      return 'ok-from-backup';
    }
  );
  assert.equal(result, 'ok-from-backup');
  assert.deepEqual(calls, ['primary', 'backup']);
});

test('resolveRouteCandidates keeps heuristic last and honors thinking_mode=off', () => {
  const catalog = {
    providers: [
      {
        id: 'p1',
        name: 'Think',
        kind: 'openai-compatible',
        models: [{ id: 'think-1', enabled: true, capabilities: ['thinking'] }]
      },
      {
        id: 'p2',
        name: 'Plain',
        kind: 'openai-compatible',
        models: [{ id: 'plain-1', enabled: true, capabilities: ['text'] }]
      }
    ],
    defaultRef: { providerId: 'p1', modelId: 'think-1' },
    thinkingMode: 'off',
    fallbackRefs: [{ providerId: 'p2', modelId: 'plain-1' }],
    updatedAt: ''
  };
  const { refs } = resolveRouteCandidates({
    catalog,
    session: { metadata: { thinkingMode: 'off' } }
  });
  assert.ok(refs.some((r) => r.providerId === 'p2'));
  assert.equal(refs[refs.length - 1].providerId, HEURISTIC_PROVIDER_ID);
  assert.ok(!refs.some((r) => r.modelId === 'think-1'));
});

test('resolveModelRoute keeps heuristic adapter when fallbackAdapter is remote', () => {
  const dir = mkdtempSync(join(tmpdir(), 'route-heur-'));
  const store = new SqliteStateStore(join(dir, 'state.db'));
  const remote = new OpenAICompatibleAdapter({
    apiKey: 'sk-test',
    baseUrl: 'https://example.invalid/v1',
    model: 'ghost',
    useJsonMode: false
  });
  const route = resolveModelRoute({
    store,
    session: {
      metadata: { modelRef: { providerId: HEURISTIC_PROVIDER_ID, modelId: 'heuristic' } }
    },
    fallbackAdapter: remote
  });
  assert.equal(route.primary.name, 'heuristic');
  assert.ok(route.candidates.every((a) => a.name === 'heuristic' || a.name === 'openai-compatible'));
  assert.equal(route.candidates[0]?.name, 'heuristic');
});

test('resolveModelRoute keeps injected fallback when catalog is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'route-fb-'));
  const store = new SqliteStateStore(join(dir, 'state.db'));
  const mock = { name: 'mock-llm' };
  const route = resolveModelRoute({
    store,
    session: { metadata: {} },
    fallbackAdapter: mock
  });
  assert.equal(route.primary, mock);
  assert.equal(route.primary.name, 'mock-llm');
  store.db.close();
});

test('resolveModelRoute appends heuristic last after a catalog remote', () => {
  const dir = mkdtempSync(join(tmpdir(), 'route-last-'));
  const store = new SqliteStateStore(join(dir, 'state.db'));
  upsertProvider(store, {
    name: 'Remote',
    kind: 'openai-compatible',
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'sk-test',
    models: [{ id: 'm1', enabled: true }]
  });
  const mock = { name: 'mock-llm' };
  const route = resolveModelRoute({
    store,
    session: { metadata: {} },
    fallbackAdapter: mock
  });
  assert.equal(route.primary.name, 'openai-compatible');
  assert.equal(route.candidates[route.candidates.length - 1]?.name, 'heuristic');
  assert.ok(!route.candidates.some((a) => a.name === 'mock-llm'));
  store.db.close();
});
