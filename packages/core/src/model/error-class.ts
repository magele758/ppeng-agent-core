/**
 * Upstream model error classification for the configured fallback chain.
 *
 * Adapters throw plain `Error`s whose message carries the HTTP status
 * ("Remote adapter request failed with 503: ...", "OpenAI stream failed 429: ..."),
 * and network failures arrive as `TypeError: fetch failed` with a `cause.code`.
 * Only a narrow class of errors ("the upstream is down or saturated") is worth
 * switching models for; everything else would fail identically on the backup.
 */

export type ModelErrorCategory =
  | 'server_error'
  | 'rate_limited'
  | 'timeout'
  | 'connection'
  | 'overloaded'
  | 'auth'
  | 'bad_request'
  | 'content_filter'
  | 'aborted'
  | 'watchdog'
  | 'unknown';

export interface ModelErrorClassification {
  category: ModelErrorCategory;
  /** True only for upstream outage / saturation classes (5xx, 429, timeout, connection, overloaded). */
  upstreamRetryable: boolean;
  status?: number;
}

const UPSTREAM_RETRYABLE: ReadonlySet<ModelErrorCategory> = new Set([
  'server_error',
  'rate_limited',
  'timeout',
  'connection',
  'overloaded'
]);

/** Categories that must stop the whole fallback chain, even when a backup is the one failing. */
const TERMINAL: ReadonlySet<ModelErrorCategory> = new Set(['aborted', 'watchdog', 'content_filter']);

export function isUpstreamRetryableCategory(category: ModelErrorCategory): boolean {
  return UPSTREAM_RETRYABLE.has(category);
}

export function isTerminalModelErrorCategory(category: ModelErrorCategory): boolean {
  return TERMINAL.has(category);
}

const WATCHDOG_RE = /repetition loop aborted|reasoning[ _-]?spin/i;
const ABORT_RE = /\bAbortError\b|\bsession aborted\b|\b(?:request|operation|fetch) (?:was )?aborted\b|\baborted by (?:user|signal)\b/i;
const CONTENT_FILTER_RE =
  /content[_ -]?(?:filter|policy|management)|moderation|safety[_ -]?(?:system|filter|policy|block)|responsible[ _-]?ai|flagged (?:as|by)|violates? (?:our |the )?(?:usage |content )?policy/i;
const OVERLOADED_RE = /overload|over capacity|at capacity|capacity exceeded|engine is currently overloaded/i;
const RATE_LIMIT_RE = /rate[ _-]?limit|too many requests|quota exceeded|insufficient[_ ]quota/i;
const TIMEOUT_RE = /timeout|timed out|ETIMEDOUT|UND_ERR_(?:HEADERS|BODY|CONNECT)_TIMEOUT|deadline exceeded/i;
const CONNECTION_RE =
  /fetch failed|socket hang up|network error|connection error|connection (?:reset|refused|closed|terminated)|ECONN(?:RESET|REFUSED|ABORTED)|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|UND_ERR_SOCKET|other side closed|terminated$/i;
const SERVER_RE = /service unavailable|bad gateway|gateway time-?out|internal server error|upstream (?:error|unavailable)/i;
const STATUS_IN_MESSAGE_RE = /\b(?:failed(?: with)?|status(?: code)?|http(?: error)?)[\s:=]+([1-5]\d{2})\b/i;

function errorChain(err: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let cur: unknown = err;
  for (let depth = 0; cur && typeof cur === 'object' && depth < 5; depth += 1) {
    out.push(cur as Record<string, unknown>);
    cur = (cur as Record<string, unknown>).cause;
  }
  return out;
}

function chainText(chain: Array<Record<string, unknown>>, fallback: unknown): string {
  const parts: string[] = [];
  for (const item of chain) {
    if (typeof item.message === 'string') parts.push(item.message);
    if (typeof item.code === 'string') parts.push(item.code);
    if (typeof item.name === 'string') parts.push(item.name);
  }
  if (parts.length === 0) parts.push(typeof fallback === 'string' ? fallback : '');
  return parts.join(' | ');
}

function statusOf(chain: Array<Record<string, unknown>>, text: string): number | undefined {
  for (const item of chain) {
    const raw =
      item.statusCode ?? item.status ?? (item.response as { status?: unknown } | undefined)?.status;
    const n = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof n === 'number' && Number.isInteger(n) && n >= 100 && n < 600) return n;
  }
  const m = STATUS_IN_MESSAGE_RE.exec(text);
  if (m) return Number(m[1]);
  return undefined;
}

export function classifyModelError(err: unknown): ModelErrorClassification {
  const make = (category: ModelErrorCategory, status?: number): ModelErrorClassification => ({
    category,
    upstreamRetryable: UPSTREAM_RETRYABLE.has(category),
    ...(status !== undefined ? { status } : {})
  });

  if (err === null || err === undefined) return make('unknown');
  const chain = errorChain(err);
  const text = chainText(chain, typeof err === 'string' ? err : '');
  const names = chain.map((c) => (typeof c.name === 'string' ? c.name : ''));

  if (names.includes('RepetitionLoopAbortError') || WATCHDOG_RE.test(text)) return make('watchdog');
  if (names.includes('TimeoutError')) return make('timeout', statusOf(chain, text));
  if (names.includes('AbortError') || chain.some((c) => c.code === 'ABORT_ERR') || ABORT_RE.test(text)) {
    return make('aborted');
  }
  if (chain.some((c) => c.code === 'content_filter' || c.type === 'content_filter') || CONTENT_FILTER_RE.test(text)) {
    return make('content_filter', statusOf(chain, text));
  }

  const status = statusOf(chain, text);
  if (status !== undefined) {
    if (status === 429) return make('rate_limited', status);
    if (status === 408 || status === 504) return make(status === 504 ? 'server_error' : 'timeout', status);
    if (status === 529) return make('overloaded', status);
    if (status >= 500) return make(OVERLOADED_RE.test(text) ? 'overloaded' : 'server_error', status);
    if (status === 401 || status === 403) return make('auth', status);
    if (status >= 400) return make('bad_request', status);
    return make('unknown', status);
  }

  if (OVERLOADED_RE.test(text)) return make('overloaded');
  if (RATE_LIMIT_RE.test(text)) return make('rate_limited');
  if (TIMEOUT_RE.test(text)) return make('timeout');
  if (CONNECTION_RE.test(text)) return make('connection');
  if (SERVER_RE.test(text)) return make('server_error');
  return make('unknown');
}
