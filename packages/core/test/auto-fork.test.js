import test from 'node:test';
import assert from 'node:assert/strict';
import { decideAutoFork, isAutoForkUsed } from '../dist/session/auto-fork.js';

test('AutoFork only once when a closed checkpoint exists', () => {
  const first = decideAutoFork({
    trigger: 'deadloop-exhausted',
    alreadyUsed: false,
    checkpoint: { id: 'c', sessionId: 's', seq: 2, turn: 0, label: 'step', createdAt: '' },
    currentSeq: 5
  });
  assert.equal(first.shouldFork, true);
  assert.ok(first.guidance);
  const second = decideAutoFork({
    trigger: 'deadloop-exhausted',
    alreadyUsed: true,
    checkpoint: first.checkpoint,
    currentSeq: 5
  });
  assert.equal(second.shouldFork, false);
  assert.equal(isAutoForkUsed({ autoForkUsed: true }), true);
});
