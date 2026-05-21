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
