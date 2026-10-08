import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/runtime.js';
import { settleRuns } from './helpers/settle.js';

class ScriptedAdapter {
  constructor() {
    this.name = 'scripted';
    this.turns = [];
    this.script = new Map();
  }
  async runTurn(input) {
    const sessionId = input.sessionId;
    this.turns.push({ sessionId, tools: input.tools.map((t) => t.name) });
    const toolCall = this.script.get(sessionId);
    const hasResult = input.messages.some((m) => m.parts.some((p) => p.type === 'tool_result'));
    if (toolCall && !hasResult) {
      return {
        stopReason: 'tool_use',
        assistantParts: [{ type: 'tool_call', toolCallId: 'call_1', name: 'message_agent', input: toolCall }]
      };
    }
    return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'ok' }] };
  }
  async summarizeMessages() {
    return '';
  }
}

function makeRuntime(adapter) {
  return new RawAgentRuntime({
    repoRoot: mkdtempSync(join(tmpdir(), 'ma-rt-repo-')),
    stateDir: mkdtempSync(join(tmpdir(), 'ma-rt-state-')),
    modelAdapter: adapter
  });
}


test('runtime exposes message_agent only on canonical bot chat turns', async () => {
  const adapter = new ScriptedAdapter();
  const rt = makeRuntime(adapter);
  const alpha = rt.createBot({ name: 'Alpha' });
  await rt.runSession(alpha.canonicalSessionId);
  const plain = rt.createChatSession({ agentId: 'general', title: 'plain' });
  await rt.runSession(plain.id);
  const task = rt.store.createSession({
    title: 'task',
    mode: 'task',
    agentId: alpha.id,
    metadata: { canonicalBotChat: true, botId: alpha.id }
  });
  rt.store.appendMessage(task.id, 'user', [{ type: 'text', text: 'hi' }]);
  await rt.runSession(task.id);
  const toolsOf = (sessionId) => adapter.turns.find((t) => t.sessionId === sessionId)?.tools;
  assert.ok(toolsOf(alpha.canonicalSessionId)?.includes('message_agent'));
  assert.ok(toolsOf(plain.id) && !toolsOf(plain.id).includes('message_agent'));
  assert.ok(toolsOf(task.id) && !toolsOf(task.id).includes('message_agent'));
});

test('model tool call delivers into the peer canonical chat and wakes it through the real runtime', async () => {
  const adapter = new ScriptedAdapter();
  const rt = makeRuntime(adapter);
  const alpha = rt.createBot({ name: 'Alpha' });
  const beta = rt.createBot({ name: 'Beta' });
  rt.store.appendMessage(alpha.canonicalSessionId, 'user', [{ type: 'text', text: 'ask beta' }]);
  adapter.script.set(alpha.canonicalSessionId, { target: 'Beta', message: 'please check the quota' });
  await rt.runSession(alpha.canonicalSessionId);
  await settleRuns(rt);

  const alphaMsgs = rt.store.listMessages(alpha.canonicalSessionId);
  const result = alphaMsgs.flatMap((m) => m.parts).find((p) => p.type === 'tool_result');
  assert.ok(result, 'tool_call stays paired with a tool_result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.delivered, true);
  assert.equal(payload.woke, true);

  const betaUser = rt.store
    .listMessages(beta.canonicalSessionId)
    .filter((m) => m.role === 'user')
    .map((m) => m.parts.map((p) => p.text ?? '').join(''));
  assert.deepEqual(betaUser, [`Message from ${alpha.name} / ${alpha.id}: please check the quota`]);
  assert.ok(
    adapter.turns.some((t) => t.sessionId === beta.canonicalSessionId),
    'beta ran on its own session'
  );
  assert.equal(rt.store.getSession(beta.canonicalSessionId).status, 'idle');
});

test('unknown target through the runtime returns structured JSON and keeps the pairing', async () => {
  const adapter = new ScriptedAdapter();
  const rt = makeRuntime(adapter);
  const alpha = rt.createBot({ name: 'Alpha' });
  rt.createBot({ name: 'Researcher' });
  rt.store.appendMessage(alpha.canonicalSessionId, 'user', [{ type: 'text', text: 'go' }]);
  adapter.script.set(alpha.canonicalSessionId, { target: 'Reseacher', message: 'hi' });
  await rt.runSession(alpha.canonicalSessionId);
  const result = rt.store
    .listMessages(alpha.canonicalSessionId)
    .flatMap((m) => m.parts)
    .find((p) => p.type === 'tool_result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.error_code, 'UNKNOWN_TARGET');
  assert.equal(payload.did_you_mean, 'Researcher');
});
