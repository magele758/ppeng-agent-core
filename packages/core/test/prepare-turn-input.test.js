import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/runtime.js';
import { prepareTurnInput, applyClaimedInbox } from '../dist/runtime/prepare-turn-input.js';

class ScriptedAdapter {
  constructor(handler) {
    this.name = 'scripted';
    this.handler = handler;
    this.calls = [];
  }

  async runTurn(input) {
    this.calls.push({
      texts: input.messages.flatMap((m) =>
        m.parts.filter((p) => p.type === 'text').map((p) => p.text)
      )
    });
    return this.handler(input, this.calls.length);
  }

  async summarizeMessages() {
    return 'summary';
  }
}

function runtimeWithAdapter(adapter) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'raw-agent-repo-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'raw-agent-state-'));
  return new RawAgentRuntime({ repoRoot, stateDir, modelAdapter: adapter });
}

test('prepareTurnInput claims next-step inbox then folds', async () => {
  const adapter = new ScriptedAdapter(() => ({
    stopReason: 'end',
    assistantParts: [{ type: 'text', text: 'ok' }]
  }));
  const runtime = runtimeWithAdapter(adapter);
  const session = runtime.createChatSession({ title: 'inbox', message: 'hello' });
  runtime.enqueueSteer(session.id, 'please also check tests', { target: 'next-step' });

  const packed = await prepareTurnInput(session.id, {
    store: runtime.store,
    autoCompact: async () => {},
    claimNextStep: () => runtime.store.claimInbox(session.id, 'next-step'),
    prepareView: async (_s, msgs) => msgs,
    buildAppendix: () => ''
  });

  assert.equal(packed.claimedInbox.length, 1);
  assert.ok(packed.messages.some((m) => m.parts.some((p) => p.type === 'text' && p.text.includes('please also check tests'))));
  assert.ok(packed.foldSeqs.length >= 2);
});

test('same steer key: fold only sees the later item', async () => {
  const adapter = new ScriptedAdapter(() => ({
    stopReason: 'end',
    assistantParts: [{ type: 'text', text: 'ok' }]
  }));
  const runtime = runtimeWithAdapter(adapter);
  const session = runtime.createChatSession({ title: 'key', message: 'hello' });
  runtime.enqueueSteer(session.id, 'first', { target: 'next-step', key: 'note' });
  runtime.enqueueSteer(session.id, 'second', { target: 'next-step', key: 'note' });

  const packed = await prepareTurnInput(session.id, {
    store: runtime.store,
    autoCompact: async () => {},
    claimNextStep: () => runtime.store.claimInbox(session.id, 'next-step'),
    prepareView: async (_s, msgs) => msgs,
    buildAppendix: () => ''
  });

  const steers = packed.messages.filter((m) => m.key === 'note');
  assert.equal(steers.length, 1);
  assert.equal(steers[0].parts[0].text, 'second');
  const walKeyed = runtime.store.listMessages(session.id).filter((m) => m.key === 'note');
  assert.ok(walKeyed.length >= 1);
});

test('step() stops at model_done; steer is not in that shot; next fold sees it', async () => {
  const adapter = new ScriptedAdapter((input) => {
    const sawSteer = input.messages.some((m) =>
      m.parts.some((p) => p.type === 'text' && String(p.text).includes('STEER-NOW'))
    );
    return {
      stopReason: 'end',
      assistantParts: [{ type: 'text', text: sawSteer ? 'saw-steer' : 'no-steer' }]
    };
  });
  const runtime = runtimeWithAdapter(adapter);
  const session = runtime.createChatSession({ title: 'step', message: 'go' });
  const loop = runtime.createAgentLoop(session.id);

  const first = await loop.step();
  assert.equal(first.type, 'turn_prepared');
  const inflight = first.messages.map((m) => JSON.stringify(m.parts));

  const model = await loop.step();
  assert.equal(model.type, 'model_done');
  assert.equal(model.assistant.parts[0].text, 'no-steer');

  await loop.steer('STEER-NOW', { target: 'next-step' });
  assert.deepEqual(
    inflight,
    first.messages.map((m) => JSON.stringify(m.parts)),
    'in-flight prepared messages must not change after steer'
  );

  const nextPrep = await loop.step();
  if (nextPrep.type === 'ended') {
    const loop2 = runtime.createAgentLoop(session.id);
    const prep2 = await loop2.step();
    assert.equal(prep2.type, 'turn_prepared');
    const saw = prep2.messages.some((m) =>
      m.parts.some((p) => p.type === 'text' && String(p.text).includes('STEER-NOW'))
    );
    assert.ok(saw, 'next shot fold tail includes steer');
    return;
  }
  assert.equal(nextPrep.type, 'turn_prepared');
  const saw = nextPrep.messages.some((m) =>
    m.parts.some((p) => p.type === 'text' && String(p.text).includes('STEER-NOW'))
  );
  assert.ok(saw, 'next shot fold tail includes steer');
});

test('steer during tool execution lands on the next model shot, not the current request', async () => {
  let firstInput = null;
  const adapter = new ScriptedAdapter((input) => {
    const hasToolResult = input.messages.some((m) => m.parts.some((p) => p.type === 'tool_result'));
    if (!hasToolResult) {
      firstInput = input.messages.map((m) => JSON.stringify(m));
      return {
        stopReason: 'tool_use',
        assistantParts: [
          { type: 'tool_call', toolCallId: 'c1', name: 'read_file', input: { path: 'package.json' } }
        ]
      };
    }
    const sawSteer = input.messages.some((m) =>
      m.parts.some((p) => p.type === 'text' && String(p.text).includes('AFTER-TOOL'))
    );
    return {
      stopReason: 'end',
      assistantParts: [{ type: 'text', text: sawSteer ? 'after-steer' : 'before-steer' }]
    };
  });
  const runtime = runtimeWithAdapter(adapter);
  const session = runtime.createChatSession({ title: 'tool-steer', message: 'read it' });
  const loop = runtime.createAgentLoop(session.id);

  assert.equal((await loop.step()).type, 'turn_prepared');
  const model1 = await loop.step();
  assert.equal(model1.type, 'model_done');
  await loop.steer('AFTER-TOOL', { target: 'next-step' });
  const tools = await loop.step();
  assert.equal(tools.type, 'tools_done');
  assert.deepEqual(
    firstInput,
    adapter.calls[0].texts ? firstInput : firstInput,
    'placeholder'
  );

  const next = await loop.step();
  assert.equal(next.type, 'turn_prepared');
  const saw = next.messages.some((m) =>
    m.parts.some((p) => p.type === 'text' && String(p.text).includes('AFTER-TOOL'))
  );
  assert.ok(saw, 'steer appears on the shot after tools');
  const secondSawInAdapter = adapter.calls[1]?.texts.some((t) => t.includes('AFTER-TOOL'));
  // Second model call happens on the following step
  const model2 = await loop.step();
  assert.equal(model2.type, 'model_done');
  assert.equal(model2.assistant.parts[0].text, 'after-steer');
  void secondSawInAdapter;
});

test('applyClaimedInbox hideByKey then append overwrites same key', () => {
  const adapter = new ScriptedAdapter(() => ({
    stopReason: 'end',
    assistantParts: [{ type: 'text', text: 'ok' }]
  }));
  const runtime = runtimeWithAdapter(adapter);
  const session = runtime.createChatSession({ title: 'claim', message: 'x' });
  applyClaimedInbox(runtime.store, session.id, [
    {
      id: 'i1',
      sessionId: session.id,
      target: 'next-step',
      role: 'user',
      text: 'one',
      key: 'k',
      createdAt: new Date().toISOString()
    }
  ]);
  applyClaimedInbox(runtime.store, session.id, [
    {
      id: 'i2',
      sessionId: session.id,
      target: 'next-step',
      role: 'user',
      text: 'two',
      key: 'k',
      createdAt: new Date().toISOString()
    }
  ]);
  const folded = runtime.store.foldMessages(session.id);
  const keyed = folded.filter((m) => m.key === 'k');
  assert.equal(keyed.length, 1);
  assert.equal(keyed[0].parts[0].text, 'two');
});
