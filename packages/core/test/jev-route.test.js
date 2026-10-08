import test from 'node:test';
import assert from 'node:assert/strict';
import { applyJevRoute } from '../dist/jev/apply.js';
import { writeJevSettings } from '../dist/jev/settings.js';

function storeWith(points, baseUrl = 'https://jev.invalid/predict') {
  const kv = new Map();
  const store = { getDaemonControl: (key) => kv.get(key), setDaemonControl: (key, value) => kv.set(key, value) };
  writeJevSettings(store, { baseUrl, profile: 'custom', points });
  return store;
}

function response(scores) {
  return new Response(JSON.stringify({ answers: Object.fromEntries(
    Object.entries(scores).map(([id, noul]) => [id, { noul }])
  ) }), { status: 200 });
}

test('Jev route: disabled point or missing entry never sends a request', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected fetch'); });
  for (const store of [storeWith({ route: false }), storeWith({ route: true }, '')]) {
    assert.deepEqual(await applyJevRoute(store, { state: 'task' }), { kind: 'noop' });
  }
  assert.equal(fetch.mock.callCount(), 0);
});

const decisions = [
  { name: 'retry takes priority over need_tools and done', scores: { retry: 0.9, need_tools: 0.95, done: 0.99 }, kind: 'continue', reason: 'retry' },
  { name: 'need_tools takes priority over done', scores: { retry: 0.1, need_tools: 0.8, done: 0.99 }, kind: 'continue', reason: 'need_tools' },
  { name: 'retry threshold is inclusive', scores: { retry: 0.75 }, kind: 'continue', reason: 'retry' },
  { name: 'need_tools threshold is inclusive', scores: { need_tools: 0.75 }, kind: 'continue', reason: 'need_tools' },
  { name: 'done threshold is inclusive', scores: { done: 0.75 }, kind: 'done', reason: 'done' },
  { name: 'below threshold keeps the existing path', scores: { retry: 0.749, need_tools: 0.749, done: 0.749 }, kind: 'noop' },
  { name: 'empty answers keep the existing path', scores: {}, kind: 'noop' },
  { name: 'non-number answers keep the existing path', scores: { retry: '0.99', need_tools: null, done: true }, kind: 'noop' }
];

for (const row of decisions) {
  test(`Jev route: ${row.name}`, async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => response(row.scores));
    const got = await applyJevRoute(storeWith({ route: true }), { state: 'task' });
    assert.equal(got.kind, row.kind);
    if (row.reason) assert.match(got.reason, new RegExp(`^jev-route ${row.reason} noul `));
    else assert.deepEqual(got, { kind: 'noop' });
    assert.equal(fetch.mock.callCount(), 1);
  });
}

test('Jev route: active goalGate owns completion, but does not suppress continue signals', async (t) => {
  const store = storeWith({ route: true, goalGate: true });
  let scores = { done: 0.99 };
  t.mock.method(globalThis, 'fetch', async () => response(scores));
  assert.deepEqual(await applyJevRoute(store, { state: 'task' }), { kind: 'noop' });
  scores = { done: 0.99, need_tools: 0.8 };
  assert.equal((await applyJevRoute(store, { state: 'task' })).kind, 'continue');
});

for (const failure of ['http', 'network', 'json', 'abort']) {
  test(`Jev route: ${failure} failure falls back without retrying or claiming completion`, async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
      if (failure === 'http') return new Response('unavailable', { status: 503 });
      if (failure === 'json') return new Response('{broken', { status: 200 });
      throw failure === 'abort' ? new DOMException('cancelled', 'AbortError') : new Error('offline');
    });
    assert.deepEqual(await applyJevRoute(storeWith({ route: true }), { state: 'task' }), { kind: 'noop' });
    assert.equal(fetch.mock.callCount(), 1);
  });
}

test('Jev route: forwards the caller signal and bounds the snapshot sent upstream', async (t) => {
  const signal = new AbortController().signal;
  const fetch = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://jev.invalid/predict');
    assert.equal(init.signal, signal);
    const body = JSON.parse(init.body);
    assert.equal(body.state.length, 12_000);
    assert.deepEqual(Object.keys(body.questions), ['need_tools', 'done', 'retry']);
    return response({ done: 0.9 });
  });
  assert.equal((await applyJevRoute(storeWith({ route: true }), { state: 'x'.repeat(20_000), signal })).kind, 'done');
  assert.equal(fetch.mock.callCount(), 1);
});
