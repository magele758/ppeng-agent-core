import { describe, it, expect } from 'vitest';
import { calculateSessionBudget, resolveMaxContextTokens, resolveHistoryTokenBudget } from './session-budget.js';

describe('session-budget', () => {
  describe('resolveMaxContextTokens', () => {
    it('returns explicit override when provided', () => {
      expect(resolveMaxContextTokens({}, 50000)).toBe(50000);
    });

    it('floors override to integer', () => {
      expect(resolveMaxContextTokens({}, 50000.9)).toBe(50000);
    });

    it('reads env fallback when no override', () => {
      const result = resolveMaxContextTokens({ RAW_AGENT_MODEL_CONTEXT_TOKENS: '32000' });
      expect(result).toBe(32000);
    });

    it('returns default 131072 (128×1024) for empty env and no override', () => {
      expect(resolveMaxContextTokens({})).toBe(131_072);
    });
  });

  describe('calculateSessionBudget', () => {
    it('returns maxContextTokens in output', () => {
      const budget = calculateSessionBudget({ maxContextTokens: 100000 }, {});
      expect(budget.maxContextTokens).toBe(100000);
    });

    it('sessionBudgetTokens = maxContext - reservedTokens', () => {
      const budget = calculateSessionBudget({ maxContextTokens: 100000 }, {});
      expect(budget.sessionBudgetTokens).toBe(budget.maxContextTokens - budget.reservedTokens);
    });

    it('larger system prompt = larger reserved = smaller session budget', () => {
      const small = calculateSessionBudget({ maxContextTokens: 100000, systemPromptChars: 1000 }, {});
      const large = calculateSessionBudget({ maxContextTokens: 100000, systemPromptChars: 40000 }, {});
      expect(large.reservedTokens).toBeGreaterThan(small.reservedTokens);
      expect(large.sessionBudgetTokens).toBeLessThan(small.sessionBudgetTokens);
    });

    it('more tools = larger reserved', () => {
      const few = calculateSessionBudget({ maxContextTokens: 100000, toolCount: 2 }, {});
      const many = calculateSessionBudget({ maxContextTokens: 100000, toolCount: 50 }, {});
      expect(many.reservedTokens).toBeGreaterThan(few.reservedTokens);
    });

    it('sessionBudgetTokens respects minimum floor (never goes negative)', () => {
      const budget = calculateSessionBudget({ maxContextTokens: 1000, systemPromptChars: 999999 }, {});
      expect(budget.sessionBudgetTokens).toBeGreaterThan(0);
    });

    it('env output reserve override applies', () => {
      const withOverride = calculateSessionBudget(
        { maxContextTokens: 100000 },
        { RAW_AGENT_OUTPUT_RESERVE_TOKENS: '50000' }
      );
      const withoutOverride = calculateSessionBudget({ maxContextTokens: 100000 }, {});
      expect(withOverride.reservedTokens).toBeGreaterThan(withoutOverride.reservedTokens);
    });
  });

  describe('resolveHistoryTokenBudget', () => {
    it('respects explicit env episodic budget', () => {
      const result = resolveHistoryTokenBudget(
        'RAW_AGENT_EPISODIC_TOKEN_BUDGET',
        {},
        { RAW_AGENT_EPISODIC_TOKEN_BUDGET: '20000' }
      );
      expect(result).toBe(20000);
    });

    it('falls back to calculated session budget when env not set', () => {
      const budget = calculateSessionBudget({ maxContextTokens: 100000 }, {});
      const result = resolveHistoryTokenBudget('RAW_AGENT_EPISODIC_TOKEN_BUDGET', { maxContextTokens: 100000 }, {});
      expect(result).toBe(budget.sessionBudgetTokens);
    });
  });
});
