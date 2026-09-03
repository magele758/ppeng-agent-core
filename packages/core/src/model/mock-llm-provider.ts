/**
 * Scripted / mock LLM for in-process E2E (absorbed from ai-agent-node ScriptedAdapter).
 * Deterministic: no network, no heuristic keyword matching.
 */

import type {
  MessagePart,
  ModelAdapter,
  ModelStreamChunk,
  ModelTurnInput,
  ModelTurnResult,
  TextCompletionInput
} from '../types.js';

export type MockLlmToolCall = {
  name: string;
  input?: unknown;
  toolCallId?: string;
};

export type MockLlmTurn =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; calls: MockLlmToolCall[] }
  | { type: 'error'; message: string }
  | {
      type: 'fn';
      fn: (input: ModelTurnInput, n: number) => ModelTurnResult | Promise<ModelTurnResult>;
    };

export type MockLlmScript =
  | readonly MockLlmTurn[]
  | ((input: ModelTurnInput, n: number) => ModelTurnResult | Promise<ModelTurnResult>);

export function mockText(text: string): MockLlmTurn {
  return { type: 'text', text };
}

export function mockToolUse(...calls: MockLlmToolCall[]): MockLlmTurn {
  return { type: 'tool_use', calls };
}

export function mockLlmError(message: string): MockLlmTurn {
  return { type: 'error', message };
}

export function turnToResult(turn: MockLlmTurn, input: ModelTurnInput, n: number): Promise<ModelTurnResult> {
  if (turn.type === 'fn') return Promise.resolve(turn.fn(input, n));
  if (turn.type === 'error') return Promise.reject(new Error(turn.message));
  if (turn.type === 'text') {
    return Promise.resolve({
      stopReason: 'end',
      assistantParts: [{ type: 'text', text: turn.text }]
    });
  }
  const assistantParts: MessagePart[] = turn.calls.map((c, i) => ({
    type: 'tool_call',
    toolCallId: c.toolCallId ?? `mock_call_${n}_${i + 1}`,
    name: c.name,
    input: (c.input && typeof c.input === 'object' ? c.input : {}) as Record<string, unknown>
  }));
  return Promise.resolve({ stopReason: 'tool_use', assistantParts });
}

export class MockLlmProvider implements ModelAdapter {
  readonly name = 'mock-llm';
  readonly calls: ModelTurnInput[] = [];
  private cursor = 0;

  constructor(private readonly script: MockLlmScript) {}

  async runTurn(input: ModelTurnInput): Promise<ModelTurnResult> {
    this.calls.push(input);
    const n = this.calls.length;
    if (typeof this.script === 'function') {
      return this.script(input, n);
    }
    const turn = this.script[this.cursor];
    if (!turn) {
      throw new Error(`MockLlmProvider: no scripted turn #${n} (script length ${this.script.length})`);
    }
    this.cursor += 1;
    return turnToResult(turn, input, n);
  }

  async runTurnStream(
    input: ModelTurnInput,
    onChunk: (chunk: ModelStreamChunk) => void
  ): Promise<ModelTurnResult> {
    const result = await this.runTurn(input);
    for (const part of result.assistantParts) {
      if (part.type === 'text' && part.text) {
        onChunk({ type: 'text_delta', text: part.text });
      } else if (part.type === 'tool_call') {
        onChunk({ type: 'tool_call_start', toolCallId: part.toolCallId, name: part.name });
      }
    }
    return result;
  }

  async summarizeMessages(): Promise<string> {
    return 'mock-llm summary';
  }

  async completeText(input: TextCompletionInput): Promise<string> {
    void input;
    return JSON.stringify({ met: false, reason: 'mock-llm: no judge' });
  }

  remainingTurns(): number {
    if (typeof this.script === 'function') return Number.POSITIVE_INFINITY;
    return Math.max(0, this.script.length - this.cursor);
  }
}

export function createMockLlm(script: MockLlmScript): MockLlmProvider {
  return new MockLlmProvider(script);
}
