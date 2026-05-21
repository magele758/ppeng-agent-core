#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

function helm(cfg, args) {
  return spawnSync('helm', args, { cwd: cfg.repoRoot, encoding: 'utf8' });
}

export function deployCandidate(cfg, { releaseRunId, imageTagDaemon, imageTagWeb }) {
  const values = join(cfg.helmChart, 'values-candidate.yaml');
  const r = helm(cfg, [
    'upgrade', '--install', cfg.helmReleaseCandidate, cfg.helmChart,
    '-f', values,
    '--namespace', cfg.helmNamespace,
    '--set', `image.daemon.tag=${imageTagDaemon}`,
    '--set', `image.web.tag=${imageTagWeb}`,
    '--set', `daemon.env.RAW_AGENT_RELEASE_RUN_ID=${releaseRunId}`
  ]);
  return { ok: r.status === 0, detail: (r.stderr || r.stdout || '').slice(-4000) };
}

export function promoteStable(cfg, { imageTagDaemon, imageTagWeb }) {
  const r = helm(cfg, [
    'upgrade', '--install', cfg.helmReleaseStable, cfg.helmChart,
    '--namespace', cfg.helmNamespace,
    '--set', `image.daemon.tag=${imageTagDaemon}`,
    '--set', `image.web.tag=${imageTagWeb}`
  ]);
  helm(cfg, ['uninstall', cfg.helmReleaseCandidate, '--namespace', cfg.helmNamespace]);
  return { ok: r.status === 0, detail: (r.stderr || r.stdout || '').slice(-4000) };
}

export function rollbackCandidate(cfg) {
  const r = helm(cfg, ['uninstall', cfg.helmReleaseCandidate, '--namespace', cfg.helmNamespace]);
  return { ok: r.status === 0, detail: (r.stderr || r.stdout || '').slice(-2000) };
}
