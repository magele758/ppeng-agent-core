/**
 * Phase 4 example: L3 turn kernel with a caller-owned surface store.
 *
 * `runTurnKernel` + `createMemorySurfaceStore` — no RawAgentRuntime, no daemon,
 * no AUTH_TOKEN. Two-shot scripted model (one tool, then end) and prints fold.
 *
 *   node packages/core/examples/10-turn-kernel-custom-store.mjs
 */
import { runTurnKernel } from '@ppeng/agent-core/turn';
import { createMemorySurfaceStore } from '@ppeng/agent-core/session';
import { ScriptedAdapter } from './_scripted-adapter.mjs';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const store = createMemorySurfaceStore();
const session = store.createSession({
  title: 'l3-embed-kernel',
  mode: 'chat',
  agentId: 'general'
});
store.appendMessage(session.id, 'user', [{ type: 'text', text: 'ping-l3' }]);

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
  const hasToolResult = input.messages.some((m) => m.parts.some((p) => p.type === 'tool_result'));
  if (!hasToolResult) {
    return {
      stopReason: 'tool_use',
      assistantParts: [
        {
          type: 'tool_call',
          toolCallId: 'echo-l3',
          name: 'echo',
          input: { text: 'hello-l3' }
        }
      ]
    };
  }
  return {
    stopReason: 'end',
    assistantParts: [{ type: 'text', text: 'done-l3' }]
  };
});

const record = await runTurnKernel({
  store,
  sessionId: session.id,
  model: adapter,
  tools: [echoTool]
});

const folded = store.foldMessages(session.id);
const foldTexts = folded
  .flatMap((m) =>
    m.parts.flatMap((p) => {
      if (p.type === 'text') return [p.text];
      if (p.type === 'tool_result') return [`tool:${p.name}:${p.content}`];
      if (p.type === 'tool_call') return [`call:${p.name}`];
      return [];
    })
  )
  .join('|');

console.log('session status:', record.status);
console.log('fold rows:', folded.length);
console.log('fold texts:', foldTexts);

if (record.status !== 'idle') fail(`expected idle, got ${record.status}`);
if (!foldTexts.includes('ping-l3')) fail('fold should keep the user ping');
if (!foldTexts.includes('call:echo')) fail('fold should include the echo tool_call');
if (!foldTexts.includes('tool:echo:hello-l3')) fail('fold should include the echo tool_result');
if (!foldTexts.includes('done-l3')) fail('fold should include the final assistant text');

console.log('10-turn-kernel-custom-store: ok');
