import test from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError } from '../dist/errors.js';
import { createMemorySurfaceStore } from '../dist/session/surface-store.js';
import { forkSession, assertCanFork } from '../dist/session/session-fork.js';

test('fork 409 when turn is open', () => {
  const store = createMemorySurfaceStore();
  const session = store.createSession({ title: 'src', mode: 'chat', agentId: 'general' });
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'hi' }]);
  store.updateSession(session.id, { status: 'running' });
  const reject = assertCanFork({
    session: store.getSession(session.id),
    folded: store.foldMessages(session.id)
  });
  assert.equal(reject, 'turn_open');
  assert.throws(() => forkSession(store, { sourceSessionId: session.id }), (err) => {
    assert.ok(err instanceof ConflictError);
    assert.equal(err.statusCode, 409);
    return true;
  });
});

test('fork copies closed WAL prefix into a new session', () => {
  const store = createMemorySurfaceStore();
  const session = store.createSession({ title: 'src', mode: 'chat', agentId: 'general' });
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'keep' }]);
  store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'ok' }]);
  const result = forkSession(store, { sourceSessionId: session.id, title: 'child' });
  assert.notEqual(result.session.id, session.id);
  assert.equal(result.session.parentSessionId, session.id);
  assert.ok(result.copied >= 2);
  const folded = store.foldMessages(result.session.id);
  assert.ok(folded.some((m) => m.parts.some((p) => p.type === 'text' && p.text === 'keep')));
});
