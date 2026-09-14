import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStateStore } from '../dist/storage.js';
import { AgentCaseStore } from '../dist/stores/agent-case-store.js';

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'agent-case-store-'));
}

test('AgentCaseStore insert + keyword search work without agent_cases_fts', () => {
  const dir = tmpDir();
  try {
    const store = new SqliteStateStore(join(dir, 'runtime.sqlite'));
    store.db.exec(`DROP TABLE IF EXISTS agent_cases_fts`);
    const ac = new AgentCaseStore(store.db);
    const row = ac.insert({
      sessionId: 'sess_1',
      agentId: 'agent_desktop',
      taskFingerprint: 'daemon health check timeout',
      outcome: 'success',
      source: 'manual',
      whatWorked: 'spawn ELECTRON_RUN_AS_NODE instead of utilityProcess.fork',
      confidence: 0.8
    });
    assert.ok(row.id);
    const hits = ac.searchKeyword({
      agentId: 'agent_desktop',
      keywords: ['health', 'timeout'],
      limit: 5
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, row.id);
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
