import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelStopReason, isToolUseFinish } from '../dist/model/stop-reason.js';

test('parsed tool_calls win over finish_reason=stop', () => {
  assert.equal(resolveModelStopReason('stop', 1), 'tool_use');
  assert.equal(resolveModelStopReason('end_turn', 2), 'tool_use');
  assert.equal(resolveModelStopReason('stop_sequence', 1), 'tool_use');
  assert.equal(resolveModelStopReason(undefined, 1), 'tool_use');
});

test('no tools + stop is a real end', () => {
  assert.equal(resolveModelStopReason('stop', 0), 'end');
  assert.equal(resolveModelStopReason('end_turn', 0), 'end');
  assert.equal(resolveModelStopReason(undefined, 0), 'end');
});

test('claimed tool finish without parsed calls is still tool_use', () => {
  assert.equal(resolveModelStopReason('tool_calls', 0), 'tool_use');
  assert.equal(resolveModelStopReason('tool-calls', 0), 'tool_use');
  assert.equal(resolveModelStopReason('tool_use', 0), 'tool_use');
  assert.equal(resolveModelStopReason('tool-use', 0), 'tool_use');
  assert.equal(resolveModelStopReason('function_call', 0), 'tool_use');
});

test('isToolUseFinish covers hyphenated AI SDK short codes', () => {
  assert.equal(isToolUseFinish('tool-calls'), true);
  assert.equal(isToolUseFinish('STOP'), false);
});
