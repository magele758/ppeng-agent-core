import { createClient } from 'redis';
import { createLogger } from '../../logger.js';

export type BestEffortRedis = ReturnType<typeof createClient>;

const log = createLogger('redis');

/** After a failed connect, skip further attempts for this long so an absent Redis never adds per-call latency. */
const RECONNECT_COOLDOWN_MS = 30_000;
const lastFailureAt = new WeakMap<BestEffortRedis, number>();

/**
 * Redis is an optional accelerator everywhere it is used here (meta cache, LRU scoreboard, scheduler lock).
 * An unreachable server must therefore degrade quietly instead of crashing on an unhandled `error` event
 * or leaving a pending `connect()` that every later caller awaits forever.
 */
export function createBestEffortRedis(url: string): BestEffortRedis {
  const client = createClient({ url });
  client.on('error', (err: Error) => {
    log.debug('redis client error', err.message);
  });
  return client;
}

/** `connect()` that gives up after `timeoutMs` and drops the client so the next attempt starts clean. */
export async function connectRedisWithTimeout(client: BestEffortRedis, timeoutMs = 3_000): Promise<void> {
  const failedAt = lastFailureAt.get(client);
  if (failedAt !== undefined && Date.now() - failedAt < RECONNECT_COOLDOWN_MS) {
    throw new Error('redis unavailable (recent connect failure)');
  }
  const connecting = client.connect().then(() => undefined);
  connecting.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      connecting,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`redis connect timeout after ${timeoutMs}ms`)), timeoutMs);
        timer.unref?.();
      })
    ]);
  } catch (e) {
    lastFailureAt.set(client, Date.now());
    try {
      await client.disconnect();
    } catch {
      /* already closed */
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
