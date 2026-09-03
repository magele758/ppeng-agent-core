import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatToolInput,
  hasVisibleStructuredParts,
  indexResolvedToolCallIds,
  indexToolCalls,
  previewToolInput
} from './tool-io.ts';
import type { ChatMessage } from './types.ts';

test('formatToolInput prefers bash command', () => {
  assert.equal(formatToolInput({ command: 'curl wttr.in/Hangzhou' }), 'curl wttr.in/Hangzhou');
  assert.equal(formatToolInput({ query: '杭州天气' }), '杭州天气');
  assert.equal(
    formatToolInput({ foo: 1, bar: 2 }),
    JSON.stringify({ foo: 1, bar: 2 }, null, 2)
  );
});

test('previewToolInput collapses whitespace and truncates', () => {
  assert.equal(previewToolInput({ command: 'echo  hi' }), 'echo hi');
  assert.equal(previewToolInput({ command: 'x'.repeat(80) }).endsWith('…'), true);
});

test('pairs historical result by name when toolCallId is missing', () => {
  const messages = [
    {
      role: 'assistant',
      parts: [{ type: 'tool_call', toolCallId: 'old-1', name: 'bash', input: { command: 'ls' } }]
    },
    {
      role: 'tool',
      parts: [{ type: 'tool_result', toolCallId: '', name: 'bash', content: 'ok', ok: true }]
    }
  ] as ChatMessage[];
  const calls = indexToolCalls(messages);
  assert.deepEqual(calls.get('m1p0')?.input, { command: 'ls' });
  assert.equal(indexResolvedToolCallIds(messages).has('old-1'), true);
});

test('index pairs tool_call with later tool_result', () => {
  const messages = [
    {
      role: 'assistant',
      parts: [{ type: 'tool_call', toolCallId: 'c1', name: 'bash', input: { command: 'ls' } }]
    },
    {
      role: 'tool',
      parts: [{ type: 'tool_result', toolCallId: 'c1', name: 'bash', content: 'ok', ok: true }]
    }
  ] as ChatMessage[];
  assert.equal(indexToolCalls(messages).get('c1')?.name, 'bash');
  assert.equal(indexResolvedToolCallIds(messages).has('c1'), true);
  assert.equal(
    hasVisibleStructuredParts(messages[0]!.parts, indexResolvedToolCallIds(messages)),
    false
  );
  assert.equal(
    hasVisibleStructuredParts(messages[1]!.parts, indexResolvedToolCallIds(messages)),
    true
  );
});
