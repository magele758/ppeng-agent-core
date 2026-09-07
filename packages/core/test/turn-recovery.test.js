/**
 * kernel-lock: truncated/empty/protocol recovery actions.
 */
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

test('tool_use with empty tool_calls is treated as no output', () => {
  const state = createTurnRecoveryState();
  const d = decideTurnRecovery({
    stopReason: 'tool_use',
    assistantParts: [{ type: 'text', text: 'calling tools' }],
    state
  });
  assert.equal(d.action, 'retry-after-nudge');
  assert.equal(d.discardAssistant, true);
  assert.match(d.nudge, /structured tool_call channel/);
});

test('finish_reason tool_calls without parsed calls is a protocol retry', () => {
  const state = createTurnRecoveryState();
  const d = decideTurnRecovery({
    stopReason: 'end',
    finishReason: 'tool_calls',
    assistantParts: [{ type: 'reasoning', text: 'I will call bash' }],
    state
  });
  assert.equal(d.action, 'retry-after-nudge');
  assert.equal(d.discardAssistant, true);
});

test('finish_reason=stop with structured tool_calls is continue, not end', () => {
  const d = decideTurnRecovery({
    stopReason: 'end',
    finishReason: 'stop',
    assistantParts: [
      { type: 'text', text: 'running bash' },
      { type: 'tool_call', toolCallId: 'c1', name: 'bash', input: { command: 'ls' } }
    ],
    state: createTurnRecoveryState()
  });
  assert.equal(d.action, 'continue');
});

test('prose mentioning tool_call is a clean end (not a leak)', () => {
  const d = decideTurnRecovery({
    stopReason: 'end',
    finishReason: 'stop',
    assistantParts: [{ type: 'text', text: 'Use the tool_call API, not XML in the reply.' }],
    state: createTurnRecoveryState()
  });
  assert.equal(d.action, 'end');
});

test('body leak variants are not treated as end', () => {
  for (const text of [
    '<invoke name="bash">',
    '<invoke name="bash">ls</invoke>',
    '<tool_calls>[{"name":"bash"}]</tool_calls>',
    '<antml:invoke name="bash">',
    '<｜DSML｜tool_calls>\n<｜DSML｜invoke name="bash">'
  ]) {
    const d = decideTurnRecovery({
      stopReason: 'end',
      finishReason: 'stop',
      assistantParts: [{ type: 'text', text }],
      state: createTurnRecoveryState()
    });
    assert.equal(d.action, 'retry-after-nudge', text);
    assert.equal(d.discardAssistant, true, text);
  }
});

test('thinking leak is not treated as end', () => {
  const d = decideTurnRecovery({
    stopReason: 'end',
    assistantParts: [{ type: 'reasoning', text: 'let me run <invoke name="bash">' }],
    state: createTurnRecoveryState()
  });
  assert.equal(d.action, 'retry-after-nudge');
});

test('structured call plus leak text still continues', () => {
  const d = decideTurnRecovery({
    stopReason: 'tool_use',
    assistantParts: [
      { type: 'text', text: 'see <tool_calls> below' },
      { type: 'tool_call', toolCallId: 'c1', name: 'bash', input: {} }
    ],
    state: createTurnRecoveryState()
  });
  assert.equal(d.action, 'continue');
});

test('normal text reply is still end', () => {
  const d = decideTurnRecovery({
    stopReason: 'end',
    finishReason: 'stop',
    assistantParts: [{ type: 'text', text: '已完成，共修改 3 个文件。' }],
    state: createTurnRecoveryState()
  });
  assert.equal(d.action, 'end');
});

test('content_filter exhausted keeps its own reason', () => {
  const state = createTurnRecoveryState();
  for (let i = 0; i < MAX_EMPTY_RETRIES; i++) {
    decideTurnRecovery({
      stopReason: 'end',
      finishReason: 'content_filter',
      assistantParts: [],
      state
    });
  }
  const last = decideTurnRecovery({
    stopReason: 'end',
    finishReason: 'content_filter',
    assistantParts: [],
    state
  });
  assert.equal(last.action, 'abort');
  assert.equal(last.reason, 'content_filter');
  assert.equal(last.discardAssistant, undefined);
});

test('hyphenated finishReason=tool-calls without calls is a protocol retry', () => {
  const d = decideTurnRecovery({
    stopReason: 'end',
    finishReason: 'tool-calls',
    assistantParts: [{ type: 'text', text: 'I will call the tool now' }],
    state: createTurnRecoveryState()
  });
  assert.equal(d.action, 'retry-after-nudge');
  assert.equal(d.discardAssistant, true);
});

test('DSML leaked into reasoning is discarded and treated as empty', () => {
  const state = createTurnRecoveryState();
  const leak = '<｜DSML｜tool_calls>\n<｜DSML｜invoke name="bash">curl hn.algolia.com';
  const first = decideTurnRecovery({
    stopReason: 'end',
    finishReason: 'stop',
    assistantParts: [{ type: 'reasoning', text: leak }],
    state
  });
  assert.equal(first.action, 'retry-after-nudge');
  assert.equal(first.discardAssistant, true);
  decideTurnRecovery({
    stopReason: 'end',
    assistantParts: [{ type: 'reasoning', text: leak }],
    state
  });
  const last = decideTurnRecovery({
    stopReason: 'end',
    assistantParts: [{ type: 'reasoning', text: leak }],
    state
  });
  assert.equal(last.action, 'abort');
  assert.equal(last.reason, 'empty_assistant');
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

test('runtime: finish_reason=stop with tool_calls still executes the tool', async () => {
  const { writeFileSync } = await import('node:fs');
  let calls = 0;
  const runtime = new RawAgentRuntime({
    repoRoot: mkdtempSync(join(tmpdir(), 'repo-')),
    stateDir: mkdtempSync(join(tmpdir(), 'state-')),
    modelAdapter: new ScriptedAdapter((input) => {
      calls += 1;
      const hasResult = input.messages.some((m) =>
        m.parts.some((p) => p.type === 'tool_result' && p.name === 'read_file')
      );
      if (!hasResult) {
        return {
          stopReason: 'end',
          finishReason: 'stop',
          assistantParts: [
            {
              type: 'tool_call',
              toolCallId: 'wrong_stop_1',
              name: 'read_file',
              input: { path: 'note.txt' }
            }
          ]
        };
      }
      return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'read ok' }] };
    })
  });
  writeFileSync(join(runtime.repoRoot, 'note.txt'), 'hello-dsml');
  const session = runtime.createChatSession({ title: 'wrong-stop', message: 'read note' });
  const result = await runtime.runSession(session.id);
  assert.equal(result.status, 'idle');
  assert.ok(calls >= 2, `expected tool loop to continue, got ${calls} calls`);
  assert.equal(runtime.getLatestAssistantText(session.id), 'read ok');
});

test('runtime: DSML leak with finish_reason=stop is discarded and retried, not ended', async () => {
  const leak = '<｜DSML｜tool_calls>\n<｜DSML｜invoke name="bash">curl hn.algolia.com';
  let calls = 0;
  const runtime = new RawAgentRuntime({
    repoRoot: mkdtempSync(join(tmpdir(), 'repo-')),
    stateDir: mkdtempSync(join(tmpdir(), 'state-')),
    modelAdapter: new ScriptedAdapter(() => {
      calls += 1;
      if (calls === 1) {
        return {
          stopReason: 'end',
          finishReason: 'stop',
          assistantParts: [{ type: 'text', text: leak }]
        };
      }
      return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'ok without tools' }] };
    })
  });
  const session = runtime.createChatSession({ title: 'dsml-leak', message: 'go' });
  const result = await runtime.runSession(session.id);
  assert.equal(result.status, 'idle');
  assert.ok(calls >= 2, `expected leak retry, got ${calls} calls`);
  const folded = runtime.store.foldMessages(session.id);
  assert.equal(
    folded.some((m) => m.role === 'assistant' && m.parts.some((p) => p.type === 'text' && p.text.includes('DSML'))),
    false
  );
  assert.ok(
    folded.some(
      (m) =>
        m.role === 'system' &&
        m.parts.some((p) => p.type === 'text' && p.text.includes('structured tool_call channel'))
    )
  );
  assert.equal(runtime.getLatestAssistantText(session.id), 'ok without tools');
});

test('runtime: empty assistant retries then stops idle without rollback', async () => {
  let calls = 0;
  const runtime = new RawAgentRuntime({
    repoRoot: mkdtempSync(join(tmpdir(), 'repo-')),
    stateDir: mkdtempSync(join(tmpdir(), 'state-')),
    modelAdapter: new ScriptedAdapter(() => {
      calls += 1;
      return { stopReason: 'end', assistantParts: [] };
    })
  });
  const session = runtime.createChatSession({ title: 'empty-stop', message: 'hi' });
  const result = await runtime.runSession(session.id);
  assert.equal(result.status, 'idle');
  assert.equal(result.metadata?.outcome?.reason, 'empty_assistant');
  assert.equal(result.metadata?.outcome?.kind, 'idle');
  assert.equal(calls, MAX_EMPTY_RETRIES + 1);
  const folded = runtime.store.foldMessages(session.id);
  assert.ok(
    folded.some(
      (m) =>
        m.role === 'system' &&
        m.parts.some((p) => p.type === 'text' && p.text.includes('no assistant content'))
    )
  );
  assert.equal(result.metadata?.outcome?.rewind, undefined);
});
