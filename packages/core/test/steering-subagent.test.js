import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startSteeringSubagent,
  waitSteeringChildrenIdle,
  mergeSteeringChild
} from '../dist/session/steering-subagent.js';

test('steering subagent reuses spawn and parent wait idle', async () => {
  let released;
  const done = new Promise((resolve) => {
    released = resolve;
  });
  const parent = { id: 'p1', agentId: 'general', metadata: {} };
  const { child } = startSteeringSubagent({
    parent,
    prompt: 'steer this',
    steerId: 'st1',
    role: 'review',
    spawn: ({ parentSessionId, prompt, role }) => {
      assert.equal(parentSessionId, 'p1');
      assert.equal(prompt, 'steer this');
      assert.equal(role, 'review');
      return { sessionId: 'child-1', done };
    }
  });
  assert.equal(child.status, 'running');
  const meta = mergeSteeringChild(parent.metadata, child);
  assert.equal(meta.steeringChildren[0].sessionId, 'child-1');
  let idle = false;
  const waitP = waitSteeringChildrenIdle('p1').then(() => {
    idle = true;
  });
  await Promise.resolve();
  assert.equal(idle, false);
  released();
  await waitP;
  assert.equal(idle, true);
});
