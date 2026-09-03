import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemorySurfaceStore,
  saveStepCheckpoint,
  rewindUncommittedTail,
  latestCheckpoint
} from '../dist/session/index.js';

test('checkpoint only saves on a closed boundary; rewind hides uncommitted tail', () => {
  const store = createMemorySurfaceStore();
  const session = store.createSession({ title: 'ckpt', mode: 'chat', agentId: 'general' });
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'hi' }]);
  store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'yo' }]);
  const saved = saveStepCheckpoint(store, session.id, { turn: 0, label: 'step-end' });
  assert.equal(saved.ok, true);
  assert.ok(saved.checkpoint.seq >= 2);

  store.appendMessage(session.id, 'assistant', [
    { type: 'tool_call', toolCallId: 'c1', name: 'bash', input: { command: 'echo x' } }
  ]);
  const open = saveStepCheckpoint(store, session.id, { turn: 1, label: 'mid-wave' });
  assert.equal(open.ok, false);
  assert.equal(open.reason.kind, 'not-closed-boundary');

  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'tail-user' }]);
  const rewind = rewindUncommittedTail(store, session.id, { reason: 'tool_loop' });
  assert.equal(rewind.rewound, true);
  assert.equal(rewind.toSeq, saved.checkpoint.seq);
  const folded = store.foldMessages(session.id);
  assert.ok(!folded.some((m) => m.parts.some((p) => p.type === 'text' && p.text === 'tail-user')));
  assert.ok(folded.some((m) => m.parts.some((p) => p.type === 'text' && p.text === 'hi')));
  const ckpt = latestCheckpoint(store.getSession(session.id).metadata);
  assert.equal(ckpt.seq, saved.checkpoint.seq);
});

test('rewind is no-op when already at checkpoint', () => {
  const store = createMemorySurfaceStore();
  const session = store.createSession({ title: 'ckpt2', mode: 'chat', agentId: 'general' });
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'a' }]);
  const saved = saveStepCheckpoint(store, session.id, { label: 'only' });
  assert.equal(saved.ok, true);
  const rewind = rewindUncommittedTail(store, session.id, { reason: 'noop' });
  assert.equal(rewind.rewound, false);
});
