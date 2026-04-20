import type { ToolContract, ToolExecutionResult } from '@ppeng/agent-core';
import { httpJson, mockQuote, resolveProvider, truncate } from '../util.js';

type QuoteArgs = {
  symbol: string;
  /** Override env (test only). */
  provider?: string;
};

async function yahooQuote(symbol: string): Promise<ToolExecutionResult> {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
  return httpJson({ url });
}

async function alphavantageQuote(symbol: string): Promise<ToolExecutionResult> {
  const key = process.env.STOCK_API_KEY?.trim();
  if (!key) {
    return { ok: false, content: 'STOCK_API_KEY is not set; required for Alpha Vantage.' };
  }
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`;
  return httpJson({ url });
}

export const quoteGetTool: ToolContract<QuoteArgs> = {
  name: 'quote_get',
  description:
    'Get the latest quote for a stock symbol. Provider via STOCK_QUOTE_PROVIDER (yahoo / alphavantage / mock). Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Ticker, e.g. AAPL, 0700.HK, BABA' },
      provider: { type: 'string', enum: ['yahoo', 'alphavantage', 'mock'] },
    },
    required: ['symbol'],
  },
  approvalMode: 'never',
  sideEffectLevel: 'system',
  async execute(_context, args) {
    const symbol = String(args.symbol ?? '').trim();
    if (!symbol) return { ok: false, content: 'symbol is required' };
    const provider = resolveProvider(args.provider);
    if (provider === 'mock') {
      return { ok: true, content: truncate(JSON.stringify(mockQuote(symbol), null, 2)) };
    }
    if (provider === 'alphavantage') return alphavantageQuote(symbol);
    return yahooQuote(symbol);
  },
};
