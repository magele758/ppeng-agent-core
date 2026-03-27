import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/index.js';
import { ScriptedAdapter } from './_scripted-adapter.mjs';

const repoRoot = mkdtempSync(join(tmpdir(), 'ppeng-agent-repo-'));
const stateDir = mkdtempSync(join(tmpdir(), 'ppeng-agent-state-'));

const runtime = new RawAgentRuntime({
  repoRoot,
  stateDir,
  modelAdapter: new ScriptedAdapter((input) => {
    const subResult = input.messages
      .flatMap((m) => m.parts)
      .find((p) => p.type === 'tool_result' && p.name === 'spawn_subagent');

    if (!subResult) {
      return {
        stopReason: 'tool_use',
        assistantParts: [
          {
            type: 'tool_call',
            toolCallId: 'sub1',
            name: 'spawn_subagent',
            input: { prompt: 'Reply with exactly: subagent-ok', role: 'research' }
          }
        ]
      };
    }

    return {
      stopReason: 'end',
      assistantParts: [{ type: 'text', text: `Parent sees: ${subResult.content}` }]
    };
  })
});

const session = runtime.createChatSession({
  title: 'Subagent demo',
  message: 'Delegate to subagent'
});

await runtime.runSession(session.id);
console.log(runtime.getLatestAssistantText(session.id));
