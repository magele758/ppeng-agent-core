import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/runtime.js';
import {
  decideTurnRecovery,
  createTurnRecoveryState,
  noteCriticalHit,
  MAX_TRUNCATION_CONTINUES,
  MAX_EMPTY_RETRIES,
  MAX_CRITICAL_HITS
} from '../dist/runtime/turn-recovery.js';

test('truncated without tools nudges continue, then ends after budget', () => {
  const state = createTurnRecoveryState();
  const parts = [{ type: 'text', text: 'partial answer' }];
  const first = decideTurnRecovery({
    stopReason: 'end',
    finishReason: 'length',
    truncated: true,
    assistantParts: parts,
    state
  });
  assert.equal(first.action, 'retry-after-nudge');
  const second = decideTurnRecovery({
    stopReason: 'end',
    finishReason: 'length',
    truncated: true,
    assistantParts: parts,
    state
  });
  assert.equal(second.action, 'retry-after-nudge');
  const third = decideTurnRecovery({
    stopReason: 'end',
    finishReason: 'length',
    truncated: true,
    assistantParts: parts,
    state
  });
  assert.equal(third.action, 'end');
  assert.equal(state.truncatedContinues, MAX_TRUNCATION_CONTINUES);
});

test('truncated incomplete tool_call retries same input, does not continue as execute', () => {
  const state = createTurnRecoveryState();
  const d = decideTurnRecovery({
    stopReason: 'tool_use',
    truncated: true,
    assistantParts: [{ type: 'tool_call', toolCallId: '', name: '', input: {} }],
    state
  });
  assert.equal(d.action, 'retry-same-input');
});

test('tool_use with empty tool_calls is a protocol retry', () => {
  const state = createTurnRecoveryState();
  const d = decideTurnRecovery({
    stopReason: 'tool_use',
    assistantParts: [{ type: 'text', text: 'calling tools' }],
    state
  });
  assert.equal(d.action, 'retry-after-nudge');
  assert.match(d.nudge, /tool_calls was empty/);
});

test('empty assistant retries then aborts', () => {
  const state = createTurnRecoveryState();
  for (let i = 0; i < MAX_EMPTY_RETRIES; i++) {
    const d = decideTurnRecovery({ stopReason: 'end', assistantParts: [], state });
    assert.equal(d.action, 'retry-after-nudge');
  }
  const last = decideTurnRecovery({ stopReason: 'end', assistantParts: [], state });
  assert.equal(last.action, 'abort');
  assert.equal(last.reason, 'empty_assistant');
});

test('user abort is not mixed with protocol retry', () => {
  const d = decideTurnRecovery({
    stopReason: 'end',
    truncated: true,
    assistantParts: [{ type: 'text', text: 'x' }],
    state: createTurnRecoveryState(),
    userAborted: true
  });
  assert.equal(d.action, 'abort');
  assert.equal(d.reason, 'user_abort');
});

test('loop guard second critical hit terminates', () => {
  const state = createTurnRecoveryState();
  assert.equal(noteCriticalHit(state).action, 'continue');
  const second = noteCriticalHit(state);
  assert.equal(second.action, 'abort');
  assert.equal(state.criticalHits, MAX_CRITICAL_HITS);
});

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

test('runtime: truncated continues instead of ending', async () => {
  let calls = 0;
  const runtime = new RawAgentRuntime({
    repoRoot: mkdtempSync(join(tmpdir(), 'repo-')),
    stateDir: mkdtempSync(join(tmpdir(), 'state-')),
    modelAdapter: new ScriptedAdapter(() => {
      calls += 1;
      if (calls === 1) {
        return {
          stopReason: 'end',
          finishReason: 'length',
          truncated: true,
          assistantParts: [{ type: 'text', text: 'hello wor' }]
        };
      }
      return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'hello world' }] };
    })
  });
  const session = runtime.createChatSession({ title: 'trunc', message: 'hi' });
  const result = await runtime.runSession(session.id);
  assert.equal(result.status, 'idle');
  assert.ok(calls >= 2, `expected continuation, got ${calls} calls`);
  const folded = runtime.store.foldMessages(session.id);
  assert.ok(
    folded.some((m) => m.role === 'system' && m.parts.some((p) => p.type === 'text' && p.text.includes('truncated')))
  );
});
