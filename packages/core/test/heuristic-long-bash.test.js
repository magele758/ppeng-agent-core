import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HeuristicModelAdapter,
  HEURISTIC_LONG_BASH_COMMAND,
  HEURISTIC_LONG_BASH_MARKER
} from '../dist/model/model-adapters.js';

function msg(id, role, parts) {
  return {
    id,
    sessionId: 's',
    role,
    parts,
    createdAt: '2026-09-02T00:00:00.000Z'
  };
}

test('heuristic fires long bash once, then replies with text', async () => {
  const adapter = new HeuristicModelAdapter();
  const user = msg('u1', 'user', [{ type: 'text', text: '跑一段长 bash dump' }]);
  const first = await adapter.runTurn({
    agent: { id: 'general', role: 'assistant', name: 'general' },
    systemPrompt: '',
    messages: [user],
    tools: []
  });
  assert.equal(first.stopReason, 'tool_use');
  assert.equal(first.assistantParts[0].name, 'bash');
  assert.equal(first.assistantParts[0].input.command, HEURISTIC_LONG_BASH_COMMAND);
  assert.match(HEURISTIC_LONG_BASH_COMMAND, new RegExp(HEURISTIC_LONG_BASH_MARKER));

  const afterTool = await adapter.runTurn({
    agent: { id: 'general', role: 'assistant', name: 'general' },
    systemPrompt: '',
    messages: [
      user,
      msg('a1', 'assistant', first.assistantParts),
      msg('t1', 'tool', [
        {
          type: 'tool_result',
          toolCallId: first.assistantParts[0].toolCallId,
          name: 'bash',
          ok: true,
          content: `${HEURISTIC_LONG_BASH_MARKER}${'x'.repeat(180)}`
        }
      ])
    ],
    tools: []
  });
  assert.equal(afterTool.stopReason, 'end');
  assert.ok(afterTool.assistantParts.some((p) => p.type === 'text' && p.text.includes('Heuristic')));
});
