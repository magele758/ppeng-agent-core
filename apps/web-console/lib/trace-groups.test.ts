import test from 'node:test';
import assert from 'node:assert/strict';
import { groupTraceEvents, isTraceGroupDefaultOpen, maxDurationMs } from './trace-groups.ts';

test('groupTraceEvents splits turns and tags errors', () => {
  const groups = groupTraceEvents([
    { kind: 'turn_start', ts: '2026-09-07T10:00:00.000Z' },
    { kind: 'model_delta', ts: '2026-09-07T10:00:01.000Z' },
    { kind: 'turn_end', ts: '2026-09-07T10:00:02.000Z' },
    { kind: 'turn_start', ts: '2026-09-07T10:00:03.000Z' },
    { kind: 'model_error', ts: '2026-09-07T10:00:04.000Z', payload: { message: 'boom' } },
    { kind: 'turn_end', ts: '2026-09-07T10:00:05.000Z' }
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.kind, 'turn');
  assert.equal(groups[0]?.turnIndex, 1);
  assert.equal(groups[0]?.hasError, false);
  assert.equal(groups[1]?.kind, 'turn');
  assert.equal(groups[1]?.turnIndex, 2);
  assert.equal(groups[1]?.hasError, true);
  assert.equal(maxDurationMs(groups) >= 2000, true);
});

test('isTraceGroupDefaultOpen opens last and error turns', () => {
  assert.equal(isTraceGroupDefaultOpen({ hasError: false }, 0, 2), false);
  assert.equal(isTraceGroupDefaultOpen({ hasError: false }, 1, 2), true);
  assert.equal(isTraceGroupDefaultOpen({ hasError: true }, 0, 3), true);
  assert.equal(isTraceGroupDefaultOpen({ hasError: false }, 0, 1), true);
});
