import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityState,
  filterSessions,
  overallHealth,
  selfHealTone,
  splitDoctorChecks,
  type DoctorReportLike
} from './ops-health.ts';

const doctor = (warn: number, fail: number): DoctorReportLike => ({
  ok: fail === 0,
  checkedAt: '2026-09-07T10:00:00.000Z',
  checks: [],
  summary: { ok: 3, warn, fail }
});

test('overallHealth rolls signals up into ok / warn / fail [AC:ops-console#AC-1]', () => {
  const base = { reachable: true, ready: true, doctor: null, configWarnings: 0 };
  assert.deepEqual(overallHealth(base), { level: 'ok', reasons: [] });
  assert.equal(overallHealth({ ...base, configWarnings: 2 }).level, 'warn');
  assert.equal(overallHealth({ ...base, doctor: doctor(1, 0) }).level, 'warn');
  assert.equal(overallHealth({ ...base, doctor: doctor(1, 1) }).level, 'fail');
  assert.equal(overallHealth({ ...base, ready: false }).level, 'fail');
  assert.deepEqual(overallHealth({ ...base, reachable: false }), { level: 'fail', reasons: ['unreachable'] });
});

test('activityState and selfHealTone use plain words [AC:ops-console#AC-1]', () => {
  assert.equal(activityState(0), 'idle');
  assert.equal(activityState(2), 'running');
  assert.equal(selfHealTone('fixing'), 'running');
  assert.equal(selfHealTone('completed'), 'done');
  assert.equal(selfHealTone('blocked'), 'bad');
  assert.equal(selfHealTone('stopped'), 'idle');
});

test('splitDoctorChecks puts failures then warnings first and collapses passes [AC:ops-console#AC-2]', () => {
  const checks = [
    { id: 'a', title: 'A', severity: 'ok' as const, detail: '' },
    { id: 'b', title: 'B', severity: 'warn' as const, detail: '', hint: 'fix b' },
    { id: 'c', title: 'C', severity: 'fail' as const, detail: '' },
    { id: 'd', title: 'D', severity: 'ok' as const, detail: '' }
  ];
  const { attention, passed } = splitDoctorChecks(checks);
  assert.deepEqual(attention.map((c) => c.id), ['c', 'b']);
  assert.deepEqual(passed.map((c) => c.id), ['a', 'd']);
  assert.equal(splitDoctorChecks([checks[0]!]).attention.length, 0);
});

test('filterSessions matches title, agent and id case-insensitively [AC:ops-console#AC-3]', () => {
  const sessions = [
    { id: 'sess_abc', title: 'Deploy review', agentId: 'general' },
    { id: 'sess_xyz', title: 'Weekly notes', agentId: 'sre-oncall' }
  ];
  assert.equal(filterSessions(sessions, '').length, 2);
  assert.deepEqual(filterSessions(sessions, 'DEPLOY').map((s) => s.id), ['sess_abc']);
  assert.deepEqual(filterSessions(sessions, 'oncall').map((s) => s.id), ['sess_xyz']);
  assert.deepEqual(filterSessions(sessions, 'sess_a').map((s) => s.id), ['sess_abc']);
  assert.equal(filterSessions(sessions, 'zzz').length, 0);
});
