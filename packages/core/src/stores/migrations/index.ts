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
  },
  {
    version: 4,
    description: 'agent_cases + fts for evolving / case recall',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_cases (
          id TEXT PRIMARY KEY,
          namespace TEXT,
          session_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          task_fingerprint TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK(outcome IN ('success','failure','partial')),
          signals_json TEXT,
          what_worked TEXT,
          what_failed TEXT,
          pivot_hint TEXT,
          applicable_when TEXT,
          not_applicable_when TEXT,
          confidence REAL NOT NULL DEFAULT 0.5 CHECK(confidence BETWEEN 0 AND 1),
          source TEXT NOT NULL CHECK(source IN ('reviewer','manual','import')),
          embedding_json TEXT,
          recall_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          extra_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_agent_cases_agent ON agent_cases(agent_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_cases_namespace ON agent_cases(namespace, agent_id);
        CREATE INDEX IF NOT EXISTS idx_agent_cases_session ON agent_cases(session_id);
      `);
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS agent_cases_fts USING fts5(
          body,
          case_id UNINDEXED,
          tokenize = 'unicode61'
        );
      `);
    }
  },
  {
    version: 5,
    description: 'orchestration_runs / orchestration_steps / orchestration_events tables',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS orchestration_runs (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          source_type TEXT NOT NULL DEFAULT '',
          source_ref TEXT NOT NULL DEFAULT '',
          flywheels TEXT NOT NULL DEFAULT '[]',
          capability_tags TEXT NOT NULL DEFAULT '[]',
          risk_level TEXT NOT NULL DEFAULT 'low',
          status TEXT NOT NULL DEFAULT 'pending',
          budget TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS orchestration_steps (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
          stage TEXT NOT NULL,
          executor TEXT NOT NULL DEFAULT '',
          input_artifact TEXT,
          output_artifact TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          failure_type TEXT,
          next_action TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS orchestration_events (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
          step_id TEXT,
          kind TEXT NOT NULL,
          actor TEXT NOT NULL DEFAULT '',
          payload_json TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_orchestration_steps_run_id ON orchestration_steps(run_id);
        CREATE INDEX IF NOT EXISTS idx_orchestration_events_run_id ON orchestration_events(run_id);
        CREATE INDEX IF NOT EXISTS idx_orchestration_runs_status ON orchestration_runs(status);
      `);
    }
  },
  {
    version: 6,
    description: 'deep research tables: tasks / sources / evidence / claims',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS research_tasks (
          id TEXT PRIMARY KEY,
          query TEXT NOT NULL,
          scope TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          capability_tags TEXT NOT NULL DEFAULT '[]',
          report_path TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS research_sources (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
          kind TEXT NOT NULL DEFAULT 'web',
          url TEXT,
          title TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          trust_level TEXT NOT NULL DEFAULT 'unknown'
        );

        CREATE TABLE IF NOT EXISTS research_evidence (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL REFERENCES research_sources(id) ON DELETE CASCADE,
          task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
          quote TEXT NOT NULL,
          location TEXT,
          relevance REAL NOT NULL DEFAULT 0.5
        );

        CREATE TABLE IF NOT EXISTS research_claims (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
          text TEXT NOT NULL,
          confidence TEXT NOT NULL DEFAULT 'medium',
          evidence_ids TEXT NOT NULL DEFAULT '[]',
          caveats TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_research_sources_task_id ON research_sources(task_id);
        CREATE INDEX IF NOT EXISTS idx_research_evidence_task_id ON research_evidence(task_id);
        CREATE INDEX IF NOT EXISTS idx_research_claims_task_id ON research_claims(task_id);
        CREATE INDEX IF NOT EXISTS idx_research_tasks_status ON research_tasks(status);
      `);
    }
  },
  {
    version: 7,
    description: 'users / tenants / memberships / agent_memory multi-layer memory tables',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE,
          display_name TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tenants (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memberships (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'member',
          PRIMARY KEY (user_id, tenant_id)
        );

        CREATE TABLE IF NOT EXISTS agent_memory (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL DEFAULT 'session.scratch',
          namespace TEXT NOT NULL DEFAULT 'default',
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          user_id TEXT,
          tenant_id TEXT,
          session_id TEXT,
          importance REAL NOT NULL DEFAULT 0.5,
          source TEXT,
          confidence TEXT NOT NULL DEFAULT 'medium',
          expires_at TEXT,
          access_count INTEGER NOT NULL DEFAULT 0,
          last_access_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_memory_scope_key ON agent_memory(scope, namespace, key);
        CREATE INDEX IF NOT EXISTS idx_agent_memory_user_id ON agent_memory(user_id);
        CREATE INDEX IF NOT EXISTS idx_agent_memory_tenant_id ON agent_memory(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_agent_memory_session_id ON agent_memory(session_id);
        CREATE INDEX IF NOT EXISTS idx_agent_memory_expires_at ON agent_memory(expires_at);
      `);
      // FTS5 support — try/catch so environments without fts5 don't block the migration.
      try {
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts USING fts5(
            key,
            value,
            content=agent_memory,
            content_rowid=rowid
          );
        `);
      } catch {
        /* FTS5 unavailable — full-text search will fall back to LIKE queries */
      }
    }
  },
  {
    version: 8,
    description: 'swarm_runs / swarm_tasks / swarm_reviews tables for Teams Swarm',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS swarm_runs (
          id TEXT PRIMARY KEY,
          goal TEXT NOT NULL,
          orchestration_run_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          strategy TEXT NOT NULL DEFAULT 'pipeline',
          budget TEXT NOT NULL DEFAULT '{"maxTeammates":3,"maxTurnsPerAgent":20,"maxDurationMs":600000}',
          quality_gate TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS swarm_tasks (
          id TEXT PRIMARY KEY,
          swarm_run_id TEXT NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          required_role TEXT NOT NULL DEFAULT 'implementer',
          owner_agent_id TEXT,
          capability_tags TEXT NOT NULL DEFAULT '[]',
          acceptance_criteria TEXT NOT NULL DEFAULT '[]',
          artifacts TEXT NOT NULL DEFAULT '[]',
          blocked_by TEXT NOT NULL DEFAULT '[]',
          budget TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS swarm_reviews (
          id TEXT PRIMARY KEY,
          swarm_run_id TEXT NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
          task_id TEXT NOT NULL,
          reviewer_agent_id TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'reviewer',
          scores TEXT NOT NULL DEFAULT '{}',
          passed INTEGER NOT NULL DEFAULT 0,
          feedback TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_swarm_tasks_run_id ON swarm_tasks(swarm_run_id);
        CREATE INDEX IF NOT EXISTS idx_swarm_tasks_status ON swarm_tasks(status);
        CREATE INDEX IF NOT EXISTS idx_swarm_reviews_run_id ON swarm_reviews(swarm_run_id);
        CREATE INDEX IF NOT EXISTS idx_swarm_runs_status ON swarm_runs(status);
      `);
    }
  },
  {
    version: 9,
    description: 'migrate session_memory rows into agent_memory (session.scratch / session.long)',
    up: (db) => {
      const rows = db
        .prepare(`SELECT * FROM session_memory`)
        .all() as Array<Record<string, unknown>>;
      const insert = db.prepare(`
        INSERT OR IGNORE INTO agent_memory
          (id, scope, namespace, key, value, user_id, tenant_id, session_id,
           importance, source, confidence, expires_at, access_count, last_access_at, created_at, updated_at)
        VALUES (?, ?, 'default', ?, ?, NULL, NULL, ?, ?, ?, 'medium', NULL, ?, ?, ?, ?)
      `);
      for (const row of rows) {
        const legacyScope = String(row.scope);
        const agentScope =
          legacyScope === 'long' ? 'session.long' : legacyScope === 'scratch' ? 'session.scratch' : null;
        if (!agentScope) continue;
        const sessionId = String(row.session_id);
        const key = String(row.key);
        const exists = db
          .prepare(
            `SELECT 1 FROM agent_memory WHERE session_id = ? AND scope = ? AND namespace = 'default' AND key = ?`
          )
          .get(sessionId, agentScope, key);
        if (exists) continue;
        insert.run(
          String(row.id),
          agentScope,
          key,
          String(row.value),
          sessionId,
          row.importance != null ? Number(row.importance) : 0.5,
          row.source != null ? String(row.source) : 'migrated',
          row.access_count != null ? Number(row.access_count) : 0,
          row.last_access_at != null ? String(row.last_access_at) : null,
          String(row.created_at ?? row.updated_at),
          String(row.updated_at)
        );
      }
    }
  },
  {
    version: 10,
    description: 'agent_cases status / half_life_days / expires_at for case governance',
    up: (db) => {
      db.exec(`
        ALTER TABLE agent_cases ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
      `);
      db.exec(`
        ALTER TABLE agent_cases ADD COLUMN half_life_days REAL NOT NULL DEFAULT 30;
      `);
      db.exec(`
        ALTER TABLE agent_cases ADD COLUMN expires_at TEXT;
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_agent_cases_status ON agent_cases(status, agent_id);
      `);
    }
  },
  {
    version: 11,
    description: 'capability discovery registry (capabilities + capability_bindings)',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS capabilities (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          endpoint TEXT NOT NULL,
          transport TEXT NOT NULL DEFAULT 'https',
          schema_ref TEXT,
          schema_hash TEXT,
          trust TEXT NOT NULL DEFAULT 'untrusted',
          scope TEXT NOT NULL DEFAULT '[]',
          cred_ref TEXT,
          source TEXT NOT NULL DEFAULT 'manual',
          cbom_json TEXT,
          pool TEXT,
          tags_json TEXT,
          metadata_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_capabilities_trust ON capabilities(trust);
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_capabilities_kind ON capabilities(kind);
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_capabilities_pool ON capabilities(pool);
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS capability_bindings (
          id TEXT PRIMARY KEY,
          capability_id TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          schema_hash_pin TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          bound_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          metadata_json TEXT,
          FOREIGN KEY (capability_id) REFERENCES capabilities(id)
        );
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_capability_bindings_cap
          ON capability_bindings(capability_id, status);
      `);
    }
  },
  {
    version: 12,
    description: 'session_messages surface algebra: seq / key / surface_op / replaces_*',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          parts_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      if (!hasColumn(db, 'session_messages', 'seq')) {
        db.exec(`ALTER TABLE session_messages ADD COLUMN seq INTEGER`);
      }
      if (!hasColumn(db, 'session_messages', 'key')) {
        db.exec(`ALTER TABLE session_messages ADD COLUMN key TEXT`);
      }
      if (!hasColumn(db, 'session_messages', 'surface_op')) {
        db.exec(`ALTER TABLE session_messages ADD COLUMN surface_op TEXT DEFAULT 'append'`);
      }
      if (!hasColumn(db, 'session_messages', 'replaces_start')) {
        db.exec(`ALTER TABLE session_messages ADD COLUMN replaces_start INTEGER`);
      }
      if (!hasColumn(db, 'session_messages', 'replaces_end')) {
        db.exec(`ALTER TABLE session_messages ADD COLUMN replaces_end INTEGER`);
      }

      db.exec(`
        UPDATE session_messages
        SET surface_op = 'append'
        WHERE surface_op IS NULL OR surface_op = ''
      `);

      const pending = db
        .prepare(
          `SELECT id, session_id FROM session_messages WHERE seq IS NULL ORDER BY session_id, created_at ASC, id ASC`
        )
        .all() as Array<{ id: string; session_id: string }>;
      const nextBySession = new Map<string, number>();
      const maxRows = db
        .prepare(
          `SELECT session_id, MAX(seq) AS m FROM session_messages WHERE seq IS NOT NULL GROUP BY session_id`
        )
        .all() as Array<{ session_id: string; m: number }>;
      for (const row of maxRows) {
        nextBySession.set(String(row.session_id), Number(row.m));
      }
      const updateSeq = db.prepare(`UPDATE session_messages SET seq = ? WHERE id = ?`);
      for (const row of pending) {
        const sid = String(row.session_id);
        const next = (nextBySession.get(sid) ?? 0) + 1;
        nextBySession.set(sid, next);
        updateSeq.run(next, String(row.id));
      }

      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_session_messages_seq
          ON session_messages(session_id, seq);
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_session_messages_key
          ON session_messages(session_id, key);
      `);
    }
  },
  {
    version: 13,
    description: 'session_inbox for next-step / next-run steer',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_inbox (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          target TEXT NOT NULL,
          role TEXT NOT NULL,
          text TEXT NOT NULL,
          key TEXT,
          created_at TEXT NOT NULL,
          claimed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_session_inbox_claim
          ON session_inbox(session_id, target, claimed_at);
      `);
    }
  },
  {
    version: 14,
    description: 'sessions.active_writer_run_id WAL writer claim',
    up: (db) => {
      const hasSessions = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'`)
        .get();
      if (!hasSessions) return;
      if (!hasColumn(db, 'sessions', 'active_writer_run_id')) {
        db.exec(`ALTER TABLE sessions ADD COLUMN active_writer_run_id TEXT`);
      }
    }
  },
  {
    version: 15,
    description: 'bots roster + canonical session binding',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS bots (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          agent_id TEXT NOT NULL,
          canonical_session_id TEXT NOT NULL,
          hidden INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_bots_name_nocase ON bots(name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_bots_canonical_session ON bots(canonical_session_id);
        CREATE INDEX IF NOT EXISTS idx_bots_hidden ON bots(hidden);
      `);
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
