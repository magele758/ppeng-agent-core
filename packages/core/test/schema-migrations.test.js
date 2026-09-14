import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  applyMigrations,
  getCurrentSchemaVersion
} from '../dist/stores/migrations/index.js';
import { SqliteStateStore } from '../dist/storage.js';

const EXEC_DAEMON_NODE = '/exec-daemon/node';

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-migrate-'));
  return { dir, file: join(dir, 'runtime.sqlite') };
}

test('schema migrations: applyMigrations on empty DB sets latest version', () => {
  const { dir, file } = tmpDb();
  try {
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE approvals (id TEXT PRIMARY KEY)`);
    db.exec(`CREATE TABLE session_memory (id TEXT PRIMARY KEY)`);
    applyMigrations(db);
    assert.equal(getCurrentSchemaVersion(db), LATEST_SCHEMA_VERSION);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schema migrations: re-running applyMigrations is a no-op (idempotent)', () => {
  const { dir, file } = tmpDb();
  try {
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE approvals (id TEXT PRIMARY KEY)`);
    db.exec(`CREATE TABLE session_memory (id TEXT PRIMARY KEY)`);
    applyMigrations(db);
    const before = db.prepare(`SELECT COUNT(*) AS c FROM schema_version`).get();
    applyMigrations(db);
    const after = db.prepare(`SELECT COUNT(*) AS c FROM schema_version`).get();
    assert.equal(after.c, before.c, 'should not duplicate version rows');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schema migrations: SqliteStateStore.initialize records latest version on fresh DB', () => {
  const { dir, file } = tmpDb();
  try {
    const store = new SqliteStateStore(file);
    const version = getCurrentSchemaVersion(store.db);
    assert.equal(version, LATEST_SCHEMA_VERSION);
    // Spot-check that v2/v3 columns exist.
    const approvalCols = store.db.prepare(`PRAGMA table_info(approvals)`).all();
    assert.ok(approvalCols.some((c) => c.name === 'idempotency_key'));
    const memCols = store.db.prepare(`PRAGMA table_info(session_memory)`).all();
    assert.ok(memCols.some((c) => c.name === 'importance'));
    assert.ok(memCols.some((c) => c.name === 'merged_from_json'));
    assert.ok(store.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='orchestration_runs'`).get());
    assert.ok(store.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='research_tasks'`).get());
    assert.ok(store.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_memory'`).get());
    assert.ok(store.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='swarm_runs'`).get());
    assert.ok(store.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='projects'`).get());
    assert.ok(store.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='project_roots'`).get());
    assert.ok(store.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='cloud_folders'`).get());
    assert.ok(store.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='oauth_identities'`).get());
    assert.ok(store.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='auth_sessions'`).get());
    const agentMem = store.db.prepare(`SELECT COUNT(*) AS c FROM agent_memory`).get();
    assert.ok(typeof agentMem.c === 'number');
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schema migrations: v4 records version when fts5 module is missing', () => {
  const { dir, file } = tmpDb();
  try {
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE approvals (id TEXT PRIMARY KEY)`);
    db.exec(`CREATE TABLE session_memory (id TEXT PRIMARY KEY)`);
    const orig = db.exec.bind(db);
    db.exec = (sql) => {
      if (/USING\s+fts5/i.test(String(sql))) {
        throw new Error('no such module: fts5');
      }
      return orig(sql);
    };
    applyMigrations(db);
    assert.equal(getCurrentSchemaVersion(db), LATEST_SCHEMA_VERSION);
    assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_cases'`).get());
    assert.equal(
      db.prepare(`SELECT name FROM sqlite_master WHERE name='agent_cases_fts'`).get(),
      undefined
    );
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schema migrations: failing migration rolls back via transaction', () => {
  const { dir, file } = tmpDb();
  try {
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE approvals (id TEXT PRIMARY KEY)`);
    db.exec(`CREATE TABLE session_memory (id TEXT PRIMARY KEY)`);
    // Bring it up to LATEST first so we have a baseline version row.
    applyMigrations(db);
    const baseline = getCurrentSchemaVersion(db);

    // Inject a sabotaged migration that throws.
    const broken = {
      version: LATEST_SCHEMA_VERSION + 1,
      description: 'sabotage',
      up: () => { throw new Error('boom'); }
    };
    MIGRATIONS.push(broken);
    try {
      assert.throws(() => applyMigrations(db), /boom/);
      // Version must not have advanced because the failed migration rolled back.
      assert.equal(getCurrentSchemaVersion(db), baseline);
    } finally {
      MIGRATIONS.pop();
    }
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function seedPreV12DesktopDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE session_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      parts_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    );
    INSERT INTO schema_version VALUES (3, '2026-01-01T00:00:00.000Z', 'session_memory consolidation columns');
  `);
  assert.equal(
    db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'`).get(),
    undefined,
    'pre-v12 fixture must not create sqlite_sequence'
  );
  const cols = db.prepare(`PRAGMA table_info(session_messages)`).all();
  assert.equal(cols.some((c) => c.name === 'seq'), false);
  db.close();
}

function assertStoreBootsAndCanAppend(file) {
  const store = new SqliteStateStore(file);
  assert.equal(getCurrentSchemaVersion(store.db), LATEST_SCHEMA_VERSION);
  const cols = store.db.prepare(`PRAGMA table_info(session_messages)`).all();
  assert.ok(cols.some((c) => c.name === 'seq'), 'v12 must add session_messages.seq');
  store.upsertAgent({
    id: 'general',
    name: 'General',
    role: 'assistant',
    instructions: 'x',
    capabilities: []
  });
  const session = store.createSession({ title: 'seq-boot', mode: 'chat', agentId: 'general' });
  const msg = store.appendMessage(session.id, 'user', [{ type: 'text', text: 'hello' }]);
  assert.equal(typeof msg.seq, 'number');
  assert.ok(msg.seq >= 1);
  store.db.close();
}

test('schema migrations: SqliteStateStore.initialize on a fresh empty db', () => {
  const { dir, file } = tmpDb();
  try {
    const probe = new DatabaseSync(file);
    assert.equal(
      probe.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'`).get(),
      undefined
    );
    probe.close();
    assertStoreBootsAndCanAppend(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schema migrations: SqliteStateStore.initialize when sqlite_sequence is absent', () => {
  const { dir, file } = tmpDb();
  try {
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE dummy (id TEXT PRIMARY KEY)`);
    assert.equal(
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'`).get(),
      undefined
    );
    db.close();
    assertStoreBootsAndCanAppend(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schema migrations: SqliteStateStore.initialize on pre-v12 session_messages without seq', () => {
  const { dir, file } = tmpDb();
  try {
    seedPreV12DesktopDb(file);
    assertStoreBootsAndCanAppend(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schema migrations: SqliteStateStore.initialize under node without FTS5', { skip: !existsSync(EXEC_DAEMON_NODE) }, () => {
  const { dir, file } = tmpDb();
  const fresh = join(dir, 'fresh.sqlite');
  const noseq = join(dir, 'noseq.sqlite');
  try {
    seedPreV12DesktopDb(file);
    const db = new DatabaseSync(noseq);
    db.exec(`CREATE TABLE dummy (id TEXT PRIMARY KEY)`);
    db.close();
    const storageUrl = new URL('../dist/storage.js', import.meta.url).href;
    const script = `
      import { DatabaseSync } from 'node:sqlite';
      import { SqliteStateStore } from ${JSON.stringify(storageUrl)};
      function boot(path) {
        const store = new SqliteStateStore(path);
        const cols = store.db.prepare('PRAGMA table_info(session_messages)').all();
        if (!cols.some((c) => c.name === 'seq')) throw new Error('missing seq on ' + path);
        store.db.close();
      }
      boot(${JSON.stringify(file)});
      boot(${JSON.stringify(fresh)});
      boot(${JSON.stringify(noseq)});
      const probe = new DatabaseSync(${JSON.stringify(fresh)});
      try { probe.exec("CREATE VIRTUAL TABLE _fts_probe USING fts5(x)"); console.log('UNEXPECTED_FTS5'); }
      catch (e) { console.log('NO_FTS5:' + e.message); }
      probe.close();
    `;
    const result = spawnSync(EXEC_DAEMON_NODE, ['--input-type=module'], {
      input: script,
      encoding: 'utf8',
      env: { ...process.env, PATH: process.env.PATH }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /NO_FTS5:no such module: fts5/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
