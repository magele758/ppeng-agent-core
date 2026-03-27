import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateMessageTokens, estimateTokensFromText } from '../dist/token-estimate.js';

test('estimateTokensFromText is positive for non-empty', () => {
  assert.ok(estimateTokensFromText('abcd') >= 1);
});

test('estimateMessageTokens sums roles and parts', () => {
  const n = estimateMessageTokens([
    {
      role: 'user',
      parts: [{ type: 'text', text: 'hello world' }]
    }
  ]);
  assert.ok(n > 4);
});
