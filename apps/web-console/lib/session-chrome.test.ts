import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conversationElapsedMs,
  formatChatFeedStatsLine,
  formatCompactTokens,
  formatElapsedMs,
  hasRealUsageTotals,
  parseSessionChrome,
  parseSessionOutcome,
  parseUsageTotals
} from './session-chrome.ts';

test('parseUsageTotals reads normalized session totals only', () => {
  assert.equal(parseUsageTotals(undefined), undefined);
  assert.equal(parseUsageTotals({ prompt_tokens: 30_000, completion_tokens: 100 }), undefined);
  assert.deepEqual(parseUsageTotals({ inputTokens: 12400, outputTokens: 3100, totalTokens: 15500 }), {
    inputTokens: 12400,
    outputTokens: 3100,
    totalTokens: 15500
  });
  assert.equal(hasRealUsageTotals({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }), false);
  assert.equal(hasRealUsageTotals({ inputTokens: 12, outputTokens: 0 }), true);
});

test('parseSessionChrome keeps usageTotals and optional last-run duration', () => {
  const chrome = parseSessionChrome(
    {
      permissionMode: 'auto',
      usageTotals: { inputTokens: 800, outputTokens: 200, totalTokens: 1000 },
      usageCostUsd: 0.012,
      lastRunDurationMs: 83_000
    },
    'idle',
    { createdAt: '2026-09-03T12:00:00.000Z', updatedAt: '2026-09-03T12:01:23.000Z' }
  );
  assert.deepEqual(chrome.usageTotals, { inputTokens: 800, outputTokens: 200, totalTokens: 1000 });
  assert.equal(chrome.usageCostUsd, 0.012);
  assert.equal(chrome.lastRunDurationMs, 83_000);
  assert.equal(chrome.createdAt, '2026-09-03T12:00:00.000Z');
});

test('parseSessionOutcome reads run outcome from metadata', () => {
  assert.equal(parseSessionOutcome(undefined), undefined);
  assert.deepEqual(parseSessionOutcome({ kind: 'idle', reason: 'end' }), {
    kind: 'idle',
    reason: 'end'
  });
  assert.equal(parseSessionChrome({ outcome: { kind: 'idle', reason: 'end' } }, 'idle').outcome?.reason, 'end');
});

test('formatCompactTokens and formatElapsedMs match the feed footer', () => {
  assert.equal(formatCompactTokens(12_400), '12.4k');
  assert.equal(formatCompactTokens(3_100), '3.1k');
  assert.equal(formatCompactTokens(999), '999');
  assert.equal(formatCompactTokens(1_000), '1k');
  assert.equal(formatElapsedMs(83_000), '1m 23s');
  assert.equal(formatElapsedMs(5_000), '5s');
  assert.equal(formatElapsedMs(3_600_000), '1h');
});

test('conversationElapsedMs uses first user → last message, not session age alone', () => {
  const start = Date.parse('2026-09-03T12:00:00.000Z');
  const mid = Date.parse('2026-09-03T12:00:40.000Z');
  const end = Date.parse('2026-09-03T12:01:23.000Z');
  assert.equal(
    conversationElapsedMs({
      messages: [
        { role: 'user', createdAt: '2026-09-03T12:00:00.000Z' },
        { role: 'assistant', createdAt: '2026-09-03T12:01:23.000Z' }
      ]
    }),
    end - start
  );
  assert.equal(
    conversationElapsedMs({
      createdAt: '2026-09-03T12:00:00.000Z',
      updatedAt: '2026-09-03T12:00:40.000Z'
    }),
    mid - start
  );
  assert.equal(
    conversationElapsedMs({
      lastRunDurationMs: 83_000,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-03T12:00:00.000Z'
    }),
    83_000
  );
  const now = Date.parse('2026-09-03T12:02:00.000Z');
  assert.equal(
    conversationElapsedMs({
      messages: [{ role: 'user', createdAt: '2026-09-03T12:00:00.000Z' }],
      running: true,
      now
    }),
    now - start
  );
});

test('formatChatFeedStatsLine hides missing usage instead of fake zeros', () => {
  assert.equal(formatChatFeedStatsLine({}), null);
  assert.equal(formatChatFeedStatsLine({ usageTotals: { inputTokens: 0, outputTokens: 0 } }), null);
  assert.equal(
    formatChatFeedStatsLine({
      elapsedMs: 83_000,
      usageTotals: { inputTokens: 12_400, outputTokens: 3_100 },
      usageCostUsd: 0.012
    }),
    '执行 1m 23s · 输入 12.4k · 输出 3.1k · $0.012'
  );
  assert.equal(formatChatFeedStatsLine({ elapsedMs: 5_000 }), '执行 5s');
});
