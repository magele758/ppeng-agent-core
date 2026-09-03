import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';

test('deleteSession removes the row and its messages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-delete-'));
  const store = new SqliteStateStore(join(dir, 'state.db'));
  try {
    const session = store.createSession({ title: 'to-delete', mode: 'chat', agentId: 'general' });
    store.appendMessage(session.id, 'user', [{ type: 'text', text: 'hi' }]);
    assert.equal(store.getSession(session.id)?.id, session.id);
    assert.equal(store.listMessages(session.id).length, 1);
    assert.equal(store.deleteSession(session.id), true);
    assert.equal(store.getSession(session.id), undefined);
    assert.equal(store.listMessages(session.id).length, 0);
    assert.equal(store.deleteSession(session.id), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
