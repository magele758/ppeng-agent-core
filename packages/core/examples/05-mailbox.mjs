import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/index.js';
import { ScriptedAdapter } from './_scripted-adapter.mjs';

const SENDER = 'main';
const RECEIVER = 'mailbox-peer';

const repoRoot = mkdtempSync(join(tmpdir(), 'ppeng-agent-repo-'));
const stateDir = mkdtempSync(join(tmpdir(), 'ppeng-agent-state-'));

const runtime = new RawAgentRuntime({
  repoRoot,
  stateDir,
  modelAdapter: new ScriptedAdapter((input) => {
    if (input.agent.id === RECEIVER) {
      const gotMail = input.messages.some(
        (m) => m.role === 'user' && m.parts.some((p) => p.type === 'text' && p.text.includes('Inbox:'))
      );
      return {
        stopReason: 'end',
        assistantParts: [
          {
            type: 'text',
            text: gotMail ? 'Receiver saw inbox injection.' : 'No inbox yet.'
          }
        ]
      };
    }
    return {
      stopReason: 'end',
      assistantParts: [{ type: 'text', text: 'Sender idle.' }]
    };
  })
});

runtime.store.upsertAgent({
  id: RECEIVER,
  name: 'Mailbox peer',
  role: 'peer',
  instructions: 'Demo agent for mailbox.',
  capabilities: ['chat'],
  autonomous: true
});

const peerSession = runtime.createTeammateSession({
  name: RECEIVER,
  role: 'peer',
  prompt: 'Wait for mailbox messages.',
  background: true
});

runtime.sendMailboxMessage({
  fromAgentId: SENDER,
  toAgentId: RECEIVER,
  content: 'Hello from mailbox API',
  type: 'demo'
});

await runtime.runScheduler();
await runtime.runSession(peerSession.id);
console.log(runtime.getLatestAssistantText(peerSession.id));
