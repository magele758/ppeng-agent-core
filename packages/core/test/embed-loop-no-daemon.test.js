/**
 * Phase 4: embed L4 without listening on a daemon port or reading auth env.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentLoop, RawAgentRuntime } from '../dist/index.js';

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

test('createAgentLoop works without daemon listen or RAW_AGENT_AUTH_TOKEN', async () => {
  const prev = process.env.RAW_AGENT_AUTH_TOKEN;
  delete process.env.RAW_AGENT_AUTH_TOKEN;

  const runtime = new RawAgentRuntime({
    repoRoot: mkdtempSync(join(tmpdir(), 'embed-repo-')),
    stateDir: mkdtempSync(join(tmpdir(), 'embed-state-')),
    modelAdapter: new ScriptedAdapter(() => ({
      stopReason: 'end',
      assistantParts: [{ type: 'text', text: 'pong' }]
    }))
  });

  const session = runtime.createChatSession({ title: 'no-daemon', message: 'ping' });
  const loop = createAgentLoop(
    {
      getSession: (id) => runtime.getSession(id),
      foldMessages: (id) => runtime.store.foldMessages(id),
      enqueueSteer: (id, text, opts) => {
        runtime.enqueueSteer(id, text, opts);
      },
      abortSession: (id) => runtime.cancelSession(id),
      startRun: (id, latch) => runtime.runSession(id, { latch })
    },
    session.id
  );

  const prep = await loop.step();
  assert.equal(prep.type, 'turn_prepared');
  const model = await loop.step();
  assert.equal(model.type, 'model_done');
  await loop.steer('next please');
  const folded = await loop.fold();
  assert.ok(folded.length >= 1);
  assert.equal(process.env.RAW_AGENT_AUTH_TOKEN, undefined);

  if (prev === undefined) delete process.env.RAW_AGENT_AUTH_TOKEN;
  else process.env.RAW_AGENT_AUTH_TOKEN = prev;
  await runtime.destroy();
});
