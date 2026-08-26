/**
 * Phase 4 example: embed L4 without a daemon.
 *
 * Demonstrates `createAgentLoop` + `step()` / `for await` / `steer()` / `fold()`.
 * Uses a scripted model adapter (no real LLM). Steer does not mutate the in-flight shot.
 *
 *   node packages/core/examples/08-agent-loop.mjs
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentLoop, RawAgentRuntime } from '../dist/index.js';
import { ScriptedAdapter } from './_scripted-adapter.mjs';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const repoRoot = mkdtempSync(join(tmpdir(), 'ppeng-agent-repo-'));
const stateDir = mkdtempSync(join(tmpdir(), 'ppeng-agent-state-'));

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
          name: 'read_file',
          input: { path: 'package.json' }
        }
      ]
    };
  }
  return {
    stopReason: 'end',
    assistantParts: [{ type: 'text', text: sawSteer ? 'ack-steer' : 'no-steer' }]
  };
});

const runtime = new RawAgentRuntime({
  repoRoot,
  stateDir,
  modelAdapter: adapter
});

const host = {
  getSession: (id) => runtime.getSession(id),
  foldMessages: (id) => runtime.store.foldMessages(id),
  enqueueSteer: (id, text, opts) => {
    runtime.enqueueSteer(id, text, opts);
  },
  abortSession: (id) => runtime.cancelSession(id),
  startRun: (id, latch) => runtime.runSession(id, { latch })
};

// --- for await + mid-run steer + fold ---
const streamed = runtime.createChatSession({
  title: 'embed-loop-stream',
  message: 'read package.json'
});
const loop = createAgentLoop(host, streamed.id);
const types = [];
for await (const ev of loop) {
  types.push(ev.type);
  if (ev.type === 'model_done' && types.filter((t) => t === 'model_done').length === 1) {
    await loop.steer('STEER-LINE', { target: 'next-step' });
  }
}
const folded = await loop.fold();
const foldHasSteer = folded.some((m) =>
  m.parts.some((p) => p.type === 'text' && String(p.text).includes('STEER-LINE'))
);
const latest = runtime.getLatestAssistantText(streamed.id);

console.log('for-await events:', types.join(' -> '));
console.log('fold has steer:', foldHasSteer);
console.log('latest assistant:', latest);

if (!types.includes('turn_prepared') || !types.includes('model_done') || !types.includes('ended')) {
  fail('expected turn_prepared, model_done, ended in async iterator');
}
if (!foldHasSteer) fail('fold() after run should include next-step steer');
if (!String(latest).includes('ack-steer')) fail('second shot should see steer text');

// --- step() control: stop at model_done; fold is read-only ---
const stepped = runtime.createChatSession({
  title: 'embed-loop-step',
  message: 'hello step'
});
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
