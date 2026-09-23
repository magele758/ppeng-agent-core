/**
 * Host-only System One client. Not imported by @ppeng/agent-loop.
 * Failures return null so callers keep the existing path.
 */

import type { JevChain } from './settings.js';

export interface JevNoulQuestion {
  id: string;
  instructions: string;
}

export interface JevChoiceQuestion {
  id: string;
  instructions: string;
  options: string[];
}

export interface AskJevInput {
  chain: JevChain;
  state: string;
  nouls?: JevNoulQuestion[];
  choices?: JevChoiceQuestion[];
  signal?: AbortSignal;
}

/** Injectable ask for unit tests; production defaults to {@link askJev}. */
export type AskJevFn = (input: AskJevInput) => Promise<Record<string, Record<string, unknown>> | null>;

function endpoint(chain: JevChain): { url: string; local: boolean } {
  const base = chain.baseUrl.replace(/\/+$/, '');
  if (/\/(systemone|predict)$/.test(base)) {
    return { url: base, local: base.endsWith('/predict') };
  }
  const local = !chain.apiKey;
  return { url: `${base}/${local ? 'predict' : 'systemone'}`, local };
}

function answersOf(body: unknown): Record<string, Record<string, unknown>> {
  if (!body || typeof body !== 'object') return {};
  const root = body as { answers?: unknown; result?: { answers?: unknown } };
  const raw = root.answers ?? root.result?.answers;
  if (!raw || typeof raw !== 'object') return {};
  return raw as Record<string, Record<string, unknown>>;
}

export async function askJev(input: AskJevInput): Promise<Record<string, Record<string, unknown>> | null> {
  const questions: Record<string, unknown> = {};
  for (const q of input.nouls ?? []) {
    questions[q.id] = { type: 'noul', instructions: q.instructions };
  }
  for (const q of input.choices ?? []) {
    questions[q.id] = {
      type: 'choice',
      instructions: q.instructions,
      criteria: Object.fromEntries(q.options.map((option) => [option, option]))
    };
  }
  if (Object.keys(questions).length === 0) return null;

  const { url, local } = endpoint(input.chain);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (input.chain.apiKey) headers.Authorization = `Bearer ${input.chain.apiKey}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...(local ? {} : { model: input.chain.model }),
        state: input.state.slice(0, 24_000),
        questions
      }),
      signal: input.signal ?? AbortSignal.timeout(8_000)
    });
    if (!res.ok) return null;
    return answersOf(await res.json());
  } catch {
    return null;
  }
}

export function noulOf(answers: Record<string, Record<string, unknown>> | null, id: string): number | null {
  const raw = answers?.[id]?.noul;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export function choiceOf(
  answers: Record<string, Record<string, unknown>> | null,
  id: string
): { choice: string; confidence: number } | null {
  const row = answers?.[id];
  if (!row || typeof row.choice !== 'string') return null;
  const confidence = typeof row.confidence === 'number' ? row.confidence : 0;
  return { choice: row.choice, confidence };
}
