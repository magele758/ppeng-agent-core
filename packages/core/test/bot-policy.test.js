import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import { ValidationError } from '../dist/errors.js';
import { createBot, openBot, updateBot } from '../dist/bots/index.js';
import { spawnSubagent } from '../dist/runtime/spawn-host.js';
import { parseSessionMaxTurns, resolveSessionMaxTurns } from '../dist/runtime/session-max-turns.js';
import { filterToolsForSession } from '../dist/turn/resolve-turn-tools.js';

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'bot-policy-'));
  return new SqliteStateStore(join(dir, 'state.db'));
}

function facadeHost(store) {
  return {
    store,
    runImageRetention: async () => {},
    wakeAllAutonomousSessions: () => {},
    wakeAgentSessions: () => {}
  };
}

function parentSession(store, metadata) {
  store.upsertAgent({
    id: 'general',
    name: 'General',
    role: 'general',
    instructions: '',
    capabilities: []
  });
  const session = store.createSession({
    title: 'parent',
    mode: 'chat',
    agentId: 'general',
    metadata
  });
  store.upsertSessionMemory({ sessionId: session.id, scope: 'scratch', key: 'alpha', value: 'A' });
  store.upsertSessionMemory({ sessionId: session.id, scope: 'scratch', key: 'beta', value: 'B' });
  return store.getSession(session.id);
}

function scratchKeys(store, sessionId) {
  return store
    .listSessionMemory(sessionId, 'scratch')
    .map((row) => row.key)
    .sort();
}

async function spawnChild(store, session, opts) {
  await spawnSubagent(
    {
      store,
      repoRoot: '/tmp',
      stateDir: '/tmp',
      workspaceManager: {},
      sandbox: undefined,
      setSandbox() {},
      backgroundJobAborts: new Map(),
      async runSession(id) {
        return store.getSession(id);
      }
    },
    {
      repoRoot: '/tmp',
      stateDir: '/tmp',
      session,
      agent: {
        id: 'general',
        name: 'General',
        role: 'general',
        instructions: '',
        capabilities: []
      }
    },
    'do the thing',
    undefined,
    opts
  );
  const child = store.listSessions().find((item) => item.parentSessionId === session.id);
  assert.ok(child);
  return child;
}

test('bot spawn downgrades bypass and auto to ask and does not copy full scratch', async () => {
  const store = tempStore();
  const bypassParent = parentSession(store, {
    canonicalBotChat: true,
    botId: 'researcher',
    permissionMode: 'bypass'
  });
  const bypassChild = await spawnChild(store, bypassParent);
  assert.equal(bypassChild.metadata.permissionMode, 'ask');
  assert.deepEqual(scratchKeys(store, bypassChild.id), []);

  const autoParent = parentSession(store, {
    botId: 'researcher',
    permissionMode: 'auto'
  });
  const autoChild = await spawnChild(store, autoParent);
  assert.equal(autoChild.metadata.permissionMode, 'ask');
  assert.deepEqual(scratchKeys(store, autoChild.id), []);

  const askParent = parentSession(store, {
    canonicalBotChat: true,
    botId: 'researcher',
    permissionMode: 'ask'
  });
  const askChild = await spawnChild(store, askParent);
  assert.equal(askChild.metadata.permissionMode, 'ask');
  assert.deepEqual(scratchKeys(store, askChild.id), []);
  store.db.close();
});

test('bot spawn copies scratch only through a caller-supplied key filter', async () => {
  const store = tempStore();
  const parent = parentSession(store, {
    canonicalBotChat: true,
    botId: 'researcher',
    permissionMode: 'bypass'
  });
  const child = await spawnChild(store, parent, {
    scratchKeyFilter: (key) => key === 'alpha'
  });
  assert.equal(child.metadata.permissionMode, 'ask');
  assert.deepEqual(scratchKeys(store, child.id), ['alpha']);
  store.db.close();
});

test('non-bot spawn still inherits bypass and copies scratch', async () => {
  const store = tempStore();
  const parent = parentSession(store, { permissionMode: 'bypass' });
  const child = await spawnChild(store, parent);
  assert.equal(child.metadata.permissionMode, 'bypass');
  assert.deepEqual(scratchKeys(store, child.id), ['alpha', 'beta']);
  store.db.close();
});

test('maxTurns rejects illegal values and the kernel resolver adopts 24, 48, and 96', () => {
  for (const bad of [0, 10, 25, 100, 'nope', 24.5, true]) {
    assert.throws(() => parseSessionMaxTurns(bad), ValidationError);
    assert.throws(() => resolveSessionMaxTurns({ maxTurns: bad }, 24), ValidationError);
  }
  assert.equal(parseSessionMaxTurns(24), 24);
  assert.equal(parseSessionMaxTurns('48'), 48);
  assert.equal(parseSessionMaxTurns(96), 96);
  assert.equal(resolveSessionMaxTurns(undefined, 24), 24);
  assert.equal(resolveSessionMaxTurns({}, 24), 24);
  assert.equal(resolveSessionMaxTurns({ maxTurns: '' }, 24), 24);
  assert.equal(resolveSessionMaxTurns({ maxTurns: 48 }, 24), 48);
  assert.equal(resolveSessionMaxTurns({ maxTurns: 96 }, 7), 96);
});

test('allowedTools rejects unknown names; empty keeps the full tool set', () => {
  const store = tempStore();
  const host = facadeHost(store);
  const bot = createBot(host, { name: 'Tools' });
  const catalog = [{ name: 'read_file' }, { name: 'bash' }];
  assert.throws(
    () => updateBot(host, bot.id, { allowedTools: ['nope'] }, { toolCatalog: catalog }),
    ValidationError
  );
  assert.equal(store.getSession(bot.canonicalSessionId).metadata.allowedTools, undefined);

  updateBot(host, bot.id, { allowedTools: ['read_file'] }, { toolCatalog: catalog });
  assert.deepEqual(store.getSession(bot.canonicalSessionId).metadata.allowedTools, ['read_file']);
  assert.deepEqual(store.getAgent(bot.id).allowedTools, ['read_file']);

  updateBot(host, bot.id, { maxTurns: 48, allowedTools: [] }, { toolCatalog: catalog });
  assert.equal(store.getSession(bot.canonicalSessionId).metadata.maxTurns, 48);
  assert.deepEqual(store.getSession(bot.canonicalSessionId).metadata.allowedTools, []);
  assert.equal(store.getAgent(bot.id).allowedTools, undefined);

  const kept = filterToolsForSession({
    env: {},
    tools: [{ name: 'read_file' }, { name: 'bash' }],
    agent: store.getAgent(bot.id),
    session: store.getSession(bot.canonicalSessionId)
  });
  assert.deepEqual(
    kept.tools.map((tool) => tool.name),
    ['read_file', 'bash']
  );

  updateBot(host, bot.id, { allowedTools: ['bash'] }, { toolCatalog: catalog });
  const narrowed = filterToolsForSession({
    env: {},
    tools: [{ name: 'read_file' }, { name: 'bash' }],
    agent: store.getAgent(bot.id),
    session: store.getSession(bot.canonicalSessionId)
  });
  assert.deepEqual(
    narrowed.tools.map((tool) => tool.name),
    ['bash']
  );

  const userChat = openBot(host, bot.id, { userId: 'user_a' });
  const copied = store.getSession(userChat.sessionId);
  assert.equal(copied.metadata.permissionMode, 'auto');
  assert.equal(copied.metadata.maxTurns, 48);
  assert.deepEqual(copied.metadata.allowedTools, ['bash']);
  store.db.close();
});

test('updateBot rejects an illegal maxTurns before writing it', () => {
  const store = tempStore();
  const host = facadeHost(store);
  const bot = createBot(host, { name: 'Cap' });
  assert.throws(() => updateBot(host, bot.id, { maxTurns: 12 }), ValidationError);
  assert.equal(store.getSession(bot.canonicalSessionId).metadata.maxTurns, 24);
  store.db.close();
});
