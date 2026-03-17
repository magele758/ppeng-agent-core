import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/runtime.js';

class ScriptedAdapter {
  constructor(handler) {
    this.name = 'scripted';
    this.handler = handler;
  }

  async runTurn(input) {
    return this.handler(input);
  }

  async summarizeMessages() {
    return 'summary';
  }
}

function runtimeWithAdapter(adapter) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'raw-agent-repo-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'raw-agent-state-'));
  return new RawAgentRuntime({
    repoRoot,
    stateDir,
    modelAdapter: adapter
  });
}

test('chat session can do a simple reply through the raw loop', async () => {
  const runtime = runtimeWithAdapter(
    new ScriptedAdapter(() => ({
      stopReason: 'end',
      assistantParts: [{ type: 'text', text: 'Hello from the loop.' }]
    }))
  );

  const session = runtime.createChatSession({
    title: 'hello',
    message: 'hello'
  });

  const result = await runtime.runSession(session.id);
  assert.equal(result.status, 'idle');
  assert.equal(runtime.getLatestAssistantText(session.id), 'Hello from the loop.');
});

test('task sessions complete and bind an isolated workspace', async () => {
  const runtime = runtimeWithAdapter(
    new ScriptedAdapter(() => ({
      stopReason: 'end',
      assistantParts: [{ type: 'text', text: 'Task handled.' }]
    }))
  );

  const { task, session } = runtime.createTaskSession({
    title: 'Implement feature',
    description: 'Do the work'
  });

  await runtime.runSession(session.id);

  const updatedTask = runtime.getTask(task.id);
  const updatedSession = runtime.getSession(session.id);
  assert.ok(updatedTask);
  assert.ok(updatedTask.workspaceId);
  assert.equal(updatedTask.status, 'completed');
  assert.ok(updatedSession.workspaceId);
});

test('approval blocks the session until the user approves the tool call', async () => {
  const runtime = runtimeWithAdapter(
    new ScriptedAdapter((input) => {
      const sawApprovalNote = input.messages.some(
        (message) =>
          message.role === 'user' &&
          message.parts.some((part) => part.type === 'text' && part.text.includes('Approval for bash was approved'))
      );

      if (!sawApprovalNote) {
        return {
          stopReason: 'tool_use',
          assistantParts: [
            {
              type: 'tool_call',
              toolCallId: 'call_1',
              name: 'bash',
              input: {
                command: 'rm -rf /tmp/example'
              }
            }
          ]
        };
      }

      return {
        stopReason: 'end',
        assistantParts: [{ type: 'text', text: 'Continuing after approval.' }]
      };
    })
  );

  const session = runtime.createChatSession({
    title: 'approval',
    message: 'run the risky command'
  });

  const blocked = await runtime.runSession(session.id);
  assert.equal(blocked.status, 'waiting_approval');

  const approvals = runtime.listApprovals();
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].toolName, 'bash');

  await runtime.approve(approvals[0].id, 'approved');
  const completed = await runtime.runSession(session.id);
  assert.equal(completed.status, 'idle');
  assert.equal(runtime.getLatestAssistantText(session.id), 'Continuing after approval.');
});
