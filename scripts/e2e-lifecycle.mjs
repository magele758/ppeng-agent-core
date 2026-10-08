/**
 * Process / temp-dir lifecycle for `scripts/e2e-run.mjs` (kept separate so the
 * cleanup guarantees are unit-testable without Playwright or Next).
 *
 * Guarantees:
 * - every service is spawned as its own process-group leader (POSIX) and the
 *   whole group is SIGTERMed, then SIGKILLed after a grace period;
 * - cleanup runs on success, on a non-zero exit code, on a thrown error and on
 *   SIGINT/SIGTERM/SIGHUP of the runner — never skipped by `process.exit`;
 * - tasks (Playwright) also get their own group: a signal sent to the runner
 *   alone (CI cancel, `timeout`, `kill <pid>`) never reaches the foreground
 *   group, so the runner forwards it, and SIGKILLs the group after the grace;
 * - service stdout/stderr is drained into a bounded tail (an unread pipe fills
 *   at ~64 KiB and blocks the daemon mid-test) and dumped when a run fails.
 */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer } from 'node:net';

const POSIX = process.platform !== 'win32';
const LOG_TAIL_BYTES = 64 * 1024;

function signalGroup(child, signal) {
  if (!child.pid) return;
  try {
    if (POSIX) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    /* already gone */
  }
}

function waitExit(child, ms) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    child.once('exit', () => {
      clearTimeout(t);
      resolve(true);
    });
  });
}

/** Ask the OS for a currently free loopback port (no fixed ranges to collide on reruns). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => resolve(typeof addr === 'object' && addr ? addr.port : 0));
    });
  });
}

async function stopGroup(child, signal, graceMs) {
  signalGroup(child, signal);
  if (!(await waitExit(child, graceMs))) signalGroup(child, 'SIGKILL');
  await waitExit(child, graceMs);
}

export function createProcessRegistry({ graceMs = 5_000 } = {}) {
  const services = [];
  const tasks = [];
  const dirs = new Set();
  let cleaning;

  return {
    /** Spawn a long-running service whose whole tree is torn down by cleanup(). */
    spawnService(name, command, args, options = {}) {
      const child = spawn(command, args, {
        ...options,
        detached: POSIX,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const svc = { name, child, log: '' };
      const append = (chunk) => {
        svc.log = (svc.log + chunk.toString()).slice(-LOG_TAIL_BYTES);
      };
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      child.on('error', (err) => append(`[spawn error] ${err.message}\n`));
      services.push(svc);
      return child;
    },
    /**
     * Spawn a run-to-completion task (Playwright) with inherited output.
     * Resolves to its exit code; cleanup() forwards the runner's signal to it.
     */
    spawnTask(command, args, options = {}) {
      const child = spawn(command, args, { ...options, detached: POSIX, stdio: ['ignore', 'inherit', 'inherit'] });
      tasks.push(child);
      return new Promise((resolve) => {
        child.on('error', (err) => {
          console.error(err);
          resolve(1);
        });
        child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
      });
    },
    trackDir(dir) {
      dirs.add(dir);
      return dir;
    },
    /** Throw if a service died before the run finished (fail fast instead of waiting for a timeout). */
    assertAlive() {
      for (const { name, child, log } of services) {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`${name} exited early (code ${child.exitCode}, signal ${child.signalCode})\n${log.slice(-4_000)}`);
        }
      }
    },
    dumpLogs(write = (s) => process.stderr.write(s)) {
      for (const { name, log } of services) {
        write(`\n----- ${name} (last ${LOG_TAIL_BYTES / 1024} KiB) -----\n${log || '(no output)'}\n`);
      }
    },
    /**
     * Idempotent; concurrent callers share one teardown. Tasks get `taskSignal`
     * (SIGINT lets Playwright close its browsers and report), services SIGTERM.
     */
    cleanup(taskSignal = 'SIGTERM') {
      cleaning ??= (async () => {
        await Promise.all([
          ...tasks.map((child) => stopGroup(child, taskSignal, graceMs)),
          ...services.map(({ child }) => stopGroup(child, 'SIGTERM', graceMs))
        ]);
        // The leader may exit before its descendants; make sure the group is gone.
        for (const child of [...tasks, ...services.map((svc) => svc.child)]) signalGroup(child, 'SIGKILL');
        for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
      })();
      return cleaning;
    }
  };
}

const EXIT_ON_SIGNAL = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

/**
 * Run `main(registry)` (which resolves to an exit code) and always clean up.
 * Returns the exit code instead of calling `process.exit`, so callers can set
 * `process.exitCode` and let the event loop drain.
 */
export async function runWithCleanup(main, { registry = createProcessRegistry(), log = console.error } = {}) {
  const handlers = new Map();
  for (const [signal, code] of Object.entries(EXIT_ON_SIGNAL)) {
    const handler = () => {
      log(`[e2e] ${signal} received, cleaning up child processes`);
      registry.cleanup(signal).finally(() => process.exit(code));
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  let code;
  try {
    code = await main(registry);
  } catch (err) {
    log(err);
    code = 1;
  }
  if (code !== 0) registry.dumpLogs();
  try {
    await registry.cleanup();
  } finally {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
  return code ?? 1;
}
