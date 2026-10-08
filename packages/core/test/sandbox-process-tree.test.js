import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { DirectProvider, LinuxBwrapProvider, MacOSSandboxProvider, SandboxManager } from '../dist/sandbox/os-sandbox.js';
import { signalProcessTree, terminateProcessTree, treeKillSpawnOptions } from '../dist/sandbox/process-tree.js';
import { runToolHook } from '../dist/tools/tool-hooks.js';
import { lspSendRequest } from '../dist/tools/lsp-client.js';
import { loadTailscaleStatusFromCli } from '../dist/discovery/adapters/tailscale.js';
import { isPidAlive } from './helpers/process.js';

const vscodeJsonrpcNode = createRequire(import.meta.url).resolve('vscode-jsonrpc/node');

const POSIX = process.platform !== 'win32';
/** Pre-fix, an orphaned grandchild held stdout open and the call hung forever. */
const T = { timeout: 30_000 };

async function waitUntil(pred, deadlineMs = 15_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return pred();
}

async function readPid(pidFile) {
  assert.ok(await waitUntil(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== ''), 'grandchild started');
  return Number(readFileSync(pidFile, 'utf8').trim());
}

/** Exercise the real timeout callback after readiness, not a race against shell startup. */
async function timeoutAfterReady(t, pidFile, run) {
  const realSetTimeout = globalThis.setTimeout;
  let fireDeadline;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay !== 300) return realSetTimeout(callback, delay, ...args);
    const fallback = realSetTimeout(callback, 20_000, ...args);
    let fired = false;
    fireDeadline = () => {
      if (fired) return;
      fired = true;
      clearTimeout(fallback);
      callback(...args);
    };
    return fallback;
  });
  // Attach rejection handling immediately, including startup failures.
  const completed = Promise.resolve().then(run).then(value => ({ value }), error => ({ error }));
  try {
    await readPid(pidFile);
    assert.equal(typeof fireDeadline, 'function', 'the production timeout must be scheduled');
    fireDeadline();
    const result = await completed;
    if (result.error) throw result.error;
    return result.value;
  } finally {
    fireDeadline?.();
    await completed;
  }
}

/** Shell that forks a long sleeper (the grandchild) and waits on it. */
const sleeperCommand = (pidFile) => `sleep 300 & echo $! > '${pidFile}'; wait`;
/** Same, but the grandchild ignores SIGTERM, so only the SIGKILL escalation can end it. */
const stubbornCommand = (pidFile) => `sh -c 'trap "" TERM; echo $$ > "$1"; exec sleep 300' sh '${pidFile}' & wait`;

describe('sandbox timeout kills the whole process tree', { skip: !POSIX }, () => {
  let dir;
  let fakeBin;
  const survivors = [];

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'sbx-tree-'));
    fakeBin = join(dir, 'bin');
    mkdirSync(fakeBin);
    // Stand-ins for bwrap / sandbox-exec: drop the wrapper flags, exec what follows `--`.
    const shim = '#!/bin/sh\nwhile [ $# -gt 0 ] && [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n';
    for (const name of ['bwrap', 'sandbox-exec']) {
      const p = join(fakeBin, name);
      writeFileSync(p, shim);
      chmodSync(p, 0o755);
    }
  });

  after(() => {
    for (const pid of survivors) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    }
    rmSync(dir, { recursive: true, force: true });
  });

  const pidPath = (name) => join(dir, `${name}.pid`);
  const shimEnv = () => ({ ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH}` });

  it('harness sanity: child.kill() alone leaves the grandchild running', T, async () => {
    const pidFile = pidPath('control');
    const child = spawn('/bin/sh', ['-c', sleeperCommand(pidFile)], { stdio: 'ignore' });
    const pid = await readPid(pidFile);
    survivors.push(pid);
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
    assert.equal(isPidAlive(pid), true, 'without group kill the grandchild survives');
    process.kill(pid, 'SIGKILL');
  });

  it('DirectProvider: timeout kills the grandchild', T, async (t) => {
    const pidFile = pidPath('direct');
    const result = await timeoutAfterReady(t, pidFile, () => new DirectProvider().execute(sleeperCommand(pidFile), {
      cwd: dir,
      workspace: dir,
      env: process.env,
      timeoutMs: 300
    }));
    const pid = await readPid(pidFile);
    survivors.push(pid);
    assert.equal(result.code, null);
    assert.equal(result.signal, 'SIGTERM');
    assert.ok(await waitUntil(() => !isPidAlive(pid)), `grandchild ${pid} must be gone`);
  });

  it('DirectProvider: escalates to SIGKILL when the grandchild ignores SIGTERM', T, async (t) => {
    const pidFile = pidPath('stubborn');
    await timeoutAfterReady(t, pidFile, () => new DirectProvider().execute(stubbornCommand(pidFile), {
      cwd: dir,
      workspace: dir,
      env: process.env,
      timeoutMs: 300,
      killGraceMs: 200
    }));
    const pid = await readPid(pidFile);
    survivors.push(pid);
    assert.ok(await waitUntil(() => !isPidAlive(pid)), `SIGTERM-immune grandchild ${pid} must be SIGKILLed`);
  });

  it('LinuxBwrapProvider path: timeout kills the grandchild', T, async (t) => {
    const pidFile = pidPath('bwrap');
    const result = await timeoutAfterReady(t, pidFile, () => new LinuxBwrapProvider().execute(sleeperCommand(pidFile), {
      cwd: dir,
      workspace: dir,
      env: shimEnv(),
      timeoutMs: 300
    }));
    const pid = await readPid(pidFile);
    survivors.push(pid);
    assert.equal(result.tier, 1);
    assert.ok(await waitUntil(() => !isPidAlive(pid)), `grandchild ${pid} must be gone`);
  });

  it('MacOSSandboxProvider path: timeout kills the grandchild', T, async (t) => {
    const pidFile = pidPath('seatbelt');
    const result = await timeoutAfterReady(t, pidFile, () => new MacOSSandboxProvider().execute(sleeperCommand(pidFile), {
      cwd: dir,
      workspace: dir,
      env: shimEnv(),
      timeoutMs: 300
    }));
    const pid = await readPid(pidFile);
    survivors.push(pid);
    assert.equal(result.tier, 1);
    assert.ok(await waitUntil(() => !isPidAlive(pid)), `grandchild ${pid} must be gone`);
  });

  it('SandboxManager: abort (bg_run cancel path) kills the grandchild', T, async () => {
    const pidFile = pidPath('abort');
    const ac = new AbortController();
    const running = new SandboxManager('direct').execute(sleeperCommand(pidFile), dir, { signal: ac.signal });
    const pid = await readPid(pidFile);
    survivors.push(pid);
    ac.abort();
    const result = await running;
    assert.equal(result.signal, 'SIGTERM');
    assert.ok(await waitUntil(() => !isPidAlive(pid)), `grandchild ${pid} must be gone`);
  });

  it('SandboxManager: an already-aborted signal never leaves a tree behind', T, async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await new SandboxManager('direct').execute('sleep 300', dir, { signal: ac.signal });
    assert.equal(result.signal, 'SIGTERM');
  });

  it('lspSendRequest teardown kills the language server tree', T, async () => {
    const pidFile = pidPath('lsp');
    const server = join(dir, 'fake-lsp.cjs');
    writeFileSync(
      server,
      [
        `const { spawn } = require('node:child_process');`,
        `const { writeFileSync } = require('node:fs');`,
        `const rpc = require(${JSON.stringify(vscodeJsonrpcNode)});`,
        `const sleeper = spawn('sleep', ['300'], { stdio: 'ignore' });`,
        `writeFileSync(${JSON.stringify(pidFile)}, String(sleeper.pid));`,
        `const conn = rpc.createMessageConnection(new rpc.StreamMessageReader(process.stdin), new rpc.StreamMessageWriter(process.stdout));`,
        `conn.onRequest('initialize', () => ({ capabilities: {} }));`,
        `conn.onRequest('test/ping', () => 'pong');`,
        `conn.listen();`
      ].join('\n')
    );
    const out = await lspSendRequest({ command: process.execPath, args: [server], cwd: dir }, 'test/ping', {});
    assert.equal(out, 'pong');
    const pid = await readPid(pidFile);
    survivors.push(pid);
    assert.ok(await waitUntil(() => !isPidAlive(pid)), `language-server grandchild ${pid} must be gone`);
  });

  it('tailscale status timeout kills the CLI tree', T, async (t) => {
    const pidFile = pidPath('tailscale');
    const tsBin = join(dir, 'ts-bin');
    mkdirSync(tsBin, { recursive: true });
    writeFileSync(join(tsBin, 'tailscale'), `#!/bin/sh\n${sleeperCommand(pidFile)}\n`);
    chmodSync(join(tsBin, 'tailscale'), 0o755);
    await assert.rejects(
      timeoutAfterReady(t, pidFile, () => loadTailscaleStatusFromCli({ ...process.env, PATH: `${tsBin}${delimiter}${process.env.PATH}` }, 300)),
      /timed out/
    );
    const pid = await readPid(pidFile);
    survivors.push(pid);
    assert.ok(await waitUntil(() => !isPidAlive(pid)), `tailscale grandchild ${pid} must be gone`);
  });

  it('tool hook timeout kills the hook script tree', T, async (t) => {
    const pidFile = pidPath('hook');
    const script = join(dir, 'hook.sh');
    writeFileSync(script, `#!/bin/sh\n${sleeperCommand(pidFile)}\n`);
    chmodSync(script, 0o755);
    const result = await timeoutAfterReady(t, pidFile, () => runToolHook(
      { RAW_AGENT_HOOK_PRE_TOOL: script, RAW_AGENT_HOOK_TIMEOUT_MS: '300' },
      { phase: 'pre_tool_use', toolName: 'bash', sessionId: 's1' }
    ));
    const pid = await readPid(pidFile);
    survivors.push(pid);
    assert.equal(result.block, true, 'a timed-out pre hook fails closed');
    assert.ok(await waitUntil(() => !isPidAlive(pid)), `hook grandchild ${pid} must be gone`);
  });
});

describe('real bubblewrap (only when installed)', { skip: !new LinuxBwrapProvider().isAvailable() }, () => {
  let root;
  before(() => { root = mkdtempSync(join(tmpdir(), 'bwrap-real-')); });
  after(() => rmSync(root, { recursive: true, force: true }));

  it('workspace under /tmp stays writable, existing secrets are hidden, missing ones do not abort', T, async () => {
    const ws = join(root, 'ws');
    const home = join(root, 'home');
    mkdirSync(ws);
    mkdirSync(join(home, '.ssh'), { recursive: true });
    writeFileSync(join(home, '.ssh', 'id_test'), 'not-a-key');
    const result = await new LinuxBwrapProvider().execute(`echo ok > '${ws}/out.txt'; ls -A '${home}/.ssh' | wc -l`, {
      cwd: ws,
      workspace: ws,
      env: { ...process.env, HOME: home }
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim(), '0', '~/.ssh must look empty inside the sandbox');
    assert.equal(readFileSync(join(ws, 'out.txt'), 'utf8').trim(), 'ok');
  });

  it('timeout kills the sandboxed grandchild', T, async () => {
    // A unique duration identifies our sleeper in the host process list
    // (pids inside the sandbox are namespaced by --unshare-pid).
    const marker = `299.${process.pid}`;
    const result = await new LinuxBwrapProvider().execute(`sleep ${marker} & wait`, {
      cwd: root,
      workspace: root,
      env: process.env,
      timeoutMs: 500
    });
    assert.equal(result.signal, 'SIGTERM');
    const sleeperLeft = () => {
      const r = spawnSync('ps', ['-eo', 'stat=,args='], { encoding: 'utf8' });
      return r.stdout.split('\n').some((l) => l.includes(`sleep ${marker}`) && !l.trim().startsWith('Z'));
    };
    assert.ok(await waitUntil(() => !sleeperLeft()), 'sandboxed grandchild must be gone');
  });
});

describe('process-tree helpers', () => {
  it('treeKillSpawnOptions detaches on POSIX only', () => {
    assert.deepEqual(treeKillSpawnOptions(), { detached: POSIX });
  });

  it('signalling a child without a pid or an exited group is a no-op', T, async () => {
    signalProcessTree({ pid: undefined }, 'SIGTERM');
    const child = spawn(process.execPath, ['-e', ''], { ...treeKillSpawnOptions(), stdio: 'ignore' });
    await new Promise((r) => child.once('exit', r));
    signalProcessTree(child, 'SIGTERM');
    terminateProcessTree(child, 0);
    await new Promise((r) => setTimeout(r, 10));
  });
});
