/**
 * Pure L4: createAgentLoop over createTurnKernelLoopHost (no RawAgentRuntime).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentLoop } from '../dist/loop.js';
import { createMemorySurfaceStore } from '../dist/session/index.js';
import { createTurnKernelLoopHost } from '../dist/turn/index.js';

class ScriptedAdapter {
  constructor(handler) {
    this.name = 'scripted';
    this.handler = handler;
  }
  async runTurn(input) {
    return this.handler(input);
  }
  async summarizeMessages() {
    return 'summary';
  }
}

test('createTurnKernelLoopHost drives step() without RawAgentRuntime or AUTH_TOKEN', async () => {
  const prev = process.env.RAW_AGENT_AUTH_TOKEN;
  delete process.env.RAW_AGENT_AUTH_TOKEN;

  const store = createMemorySurfaceStore();
  const session = store.createSession({
    title: 'pure-l4',
    mode: 'chat',
    agentId: 'general'
  });
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'ping' }]);

  const host = createTurnKernelLoopHost({
    store,
    model: new ScriptedAdapter(() => ({
      stopReason: 'end',
      assistantParts: [{ type: 'text', text: 'pong' }]
    }))
  });
  const loop = createAgentLoop(host, session.id);
  const prep = await loop.step();
  assert.equal(prep.type, 'turn_prepared');
  const model = await loop.step();
  assert.equal(model.type, 'model_done');
  const ack = await loop.steer('next please');
  assert.ok(ack.status === 'started' || ack.status === 'steered', ack.status);
  const folded = await loop.fold();
  assert.ok(folded.length >= 1);

  await loop.abort();
  const aborted = await loop.step();
  assert.equal(aborted.type, 'abort');
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'again' }]);
  const next = await loop.step();
  assert.equal(next.type, 'turn_prepared');

  assert.equal(process.env.RAW_AGENT_AUTH_TOKEN, undefined);

  if (prev === undefined) delete process.env.RAW_AGENT_AUTH_TOKEN;
  else process.env.RAW_AGENT_AUTH_TOKEN = prev;
});
