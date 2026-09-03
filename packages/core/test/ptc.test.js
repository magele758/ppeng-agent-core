import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PtcIsolateError,
  runPtcCell,
  wrapPtcCellSource
} from '../dist/ptc/isolate.js';
import {
  isPtcSession,
  ptcMetadataPatchFromInput,
  resolvePtcOrchestrationEngine
} from '../dist/ptc/mode.js';
import { buildPtcNamespace } from '../dist/ptc/hooks.js';
import { RawAgentRuntime } from '../dist/runtime.js';
import { assertLockedRounds, PtcReplayError, runHardReplay } from '../dist/ptc/replay.js';
import { createPtcAgentHook } from '../dist/ptc/agent-hook.js';
import { createPtcExecTool, PTC_EXEC_TOOL_NAME } from '../dist/ptc/ptc-exec-tool.js';
import { deriveReplayCapability } from '../dist/ptc/orchestration.js';
import { buildReplayPromptBlock } from '../dist/ptc/prompt.js';

test('PTC mode follows dynamic_workflow default and explicit legacy fallback', () => {
  assert.equal(resolvePtcOrchestrationEngine(undefined, 'dynamic_workflow'), 'ptc');
  assert.equal(resolvePtcOrchestrationEngine('legacy', 'dynamic_workflow'), 'legacy');
  assert.equal(resolvePtcOrchestrationEngine('ptc', 'standard'), 'ptc');
  assert.deepEqual(
    ptcMetadataPatchFromInput({
      task_run_mode: 'dynamic_workflow',
      orchestration_engine: 'ptc'
    }),
    { taskRunMode: 'dynamic_workflow', orchestrationEngine: 'ptc' }
  );
  assert.equal(
    isPtcSession({ metadata: { taskRunMode: 'dynamic_workflow' } }),
    true
  );
});

test('PTC isolate supports async composition and final expressions', async () => {
  const calls = [];
  const result = await runPtcCell(
    `
const rows = await Promise.all([agent({ task: 'a' }), agent({ task: 'b' })]);
console.log('workers', rows.length);
rows.map((row) => row.content).join(',')
`,
    {
      hooks: {
        agent: async ({ task }) => {
          calls.push(task);
          return { ok: true, content: task.toUpperCase() };
        }
      }
    }
  );
  assert.deepEqual(calls.sort(), ['a', 'b']);
  assert.equal(result.value, 'A,B');
  assert.deepEqual(result.logs, ['workers 2']);
  assert.match(wrapPtcCellSource('1 + 2'), /return \(1 \+ 2\)/);
});

test('PTC isolate rejects process access and aborts timed-out async work', async () => {
  await assert.rejects(
    () => runPtcCell('return process.env', { hooks: {} }),
    (error) => error instanceof PtcIsolateError && error.code === 'forbidden'
  );

  const controller = new AbortController();
  await assert.rejects(
    () =>
      runPtcCell('await never(); return 1', {
        timeoutMs: 20,
        abortController: controller,
        hooks: { never: () => new Promise(() => {}) }
      }),
    (error) => error instanceof PtcIsolateError && error.code === 'timeout'
  );
  assert.equal(controller.signal.aborted, true);
});

test('PTC isolate does not expose host constructors through injected hooks or errors', async () => {
  for (const code of [
    "return await agent.constructor('return process')()",
    "return await Object.getPrototypeOf(agent).constructor('return process')()",
    "try { process } catch (error) { return error.constructor.constructor('return process')() }"
  ]) {
    await assert.rejects(
      () => runPtcCell(code, { hooks: { agent: async () => ({ ok: true }) } }),
      (error) =>
        error instanceof PtcIsolateError &&
        (error.code === 'forbidden' || error.code === 'runtime')
    );
  }
});

test('PTC namespace only injects explicitly marked read tools', async () => {
  const context = {
    repoRoot: '/tmp',
    stateDir: '/tmp',
    session: { id: 's', metadata: {} },
    agent: { id: 'a' }
  };
  const tool = (name, ptc) => ({
    name,
    description: name,
    inputSchema: { type: 'object' },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    ptc,
    async execute(_context, args) {
      return { ok: true, content: JSON.stringify(args) };
    }
  });
  const ns = buildPtcNamespace({
    context,
    authorizedTools: [
      tool('read_ok', { kind: 'read' }),
      tool('unmarked'),
      tool('write_no', { kind: 'write' }),
      tool('confirm_no', { kind: 'read', requiresConfirm: true })
    ],
    agent: async () => ({ ok: true }),
    scratchpad: { write: async () => ({}), read: async () => ({}), list: async () => ({}) },
    verify: async () => ({ ok: true })
  });
  assert.deepEqual(ns.toolNames, ['read_ok']);
  assert.equal(typeof ns.bindings.read_ok, 'function');
  assert.equal(ns.bindings.unmarked, undefined);
  const read = await ns.bindings.read_ok({ hello: 'world' });
  assert.equal(read.ok, true);
});

class PtcScriptedAdapter {
  name = 'ptc-scripted';
  rootSessionId;
  rootToolNames = [];
  rootSystemPrompt = '';

  async runTurn(input) {
    if (input.sessionId !== this.rootSessionId) {
      const user = input.messages
        .flatMap((message) => message.parts)
        .find((part) => part.type === 'text')?.text ?? '';
      return {
        stopReason: 'end',
        assistantParts: [{ type: 'text', text: `worker:${user.includes('alpha') ? 'alpha' : 'beta'}` }]
      };
    }

    this.rootToolNames = input.tools.map((tool) => tool.name);
    this.rootSystemPrompt = input.systemPrompt;
    const result = input.messages
      .flatMap((message) => message.parts)
      .find((part) => part.type === 'tool_result' && part.name === 'ptc_exec');
    if (!result) {
      return {
        stopReason: 'tool_use',
        assistantParts: [
          {
            type: 'tool_call',
            toolCallId: 'ptc-1',
            name: 'ptc_exec',
            input: {
              code: `const workers = await Promise.all([agent({ task: 'alpha', role: 'research' }), agent({ task: 'beta', role: 'review' })]); return workers;`
            }
          }
        ]
      };
    }
    return {
      stopReason: 'end',
      assistantParts: [{ type: 'text', text: result.content }]
    };
  }

  async summarizeMessages() {
    return 'summary';
  }
}

test('dynamic_workflow exposes ptc_exec and composes subagents end-to-end', async () => {
  const adapter = new PtcScriptedAdapter();
  const runtime = new RawAgentRuntime({
    repoRoot: mkdtempSync(join(tmpdir(), 'ptc-repo-')),
    stateDir: mkdtempSync(join(tmpdir(), 'ptc-state-')),
    modelAdapter: adapter
  });
  const { session } = runtime.createTaskSession({
    title: 'PTC task',
    message: 'run dynamically',
    background: false,
    metadata: { taskRunMode: 'dynamic_workflow' }
  });
  adapter.rootSessionId = session.id;

  await runtime.runSession(session.id);

  assert.ok(adapter.rootToolNames.includes('ptc_exec'));
  assert.ok(!adapter.rootToolNames.includes('spawn_subagent'));
  assert.match(adapter.rootSystemPrompt, /Dynamic workflow orchestration \(PTC\)/);
  const output = runtime.getLatestAssistantText(session.id) ?? '';
  assert.match(output, /worker:alpha/);
  assert.match(output, /worker:beta/);
  const updated = runtime.getSession(session.id);
  assert.equal(updated.metadata.ptcLastRunOk, true);
  assert.match(updated.metadata.ptcLastProgram, /Promise\.all/);
});

test('standard sessions deny ptc_exec from the model tool surface', async () => {
  let names = [];
  const runtime = new RawAgentRuntime({
    repoRoot: mkdtempSync(join(tmpdir(), 'ptc-standard-repo-')),
    stateDir: mkdtempSync(join(tmpdir(), 'ptc-standard-state-')),
    modelAdapter: {
      name: 'capture',
      async runTurn(input) {
        names = input.tools.map((tool) => tool.name);
        return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'done' }] };
      },
      async summarizeMessages() {
        return 'summary';
      }
    }
  });
  const session = runtime.createChatSession({ title: 'normal', message: 'hello' });
  await runtime.runSession(session.id);
  assert.ok(!names.includes('ptc_exec'));
  assert.ok(names.includes('spawn_subagent'));
});

test('hard v2 rejects out-of-order or mutated dependsOn', () => {
  const locked = [
    {
      workers: [
        { id: 'a', task: 'research {{goal}}', taskTemplate: 'research {{goal}}', dependsOn: [] },
        { id: 'b', task: 'review {{goal}}', taskTemplate: 'review {{goal}}', dependsOn: [] }
      ]
    },
    {
      workers: [
        { id: 'c', task: 'synth', taskTemplate: 'synth {{prev}}', dependsOn: ['a', 'b'] }
      ]
    }
  ];
  assert.throws(
    () =>
      assertLockedRounds(locked, [
        locked[1],
        locked[0]
      ]),
    (error) => error instanceof PtcReplayError && error.code === 'ROUND_ORDER_LOCKED'
  );
  assert.throws(
    () =>
      assertLockedRounds(locked, [
        {
          workers: [
            locked[0].workers[1],
            locked[0].workers[0]
          ]
        },
        locked[1]
      ]),
    (error) => error instanceof PtcReplayError && error.code === 'ROUND_ORDER_LOCKED'
  );
  assert.throws(
    () =>
      assertLockedRounds(locked, [
        locked[0],
        { workers: [{ ...locked[1].workers[0], dependsOn: ['a'] }] }
      ]),
    (error) => error instanceof PtcReplayError && error.code === 'ROUND_ORDER_LOCKED'
  );
  assertLockedRounds(locked, locked);
});

test('hard v3 reruns saved program without historical tool I/O', async () => {
  const calls = [];
  const result = await runHardReplay({
    taskRunMode: 'dynamic_workflow',
    userGoal: 'ship the feature',
    orchestration: {
      name: 'demo',
      schemaVersion: 3,
      slots: [{ name: 'goal', description: 'user goal', source: 'user_goal' }],
      program: `
        const row = await agent({ task: '{{goal}}' });
        return { goal: '{{goal}}', fromAgent: row.content };
      `,
      rounds: []
    },
    spawn: async (spec) => {
      calls.push(spec.task);
      return `fresh:${spec.task}`;
    }
  });
  assert.deepEqual(calls, ['ship the feature']);
  assert.equal(result.programResult.value.goal, 'ship the feature');
  assert.equal(result.programResult.value.fromAgent, 'fresh:ship the feature');
  assert.match(result.synthesisContext, /program result/);
});

test('deriveReplayCapability never upgrades v2 program to hard_ready', () => {
  assert.equal(
    deriveReplayCapability({
      schemaVersion: 3,
      program: 'return 1',
      slots: [{ name: 'goal', description: 'g', source: 'user_goal' }]
    }),
    'hard_ready'
  );
  assert.equal(deriveReplayCapability({ schemaVersion: 3, program: '' }), 'soft_only');
  assert.equal(
    deriveReplayCapability({
      schemaVersion: 2,
      program: 'return 1',
      slots: [{ name: 'goal', description: 'g', source: 'user_goal' }],
      rounds: []
    }),
    'soft_only'
  );
});

test('buildReplayPromptBlock soft vs hard v3', () => {
  const orch = {
    name: 'demo',
    schemaVersion: 3,
    goal: 'ship',
    slots: [{ name: 'goal', description: 'user goal', source: 'user_goal' }],
    rounds: [{ workers: [{ task: 'research', angle: 'fast' }] }]
  };
  const soft = buildReplayPromptBlock(orch, 'soft');
  assert.match(soft, /Prefer this topology/);
  const hard = buildReplayPromptBlock(orch, 'hard');
  assert.match(hard, /saved program is locked/i);
});

test('createPtcAgentHook isolates spawn failures and enforces budget', async () => {
  const hook = createPtcAgentHook({
    maxCalls: 1,
    spawn: async () => {
      throw new Error('spawn boom');
    }
  });
  await assert.rejects(() => hook({}), /non-empty task/);
  const failed = await hook({ task: 'do work' });
  assert.equal(failed.ok, false);
  assert.match(String(failed.error), /spawn boom/);
  const budget = await hook({ task: 'again' });
  assert.equal(budget.ok, false);
  assert.match(String(budget.error), /budget exceeded/);
});

test('createPtcExecTool denies non-PTC sessions', async () => {
  const tool = createPtcExecTool({
    getAuthorizedTools: () => [],
    spawnSubagent: async () => 'ok',
    scratchpad: {
      write: async () => {},
      read: async () => null,
      list: async () => []
    }
  });
  assert.equal(tool.name, PTC_EXEC_TOOL_NAME);
  const result = await tool.execute(
    {
      repoRoot: '/tmp',
      stateDir: '/tmp',
      session: {
        id: 's1',
        title: 't',
        mode: 'chat',
        status: 'idle',
        agentId: 'general',
        background: false,
        todo: [],
        metadata: {},
        createdAt: '',
        updatedAt: ''
      },
      agent: { id: 'general', name: 'G', role: 'a', instructions: '', capabilities: [] }
    },
    { code: 'return 1' }
  );
  assert.equal(result.ok, false);
  assert.match(result.content, /dynamic_workflow/);
});
