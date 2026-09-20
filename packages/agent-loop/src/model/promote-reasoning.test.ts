import { describe, expect, it } from 'vitest';
import {
  promoteAssistantReasoning,
  promoteReasoningToTextIfNeeded,
} from './promote-reasoning.js';

describe('promoteReasoningToTextIfNeeded', () => {
  it('promotes reasoning when text is empty and there are no tool calls', () => {
    expect(
      promoteReasoningToTextIfNeeded({
        text: '  ',
        reasoning: 'visible answer',
        toolCallCount: 0,
      })
    ).toEqual({ text: 'visible answer', promoted: true });
  });

  it('does not promote when text already exists', () => {
    expect(
      promoteReasoningToTextIfNeeded({
        text: 'hi',
        reasoning: 'think',
        toolCallCount: 0,
      })
    ).toEqual({ text: 'hi', promoted: false });
  });

  it('does not promote when tool calls are present', () => {
    expect(
      promoteReasoningToTextIfNeeded({
        text: '',
        reasoning: 'think',
        toolCallCount: 1,
      })
    ).toEqual({ text: '', promoted: false });
  });

  it('does not promote leaked tool-call markup in reasoning', () => {
    expect(
      promoteReasoningToTextIfNeeded({
        text: '',
        reasoning: '<invoke name="bash">rm</invoke>',
        toolCallCount: 0,
      }).promoted
    ).toBe(false);
  });
});

describe('promoteAssistantReasoning', () => {
  it('inserts a text part from reasoning', () => {
    const out = promoteAssistantReasoning([{ type: 'reasoning', text: 'the answer' }]);
    expect(out.promoted).toBe(true);
    expect(out.parts).toEqual([{ type: 'text', text: 'the answer' }]);
  });

  it('leaves leaked reasoning in place', () => {
    const parts = [{ type: 'reasoning' as const, text: '<tool_calls></tool_calls>' }];
    const out = promoteAssistantReasoning(parts);
    expect(out.promoted).toBe(false);
    expect(out.parts).toEqual(parts);
  });
});
