import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/index.js';
import { ScriptedAdapter } from './_scripted-adapter.mjs';

const TEAMMATE_ID = 'demo-helper';

const repoRoot = mkdtempSync(join(tmpdir(), 'ppeng-agent-repo-'));
const stateDir = mkdtempSync(join(tmpdir(), 'ppeng-agent-state-'));

const runtime = new RawAgentRuntime({
  repoRoot,
  stateDir,
  modelAdapter: new ScriptedAdapter((input) => {
    if (input.agent.id === TEAMMATE_ID) {
      return {
        stopReason: 'end',
        assistantParts: [{ type: 'text', text: 'Teammate finished a scheduler tick.' }]
      };
    }

    const spawned = input.messages.some((m) =>
      m.parts.some((p) => p.type === 'tool_result' && p.name === 'spawn_teammate')
    );

    if (!spawned) {
      return {
        stopReason: 'tool_use',
        assistantParts: [
          {
            type: 'tool_call',
            toolCallId: 'tm1',
            name: 'spawn_teammate',
            input: {
              name: TEAMMATE_ID,
              role: 'helper',
              prompt: 'You are a background teammate for demos.'
            }
          }
        ]
      };
    }

    return {
      stopReason: 'end',
      assistantParts: [{ type: 'text', text: 'Main agent spawned teammate.' }]
    };
  })
});

const { session } = runtime.createTaskSession({
  title: 'Spawn teammate',
  description: 'Create async teammate'
});

await runtime.runSession(session.id);

runtime.store.createTask({
  title: 'Unclaimed demo task',
  description: 'Teammate auto-claims when scheduler runs'
});

await runtime.runScheduler();
const teammateSession = runtime.listSessions().find((s) => s.agentId === TEAMMATE_ID);
console.log('Teammate session status:', teammateSession?.status);
