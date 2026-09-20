/**
 * Optional EventLog persistence via `node:sqlite`. Dynamic-import only — mini
 * must never statically reach this file.
 *
 * The saga layer persists the EventLog under `session.metadata.eventLog`.
 * `createSqliteEventLogStore` wraps any `EventLogPersistStore` so that the
 * same payload is mirrored into the `agent_event_log` table (write-through)
 * and read back from there first (so an in-memory session store still
 * survives a restart when the sqlite file does).
 */

import type { SessionRecord } from '../types.js';
import { EVENT_LOG_METADATA_KEY, type EventLogPersistStore } from './event-log-saga.js';

export interface SqliteEventLogHandle {
  filename: string;
  exec: (sql: string) => void;
  /** Upsert the serialized EventLog for a session. */
  save: (sessionId: string, payloadJson: string) => void;
  /** Read the serialized EventLog for a session, if any. */
  load: (sessionId: string) => string | undefined;
  /** Drop a session's row (e.g. after a hard fork/reset). */
  remove: (sessionId: string) => void;
  close: () => void;
}

export interface OpenSqliteEventLogInput {
  filename?: string;
  open?: () => Promise<SqliteEventLogHandle> | SqliteEventLogHandle;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS agent_event_log (
    session_id TEXT NOT NULL PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

export async function openSqliteEventLog(
  input?: OpenSqliteEventLogInput
): Promise<SqliteEventLogHandle | undefined> {
  if (!input) return undefined;
  if (input.open) return input.open();
  const { DatabaseSync } = await import('node:sqlite');
  const filename = input.filename ?? ':memory:';
  const db = new DatabaseSync(filename);
  db.exec(SCHEMA_SQL);
  const upsert = db.prepare(
    `INSERT INTO agent_event_log (session_id, payload, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  );
  const select = db.prepare(`SELECT payload FROM agent_event_log WHERE session_id = ?`);
  const del = db.prepare(`DELETE FROM agent_event_log WHERE session_id = ?`);
  return {
    filename,
    exec: (sql) => {
      db.exec(sql);
    },
    save: (sessionId, payloadJson) => {
      upsert.run(sessionId, payloadJson, new Date().toISOString());
    },
    load: (sessionId) => {
      const row = select.get(sessionId) as { payload?: unknown } | undefined;
      return typeof row?.payload === 'string' ? row.payload : undefined;
    },
    remove: (sessionId) => {
      del.run(sessionId);
    },
    close: () => {
      db.close();
    },
  };
}

/**
 * Write-through mirror of `metadata.eventLog` into sqlite; sqlite wins on read.
 * Everything else is delegated to `inner` unchanged, so the wrapper can stand in
 * for the inner store wherever an `EventLogPersistStore` is expected.
 */
export function createSqliteEventLogStore<S extends EventLogPersistStore>(
  inner: S,
  handle: SqliteEventLogHandle
): S {
  const overlay = (session: SessionRecord | undefined): SessionRecord | undefined => {
    if (!session) return session;
    const raw = handle.load(session.id);
    if (raw === undefined) return session;
    try {
      const parsed = JSON.parse(raw) as unknown;
      return { ...session, metadata: { ...(session.metadata ?? {}), [EVENT_LOG_METADATA_KEY]: parsed } };
    } catch {
      return session;
    }
  };

  const overrides: Pick<EventLogPersistStore, 'getSession' | 'updateSession'> = {
    getSession: (id) => overlay(inner.getSession(id)),
    updateSession: (id, patch) => {
      const log = patch.metadata?.[EVENT_LOG_METADATA_KEY];
      if (log !== undefined) {
        try {
          handle.save(id, JSON.stringify(log));
        } catch {
          /* sqlite mirror is best-effort; metadata copy below still lands */
        }
      }
      return overlay(inner.updateSession(id, patch)) as SessionRecord;
    },
  };

  // Proxy (not prototype chaining) so inner methods keep `this === inner` and
  // every other member (foldMessages, hideRange, …) stays reachable for the
  // checkpoint / surface duck-types.
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'getSession' || prop === 'updateSession') return overrides[prop];
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
