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
    store.upsertSessionMemory({
      sessionId: 'sess_1',
      scope: 'scratch',
      key: 'ptc.notes',
      value: 'secret',
      source: 'ptc',
      metadata: { source: 'ptc', visibility: 'inherit', pin: true }
    });
    store.upsertSessionMemory({
      sessionId: 'sess_1',
      scope: 'scratch',
      key: 'ptc.skip',
      value: 'hidden',
      source: 'ptc',
      metadata: { source: 'ptc', visibility: 'session', pin: false }
    });
    const ptc = store.listSessionMemory('sess_1', 'scratch').find((row) => row.key === 'ptc.notes');
    assert.equal(ptc.value, 'secret');
    assert.equal(ptc.metadata.pin, true);
    assert.equal(ptc.metadata.visibility, 'inherit');
    const copied = store.copySessionMemory(
      'sess_1',
      'sess_2',
      'scratch',
      (key) => !key.startsWith('ptc.') || key === 'ptc.notes'
    );
    assert.ok(copied >= 2);
    const child = store.listSessionMemory('sess_2', 'scratch');
    assert.equal(child.find((row) => row.key === 'note')?.value, 'hello');
    assert.equal(child.find((row) => row.key === 'ptc.notes')?.value, 'secret');
    assert.equal(child.some((row) => row.key === 'ptc.skip'), false);
    store.db.close();
  } finally {
    if (prev === undefined) delete process.env.RAW_AGENT_MEMORY_BACKEND;
    else process.env.RAW_AGENT_MEMORY_BACKEND = prev;
  }
});
