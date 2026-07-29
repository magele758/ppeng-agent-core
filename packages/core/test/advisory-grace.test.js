import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdvisoryGrace,
  advisoryGraceBudget,
  advisoryGraceEnabled,
  formatRecoveryAdvisory
} from '../dist/recovery/advisory-grace.js';

test('advisoryGraceEnabled defaults on', () => {
  assert.equal(advisoryGraceEnabled({}), true);
  assert.equal(advisoryGraceEnabled({ RAW_AGENT_RECOVERY_ADVISORY_GRACE: '0' }), false);
});

test('advisoryGraceBudget clamps', () => {
  assert.equal(advisoryGraceBudget({}), 1);
  assert.equal(advisoryGraceBudget({ RAW_AGENT_RECOVERY_ADVISORY_GRACE_BUDGET: '99' }), 5);
  assert.equal(advisoryGraceBudget({ RAW_AGENT_RECOVERY_ADVISORY_GRACE_BUDGET: '-1' }), 0);
});

test('AdvisoryGrace: first abort → advise, second → abort', () => {
  const g = new AdvisoryGrace(1);
  assert.equal(g.apply({ abort: false }).action, 'continue');
  const first = g.apply({ abort: true, reason: 'tool "bash" failed 3 times in a row' });
  assert.equal(first.action, 'advise');
  assert.match(first.advisory, /recovery-advisory/);
  assert.equal(g.remainingBudget, 0);
  const second = g.apply({ abort: true, reason: 'tool "bash" failed 3 times in a row' });
  assert.equal(second.action, 'abort');
});

test('AdvisoryGrace budget 0 never advises', () => {
  const g = new AdvisoryGrace(0);
  const out = g.apply({ abort: true, reason: 'repeat' });
  assert.equal(out.action, 'abort');
});

test('formatRecoveryAdvisory includes reason', () => {
  assert.match(formatRecoveryAdvisory('same tool'), /same tool/);
});
