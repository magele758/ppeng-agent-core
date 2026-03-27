import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/index.js';
import { ScriptedAdapter } from './_scripted-adapter.mjs';
import { builtinAgents } from '../dist/builtin-agents.js';

const repoRoot = mkdtempSync(join(tmpdir(), 'ppeng-agent-repo-'));
const stateDir = mkdtempSync(join(tmpdir(), 'ppeng-agent-state-'));

const custom = {
  id: 'custom-greeter',
  name: 'Greeter',
  role: 'short replies',
  instructions: 'Always answer in one short English sentence.',
  capabilities: ['chat']
};

const runtime = new RawAgentRuntime({
  repoRoot,
  stateDir,
  agents: [...builtinAgents, custom],
  modelAdapter: new ScriptedAdapter(() => ({
    stopReason: 'end',
    assistantParts: [{ type: 'text', text: 'Hello from the custom agent profile.' }]
  }))
});

const session = runtime.createChatSession({
  title: 'Custom agent',
  message: 'Who are you?',
  agentId: custom.id
});

await runtime.runSession(session.id);
console.log(runtime.getLatestAssistantText(session.id));
