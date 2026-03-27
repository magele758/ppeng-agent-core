import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/index.js';
import { ScriptedAdapter } from './_scripted-adapter.mjs';

const repoRoot = mkdtempSync(join(tmpdir(), 'ppeng-agent-repo-'));
writeFileSync(join(repoRoot, 'README.md'), '# demo\n');
const stateDir = mkdtempSync(join(tmpdir(), 'ppeng-agent-state-'));

const runtime = new RawAgentRuntime({
  repoRoot,
  stateDir,
  modelAdapter: new ScriptedAdapter(() => ({
    stopReason: 'end',
    assistantParts: [{ type: 'text', text: 'Task done in isolated workspace.' }]
  }))
});

const { task, session } = runtime.createTaskSession({
  title: 'Demo task',
  description: 'Touch workspace files only under workspace root.'
});

await runtime.runSession(session.id);
const t = runtime.getTask(task.id);
const w = t?.workspaceId ? runtime.store.getWorkspace(t.workspaceId) : undefined;
console.log('Task status:', t?.status);
console.log('Workspace:', w?.rootPath ?? '(none)');
