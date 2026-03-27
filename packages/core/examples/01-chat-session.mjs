import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HeuristicModelAdapter, RawAgentRuntime } from '../dist/index.js';

const repoRoot = mkdtempSync(join(tmpdir(), 'ppeng-agent-repo-'));
const stateDir = mkdtempSync(join(tmpdir(), 'ppeng-agent-state-'));

const runtime = new RawAgentRuntime({
  repoRoot,
  stateDir,
  modelAdapter: new HeuristicModelAdapter()
});

const session = runtime.createChatSession({
  title: 'Demo chat',
  message: '你好'
});

await runtime.runSession(session.id);
console.log('Assistant:', runtime.getLatestAssistantText(session.id));
