/**
 * Upstream record/replay harness for model adapter tests.
 *
 * A fixture is a recorded provider exchange (status, headers, raw SSE / JSON body,
 * how the body was split on the wire, how the connection ended). The harness
 * serves it from a real local HTTP server on a random port, so adapters run
 * their real `fetch` + streaming parse paths, then compares the normalized
 * `ModelTurnResult` / stream chunks with the fixture's `expect` block.
 *
 * Not exported from the package index: test-only, and it needs `node:http`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type {
  MessagePart,
  ModelAdapter,
  ModelStreamChunk,
  ModelTurnInput,
  ModelTurnResult,
  TokenUsage
} from '../types.js';

export type ReplayProvider = 'openai-chat' | 'openai-responses' | 'anthropic';

/** One SSE frame. `raw` is written verbatim (comments, malformed lines, partial frames). */
export interface ReplayEvent {
  event?: string;
  data?: unknown;
  raw?: string;
}

/** `event` = one write per SSE frame; `{ bytes }` = fixed-size byte slices (splits JSON and UTF-8). */
export type ReplaySplit = 'event' | 'whole' | { bytes: number };

export interface ReplayResponse {
  status: number;
  headers?: Record<string, string>;
  events?: ReplayEvent[];
  json?: unknown;
  text?: string;
  split?: ReplaySplit;
  delayMs?: number;
  /** `end` closes cleanly; `destroy` resets the socket after the last write; `hang` never ends. */
  end?: 'end' | 'destroy' | 'hang';
}

export interface ReplayExpectation {
  /** Regex (case-insensitive) the thrown error message must match. */
  error?: string;
  /** Properties the thrown error must carry (e.g. `status`, `retryAfterMs`). */
  errorFields?: Record<string, unknown>;
  text?: string;
  reasoning?: string;
  toolCalls?: Array<{ id?: string; name: string; input: unknown }>;
  stopReason?: ModelTurnResult['stopReason'];
  finishReason?: string | null;
  truncated?: boolean;
  usage?: Partial<TokenUsage> | null;
  requestId?: string | null;
  streamText?: string;
  streamReasoning?: string;
  streamToolArgs?: Record<string, string>;
  lastChunk?: ModelStreamChunk['type'] | null;
  hits?: number;
  requestPath?: string;
  requestBody?: Record<string, unknown>;
}

export interface ReplayFixture {
  name: string;
  description: string;
  provider: ReplayProvider;
  mode: 'stream' | 'json';
  responses: ReplayResponse[];
  expect: ReplayExpectation;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

export interface ReplayServer {
  baseUrl: string;
  requests: RecordedRequest[];
  /** Hits whose response the client abandoned before it was fully written. */
  abandoned: () => number;
  close: () => Promise<void>;
}

export interface ReplayOutcome {
  result?: ModelTurnResult;
  error?: Error;
  chunks: ModelStreamChunk[];
  requests: RecordedRequest[];
}

export function loadReplayFixtures(dir: string): ReplayFixture[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as ReplayFixture);
}

function frameOf(ev: ReplayEvent): string {
  if (ev.raw !== undefined) return ev.raw;
  const data = typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data);
  return `${ev.event ? `event: ${ev.event}\n` : ''}data: ${data}\n\n`;
}

function bodyOf(resp: ReplayResponse): string {
  if (resp.events) return resp.events.map(frameOf).join('');
  if (resp.json !== undefined) return JSON.stringify(resp.json);
  return resp.text ?? '';
}

function sliceBytes(body: string, size: number): Buffer[] {
  const bytes = Buffer.from(body, 'utf8');
  const out: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size));
  return out;
}

/** Wire writes for a response, in order. */
export function replayWrites(resp: ReplayResponse): Buffer[] {
  const split = resp.split ?? 'event';
  if (typeof split === 'object') return sliceBytes(bodyOf(resp), Math.max(1, split.bytes));
  if (split === 'event' && resp.events) return resp.events.map((ev) => Buffer.from(frameOf(ev), 'utf8'));
  return [Buffer.from(bodyOf(resp), 'utf8')];
}

function defaultContentType(resp: ReplayResponse): string {
  return resp.events ? 'text/event-stream' : 'application/json';
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const piece of req) raw += String(piece);
  try {
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return raw;
  }
}

async function writeResponse(res: ServerResponse, resp: ReplayResponse, onAbandon: () => void): Promise<void> {
  let gone = false;
  res.on('close', () => {
    if (!res.writableFinished) {
      gone = true;
      onAbandon();
    }
  });
  res.writeHead(resp.status, { 'content-type': defaultContentType(resp), ...(resp.headers ?? {}) });
  res.flushHeaders();
  for (const piece of replayWrites(resp)) {
    if (gone) return;
    res.write(piece);
    if (resp.delayMs) await sleep(resp.delayMs);
  }
  if (resp.end === 'destroy') {
    // Let the client read what was sent; an immediate reset can discard unread bytes.
    await new Promise<void>((resolve) => res.write('', () => resolve()));
    await sleep(25);
    res.socket?.destroy();
  } else if (resp.end !== 'hang') res.end();
}

/** Serve `responses` in order; once exhausted, the last one repeats. */
export async function startReplayServer(responses: ReplayResponse[]): Promise<ReplayServer> {
  const requests: RecordedRequest[] = [];
  let abandoned = 0;
  const server = createServer((req, res) => {
    void (async () => {
      const body = await readJsonBody(req);
      requests.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body });
      const resp = responses[Math.min(requests.length - 1, responses.length - 1)]!;
      await writeResponse(res, resp, () => {
        abandoned += 1;
      });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    abandoned: () => abandoned,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  };
}

/** Throwaway credential for fixtures; assembled at runtime so it never looks like a real key. */
export function replayApiKey(): string {
  return ['replay', 'fixture', 'credential'].join('-');
}

export function replayTurnInput(signal?: AbortSignal): ModelTurnInput {
  return {
    agent: { id: 'replay', name: 'Replay', role: 'assistant', instructions: '', capabilities: [] },
    systemPrompt: 'You are a replay test agent.',
    messages: [
      {
        id: 'm1',
        sessionId: 'replay-session',
        role: 'user',
        parts: [{ type: 'text', text: 'Run the recorded scenario.' }],
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ],
    tools: [
      {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        approvalMode: 'never',
        sideEffectLevel: 'none',
        execute: async () => ({ ok: true, content: '' })
      }
    ],
    ...(signal ? { signal } : {})
  };
}

/** Run one turn of `adapter` against `server` the way `fixture.mode` says. */
export async function runReplayTurn(
  adapter: ModelAdapter,
  fixture: Pick<ReplayFixture, 'mode'>,
  server: ReplayServer,
  input: ModelTurnInput = replayTurnInput()
): Promise<ReplayOutcome> {
  const chunks: ModelStreamChunk[] = [];
  const outcome: ReplayOutcome = { chunks, requests: server.requests };
  try {
    outcome.result =
      fixture.mode === 'stream' && adapter.runTurnStream
        ? await adapter.runTurnStream(input, (chunk) => chunks.push(chunk))
        : await adapter.runTurn(input);
  } catch (err) {
    outcome.error = err instanceof Error ? err : new Error(String(err));
  }
  return outcome;
}

/** Serve the fixture, run one turn, shut the server down. */
export async function replayFixture(
  fixture: ReplayFixture,
  makeAdapter: (baseUrl: string) => ModelAdapter
): Promise<ReplayOutcome> {
  const server = await startReplayServer(fixture.responses);
  try {
    return await runReplayTurn(makeAdapter(server.baseUrl), fixture, server);
  } finally {
    await server.close();
  }
}

function partsText(parts: MessagePart[], type: 'text' | 'reasoning'): string {
  return parts
    .filter((p): p is Extract<MessagePart, { type: 'text' | 'reasoning' }> => p.type === type)
    .map((p) => p.text)
    .join('');
}

function toolCallsOf(parts: MessagePart[]): Array<{ id: string; name: string; input: unknown }> {
  return parts
    .filter((p): p is Extract<MessagePart, { type: 'tool_call' }> => p.type === 'tool_call')
    .map((p) => ({ id: p.toolCallId, name: p.name, input: p.input }));
}

function streamed(chunks: ModelStreamChunk[], type: 'text_delta' | 'reasoning_delta'): string {
  return chunks
    .filter((c): c is Extract<ModelStreamChunk, { type: 'text_delta' | 'reasoning_delta' }> => c.type === type)
    .map((c) => c.text)
    .join('');
}

function streamedToolArgs(chunks: ModelStreamChunk[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of chunks) {
    if (c.type === 'tool_call_delta') out[c.toolCallId] = (out[c.toolCallId] ?? '') + c.argumentsFragment;
  }
  return out;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function subsetMismatch(label: string, actual: unknown, expected: Record<string, unknown>): string[] {
  const rec = (actual ?? {}) as Record<string, unknown>;
  return Object.entries(expected)
    .filter(([key, value]) => !same(rec[key], value))
    .map(([key, value]) => `${label}.${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(rec[key])}`);
}

type Check = (outcome: ReplayOutcome, expect: ReplayExpectation) => string[];

function eq(label: string, actual: unknown, expected: unknown): string[] {
  return same(actual, expected) ? [] : [`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
}

function toolCallMismatches(actual: Array<{ id: string; name: string; input: unknown }>, expected: NonNullable<ReplayExpectation['toolCalls']>): string[] {
  const shaped = actual.map((call, i) => (expected[i]?.id === undefined ? { name: call.name, input: call.input } : call));
  const want = expected.map((call) => (call.id === undefined ? { name: call.name, input: call.input } : call));
  return eq('toolCalls', shaped, want);
}

const resultChecks: Check[] = [
  (o, e) => (e.text === undefined ? [] : eq('text', partsText(o.result!.assistantParts, 'text'), e.text)),
  (o, e) => (e.reasoning === undefined ? [] : eq('reasoning', partsText(o.result!.assistantParts, 'reasoning'), e.reasoning)),
  (o, e) => (e.toolCalls === undefined ? [] : toolCallMismatches(toolCallsOf(o.result!.assistantParts), e.toolCalls)),
  (o, e) => (e.stopReason === undefined ? [] : eq('stopReason', o.result!.stopReason, e.stopReason)),
  (o, e) => (e.finishReason === undefined ? [] : eq('finishReason', o.result!.finishReason ?? null, e.finishReason)),
  (o, e) => (e.truncated === undefined ? [] : eq('truncated', o.result!.truncated === true, e.truncated)),
  (o, e) => (e.requestId === undefined ? [] : eq('requestId', o.result!.requestId ?? null, e.requestId)),
  (o, e) => {
    if (e.usage === undefined) return [];
    if (e.usage === null) return eq('usage', o.result!.usage ?? null, null);
    return subsetMismatch('usage', o.result!.usage, e.usage as Record<string, unknown>);
  }
];

const alwaysChecks: Check[] = [
  (o, e) => (e.streamText === undefined ? [] : eq('streamText', streamed(o.chunks, 'text_delta'), e.streamText)),
  (o, e) => (e.streamReasoning === undefined ? [] : eq('streamReasoning', streamed(o.chunks, 'reasoning_delta'), e.streamReasoning)),
  (o, e) => (e.streamToolArgs === undefined ? [] : eq('streamToolArgs', streamedToolArgs(o.chunks), e.streamToolArgs)),
  (o, e) => (e.lastChunk === undefined ? [] : eq('lastChunk', o.chunks.at(-1)?.type ?? null, e.lastChunk)),
  (o, e) => (e.hits === undefined ? [] : eq('hits', o.requests.length, e.hits)),
  (o, e) => (e.requestPath === undefined ? [] : eq('requestPath', o.requests[0]?.path, e.requestPath)),
  (o, e) => (e.requestBody === undefined ? [] : subsetMismatch('requestBody', o.requests[0]?.body, e.requestBody))
];

function errorMismatches(outcome: ReplayOutcome, expected: string | undefined): string[] {
  if (expected === undefined) {
    return outcome.error ? [`unexpected error: ${outcome.error.message}`] : [];
  }
  if (!outcome.error) return [`expected error matching /${expected}/, but the turn succeeded`];
  return new RegExp(expected, 'i').test(outcome.error.message)
    ? []
    : [`error: expected /${expected}/, got ${JSON.stringify(outcome.error.message)}`];
}

/** Every mismatch between `outcome` and `expect`; empty means the scenario passed. */
export function replayMismatches(outcome: ReplayOutcome, expect: ReplayExpectation): string[] {
  const errors = errorMismatches(outcome, expect.error);
  if (expect.errorFields && outcome.error) errors.push(...subsetMismatch('error', outcome.error, expect.errorFields));
  const fromResult = outcome.result ? resultChecks.flatMap((check) => check(outcome, expect)) : [];
  return [...errors, ...fromResult, ...alwaysChecks.flatMap((check) => check(outcome, expect))];
}
