import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupSessionsByDate,
  sessionActivityAt,
  sessionDateBucket,
  sessionGroupLabel
} from './session-groups.ts';

const NOW = Date.parse('2026-09-03T12:00:00+08:00');

test('sessionDateBucket maps local day distances', () => {
  assert.equal(sessionDateBucket(null, NOW), 'older');
  assert.equal(sessionDateBucket(NOW, NOW), 'today');
  assert.equal(sessionDateBucket(NOW - 24 * 3600_000, NOW), 'yesterday');
  assert.equal(sessionDateBucket(NOW - 3 * 24 * 3600_000, NOW), 'week');
  assert.equal(sessionDateBucket(NOW - 12 * 24 * 3600_000, NOW), 'month');
  const old = sessionDateBucket(Date.parse('2026-01-15T12:00:00+08:00'), NOW);
  assert.equal(old, 'm:2026-01');
  assert.equal(sessionGroupLabel('m:2026-01'), '2026年1月');
  assert.equal(sessionGroupLabel('today'), '今天');
});

test('groupSessionsByDate keeps named buckets then recent months', () => {
  const groups = groupSessionsByDate(
    [
      { id: 'a', updatedAt: '2026-09-03T08:00:00+08:00' },
      { id: 'b', createdAt: '2026-09-02T08:00:00+08:00' },
      { id: 'c', updatedAt: '2026-01-10T08:00:00+08:00' },
      { id: 'd' }
    ],
    NOW
  );
  assert.deepEqual(
    groups.map((g) => g.bucket),
    ['today', 'yesterday', 'older', 'm:2026-01']
  );
  assert.equal(groups[0]?.sessions[0]?.id, 'a');
  assert.equal(sessionActivityAt({}), null);
});
