import test from 'node:test';
import assert from 'node:assert/strict';
import { decideGoalTurn } from '../dist/goal/decide-goal-turn.js';
import { parseGoalEvalJson } from '../dist/goal/parse-goal-eval.js';
import { GoalGate, resolveGoalCondition } from '../dist/goal/goal-gate.js';

test('parseGoalEvalJson: valid met/reason', () => {
  const r = parseGoalEvalJson('{"met":false,"reason":"tests not green","progress":"stalled"}');
  assert.equal(r.met, false);
  assert.equal(r.progress, 'stalled');
});

test('parseGoalEvalJson: rejects missing met', () => {
  assert.equal(parseGoalEvalJson('{"reason":"x"}'), undefined);
});

test('decideGoalTurn: met → achieved', () => {
  const d = decideGoalTurn({
    evalResult: { met: true, reason: 'done', source: 'model' },
    steerTexts: [],
    ledger: []
  });
  assert.equal(d.kind, 'achieved');
});

test('decideGoalTurn: double stalled → close', () => {
  const d = decideGoalTurn({
    evalResult: { met: false, reason: 'nope', source: 'model', progress: 'stalled' },
    steerTexts: [],
    ledger: [{ turn: 1, met: false, reason: 'r', progress: 'stalled', at: 't' }]
  });
  assert.equal(d.kind, 'close');
  assert.equal(d.event, 'stalled');
});

test('decideGoalTurn: exhausted at maxTurns', () => {
  const d = decideGoalTurn({
    evalResult: { met: false, reason: 'still going', source: 'model' },
    steerTexts: [],
    ledger: [],
    turnsUsed: 3,
    maxTurns: 3
  });
  assert.equal(d.kind, 'close');
  assert.equal(d.event, 'exhausted');
});

test('resolveGoalCondition from metadata', () => {
  assert.equal(resolveGoalCondition({ goalCondition: ' ship it ' }), 'ship it');
  assert.equal(resolveGoalCondition({}), undefined);
});

test('GoalGate.evaluate fail-open on judge throw', async () => {
  const gate = new GoalGate({ condition: 'done', maxTurns: 5 });
  const { evalResult, decision } = await gate.evaluate({
    snapshot: 'assistant: hi',
    judge: async () => {
      throw new Error('boom');
    }
  });
  assert.equal(evalResult.source, 'fail-open-error');
  assert.equal(evalResult.met, true);
  assert.equal(decision.kind, 'achieved');
});

test('GoalGate.evaluate verify 失败则 fail-closed 且不跑判官', async () => {
  const gate = new GoalGate({ condition: 'files exist', maxTurns: 5 });
  let judged = false;
  const { evalResult, decision } = await gate.evaluate({
    snapshot: 'assistant: done',
    judge: async () => {
      judged = true;
      return JSON.stringify({ met: true, reason: 'should not run' });
    },
    verify: async () => ({ ok: false, reason: 'verify files_exist 失败，缺失：out/a.txt' })
  });
  assert.equal(judged, false);
  assert.equal(evalResult.source, 'verify-failed');
  assert.equal(evalResult.met, false);
  assert.equal(decision.kind, 'continue');
});

test('GoalGate.evaluate continues when met=false', async () => {
  const gate = new GoalGate({ condition: 'tests pass', maxTurns: 5 });
  const { decision } = await gate.evaluate({
    snapshot: 'assistant: working',
    judge: async () => JSON.stringify({ met: false, reason: 'no tests yet' })
  });
  assert.equal(decision.kind, 'continue');
  assert.equal(gate.getTurnsUsed(), 1);
});
