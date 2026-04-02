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

// Time-decay relevance tests (inspired by arXiv:2510.03344 - time-dependent chemistry)

test('calculateDecayedRelevance gives higher score to fresh memory', () => {
  const store = createStore();
  const now = new Date();

  const freshEntry = store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'long',
    key: 'fresh_fact',
    value: 'just learned',
    importance: 0.5
  });

  const relevance = store.calculateDecayedRelevance(freshEntry, { now, halfLifeHours: 24 });

  // Fresh memory with importance 0.5 should have relevance close to 0.5
  // (decay factor ≈ 1, reinforcement factor = 1 for 0 accesses)
  assert.ok(relevance > 0.4 && relevance < 0.6, `Expected ~0.5, got ${relevance}`);
});

test('calculateDecayedRelevance decays over time', () => {
  const store = createStore();
  const now = new Date();

  // Create an entry with a past timestamp
  const entry = store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'long',
    key: 'old_fact',
    value: 'learned long ago',
    importance: 1.0
  });

  // Manually set lastAccessAt to 24 hours ago
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  store.db.prepare(`UPDATE session_memory SET last_access_at = ? WHERE id = ?`).run(oneDayAgo.toISOString(), entry.id);

  const oldEntry = store.getSessionMemoryEntry(entry.id);
  const relevance = store.calculateDecayedRelevance(oldEntry, { now, halfLifeHours: 24 });

  // After one half-life, decay factor should be 0.5
  // relevance = 1.0 * 0.5 * 1 = 0.5
  assert.ok(relevance > 0.45 && relevance < 0.55, `Expected ~0.5, got ${relevance}`);
});

test('calculateDecayedRelevance reinforces with access count', () => {
  const store = createStore();
  const now = new Date();

  const entry = store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'long',
    key: 'reinforced_fact',
    value: 'important and accessed',
    importance: 0.5
  });

  // Touch it multiple times
  for (let i = 0; i < 10; i++) {
    store.touchSessionMemory(entry.id);
  }

  const touchedEntry = store.getSessionMemoryEntry(entry.id);
  const relevanceWithAccess = store.calculateDecayedRelevance(touchedEntry, { now, halfLifeHours: 24 });

  // With 10 accesses, reinforcement factor = log(11) + 1 ≈ 3.4
  // relevance ≈ 0.5 * 1 * 3.4 ≈ 1.7
  assert.ok(relevanceWithAccess > 1.5, `Expected > 1.5, got ${relevanceWithAccess}`);
});

test('listSessionMemoryByDecayedRelevance sorts by decayed score', () => {
  const store = createStore();
  const now = new Date();

  // Create entries with different ages and importance
  const highImportanceOld = store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'long',
    key: 'high_old',
    value: 'important but old',
    importance: 1.0
  });

  const lowImportanceFresh = store.upsertSessionMemory({
    sessionId: 'session_1',
    scope: 'long',
    key: 'low_fresh',
    value: 'less important but fresh',
    importance: 0.3
  });

  // Set the high importance entry to be 48 hours old
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  store.db.prepare(`UPDATE session_memory SET last_access_at = ? WHERE id = ?`).run(twoDaysAgo.toISOString(), highImportanceOld.id);

  // Get sorted results
  const sorted = store.listSessionMemoryByDecayedRelevance('session_1', 'long', { halfLifeHours: 24 });

  // Fresh entry should rank higher due to decay
  // low_fresh: 0.3 * 1 * 1 = 0.3
  // high_old: 1.0 * 0.25 * 1 = 0.25 (after 2 half-lives)
  assert.equal(sorted[0].key, 'low_fresh');
  assert.equal(sorted[1].key, 'high_old');
  assert.ok(sorted[0].decayedRelevance > sorted[1].decayedRelevance);
});

test('listSessionMemoryByDecayedRelevance respects limit', () => {
  const store = createStore();

  // Create multiple entries
  for (let i = 0; i < 5; i++) {
    store.upsertSessionMemory({
      sessionId: 'session_1',
      scope: 'long',
      key: `fact_${i}`,
      value: `value_${i}`,
      importance: 0.5
    });
  }

  const top3 = store.listSessionMemoryByDecayedRelevance('session_1', 'long', { limit: 3 });
  assert.equal(top3.length, 3);
});
