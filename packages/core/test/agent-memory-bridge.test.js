import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';

test('agent memory backend: upsert and list via bridge', () => {
  const prev = process.env.RAW_AGENT_MEMORY_BACKEND;
  process.env.RAW_AGENT_MEMORY_BACKEND = 'agent';
  try {
    const stateDir = mkdtempSync(join(tmpdir(), 'raw-agent-amem-'));
    const store = new SqliteStateStore(join(stateDir, 'state.db'));
    store.upsertSessionMemory({
      sessionId: 'sess_1',
      scope: 'scratch',
      key: 'note',
      value: 'hello'
    });
    const rows = store.listSessionMemory('sess_1', 'scratch');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, 'note');
    assert.equal(rows[0].value, 'hello');
    const agentRows = store.agentMemory().search({
      sessionId: 'sess_1',
      scope: 'session.scratch'
    });
    assert.equal(agentRows.length, 1);
    store.db.close();
  } finally {
    if (prev === undefined) delete process.env.RAW_AGENT_MEMORY_BACKEND;
    else process.env.RAW_AGENT_MEMORY_BACKEND = prev;
  }
});
