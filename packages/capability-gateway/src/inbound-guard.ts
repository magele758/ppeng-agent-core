import { createHash, timingSafeEqual } from 'node:crypto';

/** Constant-time string comparison (length-independent via hashing). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Feishu request signature: sha256(timestamp + nonce + encryptKey + rawBody), hex.
 * Sent in X-Lark-Request-Timestamp / X-Lark-Request-Nonce / X-Lark-Signature.
 */
export function verifyFeishuSignature(input: {
  rawBody: string;
  encryptKey: string;
  timestamp?: string;
  nonce?: string;
  signature?: string;
}): boolean {
  if (!input.timestamp || !input.nonce || !input.signature) return false;
  const expected = createHash('sha256')
    .update(input.timestamp + input.nonce + input.encryptKey + input.rawBody, 'utf8')
    .digest('hex');
  return safeEqual(expected, input.signature.toLowerCase());
}

/** Empty allowlist = unrestricted; otherwise any candidate id must be listed. */
export function isSenderAllowed(allowed: readonly string[], candidates: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  return candidates.some((c) => c && allowed.includes(c));
}

const DEDUPE_TTL_MS = 6 * 60 * 60 * 1000;
const DEDUPE_MAX = 10_000;
const seen = new Map<string, number>();

/**
 * Atomically claim an inbound event id. Returns false when it was already claimed
 * (platform retry / replay). Synchronous so concurrent deliveries cannot both win.
 * In-memory: a daemon restart forgets claims, which only matters for retries that
 * straddle the restart.
 */
export function claimInboundEvent(key: string, now = Date.now()): boolean {
  const at = seen.get(key);
  if (at !== undefined && now - at < DEDUPE_TTL_MS) return false;
  seen.delete(key);
  seen.set(key, now);
  if (seen.size > DEDUPE_MAX) {
    for (const [k, t] of seen) {
      if (seen.size <= DEDUPE_MAX && now - t < DEDUPE_TTL_MS) break;
      seen.delete(k);
    }
  }
  return true;
}

export function resetInboundDedupe(): void {
  seen.clear();
}

const lanes = new Map<string, Promise<void>>();
const inflight = new Set<Promise<void>>();

/**
 * Run `task` in the background, serialized per `laneKey` so turns of one
 * conversation never interleave. Errors go to `onError`; never rejects.
 */
export function scheduleGatewayTurn(
  laneKey: string,
  task: () => Promise<void>,
  onError: (e: unknown) => void = (e) => console.error('[gateway] background turn failed', e)
): void {
  const prev = lanes.get(laneKey) ?? Promise.resolve();
  const run: Promise<void> = prev
    .then(task)
    .catch(onError)
    .finally(() => {
      inflight.delete(run);
      if (lanes.get(laneKey) === run) lanes.delete(laneKey);
    });
  lanes.set(laneKey, run);
  inflight.add(run);
}

/** Resolves once all scheduled background turns have settled (tests / graceful shutdown). */
export async function drainGatewayTurns(): Promise<void> {
  while (inflight.size > 0) {
    await Promise.allSettled([...inflight]);
  }
}
