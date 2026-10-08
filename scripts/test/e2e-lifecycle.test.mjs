import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProcessRegistry, freePort, runWithCleanup } from '../e2e-lifecycle.mjs';

const POSIX = process.platform !== 'win32';
const lifecycleUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e-lifecycle.mjs')).href;
const quiet = () => {};

function isAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z';
    } catch {
      return false;
    }
  }
  return true;
}

async function waitUntil(pred, ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return pred();
}

async function readPid(file) {
  assert.ok(await waitUntil(() => existsSync(file) && readFileSync(file, 'utf8').trim() !== ''), `${file} written`);
  return Number(readFileSync(file, 'utf8').trim());
}

/** A "service" that forks a long-lived grandchild (like `next start` workers). */
function spawnFakeService(registry, dir, name) {
  const pidFile = join(dir, `${name}.pid`);
  const child = registry.spawnService(name, '/bin/sh', ['-c', `echo ${name}-up; sleep 300 & echo $! > '${pidFile}'; wait`]);
  const up = new Promise((r) => child.stdout.once('data', r));
  return { child, pidFile, up };
}

function silentRegistry(opts) {
  const registry = createProcessRegistry(opts);
  const dumped = [];
  const dumpLogs = registry.dumpLogs;
  registry.dumpLogs = () => dumpLogs((s) => dumped.push(s));
  return { registry, dumped };
}

test('a failing Playwright exit code still tears down services, grandchildren and the state dir', { skip: !POSIX, timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-life-'));
  const { registry, dumped } = silentRegistry({ graceMs: 1_000 });
  const stateDir = registry.trackDir(mkdtempSync(join(dir, 'state-')));
  let pids;
  const code = await runWithCleanup(
    async (reg) => {
      const a = spawnFakeService(reg, dir, 'daemon');
      const b = spawnFakeService(reg, dir, 'next');
      await Promise.all([a.up, b.up]);
      pids = [a.child.pid, b.child.pid, await readPid(a.pidFile), await readPid(b.pidFile)];
      return 1;
    },
    { registry, log: quiet }
  );
  assert.equal(code, 1);
  for (const pid of pids) assert.ok(await waitUntil(() => !isAlive(pid)), `pid ${pid} must be gone`);
  assert.equal(existsSync(stateDir), false, 'state dir removed');
  assert.match(dumped.join(''), /daemon-up/, 'service logs are dumped on failure');
  rmSync(dir, { recursive: true, force: true });
});

test('a thrown error (e.g. health timeout) still tears everything down', { skip: !POSIX, timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-life-'));
  const { registry } = silentRegistry({ graceMs: 1_000 });
  let grandchild;
  const code = await runWithCleanup(
    async (reg) => {
      const svc = spawnFakeService(reg, dir, 'daemon');
      grandchild = await readPid(svc.pidFile);
      throw new Error('Health check failed');
    },
    { registry, log: quiet }
  );
  assert.equal(code, 1);
  assert.ok(await waitUntil(() => !isAlive(grandchild)), 'grandchild gone');
  rmSync(dir, { recursive: true, force: true });
});

test('a SIGTERM-immune service is SIGKILLed after the grace period', { skip: !POSIX, timeout: 30_000 }, async () => {
  const { registry } = silentRegistry({ graceMs: 300 });
  const child = registry.spawnService('stubborn', '/bin/sh', ['-c', "trap '' TERM; echo ready; while :; do sleep 1; done"]);
  await new Promise((r) => child.stdout.once('data', r));
  const code = await runWithCleanup(async () => 0, { registry, log: quiet });
  assert.equal(code, 0);
  assert.ok(await waitUntil(() => !isAlive(child.pid)), 'stubborn leader gone');
});

test('a service that dies early fails fast through assertAlive', { timeout: 30_000 }, async () => {
  const { registry, dumped } = silentRegistry();
  const code = await runWithCleanup(
    async (reg) => {
      const child = reg.spawnService('daemon', process.execPath, ['-e', 'console.error("boom: no such module fts5"); process.exit(3)']);
      await new Promise((r) => child.once('exit', r));
      reg.assertAlive();
      return 0;
    },
    { registry, log: (e) => dumped.push(String(e)) }
  );
  assert.equal(code, 1);
  assert.match(dumped.join('\n'), /daemon exited early \(code 3/);
  assert.match(dumped.join('\n'), /no such module fts5/);
});

test('cleanup is idempotent and success skips the log dump', { timeout: 30_000 }, async () => {
  const { registry, dumped } = silentRegistry();
  const code = await runWithCleanup(async () => 0, { registry, log: quiet });
  assert.equal(code, 0);
  await registry.cleanup();
  assert.equal(dumped.length, 0);
});

test('a chatty service never blocks on a full stdout pipe', { timeout: 30_000 }, async () => {
  const { registry } = silentRegistry();
  // ~1 MiB of output: an undrained pipe would stall this process at ~64 KiB.
  const child = registry.spawnService('chatty', process.execPath, ['-e', 'process.stdout.write("x".repeat(1 << 20)); process.stdout.write("\\nDONE\\n")']);
  const [code] = await new Promise((r) => child.once('exit', (...a) => r(a)));
  assert.equal(code, 0);
  await registry.cleanup();
});

test('SIGTERM to the runner cleans up its services before exiting', { skip: !POSIX, timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-life-'));
  const pidFile = join(dir, 'grandchild.pid');
  const harness = join(dir, 'harness.mjs');
  writeFileSync(
    harness,
    `import { runWithCleanup } from ${JSON.stringify(lifecycleUrl)};
process.exitCode = await runWithCleanup(async (reg) => {
  reg.spawnService('daemon', '/bin/sh', ['-c', "sleep 300 & echo $! > '${pidFile}'; wait"]);
  await new Promise(() => {});
}, { log: () => {} });
`
  );
  const runner = spawn(process.execPath, [harness], { stdio: 'ignore' });
  const grandchild = await readPid(pidFile);
  runner.kill('SIGTERM');
  const [code] = await new Promise((r) => runner.once('exit', (...a) => r(a)));
  assert.equal(code, 143);
  assert.ok(await waitUntil(() => !isAlive(grandchild)), `grandchild ${grandchild} must be gone`);
  rmSync(dir, { recursive: true, force: true });
});

test('freePort returns a bindable loopback port', { timeout: 30_000 }, async () => {
  const port = await freePort();
  assert.ok(port > 0);
  await new Promise((resolve, reject) => {
    const srv = createServer().once('error', reject).listen(port, '127.0.0.1', () => srv.close(resolve));
  });
});
