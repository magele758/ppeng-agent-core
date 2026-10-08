/**
 * Black-box deploy smoke: probes a running daemon + web console over HTTP.
 *
 * Pure-ish core of `scripts/deploy-smoke.mjs` and the release orchestrator's
 * post-deploy check. Everything network-facing goes through an injectable
 * `fetchImpl` so tests can run without sockets; the summary never contains the
 * auth token.
 */

export const SMOKE_DEFAULTS = Object.freeze({
  startupTimeoutMs: 60_000,
  checkTimeoutMs: 30_000,
  retryIntervalMs: 1_000,
  message: 'deploy smoke ping'
});

export const SMOKE_USAGE = `Usage: node scripts/deploy-smoke.mjs --daemon-url URL [--web-url URL] [options]

Options:
  --daemon-url URL          daemon base URL (env DEPLOY_SMOKE_DAEMON_URL)
  --web-url URL             web console base URL (env DEPLOY_SMOKE_WEB_URL); omit to skip console checks
  --token TOKEN             daemon bearer token (env DEPLOY_SMOKE_TOKEN); enables 401/200 auth checks
  --expect-adapter NAME     fail unless /api/health reports this model adapter (e.g. heuristic)
  --startup-timeout-ms N    retry budget for readiness / console page (default 60000)
  --check-timeout-ms N      per-request timeout (default 30000)
  --message TEXT            chat message to send (default "deploy smoke ping")
  --json-out PATH           also write the JSON summary to PATH
  --help                    show this help

stdout: JSON summary. stderr: human summary. Exit 0 = all checks passed, 1 = a check failed, 2 = usage error.`;

const FLAG_KEYS = {
  '--daemon-url': 'daemonUrl',
  '--web-url': 'webUrl',
  '--token': 'token',
  '--expect-adapter': 'expectAdapter',
  '--startup-timeout-ms': 'startupTimeoutMs',
  '--check-timeout-ms': 'checkTimeoutMs',
  '--message': 'message',
  '--json-out': 'jsonOut'
};

const ENV_KEYS = {
  daemonUrl: 'DEPLOY_SMOKE_DAEMON_URL',
  webUrl: 'DEPLOY_SMOKE_WEB_URL',
  token: 'DEPLOY_SMOKE_TOKEN',
  startupTimeoutMs: 'DEPLOY_SMOKE_STARTUP_TIMEOUT_MS',
  checkTimeoutMs: 'DEPLOY_SMOKE_CHECK_TIMEOUT_MS'
};

const NUMERIC_KEYS = ['startupTimeoutMs', 'checkTimeoutMs'];

export function normalizeBaseUrl(value) {
  const raw = String(value ?? '').trim();
  return raw.replace(/\/+$/, '');
}

function readFlags(argv) {
  const raw = {};
  const errors = [];
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    const eq = arg.indexOf('=');
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const key = FLAG_KEYS[flag];
    if (!key) {
      errors.push(`unknown argument: ${arg}`);
      continue;
    }
    const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined) errors.push(`missing value for ${flag}`);
    else raw[key] = value;
  }
  return { raw, errors, help };
}

function coerceNumber(key, value, errors) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    errors.push(`${key} must be a positive number`);
    return SMOKE_DEFAULTS[key];
  }
  return n;
}

/** CLI flags win over env; env only fills gaps. */
export function parseSmokeArgs(argv = [], env = {}) {
  const { raw, errors, help } = readFlags(argv);
  for (const [key, envName] of Object.entries(ENV_KEYS)) {
    if (raw[key] === undefined && env[envName]?.trim()) raw[key] = env[envName].trim();
  }
  const options = {
    ...SMOKE_DEFAULTS,
    daemonUrl: normalizeBaseUrl(raw.daemonUrl),
    webUrl: normalizeBaseUrl(raw.webUrl),
    token: String(raw.token ?? '').trim(),
    expectAdapter: String(raw.expectAdapter ?? '').trim(),
    message: String(raw.message ?? SMOKE_DEFAULTS.message),
    jsonOut: String(raw.jsonOut ?? '').trim()
  };
  for (const key of NUMERIC_KEYS) {
    if (raw[key] !== undefined) options[key] = coerceNumber(key, raw[key], errors);
  }
  if (!help && !options.daemonUrl) errors.push('--daemon-url (or DEPLOY_SMOKE_DAEMON_URL) is required');
  return { options, errors, help };
}

/** Parse a complete `text/event-stream` body into `{ event, data }` records. */
export function parseSseEvents(text) {
  const events = [];
  for (const block of String(text ?? '').split(/\r?\n\r?\n/)) {
    let event = 'message';
    const dataLines = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (!dataLines.length) continue;
    const rawData = dataLines.join('\n');
    let data = rawData;
    try {
      data = JSON.parse(rawData);
    } catch {
      /* keep raw string */
    }
    events.push({ event, data });
  }
  return events;
}

function errorMessage(error) {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
    return `${error.name === 'TimeoutError' ? 'timeout' : error.message}${cause}`;
  }
  return String(error);
}

/**
 * Run `attempt` until it passes or `timeoutMs` elapses. Only startup probes use
 * this; functional checks run once so a flaky deployment is not masked.
 */
export async function retryUntil(attempt, { timeoutMs, intervalMs, now = Date.now, sleep = defaultSleep }) {
  const deadline = now() + timeoutMs;
  let attempts = 0;
  for (;;) {
    attempts++;
    const result = await safeAttempt(attempt);
    if (result.ok || now() + intervalMs > deadline) return { ...result, attempts };
    await sleep(intervalMs);
  }
}

async function safeAttempt(attempt) {
  try {
    return await attempt();
  } catch (error) {
    return { ok: false, detail: errorMessage(error) };
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(ctx, url, { method = 'GET', headers = {}, body } = {}) {
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(ctx.options.checkTimeoutMs) };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await ctx.fetchImpl(url, init);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', text, json };
}

function bearer(token) {
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Where functional checks go: through the console proxy when present (no token sent), else daemon direct. */
export function apiTarget(options) {
  if (options.webUrl) return { base: options.webUrl, via: 'web', headers: {} };
  return { base: options.daemonUrl, via: 'daemon', headers: bearer(options.token) };
}

function fail(detail) {
  return { ok: false, detail };
}

function pass(detail) {
  return { ok: true, detail };
}

async function checkReadiness(ctx) {
  const r = await request(ctx, `${ctx.options.daemonUrl}/api/readiness`);
  if (r.status === 200 && r.json?.ready === true) return pass('ready');
  return fail(`HTTP ${r.status} ${r.json?.reason ?? r.text.slice(0, 200)}`);
}

async function checkHealth(ctx) {
  const r = await request(ctx, `${ctx.options.daemonUrl}/api/health`);
  if (r.status !== 200 || r.json?.ok !== true) return fail(`HTTP ${r.status} ${r.text.slice(0, 200)}`);
  const adapter = String(r.json.adapter ?? '');
  const expected = ctx.options.expectAdapter;
  if (expected && adapter !== expected) return fail(`adapter=${adapter}, expected ${expected}`);
  return pass(`adapter=${adapter} version=${r.json.version ?? '?'}`);
}

async function checkAuthRequired(ctx) {
  const r = await request(ctx, `${ctx.options.daemonUrl}/api/sessions`);
  if (r.status === 401) return pass('401 without token');
  return fail(`expected 401 without token, got HTTP ${r.status}`);
}

async function checkAuthAccepted(ctx) {
  const r = await request(ctx, `${ctx.options.daemonUrl}/api/sessions`, { headers: bearer(ctx.options.token) });
  if (r.status === 200) return pass('200 with token');
  return fail(`expected 200 with token, got HTTP ${r.status}`);
}

async function checkWebPage(ctx) {
  const r = await request(ctx, `${ctx.options.webUrl}/`);
  if (r.status !== 200) return fail(`HTTP ${r.status}`);
  if (!r.contentType.includes('text/html')) return fail(`content-type ${r.contentType || '(none)'}`);
  return pass(`HTML ${r.text.length} bytes`);
}

async function checkWebProxy(ctx) {
  const r = await request(ctx, `${ctx.options.webUrl}/api/sessions`);
  if (r.status === 200 && Array.isArray(r.json?.sessions)) return pass(`proxied, ${r.json.sessions.length} sessions`);
  return fail(`GET /api/sessions via console: HTTP ${r.status} ${r.text.slice(0, 200)}`);
}

async function checkWebReadinessProxy(ctx) {
  const r = await request(ctx, `${ctx.options.webUrl}/api/readiness`);
  if (r.status === 200 && r.json?.ready === true) return pass('daemon readiness via console proxy');
  return fail(`GET /api/readiness via console: HTTP ${r.status} ${r.text.slice(0, 200)}`);
}

export const REQUIRED_AGENT_ID = 'general';

export function judgeAgents(json) {
  if (!Array.isArray(json?.agents)) return fail('response has no agents array');
  const ids = json.agents.map((a) => a?.id);
  if (!ids.includes(REQUIRED_AGENT_ID)) return fail(`"${REQUIRED_AGENT_ID}" missing (agents: ${ids.join(', ') || 'none'})`);
  return pass(`${ids.length} agents, includes ${REQUIRED_AGENT_ID}`);
}

async function checkAgents(ctx) {
  const target = apiTarget(ctx.options);
  const r = await request(ctx, `${target.base}/api/agents`, { headers: target.headers });
  if (r.status !== 200) return fail(`HTTP ${r.status} ${r.text.slice(0, 200)}`);
  return judgeAgents(r.json);
}

async function checkChat(ctx) {
  const target = apiTarget(ctx.options);
  const r = await request(ctx, `${target.base}/api/sessions`, {
    method: 'POST',
    headers: target.headers,
    body: { title: 'deploy-smoke', message: ctx.options.message }
  });
  const sessionId = r.json?.session?.id;
  if ((r.status !== 201 && r.status !== 200) || !sessionId) return fail(`create session: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  ctx.state.sessionId = sessionId;
  const reply = String(r.json.latestAssistant ?? '').trim();
  if (!reply) return fail(`session ${sessionId}: no assistant reply (status=${r.json.session?.status ?? '?'})`);
  return pass(`session ${sessionId} via ${target.via}, reply ${reply.length} chars`);
}

async function checkSse(ctx) {
  const sessionId = ctx.state.sessionId;
  if (!sessionId) return fail('no session from chat_roundtrip');
  const target = apiTarget(ctx.options);
  const r = await request(ctx, `${target.base}/api/sessions/${encodeURIComponent(sessionId)}/stream`, {
    method: 'POST',
    headers: { ...target.headers, accept: 'text/event-stream' },
    body: { message: `${ctx.options.message} (stream)` }
  });
  if (r.status !== 200) return fail(`HTTP ${r.status} ${r.text.slice(0, 200)}`);
  if (!r.contentType.includes('text/event-stream')) return fail(`content-type ${r.contentType || '(none)'}`);
  return judgeSseEvents(parseSseEvents(r.text));
}

export function judgeSseEvents(events) {
  const errorEvent = events.find((e) => e.event === 'error');
  if (errorEvent) return fail(`error event: ${JSON.stringify(errorEvent.data).slice(0, 200)}`);
  const result = events.find((e) => e.event === 'result');
  if (!result) return fail(`no result event (${events.length} events)`);
  if (!String(result.data?.latestAssistant ?? '').trim()) return fail('result event without assistant text');
  return pass(`${events.length} events, result received`);
}

/** Ordered check plan; `skip` explains why a check does not apply to this target. */
export function planChecks(options) {
  const noToken = options.token ? '' : 'no token configured';
  const noWeb = options.webUrl ? '' : 'no web console URL';
  return [
    { id: 'daemon_readiness', run: checkReadiness, startup: true },
    { id: 'daemon_health', run: checkHealth },
    { id: 'daemon_auth_required', run: checkAuthRequired, skip: noToken },
    { id: 'daemon_auth_token', run: checkAuthAccepted, skip: noToken },
    { id: 'web_page', run: checkWebPage, startup: true, skip: noWeb },
    { id: 'web_readiness_proxy', run: checkWebReadinessProxy, skip: noWeb },
    { id: 'web_api_proxy', run: checkWebProxy, skip: noWeb },
    { id: 'agents_general', run: checkAgents },
    { id: 'chat_roundtrip', run: checkChat },
    { id: 'sse_stream', run: checkSse }
  ];
}

async function runOne(check, ctx) {
  if (check.skip) return { id: check.id, status: 'skip', detail: check.skip, durationMs: 0, attempts: 0 };
  const started = ctx.now();
  const result = check.startup
    ? await retryUntil(() => check.run(ctx), {
      timeoutMs: ctx.options.startupTimeoutMs,
      intervalMs: ctx.options.retryIntervalMs,
      now: ctx.now,
      sleep: ctx.sleep
    })
    : { ...(await safeAttempt(() => check.run(ctx))), attempts: 1 };
  return {
    id: check.id,
    status: result.ok ? 'pass' : 'fail',
    detail: result.detail,
    durationMs: ctx.now() - started,
    attempts: result.attempts
  };
}

export async function runDeploySmoke(options, { fetchImpl = globalThis.fetch, now = Date.now, sleep = defaultSleep } = {}) {
  const opts = { ...SMOKE_DEFAULTS, ...options };
  const ctx = { options: opts, fetchImpl, now, sleep, state: {} };
  const startedAt = new Date(now()).toISOString();
  const started = now();
  const checks = [];
  for (const check of planChecks(opts)) checks.push(await runOne(check, ctx));
  return summarize(checks, {
    startedAt,
    durationMs: now() - started,
    target: {
      daemonUrl: opts.daemonUrl,
      webUrl: opts.webUrl || null,
      apiVia: apiTarget(opts).via,
      authConfigured: Boolean(opts.token)
    }
  });
}

export function summarize(checks, meta = {}) {
  const counts = { passed: 0, failed: 0, skipped: 0 };
  for (const c of checks) {
    if (c.status === 'pass') counts.passed++;
    else if (c.status === 'fail') counts.failed++;
    else counts.skipped++;
  }
  return {
    ok: counts.failed === 0 && counts.passed > 0,
    ...meta,
    counts,
    failedChecks: checks.filter((c) => c.status === 'fail').map((c) => c.id),
    checks
  };
}

const STATUS_MARK = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' };

export function formatHuman(summary) {
  const lines = [`deploy-smoke: ${summary.ok ? 'OK' : 'FAILED'} (${summary.counts.passed} passed, ${summary.counts.failed} failed, ${summary.counts.skipped} skipped)`];
  if (summary.target) {
    lines.push(`  daemon=${summary.target.daemonUrl} web=${summary.target.webUrl ?? '-'} api-via=${summary.target.apiVia} auth=${summary.target.authConfigured ? 'on' : 'off'}`);
  }
  for (const c of summary.checks) {
    const retry = c.attempts > 1 ? `, ${c.attempts} attempts` : '';
    lines.push(`  [${STATUS_MARK[c.status]}] ${c.id} — ${c.detail} (${c.durationMs}ms${retry})`);
  }
  return lines.join('\n');
}

function mdCell(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function formatMarkdown(summary, title = 'Deploy smoke') {
  const lines = [
    `### ${title}: ${summary.ok ? 'passed' : 'FAILED'}`,
    '',
    `${summary.counts.passed} passed, ${summary.counts.failed} failed, ${summary.counts.skipped} skipped`,
    '',
    '| Check | Result | Detail |',
    '|---|---|---|'
  ];
  for (const c of summary.checks) lines.push(`| \`${c.id}\` | ${STATUS_MARK[c.status]} | ${mdCell(c.detail)} |`);
  lines.push('');
  return lines.join('\n');
}
