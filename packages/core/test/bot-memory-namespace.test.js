import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import { compileTurnAppendix } from '../dist/session/context-compiler.js';
import { saveSemanticFact } from '../dist/memory/memory-writer.js';
import { scheduleMemoryTurnEnd } from '../dist/memory/memory-turn-end.js';
import { writeMemorySettings } from '../dist/memory/memory-settings.js';
import { createMemoryTools } from '../dist/tools/memory-tools.js';
import { autoCompactSession } from '../dist/runtime/compact-host.js';
import { createExtensionRegistry } from '../dist/extensions/extension-registry.js';

const SHARED = '办公室白板贴着共享备忘';
const FACT_A = '阿尔法维护支付网关的回滚顺序';
const FACT_B = '贝塔只播报原油期货行情';
const SCRATCH_A = '阿尔法回滚清单已确认';

function tmpStore() {
  const dir = mkdtempSync(join(tmpdir(), 'bot-mem-'));
  return { dir, store: new SqliteStateStore(join(dir, 'state.db')) };
}

test('two bots cannot see each other or shared user.memory; plain chats still can', () => {
  const { store } = tmpStore();
  const now = new Date().toISOString();
  store.createBot({
    id: 'bot-gamma',
    name: 'Gamma',
    title: 'Gamma',
    description: '',
    agentId: 'bot-gamma',
    canonicalSessionId: 'canon-gamma',
    hidden: false,
    createdAt: now,
    updatedAt: now
  });

  const am = store.agentMemory();
  saveSemanticFact(am, { userId: 'u1', category: 'fact', content: SHARED });
  saveSemanticFact(am, { userId: 'u1', category: 'fact', content: FACT_A, agentId: 'bot-a' });
  saveSemanticFact(am, { userId: 'u1', category: 'fact', content: FACT_B, agentId: 'bot-b' });

  const sessA = store.createSession({
    title: 'A',
    mode: 'chat',
    agentId: 'bot-a',
    metadata: { botId: 'bot-a', userId: 'u1' }
  });
  const sessB = store.createSession({
    title: 'B',
    mode: 'chat',
    agentId: 'bot-b',
    metadata: { botId: 'bot-b', userId: 'u1' }
  });
  const sessPlain = store.createSession({
    title: 'plain',
    mode: 'chat',
    agentId: 'general',
    metadata: { userId: 'u1' }
  });
  const sessGamma = store.createSession({
    title: 'gamma',
    mode: 'chat',
    agentId: 'bot-gamma',
    metadata: { userId: 'u1' }
  });

  am.set({
    scope: 'session.scratch',
    namespace: 'default',
    key: 'plan',
    value: SCRATCH_A,
    sessionId: sessA.id,
    agentId: 'bot-a',
    importance: 0.6,
    confidence: 'medium',
    source: 'user_provided'
  });
  saveSemanticFact(am, { userId: 'u1', category: 'fact', content: '伽马只记实验日志', agentId: 'bot-gamma' });

  const legacy = am.search({ scope: 'user.memory', userId: 'u1', agentUnscoped: true, limit: 20 });
  assert.ok(legacy.some((row) => row.value.includes('共享备忘') && !row.agentId));
  assert.equal(legacy.some((row) => row.value.includes('阿尔法')), false);

  const appendixA = compileTurnAppendix({ session: store.getSession(sessA.id), query: '', store });
  const appendixB = compileTurnAppendix({ session: store.getSession(sessB.id), query: '', store });
  const appendixPlain = compileTurnAppendix({ session: store.getSession(sessPlain.id), query: '', store });
  const appendixGamma = compileTurnAppendix({ session: store.getSession(sessGamma.id), query: '', store });

  assert.ok(appendixA.includes('阿尔法维护'));
  assert.ok(appendixA.includes(SCRATCH_A));
  assert.equal(appendixA.includes('贝塔只播报'), false);
  assert.equal(appendixA.includes('共享备忘'), false);
  assert.equal(appendixA.includes('伽马只记'), false);

  assert.ok(appendixB.includes('贝塔只播报'));
  assert.equal(appendixB.includes('阿尔法'), false);
  assert.equal(appendixB.includes('共享备忘'), false);
  assert.equal(appendixB.includes(SCRATCH_A), false);

  assert.ok(appendixPlain.includes('共享备忘'));
  assert.equal(appendixPlain.includes('阿尔法维护'), false);
  assert.equal(appendixPlain.includes('贝塔只播报'), false);

  assert.ok(appendixGamma.includes('伽马只记'));
  assert.equal(appendixGamma.includes('共享备忘'), false);
  assert.equal(appendixGamma.includes('阿尔法维护'), false);

  store.db.close();
});

test('bot memory_set and turn-end writer stamp agentId instead of shared user.memory', async () => {
  const { dir, store } = tmpStore();
  writeMemorySettings(store, { curatorMode: 'off', dreamerEnabled: false, dialogueExtract: true });
  const session = store.createSession({
    title: 'A',
    mode: 'chat',
    agentId: 'bot-a',
    metadata: { botId: 'bot-a', userId: 'u1' }
  });
  const tools = createMemoryTools({
    upsertSessionMemory: async (sessionId, scope, key, value, metadata) => {
      store.upsertSessionMemory({
        sessionId,
        scope,
        key,
        value,
        metadata,
        agentId: typeof metadata?.agentId === 'string' ? metadata.agentId : undefined
      });
    },
    listSessionMemory: async (sessionId, scope) => store.listSessionMemory(sessionId, scope),
    deleteSessionMemory: async (sessionId, scope, key) => store.deleteSessionMemory(sessionId, scope, key),
    upsertAgentMemory: async (input) => {
      store.agentMemory().set({
        scope: input.scope,
        namespace: input.namespace,
        key: input.key,
        value: input.value,
        sessionId: input.sessionId,
        userId: input.userId,
        tenantId: input.tenantId,
        agentId: input.agentId,
        importance: 0.6,
        confidence: 'medium',
        source: 'user_provided'
      });
    },
    botLookup: store
  });
  const memorySet = tools.find((tool) => tool.name === 'memory_set');
  const ctx = {
    repoRoot: '/repo',
    stateDir: dir,
    session,
    agent: { id: 'bot-a', name: 'A', role: 'Bot', instructions: '', capabilities: [] }
  };
  const written = await memorySet.execute(ctx, {
    scope: 'user',
    key: 'fact.gateway',
    value: FACT_A
  });
  assert.equal(written.ok, true);
  const scoped = store.agentMemory().search({
    scope: 'user.memory',
    userId: 'u1',
    agentId: 'bot-a',
    limit: 10
  });
  assert.ok(scoped.some((row) => row.value.includes('阿尔法维护') && row.agentId === 'bot-a'));
  const shared = store.agentMemory().search({
    scope: 'user.memory',
    userId: 'u1',
    agentUnscoped: true,
    limit: 10
  });
  assert.equal(shared.some((row) => row.value.includes('阿尔法维护')), false);

  const plain = store.createSession({
    title: 'plain',
    mode: 'chat',
    agentId: 'general',
    metadata: { userId: 'u1' }
  });
  const plainWritten = await memorySet.execute(
    { ...ctx, session: plain, agent: { ...ctx.agent, id: 'general' } },
    { scope: 'user', key: 'fact.shared', value: SHARED }
  );
  assert.equal(plainWritten.ok, true);
  const plainRows = store.agentMemory().search({
    scope: 'user.memory',
    userId: 'u1',
    agentUnscoped: true,
    limit: 10
  });
  assert.ok(plainRows.some((row) => row.value.includes('共享备忘') && !row.agentId));

  scheduleMemoryTurnEnd({
    store: store.agentMemory(),
    settingsStore: store,
    session,
    messages: [
      {
        id: 'm1',
        sessionId: session.id,
        role: 'user',
        parts: [{ type: 'text', text: '请记住我叫阿尔法' }],
        createdAt: new Date().toISOString()
      }
    ],
    agentId: 'bot-a',
    botLookup: store
  });
  const extracted = await waitFor(() =>
    store.agentMemory().search({ scope: 'user.memory', userId: 'u1', agentId: 'bot-a', limit: 20 })
      .find((row) => row.value.includes('阿尔法') && row.agentId === 'bot-a' && row.source === 'dialogue_extract')
  );
  assert.ok(extracted);
  store.db.close();
});

test('bot compact writes session.long before the lossy summary; plain chats do not', async () => {
  const { dir, store } = tmpStore();
  const session = store.createSession({
    title: 'A',
    mode: 'chat',
    agentId: 'bot-a',
    metadata: { botId: 'bot-a', userId: 'u1' }
  });
  store.appendMessage(session.id, 'user', [{ type: 'text', text: '支付回滚顺序写进清单' }]);
  store.appendMessage(session.id, 'assistant', [{ type: 'text', text: '已记下回滚顺序' }]);

  let sawNoteBeforeSummary = false;
  const adapter = {
    name: 'scripted',
    async runTurn() {
      return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'ok' }] };
    },
    async summarizeMessages() {
      const notes = store.agentMemory().search({
        sessionId: session.id,
        scope: 'session.long',
        limit: 20
      });
      sawNoteBeforeSummary = notes.some(
        (row) =>
          row.agentId === 'bot-a' &&
          String(row.key).startsWith('compact:') &&
          row.value.includes('支付回滚')
      );
      return 'SUM';
    }
  };
  const result = await autoCompactSession(compactHost(store, dir, adapter), runContext(dir, store.getSession(session.id)), {
    force: true
  });
  assert.equal(sawNoteBeforeSummary, true);
  assert.ok(result.replaced);

  const plain = store.createSession({
    title: 'plain',
    mode: 'chat',
    agentId: 'general',
    metadata: { userId: 'u1' }
  });
  store.appendMessage(plain.id, 'user', [{ type: 'text', text: '普通会话也压缩' }]);
  store.appendMessage(plain.id, 'assistant', [{ type: 'text', text: '好的' }]);
  let plainSummaries = 0;
  const plainAdapter = {
    name: 'scripted',
    async runTurn() {
      return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'ok' }] };
    },
    async summarizeMessages() {
      plainSummaries += 1;
      return 'PLAIN';
    }
  };
  const plainResult = await autoCompactSession(
    compactHost(store, dir, plainAdapter),
    runContext(dir, store.getSession(plain.id)),
    { force: true }
  );
  assert.equal(plainSummaries, 1);
  assert.ok(plainResult.replaced);
  const plainNotes = store.agentMemory().search({
    sessionId: plain.id,
    scope: 'session.long',
    limit: 20
  });
  assert.equal(plainNotes.some((row) => String(row.key).startsWith('compact:')), false);
  store.db.close();
});

test('session.long write failure does not abort compact', async () => {
  const { dir, store } = tmpStore();
  const session = store.createSession({
    title: 'A',
    mode: 'chat',
    agentId: 'bot-a',
    metadata: { botId: 'bot-a', userId: 'u1' }
  });
  store.appendMessage(session.id, 'user', [{ type: 'text', text: '支付回滚顺序写进清单' }]);
  store.appendMessage(session.id, 'assistant', [{ type: 'text', text: '已记下回滚顺序' }]);

  const am = store.agentMemory();
  const orig = am.set.bind(am);
  let attempted = false;
  am.set = (memory) => {
    if (memory?.scope === 'session.long' && String(memory?.key ?? '').startsWith('compact:')) {
      attempted = true;
      throw new Error('disk full');
    }
    return orig(memory);
  };
  let summaries = 0;
  const adapter = {
    name: 'scripted',
    async runTurn() {
      return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'ok' }] };
    },
    async summarizeMessages() {
      summaries += 1;
      return 'SUM';
    }
  };
  const result = await autoCompactSession(compactHost(store, dir, adapter), runContext(dir, store.getSession(session.id)), {
    force: true
  });
  assert.equal(attempted, true);
  assert.equal(summaries, 1);
  assert.ok(result.replaced);
  store.db.close();
});

function compactHost(store, dir, adapter) {
  return {
    store,
    stateDir: dir,
    modelAdapter: adapter,
    extensionRegistry: createExtensionRegistry(),
    turnShapeBySession: new Map(),
    emitTrace() {},
    prepareMessagesForModel: async (_session, messages) => messages
  };
}

function runContext(dir, session) {
  return {
    repoRoot: '/repo',
    stateDir: dir,
    session,
    agent: {
      id: session.agentId,
      name: session.agentId,
      role: 'assistant',
      instructions: '',
      capabilities: []
    }
  };
}

async function waitFor(read, ms = 1500) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return null;
}
