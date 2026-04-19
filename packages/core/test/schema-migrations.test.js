import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  applyMigrations,
  getCurrentSchemaVersion
} from '../dist/stores/migrations/index.js';
import { SqliteStateStore } from '../dist/storage.js';

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
    store.db.close();
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
