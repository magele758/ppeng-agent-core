import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDynToolStore,
  defaultDynToolSettings,
  hydrateTurnDynTools,
  InMemoryDynToolBackend,
  selectHydrateRecords,
  writeDynToolSettings
} from '../dist/dyn-tools/index.js';
import { materializePtcCellTool } from '../dist/dyn-tools/index.js';
import { filterToolsForSession, resolveTurnTools } from '../dist/turn/resolve-turn-tools.js';

function session(meta = {}) {
  return {
    id: 's1',
    title: 't',
    mode: 'chat',
    status: 'idle',
    agentId: 'main',
    background: false,
    todo: [],
    metadata: meta,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

const agent = { id: 'main', name: 'Main', role: 'assistant', instructions: '', capabilities: [] };

const readFile = {
  name: 'read_file',
  description: 'r',
  inputSchema: {},
  approvalMode: 'never',
  sideEffectLevel: 'none',
  execute: async () => ({ ok: true, content: '' })
};

function kvStore(initial) {
  const map = new Map(initial ? [[ 'dyn_tool_settings', initial ]] : []);
  return {
    getDaemonControl(key) {
      return map.get(key);
    },
    setDaemonControl(key, value) {
      map.set(key, value);
    }
  };
}

test('resolveTurnTools without dyn records matches filterToolsForSession', () => {
  const sess = session();
  const env = {};
  const input = { env, tools: [readFile], agent, session: sess };
  const filtered = filterToolsForSession(input);
  const resolved = resolveTurnTools({
    ...input,
    sessionId: sess.id,
    systemPromptChars: 10
  });
  assert.deepEqual(
    resolved.turnTools.map((t) => t.name),
    filtered.tools.map((t) => t.name)
  );
});

test('session active record is hydrated into turnTools', () => {
  const dyn = materializePtcCellTool(
    {
      name: 'add_one',
      description: 'add',
      inputSchema: {},
      kind: 'ptc_cell',
      source: { code: 'return args.x + 1' },
      scope: 'session.scratch',
      status: 'active',
      stats: { uses: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    { getAuthorizedTools: () => [] }
  );
  const resolved = resolveTurnTools({
    env: {},
    tools: [readFile],
    agent,
    session: session(),
    sessionId: 's1',
    systemPromptChars: 10,
    dynTools: [dyn]
  });
  assert.ok(resolved.turnTools.some((t) => t.name === 'add_one'));
  assert.ok(resolved.turnTools.some((t) => t.name === 'read_file'));
});

test('used but draft still hydrates (sticky)', () => {
  const draft = {
    name: 'sticky_fn',
    description: 's',
    inputSchema: {},
    kind: 'ptc_cell',
    source: { code: 'return 1' },
    scope: 'session.scratch',
    status: 'draft',
    stats: { uses: 1 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const picked = selectHydrateRecords({
    records: [draft],
    usedNames: ['sticky_fn'],
    settings: { ...defaultDynToolSettings(), enabled: true }
  });
  assert.equal(picked.length, 1);
  assert.equal(picked[0].name, 'sticky_fn');
});

test('enabled=false hydrate is empty', () => {
  const store = createDynToolStore();
  store.upsert({
    name: 'hidden_fn',
    description: 'h',
    source: { code: 'return 1' },
    sessionId: 's1',
    status: 'active'
  });
  const kv = kvStore();
  const out = hydrateTurnDynTools({
    store: kv,
    session: session(),
    dynStore: store,
    settings: defaultDynToolSettings(),
    materializeDeps: { getAuthorizedTools: () => [] }
  });
  assert.deepEqual(out.names, []);
});

test('materialize failure is reported as skipped (not silent)', () => {
  const backend = new InMemoryDynToolBackend();
  const now = new Date().toISOString();
  backend.put(
    {
      name: 'bad_fn',
      description: 'empty',
      inputSchema: {},
      kind: 'ptc_cell',
      source: { code: '' },
      scope: 'session.scratch',
      status: 'active',
      stats: { uses: 0 },
      createdAt: now,
      updatedAt: now
    },
    { sessionId: 's1' }
  );
  const store = createDynToolStore(backend);
  const kv = kvStore({ enabled: true, allowSave: true, allowPropose: true, hydrateTopK: 8, unusedSuggestTurns: 20 });
  const out = hydrateTurnDynTools({
    store: kv,
    session: session(),
    dynStore: store,
    settings: { ...defaultDynToolSettings(), enabled: true },
    materializeDeps: { getAuthorizedTools: () => [] }
  });
  assert.deepEqual(out.names, []);
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].name, 'bad_fn');
  assert.match(out.skipped[0].reason, /empty|materialize/i);
});

test('settings persist in daemon_control KV', () => {
  const kv = kvStore();
  const written = writeDynToolSettings(kv, { enabled: true, allowSave: false });
  assert.equal(written.enabled, true);
  assert.equal(written.allowSave, false);
  assert.equal(kv.getDaemonControl('dyn_tool_settings').enabled, true);
});
