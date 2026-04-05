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

  // ── Edge-case tests added during review ──

  describe('Session updateSession', () => {
    it('updates session title', () => {
      const session = store.createSession({ title: 'Original', mode: 'chat', agentId: 'test-agent' });
      const updated = store.updateSession(session.id, { title: 'Renamed' });
      assert.equal(updated.title, 'Renamed');
      assert.equal(store.getSession(session.id).title, 'Renamed');
    });

    it('updates session status', () => {
      const session = store.createSession({ title: 'S', mode: 'chat', agentId: 'test-agent' });
      store.updateSession(session.id, { status: 'running' });
      assert.equal(store.getSession(session.id).status, 'running');
      store.updateSession(session.id, { status: 'completed' });
      assert.equal(store.getSession(session.id).status, 'completed');
    });

    it('allows any status transition (no state-machine enforcement)', () => {
      // Documents current behavior: no guard rails on status transitions
      const session = store.createSession({ title: 'S', mode: 'chat', agentId: 'test-agent' });
      store.updateSession(session.id, { status: 'completed' });
      // Currently allowed — going from completed back to idle
      const updated = store.updateSession(session.id, { status: 'idle' });
      assert.equal(updated.status, 'idle');
    });

    it('updates session metadata (JSON round-trip)', () => {
      const session = store.createSession({ title: 'M', mode: 'chat', agentId: 'test-agent' });
      store.updateSession(session.id, { metadata: { foo: 'bar', nested: { x: 1 } } });
      const got = store.getSession(session.id);
      assert.deepEqual(got.metadata, { foo: 'bar', nested: { x: 1 } });
    });
  });

  describe('Approval CRUD', () => {
    let approvalSessionId;

    before(() => {
      const s = store.createSession({ title: 'Approval', mode: 'chat', agentId: 'test-agent' });
      approvalSessionId = s.id;
    });

    it('creates an approval', () => {
      const a = store.createApproval({
        sessionId: approvalSessionId,
        toolName: 'bash',
        reason: 'dangerous',
        args: { cmd: 'rm -rf /' },
      });
      assert.ok(a.id.startsWith('approval_'));
      assert.equal(a.status, 'pending');
      assert.equal(a.toolName, 'bash');
      assert.deepEqual(a.args, { cmd: 'rm -rf /' });
    });

    it('retrieves an approval', () => {
      const a = store.createApproval({
        sessionId: approvalSessionId,
        toolName: 'exec',
        reason: 'risky',
        args: {},
      });
      const got = store.getApproval(a.id);
      assert.ok(got);
      assert.equal(got.id, a.id);
      assert.equal(got.toolName, 'exec');
    });

    it('lists approvals by status', () => {
      const all = store.listApprovals();
      assert.ok(all.length >= 2);
      const pending = store.listApprovals({ status: 'pending' });
      assert.ok(pending.every((a) => a.status === 'pending'));
    });

    it('updates approval status', () => {
      const a = store.createApproval({
        sessionId: approvalSessionId,
        toolName: 'deploy',
        reason: 'confirm',
        args: {},
      });
      const approved = store.updateApproval(a.id, 'approved');
      assert.equal(approved.status, 'approved');
      const got = store.getApproval(a.id);
      assert.equal(got.status, 'approved');
    });

    it('updateApproval throws for nonexistent id', () => {
      assert.throws(() => store.updateApproval('nonexistent', 'approved'), /not found/);
    });

    it('deletes an approval', () => {
      const a = store.createApproval({
        sessionId: approvalSessionId,
        toolName: 'rm',
        reason: 'test',
        args: {},
      });
      store.deleteApproval(a.id);
      assert.equal(store.getApproval(a.id), undefined);
    });

    it('idempotency key returns same approval when pending', () => {
      const a1 = store.createApproval({
        sessionId: approvalSessionId,
        toolName: 'tool1',
        reason: 'idem',
        args: { x: 1 },
        idempotencyKey: 'idem-key-1',
      });
      const a2 = store.createApproval({
        sessionId: approvalSessionId,
        toolName: 'tool1',
        reason: 'idem',
        args: { x: 1 },
        idempotencyKey: 'idem-key-1',
      });
      assert.equal(a1.id, a2.id, 'same key should return same approval');
    });

    it('idempotency key creates new approval after previous is resolved', () => {
      const a1 = store.createApproval({
        sessionId: approvalSessionId,
        toolName: 'tool2',
        reason: 'idem2',
        args: {},
        idempotencyKey: 'idem-key-2',
      });
      store.updateApproval(a1.id, 'rejected');
      const a2 = store.createApproval({
        sessionId: approvalSessionId,
        toolName: 'tool2',
        reason: 'idem2',
        args: {},
        idempotencyKey: 'idem-key-2',
      });
      // After rejection, a new approval should be created
      assert.notEqual(a1.id, a2.id, 'new approval after rejection');
    });
  });

  describe('Background Jobs', () => {
    let bgSessionId;

    before(() => {
      const s = store.createSession({ title: 'BG', mode: 'chat', agentId: 'test-agent' });
      bgSessionId = s.id;
    });

    it('creates a background job', () => {
      const job = store.createBackgroundJob({
        sessionId: bgSessionId,
        command: 'npm test',
        status: 'running',
      });
      assert.ok(job.id.startsWith('bg_'));
      assert.equal(job.status, 'running');
      assert.equal(job.command, 'npm test');
    });

    it('retrieves a background job', () => {
      const job = store.createBackgroundJob({
        sessionId: bgSessionId,
        command: 'build',
        status: 'running',
      });
      const got = store.getBackgroundJob(job.id);
      assert.ok(got);
      assert.equal(got.command, 'build');
    });

    it('lists background jobs by session', () => {
      const jobs = store.listBackgroundJobs(bgSessionId);
      assert.ok(jobs.length >= 2);
      assert.ok(jobs.every((j) => j.sessionId === bgSessionId));
    });

    it('updates a background job to completed', () => {
      const job = store.createBackgroundJob({
        sessionId: bgSessionId,
        command: 'test',
        status: 'running',
      });
      const updated = store.updateBackgroundJob(job.id, 'completed', 'all passed');
      assert.equal(updated.status, 'completed');
      assert.equal(updated.result, 'all passed');
    });

    it('updates a background job to error', () => {
      const job = store.createBackgroundJob({
        sessionId: bgSessionId,
        command: 'lint',
        status: 'running',
      });
      const updated = store.updateBackgroundJob(job.id, 'error', 'lint failed');
      assert.equal(updated.status, 'error');
      assert.equal(updated.result, 'lint failed');
    });

    it('updateBackgroundJob throws for nonexistent id', () => {
      assert.throws(() => store.updateBackgroundJob('nonexistent', 'completed'), /not found/);
    });

    it('returns undefined for missing background job', () => {
      assert.equal(store.getBackgroundJob('nonexistent'), undefined);
    });
  });

  describe('Self-Heal Runs', () => {
    it('creates a self-heal run', () => {
      const run = store.createSelfHealRun({ policy: { testPreset: 'unit', maxFixIterations: 3 } });
      assert.ok(run.id);
      assert.equal(run.status, 'pending');
      assert.equal(run.fixIteration, 0);
    });

    it('gets a self-heal run', () => {
      const run = store.createSelfHealRun({ policy: { testPreset: 'unit' } });
      const got = store.getSelfHealRun(run.id);
      assert.ok(got);
      assert.equal(got.id, run.id);
    });

    it('returns undefined for missing run', () => {
      assert.equal(store.getSelfHealRun('nonexistent'), undefined);
    });

    it('updates a self-heal run status', () => {
      const run = store.createSelfHealRun({ policy: { testPreset: 'unit' } });
      const updated = store.updateSelfHealRun(run.id, { status: 'running_tests' });
      assert.equal(updated.status, 'running_tests');
    });

    it('lists active self-heal runs (excludes terminal)', () => {
      const run1 = store.createSelfHealRun({ policy: { testPreset: 'unit' } });
      store.updateSelfHealRun(run1.id, { status: 'completed' });
      const active = store.listActiveSelfHealRuns();
      assert.ok(!active.some((r) => r.id === run1.id));
    });

    it('appends and lists self-heal events', () => {
      const run = store.createSelfHealRun({ policy: { testPreset: 'unit' } });
      store.appendSelfHealEvent({ runId: run.id, kind: 'test_pass', payload: { ok: true } });
      store.appendSelfHealEvent({ runId: run.id, kind: 'test_fail', payload: { ok: false } });
      const events = store.listSelfHealEvents(run.id);
      assert.ok(events.length >= 2);
      assert.ok(events.some((e) => e.kind === 'test_pass'));
      assert.ok(events.some((e) => e.kind === 'test_fail'));
    });
  });

  describe('Daemon Control', () => {
    it('sets and gets daemon control', () => {
      store.setDaemonControl('test_key', { foo: 'bar' });
      const val = store.getDaemonControl('test_key');
      assert.deepEqual(val, { foo: 'bar' });
    });

    it('overwrites daemon control on re-set', () => {
      store.setDaemonControl('overwrite_key', { a: 1 });
      store.setDaemonControl('overwrite_key', { a: 2 });
      assert.deepEqual(store.getDaemonControl('overwrite_key'), { a: 2 });
    });

    it('deletes daemon control', () => {
      store.setDaemonControl('del_key', 'value');
      store.deleteDaemonControl('del_key');
      assert.equal(store.getDaemonControl('del_key'), undefined);
    });

    it('returns undefined for missing key', () => {
      assert.equal(store.getDaemonControl('no_such_key'), undefined);
    });
  });

  describe('Workspace CRUD', () => {
    it('creates and retrieves a workspace', () => {
      const ws = store.createWorkspace({
        id: 'ws_test_1',
        taskId: 'task_1',
        name: 'fix-workspace',
        mode: 'git-worktree',
        sourcePath: '/repo',
        rootPath: '/tmp/ws',
        status: 'active',
        createdAt: new Date().toISOString(),
      });
      assert.equal(ws.id, 'ws_test_1');
      const got = store.getWorkspace('ws_test_1');
      assert.ok(got);
      assert.equal(got.rootPath, '/tmp/ws');
      assert.equal(got.mode, 'git-worktree');
    });

    it('lists workspaces', () => {
      const list = store.listWorkspaces();
      assert.ok(list.length >= 1);
    });

    it('returns undefined for missing workspace', () => {
      assert.equal(store.getWorkspace('nonexistent'), undefined);
    });
  });

  describe('Task updates and events', () => {
    it('updates task status', () => {
      const task = store.createTask({ title: 'UT', description: 'update test' });
      const updated = store.updateTask(task.id, { status: 'in_progress' });
      assert.equal(updated.status, 'in_progress');
    });

    it('appends and lists task events', () => {
      const task = store.createTask({ title: 'ET', description: 'event test' });
      store.appendEvent({ taskId: task.id, kind: 'started', actor: 'system', payload: {} });
      store.appendEvent({ taskId: task.id, kind: 'completed', actor: 'system', payload: { result: 'ok' } });
      const events = store.listEvents(task.id);
      assert.ok(events.length >= 2);
      assert.ok(events.some((e) => e.kind === 'started'));
    });

    it('lists child tasks', () => {
      const parent = store.createTask({ title: 'Parent', description: 'p' });
      const child = store.createTask({ title: 'Child', description: 'c', parentTaskId: parent.id });
      const children = store.listChildTasks(parent.id);
      assert.ok(children.some((t) => t.id === child.id));
    });

    it('lists tasks filtered by status', () => {
      const t = store.createTask({ title: 'Filter', description: 'f' });
      store.updateTask(t.id, { status: 'completed' });
      const completed = store.listTasks({ status: 'completed' });
      assert.ok(completed.some((x) => x.id === t.id));
      const pending = store.listTasks({ status: 'pending' });
      assert.ok(!pending.some((x) => x.id === t.id));
    });
  });
});
