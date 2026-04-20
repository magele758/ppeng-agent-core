/**
 * Shared HTTP helpers + provider switch for stock tools.
 *
 * Provider precedence:
 *   STOCK_QUOTE_PROVIDER=mock         → static fixture data, no network
 *   STOCK_QUOTE_PROVIDER=alphavantage → uses Alpha Vantage (needs STOCK_API_KEY)
 *   STOCK_QUOTE_PROVIDER=yahoo (default) → public Yahoo Finance endpoints
 *
 * The mock provider is the canonical choice for CI / e2e: it deterministic
 * and works offline.
 */

import type { ToolExecutionResult } from '@ppeng/agent-core';

const DEFAULT_TIMEOUT_MS = 15_000;

export type Provider = 'yahoo' | 'alphavantage' | 'mock';

export function resolveProvider(override?: string): Provider {
  const raw = (override ?? process.env.STOCK_QUOTE_PROVIDER ?? 'yahoo').trim().toLowerCase();
  if (raw === 'alphavantage' || raw === 'av') return 'alphavantage';
  if (raw === 'mock') return 'mock';
  return 'yahoo';
}

export function truncate(text: string, maxChars = 16_000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... (truncated, original ${text.length} chars)`;
}

export interface JsonRequestOptions {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function httpJson(opts: JsonRequestOptions): Promise<ToolExecutionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const headers = new Headers(opts.headers ?? {});
    if (!headers.has('accept')) headers.set('accept', 'application/json');
    if (!headers.has('user-agent')) {
      // Yahoo's public endpoints reject the empty/curl-like UA with 403, so we set a polite default.
      headers.set('user-agent', 'ppeng-agent-stock/0.1 (+https://ppeng.dev)');
    }
    const res = await fetch(opts.url, { headers, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        content: `HTTP ${res.status} ${res.statusText} from ${opts.url}\n${truncate(text, 4_000)}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      return { ok: true, content: truncate(text) };
    }
    return { ok: true, content: truncate(JSON.stringify(parsed, null, 2)) };
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      return { ok: false, content: `Request timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms: ${opts.url}` };
    }
    return { ok: false, content: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Tiny deterministic fixture for offline / CI runs. */
export function mockQuote(symbol: string): Record<string, unknown> {
  const sym = symbol.toUpperCase();
  // Stable pseudo-price from char codes so tests can assert exact values.
  const price = [...sym].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 1000;
  return {
    symbol: sym,
    price: price + 0.5,
    currency: 'USD',
    open: price,
    previous_close: price - 1,
    market_cap: price * 1_000_000,
    provider: 'mock',
  };
}

export function mockFundamentals(symbol: string): Record<string, unknown> {
  const sym = symbol.toUpperCase();
  return {
    symbol: sym,
    period: 'TTM',
    pe: 20.5,
    pb: 4.1,
    ps: 5.2,
    roe: 0.18,
    revenue_yoy: 0.12,
    eps_yoy: 0.08,
    free_cash_flow_margin: 0.21,
    provider: 'mock',
  };
}

export function mockNews(query: string, limit: number): Record<string, unknown> {
  return {
    query,
    items: Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
      title: `[mock] news headline ${i + 1} for ${query}`,
      summary: `Placeholder summary for ${query} #${i + 1}.`,
      url: `https://example.test/news/${encodeURIComponent(query)}/${i + 1}`,
      published_at: new Date(Date.now() - i * 3_600_000).toISOString(),
    })),
    provider: 'mock',
  };
}
