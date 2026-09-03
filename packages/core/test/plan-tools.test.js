import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlanEvent } from '../dist/tools/plan-tools.js';

test('plan: submit → confirm → start → complete', () => {
  const submitted = applyPlanEvent(null, { type: 'submit', analysis: 'do it', steps: ['a', 'b'] });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.state.confirmed, false);
  const confirmed = applyPlanEvent(submitted.state, { type: 'confirm' });
  assert.equal(confirmed.ok, true);
  const started = applyPlanEvent(confirmed.state, { type: 'start', stepIndex: 1 });
  assert.equal(started.ok, true);
  assert.equal(started.state.steps[0].status, 'in_progress');
  const done = applyPlanEvent(started.state, { type: 'complete', stepIndex: 1, result: 'ok' });
  assert.equal(done.ok, true);
  assert.equal(done.state.steps[0].status, 'completed');
});

test('plan: 非法转移', () => {
  assert.equal(applyPlanEvent(null, { type: 'confirm' }).ok, false);
  const submitted = applyPlanEvent(null, { type: 'submit', analysis: 'x', steps: ['a', 'b'] });
  assert.equal(applyPlanEvent(submitted.state, { type: 'start', stepIndex: 1 }).ok, false);
  const confirmed = applyPlanEvent(submitted.state, { type: 'confirm' });
  assert.equal(applyPlanEvent(confirmed.state, { type: 'complete', stepIndex: 1 }).ok, false);
  const started = applyPlanEvent(confirmed.state, { type: 'start', stepIndex: 1 });
  assert.equal(applyPlanEvent(started.state, { type: 'start', stepIndex: 2 }).ok, false);
  assert.match(applyPlanEvent(started.state, { type: 'start', stepIndex: 2 }).error, /仍在进行中/);
  const failed = applyPlanEvent(started.state, { type: 'fail', stepIndex: 1, error: 'boom' });
  assert.equal(failed.ok, true);
  assert.equal(applyPlanEvent(failed.state, { type: 'complete', stepIndex: 1 }).ok, false);
});

test('plan: submit 步骤数量', () => {
  assert.equal(applyPlanEvent(null, { type: 'submit', analysis: 'x', steps: ['only'] }).ok, false);
  assert.equal(
    applyPlanEvent(null, { type: 'submit', analysis: 'x', steps: Array.from({ length: 11 }, (_, i) => `s${i}`) }).ok,
    false
  );
});
