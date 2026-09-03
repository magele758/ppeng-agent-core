import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  closeReasonForEvent,
  createGoalRecord,
  GoalStore,
  transitionGoal
} from '../dist/goal/index.js';
import { SqliteStateStore } from '../dist/storage.js';

test('goal 状态机：合法边', () => {
  const legal = [
    ['deriving', 'derive_ok', 'active'],
    ['deriving', 'derive_failed', 'unmet_closed'],
    ['deriving', 'aborted', 'unmet_closed'],
    ['active', 'turn', 'active'],
    ['active', 'need_user', 'waiting_user'],
    ['active', 'met', 'achieved'],
    ['active', 'exhausted', 'unmet_closed'],
    ['active', 'superseded', 'unmet_closed'],
    ['active', 'aborted', 'unmet_closed'],
    ['active', 'stalled', 'unmet_closed'],
    ['active', 'needs_user_unattended', 'unmet_closed'],
    ['waiting_user', 'user_reply', 'active'],
    ['waiting_user', 'aborted', 'unmet_closed'],
    ['unmet_closed', 'resume', 'active']
  ];
  for (const [from, event, to] of legal) {
    assert.equal(transitionGoal(from, event), to, `${from} --${event}--> ${to}`);
  }
});

test('goal 状态机：非法边 throw', () => {
  const illegal = [
    ['achieved', 'turn'],
    ['achieved', 'resume'],
    ['deriving', 'met'],
    ['waiting_user', 'met'],
    ['unmet_closed', 'turn'],
    ['active', 'user_reply']
  ];
  for (const [from, event] of illegal) {
    assert.throws(() => transitionGoal(from, event), /非法转移/);
  }
});

test('closeReasonForEvent', () => {
  assert.equal(closeReasonForEvent('exhausted'), 'exhausted');
  assert.equal(closeReasonForEvent('turn'), undefined);
  assert.equal(closeReasonForEvent('met'), undefined);
});

test('GoalStore persist + commitTransition', () => {
  const dir = mkdtempSync(join(tmpdir(), 'goal-store-'));
  try {
    const sqlite = new SqliteStateStore(join(dir, 'runtime.sqlite'));
    const store = new GoalStore(sqlite.db);
    const rec = createGoalRecord({
      sessionId: 's1',
      spec: { goal: 'ship', criteria: [], source: 'explicit' },
      condition: 'ship',
      maxTurns: 5
    });
    store.upsert(rec);
    const loaded = store.findLatestBySession('s1');
    assert.equal(loaded?.status, 'active');
    const next = store.commitTransition(loaded, 'need_user');
    assert.equal(next.status, 'waiting_user');
    const replied = store.commitTransition(next, 'user_reply');
    assert.equal(replied.status, 'active');
    const done = store.commitTransition(replied, 'met');
    assert.equal(done.status, 'achieved');
    sqlite.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
