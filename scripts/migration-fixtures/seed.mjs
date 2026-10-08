#!/usr/bin/env node
/**
 * Seed a state DB with an OLD revision's own code, so the snapshot holds the rows
 * and metadata that revision really wrote.
 *
 *   node scripts/migration-fixtures/seed.mjs <old-checkout-root> <db-file>
 *
 * The old checkout's `packages/core/dist` must be built. Modules are imported by
 * path at runtime (the checkout is chosen per run), and features are detected so
 * one script seeds every snapshot revision. Prints the seeded ids as JSON.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [oldRoot, dbFile] = process.argv.slice(2);
if (!oldRoot || !dbFile) {
  console.error('usage: seed.mjs <old-checkout-root> <db-file>');
  process.exit(2);
}

const dist = join(oldRoot, 'packages/core/dist');
const load = (rel) => import(pathToFileURL(join(dist, rel)).href);
const { SqliteStateStore } = await load('storage.js');
const { AgentMemoryStore } = await load('memory/store.js');
const { getCurrentSchemaVersion } = await load('stores/migrations/index.js');
const bots = existsSync(join(dist, 'bots/index.js')) ? await load('bots/index.js') : undefined;

const T0 = '2026-08-01T00:00:00.000Z';
const store = new SqliteStateStore(dbFile);
const memory = new AgentMemoryStore(store.db);
const out = { version: getCurrentSchemaVersion(store.db) };

store.upsertAgent({ id: 'general', name: 'General', role: 'assistant', instructions: 'General assistant.', capabilities: ['tool-use'] });
store.upsertAgent({ id: 'reviewer', name: 'Reviewer', role: 'reviewer', instructions: 'Reviews changes.', capabilities: [] });
memory.upsertUser({ id: 'u1', email: 'user-one@example.invalid', displayName: 'User One', status: 'active', createdAt: T0 });

const chat = store.createSession({ title: 'plain chat', mode: 'chat', agentId: 'general', metadata: { userId: 'u1' } });
store.appendMessage(chat.id, 'user', [{ type: 'text', text: 'list the repo files' }]);
store.appendMessage(chat.id, 'assistant', [
  { type: 'text', text: 'Listing.' },
  { type: 'tool_call', toolCallId: 'call_seed_1', name: 'bash', input: { command: 'ls' } }
]);
store.appendMessage(chat.id, 'tool', [{ type: 'tool_result', toolCallId: 'call_seed_1', name: 'bash', ok: true, content: 'README.md' }]);
store.appendMessage(chat.id, 'assistant', [{ type: 'text', text: 'One file: README.md.' }]);
out.chatId = chat.id;

const task = store.createTask({ title: 'seeded task', description: 'carry over', ownerAgentId: 'reviewer' });
const taskSession = store.createSession({ title: 'task session', mode: 'task', agentId: 'reviewer', taskId: task.id });
store.appendMessage(taskSession.id, 'user', [{ type: 'text', text: 'review it' }]);
const approval = store.createApproval({ sessionId: taskSession.id, toolName: 'bash', reason: 'writes files', args: { command: 'touch x' } });
out.taskId = task.id;
out.taskSessionId = taskSession.id;
out.approvalId = approval.id;

memory.set({ scope: 'user.memory', namespace: 'default', key: 'shared-pref', value: 'prefers short answers (general chat)', userId: 'u1', sessionId: chat.id });
memory.set({ scope: 'user.memory', namespace: 'default', key: 'global-pref', value: 'timezone UTC (no session)', userId: 'u1' });
memory.set({ scope: 'session.long', namespace: 'default', key: 'chat-long', value: 'plain chat long note', sessionId: chat.id });

if (bots) {
  const host = { store, runImageRetention: async () => {}, wakeAllAutonomousSessions: () => {}, wakeAgentSessions: () => {} };
  const researcher = bots.createBot(host, { name: 'Researcher', description: 'legacy bot (default permission)' });
  const planner = bots.createBot(host, { name: 'Planner', description: 'legacy bot the user moved to ask' });
  const plannerSession = store.getSession(planner.canonicalSessionId);
  store.updateSession(planner.canonicalSessionId, {
    metadata: { ...plannerSession.metadata, permissionMode: 'ask', permissionModeChangedAt: '2026-08-02T00:00:00.000Z' }
  });
  store.appendMessage(researcher.canonicalSessionId, 'user', [{ type: 'text', text: 'remember I like tea' }]);
  const child = store.createSession({
    title: 'researcher subagent',
    mode: 'subagent',
    agentId: 'helper',
    parentSessionId: researcher.canonicalSessionId
  });
  memory.set({ scope: 'user.memory', namespace: 'default', key: 'bot-pref', value: 'likes tea (written by Researcher)', userId: 'u1', sessionId: researcher.canonicalSessionId });
  memory.set({ scope: 'user.memory', namespace: 'default', key: 'bot-child-pref', value: 'cites sources (Researcher subagent)', userId: 'u1', sessionId: child.id });
  memory.set({ scope: 'session.long', namespace: 'default', key: 'bot-long', value: 'Researcher long note', sessionId: researcher.canonicalSessionId });
  out.bots = {
    researcher: { id: researcher.id, agentId: researcher.agentId, sessionId: researcher.canonicalSessionId },
    planner: { id: planner.id, agentId: planner.agentId, sessionId: planner.canonicalSessionId },
    childSessionId: child.id
  };
}

store.db.close();
console.log(JSON.stringify(out));
