#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

function compose(cfg, args) {
  const env = {
    ...process.env,
    EVOLUTION_RELEASE_RUN_ID: process.env.EVOLUTION_RELEASE_RUN_ID ?? '',
    IMAGE_TAG_DAEMON: process.env.IMAGE_TAG_DAEMON ?? 'latest',
    IMAGE_TAG_WEB: process.env.IMAGE_TAG_WEB ?? 'latest'
  };
  return spawnSync('docker', ['compose', '-f', join(cfg.composeDir, 'docker-compose.yml'), '-p', cfg.composeProject, ...args], {
    cwd: cfg.composeDir,
    env,
    encoding: 'utf8',
    shell: false
  });
}

export function deployCandidate(cfg, { releaseRunId, imageTagDaemon, imageTagWeb }) {
  process.env.EVOLUTION_RELEASE_RUN_ID = releaseRunId;
  process.env.IMAGE_TAG_DAEMON = imageTagDaemon;
  process.env.IMAGE_TAG_WEB = imageTagWeb;
  compose(cfg, ['--profile', 'candidate', 'down', '--remove-orphans']);
  const up = compose(cfg, ['--profile', 'candidate', 'up', '-d', '--build']);
  return { ok: up.status === 0, detail: (up.stderr || up.stdout || '').slice(-4000) };
}

export function tearDownCandidate(cfg) {
  const down = compose(cfg, ['--profile', 'candidate', 'down', '--remove-orphans']);
  return { ok: down.status === 0, detail: (down.stderr || down.stdout || '').slice(-2000) };
}

export function promoteStable(cfg, { imageTagDaemon, imageTagWeb }) {
  process.env.IMAGE_TAG_DAEMON = imageTagDaemon;
  process.env.IMAGE_TAG_WEB = imageTagWeb;
  const up = compose(cfg, ['--profile', 'stable', 'up', '-d', '--build']);
  tearDownCandidate(cfg);
  return { ok: up.status === 0, detail: (up.stderr || up.stdout || '').slice(-4000) };
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

function runningImage(cfg, service) {
  const ps = compose(cfg, ['--profile', 'stable', 'ps', '-q', service]);
  const id = ps.status === 0 ? String(ps.stdout ?? '').trim().split('\n')[0] : '';
  if (!id) return '';
  const inspect = spawnSync('docker', ['inspect', '--format', '{{.Config.Image}}', id], { encoding: 'utf8', shell: false });
  return inspect.status === 0 ? String(inspect.stdout ?? '').trim() : '';
}

/** Image tags of the Stable stack serving right now, or null when Stable is not running. */
export function currentStable(cfg) {
  const daemon = parseImageTag(runningImage(cfg, 'daemon'));
  const web = parseImageTag(runningImage(cfg, 'web'));
  return daemon && web ? { imageTagDaemon: daemon, imageTagWeb: web } : null;
}

/** Re-run Stable on previously deployed images; `--no-build` so old tags are not rebuilt from current source. */
export function rollbackStable(cfg, previous) {
  process.env.IMAGE_TAG_DAEMON = previous.imageTagDaemon;
  process.env.IMAGE_TAG_WEB = previous.imageTagWeb;
  const up = compose(cfg, ['--profile', 'stable', 'up', '-d', '--no-build']);
  return { ok: up.status === 0, detail: (up.stderr || up.stdout || '').slice(-4000) };
}
