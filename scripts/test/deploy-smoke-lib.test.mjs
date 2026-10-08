import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SMOKE_DEFAULTS,
  apiTarget,
  formatHuman,
  formatMarkdown,
  judgeAgents,
  judgeSseEvents,
  normalizeBaseUrl,
  parseSmokeArgs,
  parseSseEvents,
  planChecks,
  retryUntil,
  runDeploySmoke,
  summarize
} from '../lib/deploy-smoke-lib.mjs';

const DAEMON = 'http://daemon.test';
const WEB = 'http://web.test';
const TOKEN = 'tok-123';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function sse(events) {
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

/** Healthy deployment with token auth; `overrides[key]` replaces a route (key = "METHOD url"). */
function fakeDeployment(overrides = {}) {
  const calls = [];
  const routes = {
    [`GET ${DAEMON}/api/readiness`]: () => jsonResponse(200, { ready: true }),
    [`GET ${DAEMON}/api/health`]: () => jsonResponse(200, { ok: true, adapter: 'heuristic', version: '1.0.0' }),
    [`GET ${DAEMON}/api/sessions`]: (init) =>
      init.headers.authorization === `Bearer ${TOKEN}` ? jsonResponse(200, { sessions: [] }) : jsonResponse(401, { error: 'Unauthorized' }),
    [`GET ${WEB}/`]: () => new Response('<html>lab</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
    [`GET ${WEB}/api/sessions`]: () => jsonResponse(200, { sessions: [{ id: 'a' }] }),
    [`GET ${WEB}/api/readiness`]: () => jsonResponse(200, { ready: true }),
    [`GET ${WEB}/api/agents`]: () => jsonResponse(200, { agents: [{ id: 'general' }, { id: 'main' }] }),
    [`GET ${DAEMON}/api/agents`]: (init) =>
      init.headers.authorization === `Bearer ${TOKEN}` ? jsonResponse(200, { agents: [{ id: 'general' }] }) : jsonResponse(401, {}),
    [`POST ${WEB}/api/sessions`]: () => jsonResponse(201, { session: { id: 'sess_1', status: 'idle' }, latestAssistant: 'hello' }),
    [`POST ${WEB}/api/sessions/sess_1/stream`]: () => sse([['model', { type: 'text_delta' }], ['result', { latestAssistant: 'hi again' }]]),
    [`POST ${DAEMON}/api/sessions`]: (init) =>
      init.headers.authorization === `Bearer ${TOKEN}`
        ? jsonResponse(201, { session: { id: 'sess_1' }, latestAssistant: 'hello' })
        : jsonResponse(401, {}),
    [`POST ${DAEMON}/api/sessions/sess_1/stream`]: () => sse([['result', { latestAssistant: 'x' }]]),
    ...overrides
  };
  const fetchImpl = async (url, init = {}) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    calls.push({ key, init });
    const route = routes[key];
    if (!route) throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
    return route(init);
  };
  return { fetchImpl, calls };
}

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

const baseOptions = { daemonUrl: DAEMON, webUrl: WEB, token: TOKEN, startupTimeoutMs: 3000, retryIntervalMs: 1000 };

test('parseSmokeArgs: flags win over env, env fills gaps, urls normalized', () => {
  const { options, errors } = parseSmokeArgs(
    ['--daemon-url', 'http://d:1/', '--web-url=http://w:2//', '--startup-timeout-ms', '500'],
    { DEPLOY_SMOKE_DAEMON_URL: 'http://ignored', DEPLOY_SMOKE_TOKEN: ' secret ', DEPLOY_SMOKE_CHECK_TIMEOUT_MS: '700' }
  );
  assert.deepEqual(errors, []);
  assert.equal(options.daemonUrl, 'http://d:1');
  assert.equal(options.webUrl, 'http://w:2');
  assert.equal(options.token, 'secret');
  assert.equal(options.startupTimeoutMs, 500);
  assert.equal(options.checkTimeoutMs, 700);
  assert.equal(options.message, SMOKE_DEFAULTS.message);
});

test('parseSmokeArgs: reports usage errors', () => {
  const { errors } = parseSmokeArgs(['--bogus', '--check-timeout-ms', 'abc', '--token'], {});
  assert.ok(errors.some((e) => e.includes('unknown argument: --bogus')));
  assert.ok(errors.some((e) => e.includes('checkTimeoutMs must be a positive number')));
  assert.ok(errors.some((e) => e.includes('missing value for --token')));
  assert.ok(errors.some((e) => e.includes('--daemon-url')));
});

test('parseSmokeArgs: --help skips required-url validation', () => {
  const { help, errors } = parseSmokeArgs(['--help'], {});
  assert.equal(help, true);
  assert.deepEqual(errors, []);
});

test('normalizeBaseUrl trims whitespace and trailing slashes', () => {
  assert.equal(normalizeBaseUrl(' http://x/// '), 'http://x');
  assert.equal(normalizeBaseUrl(undefined), '');
});

test('parseSseEvents: multiple events, JSON + raw data, default event name', () => {
  const events = parseSseEvents('event: model\ndata: {"a":1}\n\ndata: plain\n\n: comment only\n\nevent: result\r\ndata: {"latestAssistant":"ok"}\r\n\r\n');
  assert.deepEqual(events, [
    { event: 'model', data: { a: 1 } },
    { event: 'message', data: 'plain' },
    { event: 'result', data: { latestAssistant: 'ok' } }
  ]);
});

test('judgeSseEvents: error event, missing result, empty reply, success', () => {
  assert.equal(judgeSseEvents([{ event: 'error', data: { message: 'boom' } }]).ok, false);
  assert.match(judgeSseEvents([{ event: 'model', data: {} }]).detail, /no result event/);
  assert.match(judgeSseEvents([{ event: 'result', data: { latestAssistant: '  ' } }]).detail, /without assistant/);
  assert.equal(judgeSseEvents([{ event: 'result', data: { latestAssistant: 'hi' } }]).ok, true);
});

test('retryUntil retries until success within budget', async () => {
  const clock = fakeClock();
  let n = 0;
  const r = await retryUntil(async () => (++n >= 3 ? { ok: true, detail: 'up' } : { ok: false, detail: 'down' }), {
    timeoutMs: 10_000, intervalMs: 1000, ...clock
  });
  assert.deepEqual(r, { ok: true, detail: 'up', attempts: 3 });
});

test('retryUntil gives up after timeout and reports thrown errors', async () => {
  const clock = fakeClock();
  const r = await retryUntil(async () => { throw new Error('ECONNREFUSED'); }, { timeoutMs: 2500, intervalMs: 1000, ...clock });
  assert.equal(r.ok, false);
  assert.equal(r.detail, 'ECONNREFUSED');
  assert.equal(r.attempts, 3);
});

test('planChecks skips auth checks without token and console checks without web url', () => {
  const plan = planChecks({ daemonUrl: DAEMON, webUrl: '', token: '' });
  const skipped = plan.filter((c) => c.skip).map((c) => c.id);
  assert.deepEqual(skipped, ['daemon_auth_required', 'daemon_auth_token', 'web_page', 'web_readiness_proxy', 'web_api_proxy']);
});

test('apiTarget routes through the console without sending the token', () => {
  assert.deepEqual(apiTarget({ daemonUrl: DAEMON, webUrl: WEB, token: TOKEN }), { base: WEB, via: 'web', headers: {} });
  assert.deepEqual(apiTarget({ daemonUrl: DAEMON, webUrl: '', token: TOKEN }), {
    base: DAEMON, via: 'daemon', headers: { authorization: `Bearer ${TOKEN}` }
  });
});

test('runDeploySmoke: healthy deployment passes every check', async () => {
  const { fetchImpl, calls } = fakeDeployment();
  const summary = await runDeploySmoke({ ...baseOptions, expectAdapter: 'heuristic' }, { fetchImpl, ...fakeClock() });
  assert.equal(summary.ok, true, formatHuman(summary));
  assert.deepEqual(summary.counts, { passed: 10, failed: 0, skipped: 0 });
  assert.equal(summary.target.apiVia, 'web');
  assert.equal(JSON.stringify(summary).includes(TOKEN), false, 'summary must not leak the token');
  const webCalls = calls.filter((c) => c.key.includes(WEB));
  assert.ok(webCalls.every((c) => !c.init.headers.authorization), 'console requests rely on proxy token injection');
});

test('runDeploySmoke: daemon-only target uses bearer and skips console checks', async () => {
  const { fetchImpl } = fakeDeployment();
  const summary = await runDeploySmoke({ ...baseOptions, webUrl: '' }, { fetchImpl, ...fakeClock() });
  assert.equal(summary.ok, true, formatHuman(summary));
  assert.deepEqual(summary.counts, { passed: 7, failed: 0, skipped: 3 });
});

test('judgeAgents: missing array, missing general, success', () => {
  assert.match(judgeAgents({}).detail, /no agents array/);
  assert.match(judgeAgents({ agents: [] }).detail, /"general" missing \(agents: none\)/);
  assert.match(judgeAgents({ agents: [{ id: 'main' }, null] }).detail, /missing \(agents: main, \)/);
  assert.deepEqual(judgeAgents({ agents: [{ id: 'general' }] }), { ok: true, detail: '1 agents, includes general' });
});

test('runDeploySmoke: console readiness proxy and agents list failures', async () => {
  const { fetchImpl } = fakeDeployment({
    [`GET ${WEB}/api/readiness`]: () => new Response('Bad Gateway', { status: 502 }),
    [`GET ${WEB}/api/agents`]: () => jsonResponse(200, { agents: [{ id: 'main' }] })
  });
  const summary = await runDeploySmoke(baseOptions, { fetchImpl, ...fakeClock() });
  assert.deepEqual(summary.failedChecks, ['web_readiness_proxy', 'agents_general']);
  const byId = Object.fromEntries(summary.checks.map((c) => [c.id, c]));
  assert.match(byId.web_readiness_proxy.detail, /HTTP 502 Bad Gateway/);
  assert.match(byId.agents_general.detail, /"general" missing \(agents: main\)/);

  const down = fakeDeployment({ [`GET ${WEB}/api/agents`]: () => jsonResponse(500, { error: 'x' }) });
  const s = await runDeploySmoke(baseOptions, { fetchImpl: down.fetchImpl, ...fakeClock() });
  assert.match(s.checks.find((c) => c.id === 'agents_general').detail, /HTTP 500/);
});

test('runDeploySmoke: open daemon (auth not enforced) fails the 401 check', async () => {
  const { fetchImpl } = fakeDeployment({ [`GET ${DAEMON}/api/sessions`]: () => jsonResponse(200, { sessions: [] }) });
  const summary = await runDeploySmoke(baseOptions, { fetchImpl, ...fakeClock() });
  assert.equal(summary.ok, false);
  assert.deepEqual(summary.failedChecks, ['daemon_auth_required']);
});

test('runDeploySmoke: wrong token fails the 200 check', async () => {
  const { fetchImpl } = fakeDeployment();
  const summary = await runDeploySmoke({ ...baseOptions, token: 'wrong' }, { fetchImpl, ...fakeClock() });
  assert.deepEqual(summary.failedChecks, ['daemon_auth_token']);
});

test('runDeploySmoke: daemon down retries startup probe then fails everything daemon-backed', async () => {
  const { fetchImpl, calls } = fakeDeployment({
    [`GET ${DAEMON}/api/readiness`]: undefined,
    [`GET ${DAEMON}/api/health`]: undefined,
    [`GET ${DAEMON}/api/sessions`]: undefined,
    [`GET ${WEB}/api/sessions`]: () => jsonResponse(502, { error: 'daemon unreachable' }),
    [`GET ${WEB}/api/readiness`]: () => jsonResponse(502, { error: 'daemon unreachable' }),
    [`GET ${WEB}/api/agents`]: () => jsonResponse(502, { error: 'daemon unreachable' }),
    [`POST ${WEB}/api/sessions`]: () => jsonResponse(502, { error: 'daemon unreachable' })
  });
  const summary = await runDeploySmoke(baseOptions, { fetchImpl, ...fakeClock() });
  assert.equal(summary.ok, false);
  assert.deepEqual(summary.failedChecks, [
    'daemon_readiness', 'daemon_health', 'daemon_auth_required', 'daemon_auth_token',
    'web_readiness_proxy', 'web_api_proxy', 'agents_general', 'chat_roundtrip', 'sse_stream'
  ]);
  const readiness = summary.checks.find((c) => c.id === 'daemon_readiness');
  assert.equal(readiness.attempts, 4, 'attempts at t=0,1s,2s,3s within the 3s startup budget');
  assert.match(readiness.detail, /fetch failed: ECONNREFUSED/);
  assert.equal(calls.filter((c) => c.key === `GET ${DAEMON}/api/health`).length, 1, 'non-startup checks are not retried');
  assert.match(summary.checks.find((c) => c.id === 'sse_stream').detail, /no session/);
});

test('runDeploySmoke: readiness 400, wrong adapter, non-html page, empty reply, sse error', async () => {
  const { fetchImpl } = fakeDeployment({
    [`GET ${DAEMON}/api/readiness`]: () => jsonResponse(400, { ready: false, reason: 'stateDir not writable' }),
    [`GET ${WEB}/`]: () => jsonResponse(200, {}),
    [`POST ${WEB}/api/sessions`]: () => jsonResponse(201, { session: { id: 'sess_1', status: 'failed' }, latestAssistant: '' }),
    [`POST ${WEB}/api/sessions/sess_1/stream`]: () => sse([['error', { message: 'model down' }]])
  });
  const summary = await runDeploySmoke({ ...baseOptions, expectAdapter: 'openai' }, { fetchImpl, ...fakeClock() });
  const byId = Object.fromEntries(summary.checks.map((c) => [c.id, c]));
  assert.match(byId.daemon_readiness.detail, /HTTP 400 stateDir not writable/);
  assert.match(byId.daemon_health.detail, /adapter=heuristic, expected openai/);
  assert.match(byId.web_page.detail, /content-type application\/json/);
  assert.match(byId.chat_roundtrip.detail, /no assistant reply \(status=failed\)/);
  assert.match(byId.sse_stream.detail, /error event/);
});

test('runDeploySmoke: stream endpoint not SSE / bad status / bad session create', async () => {
  const notSse = fakeDeployment({ [`POST ${WEB}/api/sessions/sess_1/stream`]: () => jsonResponse(200, {}) });
  let s = await runDeploySmoke(baseOptions, { fetchImpl: notSse.fetchImpl, ...fakeClock() });
  assert.match(s.checks.find((c) => c.id === 'sse_stream').detail, /content-type application\/json/);

  const badStatus = fakeDeployment({
    [`POST ${WEB}/api/sessions/sess_1/stream`]: () => new Response('nope', { status: 500 }),
    [`GET ${WEB}/`]: () => new Response('', { status: 503 })
  });
  s = await runDeploySmoke({ ...baseOptions, startupTimeoutMs: 1 }, { fetchImpl: badStatus.fetchImpl, ...fakeClock() });
  assert.match(s.checks.find((c) => c.id === 'sse_stream').detail, /HTTP 500 nope/);
  assert.match(s.checks.find((c) => c.id === 'web_page').detail, /HTTP 503/);

  const badCreate = fakeDeployment({ [`POST ${WEB}/api/sessions`]: () => new Response('not json', { status: 500 }) });
  s = await runDeploySmoke(baseOptions, { fetchImpl: badCreate.fetchImpl, ...fakeClock() });
  assert.match(s.checks.find((c) => c.id === 'chat_roundtrip').detail, /create session: HTTP 500/);
});

test('runDeploySmoke: per-request timeout surfaces as "timeout"', async () => {
  const fetchImpl = async (_url, init) => {
    await new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  };
  // AbortSignal.timeout timers are unref'd; keep the loop alive while they fire.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const summary = await runDeploySmoke(
      { daemonUrl: DAEMON, checkTimeoutMs: 20, startupTimeoutMs: 1 },
      { fetchImpl, ...fakeClock() }
    );
    assert.equal(summary.checks[0].detail, 'timeout');
  } finally {
    clearInterval(keepAlive);
  }
});

test('summarize: all-skipped is not ok; formatters render every check', () => {
  assert.equal(summarize([{ id: 'a', status: 'skip', detail: '-' }]).ok, false);
  const summary = summarize(
    [
      { id: 'a', status: 'pass', detail: 'fine', durationMs: 1, attempts: 2 },
      { id: 'b', status: 'fail', detail: 'bad | pipe\nline', durationMs: 2, attempts: 1 }
    ],
    { target: { daemonUrl: DAEMON, webUrl: null, apiVia: 'daemon', authConfigured: false } }
  );
  const human = formatHuman(summary);
  assert.match(human, /FAILED \(1 passed, 1 failed, 0 skipped\)/);
  assert.match(human, /\[PASS\] a — fine \(1ms, 2 attempts\)/);
  assert.match(human, /web=- api-via=daemon auth=off/);
  const md = formatMarkdown(summary, 'Smoke X');
  assert.match(md, /### Smoke X: FAILED/);
  assert.match(md, /\| `b` \| FAIL \| bad \\\| pipe line \|/);
  assert.match(formatMarkdown(summarize([{ id: 'a', status: 'pass', detail: '' }])), /passed/);
});
