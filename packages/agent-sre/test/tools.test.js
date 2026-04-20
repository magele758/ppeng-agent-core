/**
 * SRE tool unit tests. We mock global fetch so the tools never touch the
 * network — assertions focus on URL shape, header wiring, and friendly
 * error reporting when env vars are missing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  promQueryTool,
  lokiQueryTool,
  pagerDutyListTool,
  k8sGetTool,
  sreBundle,
} from '../dist/index.js';

function withFetchMock(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = new Headers(init?.headers ?? {});
    calls.push({ url, headers });
    const body = handler(url, init) ?? '{"ok":true}';
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return {
    calls,
    restore: () => { globalThis.fetch = original; },
  };
}

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

const ctx = { repoRoot: '/tmp', stateDir: '/tmp', agent: { id: 'a' }, session: { id: 's' } };

test('sreBundle exposes 4 tools and 2 agents', () => {
  assert.deepEqual(
    sreBundle.tools.map((t) => t.name).sort(),
    ['k8s_get', 'loki_query', 'pagerduty_list', 'prom_query']
  );
  assert.deepEqual(
    sreBundle.agents.map((a) => a.id).sort(),
    ['sre-oncall', 'sre-postmortem']
  );
  assert.equal(sreBundle.id, 'sre');
});

test('prom_query: friendly error when SRE_PROM_URL missing', async () => {
  await withEnv({ SRE_PROM_URL: undefined }, async () => {
    const r = await promQueryTool.execute(ctx, { query: 'up' });
    assert.equal(r.ok, false);
    assert.match(r.content, /SRE_PROM_URL/);
  });
});

test('prom_query: instant query hits /api/v1/query', async () => {
  const mock = withFetchMock(() => '{"data":[]}');
  try {
    const r = await promQueryTool.execute(ctx, { query: 'up', base_url: 'http://prom.test/' });
    assert.equal(r.ok, true);
    assert.equal(mock.calls.length, 1);
    assert.match(mock.calls[0].url, /\/api\/v1\/query\?query=up$/);
  } finally {
    mock.restore();
  }
});

test('prom_query: range query hits /api/v1/query_range with start/end/step', async () => {
  const mock = withFetchMock(() => '{}');
  try {
    await promQueryTool.execute(ctx, {
      query: 'rate(http[5m])',
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-01T01:00:00Z',
      step: '60s',
      base_url: 'http://prom.test',
    });
    assert.match(mock.calls[0].url, /\/api\/v1\/query_range/);
    assert.match(mock.calls[0].url, /step=60s/);
  } finally {
    mock.restore();
  }
});

test('prom_query: forwards Bearer token when SRE_PROM_TOKEN is set', async () => {
  const mock = withFetchMock(() => '{}');
  try {
    await withEnv({ SRE_PROM_TOKEN: 'secret-token' }, async () => {
      await promQueryTool.execute(ctx, { query: 'up', base_url: 'http://prom.test' });
    });
    assert.equal(mock.calls[0].headers.get('authorization'), 'Bearer secret-token');
  } finally {
    mock.restore();
  }
});

test('loki_query: builds URL with query/limit/direction', async () => {
  const mock = withFetchMock(() => '{}');
  try {
    await lokiQueryTool.execute(ctx, {
      query: '{app="api"} |= "error"',
      limit: 50,
      direction: 'forward',
      base_url: 'http://loki.test',
    });
    const u = new URL(mock.calls[0].url);
    assert.equal(u.pathname, '/loki/api/v1/query_range');
    assert.equal(u.searchParams.get('query'), '{app="api"} |= "error"');
    assert.equal(u.searchParams.get('limit'), '50');
    assert.equal(u.searchParams.get('direction'), 'forward');
  } finally {
    mock.restore();
  }
});

test('loki_query: clamps limit to [1, 5000]', async () => {
  const mock = withFetchMock(() => '{}');
  try {
    await lokiQueryTool.execute(ctx, { query: 'x', limit: 99999, base_url: 'http://loki.test' });
    const u = new URL(mock.calls[0].url);
    assert.equal(u.searchParams.get('limit'), '5000');
  } finally {
    mock.restore();
  }
});

test('pagerduty_list: friendly error when SRE_PAGERDUTY_TOKEN missing', async () => {
  await withEnv({ SRE_PAGERDUTY_TOKEN: undefined }, async () => {
    const r = await pagerDutyListTool.execute(ctx, {});
    assert.equal(r.ok, false);
    assert.match(r.content, /SRE_PAGERDUTY_TOKEN/);
  });
});

test('pagerduty_list: defaults to triggered+acknowledged statuses with Token auth', async () => {
  const mock = withFetchMock(() => '{}');
  try {
    await withEnv({ SRE_PAGERDUTY_TOKEN: 't0k' }, async () => {
      await pagerDutyListTool.execute(ctx, { base_url: 'https://pd.test' });
    });
    const u = new URL(mock.calls[0].url);
    assert.deepEqual(u.searchParams.getAll('statuses[]'), ['triggered', 'acknowledged']);
    assert.equal(mock.calls[0].headers.get('authorization'), 'Token token=t0k');
  } finally {
    mock.restore();
  }
});

test('k8s_get: rejects mutating verbs', async () => {
  const r = await k8sGetTool.execute(ctx, { resource: 'pods', verb: 'apply' });
  assert.equal(r.ok, false);
  assert.match(r.content, /not allowed/);
});

test('k8s_get: rejects flags outside the allow-list', async () => {
  const r = await k8sGetTool.execute(ctx, { resource: 'pods', flags: ['--force'] });
  assert.equal(r.ok, false);
  assert.match(r.content, /allow-list/);
});

test('k8s_get: returns ENOENT-friendly error when kubectl is missing', async () => {
  // We point at a guaranteed-absent binary by overriding PATH for this test.
  const r = await withEnv({ PATH: '/nonexistent-bin-only' }, async () =>
    k8sGetTool.execute(ctx, { resource: 'pods' })
  );
  assert.equal(r.ok, false);
  assert.match(r.content, /kubectl/);
});
