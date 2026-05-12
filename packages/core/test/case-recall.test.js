import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { SqliteStateStore } = await import('../dist/storage.js');
const { recallAgentCases } = await import('../dist/evolving/case-recall.js');

function makeTempStore() {
  const dir = join(tmpdir(), `ppeng-case-recall-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, 'cases.db');
  return { dbPath, dir, store: new SqliteStateStore(dbPath) };
}

describe('recallAgentCases (hybrid FTS + embedding RRF)', () => {
  let store;
  let dbPath;
  let cleanupDir;

  before(() => {
    const s = makeTempStore();
    store = s.store;
    dbPath = s.dbPath;
    cleanupDir = s.dir;
    const ac = store.getAgentCaseStore();

    ac.insert({
      sessionId: 'sess_lex',
      agentId: 'agent_rrf',
      taskFingerprint: 'invoice pipeline',
      outcome: 'success',
      source: 'manual',
      whatWorked: 'oauth token refresh was misconfigured; fixed scopes',
      embedding: [0, 1, 0],
      confidence: 0.9
    });

    ac.insert({
      sessionId: 'sess_sem',
      agentId: 'agent_rrf',
      taskFingerprint: 'graphql subscription backlog',
      outcome: 'success',
      source: 'manual',
      whatWorked: 'debounced resolver updates',
      embedding: [0.99, 0.01, 0],
      confidence: 0.5
    });
  });

  after(() => {
    try {
      store.db.close();
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
    if (cleanupDir && existsSync(cleanupDir)) {
      try {
        unlinkSync(join(cleanupDir, 'cases.db-wal'));
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(join(cleanupDir, 'cases.db-shm'));
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(dbPath + '-wal');
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(dbPath + '-shm');
      } catch {
        /* ignore */
      }
    }
  });

  it('includes a high-similarity case even when only the lexical case matched FTS', () => {
    const ac = store.getAgentCaseStore();
    const q = [1, 0, 0];
    const rows = recallAgentCases(
      ac,
      {
        agentId: 'agent_rrf',
        namespace: null,
        keywords: ['oauth'],
        queryText: 'oauth token',
        limit: 5
      },
      q
    );
    const fps = new Set(rows.map((r) => r.taskFingerprint));
    assert.ok(fps.has('invoice pipeline'), 'expected lexical oauth hit');
    assert.ok(
      fps.has('graphql subscription backlog'),
      'semantic-only row should survive RRF fusion'
    );
  });
});
