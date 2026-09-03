import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionEventLog } from '../dist/session/event-log.js';
import { buildTrajectorySnapshot, parseTrajectoryQuery } from '../dist/session/trajectory.js';

test('parseTrajectoryQuery accepts empty and rejects NaN', () => {
  assert.deepEqual(parseTrajectoryQuery({}), { ok: true, query: {} });
  assert.deepEqual(parseTrajectoryQuery({ fromSeq: '3', limit: '2' }), {
    ok: true,
    query: { fromSeq: 3, limit: 2 }
  });
  assert.equal(parseTrajectoryQuery({ fromSeq: 'x' }).ok, false);
  assert.equal(parseTrajectoryQuery({ limit: 1.5 }).ok, false);
});

test('buildTrajectorySnapshot windows by fromSeq/limit and marks in_progress', () => {
  const log = new SessionEventLog('s-q');
  log.append('run/start', { runId: 'r1', turn: 0 });
  log.append('tool/call', { name: 'echo', callId: 'c1', turn: 0 });
  log.append('tool/result', { name: 'echo', callId: 'c1', turn: 0 });
  log.append('step/end', { turn: 0 });
  const all = buildTrajectorySnapshot(log.getEvents());
  assert.equal(all.turns.length, 1);
  assert.equal(all.turns[0].status, 'in_progress');
  assert.ok(all.turns[0].records.some((r) => r.kind === 'tool'));

  const windowed = buildTrajectorySnapshot(log.getEvents(), { fromSeq: 3, limit: 1 });
  const types = windowed.turns.flatMap((t) => t.records.map((r) => r.eventType));
  assert.ok(types.includes('step/end'));
  assert.ok(!types.includes('run/start'));
});
