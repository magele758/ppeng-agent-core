import test from 'node:test';
import assert from 'node:assert/strict';
import { AdvisoryQueue } from '../dist/recovery/advisory-queue.js';
import { formatRiskAdvisory, RiskEngine } from '../dist/recovery/risk-engine.js';

test('RiskEngine: tool error streak triggers advise', () => {
  const eng = new RiskEngine({
    toolErrorStreakThreshold: 2,
    maxCoachPerSession: 3,
    coachCooldownIters: 0,
    userQuietWindowIters: 0
  });
  eng.observeTool({ toolName: 'bash', success: false, errorMessage: 'fail' });
  assert.equal(eng.tick({ iteration: 1, iterationLimit: 20 }).shouldAdvise, false);
  eng.observeTool({ toolName: 'bash', success: false, errorMessage: 'fail' });
  const t = eng.tick({ iteration: 2, iterationLimit: 20 });
  assert.equal(t.shouldAdvise, true);
  assert.ok(t.signals.some((s) => s.type === 'tool_error_streak'));
});

test('RiskEngine: respects max coach budget', () => {
  const eng = new RiskEngine({
    toolErrorStreakThreshold: 1,
    maxCoachPerSession: 1,
    coachCooldownIters: 0,
    userQuietWindowIters: 0
  });
  eng.observeTool({ toolName: 'x', success: false, errorMessage: 'e' });
  assert.equal(eng.tick({ iteration: 1, iterationLimit: 10 }).shouldAdvise, true);
  eng.observeTool({ toolName: 'x', success: false, errorMessage: 'e' });
  const t2 = eng.tick({ iteration: 2, iterationLimit: 10 });
  assert.equal(t2.shouldAdvise, false);
  assert.equal(t2.reason, 'max_coach');
});

test('AdvisoryQueue drainCombined', () => {
  const q = new AdvisoryQueue();
  q.enqueue('one', 'risk');
  q.enqueue('two', 'goal');
  assert.equal(q.size, 2);
  const combined = q.drainCombined();
  assert.match(combined, /one/);
  assert.match(combined, /two/);
  assert.equal(q.size, 0);
});

test('formatRiskAdvisory bounded', () => {
  const text = formatRiskAdvisory([{ type: 'budget_high', magnitude: 0.9 }]);
  assert.match(text, /risk-advisory/);
  assert.ok(text.length <= 600);
});
