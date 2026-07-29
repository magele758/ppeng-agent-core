import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSessionBudget,
  resolveHistoryTokenBudget,
  resolveMaxContextTokens
} from '../dist/session/session-budget.js';

test('resolveMaxContextTokens: override > env > default', () => {
  assert.equal(resolveMaxContextTokens({}, 200_000), 200_000);
  assert.equal(resolveMaxContextTokens({ RAW_AGENT_MODEL_CONTEXT_TOKENS: '64000' }), 64_000);
  assert.equal(resolveMaxContextTokens({}), 131_072);
});

test('budget = window minus reserves', () => {
  const b = calculateSessionBudget({ maxContextTokens: 100_000, toolSchemaTokens: 4_000 }, {});
  assert.equal(b.maxContextTokens, 100_000);
  assert.equal(b.sessionBudgetTokens, 100_000 - b.reservedTokens);
  assert.ok(b.reservedTokens >= 16_000, 'output reserve is included');
});

test('bigger context window yields a bigger history budget', () => {
  const small = calculateSessionBudget({ maxContextTokens: 32_000 }, {});
  const large = calculateSessionBudget({ maxContextTokens: 1_000_000 }, {});
  assert.ok(large.sessionBudgetTokens > small.sessionBudgetTokens * 10);
  assert.ok(large.sessionBudgetTokens > 900_000);
});

test('system prompt and tool count shrink the budget', () => {
  const bare = calculateSessionBudget({ maxContextTokens: 100_000, toolCount: 0 }, {});
  const loaded = calculateSessionBudget(
    { maxContextTokens: 100_000, systemPromptChars: 40_000, toolCount: 40 },
    {}
  );
  assert.ok(loaded.sessionBudgetTokens < bare.sessionBudgetTokens);
  // 40k chars ≈ 10k tokens, 40 tools ≈ 4.8k tokens
  assert.ok(bare.sessionBudgetTokens - loaded.sessionBudgetTokens > 10_000);
});

test('tiny window still returns the floor', () => {
  const b = calculateSessionBudget({ maxContextTokens: 8_000 }, {});
  assert.equal(b.sessionBudgetTokens, 8_000);
});

test('outputReserveTokens is overridable by arg and env', () => {
  const viaArg = calculateSessionBudget(
    { maxContextTokens: 100_000, outputReserveTokens: 1_000 },
    {}
  );
  const viaEnv = calculateSessionBudget(
    { maxContextTokens: 100_000 },
    { RAW_AGENT_OUTPUT_RESERVE_TOKENS: '1000' }
  );
  assert.equal(viaArg.sessionBudgetTokens, viaEnv.sessionBudgetTokens);
});

test('resolveHistoryTokenBudget: explicit env wins', () => {
  assert.equal(
    resolveHistoryTokenBudget(
      'RAW_AGENT_EPISODIC_TOKEN_BUDGET',
      { maxContextTokens: 1_000_000 },
      { RAW_AGENT_EPISODIC_TOKEN_BUDGET: '24000' }
    ),
    24_000
  );
});

test('resolveHistoryTokenBudget: derives when env is absent', () => {
  const derived = resolveHistoryTokenBudget(
    'RAW_AGENT_COMPACT_TOKEN_THRESHOLD',
    { maxContextTokens: 200_000 },
    {}
  );
  assert.ok(derived > 24_000, 'a 200k model gets more than the old hardcoded 24k');
  assert.ok(derived < 200_000);
});
