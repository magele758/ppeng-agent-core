#!/usr/bin/env node
/**
 * 自动化回归：构建后启动 daemon，对关键 HTTP 接口做黑盒探测。
 * 用法：npm run build && node scripts/regression-test.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { daemonAuthHeaders, envForEphemeralDaemon } from './spawn-utils.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const expectedPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

// E14: hard-fail early when the daemon dist isn't built rather than spawning a
// child that crashes with `Cannot find module 'apps/daemon/dist/server.js'`.
const daemonEntry = join(repoRoot, 'apps', 'daemon', 'dist', 'server.js');
if (!existsSync(daemonEntry)) {
  console.error(`regression-test: ${daemonEntry} missing — run \`npm run build\` first.`);
  process.exit(2);
}

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
      ...envForEphemeralDaemon(),
      RAW_AGENT_DAEMON_HOST: '127.0.0.1',
      RAW_AGENT_DAEMON_PORT: String(port),
      RAW_AGENT_STATE_DIR: stateDir,
      RAW_AGENT_E2E_ISOLATE: '1',
      // 避免继承 .env 的 AUTO_START=1 导致自愈已占用，回归里首次 start 期望 201
      RAW_AGENT_SELF_HEAL_AUTO_START: '0'
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
    headers: daemonAuthHeaders({ 'content-type': 'application/json' }),
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

async function patchJson(url, body) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: daemonAuthHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
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

async function postRaw(url, body, contentType = 'application/json') {
  const res = await fetch(url, {
    method: 'POST',
    headers: daemonAuthHeaders({ 'content-type': contentType }),
    body,
    signal: AbortSignal.timeout(10_000)
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

async function fetchText(url, options = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), ...options });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

/** 读取 SSE 响应直到出现 event:/data: 或超时，避免强依赖完整生成结束 */
async function readSseHasEventData(streamUrl, body, timeoutMs = 25_000) {
  const res = await fetch(streamUrl, {
    method: 'POST',
    headers: daemonAuthHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) {
    return { ok: false, reason: `HTTP ${res.status}` };
  }
  const reader = res.body?.getReader();
  if (!reader) {
    return { ok: false, reason: 'no body' };
  }
  const dec = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buf += dec.decode(value, { stream: true });
    if (/\bevent:\s*\S+/m.test(buf) && /\bdata:\s*\S/m.test(buf)) {
      return { ok: true };
    }
    if (buf.length > 256 * 1024) {
      return { ok: false, reason: 'buffer cap, no sse pattern' };
    }
  }
  return { ok: false, reason: 'timeout or closed without sse pattern' };
}

function messageRoles(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => m?.role).filter(Boolean);
}

async function main() {
  const external = process.env.REGRESSION_DAEMON_URL?.trim();
  let port;
  let stateDir;
  let baseUrl;
  let child;
  let getStderr;
  if (external) {
    baseUrl = external.replace(/\/$/, '');
    child = { kill() {} };
    getStderr = () => '';
    stateDir = null;
  } else {
    port = 17_000 + Math.floor(Math.random() * 2000);
    stateDir = mkdtempSync(join(tmpdir(), 'ppeng-regression-'));
    baseUrl = `http://127.0.0.1:${port}`;
    ({ child, getStderr } = spawnDaemon({ port, stateDir }));
  }
  const failures = [];

  try {
    const health = await waitForHealth(baseUrl, 20_000);
    if (!health.adapter) {
      failures.push('health: missing adapter field');
    }
    if (!external && health.version !== expectedPkg.version) {
      failures.push(`health.version: expected ${expectedPkg.version} got ${health.version}`);
    }

    const verRes = await fetch(`${baseUrl}/api/version`, { signal: AbortSignal.timeout(5000), headers: daemonAuthHeaders() });
    if (!verRes.ok) {
      failures.push(`version: HTTP ${verRes.status}`);
    } else {
      const ver = await verRes.json();
      if (!external && ver.version !== expectedPkg.version) {
        failures.push(`api/version: expected ${expectedPkg.version} got ${ver.version}`);
      }
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

    const home = await fetchText(`${baseUrl}/`);
    if (!home.ok || home.status !== 200) {
      failures.push(`static home: HTTP ${home.status}`);
    } else if (!home.text.includes('Agent Lab')) {
      failures.push('static home: missing Agent Lab marker');
    }

    const sessList = await fetch(`${baseUrl}/api/sessions`, { signal: AbortSignal.timeout(5000), headers: daemonAuthHeaders() });
    if (!sessList.ok) {
      failures.push(`sessions list: HTTP ${sessList.status}`);
    } else {
      const sl = await sessList.json();
      if (!Array.isArray(sl.sessions)) {
        failures.push('sessions list: missing sessions array');
      }
    }

    if (chat.ok && chat.data.session?.id) {
      const sid = chat.data.session.id;
      const follow = await postJson(`${baseUrl}/api/sessions/${sid}/messages`, {
        message: '第二条回归消息',
        autoRun: true
      });
      if (!follow.ok) {
        failures.push(`session messages: HTTP ${follow.status}`);
      } else {
        const roles = messageRoles(follow.data.messages);
        if (!roles.includes('user')) {
          failures.push('session messages: expected user role in messages');
        }
        if (!roles.includes('assistant')) {
          failures.push('session messages: expected assistant role in messages');
        }
      }
      const got = await fetch(`${baseUrl}/api/sessions/${sid}`, { signal: AbortSignal.timeout(15_000) });
      if (!got.ok) {
        failures.push(`session get: HTTP ${got.status}`);
      } else {
        const gd = await got.json();
        const gr = messageRoles(gd.messages);
        if (!gr.includes('user')) {
          failures.push('session get: expected user in messages');
        }
      }

      const modelView = await fetch(`${baseUrl}/api/sessions/${sid}/model-view`, {
        signal: AbortSignal.timeout(10_000),
        headers: daemonAuthHeaders()
      });
      if (!modelView.ok) {
        failures.push(`model-view: HTTP ${modelView.status}`);
      } else {
        const mv = await modelView.json();
        if (!Array.isArray(mv.stored) || !Array.isArray(mv.modelView) || !mv.stats || !mv.policy) {
          failures.push(`model-view: expected stored/modelView/stats/policy, got ${JSON.stringify(mv).slice(0, 180)}`);
        } else if (typeof mv.stats.collapsed !== 'number' || typeof mv.stats.charsSaved !== 'number') {
          failures.push(`model-view stats: ${JSON.stringify(mv.stats).slice(0, 120)}`);
        }
      }
      const missingView = await fetch(`${baseUrl}/api/sessions/no-such-session/model-view`, {
        signal: AbortSignal.timeout(5000),
        headers: daemonAuthHeaders()
      });
      if (missingView.status !== 404) {
        failures.push(`model-view missing: expected 404, got ${missingView.status}`);
      }

      // Chat sessions return to idle after a run, so next-step steer is accepted.
      const liveSteer = await postJson(`${baseUrl}/api/sessions/${sid}/steer`, {
        text: 'insert next shot',
        target: 'next-step'
      });
      if (!liveSteer.ok) {
        failures.push(`steer live: HTTP ${liveSteer.status}`);
      } else if (liveSteer.data.status !== 'queued' || liveSteer.data.ok !== true) {
        failures.push(`steer live: expected queued, got ${JSON.stringify(liveSteer.data).slice(0, 180)}`);
      }

      const missingSteer = await postJson(`${baseUrl}/api/sessions/no-such-session/steer`, {
        text: 'ghost',
        target: 'next-step'
      });
      if (!missingSteer.ok) {
        failures.push(`steer missing: HTTP ${missingSteer.status}`);
      } else if (missingSteer.data.status !== 'rejected' || missingSteer.data.reason !== 'no_session') {
        failures.push(`steer missing: expected rejected/no_session, got ${JSON.stringify(missingSteer.data).slice(0, 180)}`);
      }

      const endedTask = await postJson(`${baseUrl}/api/sessions`, {
        mode: 'task',
        title: 'steer-ended-task',
        message: 'finish',
        autoRun: true,
        background: false
      });
      if (!endedTask.ok || !endedTask.data.session?.id) {
        failures.push(`steer-ended task: HTTP ${endedTask.status}`);
      } else {
        const tid = endedTask.data.session.id;
        const endedSteer = await postJson(`${baseUrl}/api/sessions/${tid}/steer`, {
          text: 'too late',
          target: 'next-step'
        });
        if (!endedSteer.ok) {
          failures.push(`steer ended: HTTP ${endedSteer.status}`);
        } else if (endedSteer.data.status !== 'rejected') {
          failures.push(`steer ended: expected rejected, got ${JSON.stringify(endedSteer.data).slice(0, 180)}`);
        }
      }

      const loopGet = await fetch(`${baseUrl}/api/loop/settings`, {
        signal: AbortSignal.timeout(5000),
        headers: daemonAuthHeaders()
      });
      if (!loopGet.ok) {
        failures.push(`loop settings GET: HTTP ${loopGet.status}`);
      } else {
        const ls = await loopGet.json();
        if (ls.settings?.steerDrainPolicy !== 'next_shot_only') {
          failures.push(`loop settings default: expected next_shot_only, got ${JSON.stringify(ls).slice(0, 180)}`);
        }
      }
      const loopPatch = await patchJson(`${baseUrl}/api/loop/settings`, {
        steerDrainPolicy: 'tool_launch'
      });
      if (!loopPatch.ok) {
        failures.push(`loop settings PATCH: HTTP ${loopPatch.status}`);
      } else if (loopPatch.data.settings?.steerDrainPolicy !== 'tool_launch') {
        failures.push(`loop settings PATCH: expected tool_launch, got ${JSON.stringify(loopPatch.data).slice(0, 180)}`);
      }
      const loopReset = await patchJson(`${baseUrl}/api/loop/settings`, {
        steerDrainPolicy: 'next_shot_only'
      });
      if (!loopReset.ok || loopReset.data.settings?.steerDrainPolicy !== 'next_shot_only') {
        failures.push(`loop settings reset: ${JSON.stringify(loopReset.data).slice(0, 180)}`);
      }

      const compactGet = await fetch(`${baseUrl}/api/compact/settings`, {
        signal: AbortSignal.timeout(5000),
        headers: daemonAuthHeaders()
      });
      if (!compactGet.ok) {
        failures.push(`compact settings GET: HTTP ${compactGet.status}`);
      } else {
        const cs = await compactGet.json();
        if (cs.settings?.policy !== 'keep_recent') {
          failures.push(`compact settings default: expected keep_recent, got ${JSON.stringify(cs).slice(0, 180)}`);
        }
      }
      const compactPatch = await patchJson(`${baseUrl}/api/compact/settings`, {
        policy: 'after_text_assistant'
      });
      if (!compactPatch.ok) {
        failures.push(`compact settings PATCH: HTTP ${compactPatch.status}`);
      } else if (compactPatch.data.settings?.policy !== 'after_text_assistant') {
        failures.push(
          `compact settings PATCH: expected after_text_assistant, got ${JSON.stringify(compactPatch.data).slice(0, 180)}`
        );
      }
      const compactReset = await patchJson(`${baseUrl}/api/compact/settings`, {
        policy: 'keep_recent'
      });
      if (!compactReset.ok || compactReset.data.settings?.policy !== 'keep_recent') {
        failures.push(`compact settings reset: ${JSON.stringify(compactReset.data).slice(0, 180)}`);
      }

      const providersGet = await fetch(`${baseUrl}/api/model-providers`, {
        signal: AbortSignal.timeout(5000),
        headers: daemonAuthHeaders()
      });
      if (!providersGet.ok) {
        failures.push(`model-providers GET: HTTP ${providersGet.status}`);
      } else {
        const mp = await providersGet.json();
        if (!Array.isArray(mp.options) || !mp.options.some((o) => o.providerId === 'heuristic')) {
          failures.push(`model-providers GET: missing heuristic option ${JSON.stringify(mp).slice(0, 180)}`);
        }
        if (JSON.stringify(mp).includes('apiKey":')) {
          failures.push('model-providers GET leaked apiKey');
        }
      }
      const providersPost = await postJson(`${baseUrl}/api/model-providers`, {
        kind: 'heuristic'
      });
      if (!providersPost.ok) {
        failures.push(`model-providers POST: HTTP ${providersPost.status}`);
      } else if (JSON.stringify(providersPost.data).includes('sk-')) {
        failures.push('model-providers POST leaked key-like field');
      } else if (!providersPost.data.provider?.name) {
        failures.push('model-providers POST: expected auto name for heuristic');
      }
      const previewScan = await postJson(`${baseUrl}/api/model-providers/preview-scan`, {
        kind: 'openai-compatible',
        baseUrl: 'https://example.invalid/v1',
        apiKey: 'sk-should-not-leak'
      });
      if (!previewScan.ok) {
        failures.push(`model-providers preview-scan: HTTP ${previewScan.status}`);
      } else {
        const raw = JSON.stringify(previewScan.data);
        if (raw.includes('sk-should-not-leak')) {
          failures.push('model-providers preview-scan leaked apiKey');
        }
        if (previewScan.data.ok !== false || !Array.isArray(previewScan.data.models)) {
          failures.push(
            `model-providers preview-scan: expected failed discovery, got ${raw.slice(0, 180)}`
          );
        }
      }

      const imgSess = await postJson(`${baseUrl}/api/sessions`, {
        mode: 'chat',
        title: 'regression-images',
        autoRun: false
      });
      if (!imgSess.ok || !imgSess.data.session?.id) {
        failures.push(`image session: HTTP ${imgSess.status}`);
      } else {
        const iid = imgSess.data.session.id;
        const tinyPng =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const ing = await postJson(`${baseUrl}/api/sessions/${iid}/images/ingest-base64`, {
          dataBase64: tinyPng,
          mimeType: 'image/png'
        });
        if (!ing.ok || !ing.data.asset?.id) {
          failures.push(`ingest-base64: HTTP ${ing.status} ${JSON.stringify(ing.data).slice(0, 200)}`);
        } else {
          const withImg = await postJson(`${baseUrl}/api/sessions/${iid}/messages`, {
            message: 'ping',
            imageAssetIds: [ing.data.asset.id],
            autoRun: false
          });
          if (!withImg.ok) {
            failures.push(`messages+image: HTTP ${withImg.status}`);
          } else {
            const last = withImg.data.messages?.[withImg.data.messages.length - 1];
            const hasImg = last?.parts?.some((p) => p.type === 'image');
            if (!hasImg) {
              failures.push('messages+image: expected image part on last user message');
            }
          }
        }
      }
    }

    const sseChat = await readSseHasEventData(`${baseUrl}/api/chat/stream`, {
      message: 'sse regression ping',
      title: 'sse-regression'
    });
    if (!sseChat.ok) {
      failures.push(`chat/stream SSE: ${sseChat.reason ?? 'failed'}`);
    }

    const badJson = await postRaw(`${baseUrl}/api/chat`, '{not json', 'application/json');
    if (badJson.status !== 400) {
      failures.push(`invalid JSON: expected 400 got ${badJson.status}`);
    }

    const task = await postJson(`${baseUrl}/api/sessions`, {
      mode: 'task',
      title: 'Regression task',
      description: 'noop',
      autoRun: false
    });
    if (task.status !== 201) {
      failures.push(`task session: HTTP ${task.status}`);
    } else if (!task.data.session?.id) {
      failures.push('task session: missing session id');
    } else {
      const run = await postJson(`${baseUrl}/api/sessions/${task.data.session.id}/run`, {});
      if (!run.ok) {
        failures.push(`session run: HTTP ${run.status}`);
      }
    }

    const sched = await postJson(`${baseUrl}/api/scheduler/run`, {});
    if (!sched.ok || sched.data.ok !== true) {
      failures.push(`scheduler: ${JSON.stringify(sched.data)}`);
    }

    const shealStart = await postJson(`${baseUrl}/api/self-heal/start`, {
      policy: { testPreset: 'unit', maxFixIterations: 1, autoMerge: false, autoRestartDaemon: false }
    });
    if (!shealStart.ok || !shealStart.data.run?.id) {
      failures.push(
        `self-heal start: HTTP ${shealStart.status} ${JSON.stringify(shealStart.data).slice(0, 200)}`
      );
    } else {
      const rid = shealStart.data.run.id;
      const st = await fetch(`${baseUrl}/api/self-heal/status`, { signal: AbortSignal.timeout(5000) });
      if (!st.ok) {
        failures.push(`self-heal status: HTTP ${st.status}`);
      } else {
        const sd = await st.json();
        if (!Array.isArray(sd.active)) {
          failures.push('self-heal status: missing active array');
        }
      }
      const runGet = await fetch(`${baseUrl}/api/self-heal/runs/${rid}`, { signal: AbortSignal.timeout(5000) });
      if (!runGet.ok) {
        failures.push(`self-heal runs/:id: HTTP ${runGet.status}`);
      }
      const dup = await postJson(`${baseUrl}/api/self-heal/start`, { policy: { testPreset: 'unit' } });
      if (dup.status !== 409) {
        failures.push(`self-heal start duplicate: expected 409 got ${dup.status}`);
      }
      const stop = await postJson(`${baseUrl}/api/self-heal/runs/${rid}/stop`, {});
      if (!stop.ok) {
        failures.push(`self-heal stop: HTTP ${stop.status}`);
      }
      const rrq = await fetch(`${baseUrl}/api/daemon/restart-request`, { signal: AbortSignal.timeout(5000) });
      if (!rrq.ok) {
        failures.push(`daemon restart-request: HTTP ${rrq.status}`);
      } else {
        const rd = await rrq.json();
        if (!('restartRequest' in rd)) {
          failures.push('daemon restart-request: missing restartRequest');
        }
      }
    }

    const agents = await fetch(`${baseUrl}/api/agents`, { signal: AbortSignal.timeout(5000) });
    if (!agents.ok) {
      failures.push(`agents: HTTP ${agents.status}`);
    } else {
      const a = await agents.json();
      if (!Array.isArray(a.agents) || a.agents.length === 0) {
        failures.push('agents: empty list');
      }
    }

    const traverse = await fetch(`${baseUrl}/../../package.json`, { signal: AbortSignal.timeout(5000) });
    if (traverse.status !== 404) {
      failures.push(`static traversal: expected 404 got ${traverse.status}`);
    }

    const mailAll = await fetch(`${baseUrl}/api/mailbox/all?limit=5`, { signal: AbortSignal.timeout(5000) });
    if (!mailAll.ok) {
      failures.push(`mailbox/all: HTTP ${mailAll.status}`);
    } else {
      const ma = await mailAll.json();
      if (!Array.isArray(ma.mail)) {
        failures.push('mailbox/all: missing mail array');
      }
    }

    const tracesNoSession = await fetch(`${baseUrl}/api/traces`, { signal: AbortSignal.timeout(5000) });
    if (tracesNoSession.status !== 400) {
      failures.push(`traces without sessionId: expected 400 got ${tracesNoSession.status}`);
    }

    const notFound = await fetch(`${baseUrl}/api/does-not-exist`, { signal: AbortSignal.timeout(5000) });
    if (notFound.status !== 404) {
      failures.push(`404: expected 404 got ${notFound.status}`);
    }

    // A2UI: action endpoint must accept a synthetic action and reject malformed bodies.
    if (chat.ok && chat.data.session?.id) {
      const sid = chat.data.session.id;
      const goodAction = await postJson(`${baseUrl}/api/sessions/${sid}/a2ui/action`, {
        surfaceId: 'regression-surface',
        name: 'demo.click',
        context: { foo: 'bar' },
        autoRun: false
      });
      if (!goodAction.ok) {
        failures.push(`a2ui action: HTTP ${goodAction.status} ${JSON.stringify(goodAction.data).slice(0, 200)}`);
      }
      const badAction = await postJson(`${baseUrl}/api/sessions/${sid}/a2ui/action`, {
        surfaceId: '',
        name: ''
      });
      if (badAction.status !== 400) {
        failures.push(`a2ui action validation: expected 400 got ${badAction.status}`);
      }
    }
  } catch (e) {
    failures.push(e instanceof Error ? e.message : String(e));
  } finally {
    if (!external) {
      child.kill('SIGTERM');
      const exited = await waitExit(child, 5000);
      if (exited === 'timeout') {
        child.kill('SIGKILL');
      }
      rmSync(stateDir, { recursive: true, force: true });
    }
  }

  if (failures.length > 0) {
    console.error('Regression failures:\n', failures.join('\n'));
    if (getStderr().trim()) {
      console.error('Daemon stderr (tail):\n', getStderr().slice(-2000));
    }
    process.exit(1);
  }

  console.log(
    'Regression OK:',
    baseUrl,
    '(… + static /, GET /api/sessions, session messages + GET session, chat/stream SSE prefix, …)'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
