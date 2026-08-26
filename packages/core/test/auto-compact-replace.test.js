import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/runtime.js';
import {
  SurfaceInvariantError,
  runAutoCompact,
  isContextOverflowError,
  selectClosedPrefixRange
} from '../dist/index.js';
import { estimateMessageTokens } from '../dist/model/token-estimate.js';

class ScriptedAdapter {
  constructor(handler) {
    this.name = 'scripted';
    this.handler = handler;
    this.summaries = 0;
  }
  async runTurn(input) {
    return this.handler(input);
  }
  async summarizeMessages() {
    this.summaries += 1;
    return 'compact-summary-text';
  }
}

function runtimeWithAdapter(adapter) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'raw-agent-repo-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'raw-agent-state-'));
  return new RawAgentRuntime({ repoRoot, stateDir, modelAdapter: adapter });
}

test('compact replace: WAL count does not drop, fold tokens do', async () => {
  const adapter = new ScriptedAdapter(() => ({
    stopReason: 'end',
    assistantParts: [{ type: 'text', text: 'ok' }]
  }));
  const runtime = runtimeWithAdapter(adapter);
  const session = runtime.createChatSession({ title: 'c', message: 'hello' });
  for (let i = 0; i < 8; i++) {
    runtime.store.appendMessage(session.id, 'user', [{ type: 'text', text: `u${i} ${'x'.repeat(200)}` }]);
    runtime.store.appendMessage(session.id, 'assistant', [{ type: 'text', text: `a${i} ${'y'.repeat(200)}` }]);
  }
  const walBefore = runtime.store.listMessages(session.id).length;
  const foldBefore = runtime.store.foldMessages(session.id);
  const tokensBefore = estimateMessageTokens(foldBefore);

  const result = await runAutoCompact({
    store: runtime.store,
    session: runtime.store.getSession(session.id),
    agent: { id: 'main', name: 'm', role: 'a', instructions: '', capabilities: [] },
    tokenThreshold: 50,
    keepRecent: 2,
    summarize: async () => 'SUM',
    capSummary: (t) => t
  });

  assert.equal(result.didCompact, true);
  assert.ok(result.replaced);
  const walAfter = runtime.store.listMessages(session.id);
  const folded = runtime.store.foldMessages(session.id);
  assert.ok(walAfter.length >= walBefore, 'WAL count must not drop');
  assert.ok(estimateMessageTokens(folded) < tokensBefore, 'fold tokens drop');
  assert.ok(folded.some((m) => m.parts.some((p) => p.type === 'text' && p.text === 'SUM')));
});

test('open tool wave: compact throws in strict mode and no-ops otherwise', async () => {
  const adapter = new ScriptedAdapter(() => ({
    stopReason: 'end',
    assistantParts: [{ type: 'text', text: 'ok' }]
  }));
  const runtime = runtimeWithAdapter(adapter);
  const session = runtime.createChatSession({ title: 'open', message: 'run' });
  runtime.store.appendMessage(session.id, 'assistant', [
    { type: 'tool_call', toolCallId: 'c1', name: 'bash', input: { command: 'ls' } }
  ]);

  const noop = await runAutoCompact({
    store: runtime.store,
    session: runtime.store.getSession(session.id),
    agent: { id: 'main', name: 'm', role: 'a', instructions: '', capabilities: [] },
    tokenThreshold: 1,
    force: true,
    summarize: async () => 'SUM'
  });
  assert.equal(noop.didCompact, false);
  assert.equal(noop.skippedReason, 'open_tool_wave');

  await assert.rejects(
    () =>
      runAutoCompact({
        store: runtime.store,
        session: runtime.store.getSession(session.id),
        agent: { id: 'main', name: 'm', role: 'a', instructions: '', capabilities: [] },
        tokenThreshold: 1,
        force: true,
        strict: true,
        summarize: async () => 'SUM'
      }),
    SurfaceInvariantError
  );
});

test('overflow 413: first mock fails, compact, second succeeds', async () => {
  let calls = 0;
  const adapter = new ScriptedAdapter(() => {
    calls += 1;
    if (calls === 1) {
      throw new Error('HTTP 413 prompt is too long / context_length_exceeded');
    }
    return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'recovered' }] };
  });
  const runtime = runtimeWithAdapter(adapter);
  const session = runtime.createChatSession({ title: 'ovf', message: `pad ${'z'.repeat(800)}` });
  for (let i = 0; i < 6; i++) {
    runtime.store.appendMessage(session.id, 'user', [{ type: 'text', text: `u${i} ${'x'.repeat(120)}` }]);
    runtime.store.appendMessage(session.id, 'assistant', [{ type: 'text', text: `a${i} ${'y'.repeat(120)}` }]);
  }
  const result = await runtime.runSession(session.id);
  assert.equal(result.status, 'idle');
  assert.equal(runtime.getLatestAssistantText(session.id), 'recovered');
  assert.equal(calls, 2);
});

test('isContextOverflowError detects 413 / context_length', () => {
  assert.equal(isContextOverflowError(new Error('HTTP 413')), true);
  assert.equal(isContextOverflowError(new Error('context_length_exceeded')), true);
  assert.equal(isContextOverflowError(new Error('nope')), false);
});

test('selectClosedPrefixRange does not cut an open tool wave', () => {
  const msgs = [
    { id: '1', sessionId: 's', role: 'user', seq: 1, parts: [{ type: 'text', text: 'a' }], createdAt: 't' },
    {
      id: '2',
      sessionId: 's',
      role: 'assistant',
      seq: 2,
      parts: [{ type: 'tool_call', toolCallId: 'c', name: 'bash', input: {} }],
      createdAt: 't'
    },
    { id: '3', sessionId: 's', role: 'user', seq: 3, parts: [{ type: 'text', text: 'b' }], createdAt: 't' }
  ];
  const range = selectClosedPrefixRange(msgs, 1);
  if (range) {
    assert.ok(range.endSeq < 2, 'must not end inside the open tool wave');
  }
});
