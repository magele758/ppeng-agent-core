#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { sanitizeScriptEnv } from '../spawn-utils.mjs';
import { promoteWithRollback } from './promotion-policy.mjs';
import { fetchJson } from './http-auth.mjs';

function compose(cfg, args, imageIds) {
  const env = sanitizeScriptEnv({
    ...process.env,
    EVOLUTION_RELEASE_RUN_ID: process.env.EVOLUTION_RELEASE_RUN_ID ?? '',
    IMAGE_TAG_DAEMON: process.env.IMAGE_TAG_DAEMON ?? 'latest',
    IMAGE_TAG_WEB: process.env.IMAGE_TAG_WEB ?? 'latest'
  });
  const temporary = imageIds ? mkdtempSync(join(tmpdir(), 'ppeng-compose-pinned-')) : null;
  try {
    const files = ['-f', join(cfg.composeDir, 'docker-compose.yml')];
    if (temporary) {
      const override = join(temporary, 'images.json');
      writeFileSync(override, JSON.stringify({ services: { daemon: { image: imageIds.daemon }, web: { image: imageIds.web } } }));
      files.push('-f', override);
    }
    return (cfg.executeCommand ?? spawnSync)('docker', ['compose', ...files, '-p', cfg.composeProject, ...args], {
      cwd: cfg.composeDir, env, encoding: 'utf8', shell: false, timeout: 300_000
    });
  } finally { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
}

function inspectService(cfg, service) {
  const container = compose(cfg, ['--profile', service.endsWith('-candidate') ? 'candidate' : 'stable', 'ps', '-q', service]);
  if (container.status !== 0 || !container.stdout?.trim()) throw new Error(`running service unavailable: ${service}`);
  const id = container.stdout.trim();
  if (!/^[a-f0-9]+$/.test(id)) throw new Error(`invalid container identity: ${service}`);
  const result = (cfg.executeCommand ?? spawnSync)('docker', ['inspect', '--format', '{{.Image}}', id], { env: sanitizeScriptEnv(), encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0 || !/^sha256:[a-f0-9]{64}$/.test(result.stdout?.trim() ?? '')) throw new Error(`cannot pin image: ${service}`);
  return { id, image: result.stdout.trim() };
}

function schemaVersion(cfg, containerId) {
  const script = "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(require('node:path').join(process.env.RAW_AGENT_STATE_DIR || '/data/state','runtime.sqlite'),{readOnly:true}); console.log(db.prepare('SELECT MAX(version) AS v FROM schema_version').get().v); db.close();";
  const result = (cfg.executeCommand ?? spawnSync)('docker', ['exec', containerId, 'node', '-e', script], { env: sanitizeScriptEnv(), encoding: 'utf8', timeout: 30_000 });
  const value = Number(result.stdout?.trim());
  if (result.status !== 0 || !result.stdout?.trim() || !Number.isInteger(value)) throw new Error('cannot verify database schema compatibility');
  return value;
}

export function deployCandidate(cfg, { releaseRunId, imageTagDaemon, imageTagWeb }) {
  process.env.EVOLUTION_RELEASE_RUN_ID = releaseRunId;
  process.env.IMAGE_TAG_DAEMON = imageTagDaemon;
  process.env.IMAGE_TAG_WEB = imageTagWeb;
  const up = compose(cfg, ['--profile', 'candidate', 'up', '-d', '--build', 'daemon-candidate', 'web-candidate']);
  if (up.status !== 0) return { ok: false, detail: (up.stderr || up.stdout || '').slice(-4000) };
  try {
    return { ok: true, imageIds: { daemon: inspectService(cfg, 'daemon-candidate').image, web: inspectService(cfg, 'web-candidate').image }, detail: 'candidate deployed with pinned local image IDs' };
  } catch (error) { return { ok: false, detail: error.message }; }
}

export function tearDownCandidate(cfg) {
  // Shared compose project: `down` / --remove-orphans can affect stable services.
  const stopped = compose(cfg, ['--profile', 'candidate', 'stop', 'web-candidate', 'daemon-candidate']);
  if (stopped.status !== 0) return { ok: false, detail: (stopped.stderr || '').slice(-2000) };
  const removed = compose(cfg, ['--profile', 'candidate', 'rm', '-f', 'web-candidate', 'daemon-candidate']);
  return { ok: removed.status === 0, detail: (removed.stderr || removed.stdout || '').slice(-2000) };
}

function activateStable(cfg, images) {
  if (!['daemon', 'web'].every(role => /^sha256:[a-f0-9]{64}$/.test(images?.[role] ?? ''))) {
    return { ok: false, detail: 'missing immutable stable image IDs; refuse activation' };
  }
  const up = compose(cfg, ['--profile', 'stable', 'up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '120', 'daemon', 'web'], images);
  if (up.status !== 0) return { ok: false, detail: (up.stderr || up.stdout || '').slice(-2000) };
  try {
    const actual = { daemon: inspectService(cfg, 'daemon').image, web: inspectService(cfg, 'web').image };
    const ok = actual.daemon === images.daemon && actual.web === images.web;
    return { ok, detail: ok ? 'stable running exact requested image IDs' : 'stable image identity mismatch after activation' };
  } catch (error) { return { ok: false, detail: error.message }; }
}

export async function promoteStable(cfg, { imageIds }) {
  try {
    const previousDaemon = inspectService(cfg, 'daemon'), previousWeb = inspectService(cfg, 'web');
    const candidateDaemon = inspectService(cfg, 'daemon-candidate'), candidateWeb = inspectService(cfg, 'web-candidate');
    if (candidateDaemon.image !== imageIds?.daemon || candidateWeb.image !== imageIds?.web) return { ok: false, detail: 'candidate images changed since their gate; re-run release validation' };
    return await promoteWithRollback({ candidateImages: imageIds,
      previousImages: { daemon: previousDaemon.image, web: previousWeb.image },
      stableSchema: schemaVersion(cfg, previousDaemon.id), candidateSchema: schemaVersion(cfg, candidateDaemon.id),
      activate: async images => activateStable(cfg, images),
      probe: cfg.probeStable ?? (async () => {
        const url = cfg.stableWebUrl;
        if (!url) return false;
        const readiness = await fetchJson(`${url}/api/readiness`, { signal: AbortSignal.timeout(15_000) });
        const sessions = await fetchJson(`${url}/api/sessions`, { signal: AbortSignal.timeout(15_000) });
        return readiness.ok && readiness.data?.ready === true && sessions.ok && Array.isArray(sessions.data?.sessions);
      })
    });
  } catch (error) { return { ok: false, rolledBack: false, detail: error.message }; }
}

export function rollbackCandidate(cfg) {
  return tearDownCandidate(cfg);
}

/** `registry:5000/ppeng/daemon:rel-1` → `rel-1`; untagged → `latest`. */
export function parseImageTag(image) {
  const ref = String(image ?? '').trim().split('@')[0];
  if (!ref) return '';
  const lastSlash = ref.lastIndexOf('/');
  const colon = ref.lastIndexOf(':');
  return colon > lastSlash ? ref.slice(colon + 1) : 'latest';
}

/** Capture the exact bytes running now, never parse an image ID as a tag. */
export function currentStable(cfg) {
  try {
    return { imageIds: { daemon: inspectService(cfg, 'daemon').image, web: inspectService(cfg, 'web').image } };
  } catch { return null; }
}

/** Same pinned activation/identity verification for both inner and outer recovery. */
export function rollbackStable(cfg, previous) {
  return activateStable(cfg, previous?.imageIds);
}
