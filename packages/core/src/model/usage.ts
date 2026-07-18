/**
 * LLM turn usage & truncation observability helpers.
 *
 * Provider responses carry token accounting (`usage`) and a finish/stop reason
 * that distinguishes a clean completion from a length-truncated one. The rest of
 * the runtime historically discarded both, so a truncated turn looked identical
 * to a finished one. These pure helpers normalize the two shapes (OpenAI-style
 * and Anthropic-style) into a single {@link TokenUsage} and classify finish
 * reasons, without any I/O — so they are trivially unit-testable.
 */

/** Normalized per-turn token accounting. All counts are whole tokens. */
export interface TokenUsage {
  /** Prompt / input tokens billed for this turn. */
  inputTokens: number;
  /** Completion / output tokens produced this turn. */
  outputTokens: number;
  /** input + output (providers sometimes omit their own total). */
  totalTokens: number;
  /** Subset of inputTokens served from the provider prompt cache, when reported. */
  cachedInputTokens?: number;
  /** Number of model requests represented by this usage (1 per turn; merged sums). */
  requests: number;
}

function toNonNegInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Normalize an OpenAI-family `usage` object (chat.completions and /v1/responses).
 *
 * chat.completions: `prompt_tokens` / `completion_tokens` / `total_tokens`,
 *   cached under `prompt_tokens_details.cached_tokens`.
 * responses:        `input_tokens` / `output_tokens` / `total_tokens`,
 *   cached under `input_tokens_details.cached_tokens`.
 *
 * Returns `undefined` when no recognizable token fields are present.
 */
export function normalizeOpenAiUsage(raw: unknown): TokenUsage | undefined {
  const u = asRecord(raw);
  if (!u) return undefined;

  const hasInput = 'prompt_tokens' in u || 'input_tokens' in u;
  const hasOutput = 'completion_tokens' in u || 'output_tokens' in u;
  if (!hasInput && !hasOutput && !('total_tokens' in u)) return undefined;

  const inputTokens = toNonNegInt(u.prompt_tokens ?? u.input_tokens);
  const outputTokens = toNonNegInt(u.completion_tokens ?? u.output_tokens);
  const reportedTotal = toNonNegInt(u.total_tokens);
  const totalTokens = reportedTotal > 0 ? reportedTotal : inputTokens + outputTokens;

  const cachedFromChat = toNonNegInt(asRecord(u.prompt_tokens_details)?.cached_tokens);
  const cachedFromResponses = toNonNegInt(asRecord(u.input_tokens_details)?.cached_tokens);
  const cached = Math.max(cachedFromChat, cachedFromResponses);

  const usage: TokenUsage = { inputTokens, outputTokens, totalTokens, requests: 1 };
  if (cached > 0) usage.cachedInputTokens = cached;
  return usage;
}

/**
 * Normalize an Anthropic Messages `usage` object.
 *
 * `input_tokens` / `output_tokens`; cache read reported separately as
 * `cache_read_input_tokens` (not included in `input_tokens`). We fold the
 * cache-read count into `inputTokens` so totals are comparable across providers,
 * and expose it via `cachedInputTokens`.
 */
export function normalizeAnthropicUsage(raw: unknown): TokenUsage | undefined {
  const u = asRecord(raw);
  if (!u) return undefined;
  if (!('input_tokens' in u) && !('output_tokens' in u)) return undefined;

  const baseInput = toNonNegInt(u.input_tokens);
  const cacheRead = toNonNegInt(u.cache_read_input_tokens);
  const cacheCreate = toNonNegInt(u.cache_creation_input_tokens);
  const inputTokens = baseInput + cacheRead + cacheCreate;
  const outputTokens = toNonNegInt(u.output_tokens);

  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    requests: 1
  };
  if (cacheRead > 0) usage.cachedInputTokens = cacheRead;
  return usage;
}

/**
 * True when a provider finish/stop reason indicates the output was cut off by a
 * token cap rather than the model deciding it was done. Covers OpenAI chat
 * (`length`), the Responses API incomplete reason (`max_output_tokens`), and
 * Anthropic (`max_tokens`).
 */
export function isTruncatedFinish(finishReason: string | undefined | null): boolean {
  if (!finishReason) return false;
  const r = finishReason.trim().toLowerCase();
  return r === 'length' || r === 'max_tokens' || r === 'max_output_tokens' || r === 'incomplete';
}

/**
 * Sum two usages for session-level aggregation. Either side may be undefined.
 * `cachedInputTokens` is only present in the result if either side reported it.
 */
export function mergeUsage(a: TokenUsage | undefined, b: TokenUsage | undefined): TokenUsage | undefined {
  if (!a) return b ? { ...b } : undefined;
  if (!b) return { ...a };
  const merged: TokenUsage = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    requests: a.requests + b.requests
  };
  const cached = (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0);
  if (cached > 0) merged.cachedInputTokens = cached;
  return merged;
}
