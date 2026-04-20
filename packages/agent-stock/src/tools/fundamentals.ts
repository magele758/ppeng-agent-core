import type { ToolContract, ToolExecutionResult } from '@ppeng/agent-core';
import { httpJson, mockFundamentals, resolveProvider, truncate } from '../util.js';

type FundamentalsArgs = {
  symbol: string;
  period?: 'annual' | 'quarterly' | 'TTM';
  provider?: string;
};

async function yahooFundamentals(symbol: string): Promise<ToolExecutionResult> {
  // Yahoo's defaultKeyStatistics gives PE/PB/PS plus margins; quoteSummary aggregates modules.
  const modules = ['summaryDetail', 'defaultKeyStatistics', 'financialData', 'price'].join(',');
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
  return httpJson({ url });
}

async function alphavantageFundamentals(symbol: string): Promise<ToolExecutionResult> {
  const key = process.env.STOCK_API_KEY?.trim();
  if (!key) return { ok: false, content: 'STOCK_API_KEY is not set; required for Alpha Vantage.' };
  const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`;
  return httpJson({ url });
}

export const fundamentalsGetTool: ToolContract<FundamentalsArgs> = {
  name: 'fundamentals_get',
  description:
    'Fetch fundamentals (PE / PB / ROE / margins) for a symbol. Provider via STOCK_QUOTE_PROVIDER. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: { type: 'string' },
      period: { type: 'string', enum: ['annual', 'quarterly', 'TTM'] },
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
      return { ok: true, content: truncate(JSON.stringify(mockFundamentals(symbol), null, 2)) };
    }
    if (provider === 'alphavantage') return alphavantageFundamentals(symbol);
    return yahooFundamentals(symbol);
  },
};
