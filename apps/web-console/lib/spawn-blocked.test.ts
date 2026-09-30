import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpawnBlocked } from './spawn-blocked.ts';

const teammate = JSON.stringify({
  spawned: true,
  blocked: true,
  status: 'waiting_approval',
  teammateName: 'mate',
  teammateSessionId: 'sess-t',
  blockedTools: ['bash'],
  approvalIds: ['ap-1', 'ap-2'],
  approvals: [{ id: 'ap-1', tool: 'bash', reason: 'rm' }],
  remediation: 'Ask the user to approve it.'
});

test('parseSpawnBlocked reads a blocked teammate result', () => {
  assert.deepEqual(parseSpawnBlocked('spawn_teammate', teammate), {
    kind: 'teammate',
    status: 'waiting_approval',
    sessionId: 'sess-t',
    name: 'mate',
    approvals: [{ id: 'ap-1', tool: 'bash', reason: 'rm' }, { id: 'ap-2' }],
    blockedTools: ['bash'],
    remediation: 'Ask the user to approve it.'
  });
});

test('parseSpawnBlocked reads a blocked subagent result', () => {
  const parsed = parseSpawnBlocked(
    'spawn_subagent',
    JSON.stringify({ blocked: true, status: 'waiting_approval', childSessionId: 'sess-c', approvalIds: ['a'] })
  );
  assert.equal(parsed?.kind, 'subagent');
  assert.equal(parsed?.sessionId, 'sess-c');
  assert.deepEqual(parsed?.approvals, [{ id: 'a' }]);
});

test('parseSpawnBlocked ignores everything that is not a blocked spawn result', () => {
  assert.equal(parseSpawnBlocked('bash', teammate), null);
  assert.equal(parseSpawnBlocked(undefined, teammate), null);
  assert.equal(parseSpawnBlocked('spawn_teammate', 'plain text reply'), null);
  assert.equal(parseSpawnBlocked('spawn_teammate', '[1,2]'), null);
  assert.equal(parseSpawnBlocked('spawn_teammate', JSON.stringify({ blocked: false, status: 'failed' })), null);
  assert.equal(parseSpawnBlocked('spawn_teammate', JSON.stringify({ spawned: true })), null);
});
