import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDynToolStore,
  createProposeTool,
  defaultDynToolSettings,
  hydrateTurnDynTools,
  writeDynToolSettings
} from '../dist/dyn-tools/index.js';

function kvEnabled() {
  const map = new Map();
  const store = {
    getDaemonControl(key) {
      return map.get(key);
    },
    setDaemonControl(key, value) {
      map.set(key, value);
    }
  };
  writeDynToolSettings(store, { enabled: true, allowPropose: true });
  return store;
}

function context(sessionId = 's1') {
  return {
    repoRoot: process.cwd(),
    stateDir: process.cwd(),
    session: {
      id: sessionId,
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

test('AE2: fixture failure stays draft and is not hydrated', async () => {
  const mem = createDynToolStore();
  const settings = kvEnabled();
  const tool = createProposeTool({
    getStore: () => mem,
    settingsStore: settings,
    getAuthorizedTools: () => []
  });
  const ctx = context();
  const result = await tool.execute(ctx, {
    name: 'add_one',
    description: 'add',
    code: 'return args.x + 1',
    fixtures: [{ args: { x: 1 }, expect: 99 }]
  });
  assert.equal(result.ok, false);
  const rec = mem.get('add_one', { sessionId: 's1' });
  assert.equal(rec.status, 'draft');
  const hydrated = hydrateTurnDynTools({
    store: settings,
    session: ctx.session,
    dynStore: mem,
    settings: { ...defaultDynToolSettings(), enabled: true },
    materializeDeps: { getAuthorizedTools: () => [] }
  });
  assert.ok(!hydrated.names.includes('add_one'));
});

test('all fixtures pass → active and hydrates', async () => {
  const mem = createDynToolStore();
  const settings = kvEnabled();
  const tool = createProposeTool({
    getStore: () => mem,
    settingsStore: settings,
    getAuthorizedTools: () => []
  });
  const ctx = context();
  const result = await tool.execute(ctx, {
    name: 'add_one',
    description: 'add',
    code: 'return args.x + 1',
    fixtures: [{ args: { x: 1 }, expect: 2 }]
  });
  assert.equal(result.ok, true);
  assert.equal(mem.get('add_one', { sessionId: 's1' }).status, 'active');
  const hydrated = hydrateTurnDynTools({
    store: settings,
    session: ctx.session,
    dynStore: mem,
    settings: { ...defaultDynToolSettings(), enabled: true },
    materializeDeps: { getAuthorizedTools: () => [] }
  });
  assert.ok(hydrated.names.includes('add_one'));
});
