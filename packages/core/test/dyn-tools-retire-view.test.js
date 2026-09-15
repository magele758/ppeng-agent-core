import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annotateRetiredToolParts,
  createDynToolStoreFromSessionMemory,
  hydrateTurnDynTools,
  retiredMarker,
  writeDynToolSettings
} from '../dist/dyn-tools/index.js';
import { prepareMessagesForModel } from '../dist/turn/prepare-view.js';

function msg(role, parts) {
  return {
    id: `m-${role}`,
    sessionId: 's1',
    role,
    parts,
    createdAt: new Date().toISOString()
  };
}

test('retired names appear in model view, stored parts stay unmarked', () => {
  const stored = [
    msg('assistant', [{ type: 'tool_call', toolCallId: 'c1', name: 'old_fn', input: {} }]),
    msg('tool', [{ type: 'tool_result', toolCallId: 'c1', name: 'old_fn', ok: true, content: 'ok-body' }])
  ];
  const view = annotateRetiredToolParts(stored, new Set(['old_fn']));
  assert.ok(view[0].parts.some((p) => p.type === 'text' && p.text === retiredMarker('old_fn')));
  assert.ok(view[1].parts[0].content.startsWith(retiredMarker('old_fn')));
  assert.equal(stored[0].parts.length, 1);
  assert.equal(stored[1].parts[0].content, 'ok-body');
  assert.ok(!JSON.stringify(stored).includes('retired:'));
});

test('non-retired names are unchanged', () => {
  const stored = [
    msg('assistant', [{ type: 'tool_call', toolCallId: 'c1', name: 'live_fn', input: {} }])
  ];
  const view = annotateRetiredToolParts(stored, new Set(['other']));
  assert.deepEqual(view[0].parts, stored[0].parts);
});

function sessionMemStore() {
  const rows = [];
  const kv = new Map();
  return {
    getDaemonControl(key) {
      return kv.get(key);
    },
    setDaemonControl(key, value) {
      kv.set(key, value);
    },
    getImageAsset() {
      return undefined;
    },
    upsertSessionMemory(input) {
      rows.push({
        ...input,
        id: `m-${input.key}`,
        metadata: input.metadata ?? {},
        updatedAt: new Date().toISOString()
      });
    },
    listSessionMemory(sessionId, scope) {
      return rows.filter((r) => r.sessionId === sessionId && (!scope || r.scope === scope));
    },
    deleteSessionMemory(sessionId, scope, key) {
      const idx = rows.findIndex((r) => r.sessionId === sessionId && r.scope === scope && r.key === key);
      if (idx < 0) return false;
      rows.splice(idx, 1);
      return true;
    }
  };
}

test('AE3: retire drops hydrate name; prepare-view marks; transcript unchanged', async () => {
  const mem = sessionMemStore();
  writeDynToolSettings(mem, { enabled: true });
  const dyn = createDynToolStoreFromSessionMemory(mem);
  dyn.upsert({
    name: 'old_fn',
    description: 'retired later',
    source: { code: 'return 1' },
    sessionId: 's1',
    status: 'active'
  });
  dyn.retire('old_fn', 's1');
  const sess = {
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
  const hydrated = hydrateTurnDynTools({
    store: mem,
    session: sess,
    dynStore: dyn,
    materializeDeps: { getAuthorizedTools: () => [] }
  });
  assert.ok(!hydrated.names.includes('old_fn'));

  const stored = [
    msg('assistant', [{ type: 'tool_call', toolCallId: 'c1', name: 'old_fn', input: {} }]),
    msg('tool', [{ type: 'tool_result', toolCallId: 'c1', name: 'old_fn', ok: true, content: 'ok-body' }])
  ];
  const snapshot = JSON.stringify(stored);
  const view = await prepareMessagesForModel(
    {
      store: mem,
      emitTrace() {},
      turnShapeBySession: new Map(),
      promptBuilder: { lastCognitivePhaseBySession: new Map() }
    },
    sess,
    stored
  );
  assert.ok(JSON.stringify(view).includes(retiredMarker('old_fn')));
  assert.equal(JSON.stringify(stored), snapshot);
  assert.ok(!snapshot.includes('retired:'));
});

test('enabled=false without dyn history does not list session memory', async () => {
  const host = {
    store: {
      getImageAsset() {
        return undefined;
      },
      getDaemonControl() {
        return { enabled: false };
      },
      listSessionMemory() {
        throw new Error('should not list dyn-tool memory');
      },
      upsertSessionMemory() {},
      deleteSessionMemory() {
        return false;
      }
    },
    emitTrace() {},
    turnShapeBySession: new Map(),
    promptBuilder: { lastCognitivePhaseBySession: new Map() }
  };
  const sess = {
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
  const view = await prepareMessagesForModel(host, sess, [msg('user', [{ type: 'text', text: 'hi' }])]);
  assert.equal(view[0].parts[0].text, 'hi');
});
