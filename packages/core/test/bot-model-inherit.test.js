import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/runtime.js';
import { ValidationError } from '../dist/errors.js';
import { parseModelOverrideInput } from '../dist/bots/index.js';
import { createMemorySurfaceStore } from '../dist/session/surface-store.js';
import { forkSession } from '../dist/session/session-fork.js';

const REF_A = { providerId: 'prov-a', modelId: 'alpha-1' };
const REF_B = { providerId: 'prov-b', modelId: 'beta-1' };

class ScriptedAdapter {
  constructor() {
    this.name = 'scripted';
    this.script = new Map();
  }
  async runTurn(input) {
    const call = this.script.get(input.sessionId);
    const hasResult = input.messages.some((m) => m.parts.some((p) => p.type === 'tool_result'));
    if (call && !hasResult) {
      return {
        stopReason: 'tool_use',
        assistantParts: [{ type: 'tool_call', toolCallId: 'call_1', name: call.name, input: call.input }]
      };
    }
    return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'ok' }] };
  }
  async summarizeMessages() {
    return '';
  }
}

function makeRuntime(adapter = new ScriptedAdapter()) {
  return new RawAgentRuntime({
    repoRoot: mkdtempSync(join(tmpdir(), 'mi-repo-')),
    stateDir: mkdtempSync(join(tmpdir(), 'mi-state-')),
    modelAdapter: adapter
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 80));
const pin = (rt, sessionId, ref) => rt.mergeSessionMetadata(sessionId, { modelOverride: ref });

test('message_agent writes into the target chat without copying the sender pin', async () => {
  const adapter = new ScriptedAdapter();
  const rt = makeRuntime(adapter);
  const alpha = rt.createBot({ name: 'Alpha' });
  const beta = rt.createBot({ name: 'Beta' });
  const gamma = rt.createBot({ name: 'Gamma' });
  const delta = rt.createBot({ name: 'Delta' });
  pin(rt, alpha.canonicalSessionId, REF_A);
  pin(rt, delta.canonicalSessionId, REF_A);
  pin(rt, gamma.canonicalSessionId, REF_B);

  for (const [sender, target] of [
    [alpha, 'Beta'],
    [delta, 'Gamma']
  ]) {
    rt.store.appendMessage(sender.canonicalSessionId, 'user', [{ type: 'text', text: `ask ${target}` }]);
    adapter.script.set(sender.canonicalSessionId, {
      name: 'message_agent',
      input: { target, message: 'hello there' }
    });
    await rt.runSession(sender.canonicalSessionId);
    await flush();
  }

  const betaMeta = rt.getSession(beta.canonicalSessionId).metadata;
  const gammaMeta = rt.getSession(gamma.canonicalSessionId).metadata;
  assert.ok(!('modelOverride' in betaMeta), 'unpinned target must not adopt the sender pin');
  assert.deepEqual(gammaMeta.modelOverride, REF_B, 'pinned target keeps its own pin');
  assert.deepEqual(rt.getSession(alpha.canonicalSessionId).metadata.modelOverride, REF_A);
  for (const bot of [beta, gamma]) {
    const delivered = rt.store
      .listMessages(bot.canonicalSessionId)
      .some((m) => m.role === 'user' && m.parts.some((p) => p.type === 'text' && /hello there/.test(p.text)));
    assert.ok(delivered, `message actually reached ${bot.name}`);
  }
});

test('task_create records a task only; it creates no session that could carry a pin', async () => {
  const adapter = new ScriptedAdapter();
  const rt = makeRuntime(adapter);
  const bot = rt.createBot({ name: 'Planner' });
  pin(rt, bot.canonicalSessionId, REF_A);
  const before = rt.store.listSessions().length;
  rt.store.appendMessage(bot.canonicalSessionId, 'user', [{ type: 'text', text: 'plan it' }]);
  adapter.script.set(bot.canonicalSessionId, { name: 'task_create', input: { title: 'Do the thing' } });
  await rt.runSession(bot.canonicalSessionId);
  await flush();
  const tasks = rt.listTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Do the thing');
  assert.equal(rt.store.listSessions().length, before);
});

test('steering subagent inherits the parent pin; unpinned parents stay unpinned', async () => {
  const rt = makeRuntime();
  const pinned = rt.createBot({ name: 'Pinned' });
  const plain = rt.createBot({ name: 'Plain' });
  pin(rt, pinned.canonicalSessionId, REF_B);

  const a = rt.startSteeringSubagent(pinned.canonicalSessionId, 'look into it');
  const b = rt.startSteeringSubagent(plain.canonicalSessionId, 'look into it');
  await flush();
  assert.deepEqual(rt.getSession(a.sessionId).metadata.modelOverride, REF_B);
  assert.ok(!('modelOverride' in rt.getSession(b.sessionId).metadata));
});

test('teammate sessions with a parent inherit its pin; explicit metadata wins; no parent is unchanged', () => {
  const rt = makeRuntime();
  const bot = rt.createBot({ name: 'Lead' });
  pin(rt, bot.canonicalSessionId, REF_A);

  const inherited = rt.createTeammateSession({
    name: 'dag-a',
    role: 'worker',
    prompt: 'go',
    parentSessionId: bot.canonicalSessionId
  });
  const explicit = rt.createTeammateSession({
    name: 'dag-b',
    role: 'worker',
    prompt: 'go',
    parentSessionId: bot.canonicalSessionId,
    metadata: { modelOverride: REF_B }
  });
  const orphan = rt.createTeammateSession({ name: 'dag-c', role: 'worker', prompt: 'go' });
  const plainParent = rt.createChatSession({ agentId: 'general', title: 'plain' });
  const underPlain = rt.createTeammateSession({
    name: 'dag-d',
    role: 'worker',
    prompt: 'go',
    parentSessionId: plainParent.id
  });

  assert.deepEqual(inherited.metadata.modelOverride, REF_A);
  assert.deepEqual(explicit.metadata.modelOverride, REF_B);
  assert.ok(!('modelOverride' in orphan.metadata));
  assert.ok(!('modelOverride' in underPlain.metadata));
});

test('forking a pinned session keeps the pin; unpinned forks stay unpinned', () => {
  const store = createMemorySurfaceStore();
  const pinned = store.createSession({
    title: 'src',
    mode: 'chat',
    agentId: 'general',
    metadata: { modelOverride: REF_A }
  });
  store.appendMessage(pinned.id, 'user', [{ type: 'text', text: 'hi' }]);
  store.appendMessage(pinned.id, 'assistant', [{ type: 'text', text: 'ok' }]);
  const forked = forkSession(store, { sourceSessionId: pinned.id });
  assert.deepEqual(forked.session.metadata.modelOverride, REF_A);

  const plain = store.createSession({ title: 'plain', mode: 'chat', agentId: 'general' });
  store.appendMessage(plain.id, 'user', [{ type: 'text', text: 'hi' }]);
  store.appendMessage(plain.id, 'assistant', [{ type: 'text', text: 'ok' }]);
  const forkedPlain = forkSession(store, { sourceSessionId: plain.id });
  assert.ok(!('modelOverride' in forkedPlain.session.metadata));
});

test('parseModelOverrideInput is a format check only', () => {
  assert.equal(parseModelOverrideInput(null), null);
  assert.equal(parseModelOverrideInput(''), null);
  assert.deepEqual(parseModelOverrideInput(REF_A), REF_A);
  assert.deepEqual(parseModelOverrideInput({ ...REF_A, extra: 1 }), REF_A);
  for (const bad of ['alpha-1', { providerId: 'x' }, { modelId: 'x' }, 7, [], true]) {
    assert.throws(() => parseModelOverrideInput(bad), ValidationError, JSON.stringify(bad));
  }
});
