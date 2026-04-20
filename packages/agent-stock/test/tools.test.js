/**
 * Stock tool unit tests. Provider switch is exercised: default (yahoo) goes
 * through fetch (mocked), `mock` provider returns deterministic fixtures
 * without touching the network, `alphavantage` requires STOCK_API_KEY.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  quoteGetTool,
  fundamentalsGetTool,
  newsSearchTool,
  stockBundle,
} from '../dist/index.js';

function withFetchMock(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, headers: new Headers(init?.headers ?? {}) });
    const body = handler(url, init) ?? '{"ok":true}';
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
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

test('stockBundle exposes 3 tools and 2 agents', () => {
  assert.deepEqual(
    stockBundle.tools.map((t) => t.name).sort(),
    ['fundamentals_get', 'news_search', 'quote_get']
  );
  assert.deepEqual(
    stockBundle.agents.map((a) => a.id).sort(),
    ['stock-analyst', 'stock-screener']
  );
  assert.equal(stockBundle.id, 'stock');
});

test('quote_get: mock provider returns deterministic shape (no network)', async () => {
  const r = await quoteGetTool.execute(ctx, { symbol: 'AAPL', provider: 'mock' });
  assert.equal(r.ok, true);
  const parsed = JSON.parse(r.content);
  assert.equal(parsed.symbol, 'AAPL');
  assert.equal(parsed.provider, 'mock');
  assert.equal(typeof parsed.price, 'number');
});

test('quote_get: yahoo provider hits query1.finance.yahoo.com', async () => {
  const mock = withFetchMock(() => '{}');
  try {
    await quoteGetTool.execute(ctx, { symbol: 'TSLA', provider: 'yahoo' });
    assert.match(mock.calls[0].url, /query1\.finance\.yahoo\.com\/v7\/finance\/quote\?symbols=TSLA/);
    // Yahoo rejects empty UA → polite UA must be set.
    assert.match(mock.calls[0].headers.get('user-agent') ?? '', /ppeng-agent-stock/);
  } finally {
    mock.restore();
  }
});

test('quote_get: alphavantage requires STOCK_API_KEY', async () => {
  await withEnv({ STOCK_API_KEY: undefined }, async () => {
    const r = await quoteGetTool.execute(ctx, { symbol: 'BABA', provider: 'alphavantage' });
    assert.equal(r.ok, false);
    assert.match(r.content, /STOCK_API_KEY/);
  });
});

test('quote_get: alphavantage with key uses GLOBAL_QUOTE function', async () => {
  const mock = withFetchMock(() => '{}');
  try {
    await withEnv({ STOCK_API_KEY: 'k1' }, async () => {
      await quoteGetTool.execute(ctx, { symbol: 'NVDA', provider: 'alphavantage' });
    });
    assert.match(mock.calls[0].url, /alphavantage\.co\/query\?function=GLOBAL_QUOTE&symbol=NVDA&apikey=k1/);
  } finally {
    mock.restore();
  }
});

test('quote_get: rejects empty symbol', async () => {
  const r = await quoteGetTool.execute(ctx, { symbol: '   ', provider: 'mock' });
  assert.equal(r.ok, false);
  assert.match(r.content, /symbol is required/);
});

test('fundamentals_get: mock provider returns canonical metrics', async () => {
  const r = await fundamentalsGetTool.execute(ctx, { symbol: 'AAPL', provider: 'mock' });
  assert.equal(r.ok, true);
  const parsed = JSON.parse(r.content);
  for (const key of ['pe', 'pb', 'roe', 'free_cash_flow_margin']) {
    assert.ok(key in parsed, `missing ${key}`);
  }
});

test('fundamentals_get: yahoo URL includes the four core modules', async () => {
  const mock = withFetchMock(() => '{}');
  try {
    await fundamentalsGetTool.execute(ctx, { symbol: 'MSFT', provider: 'yahoo' });
    const url = mock.calls[0].url;
    for (const m of ['summaryDetail', 'defaultKeyStatistics', 'financialData', 'price']) {
      assert.match(url, new RegExp(m), `module ${m} missing from URL`);
    }
  } finally {
    mock.restore();
  }
});

test('news_search: mock provider returns N items capped at limit', async () => {
  const r = await newsSearchTool.execute(ctx, { query: 'AAPL', limit: 2, provider: 'mock' });
  assert.equal(r.ok, true);
  const parsed = JSON.parse(r.content);
  assert.equal(parsed.items.length, 2);
});

test('news_search: yahoo endpoint with newsCount=N', async () => {
  const mock = withFetchMock(() => '{}');
  try {
    await newsSearchTool.execute(ctx, { query: 'AI', limit: 7, provider: 'yahoo' });
    assert.match(mock.calls[0].url, /finance\/search\?q=AI&newsCount=7/);
  } finally {
    mock.restore();
  }
});

test('news_search: respects STOCK_NEWS_URL when set', async () => {
  const mock = withFetchMock(() => '{}');
  try {
    await withEnv({ STOCK_NEWS_URL: 'https://news.test/api?source=foo' }, async () => {
      await newsSearchTool.execute(ctx, { query: 'TSLA', provider: 'yahoo' });
    });
    assert.match(mock.calls[0].url, /https:\/\/news\.test\/api\?source=foo&q=TSLA&limit=5/);
  } finally {
    mock.restore();
  }
});
