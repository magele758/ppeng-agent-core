import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSelfHealPolicy,
  npmScriptForSelfHealPolicy,
  isValidCustomNpmScriptName
} from '../dist/self-heal-policy.js';

const SELF_HEAL_ENV_KEYS = [
  'RAW_AGENT_SELF_HEAL_TEST_PRESET',
  'RAW_AGENT_SELF_HEAL_MAX_ITERATIONS',
  'RAW_AGENT_SELF_HEAL_AUTO_MERGE',
  'RAW_AGENT_SELF_HEAL_AUTO_RESTART',
  'RAW_AGENT_SELF_HEAL_CUSTOM_SCRIPT',
  'RAW_AGENT_SELF_HEAL_AGENT_ID',
  'RAW_AGENT_SELF_HEAL_TARGET_BRANCH',
  'RAW_AGENT_SELF_HEAL_ALLOW_EXTERNAL_AI'
];

test('normalizeSelfHealPolicy defaults', (t) => {
  const saved = {};
  for (const k of SELF_HEAL_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  t.after(() => {
    for (const k of SELF_HEAL_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
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
