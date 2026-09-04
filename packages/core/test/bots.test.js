import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import { ConflictError, ValidationError } from '../dist/errors.js';
import {
  BOT_ROSTER_CAP,
  canonicalBotChatTitle,
  createBot,
  getBot,
  listBots,
  openBot,
  slugifyBotName,
  updateBot
} from '../dist/bots/index.js';
import { getCurrentSchemaVersion, LATEST_SCHEMA_VERSION } from '../dist/stores/migrations/index.js';

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'bots-'));
  return new SqliteStateStore(join(dir, 'state.db'));
}

function host(store) {
  return {
    store,
    runImageRetention: async () => {},
    wakeAllAutonomousSessions: () => {},
    wakeAgentSessions: () => {}
  };
}

test('slugifyBotName: ascii names become stable ids', () => {
  assert.equal(slugifyBotName('Researcher'), 'researcher');
  assert.equal(slugifyBotName('Office Manager'), 'office-manager');
  assert.equal(slugifyBotName('调研助手'), '');
});

test('schema v15 creates bots table', () => {
  const store = tempStore();
  assert.equal(getCurrentSchemaVersion(store.db), LATEST_SCHEMA_VERSION);
  assert.ok(LATEST_SCHEMA_VERSION >= 15);
  const row = store.db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='bots'`)
    .get();
  assert.ok(row);
  store.db.close();
});

test('createBot: agent 1:1 + canonical session', () => {
  const store = tempStore();
  const bot = createBot(host(store), {
    name: 'Researcher',
    title: '资料员',
    description: '读文档、做摘要'
  });
  assert.equal(bot.id, 'researcher');
  assert.equal(bot.agentId, 'researcher');
  assert.equal(bot.name, 'Researcher');
  assert.equal(bot.hidden, false);

  const agent = store.getAgent('researcher');
  assert.ok(agent);
  assert.equal(agent.domainId, 'bot');
  assert.match(agent.instructions, /资料员|读文档/);

  const session = store.getSession(bot.canonicalSessionId);
  assert.ok(session);
  assert.equal(session.title, canonicalBotChatTitle('Researcher'));
  assert.equal(session.agentId, 'researcher');
  assert.equal(session.metadata.botId, 'researcher');
  assert.equal(session.metadata.canonicalBotChat, true);
  assert.equal(session.metadata.sessionCut, true);
  assert.equal(session.metadata.permissionMode, 'bypass');
  assert.equal(agent.autonomous, true);
  assert.ok(agent.capabilities.includes('task-management'));
  assert.ok(agent.capabilities.includes('orchestration'));
  assert.match(agent.instructions, /bypass|full permission/i);
  assert.equal(store.listMessages(session.id).length, 0);
  store.db.close();
});

test('createBot: duplicate name is conflict; hidden excluded from default list', () => {
  const store = tempStore();
  const h = host(store);
  createBot(h, { name: 'Alpha' });
  assert.throws(() => createBot(h, { name: 'alpha' }), ConflictError);
  const hidden = createBot(h, { name: 'Beta' });
  updateBot(h, hidden.id, { hidden: true });
  assert.deepEqual(
    listBots(store).map((b) => b.name),
    ['Alpha']
  );
  assert.equal(listBots(store, { includeHidden: true }).length, 2);
  store.db.close();
});

test('openBot: upgrades existing session to bypass and sessionCut', () => {
  const store = tempStore();
  const h = host(store);
  const bot = createBot(h, { name: 'Elevator' });
  const prior = store.getSession(bot.canonicalSessionId);
  store.updateSession(bot.canonicalSessionId, {
    metadata: { ...prior.metadata, permissionMode: 'ask', sessionCut: false }
  });
  const opened = openBot(h, bot.id);
  assert.equal(opened.createdSession, false);
  const next = store.getSession(opened.sessionId);
  assert.equal(next.metadata.permissionMode, 'bypass');
  assert.equal(next.metadata.sessionCut, true);
  store.db.close();
});

test('openBot: per-user chats do not share the canonical session', () => {
  const store = tempStore();
  const h = host(store);
  const bot = createBot(h, { name: 'Shared' });
  const a = openBot(h, bot.id, { userId: 'user_a', tenantId: 'default' });
  const b = openBot(h, bot.id, { userId: 'user_b', tenantId: 'default' });
  assert.equal(a.createdSession, true);
  assert.equal(b.createdSession, true);
  assert.notEqual(a.sessionId, b.sessionId);
  assert.notEqual(a.sessionId, bot.canonicalSessionId);
  const again = openBot(h, bot.id, { userId: 'user_a', tenantId: 'default' });
  assert.equal(again.createdSession, false);
  assert.equal(again.sessionId, a.sessionId);
  const sessA = store.getSession(a.sessionId);
  assert.equal(sessA.metadata.userId, 'user_a');
  assert.equal(sessA.metadata.botId, bot.id);
  store.db.close();
});

test('openBot: missing session is recreated', () => {
  const store = tempStore();
  const h = host(store);
  const bot = createBot(h, { name: 'Keeper' });
  const oldId = bot.canonicalSessionId;
  store.updateBot(bot.id, { canonicalSessionId: 'session_gone' });
  const opened = openBot(h, bot.id);
  assert.equal(opened.createdSession, true);
  assert.notEqual(opened.sessionId, oldId);
  assert.notEqual(opened.sessionId, 'session_gone');
  const session = store.getSession(opened.sessionId);
  assert.ok(session);
  assert.equal(getBot(store, bot.id).canonicalSessionId, opened.sessionId);
  store.db.close();
});

test('createBot: non-slug name still works; empty name rejected', () => {
  const store = tempStore();
  const h = host(store);
  const bot = createBot(h, { name: '调研助手' });
  assert.match(bot.id, /^bot_/);
  assert.equal(bot.agentId, bot.id);
  assert.throws(() => createBot(h, { name: '   ' }), ValidationError);
  store.db.close();
});

test('createBot: roster cap', () => {
  const store = tempStore();
  const h = host(store);
  for (let i = 0; i < BOT_ROSTER_CAP; i += 1) {
    createBot(h, { name: `Cap ${i}` });
  }
  assert.throws(() => createBot(h, { name: 'Overflow' }), ValidationError);
  store.db.close();
});
