/**
 * Typed upstream failures thrown by the model adapters.
 *
 * Messages keep the historical text ("OpenAI stream failed 429: …") because
 * `classifyModelError` and existing logs parse it; the typed fields let retry
 * logic honor `Retry-After` without re-parsing strings.
 */

/** Non-2xx response before the first body byte. */
export class UpstreamHttpError extends Error {
  readonly status: number;
  /** Server-requested wait before retrying (`retry-after-ms` / `retry-after`), when present. */
  readonly retryAfterMs?: number;
  readonly requestId?: string;

  constructor(message: string, init: { status: number; retryAfterMs?: number; requestId?: string }) {
    super(message);
    this.name = 'UpstreamHttpError';
    this.status = init.status;
    if (init.retryAfterMs !== undefined) this.retryAfterMs = init.retryAfterMs;
    if (init.requestId) this.requestId = init.requestId;
  }
}

/**
 * The stream started (HTTP 200) but did not finish: an error event arrived
 * mid-stream, or the body ended before the provider's completion marker.
 */
export class UpstreamStreamError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'UpstreamStreamError';
    if (code) this.code = code;
  }
}

function nonNegative(n: number): number | undefined {
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

/** `retry-after-ms` (OpenAI) wins; `retry-after` is delta-seconds or an HTTP date. */
export function parseRetryAfterMs(headers: Headers, now: number = Date.now()): number | undefined {
  const ms = headers.get('retry-after-ms');
  if (ms && ms.trim() !== '') return nonNegative(Number(ms));
  const raw = headers.get('retry-after')?.trim();
  if (!raw) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return nonNegative(Number(raw) * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

export function upstreamHttpError(
  prefix: string,
  response: Response,
  bodyText: string,
  requestId: string | undefined
): UpstreamHttpError {
  const suffix = requestId ? ` (request_id=${requestId})` : '';
  return new UpstreamHttpError(`${prefix} ${response.status}: ${bodyText.slice(0, 300)}${suffix}`, {
    status: response.status,
    retryAfterMs: parseRetryAfterMs(response.headers),
    requestId
  });
}

/** Retry delay the error asks for, if it carries one. */
export function retryAfterMsOf(error: unknown): number | undefined {
  const value = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function describeStreamError(raw: unknown): { message: string; code?: string } {
  if (typeof raw === 'string') return { message: raw };
  const rec = (raw ?? {}) as Record<string, unknown>;
  const message = typeof rec.message === 'string' && rec.message ? rec.message : JSON.stringify(raw).slice(0, 300);
  const code = [rec.code, rec.type].find((v): v is string => typeof v === 'string' && v !== '');
  return code ? { message, code } : { message };
}

/** Error object a provider put in a 200 stream (`{"error": {...}}` / `response.error`). */
export function midStreamError(provider: string, raw: unknown): UpstreamStreamError {
  const { message, code } = describeStreamError(raw);
  return new UpstreamStreamError(`${provider} stream error${code ? ` (${code})` : ''}: ${message}`, code);
}

/** Body ended without the provider's completion marker: treat as a dropped connection. */
export function prematureStreamEnd(provider: string, marker: string): UpstreamStreamError {
  return new UpstreamStreamError(
    `${provider} stream ended before completion (connection closed without ${marker})`,
    'stream_incomplete'
  );
}
