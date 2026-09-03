import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';

test('updateUnclaimedInbox / removeUnclaimedInbox only touch pending items', () => {
  const dir = mkdtempSync(join(tmpdir(), 'steer-inbox-edit-'));
  const store = new SqliteStateStore(join(dir, 'state.db'));
  const session = store.createSession({ title: 'inbox-edit', mode: 'chat', agentId: 'general' });

  const item = store.enqueueSteer(session.id, 'hello', { target: 'next-run' });
  const updated = store.updateUnclaimedInbox(session.id, item.id, '  edited  ');
  assert.equal(updated?.text, 'edited');
  assert.equal(store.listUnclaimedInbox(session.id)[0]?.text, 'edited');
  assert.equal(store.updateUnclaimedInbox(session.id, item.id, '   '), undefined);
  assert.equal(store.updateUnclaimedInbox(session.id, 'missing', 'x'), undefined);

  assert.equal(store.removeUnclaimedInbox(session.id, item.id), true);
  assert.equal(store.listUnclaimedInbox(session.id).length, 0);
  assert.equal(store.removeUnclaimedInbox(session.id, item.id), false);

  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});
