import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import { GoalStore, createGoalRecord } from '../dist/goal/index.js';
import {
  ensureGoalEntityFromMetadata,
  goalWirePayload,
  markGoalWaitingUser,
  resumeGoalOnUserReply,
  upsertGoalFromApi
} from '../dist/goal/entity.js';

function kv(entityEnabled = true) {
  const map = new Map();
  if (!entityEnabled) {
    map.set('goal_settings', { entityEnabled: false, defaultMaxTurns: 25 });
  }
  return {
    getDaemonControl(key) {
      return map.get(key);
    },
    setDaemonControl(key, value) {
      map.set(key, value);
    }
  };
}

test('ensureGoalEntityFromMetadata respects entityEnabled=false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'goal-ent-'));
  const sqlite = new SqliteStateStore(join(dir, 's.db'));
  try {
    const store = new GoalStore(sqlite.db);
    const none = ensureGoalEntityFromMetadata(
      store,
      's1',
      { goalCondition: 'ship' },
      kv(false)
    );
    assert.equal(none, null);
    assert.equal(store.findLatestBySession('s1'), null);
  } finally {
    sqlite.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upsertGoalFromApi aborts previous active and waiting_user resumes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'goal-ent-'));
  const sqlite = new SqliteStateStore(join(dir, 's.db'));
  try {
    const store = new GoalStore(sqlite.db);
    const first = upsertGoalFromApi(store, { sessionId: 's1', condition: 'old' });
    assert.equal(first.status, 'active');
    const second = upsertGoalFromApi(store, { sessionId: 's1', condition: 'new' });
    assert.notEqual(second.goalId, first.goalId);
    assert.equal(store.get(first.goalId)?.status, 'unmet_closed');
    assert.equal(store.get(second.goalId)?.status, 'active');
    const listed = store.listBySession('s1');
    assert.equal(listed.length, 2);
    assert.ok(listed.some((g) => g.goalId === second.goalId && g.status === 'active'));

    const solo = upsertGoalFromApi(store, { sessionId: 's2', condition: 'ask' });
    const waiting = markGoalWaitingUser(store, 's2');
    assert.equal(waiting?.goalId, solo.goalId);
    assert.equal(waiting?.status, 'waiting_user');
    const resumed = resumeGoalOnUserReply(store, 's2');
    assert.equal(resumed?.status, 'active');
  } finally {
    sqlite.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('goalWirePayload hides verify command body', () => {
  const rec = createGoalRecord({
    sessionId: 's1',
    spec: {
      goal: 'ship',
      criteria: [],
      source: 'explicit',
      verify: { kind: 'command', command: 'rm -rf /', paths: ['README.md'] }
    },
    condition: 'ship',
    maxTurns: 5
  });
  const wire = goalWirePayload(rec);
  assert.equal(wire.goalId, rec.goalId);
  assert.equal(wire.status, 'active');
  assert.deepEqual(wire.spec.verify, { kind: 'command', paths: ['README.md'], url: undefined });
  assert.ok(!JSON.stringify(wire).includes('rm -rf'));
});
