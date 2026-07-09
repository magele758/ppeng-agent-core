import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPermissionModeGate,
  parsePermissionMode,
  resolvePermissionMode
} from '../dist/approval/permission-mode.js';

test('parsePermissionMode accepts known modes', () => {
  assert.equal(parsePermissionMode('plan'), 'plan');
  assert.equal(parsePermissionMode('ask'), 'ask');
  assert.equal(parsePermissionMode('acceptEdits'), 'acceptEdits');
  assert.equal(parsePermissionMode('nope'), undefined);
});

test('resolvePermissionMode prefers session metadata over env', () => {
  assert.equal(
    resolvePermissionMode({ permissionMode: 'plan' }, { RAW_AGENT_PERMISSION_MODE: 'ask' }),
    'plan'
  );
  assert.equal(resolvePermissionMode({}, { RAW_AGENT_PERMISSION_MODE: 'ask' }), 'ask');
  assert.equal(resolvePermissionMode({}, {}), 'auto');
});

test('plan mode denies bash and allows read_file', () => {
  assert.deepEqual(applyPermissionModeGate('plan', 'read_file', 'never'), { action: 'proceed' });
  const deny = applyPermissionModeGate('plan', 'bash', 'auto');
  assert.equal(deny?.action, 'deny');
  if (deny?.action === 'deny') {
    assert.ok(deny.remediation);
    assert.ok(deny.code);
  }
});

test('ask mode requires approval for write_file', () => {
  const g = applyPermissionModeGate('ask', 'write_file', 'auto');
  assert.equal(g?.action, 'require_approval');
  if (g?.action === 'require_approval') {
    assert.ok(g.remediation);
  }
});

test('acceptEdits auto-approves edit tools', () => {
  assert.deepEqual(applyPermissionModeGate('acceptEdits', 'edit_file', 'auto'), {
    action: 'proceed'
  });
  assert.equal(applyPermissionModeGate('acceptEdits', 'bash', 'auto'), undefined);
});

test('bypass always proceeds', () => {
  assert.deepEqual(applyPermissionModeGate('bypass', 'bash', 'always'), { action: 'proceed' });
});
