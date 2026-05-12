import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuiltinTools } from '../dist/tools/builtin-tools.js';

function stubServices() {
  return {
    loadSkill: async () => ({ content: '' }),
    updateTodo: async () => [],
    createTask: async () => ({}),
    getTask: async () => undefined,
    listTasks: async () => [],
    updateTask: async () => ({}),
    harnessWriteSpec: async () => '',
    spawnSubagent: async () => '',
    spawnTeammate: async () => '',
    listAgents: async () => [],
    sendMail: async () => ({}),
    readInbox: async () => [],
    startBackgroundJob: async () => ({}),
    getBackgroundJob: async () => undefined,
    listBackgroundJobs: async () => [],
    listWorkspaces: async () => [],
    upsertSessionMemory: async () => ({}),
    listSessionMemory: async () => [],
    deleteSessionMemory: async () => true,
    visionAnalyze: async () => ''
  };
}

describe('work_evidence tool', () => {
  it('ok:true in non-git dir without verify_command; git_is_repo false', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-evidence-nogit-'));
    const tools = createBuiltinTools(stubServices());
    const tool = tools.find((t) => t.name === 'work_evidence');
    assert.ok(tool);
    const result = await tool.execute(
      { repoRoot: dir, workspaceRoot: dir, stateDir: dir, agent: { id: 'a' }, session: { id: 's' } },
      {}
    );
    assert.equal(result.ok, true, result.content);
    const payload = JSON.parse(String(result.content).trim());
    assert.equal(payload.git_is_repo, false);
  });

  it('ok:false when verify_command exits 1; payload includes exit_code 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-evidence-verifyfail-'));
    const tools = createBuiltinTools(stubServices());
    const tool = tools.find((t) => t.name === 'work_evidence');
    const result = await tool.execute(
      { repoRoot: dir, workspaceRoot: dir, stateDir: dir, agent: { id: 'a' }, session: { id: 's' } },
      { verify_command: 'node -e "process.exit(1)"' }
    );
    assert.equal(result.ok, false, result.content);
    const payload = JSON.parse(String(result.content).trim());
    assert.equal(payload.verify.exit_code, 1);
  });
});
