import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSaveAsTool,
  createDynToolStore,
  defaultDynToolSettings,
  hydrateTurnDynTools,
  readDynToolSettings,
  writeDynToolSettings,
  SAVE_AS_TOOL_NAME
} from '../dist/dyn-tools/index.js';
import { filterToolsForSession } from '../dist/turn/resolve-turn-tools.js';

function kvStore() {
  const map = new Map();
  return {
    getDaemonControl(key) {
      return map.get(key);
    },
    setDaemonControl(key, value) {
      map.set(key, value);
    }
  };
}

const saveTool = {
  name: SAVE_AS_TOOL_NAME,
  description: 'save',
  inputSchema: {},
  approvalMode: 'never',
  sideEffectLevel: 'none',
  execute: async () => ({ ok: true, content: '' })
};

const agent = { id: 'main', name: 'Main', role: 'assistant', instructions: '', capabilities: [] };
const session = {
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
};

test('unconfigured settings default enabled=false', () => {
  assert.equal(readDynToolSettings(kvStore()).enabled, false);
  assert.equal(defaultDynToolSettings().enabled, false);
});

test('enabled=false hides meta tools and hydrates empty', () => {
  const kv = kvStore();
  const filtered = filterToolsForSession({
    env: {},
    tools: [saveTool],
    agent,
    session,
    settingsStore: kv
  });
  assert.ok(!filtered.tools.some((t) => t.name === SAVE_AS_TOOL_NAME));
  const store = createDynToolStore();
  store.upsert({
    name: 'ghost_fn',
    description: 'g',
    source: { code: 'return 1' },
    sessionId: 's1',
    status: 'active'
  });
  const hydrated = hydrateTurnDynTools({
    store: kv,
    session,
    dynStore: store,
    materializeDeps: { getAuthorizedTools: () => [] }
  });
  assert.deepEqual(hydrated.names, []);
});

test('enabled=true + allowSave=false rejects save_as_tool execute', async () => {
  const kv = kvStore();
  writeDynToolSettings(kv, { enabled: true, allowSave: false });
  const store = createDynToolStore();
  const tool = createSaveAsTool({
    getStore: () => store,
    settingsStore: kv
  });
  const result = await tool.execute(
    { session, agent, repoRoot: process.cwd(), stateDir: process.cwd() },
    { name: 'add_one', description: 'a', code: 'return 1' }
  );
  assert.equal(result.ok, false);
  assert.match(result.content, /allowSave/);
});
