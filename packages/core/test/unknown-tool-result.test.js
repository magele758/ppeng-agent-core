import test from 'node:test';
import assert from 'node:assert/strict';
import { findSimilarToolName } from '../dist/recovery/find-similar-tool-name.js';
import { buildUnknownToolResultContent } from '../dist/recovery/unknown-tool-result.js';

test('findSimilarToolName: exact after normalize', () => {
  assert.equal(findSimilarToolName('Read_File', ['read_file', 'bash']), 'read_file');
});

test('findSimilarToolName: typo within threshold', () => {
  assert.equal(findSimilarToolName('basah', ['bash', 'read_file']), 'bash');
});

test('findSimilarToolName: far name → null', () => {
  assert.equal(findSimilarToolName('zzzzzzzz', ['bash', 'read_file']), null);
});

test('buildUnknownToolResultContent: structured JSON with did_you_mean', () => {
  const raw = buildUnknownToolResultContent('basah', ['bash', 'read_file', 'write_file']);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.error_code, 'UNKNOWN_TOOL');
  assert.match(parsed.error, /basah/);
  assert.equal(parsed.did_you_mean, 'bash');
  assert.ok(parsed.available_tools_sample.includes('bash'));
  assert.ok(typeof parsed.hint === 'string' && parsed.hint.length > 0);
});
