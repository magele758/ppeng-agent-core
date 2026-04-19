/**
 * Tiny in-memory token bucket — protects model-spending endpoints from
 * accidental loops or runaway scripts. Per-IP keying; sliding window via
 * continuous refill (`tokens += elapsed * rate`).
 *
 * Defaults are intentionally lenient (1 req/sec, burst 10) since this is a
 * single-tenant local daemon. Tighten with `RAW_AGENT_RATE_LIMIT_*` env vars
 * for shared deployments.
 *
 * Out of scope:
 *   - persistent / multi-process limits — restart resets the buckets.
 *   - per-API-key shaping — there is no auth model here yet.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export interface RateLimitConfig {
  /** Tokens added per second. Default 1. */
  ratePerSec: number;
  /** Maximum tokens (burst capacity). Default 10. */
  burst: number;
  /** Eviction TTL for idle buckets (ms). Default 5 minutes. */
  idleTtlMs: number;
  /** Hard cap on the number of tracked IPs to prevent unbounded memory growth. Default 10 000. */
  maxBuckets: number;
  /** Only trust X-Forwarded-For when explicitly opted in via RAW_AGENT_TRUST_PROXY=1. */
  trustProxy: boolean;
}

export function rateLimitConfigFromEnv(env: NodeJS.ProcessEnv): RateLimitConfig {
  const num = (k: string, fallback: number): number => {
    const v = Number(env[k]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    ratePerSec: num('RAW_AGENT_RATE_LIMIT_PER_SEC', 1),
    burst: num('RAW_AGENT_RATE_LIMIT_BURST', 10),
    idleTtlMs: num('RAW_AGENT_RATE_LIMIT_IDLE_MS', 5 * 60_000),
    maxBuckets: num('RAW_AGENT_RATE_LIMIT_MAX_BUCKETS', 10_000),
    trustProxy: ['1', 'true', 'yes'].includes(
      String(env.RAW_AGENT_TRUST_PROXY ?? '').toLowerCase().trim()
    )
  };
}

export interface RateLimiter {
  /**
   * Acquire one token for `key`. Returns `{ ok: true }` when allowed; or
   * `{ ok: false, retryAfterMs }` when throttled (caller should respond 429).
   */
  take(key: string): { ok: true } | { ok: false; retryAfterMs: number };
  /** Periodic eviction — drop buckets idle longer than `idleTtlMs`. */
  sweep(): void;
}

export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const buckets = new Map<string, Bucket>();
  return {
    take(key) {
      const now = Date.now();
      let b = buckets.get(key);
      if (!b) {
        // Cap the map to avoid unbounded memory growth from XFF-spoofing or
        // many distinct clients. When full, reject all new IPs as throttled.
        if (buckets.size >= config.maxBuckets) {
          return { ok: false, retryAfterMs: 1000 };
        }
        b = { tokens: config.burst, lastRefillMs: now };
        buckets.set(key, b);
      } else {
        const elapsedSec = (now - b.lastRefillMs) / 1000;
        b.tokens = Math.min(config.burst, b.tokens + elapsedSec * config.ratePerSec);
        b.lastRefillMs = now;
      }
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return { ok: true };
      }
      const need = 1 - b.tokens;
      return { ok: false, retryAfterMs: Math.ceil((need / config.ratePerSec) * 1000) };
    },
    sweep() {
      const now = Date.now();
      for (const [k, b] of buckets) {
        // Evict purely on idle TTL — the old `tokens >= burst` guard prevented
        // any partially-drained bucket from being cleaned, causing a slow leak.
        if (now - b.lastRefillMs > config.idleTtlMs) {
          buckets.delete(k);
        }
      }
    }
  };
}

/**
 * Client identity for rate-limiting. Only trusts X-Forwarded-For when the
 * operator explicitly sets `RAW_AGENT_TRUST_PROXY=1`; otherwise uses the TCP
 * socket address so a malicious LAN client cannot spoof someone else's bucket.
 */
export function clientKeyFromRequest(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = request.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
  }
  return request.socket.remoteAddress ?? 'unknown';
}

/** Reply with 429 + Retry-After header. */
export function rejectRateLimited(
  response: ServerResponse<IncomingMessage>,
  retryAfterMs: number
): void {
  response.statusCode = 429;
  response.setHeader('retry-after', Math.max(1, Math.ceil(retryAfterMs / 1000)));
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify({ error: 'rate limited', retryAfterMs }));
}
