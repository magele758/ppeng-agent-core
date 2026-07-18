/**
 * Extract an upstream LLM request id for cross-system debugging.
 *
 * Gateways differ: some put `x-request-id` / `openai-request-id` on headers;
 * others (e.g. maas-proxy) only embed `request_id` or `id` in the JSON / SSE body,
 * sometimes nested inside a stringified `error` payload. These helpers are pure
 * and I/O-free so they can be unit-tested in isolation.
 */

const HEADER_CANDIDATES = [
  'x-request-id',
  'openai-request-id',
  'x-openai-request-id',
  'x-maas-request-id'
] as const;

export interface HeaderGetter {
  get(name: string): string | null;
}

/** Prefer well-known request-id headers (first hit wins). */
export function pickUpstreamRequestIdFromHeaders(
  headers: HeaderGetter | null | undefined
): string | undefined {
  if (!headers || typeof headers.get !== 'function') return undefined;
  for (const name of HEADER_CANDIDATES) {
    const v = headers.get(name)?.trim();
    if (v) return v;
  }
  return undefined;
}

export interface NestedUpstreamError {
  /** Unwrapped readable message (outer prefixes + inner text). */
  message?: string;
  requestId?: string;
  /** Inner business error code (`error_code`). */
  code?: string;
}

/**
 * Unwrap nested upstream error strings. Gateways sometimes stuff the whole
 * upstream error JSON into `error` as a string; only reading the top level
 * loses the real message and `request_id`. Walk `"prefix {json}"` layers with
 * a depth cap against pathological nesting.
 */
export function unwrapNestedUpstreamError(text: string, maxDepth = 4): NestedUpstreamError {
  const prefixes: string[] = [];
  let message: string | undefined;
  let requestId: string | undefined;
  let code: string | undefined;
  let cur = text;
  for (let depth = 0; depth < maxDepth; depth++) {
    const start = cur.indexOf('{');
    if (start === -1) break;
    let parsed: { error?: unknown; error_code?: unknown; request_id?: unknown; message?: unknown };
    try {
      parsed = JSON.parse(cur.slice(start));
    } catch {
      break;
    }
    if (!parsed || typeof parsed !== 'object') break;
    if (requestId === undefined && typeof parsed.request_id === 'string' && parsed.request_id.trim()) {
      requestId = parsed.request_id.trim();
    }
    if (code === undefined && parsed.error_code != null) {
      code = String(parsed.error_code);
    }
    const err = parsed.error;
    const next =
      typeof err === 'string'
        ? err
        : err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
          ? (err as { message: string }).message
          : typeof parsed.message === 'string'
            ? parsed.message
            : undefined;
    if (next === undefined) break;
    const prefix = cur.slice(0, start).trim().replace(/[:：]$/, '');
    if (prefix) prefixes.push(prefix);
    message = next;
    cur = next;
  }
  if (message !== undefined && prefixes.length > 0) {
    message = `${prefixes.join(': ')}: ${message}`;
  }
  return { message, requestId, code };
}

/** From a parsed JSON object: `request_id` wins over nested error, then `id`. */
export function pickUpstreamRequestIdFromRecord(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const parsed = body as { request_id?: unknown; id?: unknown; error?: unknown };
  if (typeof parsed.request_id === 'string' && parsed.request_id.trim()) {
    return parsed.request_id.trim();
  }
  if (typeof parsed.error === 'string') {
    const nested = unwrapNestedUpstreamError(parsed.error).requestId;
    if (nested) return nested;
  }
  if (typeof parsed.id === 'string' && parsed.id.trim()) {
    return parsed.id.trim();
  }
  return undefined;
}

/** From OpenAI-compatible JSON (success/error) or a single SSE `data:` line. */
export function pickUpstreamRequestIdFromJsonText(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed === '[DONE]') return undefined;

  const tryParse = (raw: string): string | undefined => {
    try {
      return pickUpstreamRequestIdFromRecord(JSON.parse(raw));
    } catch {
      return undefined;
    }
  };

  const direct = tryParse(trimmed);
  if (direct) return direct;

  for (const line of trimmed.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.startsWith('data:')) continue;
    let value = line.slice(5);
    if (value.startsWith(' ')) value = value.slice(1);
    const fromData = tryParse(value);
    if (fromData) return fromData;
  }
  return undefined;
}

/**
 * Streaming: pass bytes through while capturing the request id from the first
 * SSE data JSON. Invokes `onRequestId` once; does not rewrite the payload.
 */
export function wrapResponseToCaptureUpstreamRequestId(
  response: Response,
  onRequestId: (requestId: string) => void
): Response {
  const body = response.body;
  if (!body) return response;
  const contentType =
    typeof response.headers?.get === 'function'
      ? (response.headers.get('content-type')?.toLowerCase() ?? '')
      : '';
  if (!contentType.includes('text/event-stream')) return response;

  const decoder = new TextDecoder();
  let buffer = '';
  let captured = false;

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      if (captured) return;
      buffer += decoder.decode(chunk, { stream: true });
      if (buffer.length > 16_384) buffer = buffer.slice(0, 16_384);
      const id = pickUpstreamRequestIdFromJsonText(buffer);
      if (id) {
        captured = true;
        onRequestId(id);
      }
    }
  });

  return new Response(body.pipeThrough(transform), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

/** Treat empty / placeholder "(无)" as missing. */
export function normalizeUpstreamRequestId(value: string | undefined | null): string | undefined {
  const v = (value ?? '').trim();
  if (!v || v === '(无)') return undefined;
  return v;
}

/**
 * Combine header + body candidates. Headers win (gateway correlation id);
 * body `request_id` / `id` is the fallback used by proxies that strip headers.
 */
export function resolveUpstreamRequestId(options: {
  headers?: HeaderGetter | null;
  bodyText?: string | null;
  bodyRecord?: unknown;
}): string | undefined {
  const fromHeaders = options.headers ? pickUpstreamRequestIdFromHeaders(options.headers) : undefined;
  if (fromHeaders) return fromHeaders;
  if (options.bodyRecord !== undefined) {
    const fromRecord = pickUpstreamRequestIdFromRecord(options.bodyRecord);
    if (fromRecord) return fromRecord;
  }
  if (options.bodyText) {
    return pickUpstreamRequestIdFromJsonText(options.bodyText);
  }
  return undefined;
}
