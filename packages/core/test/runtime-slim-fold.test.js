/**
 * Characterization: goal/evolving model-adjacent paths use fold, not WAL slice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteStateStore } from '../dist/storage.js';
import { evolvingQueryText } from '../dist/evolving/query-text.js';
import { foldGoalJudgeSnapshot } from '../dist/turn/goal-snapshot.js';
import { getLatestAssistantText } from '../dist/runtime/session-facade.js';

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(here, '..');

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'fold-query-'));
  const store = new SqliteStateStore(join(dir, 'runtime.sqlite'));
  store.upsertAgent({
    id: 'general',
    name: 'General',
    role: 'assistant',
    instructions: 'x',
    capabilities: []
  });
  return store;
}

test('characterization: runtime.ts and kernel.ts have zero listMessages().slice', () => {
  const kernel = readFileSync(join(coreRoot, 'src/turn/kernel.ts'), 'utf8');
  const runtime = readFileSync(join(coreRoot, 'src/runtime.ts'), 'utf8');
  const re = /listMessages\([^)]*\)\.slice/g;
  assert.equal((kernel.match(re) ?? []).length, 0);
  assert.equal((runtime.match(re) ?? []).length, 0);
});

test('evolvingQueryText uses fold: replaced WAL originals are hidden', () => {
  const store = makeStore();
  const session = store.createSession({ title: 'q', mode: 'chat', agentId: 'general' });
  const u = store.appendMessage(session.id, 'user', [{ type: 'text', text: 'secret-user' }]);
  const a = store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'secret-asst' }]);
  store.appendReplacement(session.id, {
    startSeq: u.seq,
    endSeq: a.seq,
    role: 'system',
    parts: [{ type: 'text', text: 'fold-summary' }],
    key: 'compact-summary'
  });
  const query = evolvingQueryText(store, session.id);
  assert.match(query, /fold-summary/);
  assert.doesNotMatch(query, /secret-user/);
  assert.doesNotMatch(query, /secret-asst/);
  store.db.close();
});

test('foldGoalJudgeSnapshot uses fold: replaced WAL originals are hidden', () => {
  const store = makeStore();
  const session = store.createSession({ title: 'g', mode: 'chat', agentId: 'general' });
  const u = store.appendMessage(session.id, 'user', [{ type: 'text', text: 'old-user' }]);
  const a = store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'old-asst' }]);
  store.appendReplacement(session.id, {
    startSeq: u.seq,
    endSeq: a.seq,
    role: 'system',
    parts: [{ type: 'text', text: 'goal-summary' }],
    key: 'compact-summary'
  });
  const snap = foldGoalJudgeSnapshot(store, session.id);
  assert.match(snap, /goal-summary/);
  assert.doesNotMatch(snap, /old-user/);
  assert.doesNotMatch(snap, /old-asst/);
  store.db.close();
});

test('getLatestAssistantText reads fold, not shadowed WAL assistant', () => {
  const store = makeStore();
  const session = store.createSession({ title: 'a', mode: 'chat', agentId: 'general' });
  const u = store.appendMessage(session.id, 'user', [{ type: 'text', text: 'u' }]);
  const a = store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'wal-hidden' }]);
  store.appendReplacement(session.id, {
    startSeq: u.seq,
    endSeq: a.seq,
    role: 'system',
    parts: [{ type: 'text', text: 'summary-only' }],
    key: 'compact-summary'
  });
  store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'visible-asst' }]);
  assert.equal(getLatestAssistantText(store, session.id), 'visible-asst');
  store.db.close();
});
