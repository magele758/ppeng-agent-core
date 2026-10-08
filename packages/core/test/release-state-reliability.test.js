import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, applyMigrations, getCurrentSchemaVersion } from '../dist/stores/migrations/index.js';
import { saveStepCheckpoint, rewindUncommittedTail } from '../dist/session/checkpoint.js';
import { assertTranscriptInvariants } from '../dist/exports/public.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'release-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'runtime.sqlite');
}
function createSession(store) {
  store.upsertAgent({ id: 'general', name: 'General', role: 'assistant', instructions: '', capabilities: [] });
  return store.createSession({ title: 'durable', mode: 'chat', agentId: 'general' });
}

test('unsupported legacy schema fails closed without deleting any historical rows', t => {
  const file = fixture(t), db = new DatabaseSync(file);
  db.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, legacy_payload TEXT); INSERT INTO tasks VALUES ('old', 'must survive')");
  db.close();
  assert.throws(() => new SqliteStateStore(file), /refusing to delete/);
  const reopened = new DatabaseSync(file);
  assert.equal(reopened.prepare('SELECT legacy_payload FROM tasks').get().legacy_payload, 'must survive');
  reopened.close();
});

test('older code refuses a future schema without mutating stored user data', t => {
  const file = fixture(t), store = new SqliteStateStore(file);
  const session = createSession(store);
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'keep me' }]);
  store.db.prepare('INSERT INTO schema_version VALUES (?, ?, ?)').run(LATEST_SCHEMA_VERSION + 1, 'now', 'future');
  store.db.close();
  assert.throws(() => new SqliteStateStore(file), /newer than supported/);
  const db = new DatabaseSync(file);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_messages').get().n, 1);
  assert.equal(getCurrentSchemaVersion(db), LATEST_SCHEMA_VERSION + 1);
  db.close();
});

test('pre-v12 transcript upgrade preserves real messages, tool pairs and ordering across reopen', t => {
  const file = fixture(t), db = new DatabaseSync(file);
  db.exec(`CREATE TABLE session_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, parts_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT NOT NULL);
    INSERT INTO schema_version VALUES (3, '2026-01-01', 'old');`);
  const rows = [
    ['u', 'user', [{ type: 'text', text: 'run' }]],
    ['a', 'assistant', [{ type: 'tool_call', toolCallId: 'call', name: 'lookup', input: {} }]],
    ['t', 'tool', [{ type: 'tool_result', toolCallId: 'call', name: 'lookup', ok: true, content: '42' }]]
  ];
  rows.forEach(([id, role, parts], i) => db.prepare('INSERT INTO session_messages VALUES (?, ?, ?, ?, ?)').run(id, 'old-session', role, JSON.stringify(parts), `2026-01-01T00:00:0${i}Z`));
  db.close();
  for (let boot = 0; boot < 2; boot++) {
    const store = new SqliteStateStore(file);
    const messages = store.foldMessages('old-session');
    assert.deepEqual(messages.map(m => m.id), ['u', 'a', 't']);
    assert.deepEqual(messages.map(m => m.seq), [1, 2, 3]);
    assertTranscriptInvariants(messages);
    assert.equal(getCurrentSchemaVersion(store.db), LATEST_SCHEMA_VERSION);
    store.db.close();
  }
});

test('a failed migration rolls back both schema and data changes', t => {
  const file = fixture(t), store = new SqliteStateStore(file);
  const session = createSession(store);
  const broken = { version: LATEST_SCHEMA_VERSION + 1, description: 'injected failure', up: db => {
    db.exec("CREATE TABLE half_migrated (id TEXT); UPDATE sessions SET title='corrupted'");
    throw new Error('injected migration failure');
  } };
  MIGRATIONS.push(broken);
  try {
    assert.throws(() => applyMigrations(store.db), /injected migration failure/);
    assert.equal(store.getSession(session.id).title, 'durable');
    assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE name='half_migrated'").get(), undefined);
    assert.equal(getCurrentSchemaVersion(store.db), LATEST_SCHEMA_VERSION);
  } finally { MIGRATIONS.pop(); store.db.close(); }
});

test('pending approval idempotency and checkpoint rewind survive reopening SQLite', t => {
  const file = fixture(t);
  let store = new SqliteStateStore(file);
  const session = createSession(store);
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'start' }]);
  const checkpoint = saveStepCheckpoint(store, session.id, { turn: 0, label: 'safe' });
  assert.equal(checkpoint.ok, true);
  const request = { sessionId: session.id, toolName: 'write_file', reason: 'confirm', args: { path: 'demo' }, idempotencyKey: 'same-operation' };
  const approval = store.createApproval(request);
  store.appendMessage(session.id, 'assistant', [{ type: 'tool_call', toolCallId: 'unfinished', name: 'write_file', input: {} }]);
  store.db.close();
  store = new SqliteStateStore(file);
  try {
    assert.equal(store.createApproval(request).id, approval.id);
    assert.equal(store.listApprovals({ status: 'pending' }).length, 1);
    store.updateApproval(approval.id, 'approved');
    assert.equal(store.getApproval(approval.id).status, 'approved');
    assert.equal(rewindUncommittedTail(store, session.id, { reason: 'restart recovery' }).rewound, true);
    assertTranscriptInvariants(store.foldMessages(session.id));
    assert.equal(rewindUncommittedTail(store, session.id, { reason: 'repeat recovery' }).rewound, false);
  } finally { store.db.close(); }
});
