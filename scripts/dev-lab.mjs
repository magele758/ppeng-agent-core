#!/usr/bin/env node
/**
 * 一键本地调试：先编译 core + daemon，再并行启动 daemon 与 Next（带 DAEMON_PROXY_TARGET）。
 * 用法：npm run dev
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveBin, sanitizeScriptEnv } from './spawn-utils.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function runTsc() {
  // Use shell:false on all platforms — `resolveBin` returns the right `.cmd`
  // suffix on Windows so we never have to rely on shell quoting.
  const r = spawnSync(resolveBin('npx'), ['tsc', '-b', 'packages/core', 'apps/daemon'], {
    cwd: root,
    stdio: 'inherit',
    env: sanitizeScriptEnv(),
    shell: false
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

runTsc();

const daemon = spawn(process.execPath, ['apps/daemon/dist/server.js'], {
  cwd: root,
  stdio: 'inherit',
  env: sanitizeScriptEnv()
});

const web = spawn(
  resolveBin('npm'),
  ['run', 'dev', '--workspace=@ppeng/agent-lab-web'],
  {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: sanitizeScriptEnv({
      ...process.env,
      DAEMON_PROXY_TARGET: process.env.DAEMON_PROXY_TARGET ?? 'http://127.0.0.1:7070'
    })
  }
);

let shuttingDown = false;

function killBoth() {
  try {
    daemon.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  try {
    web.kill('SIGTERM');
  } catch {
    /* ignore */
  }
}

function onExit(code, from) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (from === 'daemon' && code !== 0 && code !== null) {
    console.error(`[dev-lab] daemon exited with ${code}`);
  }
  killBoth();
  process.exit(typeof code === 'number' ? code : 0);
}

daemon.on('exit', (code) => onExit(code ?? 0, 'daemon'));
web.on('exit', (code) => onExit(code ?? 0, 'web'));

process.on('SIGINT', () => {
  shuttingDown = true;
  killBoth();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shuttingDown = true;
  killBoth();
  process.exit(0);
});
