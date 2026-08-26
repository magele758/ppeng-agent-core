/**
 * kernel-lock: fold determinism, replace/hide WAL, open-wave compact ban.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import {
  SurfaceInvariantError,
  foldCanonicalJson,
  foldSurface,
  unmatchedToolCallIds
} from '../dist/session/surface-invariants.js';

function tmpStore() {
  const dir = mkdtempSync(join(tmpdir(), 'surface-'));
  return new SqliteStateStore(join(dir, 'runtime.sqlite'));
}

function sessionOf(store) {
  store.upsertAgent({
    id: 'general',
    name: 'General',
    role: 'assistant',
    instructions: 'x',
    capabilities: []
  });
  return store.createSession({ title: 'surface', mode: 'chat', agentId: 'general' });
}

test('append assigns strictly increasing seq and fold equals WAL', () => {
  const store = tmpStore();
  const session = sessionOf(store);
  const a = store.appendMessage(session.id, 'user', [{ type: 'text', text: 'hi' }]);
  const b = store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'yo' }]);
  assert.equal(a.seq, 1);
  assert.equal(b.seq, 2);
  const wal = store.listMessages(session.id);
  const folded = store.foldMessages(session.id);
  assert.equal(wal.length, 2);
  assert.equal(folded.length, 2);
  assert.equal(folded[0].parts[0].text, 'hi');
  assert.equal(folded[1].parts[0].text, 'yo');
  store.db.close();
});

test('replace shadows a contiguous range; fold hides it; WAL keeps originals', () => {
  const store = tmpStore();
  const session = sessionOf(store);
  const u = store.appendMessage(session.id, 'user', [{ type: 'text', text: 'old-user' }]);
  const a = store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'old-asst' }]);
  const summary = store.appendReplacement(session.id, {
    startSeq: u.seq,
    endSeq: a.seq,
    role: 'system',
    parts: [{ type: 'text', text: 'summary-of-old' }],
    key: 'compact-summary'
  });
  const wal = store.listMessages(session.id);
  const folded = store.foldMessages(session.id);
  assert.equal(wal.length, 3, 'WAL keeps originals plus replace node');
  assert.ok(wal.some((m) => m.parts[0].text === 'old-user'));
  assert.ok(wal.some((m) => m.parts[0].text === 'old-asst'));
  assert.equal(folded.length, 1);
  assert.equal(folded[0].id, summary.id);
  assert.equal(folded[0].parts[0].text, 'summary-of-old');
  assert.ok(!folded.some((m) => m.parts[0].text === 'old-user'));
  store.db.close();
});

test('hideByKey and hideRange remove visibility without deleting WAL', () => {
  const store = tmpStore();
  const session = sessionOf(store);
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'keep' }]);
  const steered = store.appendMessage(
    session.id,
    'user',
    [{ type: 'text', text: 'steer-v1' }],
    { key: 'steer:note' }
  );
  store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'ack' }]);
  assert.equal(store.hideByKey(session.id, 'steer:note'), 1);
  let folded = store.foldMessages(session.id);
  assert.ok(!folded.some((m) => m.key === 'steer:note'));
  assert.ok(folded.some((m) => m.parts[0].text === 'keep'));
  const walAfterHide = store.listMessages(session.id);
  assert.ok(walAfterHide.some((m) => m.id === steered.id), 'hidden row still in WAL listMessages');

  const asst = folded.find((m) => m.role === 'assistant');
  store.hideRange(session.id, asst.seq, asst.seq);
  folded = store.foldMessages(session.id);
  assert.ok(!folded.some((m) => m.role === 'assistant'));
  assert.ok(store.listMessages(session.id).some((m) => m.role === 'assistant'));
  store.db.close();
});

test('replace of an open tool wave is rejected', () => {
  const store = tmpStore();
  const session = sessionOf(store);
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'run' }]);
  const asst = store.appendMessage(session.id, 'assistant', [
    { type: 'tool_call', toolCallId: 'c1', name: 'bash', input: { command: 'ls' } }
  ]);
  assert.throws(
    () =>
      store.appendReplacement(session.id, {
        startSeq: asst.seq,
        endSeq: asst.seq,
        role: 'system',
        parts: [{ type: 'text', text: 'nope' }]
      }),
    SurfaceInvariantError
  );
  assert.equal(store.foldMessages(session.id).length, 2, 'open-turn replace is a no-insert');
  store.db.close();
});

test('replace of a closed tool wave is allowed', () => {
  const store = tmpStore();
  const session = sessionOf(store);
  const u = store.appendMessage(session.id, 'user', [{ type: 'text', text: 'run' }]);
  store.appendMessage(session.id, 'assistant', [
    { type: 'tool_call', toolCallId: 'c1', name: 'bash', input: { command: 'ls' } }
  ]);
  const tool = store.appendMessage(session.id, 'tool', [
    { type: 'tool_result', toolCallId: 'c1', name: 'bash', content: 'ok', ok: true }
  ]);
  const replacement = store.appendReplacement(session.id, {
    startSeq: u.seq,
    endSeq: tool.seq,
    role: 'system',
    parts: [{ type: 'text', text: 'did ls' }]
  });
  const folded = store.foldMessages(session.id);
  assert.equal(folded.length, 1);
  assert.equal(folded[0].id, replacement.id);
  assert.equal(unmatchedToolCallIds(folded).length, 0);
  store.db.close();
});

test('dangling replace range is rejected', () => {
  const store = tmpStore();
  const session = sessionOf(store);
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'only' }]);
  assert.throws(
    () =>
      store.appendReplacement(session.id, {
        startSeq: 1,
        endSeq: 9,
        role: 'system',
        parts: [{ type: 'text', text: 'x' }]
      }),
    (err) => err instanceof SurfaceInvariantError && /dangling/.test(err.message)
  );
  store.db.close();
});

test('fold is deterministic: same WAL yields byte-identical JSON', () => {
  const store = tmpStore();
  const session = sessionOf(store);
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'a' }], { key: 'k' });
  store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'b' }]);
  store.hideByKey(session.id, 'k');
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'a2' }], { key: 'k' });
  const first = foldCanonicalJson(store.foldMessages(session.id));
  const second = foldCanonicalJson(store.foldMessages(session.id));
  const third = foldCanonicalJson(foldSurface(store.listSurfaceNodes(session.id)));
  assert.equal(first, second);
  assert.equal(second, third);
  store.db.close();
});

test('same key overwrite via hideByKey + append: fold only sees the later node', () => {
  const store = tmpStore();
  const session = sessionOf(store);
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'first' }], { key: 'steer' });
  store.hideByKey(session.id, 'steer');
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'second' }], { key: 'steer' });
  const folded = store.foldMessages(session.id);
  assert.equal(folded.length, 1);
  assert.equal(folded[0].parts[0].text, 'second');
  assert.equal(store.listMessages(session.id).filter((m) => m.key === 'steer').length, 2);
  store.db.close();
});
