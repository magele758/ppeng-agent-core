import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrchestratorStore } from '../dist/orchestrator/store.js';
import { SqliteStateStore } from '../dist/storage.js';

test('OrchestratorStore: create run, steps, events', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'orch-store-'));
  const sqlite = new SqliteStateStore(join(stateDir, 'state.db'));
  const store = new OrchestratorStore(sqlite.db);

  const run = store.createRun({
    title: 'Evolution item',
    sourceType: 'test',
    sourceRef: 'https://example.com',
    flywheels: ['D'],
    capabilityTags: ['runtime'],
    riskLevel: 'low'
  });

  const step = store.createStep({
    runId: run.id,
    stage: 'classify',
    executor: 'orchestrator',
    status: 'pending'
  });
  assert.ok(step.id);

  store.appendEvent({
    runId: run.id,
    kind: 'run_created',
    actor: 'test'
  });

  const runs = store.listRuns({ status: 'pending' });
  assert.equal(runs.length, 1);
  assert.equal(store.listSteps(run.id).length, 1);
  assert.equal(store.listEvents(run.id).length, 1);
  sqlite.db.close();
});
