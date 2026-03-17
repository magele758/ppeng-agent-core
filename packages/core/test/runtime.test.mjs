import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/index.js';

test('runtime creates specialist subtasks and eventually completes the coordinator task', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'raw-agent-repo-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'raw-agent-state-'));
  const runtime = new RawAgentRuntime({
    repoRoot,
    stateDir
  });

  const task = runtime.createTask({
    goal: 'Implement a feature with planning, coding, and review',
    background: true
  });

  await runtime.runPendingTasks();

  const parentAfterFirstPass = runtime.getTask(task.id);
  assert.ok(parentAfterFirstPass);
  assert.equal(parentAfterFirstPass.status, 'blocked');

  const children = runtime.listTasks().filter((candidate) => candidate.parentTaskId === task.id);
  assert.equal(children.length, 3);

  await runtime.runPendingTasks();
  await runtime.runPendingTasks();

  const finalTask = runtime.getTask(task.id);
  assert.ok(finalTask);
  assert.equal(finalTask.status, 'completed');
  assert.match(finalTask.summary?.narrative ?? '', /All specialists completed/);
});

test('approving an approval request moves the task back to pending', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'raw-agent-repo-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'raw-agent-state-'));
  const runtime = new RawAgentRuntime({
    repoRoot,
    stateDir
  });

  const task = runtime.createTask({
    goal: 'Run a risky command',
    ownerAgentId: 'implementer',
    metadata: {}
  });

  const approval = runtime.store.createApproval({
    taskId: task.id,
    toolName: 'shell_command',
    reason: 'Need manual confirmation',
    args: {
      command: 'rm -rf /tmp/example'
    }
  });

  runtime.store.updateTask(task.id, {
    status: 'blocked',
    metadata: {
      blockedReason: 'Awaiting approval'
    }
  });

  const updatedApproval = await runtime.approve(approval.id, 'approved');
  assert.equal(updatedApproval.status, 'approved');
  assert.equal(runtime.getTask(task.id)?.status, 'pending');
});
