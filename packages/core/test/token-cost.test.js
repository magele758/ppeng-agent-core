import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateUsageCostUsd, mergeCostUsd, resolveModelPrice } from '../dist/model/token-cost.js';

test('resolveModelPrice falls back to default', () => {
  const { price } = resolveModelPrice('unknown-model-xyz', {});
  assert.equal(price.input, 3);
  assert.equal(price.output, 15);
});

test('estimateUsageCostUsd uses cached rate', () => {
  const est = estimateUsageCostUsd(
    { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000, cachedInputTokens: 500_000, requests: 1 },
    'gpt-4o-mini',
    {}
  );
  // 500k uncached * 0.15 + 500k cached * 0.075 = 0.075 + 0.0375 = 0.1125
  assert.ok(est.usd > 0.1 && est.usd < 0.12);
});

test('mergeCostUsd sums', () => {
  assert.equal(mergeCostUsd(0.1, 0.2), 0.3);
  assert.equal(mergeCostUsd(undefined, 0.5), 0.5);
});
