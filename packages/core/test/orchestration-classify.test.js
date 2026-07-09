import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrchestrationEngine } from '../dist/orchestrator/engine.js';
import { OrchestratorStore } from '../dist/orchestrator/store.js';
import { SqliteStateStore } from '../dist/storage.js';

test('OrchestrationEngine: classify step sets riskLevel from title heuristics', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'orch-classify-'));
  const sqlite = new SqliteStateStore(join(stateDir, 'state.db'));
  const orchStore = new OrchestratorStore(sqlite.db);

  const run = orchStore.createRun({
    title: 'Harden runtime auth permission checks',
    sourceType: 'test',
    sourceRef: 'sec-1',
    flywheels: ['D'],
    capabilityTags: ['security'],
    riskLevel: 'low'
  });

  const engine = new OrchestrationEngine({
    store: orchStore
  });

  await engine.tick();
  const updated = orchStore.getRun(run.id);
  assert.equal(updated?.riskLevel, 'high');
  const classify = orchStore.listSteps(run.id).find((s) => s.stage === 'classify');
  assert.equal(classify?.status, 'completed');
  sqlite.db.close();
});
