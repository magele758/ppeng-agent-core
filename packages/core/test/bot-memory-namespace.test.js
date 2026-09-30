import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
import { createToolServices } from '../dist/runtime/tool-services.js';
import { resolveBotMemoryAgentId } from '../dist/memory/bot-memory-scope.js';
import { dreamNowForUser } from '../dist/memory/memory-dreamer.js';
import { shortCompactConclusion, shortCompactSummaryConclusion } from '../dist/runtime/compact-host.js';
import { spawnSubagentOutcome, spawnTeammate } from '../dist/runtime/spawn-host.js';
import { recallProgressive } from '../dist/memory/memory-recall.js';
import { SessionMemoryBridge } from '../dist/memory/session-memory-bridge.js';
import { applyMigrations, getCurrentSchemaVersion, LATEST_SCHEMA_VERSION } from '../dist/stores/migrations/index.js';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

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

test('bot compact writes session.long before the lossy replace; plain chats do not', async () => {
  const { dir, store } = tmpStore();
  const session = store.createSession({
    title: 'A',
    mode: 'chat',
    agentId: 'bot-a',
    metadata: { botId: 'bot-a', userId: 'u1' }
  });
  store.appendMessage(session.id, 'user', [{ type: 'text', text: '支付回滚顺序写进清单' }]);
  store.appendMessage(session.id, 'assistant', [{ type: 'text', text: '已记下回滚顺序' }]);

  let sawNoteBeforeReplace = false;
  const origReplace = store.appendReplacement.bind(store);
  store.appendReplacement = (...args) => {
    const notes = store.agentMemory().search({
      sessionId: session.id,
      scope: 'session.long',
      limit: 20
    });
    sawNoteBeforeReplace = notes.some(
      (row) =>
        row.agentId === 'bot-a' &&
        String(row.key).startsWith('compact:') &&
        row.value.includes('回滚顺序已定稿')
    );
    return origReplace(...args);
  };
  const adapter = {
    name: 'scripted',
    async runTurn() {
      return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'ok' }] };
    },
    async summarizeMessages() {
      return '## 摘要\n支付回滚顺序已定稿：先切流再回滚库。';
    }
  };
  const result = await autoCompactSession(compactHost(store, dir, adapter), runContext(dir, store.getSession(session.id)), {
    force: true
  });
  assert.equal(sawNoteBeforeReplace, true);
  assert.ok(result.replaced);
  store.appendReplacement = origReplace;

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

function registerBot(store, id) {
  const now = new Date().toISOString();
  store.createBot({
    id,
    name: id,
    title: id,
    description: '',
    agentId: id,
    canonicalSessionId: `canon-${id}`,
    hidden: false,
    createdAt: now,
    updatedAt: now
  });
}

function realMemoryTools(store) {
  const services = createToolServices({
    store,
    stateDir: '/tmp',
    resolveSkillLoad: async () => ({}),
    resolveSkillSearch: async () => ({ content: '' }),
    unblockDependentTasks: async () => {},
    spawnSubagent: async () => '',
    spawnTeammate: async () => '',
    startBackgroundJob: async () => ({})
  });
  const tools = createMemoryTools(services);
  const byName = (name) => tools.find((tool) => tool.name === name);
  return {
    set: byName('memory_set'),
    get: byName('memory_get'),
    handoff: byName('handoff_state'),
    prefetch: byName('memory_prefetch')
  };
}

function toolCtx(dir, session) {
  return {
    repoRoot: '/repo',
    stateDir: dir,
    session,
    agent: { id: session.agentId, name: session.agentId, role: 'Bot', instructions: '', capabilities: [] }
  };
}

test('same-prefix agent ids and blank agent ids never cross namespaces', () => {
  const { store } = tmpStore();
  const am = store.agentMemory();
  saveSemanticFact(am, { userId: 'u1', category: 'fact', content: '短前缀机器人记住苹果派', agentId: 'bot-a' });
  saveSemanticFact(am, { userId: 'u1', category: 'fact', content: '长前缀机器人记住香蕉船', agentId: 'bot-ab' });
  saveSemanticFact(am, { userId: 'u1', category: 'fact', content: '空白身份写入共享樱桃酱', agentId: '   ' });

  const rowsA = am.search({ scope: 'user.memory', userId: 'u1', agentId: 'bot-a', limit: 20 });
  assert.equal(rowsA.length, 1);
  assert.ok(rowsA[0].value.includes('苹果派'));
  const rowsAb = am.search({ scope: 'user.memory', userId: 'u1', agentId: 'bot-ab', limit: 20 });
  assert.equal(rowsAb.length, 1);
  assert.ok(rowsAb[0].value.includes('香蕉船'));
  const shared = am.search({ scope: 'user.memory', userId: 'u1', agentUnscoped: true, limit: 20 });
  assert.equal(shared.length, 1);
  assert.ok(shared[0].value.includes('樱桃酱'));
  assert.equal(shared[0].agentId, undefined);

  // FTS path must honour the same filter as the LIKE/list path.
  const ftsHit = am.search({ scope: 'user.memory', userId: 'u1', agentId: 'bot-a', query: '香蕉船', limit: 20 });
  assert.equal(ftsHit.length, 0);
  const ftsOwn = am.search({ scope: 'user.memory', userId: 'u1', agentId: 'bot-ab', query: '香蕉船', limit: 20 });
  assert.equal(ftsOwn.length, 1);

  const sessA = store.createSession({ title: 'a', mode: 'chat', agentId: 'bot-a', metadata: { botId: 'bot-a', userId: 'u1' } });
  const appendix = compileTurnAppendix({ session: sessA, query: '', store });
  assert.ok(appendix.includes('苹果派'));
  assert.equal(appendix.includes('香蕉船'), false);
  assert.equal(appendix.includes('樱桃酱'), false);
  store.db.close();
});

test('memory_get / memory_prefetch through real tool services stay inside the bot namespace', async () => {
  const { dir, store } = tmpStore();
  registerBot(store, 'bot-a');
  registerBot(store, 'bot-b');
  const am = store.agentMemory();
  const sessA = store.createSession({ title: 'a', mode: 'chat', agentId: 'bot-a', metadata: { botId: 'bot-a', userId: 'u1' } });
  const sessB = store.createSession({ title: 'b', mode: 'chat', agentId: 'bot-b', metadata: { botId: 'bot-b', userId: 'u1' } });
  const plain = store.createSession({ title: 'p', mode: 'chat', agentId: 'general', metadata: { userId: 'u1' } });
  const { set, get, prefetch } = realMemoryTools(store);

  for (const [sess, value] of [
    [sessA, '阿尔法的独门配方甲'],
    [sessB, '贝塔的独门配方乙'],
    [plain, '共享区的独门配方丙']
  ]) {
    const res = await set.execute(toolCtx(dir, sess), { scope: 'user', key: `recipe.${sess.id}`, value });
    assert.equal(res.ok, true);
    const team = await set.execute(toolCtx(dir, sess), { scope: 'team', key: `team.${sess.id}`, value: `${value}团队版` });
    assert.equal(team.ok, true);
  }

  // Writes are stamped: no bot value landed in the shared pool.
  const sharedRows = am.search({ scope: 'user.memory', userId: 'u1', agentUnscoped: true, limit: 50 });
  assert.deepEqual(sharedRows.map((row) => row.value), ['共享区的独门配方丙']);

  // memory_get lists rows stamped with this session id, so only own namespace is visible.
  am.set({
    scope: 'user.memory', namespace: 'default', key: 'leak', value: '共享区泄漏探针', userId: 'u1',
    sessionId: sessA.id, importance: 0.9, confidence: 'medium', source: 'user_provided'
  });
  const listed = await get.execute(toolCtx(dir, sessA), { scope: 'user' });
  assert.ok(listed.content.includes('阿尔法的独门配方甲'));
  assert.equal(listed.content.includes('贝塔'), false);
  assert.equal(listed.content.includes('泄漏探针'), false);

  const fetchedA = await prefetch.execute(toolCtx(dir, sessA), { query: '独门配方' });
  assert.ok(fetchedA.content.includes('阿尔法'));
  assert.equal(fetchedA.content.includes('贝塔'), false);
  assert.equal(fetchedA.content.includes('共享区'), false);
  const fetchedB = await prefetch.execute(toolCtx(dir, sessB), { query: '独门配方' });
  assert.ok(fetchedB.content.includes('贝塔'));
  assert.equal(fetchedB.content.includes('阿尔法'), false);
  assert.equal(fetchedB.content.includes('共享区'), false);
  const fetchedPlain = await prefetch.execute(toolCtx(dir, plain), { query: '独门配方' });
  assert.ok(fetchedPlain.content.includes('共享区'));
  assert.equal(fetchedPlain.content.includes('阿尔法'), false);
  assert.equal(fetchedPlain.content.includes('贝塔'), false);
  store.db.close();
});

test('bot-spawned subagent and teammate sessions inherit the bot namespace', async () => {
  const { dir, store } = tmpStore();
  registerBot(store, 'bot-a');
  const botSession = store.createSession({ title: 'a', mode: 'chat', agentId: 'bot-a', metadata: { botId: 'bot-a', userId: 'u1' } });
  const plain = store.createSession({ title: 'p', mode: 'chat', agentId: 'general', metadata: { userId: 'u1' } });
  const sub = store.createSession({
    title: 'sub', mode: 'subagent', agentId: 'reviewer', parentSessionId: botSession.id,
    metadata: { parentSessionId: botSession.id, userId: 'u1' }
  });
  const grand = store.createSession({
    title: 'grand', mode: 'subagent', agentId: 'researcher', parentSessionId: sub.id,
    metadata: { parentSessionId: sub.id, userId: 'u1' }
  });
  const mate = store.createSession({
    title: 'mate', mode: 'teammate', agentId: 'helper', parentSessionId: botSession.id,
    metadata: { userId: 'u1' }
  });
  const plainChild = store.createSession({
    title: 'pc', mode: 'subagent', agentId: 'reviewer', parentSessionId: plain.id,
    metadata: { parentSessionId: plain.id, userId: 'u1' }
  });
  assert.equal(resolveBotMemoryAgentId(sub, store), 'bot-a');
  assert.equal(resolveBotMemoryAgentId(grand, store), 'bot-a');
  assert.equal(resolveBotMemoryAgentId(mate, store), 'bot-a');
  assert.equal(resolveBotMemoryAgentId(plainChild, store), undefined);
  assert.equal(resolveBotMemoryAgentId(plain, store), undefined);

  // A chat session pointing at a bot as "parent" (fork etc.) does not inherit.
  const forked = store.createSession({
    title: 'fork', mode: 'chat', agentId: 'general', parentSessionId: botSession.id, metadata: { userId: 'u1' }
  });
  assert.equal(resolveBotMemoryAgentId(forked, store), undefined);

  // Parent cycles terminate.
  const loopA = { id: 'la', mode: 'subagent', agentId: 'x', parentSessionId: 'lb', metadata: {} };
  const loopB = { id: 'lb', mode: 'subagent', agentId: 'y', parentSessionId: 'la', metadata: {} };
  const lookup = { getSession: (id) => (id === 'la' ? loopA : id === 'lb' ? loopB : undefined) };
  assert.equal(resolveBotMemoryAgentId(loopA, lookup), undefined);

  const { set } = realMemoryTools(store);
  const res = await set.execute(toolCtx(dir, sub), { scope: 'user', key: 'sub.note', value: '子代理沉淀的蓝鲸笔记' });
  assert.equal(res.ok, true);
  const am = store.agentMemory();
  const shared = am.search({ scope: 'user.memory', userId: 'u1', agentUnscoped: true, limit: 20 });
  assert.equal(shared.some((row) => row.value.includes('蓝鲸')), false);
  const own = am.search({ scope: 'user.memory', userId: 'u1', agentId: 'bot-a', limit: 20 });
  assert.ok(own.some((row) => row.value.includes('蓝鲸')));

  // Teammate recall sees the bot's rows, not the shared pool.
  saveSemanticFact(am, { userId: 'u1', category: 'fact', content: '机器人私有的蓝鲸备忘', agentId: 'bot-a' });
  saveSemanticFact(am, { userId: 'u1', category: 'fact', content: '共享池里的白鲸备忘' });
  const appendix = compileTurnAppendix({ session: store.getSession(mate.id), query: '', store });
  assert.ok(appendix.includes('蓝鲸'));
  assert.equal(appendix.includes('白鲸'), false);
  store.db.close();
});

test('message_agent style delivery into another bot session keeps the target namespace', () => {
  const { store } = tmpStore();
  registerBot(store, 'bot-a');
  registerBot(store, 'bot-b');
  const sessA = store.createSession({ title: 'a', mode: 'chat', agentId: 'bot-a', metadata: { botId: 'bot-a', userId: 'u1' } });
  const sessB = store.createSession({
    title: 'b', mode: 'chat', agentId: 'bot-b',
    metadata: { botId: 'bot-b', userId: 'u1', relayHop: 1, relayFromBotId: 'bot-a' }
  });
  store.appendMessage(sessB.id, 'user', [{ type: 'text', text: `来自 ${sessA.id} 的转发` }]);
  assert.equal(resolveBotMemoryAgentId(store.getSession(sessB.id), store), 'bot-b');
  assert.equal(resolveBotMemoryAgentId(store.getSession(sessA.id), store), 'bot-a');
  store.db.close();
});

test('session scratch rows dedupe across writers with and without agentId', () => {
  const { store } = tmpStore();
  const session = store.createSession({ title: 'a', mode: 'chat', agentId: 'bot-a', metadata: { botId: 'bot-a' } });
  store.upsertSessionMemory({ sessionId: session.id, scope: 'scratch', key: 'k', value: 'v1', metadata: { agentId: 'bot-a' } });
  store.upsertSessionMemory({ sessionId: session.id, scope: 'scratch', key: 'k', value: 'v2' });
  const rows = store.listSessionMemory(session.id, 'scratch');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, 'v2');
  assert.equal('agentId' in rows[0].metadata, false);
  const raw = store.agentMemory().search({ sessionId: session.id, scope: 'session.scratch', limit: 10 });
  assert.equal(raw.length, 1);
  assert.equal(raw[0].agentId, 'bot-a');

  // copy to a child keeps the stamp
  const child = store.createSession({ title: 'c', mode: 'subagent', agentId: 'r', parentSessionId: session.id });
  store.copySessionMemory(session.id, child.id, 'scratch');
  const copied = store.agentMemory().search({ sessionId: child.id, scope: 'session.scratch', limit: 10 });
  assert.equal(copied.length, 1);
  assert.equal(copied[0].agentId, 'bot-a');
  store.db.close();
});

test('handoff_state stamps the bot agent id', async () => {
  const { dir, store } = tmpStore();
  registerBot(store, 'bot-a');
  const session = store.createSession({ title: 'a', mode: 'chat', agentId: 'bot-a', metadata: { botId: 'bot-a', userId: 'u1' } });
  const { handoff } = realMemoryTools(store);
  const res = await handoff.execute(toolCtx(dir, session), { notes: '交接给下一位' });
  assert.equal(res.ok, true);
  const raw = store.agentMemory().search({ sessionId: session.id, scope: 'session.scratch', limit: 10 });
  assert.equal(raw.length, 1);
  assert.equal(raw[0].agentId, 'bot-a');
  store.db.close();
});

test('legacy session_memory backend stays session-bound and never leaks agent ids', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-mem-legacy-'));
  const store = new SqliteStateStore(join(dir, 'state.db'));
  const bridge = new SessionMemoryBridge(store.db, 'session');
  const a = bridge.upsertSessionMemory({ sessionId: 's-a', scope: 'scratch', key: 'k', value: 'A', metadata: { agentId: 'bot-a' } });
  bridge.upsertSessionMemory({ sessionId: 's-b', scope: 'scratch', key: 'k', value: 'B', metadata: { agentId: 'bot-b' } });
  assert.equal('agentId' in a.metadata, false);
  assert.deepEqual(bridge.listSessionMemory('s-a', 'scratch').map((row) => row.value), ['A']);
  assert.deepEqual(bridge.listSessionMemory('s-b', 'scratch').map((row) => row.value), ['B']);
  assert.equal(store.agentMemory().search({ scope: 'session.scratch', limit: 10 }).length, 0);

  const dual = new SessionMemoryBridge(store.db, 'dual');
  dual.upsertSessionMemory({ sessionId: 's-c', scope: 'long', key: 'k', value: 'C', agentId: 'bot-c' });
  assert.equal(dual.agentMemory.search({ sessionId: 's-c', scope: 'session.long', limit: 5 })[0].agentId, 'bot-c');
  assert.equal('agentId' in dual.listSessionMemory('s-c', 'long')[0].metadata, false);
  store.db.close();
});

test('dreamer keeps bot runs, facts and journals out of the shared user pool', async () => {
  const { dir, store } = tmpStore();
  const am = store.agentMemory();
  const text = 'user: 我喜欢在周五复盘网关回滚流程\nuser: 请记住我负责支付网关的值班交接';
  const plainRun = await dreamNowForUser({ store: am, userId: 'u1', messagesText: text, stateDir: dir, force: true });
  const botRun = await dreamNowForUser({ store: am, userId: 'u1', messagesText: text, stateDir: dir, force: true, agentId: 'bot-a' });
  const botRun2 = await dreamNowForUser({ store: am, userId: 'u1', messagesText: text, stateDir: dir, force: true, agentId: 'bot-b' });
  assert.equal(plainRun, 'processed');
  assert.equal(botRun, 'processed');
  assert.equal(botRun2, 'processed');
  const date = new Date().toISOString().slice(0, 10);
  assert.ok(existsSync(join(dir, 'memory-journals', 'u1', `${date}.md`)));
  assert.ok(existsSync(join(dir, 'memory-journals', 'u1', 'bots', 'bot-a', `${date}.md`)));
  assert.ok(existsSync(join(dir, 'memory-journals', 'u1', 'bots', 'bot-b', `${date}.md`)));
  assert.equal(am.latestDreamRun('u1').status, 'completed');
  assert.ok(am.latestDreamRun('u1::bot:bot-a'));

  const sharedDream = am.search({ scope: 'user.memory', userId: 'u1', agentUnscoped: true, limit: 50 }).filter((r) => r.source === 'dream');
  const botADream = am.search({ scope: 'user.memory', userId: 'u1', agentId: 'bot-a', limit: 50 }).filter((r) => r.source === 'dream');
  assert.ok(sharedDream.length > 0);
  assert.ok(botADream.length > 0);
  assert.ok(botADream.every((row) => row.agentId === 'bot-a'));
  store.db.close();
});

test('recall for a bot ignores working-journal files of the shared user', () => {
  const { dir, store } = tmpStore();
  const am = store.agentMemory();
  const journalDir = join(dir, 'memory-journals', 'u1');
  mkdirSync(journalDir, { recursive: true });
  writeFileSync(join(journalDir, '2026-01-01.md'), '共享日志提到灰狐计划\n', 'utf8');
  const plain = recallProgressive({ store: am, query: '灰狐计划', userId: 'u1', stateDir: dir });
  const bot = recallProgressive({ store: am, query: '灰狐计划', userId: 'u1', agentId: 'bot-a', stateDir: dir });
  assert.ok(plain.workingFile.includes('灰狐'));
  assert.equal(bot.workingFile, '');
  store.db.close();
});

test('schema v21 adds agent_id to an existing database, is re-entrant, and keeps legacy rows shared', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-mem-mig-'));
  new SqliteStateStore(join(dir, 'old.db')).db.close();
  const db = new DatabaseSync(join(dir, 'old.db'));
  db.exec(`DROP INDEX IF EXISTS idx_agent_memory_agent_id`);
  db.exec(`ALTER TABLE agent_memory DROP COLUMN agent_id`);
  db.exec(`DELETE FROM schema_version WHERE version >= 21`);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_memory (id, scope, namespace, key, value, user_id, importance, confidence, access_count, created_at, updated_at)
     VALUES ('legacy-1', 'user.memory', 'semantic', 'fact:old', '旧库里的共享记忆', 'u1', 0.7, 'medium', 0, ?, ?)`
  ).run(now, now);
  assert.ok(getCurrentSchemaVersion(db) < 21);

  applyMigrations(db);
  assert.equal(getCurrentSchemaVersion(db), LATEST_SCHEMA_VERSION);
  assert.ok(LATEST_SCHEMA_VERSION >= 21);
  const cols = db.prepare(`PRAGMA table_info(agent_memory)`).all().map((c) => c.name);
  assert.ok(cols.includes('agent_id'));
  const legacy = db.prepare(`SELECT agent_id FROM agent_memory WHERE id = 'legacy-1'`).get();
  assert.equal(legacy.agent_id, null);

  db.exec(`DELETE FROM schema_version WHERE version = 21`);
  applyMigrations(db);
  assert.equal(getCurrentSchemaVersion(db), LATEST_SCHEMA_VERSION);
  db.close();

  const store = new SqliteStateStore(join(dir, 'old.db'));
  const am = store.agentMemory();
  const session = store.createSession({ title: 'p', mode: 'chat', agentId: 'general', metadata: { userId: 'u1' } });
  const bot = store.createSession({ title: 'b', mode: 'chat', agentId: 'bot-a', metadata: { botId: 'bot-a', userId: 'u1' } });
  assert.ok(compileTurnAppendix({ session, query: '', store }).includes('旧库里的共享记忆'));
  assert.equal(compileTurnAppendix({ session: bot, query: '', store }).includes('旧库里的共享记忆'), false);
  assert.equal(am.search({ scope: 'user.memory', userId: 'u1', agentUnscoped: true, limit: 5 }).length, 1);
  store.db.close();
});

test('compact note is a short, idempotent conclusion without appendix text or full transcript', async () => {
  const { dir, store } = tmpStore();
  const session = store.createSession({ title: 'A', mode: 'chat', agentId: 'bot-a', metadata: { botId: 'bot-a', userId: 'u1' } });
  const long = '很长的回复'.repeat(400);
  store.appendMessage(session.id, 'user', [
    { type: 'text', text: '先确认发布窗口' },
    { type: 'text', text: '[memory appendix] 这段记忆附录不应进入结论' }
  ]);
  store.appendMessage(session.id, 'assistant', [{ type: 'text', text: long }]);
  for (let i = 0; i < 8; i += 1) {
    store.appendMessage(session.id, 'user', [{ type: 'text', text: `第${i}个追问` }]);
    store.appendMessage(session.id, 'assistant', [{ type: 'text', text: `第${i}个回答` }]);
  }
  const adapter = {
    name: 'heuristic',
    async runTurn() {
      return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'ok' }] };
    },
    async summarizeMessages() {
      return 'SUM';
    }
  };
  const first = await autoCompactSession(compactHost(store, dir, adapter), runContext(dir, store.getSession(session.id)), { force: true });
  assert.ok(first.replaced);
  const notes = () =>
    store.agentMemory().search({ sessionId: session.id, scope: 'session.long', limit: 50 }).filter((r) => String(r.key).startsWith('compact:'));
  assert.equal(notes().length, 1);
  const note = notes()[0];
  assert.ok(note.value.length <= 481);
  assert.equal(note.value.includes('记忆附录'), false);
  assert.ok(note.value.includes('先确认发布窗口'));
  assert.ok(note.value.length < long.length / 3);

  // A failed summary followed by a retry over the same range reuses the same note key.
  const retry = store.createSession({ title: 'R', mode: 'chat', agentId: 'bot-a', metadata: { botId: 'bot-a', userId: 'u1' } });
  for (let i = 0; i < 6; i += 1) {
    store.appendMessage(retry.id, 'user', [{ type: 'text', text: `重试问题${i}` }]);
    store.appendMessage(retry.id, 'assistant', [{ type: 'text', text: `重试回答${i}` }]);
  }
  let calls = 0;
  const flaky = {
    ...adapter,
    async summarizeMessages() {
      calls += 1;
      if (calls === 1) throw new Error('upstream down');
      return 'SUM2';
    }
  };
  await assert.rejects(
    autoCompactSession(compactHost(store, dir, flaky), runContext(dir, store.getSession(retry.id)), { force: true }),
    /upstream down/
  );
  const retryNotes = () =>
    store.agentMemory().search({ sessionId: retry.id, scope: 'session.long', limit: 50 }).filter((r) => String(r.key).startsWith('compact:'));
  assert.equal(retryNotes().length, 1);
  const firstKey = retryNotes()[0].key;
  const second = await autoCompactSession(compactHost(store, dir, flaky), runContext(dir, store.getSession(retry.id)), { force: true });
  assert.ok(second.replaced);
  assert.equal(retryNotes().length, 1);
  assert.equal(retryNotes()[0].key, firstKey);
  assert.equal(shortCompactConclusion([]), '');
  assert.equal(
    shortCompactConclusion([{ id: 'x', sessionId: 's', role: 'system', parts: [{ type: 'text', text: 'sys' }], createdAt: '', seq: 1 }]),
    ''
  );
  store.db.close();
});

function scriptedAdapter(summarize, name = 'scripted') {
  return {
    name,
    async runTurn() {
      return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'ok' }] };
    },
    summarizeMessages: summarize
  };
}

function seedBotChat(store, agentId = 'bot-a', turns = 3) {
  const session = store.createSession({ title: 'A', mode: 'chat', agentId, metadata: { botId: agentId, userId: 'u1' } });
  for (let i = 0; i < turns; i += 1) {
    store.appendMessage(session.id, 'user', [{ type: 'text', text: `原始问题${i}` }]);
    store.appendMessage(session.id, 'assistant', [{ type: 'text', text: `原始回答${i}` }]);
  }
  return session;
}

const compactNotes = (store, sessionId) =>
  store.agentMemory().search({ sessionId, scope: 'session.long', limit: 50 }).filter((r) => String(r.key).startsWith('compact:'));

test('compact note prefers the LLM summary and stays bounded', async () => {
  const { dir, store } = tmpStore();
  const session = seedBotChat(store);
  const summary = `# 会话摘要\n- 发布窗口定在周五晚\n- 回滚负责人是阿尔法\n${'很长的细节'.repeat(200)}\n第四行\n第五行不应进入`;
  let calls = 0;
  const adapter = scriptedAdapter(async () => {
    calls += 1;
    return summary;
  });
  const result = await autoCompactSession(compactHost(store, dir, adapter), runContext(dir, store.getSession(session.id)), { force: true });
  assert.ok(result.replaced);
  assert.equal(calls, 1);
  const notes = compactNotes(store, session.id);
  assert.equal(notes.length, 1);
  assert.ok(notes[0].value.includes('发布窗口定在周五晚'));
  assert.ok(notes[0].value.includes('回滚负责人是阿尔法'));
  assert.equal(notes[0].value.includes('原始问题'), false);
  assert.equal(notes[0].value.includes('第五行'), false);
  assert.equal(notes[0].value.startsWith('#'), false);
  assert.ok(notes[0].value.length <= 481);
  assert.equal(notes[0].agentId, 'bot-a');
  assert.equal(shortCompactSummaryConclusion('  \n  '), '');
  store.db.close();
});

test('compact note falls back to the heuristic cut without a usable summary', async () => {
  const { dir, store } = tmpStore();
  for (const [label, adapter] of [
    ['blank summary', scriptedAdapter(async () => '   ')],
    ['heuristic model', scriptedAdapter(async () => 'Summary for compact: user: 噪声 | assistant: 噪声', 'heuristic')]
  ]) {
    const session = seedBotChat(store);
    const result = await autoCompactSession(compactHost(store, dir, adapter), runContext(dir, store.getSession(session.id)), { force: true });
    assert.ok(result.replaced, label);
    const notes = compactNotes(store, session.id);
    assert.equal(notes.length, 1, label);
    assert.ok(notes[0].value.startsWith('压缩前结论'), label);
    assert.ok(notes[0].value.includes('原始问题0'), label);
    assert.equal(notes[0].value.includes('噪声'), false, label);
  }
  store.db.close();
});

test('failed summary keeps a heuristic note, and a same-range retry replaces it with the summary', async () => {
  const { dir, store } = tmpStore();
  const session = seedBotChat(store);
  let calls = 0;
  const adapter = scriptedAdapter(async () => {
    calls += 1;
    if (calls === 1) throw new Error('summary timeout');
    return '重试后的真实摘要';
  });
  await assert.rejects(
    autoCompactSession(compactHost(store, dir, adapter), runContext(dir, store.getSession(session.id)), { force: true }),
    /summary timeout/
  );
  const afterFail = compactNotes(store, session.id);
  assert.equal(afterFail.length, 1);
  assert.ok(afterFail[0].value.startsWith('压缩前结论'));
  assert.equal(store.foldMessages(session.id).length, 6);

  const ok = await autoCompactSession(compactHost(store, dir, adapter), runContext(dir, store.getSession(session.id)), { force: true });
  assert.ok(ok.replaced);
  const afterRetry = compactNotes(store, session.id);
  assert.equal(afterRetry.length, 1);
  assert.equal(afterRetry[0].key, afterFail[0].key);
  assert.ok(afterRetry[0].value.includes('重试后的真实摘要'));
  store.db.close();
});

test('summary-based note write failure warns and still compacts; no extra model call', async () => {
  const { dir, store } = tmpStore();
  const session = seedBotChat(store);
  const am = store.agentMemory();
  const orig = am.set.bind(am);
  let attempted = 0;
  am.set = (memory) => {
    if (memory?.scope === 'session.long' && String(memory?.key ?? '').startsWith('compact:')) {
      attempted += 1;
      throw new Error('disk full');
    }
    return orig(memory);
  };
  let summaries = 0;
  const adapter = scriptedAdapter(async () => {
    summaries += 1;
    return '有摘要';
  });
  const result = await autoCompactSession(compactHost(store, dir, adapter), runContext(dir, store.getSession(session.id)), { force: true });
  assert.equal(attempted, 1);
  assert.equal(summaries, 1);
  assert.ok(result.replaced);
  const folded = store.foldMessages(session.id);
  assert.ok(folded.some((m) => m.parts.some((p) => p.type === 'text' && p.text.includes('有摘要'))));
  store.db.close();
});

function spawnHost(store) {
  return {
    store,
    repoRoot: '/repo',
    stateDir: '/tmp',
    runSession: async () => store.getSession('unused'),
    runImageRetention: async () => {},
    wakeAllAutonomousSessions() {},
    wakeAgentSessions() {}
  };
}

test('bot-spawned subagent and teammate inherit userId/tenantId and read the bot user memory', async () => {
  const saved = process.env.RAW_AGENT_DEFAULT_USER_ID;
  delete process.env.RAW_AGENT_DEFAULT_USER_ID;
  try {
    const { dir, store } = tmpStore();
    registerBot(store, 'bot-a');
    const am = store.agentMemory();
    saveSemanticFact(am, { userId: 'u1', category: 'fact', content: '机器人私有的琥珀备忘', agentId: 'bot-a', tenantId: 't1' });
    saveSemanticFact(am, { userId: 'u1', category: 'fact', content: '共享池里的珊瑚备忘', tenantId: 't1' });
    const bot = store.createSession({
      title: 'a', mode: 'chat', agentId: 'bot-a', metadata: { botId: 'bot-a', userId: 'u1', tenantId: 't1' }
    });
    const host = spawnHost(store);
    const ctx = { repoRoot: '/repo', stateDir: dir, session: bot, agent: { id: 'bot-a', name: 'a', role: 'Bot', instructions: '', capabilities: [] } };

    const out = await spawnSubagentOutcome(host, ctx, '查一下', 'researcher');
    assert.equal(out.ok === true || out.ok === false, true);
    const sub = store.listSessions().find((s) => s.mode === 'subagent' && s.parentSessionId === bot.id);
    assert.equal(sub.metadata.userId, 'u1');
    assert.equal(sub.metadata.tenantId, 't1');
    const subAppendix = compileTurnAppendix({ session: store.getSession(sub.id), query: '', store });
    assert.ok(subAppendix.includes('琥珀备忘'));
    assert.equal(subAppendix.includes('珊瑚备忘'), false);

    const { set } = realMemoryTools(store);
    const written = await set.execute(toolCtx(dir, store.getSession(sub.id)), { scope: 'user', key: 'sub.k', value: '子代理写入的海螺笔记' });
    assert.equal(written.ok, true);
    assert.ok(am.search({ scope: 'user.memory', userId: 'u1', agentId: 'bot-a', limit: 20 }).some((r) => r.value.includes('海螺')));

    await spawnTeammate(host, ctx, { name: 'mate-x', role: 'helper', prompt: '协助' });
    const mate = store.listSessions().find((s) => s.mode === 'teammate' && s.parentSessionId === bot.id);
    assert.equal(mate.metadata.userId, 'u1');
    assert.equal(mate.metadata.tenantId, 't1');
    assert.ok(compileTurnAppendix({ session: store.getSession(mate.id), query: '', store }).includes('琥珀备忘'));

    // Nested: a subagent of the bot's subagent keeps inheriting.
    const subCtx = { ...ctx, session: store.getSession(sub.id), agent: { ...ctx.agent, id: 'researcher' } };
    await spawnSubagentOutcome(host, subCtx, '再查', 'researcher');
    const grand = store.listSessions().find((s) => s.mode === 'subagent' && s.parentSessionId === sub.id);
    assert.equal(grand.metadata.userId, 'u1');
    store.db.close();
  } finally {
    if (saved === undefined) delete process.env.RAW_AGENT_DEFAULT_USER_ID;
    else process.env.RAW_AGENT_DEFAULT_USER_ID = saved;
  }
});

test('non-bot subagent and teammate spawn keep today metadata; bot without userId does not throw', async () => {
  const { dir, store } = tmpStore();
  registerBot(store, 'bot-a');
  const host = spawnHost(store);
  const plain = store.createSession({ title: 'p', mode: 'chat', agentId: 'general', metadata: { userId: 'u1', tenantId: 't1' } });
  const agent = { id: 'general', name: 'g', role: 'assistant', instructions: '', capabilities: [] };
  await spawnSubagentOutcome(host, { repoRoot: '/repo', stateDir: dir, session: plain, agent }, '任务', 'researcher');
  const plainSub = store.listSessions().find((s) => s.mode === 'subagent' && s.parentSessionId === plain.id);
  assert.equal('userId' in plainSub.metadata, false);
  assert.equal('tenantId' in plainSub.metadata, false);
  await spawnTeammate(host, { repoRoot: '/repo', stateDir: dir, session: plain, agent }, { name: 'mate-p', role: 'helper', prompt: '协助' });
  const plainMate = store.listSessions().find((s) => s.mode === 'teammate' && s.parentSessionId === plain.id);
  assert.equal('userId' in plainMate.metadata, false);
  assert.equal('tenantId' in plainMate.metadata, false);

  const anon = store.createSession({ title: 'anon', mode: 'chat', agentId: 'bot-a', metadata: { botId: 'bot-a' } });
  const botAgent = { id: 'bot-a', name: 'a', role: 'Bot', instructions: '', capabilities: [] };
  await spawnSubagentOutcome(host, { repoRoot: '/repo', stateDir: dir, session: anon, agent: botAgent }, '任务', 'researcher');
  const anonSub = store.listSessions().find((s) => s.mode === 'subagent' && s.parentSessionId === anon.id);
  assert.ok(anonSub);
  assert.equal('userId' in anonSub.metadata, false);
  assert.equal('tenantId' in anonSub.metadata, false);
  store.db.close();
});

test('recall under the legacy session backend reads session_memory scratch/long', () => {
  const saved = process.env.RAW_AGENT_MEMORY_BACKEND;
  process.env.RAW_AGENT_MEMORY_BACKEND = 'session';
  try {
    const dir = mkdtempSync(join(tmpdir(), 'bot-mem-sess-'));
    const store = new SqliteStateStore(join(dir, 'state.db'));
    const session = store.createSession({ title: 'p', mode: 'chat', agentId: 'general', metadata: { userId: 'u1' } });
    store.upsertSessionMemory({ sessionId: session.id, scope: 'scratch', key: 'plan', value: '旧后端的橘子草稿' });
    store.upsertSessionMemory({ sessionId: session.id, scope: 'long', key: 'decision', value: '旧后端的柠檬结论' });
    store.upsertSessionMemory({ sessionId: session.id, scope: 'scratch', key: 'ptc.hidden', value: '旧后端的隐藏临时值' });
    assert.equal(store.agentMemory().search({ sessionId: session.id, limit: 10 }).length, 0);
    const appendix = compileTurnAppendix({ session: store.getSession(session.id), query: '', store });
    assert.ok(appendix.includes('橘子草稿'));
    assert.ok(appendix.includes('柠檬结论'));
    assert.equal(appendix.includes('隐藏临时值'), false);
    store.db.close();
  } finally {
    if (saved === undefined) delete process.env.RAW_AGENT_MEMORY_BACKEND;
    else process.env.RAW_AGENT_MEMORY_BACKEND = saved;
  }
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
