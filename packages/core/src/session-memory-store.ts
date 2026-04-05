/**
 * Session memory store: manages scratchpad and long-term memory per session.
 *
 * Extracted from SqliteStateStore to reduce its size and isolate the
 * memory-management domain (upsert, retrieval, consolidation, decay).
 */
import type { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from './id.js';
import type { SessionMemoryEntry } from './types.js';

// ── Shared helpers (duplicated from storage.ts to avoid circular deps) ──

function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string | null): T {
  return (value ? JSON.parse(value) : null) as T;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// ── Row mapper ──

function mapSessionMemoryRow(row: Record<string, unknown>): SessionMemoryEntry {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    scope: String(row.scope) as SessionMemoryEntry['scope'],
    key: String(row.key),
    value: String(row.value),
    metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)) ?? {},
    importance: row.importance != null ? Number(row.importance) : undefined,
    accessCount: row.access_count != null ? Number(row.access_count) : undefined,
    lastAccessAt: optionalString(row.last_access_at),
    source: optionalString(row.source) as SessionMemoryEntry['source'] | undefined,
    mergedFrom: parseJson<string[]>(String(row.merged_from_json ?? 'null')) ?? undefined,
    updatedAt: String(row.updated_at),
  };
}

/**
 * Session memory store backed by a shared DatabaseSync instance.
 * Operates on the `session_memory` table created by SqliteStateStore.
 */
export class SessionMemoryStore {
  constructor(private readonly db: DatabaseSync) {}

  upsertSessionMemory(input: {
    sessionId: string;
    scope: SessionMemoryEntry['scope'];
    key: string;
    value: string;
    metadata?: Record<string, unknown>;
    importance?: number;
    source?: SessionMemoryEntry['source'];
    mergedFrom?: string[];
  }): SessionMemoryEntry {
    const now = nowIso();
    const existing = this.db
      .prepare(`SELECT id, access_count FROM session_memory WHERE session_id = ? AND scope = ? AND key = ?`)
      .get(input.sessionId, input.scope, input.key) as { id: string; access_count: number } | undefined;

    const metadata = input.metadata ?? {};
    const importance = input.importance ?? 0.5;
    const source = input.source ?? 'user_provided';

    if (existing) {
      const newAccessCount = existing.access_count ?? 0;
      this.db
        .prepare(
          `UPDATE session_memory SET value = ?, metadata_json = ?, importance = ?, source = ?, merged_from_json = ?, updated_at = ?, access_count = ?, last_access_at = ? WHERE id = ?`,
        )
        .run(
          input.value,
          serializeJson(metadata),
          importance,
          source,
          serializeJson(input.mergedFrom ?? null),
          now,
          newAccessCount,
          now,
          existing.id,
        );
      return this.getSessionMemoryEntry(existing.id) as SessionMemoryEntry;
    }

    const entry: SessionMemoryEntry = {
      id: createId('mem'),
      sessionId: input.sessionId,
      scope: input.scope,
      key: input.key,
      value: input.value,
      metadata,
      importance,
      accessCount: 0,
      lastAccessAt: now,
      source,
      mergedFrom: input.mergedFrom,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO session_memory (id, session_id, scope, key, value, metadata_json, importance, access_count, last_access_at, source, merged_from_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.sessionId,
        entry.scope,
        entry.key,
        entry.value,
        serializeJson(entry.metadata),
        entry.importance ?? 0.5,
        entry.accessCount ?? 0,
        entry.lastAccessAt ?? now,
        entry.source ?? 'user_provided',
        serializeJson(entry.mergedFrom ?? null),
        entry.updatedAt,
      );

    return entry;
  }

  getSessionMemoryEntry(id: string): SessionMemoryEntry | undefined {
    const row = this.db.prepare(`SELECT * FROM session_memory WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? mapSessionMemoryRow(row) : undefined;
  }

  listSessionMemory(sessionId: string, scope?: SessionMemoryEntry['scope']): SessionMemoryEntry[] {
    const rows = (scope
      ? this.db
          .prepare(`SELECT * FROM session_memory WHERE session_id = ? AND scope = ? ORDER BY key ASC`)
          .all(sessionId, scope)
      : this.db.prepare(`SELECT * FROM session_memory WHERE session_id = ? ORDER BY scope ASC, key ASC`).all(sessionId)) as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => mapSessionMemoryRow(row));
  }

  deleteSessionMemory(sessionId: string, scope: SessionMemoryEntry['scope'], key: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM session_memory WHERE session_id = ? AND scope = ? AND key = ?`)
      .run(sessionId, scope, key);
    return result.changes > 0;
  }

  /** Copy memory rows from one session to another (upsert by key). */
  copySessionMemory(fromSessionId: string, toSessionId: string, scope: SessionMemoryEntry['scope']): number {
    const rows = this.listSessionMemory(fromSessionId, scope);
    for (const row of rows) {
      this.upsertSessionMemory({
        sessionId: toSessionId,
        scope,
        key: row.key,
        value: row.value,
        metadata: row.metadata,
        importance: row.importance,
        source: row.source,
        mergedFrom: row.mergedFrom,
      });
    }
    return rows.length;
  }

  /**
   * Record access to a memory entry (increments access_count, updates last_access_at).
   */
  touchSessionMemory(id: string): SessionMemoryEntry | undefined {
    const existing = this.getSessionMemoryEntry(id);
    if (!existing) return undefined;

    const now = nowIso();
    const newCount = (existing.accessCount ?? 0) + 1;
    this.db
      .prepare(`UPDATE session_memory SET access_count = ?, last_access_at = ? WHERE id = ?`)
      .run(newCount, now, id);

    return this.getSessionMemoryEntry(id);
  }

  /**
   * List memory entries sorted by importance (descending) then recency.
   */
  listSessionMemoryByRelevance(
    sessionId: string,
    scope?: SessionMemoryEntry['scope'],
    limit?: number,
  ): SessionMemoryEntry[] {
    const baseQuery = scope
      ? `SELECT * FROM session_memory WHERE session_id = ? AND scope = ?`
      : `SELECT * FROM session_memory WHERE session_id = ?`;
    const orderClause = ` ORDER BY importance DESC, last_access_at DESC`;
    const limitClause = limit ? ` LIMIT ?` : '';

    const rows = (scope
      ? this.db.prepare(baseQuery + orderClause + limitClause).all(sessionId, scope, ...(limit ? [limit] : []))
      : this.db.prepare(baseQuery + orderClause + limitClause).all(sessionId, ...(limit ? [limit] : []))
    ) as Array<Record<string, unknown>>;

    return rows.map((row) => mapSessionMemoryRow(row));
  }

  /**
   * Consolidate multiple memory entries into a single entry.
   * Merged entries are deleted after consolidation.
   */
  consolidateSessionMemory(
    sessionId: string,
    scope: SessionMemoryEntry['scope'],
    keys: string[],
    newKey: string,
    consolidatedValue: string,
    importance?: number,
  ): SessionMemoryEntry | undefined {
    if (keys.length === 0) return undefined;

    const entries = keys
      .map((k) =>
        this.db
          .prepare(`SELECT * FROM session_memory WHERE session_id = ? AND scope = ? AND key = ?`)
          .get(sessionId, scope, k) as SessionMemoryEntry | undefined,
      )
      .filter((e): e is SessionMemoryEntry => e !== undefined);

    if (entries.length === 0) return undefined;

    const mergedImportance =
      importance ?? Math.max(...entries.map((e) => e.importance ?? 0.5));
    const mergedIds = entries.map((e) => e.id);

    const consolidated = this.upsertSessionMemory({
      sessionId,
      scope,
      key: newKey,
      value: consolidatedValue,
      importance: mergedImportance,
      source: 'consolidated',
      mergedFrom: mergedIds,
    });

    for (const key of keys) {
      this.deleteSessionMemory(sessionId, scope, key);
    }

    return consolidated;
  }

  /**
   * Calculate time-decayed relevance score for a memory entry.
   *
   * Decay model: relevance = importance * e^(-decay_rate * hours_since_access) * log(1 + access_count)
   */
  calculateDecayedRelevance(
    entry: SessionMemoryEntry,
    options?: { halfLifeHours?: number; now?: Date },
  ): number {
    const halfLife = options?.halfLifeHours ?? 24;
    const now = options?.now ?? new Date();

    const importance = entry.importance ?? 0.5;
    const accessCount = entry.accessCount ?? 0;

    const lastAccess = entry.lastAccessAt ? new Date(entry.lastAccessAt) : new Date(entry.updatedAt);
    const hoursSinceAccess = Math.max(0, (now.getTime() - lastAccess.getTime()) / (1000 * 60 * 60));

    const decayRate = Math.LN2 / halfLife;
    const decayFactor = Math.exp(-decayRate * hoursSinceAccess);

    const reinforcementFactor = Math.log(1 + accessCount) + 1;

    const relevance = importance * decayFactor * reinforcementFactor;
    return Math.max(0, relevance);
  }

  /**
   * List memory entries sorted by decayed relevance score.
   */
  listSessionMemoryByDecayedRelevance(
    sessionId: string,
    scope?: SessionMemoryEntry['scope'],
    options?: { limit?: number; halfLifeHours?: number },
  ): Array<SessionMemoryEntry & { decayedRelevance: number }> {
    const entries = this.listSessionMemory(sessionId, scope);
    const now = new Date();
    const halfLife = options?.halfLifeHours ?? 24;

    const scored = entries.map((entry) => ({
      ...entry,
      decayedRelevance: this.calculateDecayedRelevance(entry, { halfLifeHours: halfLife, now }),
    }));

    scored.sort((a, b) => b.decayedRelevance - a.decayedRelevance);

    const limit = options?.limit;
    return limit ? scored.slice(0, limit) : scored;
  }
}
