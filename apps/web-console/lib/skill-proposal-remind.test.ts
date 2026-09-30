import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRemindDraft } from './skill-proposal-remind.ts';

test('parseRemindDraft accepts whole numbers in range', () => {
  assert.equal(parseRemindDraft('0'), 0);
  assert.equal(parseRemindDraft(' 12 '), 12);
  assert.equal(parseRemindDraft('1000'), 1000);
});

test('parseRemindDraft rejects empty, fractional, negative and out-of-range input', () => {
  for (const bad of ['', '   ', '1.5', '-1', '1001', 'abc', '1e2']) {
    assert.equal(parseRemindDraft(bad), null, bad);
  }
});
