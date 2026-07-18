import test from 'node:test';
import assert from 'node:assert/strict';
import { decayedConfidence, runCaseGovernance } from '../dist/evolving/case-governance.js';

test('decayedConfidence halves over half-life', () => {
  const now = Date.UTC(2026, 0, 31);
  const createdAt = new Date(Date.UTC(2026, 0, 1)).toISOString();
  const eff = decayedConfidence(
    { confidence: 1, createdAt, halfLifeDays: 30 },
    now,
    30
  );
  assert.ok(eff > 0.45 && eff < 0.55);
});

test('runCaseGovernance archives expired cases', () => {
  const archived = [];
  const cases = [
    {
      id: 'exp1',
      confidence: 0.9,
      createdAt: new Date().toISOString(),
      halfLifeDays: 30,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      status: 'active'
    }
  ];
  const store = {
    listActive() {
      return cases.filter((c) => c.status === 'active');
    },
    setStatus(id, status) {
      const row = cases.find((c) => c.id === id);
      if (row) row.status = status;
      archived.push({ id, status });
    }
  };
  const report = runCaseGovernance(store, { RAW_AGENT_CASE_GOVERNANCE: '1' });
  assert.equal(report.archivedExpired, 1);
  assert.deepEqual(archived[0], { id: 'exp1', status: 'archived' });
});

test('runCaseGovernance capacity eviction', () => {
  const now = Date.now();
  const cases = Array.from({ length: 5 }, (_, i) => ({
    id: `c${i}`,
    confidence: 0.9,
    // freshly created — will not decay below threshold
    createdAt: new Date(now).toISOString(),
    halfLifeDays: 30,
    expiresAt: null,
    status: 'active'
  }));
  const store = {
    listActive() {
      return cases.filter((c) => c.status === 'active');
    },
    setStatus(id, status) {
      const row = cases.find((c) => c.id === id);
      if (row) row.status = status;
    }
  };
  const report = runCaseGovernance(
    store,
    {
      RAW_AGENT_CASE_GOVERNANCE: '1',
      RAW_AGENT_CASE_CAPACITY: '3',
      RAW_AGENT_CASE_HALF_LIFE_DAYS: '30'
    },
    now
  );
  assert.equal(report.archivedDecayed, 0);
  assert.equal(report.archivedCapacity, 2);
  assert.equal(cases.filter((c) => c.status === 'active').length, 3);
});
