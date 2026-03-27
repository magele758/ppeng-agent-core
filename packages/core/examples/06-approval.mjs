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
    const approved = input.messages.some(
      (m) =>
        m.role === 'user' &&
        m.parts.some((p) => p.type === 'text' && p.text.includes('Approval for bash was approved'))
    );

    if (!approved) {
      return {
        stopReason: 'tool_use',
        assistantParts: [
          {
            type: 'tool_call',
            toolCallId: 'bash1',
            name: 'bash',
            input: { command: 'rm -rf /tmp/ppeng-demo-nonexistent' }
          }
        ]
      };
    }

    return {
      stopReason: 'end',
      assistantParts: [{ type: 'text', text: 'Continuing after approval.' }]
    };
  })
});

const session = runtime.createChatSession({
  title: 'Approval demo',
  message: 'run risky bash'
});

const blocked = await runtime.runSession(session.id);
console.log('After risky bash proposal:', blocked.status);

const [approval] = runtime.listApprovals();
await runtime.approve(approval.id, 'approved');
await runtime.runSession(session.id);
console.log('Final:', runtime.getSession(session.id)?.status);
console.log(runtime.getLatestAssistantText(session.id));
