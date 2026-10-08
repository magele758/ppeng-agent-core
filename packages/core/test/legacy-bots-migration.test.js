import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { backfillBotMemoryAgentIds, flagLegacyBypassBots } from '../dist/stores/migrations/legacy-bots.js';
import {
  BOT_BYPASS_DEFAULT_ENDED_AT,
  hasLegacyBypassFlag,
  isDefaultAssignedBypass
} from '../dist/bots/legacy-bypass.js';
import { botPolicyWarnings } from '../dist/bots/bot-policy.js';

function legacyDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE bots (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, canonical_session_id TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, mode TEXT NOT NULL,
      parent_session_id TEXT, metadata_json TEXT NOT NULL);
    CREATE TABLE agent_memory (id TEXT PRIMARY KEY, scope TEXT NOT NULL, namespace TEXT NOT NULL,
      key TEXT NOT NULL, value TEXT NOT NULL, user_id TEXT, tenant_id TEXT, session_id TEXT,
      agent_id TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE agent_memory_embedding (memory_id TEXT PRIMARY KEY, vector TEXT);
  `);
  const session = db.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?, ?)`);
  db.prepare(`INSERT INTO bots VALUES ('scout', 'scout-agent', 'bot_s')`).run();
  session.run('bot_s', 'scout-agent', 'chat', null, JSON.stringify({ botId: 'scout' }));
  session.run('child', 'picked-by-model', 'teammate', 'bot_s', '{}');
  session.run('grandchild', 'helper', 'subagent', 'child', '{}');
  session.run('chat', 'general', 'chat', null, '{}');
  session.run('broken', 'general', 'chat', null, 'not json');
  return db;
}

function addMemory(db, id, fields) {
  const row = { scope: 'user.memory', namespace: 'default', key: id, value: id, user_id: 'u1', tenant_id: null,
    session_id: null, agent_id: null, updated_at: '2026-08-01T00:00:00.000Z', ...fields };
  db.prepare(`INSERT INTO agent_memory VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, row.scope, row.namespace, row.key, row.value, row.user_id, row.tenant_id, row.session_id, row.agent_id, row.updated_at
  );
}

const agentOf = (db, id) => db.prepare(`SELECT agent_id FROM agent_memory WHERE id = ?`).get(id)?.agent_id;

test('backfill follows the bot spawning chain and leaves unattributable rows shared', () => {
  const db = legacyDb();
  addMemory(db, 'own', { session_id: 'bot_s' });
  addMemory(db, 'deep', { session_id: 'grandchild' });
  addMemory(db, 'plain', { session_id: 'chat' });
  addMemory(db, 'nosession', {});
  addMemory(db, 'missing', { session_id: 'gone' });
  addMemory(db, 'badmeta', { session_id: 'broken' });
  addMemory(db, 'scratch', { scope: 'session.long', session_id: 'bot_s' });
  addMemory(db, 'mine', { session_id: 'chat', agent_id: 'other' });
  backfillBotMemoryAgentIds(db);
  assert.equal(agentOf(db, 'own'), 'scout-agent');
  assert.equal(agentOf(db, 'deep'), 'scout-agent');
  assert.equal(agentOf(db, 'scratch'), 'scout-agent');
  for (const id of ['plain', 'nosession', 'missing', 'badmeta']) assert.equal(agentOf(db, id), null, id);
  assert.equal(agentOf(db, 'mine'), 'other');
});

test('backfill keeps the newer of a legacy row and its bot-namespace twin', () => {
  const db = legacyDb();
  addMemory(db, 'old-legacy', { key: 'k1', session_id: 'bot_s', updated_at: '2026-08-01T00:00:00.000Z' });
  addMemory(db, 'new-bot', { key: 'k1', session_id: 'bot_s', agent_id: 'scout-agent', updated_at: '2026-09-01T00:00:00.000Z' });
  addMemory(db, 'new-legacy', { key: 'k2', session_id: 'bot_s', updated_at: '2026-09-02T00:00:00.000Z' });
  addMemory(db, 'old-bot', { key: 'k2', session_id: 'bot_s', agent_id: 'scout-agent', updated_at: '2026-08-02T00:00:00.000Z' });
  db.prepare(`INSERT INTO agent_memory_embedding VALUES ('old-legacy', '[1]'), ('old-bot', '[2]')`).run();
  backfillBotMemoryAgentIds(db);
  const ids = db.prepare(`SELECT id FROM agent_memory ORDER BY id`).all().map((r) => r.id);
  assert.deepEqual(ids, ['new-bot', 'new-legacy']);
  assert.equal(agentOf(db, 'new-legacy'), 'scout-agent');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM agent_memory_embedding`).get().n, 0);
});

test('backfill and flagging are no-ops before the bots table exists', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE agent_memory (id TEXT, agent_id TEXT); CREATE TABLE sessions (id TEXT)`);
  backfillBotMemoryAgentIds(db);
  flagLegacyBypassBots(db);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'bots'`).get().n, 0);
});

test('only default-assigned bypass is a legacy bypass', () => {
  assert.equal(isDefaultAssignedBypass({ permissionMode: 'bypass' }), true);
  assert.equal(isDefaultAssignedBypass({ permissionMode: 'bypass', permissionModeChangedAt: '2026-09-29T00:00:00.000Z' }), true);
  assert.equal(isDefaultAssignedBypass({ permissionMode: 'bypass', permissionModeChangedAt: BOT_BYPASS_DEFAULT_ENDED_AT }), false);
  assert.equal(isDefaultAssignedBypass({ permissionMode: 'ask' }), false);
  assert.equal(isDefaultAssignedBypass(undefined), false);
});

test('flagging stamps default-bypass canonical sessions once and the warning tracks the mode', () => {
  const db = legacyDb();
  const session = db.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?, ?)`);
  db.prepare(`INSERT INTO bots VALUES ('chosen', 'chosen', 'bot_c'), ('safe', 'safe', 'bot_a')`).run();
  db.prepare(`UPDATE sessions SET metadata_json = ? WHERE id = 'bot_s'`).run(JSON.stringify({ botId: 'scout', permissionMode: 'bypass' }));
  session.run('bot_c', 'chosen', 'chat', null, JSON.stringify({ permissionMode: 'bypass', permissionModeChangedAt: '2026-10-01T00:00:00.000Z' }));
  session.run('bot_a', 'safe', 'chat', null, JSON.stringify({ permissionMode: 'auto' }));
  flagLegacyBypassBots(db);
  flagLegacyBypassBots(db);
  const meta = (id) => JSON.parse(db.prepare(`SELECT metadata_json FROM sessions WHERE id = ?`).get(id).metadata_json);
  assert.deepEqual(meta('bot_s'), { botId: 'scout', permissionMode: 'bypass', legacyBotBypass: true });
  assert.equal(meta('bot_c').legacyBotBypass, undefined);
  assert.equal(meta('bot_a').legacyBotBypass, undefined);
  assert.equal(meta('child').legacyBotBypass, undefined);
  assert.deepEqual(botPolicyWarnings(meta('bot_s')), [{ code: 'legacy_bypass_permission' }]);
  assert.equal(hasLegacyBypassFlag({ ...meta('bot_s'), permissionMode: 'auto' }), false);
});
