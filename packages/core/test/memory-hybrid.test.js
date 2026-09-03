import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import { hybridRankIds, reciprocalRankFusion } from '../dist/memory/memory-hybrid.js';
import { hybridOrderMemories, recallProgressive } from '../dist/memory/memory-recall.js';

function tmpStore() {
  const dir = mkdtempSync(join(tmpdir(), 'mem-hybrid-'));
  return new SqliteStateStore(join(dir, 'state.db'));
}

test('no embedding → hybrid equals lexical / FTS order', () => {
  assert.deepEqual(hybridRankIds({ lexicalIds: ['a', 'b', 'c'] }), ['a', 'b', 'c']);
  assert.deepEqual(hybridRankIds({ lexicalIds: ['a', 'b'], semanticIds: [] }), ['a', 'b']);

  const store = tmpStore();
  const am = store.agentMemory();
  am.set({
    scope: 'session.scratch',
    namespace: 'default',
    key: 'deploy-preview',
    value: 'preview deploy checklist',
    sessionId: 's1',
    importance: 0.9
  });
  am.set({
    scope: 'session.scratch',
    namespace: 'default',
    key: 'unrelated',
    value: 'lunch menu',
    sessionId: 's1',
    importance: 0.2
  });
  const sources = recallProgressive({
    store: am,
    query: 'deploy preview',
    sessionId: 's1'
  });
  assert.match(sources.working, /deploy-preview/);
  const idxDeploy = sources.working.indexOf('deploy-preview');
  const idxLunch = sources.working.indexOf('lunch menu');
  assert.ok(idxDeploy >= 0);
  assert.ok(idxLunch < 0 || idxDeploy < idxLunch);
  store.db.close();
});

test('RRF fusion order: semantic-only hit rises above lexical-only', () => {
  const fused = hybridRankIds({
    lexicalIds: ['a', 'b', 'c'],
    semanticIds: ['c']
  });
  assert.equal(fused[0], 'c');
  assert.deepEqual(fused.slice(1), ['a', 'b']);

  const rrf = reciprocalRankFusion([
    ['lex-first', 'shared'],
    ['sem-first', 'shared']
  ]);
  assert.equal(rrf[0].id, 'shared');
});

test('recallProgressive uses RRF when query embedding + stored vectors exist', () => {
  const store = tmpStore();
  const am = store.agentMemory();
  const lex = am.set({
    scope: 'session.long',
    namespace: 'default',
    key: 'alpha',
    value: 'deploy pipeline',
    sessionId: 's1',
    importance: 0.9
  });
  const sem = am.set({
    scope: 'session.long',
    namespace: 'default',
    key: 'omega',
    value: 'shipping notes',
    sessionId: 's1',
    importance: 0.1
  });
  const queryEmbedding = [1, 0];
  am.putEmbedding(sem.id, [1, 0]);

  const ranked = hybridOrderMemories(
    [lex, sem],
    'deploy',
    {
      queryEmbedding,
      embeddings: am.listEmbeddings([lex.id, sem.id])
    }
  );
  assert.equal(ranked[0].id, sem.id);

  const sources = recallProgressive({
    store: am,
    query: 'deploy',
    sessionId: 's1',
    queryEmbedding,
    embeddings: (id) => am.getEmbedding(id)
  });
  const first = sources.working.split('\n').find((line) => line.startsWith('- '));
  assert.ok(first && first.includes('omega'), `expected omega first, got ${first}`);
  store.db.close();
});
