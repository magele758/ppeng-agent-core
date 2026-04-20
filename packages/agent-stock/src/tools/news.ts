import type { ToolContract, ToolExecutionResult } from '@ppeng/agent-core';
import { httpJson, mockNews, resolveProvider, truncate } from '../util.js';

type NewsArgs = {
  query: string;
  limit?: number;
  /** Override the default news endpoint. */
  base_url?: string;
  provider?: string;
};

async function yahooNews(query: string, limit: number): Promise<ToolExecutionResult> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=${encodeURIComponent(String(limit))}`;
  return httpJson({ url });
}

export const newsSearchTool: ToolContract<NewsArgs> = {
  name: 'news_search',
  description:
    'Search recent news for a ticker or topic. Provider via STOCK_QUOTE_PROVIDER (yahoo / alphavantage / mock). Set STOCK_NEWS_URL to point at a custom endpoint that takes ?q= and returns JSON.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Ticker, company name, or topic' },
      limit: { type: 'number', description: 'Default 5, max 25' },
      base_url: { type: 'string' },
      provider: { type: 'string', enum: ['yahoo', 'alphavantage', 'mock'] },
    },
    required: ['query'],
  },
  approvalMode: 'never',
  sideEffectLevel: 'system',
  async execute(_context, args) {
    const query = String(args.query ?? '').trim();
    if (!query) return { ok: false, content: 'query is required' };
    const limit = Math.min(Math.max(args.limit ?? 5, 1), 25);
    const provider = resolveProvider(args.provider);
    if (provider === 'mock') {
      return { ok: true, content: truncate(JSON.stringify(mockNews(query, limit), null, 2)) };
    }
    const customBase = args.base_url ?? process.env.STOCK_NEWS_URL;
    if (customBase) {
      const sep = customBase.includes('?') ? '&' : '?';
      return httpJson({ url: `${customBase}${sep}q=${encodeURIComponent(query)}&limit=${limit}` });
    }
    // alphavantage's news endpoint is paywalled in a way that's awkward to script; we keep
    // the same yahoo fallback for both yahoo/av so the agent always gets a usable result.
    return yahooNews(query, limit);
  },
};
