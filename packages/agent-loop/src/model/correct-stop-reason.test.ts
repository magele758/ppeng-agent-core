import { describe, it, expect } from 'vitest';
import { correctWrongStopSignal } from './correct-stop-reason.js';

describe('model/correct-stop-reason', () => {
  it('corrects false stop when parsed tool calls exist', () => {
    expect(
      correctWrongStopSignal({
        stopReason: 'end',
        finishReason: 'stop',
        toolCallCount: 2
      })
    ).toEqual({ stopReason: 'tool_use', corrected: true });
  });

  it('does not correct when stopReason is already tool_use', () => {
    expect(
      correctWrongStopSignal({
        stopReason: 'tool_use',
        finishReason: 'stop',
        toolCallCount: 1
      })
    ).toEqual({ stopReason: 'tool_use', corrected: false });
  });

  it('does not correct a finish_reason=tool_calls with zero parsed calls', () => {
    expect(
      correctWrongStopSignal({
        stopReason: 'end',
        finishReason: 'tool_calls',
        toolCallCount: 0
      })
    ).toEqual({ stopReason: 'end', corrected: false });
  });

  it('does not correct a genuine end', () => {
    expect(
      correctWrongStopSignal({
        stopReason: 'end',
        finishReason: 'stop',
        toolCallCount: 0
      })
    ).toEqual({ stopReason: 'end', corrected: false });
  });

  it('preserves a non-end stopReason when not correcting', () => {
    expect(
      correctWrongStopSignal({
        stopReason: 'max_tokens',
        finishReason: 'length',
        toolCallCount: 0
      })
    ).toEqual({ stopReason: 'max_tokens', corrected: false });
  });
});
