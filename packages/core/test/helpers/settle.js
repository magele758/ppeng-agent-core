/**
 * Deterministic waits for tests that kick off background work.
 *
 * A fixed `setTimeout(resolve, 50)` "flush" races the work it waits for and
 * flakes on a loaded machine (coverage, parallel suites). These helpers wait
 * for the actual condition and only use the clock as a generous upper bound.
 */

const DEFAULT_TIMEOUT_MS = 20_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve once no session run is in flight on `runtime` (woken peers,
 * steering subagents and other fire-and-forget `runSession` calls included).
 * Runs started while settling are awaited too.
 */
export async function settleRuns(runtime, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const pending = [...runtime.runningSessions.values()];
    if (pending.length === 0) {
      // Let `.finally` handlers and freshly chained runs register before deciding.
      await new Promise((resolve) => setImmediate(resolve));
      if (runtime.runningSessions.size === 0) return;
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(`session runs still in flight after ${timeoutMs}ms: ${[...runtime.runningSessions.keys()].join(', ')}`);
    }
    await Promise.race([Promise.allSettled(pending), sleep(50)]);
  }
}

/** Poll `read()` until it returns a truthy value; `null` once `timeoutMs` passes. */
export async function waitFor(read, { timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(intervalMs);
  }
}
