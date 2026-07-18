/**
 * Token → USD cost estimate (observability). Pricing table is a coarse default;
 * override via RAW_AGENT_TOKEN_PRICE_JSON or per-model entries below.
 */

import type { TokenUsage } from './usage.js';

export interface TokenPricePerMillion {
  /** USD per 1M input tokens */
  input: number;
  /** USD per 1M output tokens */
  output: number;
  /** Optional: USD per 1M cached input tokens (defaults to input * 0.5) */
  cachedInput?: number;
}

/** Coarse public-list defaults — not a billing authority. */
export const DEFAULT_MODEL_PRICES: Record<string, TokenPricePerMillion> = {
  default: { input: 3, output: 15 },
  'gpt-4o': { input: 2.5, output: 10, cachedInput: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cachedInput: 0.075 },
  'gpt-4.1': { input: 2, output: 8, cachedInput: 0.5 },
  'claude-sonnet-4': { input: 3, output: 15, cachedInput: 0.3 },
  'claude-3-5-sonnet': { input: 3, output: 15, cachedInput: 0.3 },
  'claude-haiku': { input: 0.8, output: 4, cachedInput: 0.08 }
};

export interface CostEstimate {
  /** Estimated USD for this usage blob */
  usd: number;
  model: string;
  price: TokenPricePerMillion;
}

function normalizeModelKey(model: string): string {
  return model.trim().toLowerCase();
}

export function resolveModelPrice(
  model: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): { model: string; price: TokenPricePerMillion } {
  const key = normalizeModelKey(model || env.RAW_AGENT_MODEL_NAME || 'default');
  const fromEnv = env.RAW_AGENT_TOKEN_PRICE_JSON?.trim();
  if (fromEnv) {
    try {
      const parsed = JSON.parse(fromEnv) as Record<string, TokenPricePerMillion>;
      if (parsed[key]) return { model: key, price: parsed[key]! };
      if (parsed.default) return { model: key, price: parsed.default };
    } catch {
      /* ignore */
    }
  }
  if (DEFAULT_MODEL_PRICES[key]) {
    return { model: key, price: DEFAULT_MODEL_PRICES[key]! };
  }
  // Prefer longest name match so gpt-4o-mini does not hit gpt-4o first.
  const names = Object.keys(DEFAULT_MODEL_PRICES)
    .filter((n) => n !== 'default')
    .sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (key.includes(name) || name.includes(key)) {
      return { model: key, price: DEFAULT_MODEL_PRICES[name]! };
    }
  }
  return { model: key || 'default', price: DEFAULT_MODEL_PRICES.default! };
}

/** Pure: estimate USD from normalized TokenUsage. */
export function estimateUsageCostUsd(
  usage: TokenUsage,
  model?: string,
  env: NodeJS.ProcessEnv = process.env
): CostEstimate {
  const { model: m, price } = resolveModelPrice(model, env);
  const cached = usage.cachedInputTokens ?? 0;
  const uncachedInput = Math.max(0, usage.inputTokens - cached);
  const cachedRate = price.cachedInput ?? price.input * 0.5;
  const usd =
    (uncachedInput / 1_000_000) * price.input +
    (cached / 1_000_000) * cachedRate +
    (usage.outputTokens / 1_000_000) * price.output;
  return { usd: Number(usd.toFixed(8)), model: m, price };
}

export function mergeCostUsd(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return Number(((a ?? 0) + (b ?? 0)).toFixed(8));
}
