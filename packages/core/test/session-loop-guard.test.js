import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionLoopGuard } from '../dist/recovery/session-loop-guard.js';

test('afterToolRound aborts on consecutive tool failures', () => {
  const g = new SessionLoopGuard({
    RAW_AGENT_RECOVERY_TOOL_FAIL_STREAK: '3'
  });
  assert.equal(g.afterToolRound([{ name: 'bash' }], [{ name: 'bash', ok: false }]).abort, false);
  assert.equal(g.afterToolRound([{ name: 'bash' }], [{ name: 'bash', ok: false }]).abort, false);
  const third = g.afterToolRound([{ name: 'bash' }], [{ name: 'bash', ok: false }]);
  assert.equal(third.abort, true);
  assert.match(third.reason, /bash/);
});

test('afterToolRound resets streak on success', () => {
  const g = new SessionLoopGuard({
    RAW_AGENT_RECOVERY_TOOL_FAIL_STREAK: '2'
  });
  g.afterToolRound([{ name: 'bash' }], [{ name: 'bash', ok: false }]);
  assert.equal(g.afterToolRound([{ name: 'bash' }], [{ name: 'bash', ok: true }]).abort, false);
  assert.equal(g.afterToolRound([{ name: 'bash' }], [{ name: 'bash', ok: false }]).abort, false);
});

test('checkAssistantRepetition aborts on identical fingerprints', () => {
  const g = new SessionLoopGuard({
    RAW_AGENT_RECOVERY_REPEAT_WINDOW: '8',
    RAW_AGENT_RECOVERY_REPEAT_RATIO: '0.75'
  });
  const parts = [{ type: 'text', text: 'same' }];
  for (let i = 0; i < 3; i++) {
    assert.equal(g.checkAssistantRepetition(parts).abort, false);
  }
  const fourth = g.checkAssistantRepetition(parts);
  assert.equal(fourth.abort, true);
});

test('afterToolRound same-tool streak', () => {
  const g = new SessionLoopGuard({
    RAW_AGENT_RECOVERY_SAME_TOOL_STREAK: '3'
  });
  assert.equal(g.afterToolRound([{ name: 'x' }], [{ name: 'x', ok: true }]).abort, false);
  assert.equal(g.afterToolRound([{ name: 'x' }], [{ name: 'x', ok: true }]).abort, false);
  const t = g.afterToolRound([{ name: 'x' }], [{ name: 'x', ok: true }]);
  assert.equal(t.abort, true);
});

test('checkAssistantRepetition preserves nested tool arguments in fingerprint', () => {
  const g = new SessionLoopGuard({
    RAW_AGENT_RECOVERY_REPEAT_WINDOW: '8',
    RAW_AGENT_RECOVERY_REPEAT_RATIO: '0.75'
  });
  const base = {
    type: 'tool_call',
    name: 'bash',
    toolCallId: 'call_1'
  };

  assert.equal(
    g.checkAssistantRepetition([
      {
        ...base,
        input: { payload: { command: 'echo one', options: { timeout_ms: 1000 } } }
      }
    ]).abort,
    false
  );
  assert.equal(
    g.checkAssistantRepetition([
      {
        ...base,
        input: { payload: { command: 'echo two', options: { timeout_ms: 1000 } } }
      }
    ]).abort,
    false
  );
  assert.equal(
    g.checkAssistantRepetition([
      {
        ...base,
        input: { payload: { command: 'echo three', options: { timeout_ms: 1000 } } }
      }
    ]).abort,
    false
  );
  assert.equal(
    g.checkAssistantRepetition([
      {
        ...base,
        input: { payload: { command: 'echo four', options: { timeout_ms: 1000 } } }
      }
    ]).abort,
    false
  );
});
