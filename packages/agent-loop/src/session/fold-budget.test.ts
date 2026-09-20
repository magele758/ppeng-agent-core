import { describe, it, expect } from 'vitest';
import {
  MAX_VISIBLE_MESSAGES,
  capRollingSummaryText,
  clampFoldKeepRecent,
  clampFoldToVisible,
  compactSummaryMaxChars
} from './fold-budget.js';

describe('session/fold-budget', () => {
  describe('clampFoldKeepRecent', () => {
    it('never keeps the entire fold', () => {
      expect(clampFoldKeepRecent(10, 10)).toBe(9);
      expect(clampFoldKeepRecent(10, 99)).toBe(9);
    });

    it('honors a smaller keepRecent', () => {
      expect(clampFoldKeepRecent(10, 3)).toBe(3);
    });
  });

  describe('clampFoldToVisible', () => {
    it('returns a copy when under budget', () => {
      const src = [1, 2, 3];
      const out = clampFoldToVisible(src, 5);
      expect(out).toEqual([1, 2, 3]);
      expect(out).not.toBe(src);
    });

    it('keeps the tail when over the default visible budget', () => {
      const src = Array.from({ length: MAX_VISIBLE_MESSAGES + 5 }, (_, i) => i);
      expect(clampFoldToVisible(src)).toEqual(src.slice(5));
    });
  });

  describe('capRollingSummaryText', () => {
    it('returns empty when maxChars <= 0', () => {
      expect(capRollingSummaryText('hello', 0)).toBe('');
      expect(capRollingSummaryText('hello', -1)).toBe('');
    });

    it('returns the original text when it fits', () => {
      expect(capRollingSummaryText('hello', 10)).toBe('hello');
    });

    it('keeps the tail and prefixes a truncation marker', () => {
      expect(capRollingSummaryText('abcdefghij', 4)).toBe(
        '…[earlier summary truncated]\n\nghij'
      );
    });
  });

  describe('compactSummaryMaxChars', () => {
    it('defaults to tokenThreshold * 2', () => {
      expect(compactSummaryMaxChars({}, 1000)).toBe(2000);
    });

    it('honors explicit env override', () => {
      expect(
        compactSummaryMaxChars({ RAW_AGENT_COMPACT_SUMMARY_MAX_CHARS: '400' }, 1000)
      ).toBe(400);
    });
  });
});
