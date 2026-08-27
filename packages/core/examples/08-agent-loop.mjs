/**
 * Pure L4 embed: createAgentLoop + createTurnKernelLoopHost.
 *
 * No RawAgentRuntime, no daemon, no AUTH_TOKEN. Memory WAL + scripted model.
 *
 *   node packages/core/examples/08-agent-loop.mjs
 */
import { createMemorySurfaceStore } from '@ppeng/agent-core/session';
import { createTurnKernelLoopHost } from '@ppeng/agent-core/turn';
import { createAgentLoop } from '@ppeng/agent-core/loop';
import { ScriptedAdapter } from './_scripted-adapter.mjs';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const echoTool = {
  name: 'echo',
  description: 'Echo a string back',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } }
  },
  approvalMode: 'never',
  sideEffectLevel: 'none',
  execute: async (_ctx, args) => ({ ok: true, content: String(args?.text ?? '') })
};

const adapter = new ScriptedAdapter((input) => {
  const sawSteer = input.messages.some(
    (m) =>
      m.role === 'user' &&
      m.parts.some((p) => p.type === 'text' && String(p.text).includes('STEER-LINE'))
  );
  const hasToolResult = input.messages.some((m) => m.parts.some((p) => p.type === 'tool_result'));
  if (!hasToolResult) {
    return {
      stopReason: 'tool_use',
      assistantParts: [
        {
          type: 'tool_call',
          toolCallId: 'ex8',
          name: 'echo',
          input: { text: 'hello-l4' }
        }
      ]
    };
  }
  return {
    stopReason: 'end',
    assistantParts: [{ type: 'text', text: sawSteer ? 'ack-steer' : 'no-steer' }]
  };
});

const store = createMemorySurfaceStore();
const host = createTurnKernelLoopHost({
  store,
  model: adapter,
  tools: [echoTool]
});

function startSession(title, message) {
  const session = store.createSession({ title, mode: 'chat', agentId: 'general' });
  store.appendMessage(session.id, 'user', [{ type: 'text', text: message }]);
  return session;
}

// --- for await + mid-run steer + fold ---
const streamed = startSession('embed-loop-stream', 'read something');
const loop = createAgentLoop(host, streamed.id);
const types = [];
for await (const ev of loop) {
  types.push(ev.type);
  if (ev.type === 'model_done' && types.filter((t) => t === 'model_done').length === 1) {
    const ack = await loop.steer('STEER-LINE', { target: 'next-step' });
    if (ack.status !== 'steered' && ack.status !== 'started') {
      fail(`expected steer started|steered, got ${ack.status}`);
    }
  }
}
const folded = await loop.fold();
const foldHasSteer = folded.some((m) =>
  m.parts.some((p) => p.type === 'text' && String(p.text).includes('STEER-LINE'))
);
const latest = [...folded].reverse().find((m) => m.role === 'assistant');
const latestText = latest?.parts.filter((p) => p.type === 'text').map((p) => p.text).join('') ?? '';

console.log('for-await events:', types.join(' -> '));
console.log('fold has steer:', foldHasSteer);
console.log('latest assistant:', latestText);

if (!types.includes('turn_prepared') || !types.includes('model_done') || !types.includes('ended')) {
  fail('expected turn_prepared, model_done, ended in async iterator');
}
if (!foldHasSteer) fail('fold() after run should include next-step steer');
if (!latestText.includes('ack-steer')) fail('second shot should see steer text');

// --- step() control: stop at model_done; fold is read-only ---
const stepped = startSession('embed-loop-step', 'hello step');
const loop2 = createAgentLoop(host, stepped.id);
const prep = await loop2.step();
if (prep.type !== 'turn_prepared') fail(`expected turn_prepared, got ${prep.type}`);
const model = await loop2.step();
if (model.type !== 'model_done') fail(`expected model_done, got ${model.type}`);
const view = await loop2.fold();
if (!Array.isArray(view) || view.length < 1) fail('fold() should return messages without claiming inbox');
await loop2.abort();

console.log('step() stopped at', model.type, 'fold len', view.length);
console.log('08-agent-loop: ok');
