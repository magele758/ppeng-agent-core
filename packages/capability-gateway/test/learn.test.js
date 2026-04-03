import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDigestMarkdown, shouldRunDailyLearn } from '../dist/learn.js';

test('buildDigestMarkdown with new items', () => {
  const md = buildDigestMarkdown(
    '2025-01-15',
    [{ title: 'New A', link: 'https://a.com' }],
    [
      { title: 'Rolling 1', link: 'https://r1.com' },
      { title: 'Rolling 2', link: 'https://r2.com' },
    ],
  );
  assert.ok(md.includes('2025-01-15'));
  assert.ok(md.includes('[New A](https://a.com)'));
  assert.ok(md.includes('[Rolling 1](https://r1.com)'));
  assert.ok(md.includes('今日新收录'));
  assert.ok(md.includes('近期滚动窗口'));
});

test('buildDigestMarkdown with empty new items', () => {
  const md = buildDigestMarkdown('2025-01-15', [], []);
  assert.ok(md.includes('今日 RSS 无新条目'));
  assert.ok(md.includes('暂无'));
});

test('buildDigestMarkdown has SKILL.md frontmatter', () => {
  const md = buildDigestMarkdown('2025-01-15', [], []);
  assert.ok(md.startsWith('---'));
  assert.ok(md.includes('name: Agent Tech Digest'));
  assert.ok(md.includes('description:'));
});

test('shouldRunDailyLearn returns false if already ran today', () => {
  const now = new Date('2025-03-10T10:00:00Z');
  const state = { seenLinks: [], rollingItems: [], lastLearnRunDateUtc: '2025-03-10' };
  assert.equal(shouldRunDailyLearn(state, 6, now), false);
});

test('shouldRunDailyLearn returns true when past scheduled hour', () => {
  const now = new Date('2025-03-10T08:00:00Z');
  const state = { seenLinks: [], rollingItems: [], lastLearnRunDateUtc: '2025-03-09' };
  assert.equal(shouldRunDailyLearn(state, 6, now), true);
});

test('shouldRunDailyLearn returns false before scheduled hour', () => {
  const now = new Date('2025-03-10T04:00:00Z');
  const state = { seenLinks: [], rollingItems: [], lastLearnRunDateUtc: '2025-03-09' };
  assert.equal(shouldRunDailyLearn(state, 6, now), false);
});

test('shouldRunDailyLearn returns true with empty state', () => {
  const now = new Date('2025-03-10T12:00:00Z');
  const state = { seenLinks: [], rollingItems: [], lastLearnRunDateUtc: '' };
  assert.equal(shouldRunDailyLearn(state, 6, now), true);
});
