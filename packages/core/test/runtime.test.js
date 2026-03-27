import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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

test('read_file can list a directory passed by path', async () => {
  const runtime = runtimeWithAdapter(
    new ScriptedAdapter((input) => {
      const dirResult = input.messages
        .flatMap((message) => message.parts)
        .find((part) => part.type === 'tool_result' && part.name === 'read_file');

      if (!dirResult) {
        return {
          stopReason: 'tool_use',
          assistantParts: [
            {
              type: 'tool_call',
              toolCallId: 'call_dir',
              name: 'read_file',
              input: {
                path: 'docs'
              }
            }
          ]
        };
      }

      return {
        stopReason: 'end',
        assistantParts: [{ type: 'text', text: dirResult.content }]
      };
    })
  );

  mkdirSync(join(runtime.repoRoot, 'docs'), { recursive: true });
  writeFileSync(join(runtime.repoRoot, 'docs', 'note.txt'), 'hello');

  const session = runtime.createChatSession({
    title: 'dir listing',
    message: 'show me docs'
  });

  await runtime.runSession(session.id);
  assert.match(runtime.getLatestAssistantText(session.id) ?? '', /file note\.txt/);
});

test('tool execution errors are returned to the model instead of crashing the session', async () => {
  const runtime = runtimeWithAdapter(
    new ScriptedAdapter((input) => {
      const errorResult = input.messages
        .flatMap((message) => message.parts)
        .find((part) => part.type === 'tool_result' && part.name === 'read_file' && part.ok === false);

      if (!errorResult) {
        return {
          stopReason: 'tool_use',
          assistantParts: [
            {
              type: 'tool_call',
              toolCallId: 'call_missing',
              name: 'read_file',
              input: {
                path: 'missing.txt'
              }
            }
          ]
        };
      }

      return {
        stopReason: 'end',
        assistantParts: [{ type: 'text', text: 'Handled tool failure gracefully.' }]
      };
    })
  );

  const session = runtime.createTaskSession({
    title: 'tool failure',
    description: 'exercise tool error path'
  }).session;

  const result = await runtime.runSession(session.id);
  assert.equal(result.status, 'completed');
  assert.equal(runtime.getLatestAssistantText(session.id), 'Handled tool failure gracefully.');
});

test('teammate sessions and mailbox messages can be created directly', async () => {
  const runtime = runtimeWithAdapter(
    new ScriptedAdapter(() => ({
      stopReason: 'end',
      assistantParts: [{ type: 'text', text: 'Teammate online.' }]
    }))
  );

  const session = runtime.createTeammateSession({
    name: 'qa-bot',
    role: 'QA specialist',
    prompt: 'Watch for bugs.'
  });

  await runtime.runSession(session.id);
  const mail = runtime.sendMailboxMessage({
    fromAgentId: 'main',
    toAgentId: 'qa-bot',
    content: 'Check the latest task.'
  });

  assert.equal(session.mode, 'teammate');
  assert.equal(mail.toAgentId, 'qa-bot');
  assert.equal(runtime.listMailbox('qa-bot').length, 1);
});

test('parallel tool calls execute in one assistant message', async () => {
  const seen = [];
  const runtime = runtimeWithAdapter(
    new ScriptedAdapter((input) => {
      const results = input.messages.flatMap((m) => m.parts).filter((p) => p.type === 'tool_result' && p.name === 'read_file');
      if (results.length < 2) {
        return {
          stopReason: 'tool_use',
          assistantParts: [
            { type: 'tool_call', toolCallId: 'a', name: 'read_file', input: { path: 'a.txt' } },
            { type: 'tool_call', toolCallId: 'b', name: 'read_file', input: { path: 'b.txt' } }
          ]
        };
      }
      seen.push(...results.map((r) => r.content));
      return {
        stopReason: 'end',
        assistantParts: [{ type: 'text', text: 'done' }]
      };
    })
  );

  writeFileSync(join(runtime.repoRoot, 'a.txt'), 'A');
  writeFileSync(join(runtime.repoRoot, 'b.txt'), 'B');

  const session = runtime.createChatSession({ title: 'parallel', message: 'read both' });
  await runtime.runSession(session.id);
  assert.equal(seen.length, 2);
  assert.match(seen[0], /A/);
  assert.match(seen[1], /B/);
});

test('scratch memory is copied to subagent session', async () => {
  const runtime = runtimeWithAdapter(
    new ScriptedAdapter((input) => {
      if (input.agent.id === 'researcher') {
        return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'sub done' }] };
      }
      const hasSub = input.messages.some((m) =>
        m.parts.some((p) => p.type === 'tool_result' && p.name === 'spawn_subagent')
      );
      if (!hasSub) {
        return {
          stopReason: 'tool_use',
          assistantParts: [
            {
              type: 'tool_call',
              toolCallId: 's1',
              name: 'spawn_subagent',
              input: { prompt: 'Say hi only.', role: 'research' }
            }
          ]
        };
      }
      return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'parent done' }] };
    })
  );

  const session = runtime.createChatSession({ title: 'handoff', message: 'go' });
  runtime.store.upsertSessionMemory({
    sessionId: session.id,
    scope: 'scratch',
    key: 'ctx',
    value: 'shared-secret'
  });

  await runtime.runSession(session.id);

  const sub = runtime.listSessions().find((s) => s.mode === 'subagent' && s.parentSessionId === session.id);
  assert.ok(sub);
  const mem = runtime.store.listSessionMemory(sub.id, 'scratch');
  assert.equal(mem.find((m) => m.key === 'ctx')?.value, 'shared-secret');
});

test('read_file offset_line returns a window', async () => {
  const runtime = runtimeWithAdapter(
    new ScriptedAdapter((input) => {
      const tr = input.messages
        .flatMap((m) => m.parts)
        .find((p) => p.type === 'tool_result' && p.name === 'read_file');
      if (!tr) {
        return {
          stopReason: 'tool_use',
          assistantParts: [
            {
              type: 'tool_call',
              toolCallId: 'r1',
              name: 'read_file',
              input: { path: 'lines.txt', offset_line: 2, limit: 2 }
            }
          ]
        };
      }
      return { stopReason: 'end', assistantParts: [{ type: 'text', text: tr.content }] };
    })
  );

  writeFileSync(join(runtime.repoRoot, 'lines.txt'), ['L0', 'L1', 'L2', 'L3'].join('\n'));
  const session = runtime.createChatSession({ title: 'offset', message: 'x' });
  await runtime.runSession(session.id);
  const text = runtime.getLatestAssistantText(session.id) ?? '';
  assert.match(text, /L2/);
  assert.match(text, /L3/);
});

test('scheduler dequeue wakes sessions enqueued on task create', async () => {
  const runtime = runtimeWithAdapter(
    new ScriptedAdapter(() => ({
      stopReason: 'end',
      assistantParts: [{ type: 'text', text: 'woke' }]
    }))
  );

  const bg = runtime.createChatSession({ title: 'bg', message: 'idle', background: true });
  runtime.store.updateSession(bg.id, { mode: 'task' });
  const { task } = runtime.createTaskSession({ title: 'new work', description: 'd' });
  assert.ok(task);

  await runtime.runScheduler();
  const s = runtime.getSession(bg.id);
  assert.equal(s?.status, 'completed');
  assert.equal(runtime.getLatestAssistantText(bg.id), 'woke');
});

test('createApproval idempotency key returns same pending row', async () => {
  const runtime = runtimeWithAdapter(
    new ScriptedAdapter(() => ({ stopReason: 'end', assistantParts: [{ type: 'text', text: 'x' }] }))
  );
  const session = runtime.createChatSession({ title: 'idem', message: 'x' });
  const a1 = runtime.store.createApproval({
    sessionId: session.id,
    toolName: 'bash',
    reason: 'r',
    args: { command: 'echo' },
    idempotencyKey: 'idem-k'
  });
  const a2 = runtime.store.createApproval({
    sessionId: session.id,
    toolName: 'bash',
    reason: 'r',
    args: { command: 'echo' },
    idempotencyKey: 'idem-k'
  });
  assert.equal(a1.id, a2.id);
});
