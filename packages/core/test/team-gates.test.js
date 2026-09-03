import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGateEvent,
  commandExists,
  initGatesFromSettings,
  nextRunnableGate,
  transitionGate
} from '../dist/teams/gates.js';
import { defaultTeamsDagSettings } from '../dist/teams/settings.js';

test('gate 合法转移', () => {
  assert.equal(transitionGate('pending', 'start'), 'running');
  assert.equal(transitionGate('pending', 'skip'), 'skipped');
  assert.equal(transitionGate('running', 'pass'), 'passed');
  assert.equal(transitionGate('running', 'fail'), 'failed');
  assert.equal(transitionGate('running', 'need_human'), 'awaiting_human');
  assert.equal(transitionGate('awaiting_human', 'pass'), 'passed');
  assert.equal(transitionGate('awaiting_human', 'fail'), 'failed');
});

test('gate 非法转移 throw', () => {
  const illegal = [
    ['passed', 'fail'],
    ['passed', 'start'],
    ['skipped', 'start'],
    ['failed', 'pass'],
    ['pending', 'pass'],
    ['awaiting_human', 'start']
  ];
  for (const [from, event] of illegal) {
    assert.throws(() => transitionGate(from, event), /非法转移/, `${from} --${event}`);
  }
});

test('默认门禁：review/release 开，regression 关', () => {
  const gates = initGatesFromSettings(defaultTeamsDagSettings());
  assert.equal(gates.find((g) => g.name === 'review')?.status, 'pending');
  assert.equal(gates.find((g) => g.name === 'regression')?.status, 'skipped');
  assert.equal(gates.find((g) => g.name === 'release')?.status, 'pending');
  assert.equal(nextRunnableGate(gates)?.name, 'review');
  const started = applyGateEvent(gates[0], 'start');
  assert.equal(started.status, 'running');
});

test('command 存在性检查不执行危险 shell', () => {
  const bad = commandExists('rm -rf /');
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /非法/);
  const missing = commandExists('definitely-not-a-real-bin-zz');
  assert.equal(missing.ok, false);
  const node = commandExists('node');
  assert.equal(node.ok, true);
});
