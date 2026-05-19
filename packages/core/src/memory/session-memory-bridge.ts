/**
 * Bridges legacy session_memory API (scratch/long) to AgentMemoryStore.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { AgentMemory } from './types.js';
import { AgentMemoryStore } from './store.js';
import {
  agentScopeToSession,
  memoryBackendFromEnv,
  sessionScopeToAgent,
  type MemoryBackend
} from './memory-backend.js';
import { SessionMemoryStore } from '../stores/session-memory-store.js';
import type { SessionMemoryEntry } from '../types.js';

function agentToSessionEntry(m: AgentMemory): SessionMemoryEntry {
  const scope = agentScopeToSession(m.scope) ?? 'scratch';
  return {
    id: m.id,
    sessionId: m.sessionId ?? '',
    scope,
    key: m.key,
    value: m.value,
    metadata: {},
    importance: m.importance,
    accessCount: m.accessCount,
    lastAccessAt: m.lastAccessAt,
    source: (m.source as SessionMemoryEntry['source']) ?? 'user_provided',
    updatedAt: m.updatedAt
  };
}

/**
 * Unified session-scoped memory (scratch/long) with optional dual-write to session_memory.
 */
export class SessionMemoryBridge {
  readonly agentMemory: AgentMemoryStore;
  private readonly sessionMemory: SessionMemoryStore;
  private readonly backend: MemoryBackend;

  constructor(db: DatabaseSync, backend?: MemoryBackend) {
    this.backend = backend ?? memoryBackendFromEnv();
    this.agentMemory = new AgentMemoryStore(db);
    this.sessionMemory = new SessionMemoryStore(db);
  }

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
    let result: SessionMemoryEntry | undefined;

    if (this.backend === 'agent' || this.backend === 'dual') {
      const saved = this.agentMemory.set({
        scope: sessionScopeToAgent(input.scope),
        namespace: 'default',
        key: input.key,
        value: input.value,
        sessionId: input.sessionId,
        importance: input.importance ?? 0.5,
        source: input.source ?? 'user_provided',
        confidence: 'medium'
      });
      result = {
        ...agentToSessionEntry(saved),
        mergedFrom: input.mergedFrom,
        metadata: input.metadata ?? {}
      };
    }

    if (this.backend === 'session' || this.backend === 'dual') {
      const legacy = this.sessionMemory.upsertSessionMemory(input);
      if (this.backend === 'session') result = legacy;
    }

    return result as SessionMemoryEntry;
  }

  getSessionMemoryEntry(id: string): SessionMemoryEntry | undefined {
    if (this.backend === 'agent' || this.backend === 'dual') {
      const row = this.agentMemory.getEntryById(id);
      if (row) {
        const mapped = agentToSessionEntry(row);
        if (agentScopeToSession(row.scope)) return mapped;
      }
    }
    if (this.backend === 'session' || this.backend === 'dual') {
      return this.sessionMemory.getSessionMemoryEntry(id);
    }
    return undefined;
  }

  listSessionMemory(sessionId: string, scope?: SessionMemoryEntry['scope']): SessionMemoryEntry[] {
    if (this.backend === 'agent' || this.backend === 'dual') {
      const scopes = scope
        ? [sessionScopeToAgent(scope)]
        : (['session.scratch', 'session.long'] as const);
      const out: SessionMemoryEntry[] = [];
      for (const agentScope of scopes) {
        const rows = this.agentMemory.search({
          sessionId,
          scope: agentScope,
          limit: 500,
          orderBy: 'recency'
        });
        for (const r of rows) {
          const s = agentScopeToSession(r.scope);
          if (s) out.push(agentToSessionEntry(r));
        }
      }
      out.sort((a, b) => a.scope.localeCompare(b.scope) || a.key.localeCompare(b.key));
      if (this.backend === 'agent') return out;
      if (out.length > 0) return out;
    }
    return this.sessionMemory.listSessionMemory(sessionId, scope);
  }

  deleteSessionMemory(sessionId: string, scope: SessionMemoryEntry['scope'], key: string): boolean {
    let ok = false;
    if (this.backend === 'agent' || this.backend === 'dual') {
      const existing = this.agentMemory.get({
        scope: sessionScopeToAgent(scope),
        namespace: 'default',
        key,
        sessionId
      });
      if (existing) {
        this.agentMemory.delete(existing.id);
        ok = true;
      }
    }
    if (this.backend === 'session' || this.backend === 'dual') {
      ok = this.sessionMemory.deleteSessionMemory(sessionId, scope, key) || ok;
    }
    return ok;
  }

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
        mergedFrom: row.mergedFrom
      });
    }
    return rows.length;
  }

  touchSessionMemory(id: string): SessionMemoryEntry | undefined {
    if (this.backend === 'agent' || this.backend === 'dual') {
      const row = this.agentMemory.touchById(id);
      if (row && agentScopeToSession(row.scope)) {
        return agentToSessionEntry(row);
      }
    }
    return this.sessionMemory.touchSessionMemory(id);
  }

  listSessionMemoryByRelevance(
    sessionId: string,
    scope?: SessionMemoryEntry['scope'],
    limit?: number
  ): SessionMemoryEntry[] {
    const entries = this.listSessionMemory(sessionId, scope);
    entries.sort((a, b) => {
      const ia = a.importance ?? 0.5;
      const ib = b.importance ?? 0.5;
      if (ib !== ia) return ib - ia;
      return (b.lastAccessAt ?? b.updatedAt).localeCompare(a.lastAccessAt ?? a.updatedAt);
    });
    return limit ? entries.slice(0, limit) : entries;
  }

  consolidateSessionMemory(
    sessionId: string,
    scope: SessionMemoryEntry['scope'],
    keys: string[],
    newKey: string,
    consolidatedValue: string,
    importance?: number
  ): SessionMemoryEntry | undefined {
    if (keys.length === 0) return undefined;
    const entries = keys
      .map((k) => this.listSessionMemory(sessionId, scope).find((e) => e.key === k))
      .filter((e): e is SessionMemoryEntry => e !== undefined);
    if (entries.length === 0) return undefined;

    const mergedImportance = importance ?? Math.max(...entries.map((e) => e.importance ?? 0.5));
    const consolidated = this.upsertSessionMemory({
      sessionId,
      scope,
      key: newKey,
      value: consolidatedValue,
      importance: mergedImportance,
      source: 'consolidated',
      mergedFrom: entries.map((e) => e.id)
    });
    for (const key of keys) {
      if (key !== newKey) this.deleteSessionMemory(sessionId, scope, key);
    }
    return consolidated;
  }

  calculateDecayedRelevance(
    entry: SessionMemoryEntry,
    options?: { halfLifeHours?: number; now?: Date }
  ): number {
    return this.sessionMemory.calculateDecayedRelevance(entry, options);
  }

  listSessionMemoryByDecayedRelevance(
    sessionId: string,
    scope?: SessionMemoryEntry['scope'],
    options?: { limit?: number; halfLifeHours?: number }
  ): Array<SessionMemoryEntry & { decayedRelevance: number }> {
    const entries = this.listSessionMemory(sessionId, scope);
    const now = new Date();
    const halfLife = options?.halfLifeHours ?? 24;
    const scored = entries.map((entry) => ({
      ...entry,
      decayedRelevance: this.calculateDecayedRelevance(entry, { halfLifeHours: halfLife, now })
    }));
    scored.sort((a, b) => b.decayedRelevance - a.decayedRelevance);
    const limit = options?.limit;
    return limit ? scored.slice(0, limit) : scored;
  }
}
