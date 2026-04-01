import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';

function createStore() {
  const stateDir = mkdtempSync(join(tmpdir(), 'raw-agent-memory-'));
  return new SqliteStateStore(join(stateDir, 'state.db'));
}

test('upsertSessionMemory stores importance and source', () => {
  const store = createStore();
  const entry = store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'long',
    key: 'user_preference',
    value: 'prefers dark mode',
    importance: 0.9,
    source: 'extracted'
  });

  assert.equal(entry.importance, 0.9);
  assert.equal(entry.source, 'extracted');
  assert.equal(entry.accessCount, 0);
  assert.ok(entry.lastAccessAt);
});

test('upsertSessionMemory defaults importance to 0.5', () => {
  const store = createStore();
  const entry = store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'scratch',
    key: 'temp_note',
    value: 'some note'
  });

  assert.equal(entry.importance, 0.5);
  assert.equal(entry.source, 'user_provided');
});

test('touchSessionMemory increments access count', () => {
  const store = createStore();
  const entry = store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'long',
    key: 'important_fact',
    value: 'user works at Acme Corp',
    importance: 0.8
  });

  assert.equal(entry.accessCount, 0);

  const touched1 = store.touchSessionMemory(entry.id);
  assert.equal(touched1.accessCount, 1);

  const touched2 = store.touchSessionMemory(entry.id);
  assert.equal(touched2.accessCount, 2);
});

test('listSessionMemoryByRelevance sorts by importance descending', () => {
  const store = createStore();

  store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'long',
    key: 'low_importance',
    value: 'minor detail',
    importance: 0.2
  });

  store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'long',
    key: 'high_importance',
    value: 'critical fact',
    importance: 0.9
  });

  store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'long',
    key: 'medium_importance',
    value: 'moderate info',
    importance: 0.5
  });

  const sorted = store.listSessionMemoryByRelevance('session_1', 'long');
  assert.equal(sorted.length, 3);
  assert.equal(sorted[0].key, 'high_importance');
  assert.equal(sorted[1].key, 'medium_importance');
  assert.equal(sorted[2].key, 'low_importance');
});

test('listSessionMemoryByRelevance respects limit', () => {
  const store = createStore();

  for (let i = 0; i < 10; i++) {
    store.upsertSessionMemory({
      sessionId: 'session_1',
      scope: 'long',
      key: `fact_${i}`,
      value: `value_${i}`,
      importance: i / 10
    });
  }

  const top5 = store.listSessionMemoryByRelevance('session_1', 'long', 5);
  assert.equal(top5.length, 5);
  // Should get highest importance entries
  assert.equal(top5[0].key, 'fact_9');
  assert.equal(top5[4].key, 'fact_5');
});

test('consolidateSessionMemory merges entries', () => {
  const store = createStore();

  const entry1 = store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'long',
    key: 'fact_a',
    value: 'User likes TypeScript',
    importance: 0.6
  });

  const entry2 = store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'long',
    key: 'fact_b',
    value: 'User prefers React',
    importance: 0.7
  });

  const consolidated = store.consolidateSessionMemory(
    'session_1',
    'long',
    ['fact_a', 'fact_b'],
    'tech_preferences',
    'User prefers TypeScript and React',
    0.9
  );

  assert.ok(consolidated);
  assert.equal(consolidated.key, 'tech_preferences');
  assert.equal(consolidated.value, 'User prefers TypeScript and React');
  assert.equal(consolidated.importance, 0.9);
  assert.equal(consolidated.source, 'consolidated');
  assert.deepEqual(consolidated.mergedFrom, [entry1.id, entry2.id]);

  // Original entries should be deleted
  const remaining = store.listSessionMemory('session_1', 'long');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].key, 'tech_preferences');
});

test('consolidateSessionMemory auto-calculates max importance', () => {
  const store = createStore();

  store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'long',
    key: 'fact_a',
    value: 'A',
    importance: 0.3
  });

  store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'long',
    key: 'fact_b',
    value: 'B',
    importance: 0.8
  });

  const consolidated = store.consolidateSessionMemory(
    'session_1',
    'long',
    ['fact_a', 'fact_b'],
    'merged',
    'A and B'
    // No importance provided - should take max
  );

  assert.equal(consolidated.importance, 0.8);
});

test('copySessionMemory preserves importance and source', () => {
  const store = createStore();

  store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'scratch',
    key: 'handoff_note',
    value: 'In progress: implementing feature X',
    importance: 0.7,
    source: 'extracted'
  });

  const count = store.copySessionMemory('session_1', 'session_2', 'scratch');
  assert.equal(count, 1);

  const copied = store.listSessionMemory('session_2', 'scratch');
  assert.equal(copied.length, 1);
  assert.equal(copied[0].importance, 0.7);
  assert.equal(copied[0].source, 'extracted');
});

test('update preserves existing access count', () => {
  const store = createStore();

  const entry = store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'long',
    key: 'fact',
    value: 'original value'
  });

  // Touch it a few times
  store.touchSessionMemory(entry.id);
  store.touchSessionMemory(entry.id);
  store.touchSessionMemory(entry.id);

  // Update the value
  const updated = store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'long',
    key: 'fact',
    value: 'updated value',
    importance: 0.9
  });

  // Access count should be preserved, not reset
  assert.equal(updated.accessCount, 3);
  assert.equal(updated.value, 'updated value');
  assert.equal(updated.importance, 0.9);
});
