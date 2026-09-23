/**
 * Host-only System One client. Not imported by @ppeng/agent-loop.
 * Failures return null so callers keep the existing path.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { JevChain } from './settings.js';

export interface JevTraceEvent {
  kind: 'jev_call';
  payload: Record<string, unknown>;
}

export interface JevTraceContext {
  sessionId: string;
  emit: (event: JevTraceEvent) => void;
}

const jevTraceStorage = new AsyncLocalStorage<JevTraceContext>();

/** Binds Jev HTTP calls in this async turn to the session trace. */
export function runWithJevTrace<T>(ctx: JevTraceContext, fn: () => T): T {
  return jevTraceStorage.run(ctx, fn);
}

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
  /** Insertion point id, used as the trace span name `jev.<point>`. */
  point?: string;
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

function questionSummary(questions: Record<string, unknown>): Array<Record<string, unknown>> {
  return Object.entries(questions).map(([id, raw]) => {
    const q = raw as { type?: unknown; instructions?: unknown };
    const instructions = typeof q.instructions === 'string' ? q.instructions.slice(0, 240) : '';
    return { id, type: q.type, instructions };
  });
}

function answerSummary(
  answers: Record<string, Record<string, unknown>> | null
): Record<string, unknown> | null {
  if (!answers) return null;
  const out: Record<string, unknown> = {};
  for (const [id, row] of Object.entries(answers)) {
    const item: Record<string, unknown> = {};
    if (typeof row.noul === 'number') item.noul = row.noul;
    if (typeof row.choice === 'string') item.choice = row.choice;
    if (typeof row.confidence === 'number') item.confidence = row.confidence;
    out[id] = item;
  }
  return out;
}

function emitJevCall(
  input: AskJevInput,
  questions: Record<string, unknown>,
  answers: Record<string, Record<string, unknown>> | null,
  error: string | undefined,
  startedAt: string,
  durationMs: number
): void {
  const ctx = jevTraceStorage.getStore();
  if (!ctx) return;
  try {
    ctx.emit({
      kind: 'jev_call',
      payload: {
        point: input.point || 'jev',
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs,
        ok: answers != null && !error,
        ...(error ? { error } : {}),
        questions: questionSummary(questions),
        answers: answerSummary(answers)
      }
    });
  } catch {
    /* trace must not change the decision path */
  }
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

  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  let answers: Record<string, Record<string, unknown>> | null = null;
  let error: string | undefined;
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
    if (!res.ok) {
      error = `HTTP ${res.status}`;
      return null;
    }
    answers = answersOf(await res.json());
    if (Object.keys(answers).length === 0) error = 'empty answers';
    return answers;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    return null;
  } finally {
    emitJevCall(input, questions, answers, error, startedAt, Date.now() - t0);
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
