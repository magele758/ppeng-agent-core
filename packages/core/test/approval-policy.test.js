import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseApprovalPolicyFromEnv,
  policyRequiresApproval,
  policySkipsAutoApproval
} from '../dist/approval-policy.js';

test('parseApprovalPolicyFromEnv returns undefined for missing env', () => {
  const saved = process.env.RAW_AGENT_APPROVAL_POLICY;
  delete process.env.RAW_AGENT_APPROVAL_POLICY;
  const result = parseApprovalPolicyFromEnv(process.env);
  assert.equal(result, undefined);
  if (saved !== undefined) process.env.RAW_AGENT_APPROVAL_POLICY = saved;
});

test('parseApprovalPolicyFromEnv parses valid JSON', () => {
  const saved = process.env.RAW_AGENT_APPROVAL_POLICY;
  process.env.RAW_AGENT_APPROVAL_POLICY = JSON.stringify({
    defaultRisky: true,
    rules: [{ toolPattern: 'bash', match: 'exact', when: 'always' }]
  });
  const result = parseApprovalPolicyFromEnv(process.env);
  assert.equal(result.defaultRisky, true);
  assert.equal(result.rules.length, 1);
  if (saved !== undefined) process.env.RAW_AGENT_APPROVAL_POLICY = saved;
  else delete process.env.RAW_AGENT_APPROVAL_POLICY;
});

test('parseApprovalPolicyFromEnv returns undefined for invalid JSON', () => {
  const saved = process.env.RAW_AGENT_APPROVAL_POLICY;
  process.env.RAW_AGENT_APPROVAL_POLICY = 'not valid json';
  const result = parseApprovalPolicyFromEnv(process.env);
  assert.equal(result, undefined);
  if (saved !== undefined) process.env.RAW_AGENT_APPROVAL_POLICY = saved;
  else delete process.env.RAW_AGENT_APPROVAL_POLICY;
});

test('policyRequiresApproval matches exact tool name', () => {
  const policy = {
    rules: [{ toolPattern: 'bash', match: 'exact', when: 'always' }]
  };
  assert.equal(policyRequiresApproval(policy, 'bash'), true);
  assert.equal(policyRequiresApproval(policy, 'bash_script'), false);
  assert.equal(policyRequiresApproval(policy, 'write_file'), false);
});

test('policyRequiresApproval matches glob pattern', () => {
  const policy = {
    rules: [{ toolPattern: 'bash*', match: 'glob', when: 'always' }]
  };
  assert.equal(policyRequiresApproval(policy, 'bash'), true);
  assert.equal(policyRequiresApproval(policy, 'bash_script'), true);
  assert.equal(policyRequiresApproval(policy, 'write_file'), false);
});

test('policyRequiresApproval returns false when when is auto', () => {
  const policy = {
    rules: [{ toolPattern: 'bash', match: 'exact', when: 'auto' }]
  };
  assert.equal(policyRequiresApproval(policy, 'bash'), false);
});

test('policyRequiresApproval returns false for undefined policy', () => {
  assert.equal(policyRequiresApproval(undefined, 'bash'), false);
});

test('policyRequiresApproval returns false for empty rules', () => {
  assert.equal(policyRequiresApproval({ rules: [] }, 'bash'), false);
});

test('policyRequiresApproval glob matches * anywhere', () => {
  const policy = {
    rules: [{ toolPattern: '*_file', match: 'glob', when: 'always' }]
  };
  assert.equal(policyRequiresApproval(policy, 'read_file'), true);
  assert.equal(policyRequiresApproval(policy, 'write_file'), true);
  assert.equal(policyRequiresApproval(policy, 'edit_file'), true);
  assert.equal(policyRequiresApproval(policy, 'file'), false);
  assert.equal(policyRequiresApproval(policy, 'file_read'), false);
});

test('policyRequiresApproval glob ? matches single char', () => {
  const policy = {
    rules: [{ toolPattern: 'bash?', match: 'glob', when: 'always' }]
  };
  assert.equal(policyRequiresApproval(policy, 'bash'), false);
  assert.equal(policyRequiresApproval(policy, 'bash1'), true);
  assert.equal(policyRequiresApproval(policy, 'bash12'), false);
});

test('policySkipsAutoApproval returns true when when=auto', () => {
  const policy = {
    rules: [{ toolPattern: 'bash', match: 'exact', when: 'auto' }]
  };
  assert.equal(policySkipsAutoApproval(policy, 'bash'), true);
  assert.equal(policySkipsAutoApproval(policy, 'write_file'), false);
});

test('policySkipsAutoApproval returns false for when=always', () => {
  const policy = {
    rules: [{ toolPattern: 'bash', match: 'exact', when: 'always' }]
  };
  assert.equal(policySkipsAutoApproval(policy, 'bash'), false);
});

test('policySkipsAutoApproval returns false for undefined policy', () => {
  assert.equal(policySkipsAutoApproval(undefined, 'bash'), false);
});

test('policy rules are evaluated in order (first match wins)', () => {
  const policy = {
    rules: [
      { toolPattern: 'bash', match: 'exact', when: 'always' },
      { toolPattern: 'bash', match: 'exact', when: 'auto' }
    ]
  };
  // First rule with when='always' should match
  assert.equal(policyRequiresApproval(policy, 'bash'), true);
  // First rule doesn't have when='auto', so policySkipsAutoApproval continues to second
  assert.equal(policySkipsAutoApproval(policy, 'bash'), true);
});

test('policyRequiresApproval escapes regex special chars in exact match', () => {
  const policy = {
    rules: [{ toolPattern: 'tool.name', match: 'exact', when: 'always' }]
  };
  // In exact mode, the dot should be treated literally
  assert.equal(policyRequiresApproval(policy, 'tool.name'), true);
  assert.equal(policyRequiresApproval(policy, 'toolXname'), false);
});

test('policyRequiresApproval escapes regex special chars in glob pattern', () => {
  const policy = {
    rules: [{ toolPattern: 'tool.*', match: 'glob', when: 'always' }]
  };
  // The * should match any suffix, but the dot is literal
  assert.equal(policyRequiresApproval(policy, 'tool.read'), true);
  assert.equal(policyRequiresApproval(policy, 'tool.write_file'), true);
  assert.equal(policyRequiresApproval(policy, 'toolXread'), false);
});

test('policyRequiresApproval handles empty toolPattern', () => {
  const policy = {
    rules: [{ toolPattern: '', match: 'exact', when: 'always' }]
  };
  assert.equal(policyRequiresApproval(policy, ''), true);
  assert.equal(policyRequiresApproval(policy, 'bash'), false);
});

test('policyRequiresApproval handles multiple rules', () => {
  const policy = {
    rules: [
      { toolPattern: 'bash', match: 'exact', when: 'always' },
      { toolPattern: 'write_*', match: 'glob', when: 'always' }
    ]
  };
  assert.equal(policyRequiresApproval(policy, 'bash'), true);
  assert.equal(policyRequiresApproval(policy, 'write_file'), true);
  assert.equal(policyRequiresApproval(policy, 'read_file'), false);
});
