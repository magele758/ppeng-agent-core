import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { SqliteStateStore } = await import('../dist/storage.js');

function makeTempDb() {
  const dir = join(tmpdir(), 'ppeng-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, 'test.db');
  return { dbPath, store: new SqliteStateStore(dbPath) };
}

describe('SqliteStateStore', () => {
  let store;
  let dbPath;

  before(() => {
    const setup = makeTempDb();
    store = setup.store;
    dbPath = setup.dbPath;
  });

  after(() => {
    try { store.db.close(); } catch { /* ignore */ }
    try { unlinkSync(dbPath); } catch { /* ignore */ }
  });

  describe('Agent CRUD', () => {
    const agent = {
      id: 'test-agent',
      name: 'Test Agent',
      role: 'assistant',
      instructions: 'Be helpful',
      capabilities: [],
    };

    it('upserts and retrieves an agent', () => {
      store.upsertAgent(agent);
      const got = store.getAgent('test-agent');
      assert.ok(got);
      assert.equal(got.name, 'Test Agent');
      assert.equal(got.role, 'assistant');
    });

    it('lists agents', () => {
      const agents = store.listAgents();
      assert.ok(agents.length >= 1);
      assert.ok(agents.some((a) => a.id === 'test-agent'));
    });

    it('updates agent on re-upsert', () => {
      store.upsertAgent({ ...agent, name: 'Updated Agent' });
      const got = store.getAgent('test-agent');
      assert.equal(got.name, 'Updated Agent');
    });

    it('returns undefined for missing agent', () => {
      assert.equal(store.getAgent('nonexistent'), undefined);
    });
  });

  describe('Session CRUD', () => {
    let sessionId;

    it('creates a session', () => {
      const session = store.createSession({
        title: 'Test Session',
        mode: 'chat',
        agentId: 'test-agent',
      });
      sessionId = session.id;
      assert.ok(sessionId.startsWith('session_'));
      assert.equal(session.title, 'Test Session');
      assert.equal(session.status, 'idle');
      assert.deepEqual(session.todo, []);
    });

    it('retrieves a session', () => {
      const session = store.getSession(sessionId);
      assert.ok(session);
      assert.equal(session.title, 'Test Session');
    });

    it('lists sessions', () => {
      const sessions = store.listSessions();
      assert.ok(sessions.length >= 1);
      assert.ok(sessions.some((s) => s.id === sessionId));
    });

    it('returns undefined for missing session', () => {
      assert.equal(store.getSession('nonexistent'), undefined);
    });
  });

  describe('Messages', () => {
    let sessionId;

    before(() => {
      const session = store.createSession({
        title: 'Msg Test',
        mode: 'chat',
        agentId: 'test-agent',
      });
      sessionId = session.id;
    });

    it('appends and lists messages', () => {
      store.appendMessage(sessionId, 'user', [{ type: 'text', text: 'Hello' }]);
      store.appendMessage(sessionId, 'assistant', [{ type: 'text', text: 'Hi there' }]);
      const msgs = store.listMessages(sessionId);
      assert.equal(msgs.length, 2);
      assert.equal(msgs[0].role, 'user');
      assert.equal(msgs[1].role, 'assistant');
    });

    it('returns empty array for session with no messages', () => {
      const newSession = store.createSession({
        title: 'Empty',
        mode: 'chat',
        agentId: 'test-agent',
      });
      const msgs = store.listMessages(newSession.id);
      assert.deepEqual(msgs, []);
    });
  });

  describe('Session Memory', () => {
    let sessionId;

    before(() => {
      const session = store.createSession({
        title: 'Mem Test',
        mode: 'chat',
        agentId: 'test-agent',
      });
      sessionId = session.id;
    });

    it('sets and gets memory', () => {
      store.upsertSessionMemory({ sessionId, scope: 'scratch', key: 'key1', value: 'value1' });
      const mem = store.listSessionMemory(sessionId);
      assert.ok(mem.some((m) => m.key === 'key1' && m.value === 'value1'));
    });

    it('overwrites existing key', () => {
      store.upsertSessionMemory({ sessionId, scope: 'scratch', key: 'key1', value: 'updated' });
      const mem = store.listSessionMemory(sessionId);
      const entry = mem.find((m) => m.key === 'key1');
      assert.equal(entry.value, 'updated');
    });

    it('distinguishes scopes', () => {
      store.upsertSessionMemory({ sessionId, scope: 'long', key: 'key1', value: 'long-value' });
      const mem = store.listSessionMemory(sessionId);
      const scratch = mem.filter((m) => m.scope === 'scratch' && m.key === 'key1');
      const long = mem.filter((m) => m.scope === 'long' && m.key === 'key1');
      assert.equal(scratch[0].value, 'updated');
      assert.equal(long[0].value, 'long-value');
    });
  });

  describe('Tasks', () => {
    it('creates and retrieves a task', () => {
      const task = store.createTask({
        title: 'Test Task',
        description: 'A test task',
        ownerAgentId: 'test-agent',
      });
      assert.ok(task.id.startsWith('task_'));
      assert.equal(task.status, 'pending');

      const got = store.getTask(task.id);
      assert.equal(got.title, 'Test Task');
    });

    it('lists tasks', () => {
      const tasks = store.listTasks();
      assert.ok(tasks.length >= 1);
    });
  });
});
