import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  RELEASE_SMOKE_STARTUP_TIMEOUT_MS,
  compactSmoke,
  decideCandidateSmoke,
  decideStableSmoke,
  promoteWithSmoke,
  smokeOptionsFor,
  verifyCandidate
} from '../deploy-smoke-step.mjs';
import { createEmptyReport, reportToMarkdown } from '../report-builder.mjs';
import * as composeBackend from '../deploy-backend-compose.mjs';
import * as helmBackend from '../deploy-backend-helm.mjs';

const cfg = {
  backend: 'compose',
  candidateDaemonUrl: 'http://cand-d',
  candidateWebUrl: 'http://cand-w',
  stableDaemonUrl: 'http://stab-d',
  stableWebUrl: 'http://stab-w',
  authToken: 'tok'
};

function summary(ok, failedChecks = []) {
  return {
    ok,
    counts: { passed: ok ? 8 : 8 - failedChecks.length, failed: failedChecks.length, skipped: 0 },
    failedChecks,
    target: {},
    checks: failedChecks.map((id) => ({ id, status: 'fail', detail: 'boom', durationMs: 1, attempts: 1 }))
  };
}

function fakeBackend({ previous = { imageTagDaemon: 'old-d', imageTagWeb: 'old-w' }, promoteOk = true } = {}) {
  const calls = [];
  return {
    calls,
    currentStable: () => { calls.push(['currentStable']); return previous; },
    promoteStable: (_c, tags) => { calls.push(['promoteStable', tags]); return { ok: promoteOk, detail: promoteOk ? 'up' : 'pull failed' }; },
    rollbackCandidate: () => { calls.push(['rollbackCandidate']); return { ok: true, detail: 'down' }; },
    rollbackStable: (_c, prev) => { calls.push(['rollbackStable', prev]); return { ok: true, detail: 'restored' }; }
  };
}

const quiet = () => {};

test('decideCandidateSmoke: skip / continue / rollback', () => {
  assert.equal(decideCandidateSmoke(null).action, 'skip');
  assert.equal(decideCandidateSmoke(summary(true)).action, 'continue');
  const d = decideCandidateSmoke(summary(false, ['chat_roundtrip', 'sse_stream']));
  assert.equal(d.action, 'rollback_candidate');
  assert.match(d.reason, /chat_roundtrip, sse_stream/);
});

test('decideStableSmoke: skip / keep / rollback / rollback unavailable', () => {
  assert.equal(decideStableSmoke(null, null).action, 'skip');
  assert.equal(decideStableSmoke(summary(true), null).action, 'keep');
  assert.equal(decideStableSmoke(summary(false, ['web_page']), { imageTagDaemon: 'a', imageTagWeb: 'b' }).action, 'rollback_stable');
  const d = decideStableSmoke(summary(false, ['web_page']), null);
  assert.equal(d.action, 'rollback_unavailable');
  assert.match(d.reason, /no previous stable/);
});

test('smokeOptionsFor: picks role URLs + token, defaults to release startup timeout, env overrides it', () => {
  const cand = smokeOptionsFor(cfg, 'candidate', {});
  assert.equal(cand.daemonUrl, 'http://cand-d');
  assert.equal(cand.webUrl, 'http://cand-w');
  assert.equal(cand.token, 'tok');
  assert.equal(cand.startupTimeoutMs, RELEASE_SMOKE_STARTUP_TIMEOUT_MS);
  const stable = smokeOptionsFor(cfg, 'stable', { DEPLOY_SMOKE_STARTUP_TIMEOUT_MS: '5000', DEPLOY_SMOKE_DAEMON_URL: 'http://ignored' });
  assert.equal(stable.daemonUrl, 'http://stab-d');
  assert.equal(stable.startupTimeoutMs, 5000);
});

test('compactSmoke keeps id/status/detail only', () => {
  assert.equal(compactSmoke(null), null);
  const c = compactSmoke(summary(false, ['web_page']));
  assert.deepEqual(c.checks, [{ id: 'web_page', status: 'fail', detail: 'boom' }]);
  assert.deepEqual(c.failed_checks, ['web_page']);
});

test('verifyCandidate: passing smoke continues without rollback', async () => {
  const report = createEmptyReport('rel_t_1');
  const backend = fakeBackend();
  let seen;
  const r = await verifyCandidate({ cfg, report, backend, log: quiet, smoke: async (o) => { seen = o; return summary(true); } });
  assert.equal(r.ok, true);
  assert.equal(seen.daemonUrl, 'http://cand-d');
  assert.deepEqual(backend.calls, []);
  assert.equal(report.deploy_smoke.candidate.decision, 'continue');
  assert.equal(report.rollback, null);
  assert.equal(report.outcome, 'in_progress');
});

test('verifyCandidate: failing smoke tears candidate down and records rolled_back', async () => {
  const report = createEmptyReport('rel_t_2');
  const backend = fakeBackend();
  const r = await verifyCandidate({ cfg, report, backend, log: quiet, smoke: async () => summary(false, ['daemon_readiness']) });
  assert.equal(r.ok, false);
  assert.deepEqual(backend.calls, [['rollbackCandidate']]);
  assert.equal(report.outcome, 'rolled_back');
  assert.equal(report.phase, 'rollback');
  assert.deepEqual({ target: report.rollback.target, ok: report.rollback.ok }, { target: 'candidate', ok: true });
  assert.ok(report.events.some((e) => e.type === 'deploy_smoke_candidate' && e.decision === 'rollback_candidate'));
  assert.ok(report.events.some((e) => e.type === 'rollback_candidate'));
  const md = reportToMarkdown(report);
  assert.match(md, /- candidate: \*\*rollback_candidate\*\* — candidate smoke failed: daemon_readiness \(7 passed, 1 failed, 0 skipped\)/);
  assert.match(md, /- 回滚 candidate: 成功/);
});

test('verifyCandidate: no candidate daemon URL records skip and continues', async () => {
  const report = createEmptyReport('rel_t_3');
  const r = await verifyCandidate({
    cfg: { ...cfg, candidateDaemonUrl: '' }, report, backend: fakeBackend(), log: quiet,
    smoke: async () => { throw new Error('must not run'); }
  });
  assert.equal(r.ok, true);
  assert.equal(report.deploy_smoke.candidate.decision, 'skip');
  assert.equal(report.deploy_smoke.candidate.summary, null);
});

test('promoteWithSmoke: passing stable smoke keeps the promotion', async () => {
  const report = createEmptyReport('rel_t_4');
  const backend = fakeBackend();
  const tags = { imageTagDaemon: 'new-d', imageTagWeb: 'new-w' };
  const r = await promoteWithSmoke({ cfg, report, backend, tags, log: quiet, smoke: async () => summary(true) });
  assert.equal(r.ok, true);
  assert.equal(report.outcome, 'promoted');
  assert.deepEqual(report.stable.previous, { imageTagDaemon: 'old-d', imageTagWeb: 'old-w' });
  assert.deepEqual(backend.calls, [['currentStable'], ['promoteStable', tags]]);
});

test('promoteWithSmoke: failing stable smoke restores the previous stable', async () => {
  const report = createEmptyReport('rel_t_5');
  const backend = fakeBackend();
  let probes = 0;
  const r = await promoteWithSmoke({
    cfg, report, backend, tags: { imageTagDaemon: 'new-d', imageTagWeb: 'new-w' }, log: quiet,
    smoke: async (o) => { assert.equal(o.daemonUrl, 'http://stab-d'); return ++probes === 1 ? summary(false, ['sse_stream']) : summary(true); }
  });
  assert.equal(r.ok, false);
  assert.deepEqual(backend.calls.at(-1), ['rollbackStable', { imageTagDaemon: 'old-d', imageTagWeb: 'old-w' }]);
  assert.equal(report.outcome, 'rolled_back');
  assert.equal(report.rollback.target, 'stable');
  assert.equal(report.deploy_smoke.stable.decision, 'rollback_stable');
});

test('promoteWithSmoke: failed recovery command, wrong health and thrown recovery never claim rolled_back', async () => {
  for (const failure of ['command', 'health', 'throw']) {
    const report = createEmptyReport(`rel_bad_restore_${failure}`), backend = fakeBackend();
    let probes = 0;
    backend.rollbackStable = async () => {
      if (failure === 'throw') throw new Error('recovery unavailable');
      return { ok: failure !== 'command' };
    };
    const result = await promoteWithSmoke({ cfg, report, backend, tags: {}, log: quiet,
      smoke: async () => { probes++; return summary(false, ['sse_stream']); } });
    assert.equal(result.ok, false);
    assert.equal(report.outcome, 'backlog');
    assert.equal(report.rollback.ok, false);
    assert.equal(probes, failure === 'health' ? 2 : 1);
  }
});

test('verifyCandidate: failed teardown is recorded as backlog, not recovered', async () => {
  const report = createEmptyReport('rel_bad_candidate_restore'), backend = fakeBackend();
  backend.rollbackCandidate = async () => ({ ok: false, detail: 'cannot stop' });
  await verifyCandidate({ cfg, report, backend, log: quiet, smoke: async () => summary(false, ['daemon_readiness']) });
  assert.equal(report.outcome, 'backlog');
  assert.equal(report.rollback.ok, false);
});

test('promoteWithSmoke: awaits asynchronous promotion and passes immutable image evidence', async () => {
  const report = createEmptyReport('rel_async');
  const backend = fakeBackend();
  const tags = { imageIds: { daemon: 'sha256:daemon', web: 'sha256:web' } };
  let promoted = false;
  backend.promoteStable = async (_cfg, evidence) => {
    await Promise.resolve();
    assert.deepEqual(evidence, tags);
    promoted = true;
    return { ok: true };
  };
  const result = await promoteWithSmoke({ cfg, report, backend, tags, log: quiet,
    smoke: async () => { assert.equal(promoted, true); return summary(true); } });
  assert.equal(result.ok, true);
  assert.equal(report.outcome, 'promoted');
});

test('promoteWithSmoke: preserves backend rollback outcome without a second smoke', async () => {
  const report = createEmptyReport('rel_async_rollback');
  const backend = fakeBackend();
  backend.promoteStable = async () => ({ ok: false, rolledBack: true });
  const result = await promoteWithSmoke({ cfg, report, backend, tags: {}, log: quiet,
    smoke: async () => { throw new Error('must not smoke failed promotion'); } });
  assert.equal(result.ok, false);
  assert.equal(report.outcome, 'rolled_back');
});

test('promoteWithSmoke: failing smoke without previous stable cannot roll back', async () => {
  const report = createEmptyReport('rel_t_6');
  const backend = fakeBackend({ previous: null });
  const r = await promoteWithSmoke({ cfg, report, backend, tags: {}, log: quiet, smoke: async () => summary(false, ['web_page']) });
  assert.equal(r.ok, false);
  assert.equal(report.outcome, 'backlog');
  assert.equal(report.rollback.ok, false);
  assert.ok(!backend.calls.some(([name]) => name === 'rollbackStable'));
});

test('promoteWithSmoke: promote failure skips smoke; backend without currentStable records null', async () => {
  const report = createEmptyReport('rel_t_7');
  const backend = fakeBackend({ promoteOk: false });
  delete backend.currentStable;
  const r = await promoteWithSmoke({ cfg, report, backend, tags: {}, log: quiet, smoke: async () => { throw new Error('must not run'); } });
  assert.equal(r.ok, false);
  assert.equal(report.outcome, 'backlog');
  assert.equal(report.stable.previous, null);
});

test('promoteWithSmoke: no stable daemon URL skips smoke and keeps promotion', async () => {
  const report = createEmptyReport('rel_t_8');
  const r = await promoteWithSmoke({ cfg: { ...cfg, stableDaemonUrl: '' }, report, backend: fakeBackend(), tags: {}, log: quiet });
  assert.equal(r.ok, true);
  assert.equal(report.deploy_smoke.stable.decision, 'skip');
});

test('compose parseImageTag handles registry ports, digests and untagged refs', () => {
  assert.equal(composeBackend.parseImageTag('ppeng-agent-core/daemon:rel-1'), 'rel-1');
  assert.equal(composeBackend.parseImageTag('registry:5000/ppeng/daemon'), 'latest');
  assert.equal(composeBackend.parseImageTag('registry:5000/ppeng/web:v2@sha256:abc'), 'v2');
  assert.equal(composeBackend.parseImageTag(''), '');
});

/** Put a fake CLI on PATH that logs argv and answers from a small script. */
function withStubBin(name, body, fn) {
  const dir = mkdtempSync(join(tmpdir(), `stub-${name}-`));
  const log = join(dir, 'calls.log');
  writeFileSync(join(dir, name), `#!/bin/sh\necho "$*" >> "${log}"\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${oldPath}`;
  try {
    return fn(() => readFileSync(log, 'utf8'));
  } finally {
    process.env.PATH = oldPath;
  }
}

const composeCfg = { composeDir: tmpdir(), composeProject: 'ppeng-test' };

test('compose currentStable reads exact running IDs; rollbackStable reuses them without building', { skip: process.platform === 'win32' }, () => {
  const daemon = `sha256:${'a'.repeat(64)}`, web = `sha256:${'b'.repeat(64)}`;
  const body = [
    'case "$*" in',
    '  *"ps -q daemon"*) echo 111 ;;',
    '  *"ps -q web"*) echo 222 ;;',
    `  *"inspect"*111*) echo ${daemon} ;;`,
    `  *"inspect"*222*) echo ${web} ;;`,
    'esac'
  ].join('\n');
  withStubBin('docker', body, (calls) => {
    const prev = composeBackend.currentStable(composeCfg);
    assert.deepEqual(prev, { imageIds: { daemon, web } });
    const r = composeBackend.rollbackStable(composeCfg, prev);
    assert.equal(r.ok, true);
    assert.match(calls(), /-p ppeng-test --profile stable up -d --no-build/);
    assert.match(calls(), /--pull never --wait/);
  });
});

test('compose currentStable is null when stable is not running', { skip: process.platform === 'win32' }, () => {
  withStubBin('docker', 'exit 0', () => {
    assert.equal(composeBackend.currentStable(composeCfg), null);
  });
});

const helmCfg = { repoRoot: tmpdir(), helmReleaseStable: 'ppeng-stable', helmNamespace: 'prod' };

test('helm rollback refuses legacy snapshots without immutable image evidence', () => {
  const calls = [];
  const cfg = { ...helmCfg, executeCommand: (...args) => { calls.push(args); return { status: 0, stdout: '' }; } };
  assert.equal(helmBackend.rollbackStable(cfg, { revision: 7 }).ok, false);
  assert.ok(!calls.some(([, args]) => args[0] === 'rollback'));
});

test('helm currentStable is null when not installed or output is garbage', { skip: process.platform === 'win32' }, () => {
  withStubBin('helm', 'exit 1', () => assert.equal(helmBackend.currentStable(helmCfg), null));
  withStubBin('helm', 'echo not-json', () => assert.equal(helmBackend.currentStable(helmCfg), null));
  withStubBin('helm', 'echo \'{"version":0}\'', () => assert.equal(helmBackend.currentStable(helmCfg), null));
});
