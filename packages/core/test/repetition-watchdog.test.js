import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectRepetitionLoop,
  isRepetitionAbort,
  loadRepetitionWatchdogConfig,
  RepetitionLoopAbortError,
  repetitionWatchdogEnabled,
  RepetitionStreamGuard
} from '../dist/streaming/repetition-watchdog.js';

test('repetitionWatchdogEnabled defaults on', () => {
  assert.equal(repetitionWatchdogEnabled({}), true);
  assert.equal(repetitionWatchdogEnabled({ RAW_AGENT_STREAM_WATCHDOG: '0' }), false);
});

test('short text is never flagged', () => {
  assert.equal(detectRepetitionLoop('好的好的好的'), null);
  assert.equal(detectRepetitionLoop(''), null);
});

test('single-char run-length degeneration is caught', () => {
  const text = `${'prefix text that is long enough to pass the floor. '.repeat(2)}${'x'.repeat(80)}`;
  const hit = detectRepetitionLoop(text);
  assert.ok(hit, 'expected a hit');
  assert.match(hit, /repeated 80 times/);
});

test('short n-gram spam is caught', () => {
  const hit = detectRepetitionLoop('覆盖'.repeat(200));
  assert.ok(hit, 'expected a hit');
  assert.match(hit, /覆盖/);
});

test('normal prose is not flagged', () => {
  const prose =
    'The runtime aggregates token usage per turn and estimates cost from a coarse pricing table. ' +
    'Truncated turns keep stopReason=end, so the truncated flag is the only reliable signal. ' +
    'Micro-compaction shrinks stale tool results every turn instead of waiting for a threshold.';
  assert.equal(detectRepetitionLoop(prose), null);
});

test('whitespace runs are allowlisted', () => {
  const text = `${'meaningful content that clears the minimum length floor here. '.repeat(2)}${'\n'.repeat(200)}`;
  assert.equal(detectRepetitionLoop(text), null);
});

test('markdown horizontal rules are not flagged', () => {
  // A long '---' rule is legitimate output; the min-repeats + ratio gates cover it
  // only if the rule does not dominate the whole tail window.
  const text = `Some analysis text long enough to pass the floor here, plus a rule:\n${'-'.repeat(20)}\nmore text after the rule that keeps the tail window mixed.`;
  assert.equal(detectRepetitionLoop(text), null);
});

test('env overrides thresholds', () => {
  const config = loadRepetitionWatchdogConfig({
    RAW_AGENT_STREAM_WATCHDOG_CHAR_RUN: '5',
    RAW_AGENT_STREAM_WATCHDOG_MIN_LEN: '10'
  });
  assert.equal(config.charRunThreshold, 5);
  assert.equal(config.minTotalLen, 10);
  assert.ok(detectRepetitionLoop(`abcdefghij${'z'.repeat(9)}`, config));
});

test('RepetitionStreamGuard accumulates and fires', () => {
  const guard = new RepetitionStreamGuard(loadRepetitionWatchdogConfig({}), 1);
  let hit = null;
  for (let i = 0; i < 300 && !hit; i += 1) {
    hit = guard.push('覆盖');
  }
  assert.ok(hit, 'guard should fire on sustained repetition');
  assert.ok(guard.text.length > 0);
});

test('RepetitionStreamGuard stays quiet on varied deltas', () => {
  const guard = new RepetitionStreamGuard(loadRepetitionWatchdogConfig({}), 1);
  const words = ['alpha ', 'beta ', 'gamma ', 'delta ', 'epsilon '];
  for (let i = 0; i < 100; i += 1) {
    assert.equal(guard.push(words[i % words.length]), null);
  }
});

test('isRepetitionAbort discriminates', () => {
  assert.equal(isRepetitionAbort(new RepetitionLoopAbortError('r')), true);
  assert.equal(isRepetitionAbort(new Error('boom')), false);
  assert.equal(new RepetitionLoopAbortError('why').reason, 'why');
});
