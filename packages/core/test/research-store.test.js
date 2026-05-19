import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResearchStore } from '../dist/deepresearch/store.js';
import { SqliteStateStore } from '../dist/storage.js';

test('ResearchStore: task lifecycle', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'research-store-'));
  const sqlite = new SqliteStateStore(join(stateDir, 'state.db'));
  const store = new ResearchStore(sqlite.db);

  const task = store.createTask({ query: 'What is X?' });
  assert.equal(task.status, 'pending');

  const updated = store.updateTaskStatus(task.id, 'running');
  assert.equal(updated.status, 'running');

  const source = store.addSource({
    taskId: task.id,
    kind: 'web',
    title: 'Example',
    fetchedAt: new Date().toISOString(),
    trustLevel: 'unknown'
  });
  assert.ok(source.id);
  assert.equal(store.listSources(task.id).length, 1);
  sqlite.db.close();
});
