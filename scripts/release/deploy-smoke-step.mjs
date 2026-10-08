/**
 * Post-deploy smoke + automatic rollback for the release orchestrator.
 *
 * - Candidate: deploy → smoke → on failure tear the candidate down (Stable keeps serving).
 * - Promote:   remember current Stable → promote → smoke Stable → on failure roll Stable back.
 *
 * Decisions are pure functions; `verifyCandidate` / `promoteWithSmoke` take the
 * deploy backend and smoke runner as parameters so tests can drive them without Docker.
 */
import { parseSmokeArgs, runDeploySmoke, formatHuman } from '../lib/deploy-smoke-lib.mjs';
import { appendReportEvent, setPhase } from './report-builder.mjs';

/** Containers need longer than a dev daemon to come up; DEPLOY_SMOKE_STARTUP_TIMEOUT_MS still wins. */
export const RELEASE_SMOKE_STARTUP_TIMEOUT_MS = 120_000;

export function smokeOptionsFor(cfg, role, env = process.env) {
  const urls = role === 'stable'
    ? { daemon: cfg.stableDaemonUrl, web: cfg.stableWebUrl }
    : { daemon: cfg.candidateDaemonUrl, web: cfg.candidateWebUrl };
  const { options } = parseSmokeArgs([], {
    DEPLOY_SMOKE_STARTUP_TIMEOUT_MS: String(RELEASE_SMOKE_STARTUP_TIMEOUT_MS),
    ...env,
    DEPLOY_SMOKE_DAEMON_URL: urls.daemon ?? '',
    DEPLOY_SMOKE_WEB_URL: urls.web ?? '',
    DEPLOY_SMOKE_TOKEN: cfg.authToken ?? ''
  });
  return options;
}

export function decideCandidateSmoke(summary) {
  if (!summary) return { action: 'skip', reason: 'no candidate daemon URL configured' };
  if (summary.ok) return { action: 'continue', reason: 'candidate smoke passed' };
  return { action: 'rollback_candidate', reason: `candidate smoke failed: ${summary.failedChecks.join(', ')}` };
}

export function decideStableSmoke(summary, previousStable) {
  if (!summary) return { action: 'skip', reason: 'no stable daemon URL configured' };
  if (summary.ok) return { action: 'keep', reason: 'stable smoke passed' };
  const reason = `stable smoke failed: ${summary.failedChecks.join(', ')}`;
  if (!previousStable) return { action: 'rollback_unavailable', reason: `${reason}; no previous stable recorded` };
  return { action: 'rollback_stable', reason };
}

/** Report-sized view of a smoke summary (no timings / URLs beyond what is needed). */
export function compactSmoke(summary) {
  if (!summary) return null;
  return {
    ok: summary.ok,
    counts: summary.counts,
    failed_checks: summary.failedChecks,
    checks: summary.checks.map(({ id, status, detail }) => ({ id, status, detail }))
  };
}

export function recordSmoke(report, role, summary, decision) {
  report.deploy_smoke = report.deploy_smoke ?? {};
  report.deploy_smoke[role] = { at: new Date().toISOString(), decision: decision.action, reason: decision.reason, summary: compactSmoke(summary) };
  appendReportEvent(report, `deploy_smoke_${role}`, { decision: decision.action, reason: decision.reason });
  return report;
}

export function recordRollback(report, target, reason, result) {
  setPhase(report, 'rollback');
  report.rollback = { at: new Date().toISOString(), target, reason, ok: Boolean(result?.ok), detail: String(result?.detail ?? '').slice(-2000) };
  appendReportEvent(report, `rollback_${target}`, { ok: report.rollback.ok, reason });
  return report;
}

async function smokeRole(cfg, role, smoke, log) {
  const options = smokeOptionsFor(cfg, role);
  if (!options.daemonUrl) return null;
  const summary = await smoke(options);
  log(formatHuman(summary));
  return summary;
}

/** After `deployCandidate`: smoke the candidate; on failure tear it down and mark the run rolled back. */
export async function verifyCandidate({ cfg, report, backend, smoke = runDeploySmoke, log = console.error }) {
  const summary = await smokeRole(cfg, 'candidate', smoke, log);
  const decision = decideCandidateSmoke(summary);
  recordSmoke(report, 'candidate', summary, decision);
  if (decision.action !== 'rollback_candidate') return { ok: true, decision, summary };
  const result = await backend.rollbackCandidate(cfg);
  recordRollback(report, 'candidate', decision.reason, result);
  report.outcome = result.ok ? 'rolled_back' : 'backlog';
  return { ok: false, decision, summary, rollback: result };
}

/**
 * Promote with a safety net: record the Stable that is serving now, promote,
 * smoke Stable, and roll back to the recorded Stable if the smoke fails.
 */
export async function promoteWithSmoke({ cfg, report, backend, tags, smoke = runDeploySmoke, log = console.error }) {
  const previous = backend.currentStable ? await backend.currentStable(cfg) : null;
  report.stable = { ...(report.stable ?? {}), previous: previous ?? null };
  const promote = await backend.promoteStable(cfg, tags);
  appendReportEvent(report, 'promote', promote);
  if (!promote.ok) {
    report.outcome = promote.rolledBack ? 'rolled_back' : 'backlog';
    return { ok: false, promote };
  }
  const summary = await smokeRole(cfg, 'stable', smoke, log);
  const decision = decideStableSmoke(summary, previous);
  recordSmoke(report, 'stable', summary, decision);
  if (decision.action === 'keep' || decision.action === 'skip') {
    report.outcome = 'promoted';
    return { ok: true, promote, decision, summary };
  }
  if (decision.action === 'rollback_unavailable') {
    recordRollback(report, 'stable', decision.reason, { ok: false, detail: 'no previous stable to restore' });
    report.outcome = 'backlog';
    return { ok: false, promote, decision, summary };
  }
  let result;
  try {
    result = await backend.rollbackStable(cfg, previous);
    if (result.ok) {
      const restored = await smokeRole(cfg, 'stable', smoke, log);
      report.deploy_smoke.restored = compactSmoke(restored);
      if (!restored?.ok) result = { ok: false, detail: 'restored images failed stable smoke; operator action required' };
    }
  } catch (error) { result = { ok: false, detail: String(error?.message ?? error) }; }
  recordRollback(report, 'stable', decision.reason, result);
  report.outcome = result.ok ? 'rolled_back' : 'backlog';
  return { ok: false, promote, decision, summary, rollback: result };
}
