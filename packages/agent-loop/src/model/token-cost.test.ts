import { describe, it, expect } from 'vitest';
import { estimateUsageCostUsd, mergeCostUsd, resolveModelPrice, DEFAULT_MODEL_PRICES } from './token-cost.js';
import type { TokenUsage } from '../types.js';

// Helper: minimal valid TokenUsage
const usage = (inputTokens: number, outputTokens: number, extra: Partial<TokenUsage> = {}): TokenUsage => ({
  inputTokens,
  outputTokens,
  totalTokens: inputTokens + outputTokens,
  requests: 1,
  ...extra,
});

describe('token-cost', () => {
  describe('resolveModelPrice', () => {
    it('returns known gpt-4o price', () => {
      const { price } = resolveModelPrice('gpt-4o');
      expect(price.input).toBe(2.5);
      expect(price.output).toBe(10);
    });

    it('returns default price for unknown model', () => {
      const { price } = resolveModelPrice('unknown-model-xyz');
      expect(price.input).toBe(DEFAULT_MODEL_PRICES.default!.input);
      expect(price.output).toBe(DEFAULT_MODEL_PRICES.default!.output);
    });

    it('returns a non-empty model key', () => {
      const { model } = resolveModelPrice('gpt-4o');
      expect(typeof model).toBe('string');
      expect(model.length).toBeGreaterThan(0);
    });

    it('uses env JSON override when set', () => {
      const env = { RAW_AGENT_TOKEN_PRICE_JSON: JSON.stringify({ default: { input: 99, output: 199 } }) };
      const { price } = resolveModelPrice('anything', env);
      expect(price.input).toBe(99);
      expect(price.output).toBe(199);
    });
  });

  describe('estimateUsageCostUsd', () => {
    it('calculates input cost proportional to tokens', () => {
      const cost = estimateUsageCostUsd(usage(1_000_000, 0), 'gpt-4o');
      expect(cost.usd).toBeCloseTo(2.5, 2);
    });

    it('calculates output cost proportional to tokens', () => {
      const cost = estimateUsageCostUsd(usage(0, 1_000_000), 'gpt-4o');
      expect(cost.usd).toBeCloseTo(10, 2);
    });

    it('returns the resolved model name in result', () => {
      const cost = estimateUsageCostUsd(usage(1000, 500), 'gpt-4o');
      expect(typeof cost.model).toBe('string');
      expect(cost.usd).toBeGreaterThanOrEqual(0);
    });

    it('charges cached tokens at lower rate than uncached', () => {
      const withCache = estimateUsageCostUsd(
        usage(10000, 0, { cachedInputTokens: 10000 }),
        'gpt-4o'
      );
      const withoutCache = estimateUsageCostUsd(usage(10000, 0), 'gpt-4o');
      expect(withCache.usd).toBeLessThan(withoutCache.usd);
    });

    it('returns zero for zero tokens', () => {
      const cost = estimateUsageCostUsd(usage(0, 0), 'gpt-4o');
      expect(cost.usd).toBe(0);
    });
  });

  describe('mergeCostUsd', () => {
    it('sums two defined costs', () => {
      expect(mergeCostUsd(0.05, 0.03)).toBeCloseTo(0.08, 5);
    });

    it('returns b when a is undefined', () => {
      expect(mergeCostUsd(undefined, 0.03)).toBeCloseTo(0.03, 5);
    });

    it('returns a when b is undefined', () => {
      expect(mergeCostUsd(0.05, undefined)).toBeCloseTo(0.05, 5);
    });

    it('returns undefined when both undefined', () => {
      expect(mergeCostUsd(undefined, undefined)).toBeUndefined();
    });
  });
});
