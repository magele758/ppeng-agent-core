import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOpenAiUsage,
  normalizeAnthropicUsage,
  isTruncatedFinish,
  mergeUsage
} from '../dist/model/usage.js';

test('normalizeOpenAiUsage: chat.completions shape', () => {
  const u = normalizeOpenAiUsage({
    prompt_tokens: 100,
    completion_tokens: 40,
    total_tokens: 140,
    prompt_tokens_details: { cached_tokens: 64 }
  });
  assert.deepEqual(u, {
    inputTokens: 100,
    outputTokens: 40,
    totalTokens: 140,
    cachedInputTokens: 64,
    requests: 1
  });
});

test('normalizeOpenAiUsage: responses shape (input_tokens/output_tokens)', () => {
  const u = normalizeOpenAiUsage({
    input_tokens: 200,
    output_tokens: 10,
    total_tokens: 210,
    input_tokens_details: { cached_tokens: 128 }
  });
  assert.equal(u.inputTokens, 200);
  assert.equal(u.outputTokens, 10);
  assert.equal(u.totalTokens, 210);
  assert.equal(u.cachedInputTokens, 128);
  assert.equal(u.requests, 1);
});

test('normalizeOpenAiUsage: derives total when provider omits it', () => {
  const u = normalizeOpenAiUsage({ prompt_tokens: 30, completion_tokens: 5 });
  assert.equal(u.totalTokens, 35);
});

test('normalizeOpenAiUsage: no cached field means no cachedInputTokens key', () => {
  const u = normalizeOpenAiUsage({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 });
  assert.equal('cachedInputTokens' in u, false);
});

test('normalizeOpenAiUsage: undefined / empty / non-object returns undefined', () => {
  assert.equal(normalizeOpenAiUsage(undefined), undefined);
  assert.equal(normalizeOpenAiUsage(null), undefined);
  assert.equal(normalizeOpenAiUsage({}), undefined);
  assert.equal(normalizeOpenAiUsage('nope'), undefined);
  assert.equal(normalizeOpenAiUsage(42), undefined);
});

test('normalizeOpenAiUsage: negative / non-finite counts clamp to 0', () => {
  const u = normalizeOpenAiUsage({ prompt_tokens: -5, completion_tokens: 'x', total_tokens: 0 });
  assert.equal(u.inputTokens, 0);
  assert.equal(u.outputTokens, 0);
  assert.equal(u.totalTokens, 0);
});

test('normalizeAnthropicUsage: folds cache_read into inputTokens', () => {
  const u = normalizeAnthropicUsage({
    input_tokens: 50,
    output_tokens: 20,
    cache_read_input_tokens: 200
  });
  // 50 base + 200 cache read = 250 input; cache exposed separately
  assert.equal(u.inputTokens, 250);
  assert.equal(u.outputTokens, 20);
  assert.equal(u.totalTokens, 270);
  assert.equal(u.cachedInputTokens, 200);
  assert.equal(u.requests, 1);
});

test('normalizeAnthropicUsage: includes cache_creation in inputTokens but not cached count', () => {
  const u = normalizeAnthropicUsage({
    input_tokens: 10,
    output_tokens: 5,
    cache_creation_input_tokens: 90
  });
  assert.equal(u.inputTokens, 100);
  assert.equal('cachedInputTokens' in u, false);
});

test('normalizeAnthropicUsage: undefined / empty returns undefined', () => {
  assert.equal(normalizeAnthropicUsage(undefined), undefined);
  assert.equal(normalizeAnthropicUsage({}), undefined);
});

test('isTruncatedFinish: recognizes length caps across providers', () => {
  assert.equal(isTruncatedFinish('length'), true); // OpenAI chat
  assert.equal(isTruncatedFinish('max_tokens'), true); // Anthropic
  assert.equal(isTruncatedFinish('max_output_tokens'), true); // Responses incomplete
  assert.equal(isTruncatedFinish('incomplete'), true);
  assert.equal(isTruncatedFinish('LENGTH'), true); // case-insensitive
});

test('isTruncatedFinish: clean stops are not truncation', () => {
  assert.equal(isTruncatedFinish('stop'), false);
  assert.equal(isTruncatedFinish('tool_calls'), false);
  assert.equal(isTruncatedFinish('end_turn'), false);
  assert.equal(isTruncatedFinish(undefined), false);
  assert.equal(isTruncatedFinish(null), false);
  assert.equal(isTruncatedFinish(''), false);
});

test('mergeUsage: sums counts and request count', () => {
  const a = { inputTokens: 100, outputTokens: 40, totalTokens: 140, cachedInputTokens: 64, requests: 1 };
  const b = { inputTokens: 10, outputTokens: 5, totalTokens: 15, requests: 1 };
  const m = mergeUsage(a, b);
  assert.deepEqual(m, {
    inputTokens: 110,
    outputTokens: 45,
    totalTokens: 155,
    cachedInputTokens: 64,
    requests: 2
  });
});

test('mergeUsage: handles undefined sides (session first turn)', () => {
  const b = { inputTokens: 10, outputTokens: 5, totalTokens: 15, requests: 1 };
  assert.deepEqual(mergeUsage(undefined, b), { ...b });
  assert.deepEqual(mergeUsage(b, undefined), { ...b });
  assert.equal(mergeUsage(undefined, undefined), undefined);
});

test('mergeUsage: returns copies (no mutation of inputs)', () => {
  const a = { inputTokens: 1, outputTokens: 1, totalTokens: 2, requests: 1 };
  const b = { inputTokens: 1, outputTokens: 1, totalTokens: 2, requests: 1 };
  const m = mergeUsage(a, b);
  m.inputTokens = 999;
  assert.equal(a.inputTokens, 1);
  assert.equal(b.inputTokens, 1);
});
