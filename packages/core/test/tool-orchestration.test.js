import test from 'node:test';
import assert from 'node:assert/strict';
import {
  truncateToolContent,
  envToolResultMaxChars,
  partitionForParallel,
  findToolByName,
} from '../dist/tool-orchestration.js';

// ── truncateToolContent ──

test('truncateToolContent returns content unchanged when under limit', () => {
  assert.equal(truncateToolContent('hello', 10), 'hello');
});

test('truncateToolContent returns content unchanged at exact limit', () => {
  assert.equal(truncateToolContent('12345', 5), '12345');
});

test('truncateToolContent truncates and adds suffix when over limit', () => {
  const result = truncateToolContent('hello world', 5);
  assert.ok(result.startsWith('hello'));
  assert.ok(result.includes('truncated 6 chars'));
});

test('truncateToolContent handles empty string', () => {
  assert.equal(truncateToolContent('', 10), '');
});

test('truncateToolContent with maxChars=0 truncates everything', () => {
  const result = truncateToolContent('abc', 0);
  assert.ok(result.includes('truncated 3 chars'));
});

// ── envToolResultMaxChars ──

test('envToolResultMaxChars returns default 120000 when unset', () => {
  assert.equal(envToolResultMaxChars({}), 120_000);
});

test('envToolResultMaxChars reads from env', () => {
  assert.equal(envToolResultMaxChars({ RAW_AGENT_TOOL_RESULT_MAX_CHARS: '5000' }), 5000);
});

test('envToolResultMaxChars returns default for non-numeric', () => {
  assert.equal(envToolResultMaxChars({ RAW_AGENT_TOOL_RESULT_MAX_CHARS: 'abc' }), 120_000);
});

test('envToolResultMaxChars returns default for zero', () => {
  assert.equal(envToolResultMaxChars({ RAW_AGENT_TOOL_RESULT_MAX_CHARS: '0' }), 120_000);
});

test('envToolResultMaxChars returns default for negative', () => {
  assert.equal(envToolResultMaxChars({ RAW_AGENT_TOOL_RESULT_MAX_CHARS: '-100' }), 120_000);
});

test('envToolResultMaxChars floors floating point', () => {
  assert.equal(envToolResultMaxChars({ RAW_AGENT_TOOL_RESULT_MAX_CHARS: '99.7' }), 99);
});

// ── partitionForParallel ──

test('partitionForParallel splits into chunks', () => {
  const result = partitionForParallel([1, 2, 3, 4, 5], 2);
  assert.deepEqual(result, [[1, 2], [3, 4], [5]]);
});

test('partitionForParallel with maxParallel >= length returns single chunk', () => {
  const result = partitionForParallel([1, 2, 3], 5);
  assert.deepEqual(result, [[1, 2, 3]]);
});

test('partitionForParallel with maxParallel=1 returns individual chunks', () => {
  const result = partitionForParallel([1, 2, 3], 1);
  assert.deepEqual(result, [[1], [2], [3]]);
});

test('partitionForParallel handles empty array', () => {
  assert.deepEqual(partitionForParallel([], 3), []);
});

test('partitionForParallel clamps maxParallel=0 to 1', () => {
  const result = partitionForParallel([1, 2], 0);
  assert.deepEqual(result, [[1], [2]]);
});

test('partitionForParallel clamps negative maxParallel to 1', () => {
  const result = partitionForParallel([1, 2, 3], -5);
  assert.deepEqual(result, [[1], [2], [3]]);
});

// ── findToolByName ──

test('findToolByName returns matching tool', () => {
  const tools = [
    { name: 'read_file', description: '', parameters: {} },
    { name: 'write_file', description: '', parameters: {} },
  ];
  const found = findToolByName(tools, 'write_file');
  assert.ok(found);
  assert.equal(found.name, 'write_file');
});

test('findToolByName returns undefined for no match', () => {
  const tools = [{ name: 'read_file', description: '', parameters: {} }];
  assert.equal(findToolByName(tools, 'delete_file'), undefined);
});

test('findToolByName returns undefined for empty tools array', () => {
  assert.equal(findToolByName([], 'foo'), undefined);
});
