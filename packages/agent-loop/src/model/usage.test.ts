import { describe, it, expect } from 'vitest';
import { mergeUsage, splitCumulativePromptTokens, isTruncatedFinish } from './usage.js';
import type { TokenUsage } from '../types.js';

describe('model/usage', () => {
  describe('mergeUsage', () => {
    it('merges two usage records summing all fields', () => {
      const a: TokenUsage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, requests: 1 };
      const b: TokenUsage = { inputTokens: 2000, outputTokens: 800, totalTokens: 2800, requests: 1 };
      const merged = mergeUsage(a, b);
      expect(merged?.inputTokens).toBe(3000);
      expect(merged?.outputTokens).toBe(1300);
      expect(merged?.totalTokens).toBe(4300);
      expect(merged?.requests).toBe(2);
    });

    it('handles undefined prev — returns copy of b', () => {
      const b: TokenUsage = { inputTokens: 2000, outputTokens: 800, totalTokens: 2800, requests: 1 };
      const merged = mergeUsage(undefined, b);
      expect(merged?.inputTokens).toBe(2000);
      expect(merged?.outputTokens).toBe(800);
    });

    it('handles undefined b — returns copy of a', () => {
      const a: TokenUsage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, requests: 1 };
      const merged = mergeUsage(a, undefined);
      expect(merged?.inputTokens).toBe(1000);
    });

    it('returns undefined when both undefined', () => {
      expect(mergeUsage(undefined, undefined)).toBeUndefined();
    });

    it('merges cachedInputTokens when present', () => {
      const a: TokenUsage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, requests: 1, cachedInputTokens: 200 };
      const b: TokenUsage = { inputTokens: 2000, outputTokens: 800, totalTokens: 2800, requests: 1, cachedInputTokens: 300 };
      const merged = mergeUsage(a, b);
      expect(merged?.cachedInputTokens).toBe(500);
    });
  });

  describe('splitCumulativePromptTokens', () => {
    it('treats as turn-only when no previous cumulative', () => {
      const result = splitCumulativePromptTokens(5000, undefined, false);
      expect(result.treatedAsCumulative).toBe(false);
      expect(result.turnInputTokens).toBe(5000);
      expect(result.cumulativeInputTokens).toBe(5000);
    });

    it('detects cumulative when reported makes a big jump past previous', () => {
      // 5000 → 40000: big jump (≥ +40% and ≥ 1000)
      const result = splitCumulativePromptTokens(40000, 5000, false);
      expect(result.treatedAsCumulative).toBe(true);
      expect(result.turnInputTokens).toBe(35000);
      expect(result.cumulativeInputTokens).toBe(40000);
    });

    it('stays cumulative (sticky) when prev > 0 and incoming >= prev', () => {
      const result = splitCumulativePromptTokens(30000, 25000, true);
      expect(result.treatedAsCumulative).toBe(true);
      expect(result.turnInputTokens).toBe(5000);
      expect(result.cumulativeInputTokens).toBe(30000);
    });

    it('resets when incoming drops below previous (compaction reset)', () => {
      // incoming 3000 < prev 25000: provider reset, not cumulative
      const result = splitCumulativePromptTokens(3000, 25000, true);
      expect(result.treatedAsCumulative).toBe(false);
      expect(result.turnInputTokens).toBe(3000);
      // cumulativeInputTokens = max(incoming, prev) = 25000
      expect(result.cumulativeInputTokens).toBe(25000);
    });
  });

  describe('isTruncatedFinish', () => {
    it('returns true for length finish reasons', () => {
      expect(isTruncatedFinish('length')).toBe(true);
      expect(isTruncatedFinish('max_tokens')).toBe(true);
    });

    it('returns false for normal stop reasons', () => {
      expect(isTruncatedFinish('stop')).toBe(false);
      expect(isTruncatedFinish('tool_use')).toBe(false);
      expect(isTruncatedFinish('end_turn')).toBe(false);
    });

    it('returns false for undefined/null', () => {
      expect(isTruncatedFinish(undefined)).toBe(false);
      expect(isTruncatedFinish(null)).toBe(false);
    });
  });
});
