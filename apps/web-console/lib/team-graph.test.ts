import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityFlowSeconds,
  activityMood,
  buildRiverPaths,
  countWorkingAgents,
  hexSpiral,
  hexagonPoints,
  inferWorkType,
  layoutHoneycomb,
  pickSwarmRun,
  resolveTaskWorkType,
  sessionIdFromArtifacts,
  swarmTaskToNode
} from './team-graph.ts';

test('pickSwarmRun prefers live run over completed', () => {
  const picked = pickSwarmRun([
    { id: 'old', goal: 'a', status: 'completed', updatedAt: '2026-09-03T12:00:00Z' },
    { id: 'live', goal: 'b', status: 'running', updatedAt: '2026-09-03T11:00:00Z' }
  ]);
  assert.equal(picked?.id, 'live');
});

test('pickSwarmRun falls back to latest when none are live', () => {
  const picked = pickSwarmRun([
    { id: 'a', goal: 'a', status: 'completed', updatedAt: '2026-09-01T00:00:00Z' },
    { id: 'b', goal: 'b', status: 'failed', updatedAt: '2026-09-03T00:00:00Z' }
  ]);
  assert.equal(picked?.id, 'b');
});

test('pickSwarmRun empty', () => {
  assert.equal(pickSwarmRun([]), null);
});

test('sessionIdFromArtifacts', () => {
  assert.equal(sessionIdFromArtifacts(['file:x', 'session:abc']), 'abc');
  assert.equal(sessionIdFromArtifacts([]), undefined);
});

test('inferWorkType maps session phases', () => {
  assert.equal(inferWorkType('failed', []), 'error');
  assert.equal(inferWorkType('idle', []), 'idle');
  assert.equal(inferWorkType('waiting_approval', []), 'tool');
  assert.equal(inferWorkType('running', []), 'thinking');
  assert.equal(
    inferWorkType('running', [{ role: 'assistant', parts: [{ type: 'tool_call' }] }]),
    'tool'
  );
  assert.equal(
    inferWorkType('running', [{ role: 'assistant', parts: [{ type: 'reasoning', text: '…' }] }]),
    'thinking'
  );
  assert.equal(
    inferWorkType('running', [{ role: 'assistant', parts: [{ type: 'text', text: 'hello' }] }]),
    'outputting'
  );
  assert.equal(
    inferWorkType('running', [
      { role: 'assistant', parts: [{ type: 'tool_result', ok: false, text: '' }] }
    ]),
    'error'
  );
});

test('resolveTaskWorkType uses task status when session is idle', () => {
  assert.equal(resolveTaskWorkType({ status: 'failed' }, 'idle'), 'error');
  assert.equal(resolveTaskWorkType({ status: 'in_progress' }, 'idle'), 'thinking');
  assert.equal(resolveTaskWorkType({ status: 'pending' }, 'idle'), 'idle');
});

test('swarmTaskToNode uses task fields, not a hardcoded roster', () => {
  const node = swarmTaskToNode(
    {
      id: 'stask_1',
      title: 'Draft review notes',
      status: 'in_progress',
      requiredRole: 'custom-role',
      ownerAgentId: 'wave-owner-7'
    },
    'tool'
  );
  assert.equal(node.label, 'wave-owner-7');
  assert.equal(node.sublabel, 'Draft review no…');
  assert.equal(node.workType, 'tool');
});

test('hexSpiral packs a honeycomb, not a ring', () => {
  const seven = hexSpiral(7);
  assert.equal(seven.length, 7);
  assert.deepEqual(seven[0], { q: 0, r: 0 });
  const ring1 = seven.slice(1);
  assert.equal(
    ring1.every((c) => Math.abs(c.q) + Math.abs(c.r) + Math.abs(-c.q - c.r) === 2),
    true
  );
});

test('layoutHoneycomb returns one cell per node', () => {
  const { cells, hexR } = layoutHoneycomb(5, 800, 400);
  assert.equal(cells.length, 5);
  assert.ok(hexR > 10);
  assert.ok(cells.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y)));
});

test('hexagonPoints is a 6-vertex polygon', () => {
  const pts = hexagonPoints(0, 0, 10).split(' ');
  assert.equal(pts.length, 6);
});

test('buildRiverPaths uses cubic curves in mixed directions', () => {
  const rivers = buildRiverPaths(800, 400);
  assert.ok(rivers.length >= 6);
  assert.ok(rivers.every((r) => r.d.includes('C ')));
  assert.ok(rivers.some((r) => r.reverse));
  assert.ok(rivers.some((r) => !r.reverse));
  assert.deepEqual(
    [...new Set(rivers.map((r) => r.kind))].sort(),
    ['mid', 'needle', 'wide']
  );
});

test('activity mood bands follow working concurrency', () => {
  assert.equal(countWorkingAgents([{ workType: 'idle' }, { workType: 'thinking' }]), 1);
  assert.equal(activityMood(0), 'calm');
  assert.equal(activityMood(1), 'low');
  assert.equal(activityMood(3), 'mid');
  assert.equal(activityMood(4), 'hot');
  assert.ok(activityFlowSeconds(0).flow > activityFlowSeconds(1).flow);
  assert.ok(activityFlowSeconds(1).flow > activityFlowSeconds(3).flow);
  assert.ok(activityFlowSeconds(3).flow > activityFlowSeconds(5).flow);
});
