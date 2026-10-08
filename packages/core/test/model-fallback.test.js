import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/runtime.js';
import { waitFor } from './helpers/settle.js';
import { SqliteStateStore } from '../dist/storage.js';
import { ValidationError } from '../dist/errors.js';
import { classifyModelError } from '../dist/model/error-class.js';
import {
  MODEL_FALLBACK_SETTINGS_KEY,
  modelFallbackPayload,
  planModelFallback,
  readModelFallbackSettings,
  runWithFallbackChain,
  writeModelFallbackSettings,
  attachServedByToTrace,
  rememberServedBy
} from '../dist/model/fallback-chain.js';
import { setCatalogDefaultRef, upsertProvider } from '../dist/model/provider-catalog.js';

function httpError(status, body = 'boom') {
  return new Error(`Remote adapter request failed with ${status}: ${body}`);
}

function tempStore() {
  return new SqliteStateStore(join(mkdtempSync(join(tmpdir(), 'model-fb-')), 'state.db'));
}

function seedProviders(store, { backupKey = 'sk-b' } = {}) {
  upsertProvider(store, {
    id: 'prov-a',
    name: 'Alpha',
    kind: 'openai-compatible',
    baseUrl: 'https://alpha.invalid/v1',
    apiKey: 'sk-a',
    models: [{ id: 'alpha-1', enabled: true }]
  });
  upsertProvider(store, {
    id: 'prov-b',
    name: 'Beta',
    kind: 'openai-compatible',
    baseUrl: 'https://beta.invalid/v1',
    apiKey: backupKey,
    models: [{ id: 'beta-1', enabled: true }]
  });
  upsertProvider(store, {
    id: 'prov-c',
    name: 'Gamma',
    kind: 'anthropic-compatible',
    baseUrl: 'https://gamma.invalid',
    apiKey: 'sk-c',
    models: [{ id: 'gamma-1', enabled: true }]
  });
  setCatalogDefaultRef(store, { providerId: 'prov-a', modelId: 'alpha-1' });
}

const A = { providerId: 'prov-a', modelId: 'alpha-1' };
const B = { providerId: 'prov-b', modelId: 'beta-1' };
const C = { providerId: 'prov-c', modelId: 'gamma-1' };

const cand = (name, ref) => ({ adapter: { name }, ref, label: name });
const ok = (text) => ({ stopReason: 'end', assistantParts: [{ type: 'text', text }] });

test('classifyModelError: retryable upstream classes', () => {
  const cases = [
    [httpError(500), 'server_error', 500],
    [httpError(502), 'server_error', 502],
    [httpError(503, 'Service Unavailable'), 'server_error', 503],
    [httpError(504), 'server_error', 504],
    [httpError(503, 'engine is currently overloaded'), 'overloaded', 503],
    [httpError(529, 'overloaded_error'), 'overloaded', 529],
    [httpError(429, 'slow down'), 'rate_limited', 429],
    [httpError(408), 'timeout', 408],
    [new Error('OpenAI stream failed 429: rate limit reached'), 'rate_limited', 429],
    [Object.assign(new Error('x'), { status: 503 }), 'server_error', 503],
    [new Error('request timed out'), 'timeout', undefined],
    [Object.assign(new Error('x'), { name: 'TimeoutError' }), 'timeout', undefined],
    [new TypeError('fetch failed', { cause: Object.assign(new Error('connect'), { code: 'ECONNRESET' }) }), 'connection', undefined],
    [new Error('getaddrinfo ENOTFOUND api.example.com'), 'connection', undefined],
    [new Error('The upstream is overloaded, try later'), 'overloaded', undefined]
  ];
  for (const [err, category, status] of cases) {
    const got = classifyModelError(err);
    assert.equal(got.category, category, String(err.message));
    assert.equal(got.upstreamRetryable, true, String(err.message));
    assert.equal(got.status, status, String(err.message));
  }
});

test('classifyModelError: non-retryable classes never qualify', () => {
  const cases = [
    [httpError(401, 'invalid api key'), 'auth'],
    [httpError(403), 'auth'],
    [httpError(400, 'bad param; request timed out in body'), 'bad_request'],
    [httpError(404), 'bad_request'],
    [httpError(413, 'context_length_exceeded'), 'bad_request'],
    [httpError(422), 'bad_request'],
    [httpError(400, 'content_filter: prompt flagged'), 'content_filter'],
    [httpError(400, 'blocked by content policy'), 'content_filter'],
    [new Error('Invalid prompt: moderation flagged'), 'content_filter'],
    [new Error('Session aborted'), 'aborted'],
    [Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }), 'aborted'],
    [Object.assign(new Error('repetition loop aborted: same 40 chars'), { name: 'RepetitionLoopAbortError' }), 'watchdog'],
    [new Error('Missing RAW_AGENT_API_KEY'), 'unknown'],
    [new Error('something odd'), 'unknown']
  ];
  for (const [err, category] of cases) {
    const got = classifyModelError(err);
    assert.equal(got.category, category, String(err.message));
    assert.equal(got.upstreamRetryable, false, String(err.message));
  }
  assert.equal(classifyModelError(undefined).category, 'unknown');
});

test('runWithFallbackChain: retryable error switches in order and traces each switch', async () => {
  const calls = [];
  const traces = [];
  let served;
  const result = await runWithFallbackChain({
    candidates: [cand('a', A), cand('b', B), cand('c', C)],
    emitTrace: (e) => traces.push(e),
    onServed: (s) => {
      served = s;
    },
    invoke: async (adapter) => {
      calls.push(adapter.name);
      if (adapter.name === 'a') throw httpError(503);
      if (adapter.name === 'b') throw new Error('fetch failed ECONNRESET');
      return ok('from-c');
    }
  });
  assert.equal(result.assistantParts[0].text, 'from-c');
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.deepEqual(
    traces.map((t) => [t.kind, t.payload.from, t.payload.to, t.payload.category, t.payload.attempt]),
    [
      ['model_fallback', A, B, 'server_error', 2],
      ['model_fallback', B, C, 'connection', 3]
    ]
  );
  assert.equal(traces[0].payload.status, 503);
  assert.equal(traces[0].payload.totalCandidates, 3);
  assert.deepEqual(served, { ...C, adapter: 'c', fallback: true, attempt: 3 });
});

test('runWithFallbackChain: primary success reports fallback=false and never traces', async () => {
  const traces = [];
  let served;
  await runWithFallbackChain({
    candidates: [cand('a', A), cand('b', B)],
    emitTrace: (e) => traces.push(e),
    onServed: (s) => {
      served = s;
    },
    invoke: async () => ok('fine')
  });
  assert.deepEqual(traces, []);
  assert.deepEqual(served, { ...A, adapter: 'a', fallback: false, attempt: 1 });
});

test('runWithFallbackChain: non-retryable primary errors are rethrown untouched', async () => {
  const errors = [
    httpError(401, 'bad key'),
    httpError(400, 'bad param'),
    httpError(404),
    httpError(400, 'content_filter'),
    Object.assign(new Error('repetition loop aborted: x'), { name: 'RepetitionLoopAbortError' }),
    new Error('Session aborted'),
    new Error('weird')
  ];
  for (const err of errors) {
    const calls = [];
    const traces = [];
    await assert.rejects(
      runWithFallbackChain({
        candidates: [cand('a', A), cand('b', B)],
        emitTrace: (e) => traces.push(e),
        invoke: async (adapter) => {
          calls.push(adapter.name);
          throw err;
        }
      }),
      (thrown) => thrown === err && thrown.fallbackAttempts === undefined
    );
    assert.deepEqual(calls, ['a'], err.message);
    assert.deepEqual(traces, []);
  }
});

test('runWithFallbackChain: exhausted chain throws the FIRST error with attempt summary', async () => {
  const first = httpError(503, 'primary down');
  const traces = [];
  await assert.rejects(
    runWithFallbackChain({
      candidates: [cand('a', A), cand('b', B), cand('c', C)],
      emitTrace: (e) => traces.push(e),
      invoke: async (adapter) => {
        if (adapter.name === 'a') throw first;
        if (adapter.name === 'b') throw httpError(401, 'backup key bad');
        throw httpError(429, 'busy');
      }
    }),
    (thrown) => {
      assert.equal(thrown, first);
      assert.match(thrown.message, /primary down/);
      assert.match(thrown.message, /\[model-fallback\] all 3 models failed/);
      assert.deepEqual(
        thrown.fallbackAttempts.map((a) => [a.attempt, a.category, a.status]),
        [
          [1, 'server_error', 503],
          [2, 'auth', 401],
          [3, 'rate_limited', 429]
        ]
      );
      return true;
    }
  );
  assert.deepEqual(
    traces.map((t) => t.kind),
    ['model_fallback', 'model_fallback', 'model_fallback_exhausted']
  );
  assert.equal(traces[2].payload.attempts.length, 3);
});

test('runWithFallbackChain: abort / watchdog / refusal on a backup stops the chain', async () => {
  for (const stopper of [
    new Error('Session aborted'),
    Object.assign(new Error('repetition loop aborted: y'), { name: 'RepetitionLoopAbortError' }),
    httpError(400, 'content policy violation: content_filter')
  ]) {
    const calls = [];
    await assert.rejects(
      runWithFallbackChain({
        candidates: [cand('a', A), cand('b', B), cand('c', C)],
        invoke: async (adapter) => {
          calls.push(adapter.name);
          if (adapter.name === 'a') throw httpError(502);
          throw stopper;
        }
      }),
      (thrown) => thrown === stopper
    );
    assert.deepEqual(calls, ['a', 'b']);
  }
});

test('runWithFallbackChain: user abort signal stops the chain after a retryable failure', async () => {
  const controller = new AbortController();
  const calls = [];
  const first = httpError(503);
  await assert.rejects(
    runWithFallbackChain({
      candidates: [cand('a', A), cand('b', B)],
      signal: controller.signal,
      invoke: async (adapter) => {
        calls.push(adapter.name);
        controller.abort();
        throw first;
      }
    }),
    (thrown) => thrown === first
  );
  assert.deepEqual(calls, ['a']);
});

test('settings: default empty, PATCH-style write validates against configured models', () => {
  const store = tempStore();
  seedProviders(store);
  assert.deepEqual(readModelFallbackSettings(store).chain, []);
  assert.equal(modelFallbackPayload(store, {}).effective.source, 'default');
  assert.equal(modelFallbackPayload(store, {}).effective.enabled, false);

  const saved = writeModelFallbackSettings(store, { chain: [B, C] }, {});
  assert.deepEqual(saved.chain, [B, C]);
  assert.deepEqual(readModelFallbackSettings(store).chain, [B, C]);
  assert.deepEqual(store.getDaemonControl(MODEL_FALLBACK_SETTINGS_KEY).chain, [B, C]);
  const payload = modelFallbackPayload(store, {});
  assert.equal(payload.effective.source, 'ui');
  assert.equal(payload.effective.enabled, true);
  assert.ok(payload.options.some((o) => o.providerId === 'prov-b'));
  assert.deepEqual(payload.chainStatus.map((c) => c.usable), [true, true]);

  const bad = [
    'nope',
    [{ providerId: 'prov-b' }],
    [{ providerId: 'ghost', modelId: 'beta-1' }],
    [{ providerId: 'prov-b', modelId: 'missing' }],
    [B, B],
    Array.from({ length: 9 }, () => B)
  ];
  for (const chain of bad) {
    assert.throws(() => writeModelFallbackSettings(store, { chain }, {}), ValidationError, JSON.stringify(chain));
  }
  assert.deepEqual(readModelFallbackSettings(store).chain, [B, C]);

  writeModelFallbackSettings(store, { chain: [] }, {});
  assert.deepEqual(readModelFallbackSettings(store).chain, []);
  store.db.close();
});

test('planModelFallback: empty chain is off; order, dedupe against primary, skip + warn once', () => {
  const store = tempStore();
  seedProviders(store, { backupKey: '' });
  const primary = { name: 'primary-adapter' };
  const plan_ = (extra = {}) =>
    planModelFallback({ store, session: { id: 's', metadata: {} }, primary, env: {}, ...extra });

  assert.equal(plan_(), undefined);

  // Bypass API validation to simulate config drift (key removed after saving).
  store.setDaemonControl(MODEL_FALLBACK_SETTINGS_KEY, {
    chain: [A, B, C, { providerId: 'ghost', modelId: 'x' }],
    updatedAt: 'x'
  });
  const warnings = [];
  const warned = new Set();
  const plan = plan_({ warned, warn: (m) => warnings.push(m) });
  assert.deepEqual(
    plan.candidates.map((c) => c.ref),
    [A, C]
  );
  assert.equal(plan.candidates[0].label, 'primary');
  assert.equal(plan.candidates[0].adapter, primary);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /prov-b\/beta-1 skipped: provider is missing apiKey or baseUrl/);
  assert.match(warnings[1], /ghost\/x skipped/);

  plan_({ warned, warn: (m) => warnings.push(m) });
  assert.equal(warnings.length, 2, 'warn only once per entry');

  const status = modelFallbackPayload(store, {}).chainStatus;
  assert.deepEqual(
    status.map((c) => [c.providerId, c.usable, c.issue]),
    [
      ['prov-a', true, undefined],
      ['prov-b', false, 'missing_credentials'],
      ['prov-c', true, undefined],
      ['ghost', false, 'not_configured']
    ]
  );

  store.setDaemonControl(MODEL_FALLBACK_SETTINGS_KEY, { chain: [B], updatedAt: 'x' });
  assert.equal(
    plan_({ warned: new Set(), warn() {} }),
    undefined,
    'no usable backup behaves as feature off'
  );
  store.db.close();
});

test('planModelFallback: modelOverride pin keeps primary and is still protected', () => {
  const store = tempStore();
  seedProviders(store);
  writeModelFallbackSettings(store, { chain: [A, C] }, {});
  const plan = planModelFallback({
    store,
    session: { id: 's', metadata: { modelOverride: B } },
    primary: { name: 'pinned-adapter' },
    env: {}
  });
  assert.deepEqual(
    plan.candidates.map((c) => c.ref),
    [B, A, C]
  );
  store.db.close();
});

test('attachServedByToTrace is one-shot and skips terminal turn_end', () => {
  rememberServedBy('s1', { adapter: 'x', fallback: true, attempt: 2 });
  const terminal = { kind: 'turn_end', payload: { terminal: true } };
  assert.equal(attachServedByToTrace('s1', terminal), terminal);
  const other = { kind: 'turn_start' };
  assert.equal(attachServedByToTrace('s1', other), other);
  const end = attachServedByToTrace('s1', { kind: 'turn_end', payload: { stopReason: 'end' } });
  assert.deepEqual(end.payload.servedBy, { adapter: 'x', fallback: true, attempt: 2 });
  const again = { kind: 'turn_end', payload: { stopReason: 'end' } };
  assert.equal(attachServedByToTrace('s1', again), again);
});

function chatCompletion(text) {
  return JSON.stringify({
    id: 'chatcmpl-test',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }
  });
}

async function upstream(handler) {
  const hits = { count: 0 };
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      hits.count += 1;
      handler(req, res, hits);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { hits, url: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close() };
}

function runtimeForUpstreams(primary, backup) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'model-fb-repo-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'model-fb-state-'));
  const runtime = new RawAgentRuntime({ repoRoot, stateDir });
  upsertProvider(runtime.store, {
    id: 'prov-a',
    name: 'Primary',
    kind: 'openai-compatible',
    baseUrl: primary.url,
    apiKey: 'sk-a',
    useJsonMode: false,
    models: [{ id: 'alpha-1', enabled: true }]
  });
  upsertProvider(runtime.store, {
    id: 'prov-b',
    name: 'Backup',
    kind: 'openai-compatible',
    baseUrl: backup.url,
    apiKey: 'sk-b',
    useJsonMode: false,
    models: [{ id: 'beta-1', enabled: true }]
  });
  setCatalogDefaultRef(runtime.store, A);
  return { runtime };
}

async function withEnv(patch, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(patch)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function traceEvents(runtime, sessionId, kind, min) {
  const count = (events) =>
    events.filter((e) => e.kind === kind && !e.payload?.terminal).length;
  const events = await waitFor(async () => {
    const evs = await runtime.listTraceEvents(sessionId);
    return count(evs) >= min ? evs : null;
  }, { intervalMs: 40 });
  return events ?? runtime.listTraceEvents(sessionId);
}

function lastAssistantText(runtime, sessionId) {
  const msgs = runtime.store.listMessages(sessionId).filter((m) => m.role === 'assistant');
  const last = msgs[msgs.length - 1];
  return (last?.parts ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

test('runtime: upstream 503 falls back within the turn, next turn starts on primary again', async () => {
  const primary = await upstream((_req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end('{"error":"Service Unavailable"}');
  });
  const backup = await upstream((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(chatCompletion('hello from backup'));
  });
  try {
    await withEnv({ RAW_AGENT_MODEL_MAX_RETRIES: '1', RAW_AGENT_STREAM: '0' }, async () => {
      const { runtime } = runtimeForUpstreams(primary, backup);
      writeModelFallbackSettings(runtime.store, { chain: [B] }, {});
      const session = runtime.createChatSession({ title: 'fb', message: 'hi' });
      const pick = (id) => {
        const m = runtime.store.getSession(id).metadata;
        return JSON.stringify({ modelRef: m.modelRef, modelOverride: m.modelOverride });
      };
      const before = pick(session.id);

      await runtime.runSession(session.id);
      assert.equal(lastAssistantText(runtime, session.id), 'hello from backup');
      assert.equal(primary.hits.count, 2, 'primary gets its normal in-adapter retry first');
      assert.equal(backup.hits.count, 1);

      runtime.sendUserMessage(session.id, 'again');
      await runtime.runSession(session.id);
      assert.equal(primary.hits.count, 4, 'next turn must try the primary model first');
      assert.equal(backup.hits.count, 2);
      assert.equal(
        pick(session.id),
        before,
        'session metadata (modelRef) is never rewritten by a fallback'
      );

      const events = await traceEvents(runtime, session.id, 'turn_end', 2);
      const fallbacks = events.filter((e) => e.kind === 'model_fallback');
      assert.equal(fallbacks.length, 2);
      assert.deepEqual(fallbacks[0].payload.from, A);
      assert.deepEqual(fallbacks[0].payload.to, B);
      assert.equal(fallbacks[0].payload.category, 'server_error');
      assert.equal(fallbacks[0].payload.status, 503);
      assert.equal(fallbacks[0].payload.attempt, 2);
      const ends = events.filter((e) => e.kind === 'turn_end' && !e.payload?.terminal);
      assert.ok(ends.length >= 2, JSON.stringify(events.map((e) => [e.kind, e.payload?.terminal, e.payload?.stopReason])));
      for (const end of ends) {
        assert.deepEqual(end.payload.servedBy, { ...B, adapter: 'openai-compatible', fallback: true, attempt: 2 });
        assert.equal(end.payload.stopReason, 'end');
      }
      await runtime.destroy();
    });
  } finally {
    primary.close();
    backup.close();
  }
});

test('runtime: ppeng kernel variant honors the same explicit chain', async () => {
  const primary = await upstream((_req, res) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('bad gateway');
  });
  const backup = await upstream((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(chatCompletion('ppeng backup'));
  });
  try {
    await withEnv({ RAW_AGENT_MODEL_MAX_RETRIES: '1', RAW_AGENT_STREAM: '0' }, async () => {
      const { runtime } = runtimeForUpstreams(primary, backup);
      runtime.store.setDaemonControl('loop_settings', { kernelVariant: 'ppeng' });
      writeModelFallbackSettings(runtime.store, { chain: [B] }, {});
      const session = runtime.createChatSession({ title: 'ppeng', message: 'hi' });
      await runtime.runSession(session.id);
      assert.equal(lastAssistantText(runtime, session.id), 'ppeng backup');
      const events = await traceEvents(runtime, session.id, 'turn_end', 1);
      assert.equal(events.filter((e) => e.kind === 'model_fallback').length, 1);
      const end = events.find((e) => e.kind === 'turn_end' && !e.payload?.terminal);
      assert.equal(end.payload.servedBy.providerId, 'prov-b');
      await runtime.destroy();
    });
  } finally {
    primary.close();
    backup.close();
  }
});

test('runtime: modelOverride-pinned session is protected by the global chain', async () => {
  const pinned = await upstream((_req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('internal server error');
  });
  const backup = await upstream((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(chatCompletion('backup answer'));
  });
  try {
    await withEnv({ RAW_AGENT_MODEL_MAX_RETRIES: '1', RAW_AGENT_STREAM: '0' }, async () => {
      const { runtime } = runtimeForUpstreams(pinned, backup);
      writeModelFallbackSettings(runtime.store, { chain: [B] }, {});
      const session = runtime.createChatSession({
        title: 'pin',
        message: 'hi',
        metadata: { modelOverride: A }
      });
      await runtime.runSession(session.id);
      assert.equal(lastAssistantText(runtime, session.id), 'backup answer');
      assert.deepEqual(runtime.store.getSession(session.id).metadata.modelOverride, A);
      await runtime.destroy();
    });
  } finally {
    pinned.close();
    backup.close();
  }
});

test('runtime: 401 on the primary never falls back; empty chain keeps legacy behavior', async () => {
  const primary = await upstream((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end('{"error":"invalid api key"}');
  });
  const backup = await upstream((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(chatCompletion('should not be used'));
  });
  try {
    await withEnv({ RAW_AGENT_MODEL_MAX_RETRIES: '1', RAW_AGENT_STREAM: '0' }, async () => {
      const { runtime } = runtimeForUpstreams(primary, backup);
      writeModelFallbackSettings(runtime.store, { chain: [B] }, {});
      const session = runtime.createChatSession({ title: 'auth', message: 'hi' });
      await assert.rejects(runtime.runSession(session.id), /401/);
      assert.equal(backup.hits.count, 0);
      const events = await runtime.listTraceEvents(session.id);
      assert.ok(!events.some((e) => e.kind === 'model_fallback'));
      await runtime.destroy();
    });
  } finally {
    primary.close();
    backup.close();
  }
});

test('runtime: chain off -> no model_fallback trace and no servedBy on turn_end', async () => {
  const primary = await upstream((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(chatCompletion('plain primary'));
  });
  const backup = await upstream((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(chatCompletion('unused'));
  });
  try {
    await withEnv({ RAW_AGENT_MODEL_MAX_RETRIES: '1', RAW_AGENT_STREAM: '0' }, async () => {
      const { runtime } = runtimeForUpstreams(primary, backup);
      const session = runtime.createChatSession({ title: 'off', message: 'hi' });
      await runtime.runSession(session.id);
      assert.equal(lastAssistantText(runtime, session.id), 'plain primary');
      const events = await runtime.listTraceEvents(session.id);
      assert.ok(!events.some((e) => e.kind === 'model_fallback' || e.kind === 'model_fallback_exhausted'));
      for (const e of events.filter((x) => x.kind === 'turn_end')) assert.equal(e.payload?.servedBy, undefined);
      await runtime.destroy();
    });
  } finally {
    primary.close();
    backup.close();
  }
});

test('runtime: exhausted chain surfaces the first error with attempt summary', async () => {
  const primary = await upstream((_req, res) => {
    res.writeHead(503, { 'content-type': 'text/plain' });
    res.end('primary unavailable');
  });
  const backup = await upstream((_req, res) => {
    res.writeHead(429, { 'content-type': 'text/plain' });
    res.end('backup rate limited');
  });
  try {
    await withEnv({ RAW_AGENT_MODEL_MAX_RETRIES: '1', RAW_AGENT_STREAM: '0' }, async () => {
      const { runtime } = runtimeForUpstreams(primary, backup);
      writeModelFallbackSettings(runtime.store, { chain: [B] }, {});
      const session = runtime.createChatSession({ title: 'exhaust', message: 'hi' });
      await assert.rejects(runtime.runSession(session.id), (err) => {
        assert.match(err.message, /failed with 503: primary unavailable/);
        assert.match(err.message, /\[model-fallback\] all 2 models failed: #1 prov-a\/alpha-1: server_error\(503\); #2 prov-b\/beta-1: rate_limited\(429\)/);
        return true;
      });
      const events = await traceEvents(runtime, session.id, 'model_fallback_exhausted', 1);
      assert.ok(events.some((e) => e.kind === 'model_fallback_exhausted'));
      await runtime.destroy();
    });
  } finally {
    primary.close();
    backup.close();
  }
});

test('classifyModelError: Responses-API / OpenAI stream faults without a status are upstream outages', () => {
  const cases = [
    new Error('Responses stream error: {"type":"server_error","code":"server_error","message":"oops"}'),
    new Error('The server had an error while processing your request. Sorry about that!'),
    new Error('{"error":{"type":"service_unavailable_error","message":"try later"}}'),
    new Error('Responses stream ended with status=failed'),
    new Error('Responses stream error: internal_server_error')
  ];
  for (const err of cases) {
    const got = classifyModelError(err);
    assert.equal(got.category, 'server_error', err.message);
    assert.equal(got.upstreamRetryable, true, err.message);
  }
  // a 4xx status keeps it a caller error even when the body says status=failed
  const fourxx = classifyModelError(new Error('Remote adapter request failed with 400: Responses stream ended with status=failed'));
  assert.equal(fourxx.category, 'bad_request');
  assert.equal(fourxx.upstreamRetryable, false);
});

test('classifyModelError: outage status beats body keywords; structured signals beat status', () => {
  const beaten = [
    [httpError(503, 'blocked by content policy / moderation'), 'server_error', 503],
    [httpError(503, 'AbortError: upstream dropped'), 'server_error', 503],
    [httpError(502, 'request was aborted by the gateway'), 'server_error', 502],
    [httpError(500, 'repetition loop aborted'), 'server_error', 500],
    [httpError(429, 'content_filter quota moderation'), 'rate_limited', 429],
    [httpError(408, 'operation was aborted'), 'timeout', 408]
  ];
  for (const [err, category, status] of beaten) {
    const got = classifyModelError(err);
    assert.equal(got.category, category, err.message);
    assert.equal(got.status, status, err.message);
    assert.equal(got.upstreamRetryable, true, err.message);
  }

  const structured = [
    [Object.assign(httpError(503, 'x'), { name: 'AbortError' }), 'aborted'],
    [Object.assign(httpError(503, 'x'), { name: 'RepetitionLoopAbortError' }), 'watchdog'],
    [Object.assign(httpError(503, 'x'), { code: 'ABORT_ERR' }), 'aborted'],
    [Object.assign(httpError(503, 'x'), { code: 'content_filter' }), 'content_filter'],
    [new Error('wrapped', { cause: Object.assign(new Error('inner'), { name: 'AbortError' }) }), 'aborted']
  ];
  for (const [err, category] of structured) {
    const got = classifyModelError(err);
    assert.equal(got.category, category, err.message);
    assert.equal(got.upstreamRetryable, false, err.message);
  }
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    classifyModelError(Object.assign(httpError(503, 'x'), { signal: controller.signal })).category,
    'aborted'
  );
  assert.equal(classifyModelError(Object.assign(httpError(503, 'x'), { signal: new AbortController().signal })).category, 'server_error');
});

test('classifyModelError: invalid_request_error / bad request never read as timeout; bare terminated is a connection fault', () => {
  for (const text of [
    '{"error":{"type":"invalid_request_error","message":"timeout param invalid"}}',
    'Bad Request: timeout must be positive',
    'invalid_request_error: rate_limit field is not allowed'
  ]) {
    const got = classifyModelError(new Error(text));
    assert.equal(got.category, 'bad_request', text);
    assert.equal(got.upstreamRetryable, false, text);
  }
  const term = classifyModelError(new TypeError('terminated'));
  assert.equal(term.category, 'connection');
  assert.equal(term.upstreamRetryable, true);
  assert.equal(classifyModelError(new Error('terminated')).category, 'connection');
  assert.equal(classifyModelError(new Error('the job terminated early by admin')).category, 'unknown');
});

test('settings: corrupt KV degrades to an empty chain, warns once, and PATCH overwrites it', () => {
  const store = tempStore();
  seedProviders(store);
  store.db
    .prepare(`INSERT OR REPLACE INTO daemon_control (key, value_json, updated_at) VALUES (?, ?, ?)`)
    .run(MODEL_FALLBACK_SETTINGS_KEY, '{oops', new Date().toISOString());
  assert.doesNotThrow(() => readModelFallbackSettings(store));
  assert.deepEqual(readModelFallbackSettings(store).chain, []);
  assert.equal(planModelFallback({ store, primary: { name: 'p' }, env: {} }), undefined);
  assert.doesNotThrow(() => modelFallbackPayload(store, {}));
  assert.equal(modelFallbackPayload(store, {}).effective.enabled, false);

  const saved = writeModelFallbackSettings(store, { chain: [B] }, {});
  assert.deepEqual(saved.chain, [B]);
  assert.deepEqual(readModelFallbackSettings(store).chain, [B]);

  store.db
    .prepare(`INSERT OR REPLACE INTO daemon_control (key, value_json, updated_at) VALUES (?, ?, ?)`)
    .run(MODEL_FALLBACK_SETTINGS_KEY, '{oops', new Date().toISOString());
  assert.deepEqual(writeModelFallbackSettings(store, {}, {}).chain, [], 'empty patch over a corrupt value writes an empty chain');
  assert.deepEqual(readModelFallbackSettings(store).chain, []);
  store.db.close();
});

test('settings: heuristic models are rejected for the chain and skipped when already persisted', () => {
  const store = tempStore();
  seedProviders(store);
  assert.throws(
    () => writeModelFallbackSettings(store, { chain: [{ providerId: 'heuristic', modelId: 'heuristic' }] }, {}),
    ValidationError
  );
  store.setDaemonControl(MODEL_FALLBACK_SETTINGS_KEY, {
    chain: [{ providerId: 'heuristic', modelId: 'heuristic' }, B],
    updatedAt: new Date().toISOString()
  });
  const warnings = [];
  const plan = planModelFallback({ store, primary: { name: 'p' }, env: {}, warned: new Set(), warn: (m) => warnings.push(m) });
  assert.deepEqual(plan.candidates.map((c) => c.ref), [A, B]);
  assert.equal(warnings.length, 1);
  store.db.close();
});

test('planModelFallback: primary ref is dropped when its provider cannot serve (servedBy names the real adapter)', () => {
  const store = tempStore();
  seedProviders(store);
  upsertProvider(store, {
    id: 'prov-a',
    name: 'Alpha',
    kind: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    models: [{ id: 'alpha-1', enabled: true }]
  });
  writeModelFallbackSettings(store, { chain: [B] }, {});
  const plan = planModelFallback({ store, primary: { name: 'runtime-env' }, env: {} });
  assert.equal(plan.candidates[0].ref, undefined);
  assert.equal(plan.candidates[0].adapter.name, 'runtime-env');
  assert.deepEqual(plan.candidates[1].ref, B);

  const explicit = planModelFallback({ store, primary: { name: 'routed' }, primaryRef: C, env: {} });
  assert.deepEqual(explicit.candidates[0].ref, C);
  const none = planModelFallback({ store, primary: { name: 'routed' }, primaryRef: null, env: {} });
  assert.equal(none.candidates[0].ref, undefined);
  store.db.close();
});

test('runtime: empty chain + mini preset + upstream always 503 -> primary is hit exactly once', async () => {
  const primary = await upstream((_req, res) => {
    res.writeHead(503, { 'content-type': 'text/plain' });
    res.end('Service Unavailable');
  });
  const backup = await upstream((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(chatCompletion('unused'));
  });
  try {
    await withEnv({ RAW_AGENT_STREAM: '0' }, async () => {
      const { runtime } = runtimeForUpstreams(primary, backup);
      runtime.store.setDaemonControl('loop_settings', { assemblyPreset: 'mini' });
      const session = runtime.createChatSession({ title: 'mini-empty', message: 'hi' });
      await assert.rejects(runtime.runSession(session.id), /503/);
      assert.equal(primary.hits.count, 1, 'mini keeps its single call without retries');
      assert.equal(backup.hits.count, 0);
      await runtime.destroy();
    });
  } finally {
    primary.close();
    backup.close();
  }
});

test('runtime: active chain caps stacked retries (primary 2 attempts, each backup 1)', async () => {
  const primary = await upstream((_req, res) => {
    res.writeHead(503, { 'content-type': 'text/plain' });
    res.end('primary down');
  });
  const backup = await upstream((_req, res) => {
    res.writeHead(503, { 'content-type': 'text/plain' });
    res.end('backup down');
  });
  try {
    for (const preset of ['mini', 'max']) {
      await withEnv({ RAW_AGENT_STREAM: '0', RAW_AGENT_MODEL_MAX_RETRIES: '9' }, async () => {
        primary.hits.count = 0;
        backup.hits.count = 0;
        const { runtime } = runtimeForUpstreams(primary, backup);
        runtime.store.setDaemonControl('loop_settings', { assemblyPreset: preset });
        writeModelFallbackSettings(runtime.store, { chain: [B] }, {});
        const session = runtime.createChatSession({ title: `cap-${preset}`, message: 'hi' });
        await assert.rejects(runtime.runSession(session.id), /503/);
        assert.equal(primary.hits.count, 2, `${preset}: primary = 1 retry`);
        assert.equal(backup.hits.count, 1, `${preset}: backup = no retry`);
        await runtime.destroy();
      });
    }
  } finally {
    primary.close();
    backup.close();
  }
});
