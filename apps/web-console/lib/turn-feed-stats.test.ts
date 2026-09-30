import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTurnFeedStats,
  extractModelTurnWindows,
  formatTurnFeedStatsLine,
  sliceConversationTurns
} from './turn-feed-stats.ts';

test('sliceConversationTurns groups user→assistant(+tools) cycles', () => {
  const slices = sliceConversationTurns([
    { role: 'system', createdAt: '2026-09-03T12:00:00.000Z' },
    { role: 'user', createdAt: '2026-09-03T12:00:01.000Z' },
    { role: 'assistant', createdAt: '2026-09-03T12:00:02.000Z' },
    { role: 'tool', createdAt: '2026-09-03T12:00:03.000Z' },
    { role: 'assistant', createdAt: '2026-09-03T12:00:04.000Z' },
    { role: 'user', createdAt: '2026-09-03T12:01:00.000Z' },
    { role: 'assistant', createdAt: '2026-09-03T12:01:05.000Z' }
  ]);
  assert.deepEqual(slices, [
    { userIndex: 1, startIndex: 1, endIndex: 4 },
    { userIndex: 5, startIndex: 5, endIndex: 6 }
  ]);
});

test('extractModelTurnWindows pairs start/end and reads usage', () => {
  const windows = extractModelTurnWindows([
    { kind: 'turn_start', ts: '2026-09-03T12:00:01.000Z' },
    {
      kind: 'turn_end',
      ts: '2026-09-03T12:00:05.000Z',
      payload: { usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }, costUsd: 0.01 }
    },
    { kind: 'turn_start', ts: '2026-09-03T12:00:06.000Z' },
    {
      kind: 'turn_end',
      ts: '2026-09-03T12:00:10.000Z',
      payload: { usage: { inputTokens: 200, outputTokens: 30, totalTokens: 230 }, costUsd: 0.02 }
    }
  ]);
  assert.equal(windows.length, 2);
  assert.equal(windows[0]!.usage?.inputTokens, 100);
  assert.equal(windows[1]!.costUsd, 0.02);
});

test('buildTurnFeedStats sums model turns inside one user cycle', () => {
  const messages = [
    { role: 'user', createdAt: '2026-09-03T12:00:00.000Z' },
    { role: 'assistant', createdAt: '2026-09-03T12:00:05.000Z' },
    { role: 'tool', createdAt: '2026-09-03T12:00:06.000Z' },
    { role: 'assistant', createdAt: '2026-09-03T12:00:10.000Z' },
    { role: 'user', createdAt: '2026-09-03T12:01:00.000Z' },
    { role: 'assistant', createdAt: '2026-09-03T12:01:03.000Z' }
  ];
  const traces = [
    { kind: 'turn_start', ts: '2026-09-03T12:00:01.000Z' },
    {
      kind: 'turn_end',
      ts: '2026-09-03T12:00:05.000Z',
      payload: { usage: { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 }, costUsd: 0.01 }
    },
    { kind: 'turn_start', ts: '2026-09-03T12:00:06.000Z' },
    {
      kind: 'turn_end',
      ts: '2026-09-03T12:00:10.000Z',
      payload: { usage: { inputTokens: 2000, outputTokens: 50, totalTokens: 2050 }, costUsd: 0.02 }
    },
    { kind: 'turn_start', ts: '2026-09-03T12:01:01.000Z' },
    {
      kind: 'turn_end',
      ts: '2026-09-03T12:01:03.000Z',
      payload: { usage: { inputTokens: 500, outputTokens: 40, totalTokens: 540 }, costUsd: 0.005 }
    }
  ];
  const stats = buildTurnFeedStats({ messages, traces });
  assert.equal(stats.length, 2);
  assert.deepEqual(stats[0]?.usageTotals, {
    inputTokens: 3000,
    outputTokens: 150,
    totalTokens: 3150
  });
  assert.equal(stats[0]?.usageCostUsd, 0.03);
  assert.equal(stats[0]?.elapsedMs, 9_000);
  assert.deepEqual(stats[1]?.usageTotals, {
    inputTokens: 500,
    outputTokens: 40,
    totalTokens: 540
  });
  assert.equal(stats[1]?.elapsedMs, 2_000);
});

test('buildTurnFeedStats falls back to message timestamps without traces', () => {
  const stats = buildTurnFeedStats({
    messages: [
      { role: 'user', createdAt: '2026-09-03T12:00:00.000Z' },
      { role: 'assistant', createdAt: '2026-09-03T12:00:40.000Z' }
    ]
  });
  assert.equal(stats[0]?.elapsedMs, 40_000);
  assert.equal(stats[0]?.usageTotals, undefined);
});

test('buildTurnFeedStats returns null when a turn has no timing or usage', () => {
  const stats = buildTurnFeedStats({
    messages: [{ role: 'user' }, { role: 'assistant' }]
  });
  assert.equal(stats[0], null);
});

test('buildTurnFeedStats live tail extends elapsed to now', () => {
  const now = Date.parse('2026-09-03T12:00:30.000Z');
  const stats = buildTurnFeedStats({
    messages: [{ role: 'user', createdAt: '2026-09-03T12:00:00.000Z' }],
    traces: [{ kind: 'turn_start', ts: '2026-09-03T12:00:01.000Z' }],
    running: true,
    now
  });
  assert.equal(stats[0]?.elapsedMs, 29_000);
});

test('formatTurnFeedStatsLine reuses feed footer formatting', () => {
  assert.equal(
    formatTurnFeedStatsLine({
      elapsedMs: 83_000,
      usageTotals: { inputTokens: 12_400, outputTokens: 3_100 },
      usageCostUsd: 0.012
    }),
    '执行 1m 23s · 输入 12.4k · 输出 3.1k · $0.012'
  );
  assert.equal(formatTurnFeedStatsLine(null), null);
});
