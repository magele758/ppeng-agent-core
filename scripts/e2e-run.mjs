#!/usr/bin/env node
/**
 * 启动临时 daemon（heuristic，或使用当前 shell 已 export 的 RAW_AGENT_*），再跑 Playwright。
 * CI：PLAYWRIGHT_BASE_URL 不设，由本脚本写入。
 * 本地对已运行中的 daemon：可先 export PLAYWRIGHT_BASE_URL=http://127.0.0.1:7070 再 npx playwright test（跳过本脚本）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const playwrightCli = join(repoRoot, 'node_modules', 'playwright', 'cli.js');

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

function spawnDaemon(port, stateDir) {
  return spawn(process.execPath, ['apps/daemon/dist/server.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RAW_AGENT_DAEMON_HOST: '127.0.0.1',
      RAW_AGENT_DAEMON_PORT: String(port),
      RAW_AGENT_STATE_DIR: stateDir,
      RAW_AGENT_MODEL_PROVIDER: process.env.RAW_AGENT_MODEL_PROVIDER ?? 'heuristic'
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

  const port = 18_000 + Math.floor(Math.random() * 2000);
  const stateDir = mkdtempSync(join(tmpdir(), 'ppeng-e2e-'));
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawnDaemon(port, stateDir);

  try {
    await waitForHealth(baseUrl, 25_000);
    const r = spawnSync(process.execPath, [playwrightCli, 'test'], {
      cwd: repoRoot,
      env: { ...process.env, PLAYWRIGHT_BASE_URL: baseUrl },
      stdio: 'inherit'
    });
    process.exit(r.status ?? 1);
  } finally {
    child.kill('SIGTERM');
    const exited = await waitExit(child, 5000);
    if (exited === 'timeout') {
      child.kill('SIGKILL');
    }
    rmSync(stateDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
