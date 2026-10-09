import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GATE_CHECK,
  aggregateRuns,
  evaluateProtection,
  gateOutcome,
  renderText,
  runScope,
  summarizeFlaky,
  summarizeRun
} from '../ci/gate-health-lib.mjs';

const TESTS_JOB = 'Release gate / Build, unit tests, HTTP regression, E2E';
const CRAP_JOB = 'Release gate / agent-loop tests + CRAP gate';

function run(id, over = {}) {
  return { databaseId: id, event: 'push', headBranch: 'main', conclusion: 'success', url: `u/${id}`, displayTitle: `t${id}`, createdAt: '2026-10-01T00:00:00Z', ...over };
}

function jobs({ gate = 'success', tests = 'success', crap = 'success', crapSteps = [] } = {}) {
  return [
    { name: 'Check remote-smoke secrets', conclusion: 'failure', steps: [{ name: 'x', conclusion: 'failure' }] },
    { name: TESTS_JOB, conclusion: tests, steps: [{ name: 'Unit tests', conclusion: tests === 'failure' ? 'failure' : 'success' }] },
    { name: CRAP_JOB, conclusion: crap, steps: crapSteps },
    { name: GATE_CHECK, conclusion: gate, steps: [{ name: 'All gate jobs must succeed', conclusion: gate }] }
  ];
}

test('runScope splits main pushes, PRs and other branches', () => {
  assert.equal(runScope({ event: 'push', headBranch: 'main' }), 'main');
  assert.equal(runScope({ event: 'pull_request', headBranch: 'feature' }), 'pr');
  assert.equal(runScope({ event: 'push', headBranch: 'feature' }), 'other');
  assert.equal(runScope({ event: 'workflow_dispatch', headBranch: 'main' }), 'other');
  assert.equal(runScope({ event: 'push', headBranch: 'trunk' }, 'trunk'), 'main');
});

test('gateOutcome maps conclusions', () => {
  assert.equal(gateOutcome('success'), 'pass');
  assert.equal(gateOutcome('failure'), 'fail');
  assert.equal(gateOutcome('timed_out'), 'fail');
  assert.equal(gateOutcome('cancelled'), 'neutral');
  assert.equal(gateOutcome(null), 'missing');
});

test('summarizeRun only attributes failures to release-gate jobs and steps', () => {
  const s = summarizeRun(
    run(1),
    jobs({ gate: 'failure', crap: 'failure', crapSteps: [{ name: 'Checkout', conclusion: 'success' }, { name: 'CRAP gate', conclusion: 'failure' }] })
  );
  assert.equal(s.gate, 'fail');
  assert.deepEqual(s.failedJobs, [CRAP_JOB]);
  assert.deepEqual(s.failedSteps, [`${CRAP_JOB} › CRAP gate`]);
});

test('summarizeRun treats a gate failure in a cancelled (superseded) run as neutral', () => {
  const s = summarizeRun(run(1, { conclusion: 'cancelled' }), jobs({ gate: 'failure', tests: 'cancelled', crap: 'cancelled' }));
  assert.equal(s.gate, 'neutral');
});

test('summarizeRun reports runs without the gate job as missing', () => {
  assert.equal(summarizeRun(run(1), [{ name: 'build', conclusion: 'success' }]).gate, 'missing');
});

test('aggregateRuns computes per-scope pass rate excluding neutral runs and ranks failures', () => {
  const summaries = [
    summarizeRun(run(1), jobs()),
    summarizeRun(run(2), jobs({ gate: 'failure', tests: 'failure' })),
    summarizeRun(run(3, { event: 'pull_request', headBranch: 'f' }), jobs({ gate: 'failure', tests: 'failure', crap: 'failure' })),
    summarizeRun(run(4, { event: 'pull_request', headBranch: 'f', conclusion: 'cancelled' }), jobs({ gate: 'failure' })),
    summarizeRun(run(5, { headBranch: 'f' }), jobs())
  ];
  const agg = aggregateRuns(summaries);
  assert.deepEqual(agg.byScope.main, { runs: 2, pass: 1, fail: 1, neutral: 0, missing: 0, passRate: 0.5 });
  assert.deepEqual(agg.byScope.pr, { runs: 2, pass: 0, fail: 1, neutral: 1, missing: 0, passRate: 0 });
  assert.equal(agg.byScope.other.passRate, 1);
  assert.equal(agg.byScope.all.runs, 5);
  assert.deepEqual(agg.jobFailures, [
    { name: TESTS_JOB, count: 2 },
    { name: CRAP_JOB, count: 1 }
  ]);
  assert.deepEqual(agg.stepFailures, [{ name: `${TESTS_JOB} › Unit tests`, count: 2 }]);
  assert.deepEqual(agg.failedRuns.map((r) => r.id), [2, 3]);
});

test('aggregateRuns has null pass rate when nothing decisive ran', () => {
  assert.equal(aggregateRuns([]).byScope.all.passRate, null);
});

test('summarizeFlaky merges per-artifact reports', () => {
  const flaky = summarizeFlaky([
    { runId: 1, report: { retried: true, flaky: [{ file: 'a.test.js', tests: [{ name: 'x' }] }], failed: [] } },
    { runId: 1, report: { retried: true, flaky: [{ file: 'a.test.js', tests: [{ name: 'x' }] }], failed: [{ file: 'b' }] } },
    { runId: 2, report: { retried: false, flaky: [], failed: [{ file: 'c' }] } },
    { runId: 3, report: { garbage: true } }
  ]);
  assert.deepEqual(flaky, {
    runsWithReports: 2,
    runsWithFlaky: 1,
    occurrences: 2,
    failedTwice: 1,
    byFile: [{ name: 'a.test.js', count: 2 }],
    byTest: [{ name: 'a.test.js › x', count: 2 }]
  });
});

test('evaluateProtection reads the admin protection endpoint when allowed', () => {
  const p = evaluateProtection({
    protection: { status: 200, body: { required_status_checks: { strict: true, contexts: [GATE_CHECK], checks: [{ context: 'other' }] } } },
    branch: null,
    rules: null
  });
  assert.equal(p.status, 'required');
  assert.equal(p.strict, true);
  assert.equal(p.protectedBranch, true);
  assert.deepEqual(p.requiredChecks, [GATE_CHECK, 'other'].sort());
});

test('evaluateProtection falls back to branch summary + rulesets on 403', () => {
  const unprotected = evaluateProtection({
    protection: { status: 403, body: null },
    branch: { protected: false, protection: { enabled: false, required_status_checks: { contexts: [], checks: [] } } },
    rules: []
  });
  assert.equal(unprotected.status, 'not-required');
  assert.equal(unprotected.protectedBranch, false);
  assert.match(unprotected.source, /HTTP 403.*rulesets/);

  const viaRuleset = evaluateProtection({
    protection: { status: 404, body: null },
    branch: { protected: true, protection: {} },
    rules: [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: GATE_CHECK }] } }]
  });
  assert.equal(viaRuleset.status, 'required');
  assert.equal(viaRuleset.viaRuleset, true);
  assert.equal(viaRuleset.strict, true);
});

test('evaluateProtection is unknown when nothing could be read', () => {
  const p = evaluateProtection({ protection: { status: 403, body: null }, branch: null, rules: null });
  assert.equal(p.status, 'unknown');
  assert.equal(p.protectedBranch, null);
});

test('renderText shows pass rates, flaky stats and the protection hint', () => {
  const summaries = [summarizeRun(run(1), jobs()), summarizeRun(run(2), jobs({ gate: 'failure', tests: 'failure' }))];
  const text = renderText({
    meta: { repo: 'o/r', workflow: 'ci.yml', branch: 'main', runs: 2, from: 'a', to: 'b' },
    aggregate: aggregateRuns(summaries),
    flaky: summarizeFlaky([{ runId: 1, report: { retried: true, flaky: [{ file: 'f.js', tests: [{ name: 'n' }] }], failed: [] } }]),
    protection: evaluateProtection({ protection: { status: 403 }, branch: { protected: false, protection: {} }, rules: [] })
  });
  assert.match(text, /main +50\.0% +\(pass 1, fail 1/);
  assert.match(text, /1× Release gate \/ Build, unit tests, HTTP regression, E2E › Unit tests/);
  assert.match(text, /1× f\.js › n/);
  assert.match(text, /"Release gate \/ Main release gate" required: NO/);
  assert.match(text, /启用分支保护/);
});
