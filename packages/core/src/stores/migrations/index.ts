/**
 * Versioned schema migrations for the runtime SQLite database.
 *
 * Why
 * ---
 * The previous `migrateSchema()` did ad-hoc `ALTER TABLE … ADD COLUMN` checks
 * via `PRAGMA table_info` every boot. That worked but:
 *   - had no notion of "current schema version"
 *   - couldn't skip migrations once applied
 *   - made historical evolution hard to audit
 *
 * This module wraps the same physical changes in an ordered list keyed by
 * integer version. A `schema_version` table records the latest applied id;
 * boot calls {@link applyMigrations} which only runs missing steps inside a
 * transaction so a failed migration leaves the DB unchanged.
 *
 * Adding a new migration:
 *   1. Append a new entry to `MIGRATIONS` with the next version number.
 *   2. Make it idempotent (`CREATE TABLE IF NOT EXISTS …`, column-existence
 *      check before `ALTER`) — fresh DBs may run it after baseline DDL.
 */
import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  description: string;
  up: (db: DatabaseSync) => void;
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

/**
 * Migration list. Versions must be strictly increasing.
 * Each migration is wrapped in a transaction by {@link applyMigrations}.
 *
 * v1  – baseline (handled by initial DDL in storage.ts; recorded as a no-op
 *       so the version row reflects "schema present").
 * v2  – approvals.idempotency_key
 * v3  – session_memory consolidation columns (importance, access_count,
 *       last_access_at, source, merged_from_json)
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'baseline (initial schema applied by storage.ts top-level DDL)',
    up: () => {
      /* no-op: baseline is created before this migration runs */
    }
  },
  {
    version: 2,
    description: 'add approvals.idempotency_key',
    up: (db) => {
      if (!hasColumn(db, 'approvals', 'idempotency_key')) {
        db.exec(`ALTER TABLE approvals ADD COLUMN idempotency_key TEXT`);
      }
    }
  },
  {
    version: 3,
    description: 'session_memory consolidation columns',
    up: (db) => {
      if (!hasColumn(db, 'session_memory', 'importance')) {
        db.exec(`ALTER TABLE session_memory ADD COLUMN importance REAL DEFAULT 0.5`);
      }
      if (!hasColumn(db, 'session_memory', 'access_count')) {
        db.exec(`ALTER TABLE session_memory ADD COLUMN access_count INTEGER DEFAULT 0`);
      }
      if (!hasColumn(db, 'session_memory', 'last_access_at')) {
        db.exec(`ALTER TABLE session_memory ADD COLUMN last_access_at TEXT`);
      }
      if (!hasColumn(db, 'session_memory', 'source')) {
        db.exec(`ALTER TABLE session_memory ADD COLUMN source TEXT`);
      }
      if (!hasColumn(db, 'session_memory', 'merged_from_json')) {
        db.exec(`ALTER TABLE session_memory ADD COLUMN merged_from_json TEXT`);
      }
    }
  }
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/** Read the current schema version (0 when the table is missing or empty). */
export function getCurrentSchemaVersion(db: DatabaseSync): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    );
  `);
  const row = db
    .prepare(`SELECT MAX(version) AS v FROM schema_version`)
    .get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}

function recordVersion(db: DatabaseSync, m: Migration): void {
  db.prepare(
    `INSERT OR REPLACE INTO schema_version (version, applied_at, description)
     VALUES (?, ?, ?)`
  ).run(m.version, new Date().toISOString(), m.description);
}

/**
 * Run all migrations whose version is greater than the recorded latest.
 * Each step runs inside its own transaction so a partial failure rolls back
 * cleanly without leaving the DB in a half-migrated state.
 */
export function applyMigrations(db: DatabaseSync): void {
  const current = getCurrentSchemaVersion(db);
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec('BEGIN');
    try {
      m.up(db);
      recordVersion(db, m);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(
        `schema migration v${m.version} failed (${m.description}): ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
}
