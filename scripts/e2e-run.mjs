#!/usr/bin/env node
/**
 * 启动临时 daemon + Next 控制台（生产构建），再跑 Playwright。
 * CI：PLAYWRIGHT_BASE_URL 不设，由本脚本写入。
 * 本地对已运行中的环境：export PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 并确保 Next 的 DAEMON_PROXY_TARGET 指向 daemon。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const playwrightCli = join(repoRoot, 'node_modules', 'playwright', 'cli.js');
const nextBin = join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const webConsoleDir = join(repoRoot, 'apps', 'web-console');
const webNextBuildId = join(webConsoleDir, '.next', 'BUILD_ID');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const body = await res.json();
        if (body && body.ok === true) {
          return;
        }
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(150);
  }
  throw new Error(`Health check failed: ${lastErr?.message ?? 'unknown'}`);
}

async function waitForHttp(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch (e) {
      lastErr = e;
    }
    await sleep(200);
  }
  throw new Error(`HTTP wait failed: ${baseUrl} ${lastErr?.message ?? ''}`);
}

function spawnDaemon(port, stateDir) {
  return spawn(process.execPath, ['apps/daemon/dist/server.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RAW_AGENT_DAEMON_HOST: '127.0.0.1',
      RAW_AGENT_DAEMON_PORT: String(port),
      RAW_AGENT_STATE_DIR: stateDir,
      RAW_AGENT_E2E_ISOLATE: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function spawnNext(webPort, daemonBase) {
  return spawn(process.execPath, [nextBin, 'start', '-p', String(webPort)], {
    cwd: webConsoleDir,
    env: {
      ...process.env,
      DAEMON_PROXY_TARGET: daemonBase
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function waitExit(child, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), ms);
    child.once('exit', () => {
      clearTimeout(t);
      resolve('exited');
    });
  });
}

async function main() {
  const existing = process.env.PLAYWRIGHT_BASE_URL?.trim();
  if (existing) {
    const r = spawnSync(process.execPath, [playwrightCli, 'test'], {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: 'inherit'
    });
    process.exit(r.status ?? 1);
    return;
  }

  if (!existsSync(webNextBuildId)) {
    const b = spawnSync('npm', ['run', 'build', '--workspace=@ppeng/agent-lab-web'], {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: 'inherit',
      shell: true
    });
    if (b.status !== 0) {
      process.exit(b.status ?? 1);
      return;
    }
  }

  const daemonPort = 18_000 + Math.floor(Math.random() * 2000);
  const webPort = 28_000 + Math.floor(Math.random() * 2000);
  const stateDir = mkdtempSync(join(tmpdir(), 'ppeng-e2e-'));
  const daemonBase = `http://127.0.0.1:${daemonPort}`;
  const webBase = `http://127.0.0.1:${webPort}`;
  const childDaemon = spawnDaemon(daemonPort, stateDir);
  const childWeb = spawnNext(webPort, daemonBase);

  try {
    await waitForHealth(daemonBase, 25_000);
    await waitForHttp(webBase, 45_000);
    const r = spawnSync(process.execPath, [playwrightCli, 'test'], {
      cwd: repoRoot,
      env: { ...process.env, PLAYWRIGHT_BASE_URL: webBase },
      stdio: 'inherit'
    });
    process.exit(r.status ?? 1);
  } finally {
    childWeb.kill('SIGTERM');
    childDaemon.kill('SIGTERM');
    let exited = await waitExit(childWeb, 5000);
    if (exited === 'timeout') childWeb.kill('SIGKILL');
    exited = await waitExit(childDaemon, 5000);
    if (exited === 'timeout') childDaemon.kill('SIGKILL');
    rmSync(stateDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
