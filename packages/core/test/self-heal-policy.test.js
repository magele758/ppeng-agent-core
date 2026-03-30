import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSelfHealPolicy,
  npmScriptForSelfHealPolicy,
  isValidCustomNpmScriptName
} from '../dist/self-heal-policy.js';

test('normalizeSelfHealPolicy defaults', () => {
  const p = normalizeSelfHealPolicy({});
  assert.equal(p.testPreset, 'unit');
  assert.equal(p.maxFixIterations, 5);
  assert.equal(p.autoMerge, false);
  assert.equal(p.autoRestartDaemon, false);
  assert.ok(p.agentId);
});

test('npmScriptForSelfHealPolicy presets', () => {
  assert.equal(npmScriptForSelfHealPolicy({ ...normalizeSelfHealPolicy({ testPreset: 'ci' }), testPreset: 'ci' }), 'ci');
  assert.equal(
    npmScriptForSelfHealPolicy({ ...normalizeSelfHealPolicy({ testPreset: 'unit' }), testPreset: 'unit' }),
    'test:unit'
  );
});

test('custom npm script validation', () => {
  assert.ok(isValidCustomNpmScriptName('test:foo-bar'));
  assert.ok(!isValidCustomNpmScriptName('foo;rm'));
  const custom = normalizeSelfHealPolicy({ testPreset: 'custom', customNpmScript: 'build' });
  assert.equal(npmScriptForSelfHealPolicy(custom), 'build');
});

test('normalizeSelfHealPolicy caps maxFixIterations', () => {
  const p = normalizeSelfHealPolicy({ maxFixIterations: 999 });
  assert.equal(p.maxFixIterations, 50);
});
