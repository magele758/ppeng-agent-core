import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import { createMemorySurfaceStore } from '../dist/session/surface-store.js';
import { WriterClaimError } from '../dist/session/writer-claim.js';

function tmpStore() {
  const dir = mkdtempSync(join(tmpdir(), 'writer-'));
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
  return store.createSession({ title: 'writer', mode: 'chat', agentId: 'general' });
}

test('empty writer claim: append without expected id still works (legacy)', () => {
  const store = tmpStore();
  const session = sessionOf(store);
  assert.equal(store.getSession(session.id).activeWriterRunId, undefined);
  const msg = store.appendMessage(session.id, 'user', [{ type: 'text', text: 'hi' }]);
  assert.equal(msg.seq, 1);
  store.db.close();
});

test('claimed writer: matching expected/bound appends; expired run is rejected', () => {
  const store = tmpStore();
  const session = sessionOf(store);
  store.claimWriter(session.id, 'run_a');
  assert.equal(store.getSession(session.id).activeWriterRunId, 'run_a');

  const ok = store.appendMessage(session.id, 'user', [{ type: 'text', text: 'from-a' }], {
    expectedWriterRunId: 'run_a'
  });
  assert.equal(ok.parts[0].text, 'from-a');

  assert.throws(
    () =>
      store.appendMessage(session.id, 'user', [{ type: 'text', text: 'stale' }], {
        expectedWriterRunId: 'run_old'
      }),
    (err) => err instanceof WriterClaimError && err.code === 'WRITER_CLAIM_MISMATCH'
  );

  store.claimWriter(session.id, 'run_b');
  assert.throws(
    () =>
      store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'from-a-again' }], {
        expectedWriterRunId: 'run_a'
      }),
    WriterClaimError
  );
  const fromB = store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'from-b' }], {
    expectedWriterRunId: 'run_b'
  });
  assert.equal(fromB.parts[0].text, 'from-b');

  store.releaseWriter(session.id, 'run_b');
  assert.equal(store.getSession(session.id).activeWriterRunId, undefined);
  store.db.close();
});

test('MemorySurfaceStore writer claim matches SQLite semantics', () => {
  const store = createMemorySurfaceStore();
  const session = store.createSession({ title: 'mem', mode: 'chat', agentId: 'general' });
  store.claimWriter(session.id, 'run_m');
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'ok' }], {
    expectedWriterRunId: 'run_m'
  });
  assert.throws(
    () =>
      store.appendMessage(session.id, 'user', [{ type: 'text', text: 'nope' }], {
        expectedWriterRunId: 'other'
      }),
    WriterClaimError
  );
});
