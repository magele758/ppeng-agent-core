/**
 * POST /api/chat/stream: a client that disconnects mid-stream cancels the run and
 * the upstream model request (replayed by a slow fake OpenAI-compatible server).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANONYMOUS_AUTH, RawAgentRuntime } from '@ppeng/agent-core';
import { setCatalogDefaultRef, upsertProvider } from '../../packages/core/dist/model/provider-catalog.js';
import { replayApiKey, startReplayServer } from '../../packages/agent-loop/dist/testing/upstream-replay.js';
import { sessionsRoutes } from '../../apps/daemon/dist/routes/sessions.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chatChunk(content, finish = null) {
  return { data: { id: 'chatcmpl-Sse', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content }, finish_reason: finish }] } };
}

/** 30 tokens, 100 ms apart: ~3 s if nobody hangs up. */
const slowAnswer = {
  status: 200,
  delayMs: 100,
  events: [...Array.from({ length: 30 }, (_, i) => chatChunk(`tok${i} `)), chatChunk('', 'stop'), { data: '[DONE]' }]
};

async function setup(responses) {
  const upstream = await startReplayServer(responses);
  const runtime = new RawAgentRuntime({
    repoRoot: mkdtempSync(join(tmpdir(), 'sse-dc-repo-')),
    stateDir: mkdtempSync(join(tmpdir(), 'sse-dc-state-'))
  });
  upsertProvider(runtime.store, {
    id: 'replay',
    name: 'replay',
    kind: 'openai-compatible',
    baseUrl: upstream.baseUrl,
    apiKey: replayApiKey(),
    useJsonMode: false,
    models: [{ id: 'replay-model', enabled: true }]
  });
  setCatalogDefaultRef(runtime.store, { providerId: 'replay', modelId: 'replay-model' });

  const route = sessionsRoutes(runtime).find((r) => r.method === 'POST' && r.pattern === '/api/chat/stream');
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (piece) => (raw += piece));
    request.on('end', () => {
      void route.handler({
        request,
        response,
        url: new URL(`http://x${request.url}`),
        parts: [],
        params: {},
        requireParam: () => '',
        readBody: async () => JSON.parse(raw),
        auth: ANONYMOUS_AUTH
      });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/chat/stream`;
  const close = async () => {
    await runtime.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await upstream.close();
  };
  return { upstream, runtime, url, close };
}

function postChat(url, title, signal) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, message: 'hi' }),
    signal
  });
}

async function waitFor(predicate, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await predicate()) return true;
    await sleep(25);
  }
  return false;
}

function sessionByTitle(runtime, title) {
  return runtime.store.listSessions().find((s) => s.title === title);
}

test('client disconnect mid-stream cancels the run and aborts the upstream request [AC:chat-basics#AC-5]', async () => {
  const env = await setup([slowAnswer]);
  try {
    const ac = new AbortController();
    const res = await postChat(env.url, 'sse-dc', ac.signal);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let seen = '';
    while (!seen.includes('event: model')) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += dec.decode(value);
    }
    assert.match(seen, /tok0/);
    const disconnectedAt = Date.now();
    ac.abort();

    assert.ok(await waitFor(() => env.upstream.abandoned() === 1), 'upstream request was abandoned');
    assert.ok(Date.now() - disconnectedAt < 2000, 'upstream aborted promptly, not after the full answer');
    const session = sessionByTitle(env.runtime, 'sse-dc');
    assert.ok(await waitFor(() => env.runtime.getSession(session.id).status !== 'running'));
    const kinds = (await env.runtime.listTraceEvents(session.id)).map((e) => e.kind);
    assert.ok(kinds.includes('cancel'), `cancel traced (got ${kinds.join(',')})`);
    assert.equal(env.upstream.requests.length, 1, 'cancelled run is not retried');
  } finally {
    await env.close();
  }
});

test('a stream that completes normally is not cancelled when the response closes', async () => {
  const env = await setup([{ ...slowAnswer, delayMs: 0 }]);
  try {
    const text = await (await postChat(env.url, 'sse-full')).text();
    assert.match(text, /event: result/);
    const session = sessionByTitle(env.runtime, 'sse-full');
    await sleep(50);
    const kinds = (await env.runtime.listTraceEvents(session.id)).map((e) => e.kind);
    assert.ok(!kinds.includes('cancel'));
    assert.equal(env.upstream.abandoned(), 0);
    assert.match(env.runtime.getLatestAssistantText(session.id), /tok29/);
  } finally {
    await env.close();
  }
});

test('the reply reaches the client token by token before the final result, and is saved [AC:chat-basics#AC-2]', async () => {
  const env = await setup([{ ...slowAnswer, delayMs: 20 }]);
  try {
    const res = await postChat(env.url, 'sse-progressive');
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let firstDeltaBeforeResult = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      if (!firstDeltaBeforeResult && buf.includes('"type":"text_delta"')) {
        firstDeltaBeforeResult = !buf.includes('event: result');
      }
    }
    assert.ok(firstDeltaBeforeResult, 'text arrived before the run finished');
    const deltas = buf.match(/"type":"text_delta"/g) ?? [];
    assert.ok(deltas.length >= 10, `expected many deltas, got ${deltas.length}`);
    assert.match(buf, /event: result/);
    const session = sessionByTitle(env.runtime, 'sse-progressive');
    assert.match(env.runtime.getLatestAssistantText(session.id), /tok0 [\s\S]*tok29/);
  } finally {
    await env.close();
  }
});

test('a caller that only joins an in-flight run cannot cancel it by aborting [AC:chat-basics#AC-5]', async () => {
  const env = await setup([{ ...slowAnswer, delayMs: 20 }]);
  try {
    const session = env.runtime.createChatSession({ title: 'joined', message: 'hi' });
    const owner = env.runtime.runSession(session.id, { onModelStreamChunk: () => undefined });
    const ac = new AbortController();
    const joined = env.runtime.runSession(session.id, { signal: ac.signal });
    ac.abort();
    await Promise.all([owner, joined]);
    assert.equal(env.upstream.abandoned(), 0);
    assert.match(env.runtime.getLatestAssistantText(session.id), /tok29/);
  } finally {
    await env.close();
  }
});
