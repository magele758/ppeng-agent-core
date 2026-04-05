import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filePolicyRequiresBashApproval,
  filePolicyRequiresPathApproval,
  mergeApprovalPolicies,
} from '../dist/approval/policy-loader.js';

// ── filePolicyRequiresBashApproval ──

test('bash approval: returns false when policy is undefined', () => {
  assert.equal(filePolicyRequiresBashApproval(undefined, 'rm -rf /'), false);
});

test('bash approval: returns false when no bashCommandPatterns', () => {
  assert.equal(filePolicyRequiresBashApproval({}, 'rm -rf /'), false);
});

test('bash approval: returns false when patterns array is empty', () => {
  assert.equal(filePolicyRequiresBashApproval({ bashCommandPatterns: [] }, 'rm'), false);
});

test('bash approval: matches substring pattern', () => {
  const policy = { bashCommandPatterns: [{ pattern: 'rm -rf' }] };
  assert.equal(filePolicyRequiresBashApproval(policy, 'rm -rf /tmp'), true);
  assert.equal(filePolicyRequiresBashApproval(policy, 'ls -la'), false);
});

test('bash approval: matches regex pattern', () => {
  const policy = { bashCommandPatterns: [{ pattern: '/^sudo\\s/' }] };
  assert.equal(filePolicyRequiresBashApproval(policy, 'sudo apt install'), true);
  assert.equal(filePolicyRequiresBashApproval(policy, 'not sudo'), false);
});

test('bash approval: invalid regex falls back to no match', () => {
  const policy = { bashCommandPatterns: [{ pattern: '/[invalid/' }] };
  assert.equal(filePolicyRequiresBashApproval(policy, '[invalid'), false);
});

test('bash approval: when=auto skips the rule', () => {
  const policy = { bashCommandPatterns: [{ pattern: 'rm', when: 'auto' }] };
  assert.equal(filePolicyRequiresBashApproval(policy, 'rm -rf /'), false);
});

test('bash approval: when=always triggers the rule', () => {
  const policy = { bashCommandPatterns: [{ pattern: 'deploy', when: 'always' }] };
  assert.equal(filePolicyRequiresBashApproval(policy, 'deploy prod'), true);
});

test('bash approval: multiple patterns, first match wins', () => {
  const policy = {
    bashCommandPatterns: [
      { pattern: 'safe', when: 'auto' },
      { pattern: 'dangerous' },
    ],
  };
  assert.equal(filePolicyRequiresBashApproval(policy, 'safe command'), false);
  assert.equal(filePolicyRequiresBashApproval(policy, 'dangerous command'), true);
});

// ── filePolicyRequiresPathApproval ──

test('path approval: returns false when policy is undefined', () => {
  assert.equal(filePolicyRequiresPathApproval(undefined, 'write_file', 'src/foo.ts'), false);
});

test('path approval: returns false when no pathRules', () => {
  assert.equal(filePolicyRequiresPathApproval({}, 'write_file', 'src/foo.ts'), false);
});

test('path approval: exact tool match with path prefix', () => {
  const policy = {
    pathRules: [{ toolPattern: 'write_file', match: 'exact', pathPrefix: 'src/', when: 'always' }],
  };
  assert.equal(filePolicyRequiresPathApproval(policy, 'write_file', 'src/foo.ts'), true);
  assert.equal(filePolicyRequiresPathApproval(policy, 'read_file', 'src/foo.ts'), false);
});

test('path approval: glob tool match', () => {
  const policy = {
    pathRules: [{ toolPattern: 'write_*', match: 'glob', pathPrefix: 'config/', when: 'always' }],
  };
  assert.equal(filePolicyRequiresPathApproval(policy, 'write_file', 'config/app.json'), true);
  assert.equal(filePolicyRequiresPathApproval(policy, 'write_block', 'config/app.json'), true);
  assert.equal(filePolicyRequiresPathApproval(policy, 'read_file', 'config/app.json'), false);
});

test('path approval: normalizes Windows-style paths', () => {
  const policy = {
    pathRules: [{ toolPattern: 'write_file', match: 'exact', pathPrefix: 'src/', when: 'always' }],
  };
  assert.equal(filePolicyRequiresPathApproval(policy, 'write_file', 'src\\foo.ts'), true);
});

test('path approval: strips leading ./ from paths', () => {
  const policy = {
    pathRules: [{ toolPattern: 'write_file', match: 'exact', pathPrefix: 'src/', when: 'always' }],
  };
  assert.equal(filePolicyRequiresPathApproval(policy, 'write_file', './src/foo.ts'), true);
});

test('path approval: exact path match (not just prefix)', () => {
  const policy = {
    pathRules: [{ toolPattern: 'edit_file', match: 'exact', pathPrefix: 'README.md', when: 'always' }],
  };
  assert.equal(filePolicyRequiresPathApproval(policy, 'edit_file', 'README.md'), true);
  assert.equal(filePolicyRequiresPathApproval(policy, 'edit_file', 'README.md.bak'), false);
});

test('path approval: path outside prefix not matched', () => {
  const policy = {
    pathRules: [{ toolPattern: 'write_file', match: 'exact', pathPrefix: 'src/', when: 'always' }],
  };
  assert.equal(filePolicyRequiresPathApproval(policy, 'write_file', 'test/foo.ts'), false);
});

// ── mergeApprovalPolicies ──

test('merge: returns undefined when both are undefined', () => {
  assert.equal(mergeApprovalPolicies(undefined, undefined), undefined);
});

test('merge: returns file policy when env is undefined', () => {
  const file = { defaultRisky: true, rules: [{ toolPattern: 'bash', match: 'exact', when: 'always' }] };
  const merged = mergeApprovalPolicies(file, undefined);
  assert.equal(merged.defaultRisky, true);
  assert.equal(merged.rules.length, 1);
});

test('merge: returns env policy when file is undefined', () => {
  const env = { defaultRisky: false, rules: [{ toolPattern: 'exec', match: 'exact', when: 'always' }] };
  const merged = mergeApprovalPolicies(undefined, env);
  assert.equal(merged.defaultRisky, false);
  assert.equal(merged.rules.length, 1);
});

test('merge: env defaultRisky overrides file defaultRisky', () => {
  const file = { defaultRisky: true };
  const env = { defaultRisky: false };
  const merged = mergeApprovalPolicies(file, env);
  assert.equal(merged.defaultRisky, false);
});

test('merge: concatenates rules from both', () => {
  const file = { rules: [{ toolPattern: 'a', match: 'exact', when: 'always' }] };
  const env = { rules: [{ toolPattern: 'b', match: 'exact', when: 'always' }] };
  const merged = mergeApprovalPolicies(file, env);
  assert.equal(merged.rules.length, 2);
});

test('merge: preserves bashCommandPatterns from file only', () => {
  const file = { bashCommandPatterns: [{ pattern: 'rm' }] };
  const env = {};
  const merged = mergeApprovalPolicies(file, env);
  assert.ok(merged.bashCommandPatterns);
  assert.equal(merged.bashCommandPatterns.length, 1);
});

test('merge: preserves pathRules from file only', () => {
  const file = { pathRules: [{ toolPattern: 'w*', match: 'glob', pathPrefix: 'x/', when: 'always' }] };
  const merged = mergeApprovalPolicies(file, undefined);
  assert.ok(merged.pathRules);
  assert.equal(merged.pathRules.length, 1);
});
