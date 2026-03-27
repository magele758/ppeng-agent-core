#!/usr/bin/env node
/**
 * 自动化回归：构建后启动 daemon，对关键 HTTP 接口做黑盒探测。
 * 用法：npm run build && node scripts/regression-test.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

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
          return body;
        }
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(150);
  }
  throw new Error(`Health check failed within ${timeoutMs}ms: ${lastErr?.message ?? 'unknown'}`);
}

function spawnDaemon({ port, stateDir }) {
  const child = spawn(process.execPath, ['apps/daemon/dist/server.js'], {
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

  let stderr = '';
  child.stderr?.on('data', (c) => {
    stderr += c.toString();
  });

  return { child, getStderr: () => stderr };
}

async function waitExit(child, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), ms);
    child.once('exit', (code, signal) => {
      clearTimeout(t);
      resolve({ code, signal });
    });
  });
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000)
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const port = 17_000 + Math.floor(Math.random() * 2000);
  const stateDir = mkdtempSync(join(tmpdir(), 'ppeng-regression-'));
  const baseUrl = `http://127.0.0.1:${port}`;

  const { child, getStderr } = spawnDaemon({ port, stateDir });
  const failures = [];

  try {
    const health = await waitForHealth(baseUrl, 20_000);
    if (!health.adapter) {
      failures.push('health: missing adapter field');
    }

    const chat = await postJson(`${baseUrl}/api/chat`, {
      title: 'regression',
      message: '你好'
    });
    if (!chat.ok) {
      failures.push(`chat: HTTP ${chat.status} ${JSON.stringify(chat.data).slice(0, 200)}`);
    } else if (!chat.data.session?.id) {
      failures.push('chat: missing session.id');
    } else if (typeof chat.data.latestAssistant !== 'string' || !chat.data.latestAssistant) {
      failures.push('chat: missing latestAssistant');
    }

    const task = await postJson(`${baseUrl}/api/sessions`, {
      mode: 'task',
      title: 'Regression task',
      description: 'noop',
      autoRun: false
    });
    if (task.status !== 201) {
      failures.push(`task session: HTTP ${task.status}`);
    }

    const notFound = await fetch(`${baseUrl}/api/does-not-exist`, { signal: AbortSignal.timeout(5000) });
    if (notFound.status !== 404) {
      failures.push(`404: expected 404 got ${notFound.status}`);
    }
  } catch (e) {
    failures.push(e instanceof Error ? e.message : String(e));
  } finally {
    child.kill('SIGTERM');
    const exited = await waitExit(child, 5000);
    if (exited === 'timeout') {
      child.kill('SIGKILL');
    }
    rmSync(stateDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error('Regression failures:\n', failures.join('\n'));
    if (getStderr().trim()) {
      console.error('Daemon stderr (tail):\n', getStderr().slice(-2000));
    }
    process.exit(1);
  }

  console.log('Regression OK:', baseUrl, '(health + chat + task create + 404)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
