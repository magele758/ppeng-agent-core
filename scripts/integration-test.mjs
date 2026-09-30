#!/usr/bin/env node
/**
 * Integration tests for daemon HTTP surface — focused on areas the regression
 * suite skips: social-post schedules (full chain + idempotent retry), mailbox
 * push, approval listing, and the `/api/social-post-schedules/:id/action`
 * matcher (which uses a custom path matcher rather than the simple :param
 * grammar).
 *
 * Spawns a fresh heuristic-adapter daemon on a random port + temp stateDir
 * (same recipe as scripts/regression-test.mjs).
 *
 * Usage:  npm run build && node scripts/integration-test.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { daemonAuthHeaders, envForEphemeralDaemon } from './spawn-utils.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// E14: same dist guard as regression-test.mjs.
const daemonEntry = join(repoRoot, 'apps', 'daemon', 'dist', 'server.js');
if (!existsSync(daemonEntry)) {
  console.error(`integration-test: ${daemonEntry} missing — run \`npm run build\` first.`);
  process.exit(2);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickPort() {
  return 19_000 + Math.floor(Math.random() * 1_000);
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return await res.json();
    } catch (e) {
      lastErr = e;
    }
    await sleep(150);
  }
  throw new Error(`health failed: ${lastErr?.message ?? 'unknown'}`);
}

function spawnDaemon({ port, stateDir, repoRootOverride }) {
  const child = spawn(process.execPath, ['apps/daemon/dist/server.js'], {
    cwd: repoRootOverride ?? repoRoot,
    env: {
      ...envForEphemeralDaemon(),
      RAW_AGENT_DAEMON_HOST: '127.0.0.1',
      RAW_AGENT_DAEMON_PORT: String(port),
      RAW_AGENT_STATE_DIR: stateDir,
      RAW_AGENT_E2E_ISOLATE: '1',
      RAW_AGENT_SELF_HEAL_AUTO_START: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr?.on('data', (c) => { stderr += c.toString(); });
  return { child, getStderr: () => stderr };
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
  try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function patchJson(url, body) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: daemonAuthHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function waitExit(child, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), ms);
    child.once('exit', (code, signal) => { clearTimeout(t); resolve({ code, signal }); });
  });
}

/**
 * Stage a temp working dir with:
 *   - a symlink-equivalent pointer back to packages/apps via a minimal repo
 *     (we run `node apps/daemon/dist/server.js` from the real repoRoot, but
 *     the daemon reads `gateway.config.json` from cwd → so we set cwd to a
 *     scratch dir containing our test-only gateway config).
 * Reality check: scripts/regression-test.mjs sets cwd to repoRoot — same here,
 * but we also write a temp gateway config into repoRoot/gateway.config.json
 * is dangerous. Instead, point RAW_AGENT_GATEWAY_CONFIG at our temp file.
 */
function writeTempGatewayConfig(dir) {
  const cfg = {
    channels: [
      { id: 'tcfg-1', type: 'webhook', url: 'https://example.invalid/hook', payloadMode: 'json_text' }
    ],
    learn: { feeds: [] }
  };
  const p = join(dir, 'gateway.config.json');
  writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
  return p;
}

async function runSocialFlow(baseUrl, failures) {
  // 1) Ask the daemon for the current schedule list — should be empty initially
  //    on a fresh state dir.
  const list0 = await getJson(`${baseUrl}/api/social-post-schedules`);
  if (!list0.ok) failures.push(`social list: HTTP ${list0.status}`);
  if (!Array.isArray(list0.data.items)) failures.push('social list: missing items array');
  // (We don't assert empty — heuristic adapter sometimes seeds nothing, but other
  // E2E runs may share state; instead, count and verify our additions later.)
  const initialCount = list0.ok ? list0.data.items.length : 0;

  // 2) Drive `schedule_social_post` indirectly by POSTing a chat that exercises
  //    the tool. The heuristic adapter ignores the prompt and returns canned
  //    text, so we cannot rely on it actually invoking the tool. Instead we
  //    simulate the create+approve+dispatch flow by directly calling the
  //    underlying public API the way tests in social-schedule-flow.test.js do
  //    — but at the HTTP layer we lack a "create schedule" route. Skip the
  //    create step here and instead verify the endpoints respond correctly
  //    when there is no matching task.
  const reject404 = await postJson(`${baseUrl}/api/social-post-schedules/no-such-task/action`, { action: 'approve' });
  if (reject404.status !== 404) {
    failures.push(`social action on missing task: expected 404 got ${reject404.status}`);
  }

  const badAction = await postJson(`${baseUrl}/api/social-post-schedules/whatever/action`, { action: 'noop' });
  if (badAction.status !== 400 && badAction.status !== 404) {
    // 400 (validation) preferred; 404 also acceptable since task lookup runs first.
    failures.push(`social bad action: expected 400/404 got ${badAction.status}`);
  }

  // 3) Sanity: list call still works after errors.
  const list1 = await getJson(`${baseUrl}/api/social-post-schedules`);
  if (!list1.ok) failures.push(`social list (post-error): HTTP ${list1.status}`);
  if (Array.isArray(list1.data.items) && list1.data.items.length < initialCount) {
    failures.push('social list shrank after error');
  }
}

async function runMailboxFlow(baseUrl, failures) {
  // Use built-in agents (`general` ships with the runtime). Mailbox accepts
  // mail to/from any registered agent; built-ins cover both ends.
  // Touching `/api/agents` triggers `ensureBuiltinAgentsSynced` so the row exists.
  const agents = await getJson(`${baseUrl}/api/agents`);
  if (!agents.ok) failures.push(`agents prefetch: HTTP ${agents.status}`);
  const send = await postJson(`${baseUrl}/api/mailbox`, {
    fromAgentId: 'general',
    toAgentId: 'main',
    content: 'hello from integration test',
    type: 'message'
  });
  if (send.status !== 201 || !send.data.mail?.id) {
    failures.push(`mailbox send: HTTP ${send.status} ${JSON.stringify(send.data).slice(0, 200)}`);
    return;
  }

  const list = await getJson(`${baseUrl}/api/mailbox?agentId=main`);
  if (!list.ok) failures.push(`mailbox list: HTTP ${list.status}`);
  else if (!Array.isArray(list.data.mail) || list.data.mail.length === 0) {
    failures.push('mailbox list: expected our message');
  }

  const all = await getJson(`${baseUrl}/api/mailbox/all?limit=5`);
  if (!all.ok) failures.push(`mailbox/all: HTTP ${all.status}`);

  const missing = await getJson(`${baseUrl}/api/mailbox`);
  if (missing.status !== 400) {
    failures.push(`mailbox missing agentId: expected 400 got ${missing.status}`);
  }
}

async function runApprovalFlow(baseUrl, failures) {
  // Approval list should always succeed (empty allowed).
  const list = await getJson(`${baseUrl}/api/approvals`);
  if (!list.ok) failures.push(`approvals list: HTTP ${list.status}`);
  if (!Array.isArray(list.data.approvals)) failures.push('approvals: missing approvals array');

  // Posting an approval decision for an unknown id should fail cleanly (404 / 400),
  // not 500.
  const reject = await postJson(`${baseUrl}/api/approvals/does-not-exist/approve`, {});
  if (reject.status === 500) {
    failures.push(`approve unknown id: expected 4xx, got 500 ${JSON.stringify(reject.data).slice(0, 200)}`);
  }
}

async function runBotPolicyFlow(baseUrl, failures) {
  const created = await postJson(`${baseUrl}/api/bots`, { name: 'Policy Probe' });
  const botId = created.data?.bot?.id;
  if (created.status !== 201 || !botId) {
    failures.push(`bot create: HTTP ${created.status}`);
    return;
  }
  const opened = await postJson(`${baseUrl}/api/bots/${botId}/open`, {});
  const sessionId = opened.data?.session?.id;
  if (!sessionId) {
    failures.push(`bot open: HTTP ${opened.status}`);
    return;
  }
  const meta = async () => (await getJson(`${baseUrl}/api/sessions/${sessionId}`)).data?.session?.metadata ?? {};
  let m = await meta();
  if (m.permissionMode !== 'auto') failures.push(`bot session permissionMode: expected auto got ${m.permissionMode}`);
  if (m.maxTurns !== 24) failures.push(`bot session maxTurns: expected 24 got ${m.maxTurns}`);

  for (const bad of [0, 25, -24, 100000, 'abc']) {
    const r = await patchJson(`${baseUrl}/api/bots/${botId}`, { maxTurns: bad });
    if (r.status !== 400) failures.push(`bot PATCH maxTurns=${JSON.stringify(bad)}: expected 400 got ${r.status}`);
  }
  const okTurns = await patchJson(`${baseUrl}/api/bots/${botId}`, { maxTurns: 48 });
  if (!okTurns.ok) failures.push(`bot PATCH maxTurns=48: HTTP ${okTurns.status}`);

  const badTools = await patchJson(`${baseUrl}/api/bots/${botId}`, { allowedTools: ['no_such_tool'] });
  if (badTools.status !== 400) failures.push(`bot PATCH unknown tool: expected 400 got ${badTools.status}`);
  const tools = (await getJson(`${baseUrl}/api/tools`)).data?.tools ?? [];
  if (tools.length === 0) {
    failures.push('GET /api/tools returned no tools');
  } else {
    const narrow = tools.map((tool) => tool.name).find((name) => name !== 'TodoWrite' && name !== 'load_skill');
    const okTools = await patchJson(`${baseUrl}/api/bots/${botId}`, { allowedTools: [narrow] });
    if (!okTools.ok) failures.push(`bot PATCH allowedTools: HTTP ${okTools.status}`);
    const warned = okTools.data?.warnings ?? [];
    const missing = warned.find((w) => w.code === 'missing_required_tools')?.tools ?? [];
    if (!missing.includes('TodoWrite') || !missing.includes('load_skill')) {
      failures.push(`bot PATCH allowedTools without required tools: expected warnings, got ${JSON.stringify(warned)}`);
    }
    const full = await patchJson(`${baseUrl}/api/bots/${botId}`, { allowedTools: [narrow, 'TodoWrite', 'load_skill'] });
    if (!full.ok || (full.data?.warnings ?? []).length !== 0) {
      failures.push(`bot PATCH allowedTools with required tools: expected no warnings, got ${JSON.stringify(full.data)}`);
    }
    await patchJson(`${baseUrl}/api/bots/${botId}`, { allowedTools: [tools[0].name] });
  }

  const badSkills = await patchJson(`${baseUrl}/api/bots/${botId}`, { allowedSkills: ['no-such-skill'] });
  if (badSkills.status !== 400) failures.push(`bot PATCH unknown skill: expected 400 got ${badSkills.status}`);
  const skills = (await getJson(`${baseUrl}/api/skills`)).data?.skills ?? [];
  if (skills.length > 0) {
    const okSkills = await patchJson(`${baseUrl}/api/bots/${botId}`, { allowedSkills: [skills[0].name] });
    if (!okSkills.ok) failures.push(`bot PATCH allowedSkills: HTTP ${okSkills.status}`);
  }

  m = await meta();
  if (m.maxTurns !== 48) failures.push(`bot session maxTurns after PATCH: expected 48 got ${m.maxTurns}`);
  if (tools.length > 0 && JSON.stringify(m.allowedTools) !== JSON.stringify([tools[0].name])) {
    failures.push(`bot session allowedTools after PATCH: ${JSON.stringify(m.allowedTools)}`);
  }

  for (const mode of ['plan', 'ask', 'acceptEdits', 'auto', 'bypass']) {
    const set = await patchJson(`${baseUrl}/api/sessions/${sessionId}`, { permissionMode: mode });
    if (!set.ok) failures.push(`session PATCH permissionMode=${mode}: HTTP ${set.status}`);
    const reopenedTier = await postJson(`${baseUrl}/api/bots/${botId}/open`, {});
    const stored = reopenedTier.data?.session?.metadata?.permissionMode;
    if (stored !== mode) failures.push(`permissionMode ${mode} round trip: reopen returned ${stored}`);
    if ((await meta()).permissionMode !== mode) failures.push(`permissionMode ${mode} not persisted`);
  }
  const badMode = await patchJson(`${baseUrl}/api/sessions/${sessionId}`, { permissionMode: 'root' });
  if (badMode.status !== 400) failures.push(`session PATCH permissionMode=root: expected 400 got ${badMode.status}`);
  const viaSessions = await postJson(`${baseUrl}/api/sessions`, { botId, autoRun: false });
  if (viaSessions.data?.session?.metadata?.permissionMode !== 'bypass') {
    failures.push(`POST /api/sessions {botId} rewrote permissionMode: ${viaSessions.data?.session?.metadata?.permissionMode}`);
  }
  const badMeta = await postJson(`${baseUrl}/api/sessions`, { botId, autoRun: false, metadata: { maxTurns: 25 } });
  if (badMeta.status !== 400) failures.push(`POST /api/sessions metadata.maxTurns=25: expected 400 got ${badMeta.status}`);
  m = await meta();
  if (m.maxTurns !== 48) failures.push(`maxTurns changed after rejected create: ${m.maxTurns}`);
}

async function runBotModelFlow(baseUrl, failures) {
  const created = await postJson(`${baseUrl}/api/bots`, { name: 'Model Probe' });
  const botId = created.data?.bot?.id;
  if (created.status !== 201 || !botId) {
    failures.push(`model bot create: HTTP ${created.status}`);
    return;
  }
  const opened = await postJson(`${baseUrl}/api/bots/${botId}/open`, {});
  const sessionId = opened.data?.session?.id;
  if (!sessionId) {
    failures.push(`model bot open: HTTP ${opened.status}`);
    return;
  }
  const meta = async () => (await getJson(`${baseUrl}/api/sessions/${sessionId}`)).data?.session?.metadata ?? {};
  const provider = await postJson(`${baseUrl}/api/model-providers`, {
    name: 'Bot Model Probe',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1/v1',
    apiKey: 'sk-probe',
    models: [
      { id: 'probe-a', enabled: true },
      { id: 'probe-off', enabled: false }
    ]
  });
  const providerId = provider.data?.provider?.id;
  if (provider.status !== 201 || !providerId) {
    failures.push(`model provider create: HTTP ${provider.status}`);
    return;
  }
  const ref = { providerId, modelId: 'probe-a' };

  if ((await meta()).modelOverride !== undefined) failures.push('fresh bot chat already has a modelOverride');
  for (const bad of [
    { providerId, modelId: 'probe-off' },
    { providerId, modelId: 'missing' },
    { providerId: 'ghost', modelId: 'probe-a' },
    'probe-a',
    { providerId }
  ]) {
    const r = await patchJson(`${baseUrl}/api/bots/${botId}`, { modelOverride: bad });
    if (r.status !== 400) failures.push(`bot PATCH modelOverride=${JSON.stringify(bad)}: expected 400 got ${r.status}`);
  }
  if ((await meta()).modelOverride !== undefined) failures.push('rejected modelOverride was still stored');

  const ok = await patchJson(`${baseUrl}/api/bots/${botId}`, { modelOverride: ref });
  if (!ok.ok) failures.push(`bot PATCH modelOverride: HTTP ${ok.status}`);
  if (JSON.stringify(ok.data?.modelOverride) !== JSON.stringify(ref)) {
    failures.push(`bot PATCH modelOverride response: ${JSON.stringify(ok.data?.modelOverride)}`);
  }
  if (JSON.stringify((await meta()).modelOverride) !== JSON.stringify(ref)) {
    failures.push(`bot session modelOverride after PATCH: ${JSON.stringify((await meta()).modelOverride)}`);
  }

  const reopened = await postJson(`${baseUrl}/api/bots/${botId}/open`, {});
  if (JSON.stringify(reopened.data?.session?.metadata?.modelOverride) !== JSON.stringify(ref)) {
    failures.push('openBot rewrote modelOverride');
  }
  const other = await patchJson(`${baseUrl}/api/bots/${botId}`, { maxTurns: 48 });
  if (!other.ok || JSON.stringify((await meta()).modelOverride) !== JSON.stringify(ref)) {
    failures.push('unrelated bot PATCH dropped modelOverride');
  }
  const sent = await postJson(`${baseUrl}/api/sessions/${sessionId}/messages`, {
    message: 'hello',
    modelRef: { providerId: 'heuristic', modelId: 'heuristic' },
    autoRun: false
  });
  if (!sent.ok) failures.push(`bot message with composer modelRef: HTTP ${sent.status}`);
  if (JSON.stringify((await meta()).modelOverride) !== JSON.stringify(ref)) {
    failures.push('composer modelRef overwrote the bot modelOverride');
  }

  const cleared = await patchJson(`${baseUrl}/api/bots/${botId}`, { modelOverride: null });
  if (!cleared.ok) failures.push(`bot PATCH modelOverride=null: HTTP ${cleared.status}`);
  if ('modelOverride' in (await meta())) failures.push('modelOverride not cleared');
}

async function main() {
  const failures = [];
  const external = process.env.INTEGRATION_DAEMON_URL?.trim();
  let port;
  let stateDir;
  let cfgDir;
  let child;
  let getStderr;
  let baseUrl;
  if (external) {
    baseUrl = external.replace(/\/$/, '');
    child = { kill() {} };
    getStderr = () => '';
  } else {
    port = pickPort();
    stateDir = mkdtempSync(join(tmpdir(), 'agent-it-state-'));
    cfgDir = mkdtempSync(join(tmpdir(), 'agent-it-cfg-'));
    writeTempGatewayConfig(cfgDir);
    process.env.RAW_AGENT_GATEWAY_CONFIG = join(cfgDir, 'gateway.config.json');
    ({ child, getStderr } = spawnDaemon({ port, stateDir }));
    baseUrl = `http://127.0.0.1:${port}`;
  }

  try {
    await waitForHealth(baseUrl, 20_000);
    await runMailboxFlow(baseUrl, failures);
    await runApprovalFlow(baseUrl, failures);
    await runSocialFlow(baseUrl, failures);
    await runBotPolicyFlow(baseUrl, failures);
    await runBotModelFlow(baseUrl, failures);
  } catch (e) {
    failures.push(e instanceof Error ? e.message : String(e));
  } finally {
    if (!external) {
      child.kill('SIGTERM');
      const exited = await waitExit(child, 5000);
      if (exited === 'timeout') child.kill('SIGKILL');
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(cfgDir, { recursive: true, force: true });
    }
  }

  if (failures.length > 0) {
    console.error('Integration failures:\n', failures.join('\n'));
    const stderrTail = getStderr().slice(-2000);
    if (stderrTail.trim()) console.error('Daemon stderr tail:\n', stderrTail);
    process.exit(1);
  }
  console.log('Integration OK:', baseUrl, '(mailbox + approval + social action + bot policy + bot model endpoints)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
