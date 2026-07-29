#!/usr/bin/env node
/**
 * Release orchestrator configuration (EVOLUTION_RELEASE_* / EVOLUTION_CODING_*).
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function truthy(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export function loadReleaseConfig(repoRoot = process.cwd()) {
  const backend = (process.env.EVOLUTION_RELEASE_BACKEND ?? 'compose').trim().toLowerCase();
  const candidateWeb =
    process.env.EVOLUTION_RELEASE_CANDIDATE_URL?.trim() ||
    (backend === 'compose' ? 'http://127.0.0.1:33001' : '');
  const candidateDaemon =
    process.env.EVOLUTION_RELEASE_CANDIDATE_DAEMON_URL?.trim() ||
    (backend === 'compose' ? 'http://127.0.0.1:37071' : '');

  return {
    repoRoot,
    enabled: truthy(process.env.EVOLUTION_RELEASE_ENABLED ?? '1'),
    backend: backend === 'helm' ? 'helm' : 'compose',
    autoPromote: truthy(process.env.EVOLUTION_RELEASE_AUTO_PROMOTE),
    bakeHours: Math.max(0, Number(process.env.EVOLUTION_RELEASE_BAKE_HOURS ?? 24) || 24),
    fixMaxAttempts: Math.max(0, Number(process.env.EVOLUTION_RELEASE_FIX_MAX_ATTEMPTS ?? 3) || 3),
    candidateWebUrl: candidateWeb.replace(/\/$/, ''),
    candidateDaemonUrl: candidateDaemon.replace(/\/$/, ''),
    stableWebUrl: (process.env.EVOLUTION_RELEASE_STABLE_URL ?? 'http://127.0.0.1:33815').replace(/\/$/, ''),
    imageRegistry: (process.env.EVOLUTION_RELEASE_IMAGE_REGISTRY ?? '').trim(),
    composeDir: join(repoRoot, 'deploy', 'compose'),
    composeProject: process.env.EVOLUTION_RELEASE_COMPOSE_PROJECT?.trim() || 'ppeng-agent',
    helmChart: join(repoRoot, 'deploy', 'helm', 'ppeng-agent-core'),
    helmReleaseStable: process.env.EVOLUTION_RELEASE_HELM_STABLE?.trim() || 'ppeng-stable',
    helmReleaseCandidate: process.env.EVOLUTION_RELEASE_HELM_CANDIDATE?.trim() || 'ppeng-candidate',
    helmNamespace: process.env.EVOLUTION_RELEASE_HELM_NAMESPACE?.trim() || 'default',
    gitRemote: process.env.EVOLUTION_RELEASE_GIT_REMOTE?.trim() || 'origin',
    gitBranch: process.env.EVOLUTION_RELEASE_GIT_BRANCH?.trim() || process.env.EVOLUTION_TARGET_BRANCH?.trim() || 'main',
    evolutionArgs: process.env.EVOLUTION_RELEASE_EVOLUTION_ARGS?.trim() || '--learn --agent claude',
    skipEvolution: truthy(process.env.EVOLUTION_RELEASE_SKIP_EVOLUTION),
    skipDeploy: truthy(process.env.EVOLUTION_RELEASE_SKIP_DEPLOY),
    skipG2: truthy(process.env.EVOLUTION_RELEASE_SKIP_G2),
    authToken: process.env.RAW_AGENT_AUTH_TOKEN?.trim() || '',
    codingAgent: (process.env.EVOLUTION_CODING_AGENT ?? 'cmd').trim().toLowerCase(),
    reportsDir: join(repoRoot, 'doc', 'evolution', 'reports')
  };
}

export function createReleaseRunId(repoRoot) {
  const cfg = loadReleaseConfig(repoRoot);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let seq = 1;
  if (existsSync(cfg.reportsDir)) {
    const prefix = `rel_${today}_`;
    for (const f of readdirSync(cfg.reportsDir)) {
      if (f.startsWith(prefix) && f.endsWith('.json')) seq++;
    }
  }
  return `rel_${today}_${String(seq).padStart(3, '0')}`;
}

export function imageTagForRelease(releaseRunId, role = 'daemon') {
  const short = releaseRunId.replace(/^rel_/, '').slice(0, 12);
  return `rel-${short}-${role}`;
}
