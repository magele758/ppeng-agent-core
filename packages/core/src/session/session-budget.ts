/**
 * Session context budget (absorbed from ai-agent-node session/session-budget-manager.ts).
 *
 * The runtime used to hardcode 24k tokens for both episodic selection and the
 * auto-compact threshold, regardless of the model behind it. On a 200k or 1M
 * window that throws away most of the usable context; on a 32k model it leaves
 * no room for the system prompt plus tool schemas plus the reply.
 *
 * Derive it instead: history budget = context window − (system prompt + tool
 * schemas + reserved output + safety margin). Pure and unit-testable; the
 * existing env overrides still win so nothing changes for tuned deployments.
 */

import { envInt } from '../env.js';

/**
 * Tokens held back for the model's own output. Generous on purpose: reasoning
 * models routinely emit tens of thousands of tokens, and under-reserving is how
 * a long session ends up truncated mid-answer.
 */
const OUTPUT_RESERVE_TOKENS = 16_000;
/** Fallback when the caller cannot count tool schemas. */
const TOOL_SCHEMA_FALLBACK_TOKENS = 4_000;
/** Cushion for estimation error and per-message role/format overhead. */
const SAFETY_MARGIN_TOKENS = 2_000;
/** Used when neither the caller nor env declares a context window. */
const DEFAULT_CONTEXT_TOKENS = 131_072;
/** Never return less than this, even if the reserves exceed the window. */
const MIN_SESSION_BUDGET_TOKENS = 8_000;
/** Rough token cost of one tool definition when counting by tool count. */
const TOKENS_PER_TOOL_SCHEMA = 120;

export interface SessionBudgetInput {
  /** Model context window; falls back to env then {@link DEFAULT_CONTEXT_TOKENS}. */
  maxContextTokens?: number;
  /** Character length of the assembled system prompt. */
  systemPromptChars?: number;
  /** Precise tool-schema token count, when known. */
  toolSchemaTokens?: number;
  /** Number of tools exposed this turn; used when `toolSchemaTokens` is absent. */
  toolCount?: number;
  /** Override the output reserve (e.g. a model with a small max_tokens). */
  outputReserveTokens?: number;
}

export interface SessionBudget {
  maxContextTokens: number;
  /** Everything that is not conversation history. */
  reservedTokens: number;
  /** Tokens available for session history this turn. */
  sessionBudgetTokens: number;
}

function charsToTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}

export function resolveMaxContextTokens(
  env: NodeJS.ProcessEnv = process.env,
  override?: number
): number {
  if (typeof override === 'number' && override > 0) return Math.floor(override);
  return envInt(env, 'RAW_AGENT_MODEL_CONTEXT_TOKENS', DEFAULT_CONTEXT_TOKENS);
}

/** Pure: how many tokens of history this turn may carry. */
export function calculateSessionBudget(
  input: SessionBudgetInput = {},
  env: NodeJS.ProcessEnv = process.env
): SessionBudget {
  const maxContextTokens = resolveMaxContextTokens(env, input.maxContextTokens);

  const systemPromptTokens = charsToTokens(input.systemPromptChars ?? 0);
  const toolSchemaTokens =
    input.toolSchemaTokens ??
    (typeof input.toolCount === 'number'
      ? input.toolCount * TOKENS_PER_TOOL_SCHEMA
      : TOOL_SCHEMA_FALLBACK_TOKENS);
  const outputReserve =
    input.outputReserveTokens ??
    envInt(env, 'RAW_AGENT_OUTPUT_RESERVE_TOKENS', OUTPUT_RESERVE_TOKENS);

  const reservedTokens =
    systemPromptTokens + toolSchemaTokens + outputReserve + SAFETY_MARGIN_TOKENS;
  const sessionBudgetTokens = Math.max(
    MIN_SESSION_BUDGET_TOKENS,
    maxContextTokens - reservedTokens
  );

  return { maxContextTokens, reservedTokens, sessionBudgetTokens };
}

/**
 * History token budget for episodic selection and the auto-compact threshold.
 * An explicit env override wins; otherwise the budget is derived from the model
 * context window so a bigger model actually gets to use it.
 */
export function resolveHistoryTokenBudget(
  envKey: 'RAW_AGENT_EPISODIC_TOKEN_BUDGET' | 'RAW_AGENT_COMPACT_TOKEN_THRESHOLD',
  input: SessionBudgetInput = {},
  env: NodeJS.ProcessEnv = process.env
): number {
  const explicit = Number(env[envKey]);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  return calculateSessionBudget(input, env).sessionBudgetTokens;
}
