import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { DirectProvider, LinuxBwrapProvider, MacOSSandboxProvider, SandboxManager } from '../dist/sandbox/os-sandbox.js';
import { signalProcessTree, terminateProcessTree, treeKillSpawnOptions } from '../dist/sandbox/process-tree.js';
import { runToolHook } from '../dist/tools/tool-hooks.js';
import { isPidAlive } from './helpers/process.js';

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

/** Shell that forks a long sleeper (the grandchild) and waits on it. */
const sleeperCommand = (pidFile) => `sleep 300 & echo $! > '${pidFile}'; wait`;
/** Same, but the grandchild ignores SIGTERM, so only the SIGKILL escalation can end it. */
const stubbornCommand = (pidFile) => `(trap '' TERM; exec sleep 300) & echo $! > '${pidFile}'; wait`;

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

  it('DirectProvider: timeout kills the grandchild', T, async () => {
    const pidFile = pidPath('direct');
    const result = await new DirectProvider().execute(sleeperCommand(pidFile), {
      cwd: dir,
      workspace: dir,
      env: process.env,
      timeoutMs: 300
    });
    const pid = await readPid(pidFile);
    survivors.push(pid);
    assert.equal(result.code, null);
    assert.equal(result.signal, 'SIGTERM');
    assert.ok(await waitUntil(() => !isPidAlive(pid)), `grandchild ${pid} must be gone`);
  });

  it('DirectProvider: escalates to SIGKILL when the grandchild ignores SIGTERM', T, async () => {
    const pidFile = pidPath('stubborn');
    await new DirectProvider().execute(stubbornCommand(pidFile), {
      cwd: dir,
      workspace: dir,
      env: process.env,
      timeoutMs: 300,
      killGraceMs: 200
    });
    const pid = await readPid(pidFile);
    survivors.push(pid);
    assert.ok(await waitUntil(() => !isPidAlive(pid)), `SIGTERM-immune grandchild ${pid} must be SIGKILLed`);
  });

  it('LinuxBwrapProvider path: timeout kills the grandchild', T, async () => {
    const pidFile = pidPath('bwrap');
    const result = await new LinuxBwrapProvider().execute(sleeperCommand(pidFile), {
      cwd: dir,
      workspace: dir,
      env: shimEnv(),
      timeoutMs: 300
    });
    const pid = await readPid(pidFile);
    survivors.push(pid);
    assert.equal(result.tier, 1);
    assert.ok(await waitUntil(() => !isPidAlive(pid)), `grandchild ${pid} must be gone`);
  });

  it('MacOSSandboxProvider path: timeout kills the grandchild', T, async () => {
    const pidFile = pidPath('seatbelt');
    const result = await new MacOSSandboxProvider().execute(sleeperCommand(pidFile), {
      cwd: dir,
      workspace: dir,
      env: shimEnv(),
      timeoutMs: 300
    });
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

  it('tool hook timeout kills the hook script tree', T, async () => {
    const pidFile = pidPath('hook');
    const script = join(dir, 'hook.sh');
    writeFileSync(script, `#!/bin/sh\n${sleeperCommand(pidFile)}\n`);
    chmodSync(script, 0o755);
    const result = await runToolHook(
      { RAW_AGENT_HOOK_PRE_TOOL: script, RAW_AGENT_HOOK_TIMEOUT_MS: '300' },
      { phase: 'pre_tool_use', toolName: 'bash', sessionId: 's1' }
    );
    const pid = await readPid(pidFile);
    survivors.push(pid);
    assert.equal(result.block, true, 'a timed-out pre hook fails closed');
    assert.ok(await waitUntil(() => !isPidAlive(pid)), `hook grandchild ${pid} must be gone`);
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
