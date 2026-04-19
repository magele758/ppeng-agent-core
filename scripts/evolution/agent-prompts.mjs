/**
 * CLI prompt clamping helpers for evolution-run-day.
 *
 * Keeps all input-size guards in one place — reused for source excerpts,
 * agent constraints, dev plans, and the final `AI_FIX_PROMPT` injected
 * into review/refine/rebase steps.
 *
 * Defaults match the previous inline values; ENV overrides remain compatible:
 *   EVOLUTION_AGENT_EXCERPT_MAX_CHARS, EVOLUTION_AGENT_CONSTRAINTS_MAX_CHARS,
 *   EVOLUTION_AGENT_PLAN_MAX_CHARS, EVOLUTION_AGENT_CLI_PROMPT_MAX_CHARS.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const TEST_FAIL_TRACE_CHARS = 2_500;
export const DEFAULT_LINK_FETCH_MS = 25_000;

/** Positive integer env var with a sane fallback. */
export function envPositiveInt(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

/**
 * Truncate a text value, appending a footer marker so downstream tools can tell
 * the value was clipped (rather than silently shorter than expected).
 */
export function truncateAgentText(text, maxChars, label) {
  const s = text == null ? '' : String(text);
  const cap = Math.max(256, Number(maxChars) || 0);
  if (s.length <= cap) return s;
  const footer = `\n\n[evolution-run-day: "${label}" truncated from ${s.length} chars; cap=${cap} — beginning kept]\n`;
  const headBudget = cap - footer.length;
  return headBudget <= 0 ? footer.trim() : s.slice(0, headBudget) + footer;
}

export function clampAgentCliPrompt(prompt, label = 'AI_FIX_PROMPT') {
  const max = envPositiveInt('EVOLUTION_AGENT_CLI_PROMPT_MAX_CHARS', 96_000);
  return truncateAgentText(prompt, max, label);
}

/** Truncate a file in-place if it exceeds the cap (no-op when within cap). */
export function truncateAgentTextFile(absPath, maxChars, label) {
  if (!existsSync(absPath)) return;
  const original = readFileSync(absPath, 'utf8');
  const trimmed = truncateAgentText(original, maxChars, label);
  if (trimmed.length !== original.length) {
    writeFileSync(absPath, trimmed, 'utf8');
  }
}

/** Tail a (likely large) string for log embedding — keeps the recent window. */
export function tailForLog(s, max = TEST_FAIL_TRACE_CHARS) {
  if (!s) return '';
  return s.length <= max ? s : `…[${s.length - max} chars omitted]\n${s.slice(-max)}`;
}
