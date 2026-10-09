#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { parseAllDocuments } from 'yaml';
import { sanitizeScriptEnv } from '../spawn-utils.mjs';
import { promoteWithRollback } from './promotion-policy.mjs';
import { fetchJson } from './http-auth.mjs';

function helm(cfg, args) {
  return (cfg.executeCommand ?? spawnSync)('helm', args, { cwd: cfg.repoRoot, env: sanitizeScriptEnv(), encoding: 'utf8', timeout: 360_000 });
}

function runningImageRefs(cfg, release) {
  const result = (cfg.executeCommand ?? spawnSync)('kubectl', ['get', 'pods', '--namespace', cfg.helmNamespace,
    '-l', `app.kubernetes.io/instance=${release}`, '-o', 'json'], { env: sanitizeScriptEnv(), encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0) throw new Error(`cannot inspect pod image digests for ${release}`);
  const pods = JSON.parse(result.stdout).items.filter(pod => !pod.metadata?.deletionTimestamp);
  const refs = {};
  for (const role of ['daemon', 'web']) {
    const statuses = pods.flatMap(pod => pod.status?.containerStatuses ?? []).filter(container => container.name === role);
    const images = statuses.map(container => String(container.imageID ?? '').replace(/^docker-pullable:\/\//, ''));
    if (!statuses.length || statuses.some(s => !s.ready) || images.some(image => !/^[a-zA-Z0-9._:/-]+@sha256:[a-f0-9]{64}$/.test(image)) || new Set(images).size !== 1) {
      throw new Error(`cannot verify one ready immutable ${role} image for ${release}`);
    }
    refs[role] = images[0];
  }
  return refs;
}

function verifyRunningImages(cfg, expected) {
  const actual = runningImageRefs(cfg, cfg.helmReleaseStable);
  if (!['daemon', 'web'].every(role => actual[role] === expected?.[role])) {
    throw new Error('stable image digest mismatch after activation');
  }
}

/** A rollback is safe only if the stored manifest, not just today's Pods, pins these bytes. */
function verifyRollbackManifest(cfg, previous) {
  if (!Number.isInteger(previous?.revision) || previous.revision < 1) throw new Error('missing previous Helm revision');
  const r = helm(cfg, ['get', 'manifest', cfg.helmReleaseStable, '--revision', String(previous.revision), '--namespace', cfg.helmNamespace]);
  if (r.status !== 0) throw new Error('cannot inspect previous Helm manifest');
  const documents = parseAllDocuments(r.stdout ?? '');
  if (documents.some(doc => doc.errors.length)) throw new Error('invalid previous Helm manifest');
  const containers = documents.map(doc => doc.toJS()).filter(doc => doc?.kind === 'Deployment')
    .flatMap(doc => doc.spec?.template?.spec?.containers ?? []);
  for (const role of ['daemon', 'web']) {
    const images = containers.filter(c => c.name === role).map(c => c.image);
    if (!/^[a-zA-Z0-9._:/-]+@sha256:[a-f0-9]{64}$/.test(previous.imageRefs?.[role] ?? '') ||
        images.length !== 1 || images[0] !== previous.imageRefs[role]) {
      throw new Error(`previous Helm revision does not pin the running ${role} digest; pin stable digests before promotion`);
    }
  }
}

function captureStable(cfg) {
  const r = helm(cfg, ['status', cfg.helmReleaseStable, '--namespace', cfg.helmNamespace, '-o', 'json']);
  if (r.status !== 0) throw new Error('cannot capture previous Helm revision');
  const status = JSON.parse(r.stdout);
  if (status.info?.status !== 'deployed') throw new Error('stable Helm release is not deployed');
  const previous = { revision: Number(status.version), imageRefs: runningImageRefs(cfg, cfg.helmReleaseStable) };
  verifyRollbackManifest(cfg, previous);
  return previous;
}

export function deployCandidate(cfg, { releaseRunId, imageTagDaemon, imageTagWeb }) {
  const values = join(cfg.helmChart, 'values-candidate.yaml');
  const r = helm(cfg, [
    'upgrade', '--install', cfg.helmReleaseCandidate, cfg.helmChart,
    '--atomic', '--wait', '--timeout', '5m',
    '-f', values,
    '--namespace', cfg.helmNamespace,
    '--set-string', `image.daemon.tag=${imageTagDaemon}`,
    '--set-string', `image.web.tag=${imageTagWeb}`,
    '--set-string', 'image.daemon.digest=', '--set-string', 'image.web.digest=',
    '--set', `daemon.env.RAW_AGENT_RELEASE_RUN_ID=${releaseRunId}`
  ]);
  if (r.status !== 0) return { ok: false, detail: (r.stderr || r.stdout || '').slice(-4000) };
  try { return { ok: true, imageRefs: runningImageRefs(cfg, cfg.helmReleaseCandidate), detail: 'candidate ready; immutable pod image digests recorded' }; }
  catch (error) { return { ok: false, detail: error.message }; }
}

export async function promoteStable(cfg, { imageRefs }) {
  try {
    const candidate = runningImageRefs(cfg, cfg.helmReleaseCandidate);
    if (candidate.daemon !== imageRefs?.daemon || candidate.web !== imageRefs?.web) return { ok: false, detail: 'candidate image digest changed since validation' };
    const previous = captureStable(cfg);
    const previousImages = previous.imageRefs;
    const request = cfg.fetchJson ?? fetchJson;
    const stableReady = await request(`${cfg.stableWebUrl}/api/readiness`);
    const candidateReady = await request(`${cfg.candidateDaemonUrl}/api/readiness`);
    if (!stableReady.ok || !candidateReady.ok || stableReady.data?.ready !== true || candidateReady.data?.ready !== true) throw new Error('stable/candidate readiness unavailable');
    return await promoteWithRollback({ candidateImages: imageRefs, previousImages,
      stableSchema: stableReady.data.schemaVersion, candidateSchema: candidateReady.data.schemaVersion,
      activate: async images => {
        let r;
        if (images === previousImages) {
          return rollbackStable(cfg, previous);
        } else {
          const imageArgs = ['daemon', 'web'].flatMap(role => {
            const [repository, digest] = images[role].split('@');
            return ['--set-string', `image.${role}.repository=${repository}`, '--set-string', `image.${role}.digest=${digest}`];
          });
          r = helm(cfg, ['upgrade', '--install', cfg.helmReleaseStable, cfg.helmChart,
            '--atomic', '--wait', '--timeout', '5m', '--namespace', cfg.helmNamespace, ...imageArgs]);
        }
        if (r.status !== 0) return { ok: false, detail: (r.stderr || r.stdout || '').slice(-2000) };
        verifyRunningImages(cfg, images);
        return { ok: true, detail: 'stable running exact requested digests' };
      },
      probe: async () => {
        const readiness = await request(`${cfg.stableWebUrl}/api/readiness`);
        const sessions = await request(`${cfg.stableWebUrl}/api/sessions`);
        return readiness.ok && readiness.data?.ready === true && sessions.ok && Array.isArray(sessions.data?.sessions);
      }
    });
  } catch (error) { return { ok: false, rolledBack: false, detail: error.message }; }
}

export function rollbackCandidate(cfg) {
  const r = helm(cfg, ['uninstall', cfg.helmReleaseCandidate, '--namespace', cfg.helmNamespace]);
  return { ok: r.status === 0, detail: (r.stderr || r.stdout || '').slice(-2000) };
}

/** Capture a safely reversible revision and its immutable running image refs. */
export function currentStable(cfg) {
  try { return captureStable(cfg); } catch { return null; }
}

export function rollbackStable(cfg, previous) {
  try {
    verifyRollbackManifest(cfg, previous);
    const r = helm(cfg, ['rollback', cfg.helmReleaseStable, String(previous.revision), '--namespace', cfg.helmNamespace, '--wait', '--timeout', '5m']);
    if (r.status !== 0) return { ok: false, detail: (r.stderr || r.stdout || '').slice(-4000) };
    verifyRunningImages(cfg, previous.imageRefs);
    return { ok: true, detail: 'previous Helm revision and exact image digests restored' };
  } catch (error) { return { ok: false, detail: error.message }; }
}
