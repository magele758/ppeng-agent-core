#!/usr/bin/env node
/** Tests two already-built local images; no build, pull, registry write or production volume. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { sanitizeScriptEnv } from '../spawn-utils.mjs';

const [daemonImage, webImage, reportFile = 'test-results/image-smoke.json'] = process.argv.slice(2);
if (!daemonImage || !webImage || daemonImage.startsWith('-') || webImage.startsWith('-')) throw new Error('Usage: image-smoke.mjs <local-daemon-image> <local-web-image> [report.json]');
const prefix = `ppeng-smoke-${randomUUID()}`;
const daemon = `${prefix}-daemon`;
const web = `${prefix}-web`;
const volume = `${prefix}-state`;
const token = randomUUID();
const evidence = { schemaVersion: 1, passed: false, checks: [], images: {} };
const created = { network: false, volume: false, containers: [] };

function docker(args, strict = true) {
  const result = spawnSync('docker', args, { env: sanitizeScriptEnv(), encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  if (strict && (result.error || result.status !== 0)) throw new Error(`docker ${args[0]} failed: ${(result.error?.message ?? result.stderr ?? '').replaceAll(token, '[REDACTED]')}`);
  return result.stdout?.trim() ?? '';
}
function port(container, privatePort) {
  const ports = JSON.parse(docker(['inspect', '--format', '{{json .NetworkSettings.Ports}}', container]));
  return `http://127.0.0.1:${ports[`${privatePort}/tcp`][0].HostPort}`;
}
async function probe(url, options = {}) {
  return fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) });
}
async function ready(url) {
  let error;
  for (let i = 0; i < 90; i++) {
    try { const response = await probe(url); if (response.ok) return; error = `HTTP ${response.status}`; }
    catch (e) { error = e.message; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`startup probe failed: ${error}`);
}
const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };

try {
  // Resolve tags ONCE, then run exact image IDs. Tags moving later cannot change what is tested.
  evidence.images.daemon = docker(['image', 'inspect', '--format', '{{.Id}}', daemonImage]);
  evidence.images.web = docker(['image', 'inspect', '--format', '{{.Id}}', webImage]);
  docker(['network', 'create', prefix]); created.network = true;
  docker(['volume', 'create', volume]); created.volume = true;
  created.containers.push(daemon); // Failed startup can still leave a created container.
  docker(['run', '-d', '--pull=never', '--name', daemon, '--network', prefix, '--network-alias', 'daemon',
    '-p', '127.0.0.1::37070', '-v', `${volume}:/data/state`,
    '-e', 'RAW_AGENT_STATE_DIR=/data/state', '-e', 'RAW_AGENT_MODEL_PROVIDER=heuristic',
    '-e', 'RAW_AGENT_SELF_HEAL_AUTO_START=0', '-e', 'RAW_AGENT_E2E_ISOLATE=1', '-e', 'RAW_AGENT_AGENTS_SKILLS=0',
    '-e', `RAW_AGENT_AUTH_TOKEN=${token}`, evidence.images.daemon]);
  let daemonUrl = port(daemon, 37070);
  await ready(`${daemonUrl}/api/health`);
  const readiness = await probe(`${daemonUrl}/api/readiness`);
  assert.equal(readiness.status, 200); assert.equal((await readiness.json()).ready, true);
  evidence.checks.push('readiness');
  assert.equal((await probe(`${daemonUrl}/api/sessions`)).status, 401);
  assert.equal((await probe(`${daemonUrl}/api/sessions`, { headers: auth })).status, 200);
  evidence.checks.push('daemon-auth');
  const sessionResponse = await probe(`${daemonUrl}/api/sessions`, {
    method: 'POST', headers: auth, body: JSON.stringify({ mode: 'chat', title: prefix, autoRun: false })
  });
  assert.equal(sessionResponse.status, 201);
  const session = (await sessionResponse.json()).session;
  assert.ok(session?.id);
  docker(['restart', daemon]);
  daemonUrl = port(daemon, 37070); // Ephemeral host port may be reassigned by the Docker runtime.
  await ready(`${daemonUrl}/api/health`);
  const restored = await probe(`${daemonUrl}/api/sessions/${encodeURIComponent(session.id)}`, { headers: auth });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).session.title, prefix);
  evidence.checks.push('sqlite-restart-persistence');
  created.containers.push(web);
  docker(['run', '-d', '--pull=never', '--name', web, '--network', prefix, '-p', '127.0.0.1::33815',
    '-e', 'DAEMON_PROXY_TARGET=http://daemon:37070', '-e', `RAW_AGENT_AUTH_TOKEN=${token}`, evidence.images.web]);
  const webUrl = port(web, 33815);
  await ready(webUrl);
  assert.equal((await probe(`${webUrl}/api/sessions`)).status, 200);
  evidence.checks.push('web-ssr-and-authenticated-proxy');
  const stream = await probe(`${webUrl}/api/chat/stream`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, message: 'Hello' })
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  const events = await stream.text();
  assert.match(events, /event: result/);
  const resultFrame = events.split('\n\n').find(frame => frame.startsWith('event: result\n'));
  const result = JSON.parse(resultFrame.split('\ndata: ')[1]);
  assert.equal(result.session?.status, 'idle');
  assert.ok(result.latestAssistant?.trim());
  assert.doesNotMatch(events, /event: error/);
  evidence.checks.push('proxied-sse-completion');
  evidence.passed = true;
} catch (error) {
  evidence.error = error.message.replaceAll(token, '[REDACTED]');
  for (const container of created.containers) {
    console.error(docker(['logs', '--tail', '80', container], false).replaceAll(token, '[REDACTED]'));
  }
  process.exitCode = 1;
} finally {
  // Only resources with this invocation's random, recorded names are removed.
  for (const container of created.containers.reverse()) docker(['rm', '-f', container], false);
  if (created.volume) docker(['volume', 'rm', volume], false);
  if (created.network) docker(['network', 'rm', prefix], false);
  mkdirSync(dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
