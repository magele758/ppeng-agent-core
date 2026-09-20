import { describe, it, expect } from 'vitest';
import type { MessagePart, SessionMessage } from '../types.js';
import {
  UNPAIRED_TOOL_RESULT_CONTENT,
  unmatchedToolCallsFromMessages,
  syntheticUnpairedToolResultParts,
  pairUnmatchedToolCalls,
  ensureFoldToolCallsPaired,
} from './pair-unmatched-tool-calls.js';

function msg(
  role: SessionMessage['role'],
  parts: MessagePart[],
  extras?: Partial<SessionMessage>
): SessionMessage {
  return {
    id: extras?.id ?? `m-${role}`,
    sessionId: extras?.sessionId ?? 's1',
    role,
    parts,
    createdAt: extras?.createdAt ?? '2026-01-01T00:00:00.000Z',
    ...extras,
  };
}

function toolCall(toolCallId: string, name: string, input: Record<string, unknown> = {}): MessagePart {
  return { type: 'tool_call', toolCallId, name, input };
}

function toolResult(toolCallId: string, name: string, ok = true): MessagePart {
  return { type: 'tool_result', toolCallId, name, ok, content: ok ? 'ok' : 'fail' };
}

describe('recovery/pair-unmatched-tool-calls', () => {
  it('pairs unmatched tool_call (empty name becomes unknown)', () => {
    const messages = [
      msg('user', [{ type: 'text', text: 'hi' }]),
      msg('assistant', [toolCall('call_orphan', '')]),
    ];

    const unmatched = unmatchedToolCallsFromMessages(messages);
    expect(unmatched).toEqual([{ toolCallId: 'call_orphan', name: 'unknown' }]);

    const parts = syntheticUnpairedToolResultParts(unmatched);
    expect(parts).toEqual([
      {
        type: 'tool_result',
        toolCallId: 'call_orphan',
        name: 'unknown',
        ok: false,
        content: UNPAIRED_TOOL_RESULT_CONTENT,
      },
    ]);
    expect(JSON.parse(UNPAIRED_TOOL_RESULT_CONTENT).error).toBe('tool_result_missing');

    const paired = pairUnmatchedToolCalls(messages);
    expect(paired.paired).toBe(1);
    expect(paired.parts).toEqual(parts);
    expect(paired.messages).toHaveLength(3);
    expect(paired.messages[2]).toMatchObject({
      role: 'tool',
      parts,
    });
    expect(paired.messages[2]!.id.startsWith('paired-')).toBe(true);
  });

  it('already paired is a no-op and keeps the original messages reference', () => {
    const messages = [
      msg('assistant', [toolCall('c1', 'web_search')]),
      msg('tool', [toolResult('c1', 'web_search')]),
    ];
    expect(unmatchedToolCallsFromMessages(messages)).toEqual([]);

    const result = pairUnmatchedToolCalls(messages);
    expect(result.paired).toBe(0);
    expect(result.parts).toEqual([]);
    expect(result.messages).toBe(messages);
  });

  it('ensureFoldToolCallsPaired appends synthetic results then is idempotent', () => {
    const fold: SessionMessage[] = [msg('assistant', [toolCall('c1', 'web_search')])];
    const store = {
      foldMessages: () => fold,
      appendMessage: (_role: SessionMessage['role'], parts: MessagePart[]) => {
        fold.push(msg('tool', parts, { id: 'paired-c1' }));
      },
    };

    expect(ensureFoldToolCallsPaired(store)).toBe(1);
    expect(ensureFoldToolCallsPaired(store)).toBe(0);
    expect(fold.some((m) => m.parts.some((p) => p.type === 'tool_result' && p.toolCallId === 'c1'))).toBe(
      true
    );
  });

  it('ensureFoldToolCallsPaired no-ops when store or methods are missing', () => {
    expect(ensureFoldToolCallsPaired(undefined)).toBe(0);
    expect(ensureFoldToolCallsPaired({})).toBe(0);
    expect(ensureFoldToolCallsPaired({ foldMessages: () => [] })).toBe(0);
  });
});
