import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAssistantParts,
  loadReasoningSpinWatchdogConfig,
  ReasoningSpinWatchdog,
  reasoningSpinWatchdogEnabled
} from '../dist/streaming/reasoning-spin-watchdog.js';

test('reasoningSpinWatchdogEnabled defaults on', () => {
  assert.equal(reasoningSpinWatchdogEnabled({}), true);
  assert.equal(reasoningSpinWatchdogEnabled({ RAW_AGENT_REASONING_SPIN_WATCHDOG: '0' }), false);
});

test('classify: tool call wins over everything', () => {
  assert.equal(
    classifyAssistantParts([
      { type: 'reasoning', text: 'thinking hard' },
      { type: 'tool_call', toolCallId: 'c1', name: 'bash', input: {} }
    ]),
    'tool'
  );
});

test('classify: text is progress', () => {
  assert.equal(
    classifyAssistantParts([
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'here is the answer' }
    ]),
    'message'
  );
});

test('classify: reasoning only', () => {
  assert.equal(classifyAssistantParts([{ type: 'reasoning', text: 'hmm' }]), 'reasoning_only');
});

test('classify: blank text is not progress', () => {
  assert.equal(classifyAssistantParts([{ type: 'text', text: '   \n' }]), 'empty');
  assert.equal(classifyAssistantParts([]), 'empty');
});

test('watchdog fires on the third consecutive no-progress turn', () => {
  const w = new ReasoningSpinWatchdog(loadReasoningSpinWatchdogConfig({}));
  assert.equal(w.note('reasoning_only'), null);
  assert.equal(w.note('empty'), null);
  const hit = w.note('reasoning_only');
  assert.ok(hit);
  assert.match(hit, /3 consecutive turns/);
  assert.equal(w.streak, 3);
});

test('progress resets the streak', () => {
  const w = new ReasoningSpinWatchdog(loadReasoningSpinWatchdogConfig({}));
  w.note('reasoning_only');
  w.note('reasoning_only');
  assert.equal(w.note('tool'), null);
  assert.equal(w.streak, 0);
  assert.equal(w.note('reasoning_only'), null, 'streak restarted from zero');
});

test('noteParts drives classification end to end', () => {
  const w = new ReasoningSpinWatchdog(loadReasoningSpinWatchdogConfig({ RAW_AGENT_REASONING_SPIN_MAX: '2' }));
  assert.equal(w.noteParts([{ type: 'reasoning', text: 'a' }]), null);
  assert.ok(w.noteParts([{ type: 'reasoning', text: 'b' }]));
});

test('reset clears the streak', () => {
  const w = new ReasoningSpinWatchdog(loadReasoningSpinWatchdogConfig({}));
  w.note('empty');
  w.reset();
  assert.equal(w.streak, 0);
});
