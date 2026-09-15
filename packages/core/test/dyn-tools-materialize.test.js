import test from 'node:test';
import assert from 'node:assert/strict';
import { materializePtcCellTool, inheritHarvestedToolSafety, DynToolError } from '../dist/dyn-tools/index.js';

function context() {
  return {
    repoRoot: process.cwd(),
    stateDir: process.cwd(),
    session: {
      id: 's1',
      title: 't',
      mode: 'chat',
      status: 'idle',
      agentId: 'main',
      background: false,
      todo: [],
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    agent: { id: 'main', name: 'Main', role: 'assistant', instructions: '', capabilities: [] }
  };
}

function record(code) {
  return {
    name: 'add_one',
    description: 'add',
    inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
    kind: 'ptc_cell',
    source: { code },
    scope: 'session.scratch',
    status: 'active',
    stats: { uses: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

const bashTool = {
  name: 'bash',
  description: 'shell',
  inputSchema: { type: 'object' },
  approvalMode: 'always',
  sideEffectLevel: 'system',
  execute: async () => ({ ok: true, content: 'should-not-run' })
};

test('ptc_cell materialize: return args.x + 1', async () => {
  const tool = materializePtcCellTool(record('return args.x + 1'), {
    getAuthorizedTools: () => [bashTool]
  });
  const result = await tool.execute(context(), { x: 1 });
  assert.equal(result.ok, true);
  const body = JSON.parse(result.content);
  assert.equal(body.result, 2);
  assert.equal(tool.sideEffectLevel, 'none');
  assert.equal(tool.approvalMode, 'never');
});

test('harvested tool inherits highest inner PTC sideEffect (never auto)', () => {
  const riskyRead = {
    name: 'read_file',
    description: 'r',
    inputSchema: {},
    approvalMode: 'never',
    sideEffectLevel: 'workspace',
    ptc: { kind: 'read' },
    execute: async () => ({ ok: true, content: '' })
  };
  const safety = inheritHarvestedToolSafety([bashTool, riskyRead]);
  assert.equal(safety.approvalMode, 'always');
  assert.equal(safety.sideEffectLevel, 'workspace');
  const tool = materializePtcCellTool(record('return 1'), {
    getAuthorizedTools: () => [bashTool, riskyRead],
    previewAuthorizedTools: [bashTool, riskyRead]
  });
  assert.equal(tool.approvalMode, 'always');
  assert.equal(tool.sideEffectLevel, 'workspace');
  assert.notEqual(tool.approvalMode, 'auto');
});

test('ptc_cell materialize: bash is not in namespace (AE4)', async () => {
  const tool = materializePtcCellTool(record('return await bash({ command: "echo hi" })'), {
    getAuthorizedTools: () => [bashTool]
  });
  const result = await tool.execute(context(), {});
  assert.equal(result.ok, false);
  assert.match(result.content, /bash|not defined|undefined|PTC|forbidden|is not a function/i);
});

test('empty code refuses materialize', () => {
  assert.throws(
    () => materializePtcCellTool(record(''), { getAuthorizedTools: () => [] }),
    (err) => err instanceof DynToolError && err.code === 'empty_code'
  );
});
