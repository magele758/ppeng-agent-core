import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SwarmStore, createSwarmId, nowIso } from '../dist/swarm/store.js';
import { SqliteStateStore } from '../dist/storage.js';

test('SwarmStore: create run and claim task', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'swarm-store-'));
  const sqlite = new SqliteStateStore(join(stateDir, 'state.db'));
  const store = new SwarmStore(sqlite.db);

  const runId = createSwarmId('srun');
  store.createRun({
    id: runId,
    goal: 'g',
    status: 'running',
    strategy: 'pipeline',
    budget: { maxTeammates: 1, maxTurnsPerAgent: 1, maxDurationMs: 1000 },
    qualityGate: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  const taskId = createSwarmId('stask');
  store.createTask({
    id: taskId,
    swarmRunId: runId,
    title: 't1',
    status: 'pending',
    requiredRole: 'implementer',
    capabilityTags: [],
    acceptanceCriteria: [],
    artifacts: [],
    blockedBy: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  const claimed = store.claimTask(taskId, 'agent_1');
  assert.equal(claimed, true);
  const after = store.listTasks(runId)[0];
  assert.equal(after.status, 'claimed');
  sqlite.db.close();
});
