import { describe, expect, it } from 'vitest';
import { createAssembledLoop } from './create-assembled-loop.js';
import { createDefaultMemoryStore, DEFAULT_EMBED_AGENT } from './store-adapter.js';
import { shellHistoryFromFold } from '../tools/shell-policy.js';
import type { ModelAdapter, ModelTurnResult, ToolContract } from '../types.js';

function stubAdapter(impl: () => ModelTurnResult | Promise<ModelTurnResult>): ModelAdapter {
  return {
    name: 'stub',
    async runTurn() {
      return impl();
    },
    async summarizeMessages() {
      return 'summary';
    },
  };
}

describe('max-host', () => {
  it('feeds bash history from the fold into shell-policy', async () => {
    const { store, surface } = createDefaultMemoryStore({ agent: DEFAULT_EMBED_AGENT });
    const session = surface.createSession({
      title: 't',
      mode: 'chat',
      agentId: DEFAULT_EMBED_AGENT.id,
    });
    surface.appendMessage(session.id, 'user', [{ type: 'text', text: 'hi' }]);
    for (let i = 0; i < 8; i += 1) {
      surface.appendMessage(session.id, 'assistant', [
        {
          type: 'tool_call',
          toolCallId: `ls-${i}`,
          name: 'bash',
          input: { command: `ls src ${i}` },
        },
      ]);
      surface.appendMessage(session.id, 'tool', [
        {
          type: 'tool_result',
          toolCallId: `ls-${i}`,
          name: 'bash',
          ok: true,
          content: 'ok',
        },
      ]);
    }

    const history = shellHistoryFromFold(store.foldMessages(session.id));
    expect(history.length).toBe(8);

    const bash: ToolContract<Record<string, unknown>> = {
      name: 'bash',
      description: 'bash',
      inputSchema: {},
      approvalMode: 'never',
      sideEffectLevel: 'workspace',
      execute: async () => ({ ok: true, content: 'ran' }),
    };
    let calls = 0;
    const assembled = await createAssembledLoop({
      preset: 'max',
      io: {
        store,
        tools: [bash],
        model: stubAdapter(() => {
          calls += 1;
          if (calls === 1) {
            return {
              stopReason: 'tool_use',
              assistantParts: [
                {
                  type: 'tool_call',
                  toolCallId: 'ls-new',
                  name: 'bash',
                  input: { command: 'ls src extra' },
                },
              ],
            };
          }
          return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'done' }] };
        }),
      },
    });
    await assembled.run(session.id);
    const fold = store.foldMessages(session.id);
    const blocked = fold.some((m) =>
      m.parts.some(
        (p) =>
          p.type === 'tool_result' &&
          typeof p.content === 'string' &&
          p.content.includes('Directory browse limit')
      )
    );
    expect(blocked).toBe(true);
  });
});
