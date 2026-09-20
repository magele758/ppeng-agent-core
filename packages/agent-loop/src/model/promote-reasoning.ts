/**
 * Promote gateway reasoning into visible text when the assistant body is empty.
 * Absorbed from ai-agent-node model adapter; kernel applies it after each model result.
 */

import { TOOL_CALL_LEAK_RE } from '../turn/turn-recovery.js';
import type { MessagePart } from '../types.js';

export function promoteReasoningToTextIfNeeded(input: {
  text: string;
  reasoning: string;
  toolCallCount: number;
}): { text: string; promoted: boolean } {
  if (input.text.trim() || input.toolCallCount > 0) {
    return { text: input.text, promoted: false };
  }
  const reasoning = input.reasoning.trim();
  if (!reasoning) return { text: input.text, promoted: false };
  if (TOOL_CALL_LEAK_RE.test(reasoning)) {
    return { text: input.text, promoted: false };
  }
  return { text: reasoning, promoted: true };
}

export function promoteAssistantReasoning(parts: MessagePart[]): {
  parts: MessagePart[];
  promoted: boolean;
} {
  const text = parts
    .filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');
  const reasoning = parts
    .filter((p): p is Extract<MessagePart, { type: 'reasoning' }> => p.type === 'reasoning')
    .map((p) => p.text)
    .join('');
  const toolCallCount = parts.filter((p) => p.type === 'tool_call').length;
  const result = promoteReasoningToTextIfNeeded({ text, reasoning, toolCallCount });
  if (!result.promoted) return { parts, promoted: false };

  const withoutReasoning = parts.filter((p) => p.type !== 'reasoning');
  const next = withoutReasoning.some((p) => p.type === 'text')
    ? withoutReasoning.map((p) =>
        p.type === 'text' && !p.text.trim() ? { ...p, text: result.text } : p
      )
    : [{ type: 'text' as const, text: result.text }, ...withoutReasoning];
  return { parts: next, promoted: true };
}
