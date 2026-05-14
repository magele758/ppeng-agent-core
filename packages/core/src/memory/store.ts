import type { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from '../id.js';
import type {
  AgentMemory,
  MemoryConfidence,
  MemoryFilter,
  MemoryScope,
  Membership,
  Tenant,
  User
} from './types.js';

// Capacity limits per scope (configurable via constructor)
const DEFAULT_LIMITS: Record<MemoryScope, number> = {
  'session.scratch': 200,
  'session.long': 500,
  'user.memory': 5000,
  'team.memory': 2000,
  'project.memory': 5000
};

// ── Row mappers ──

function mapMemoryRow(row: Record<string, unknown>): AgentMemory {
  return {
    id: String(row.id),
    scope: String(row.scope) as MemoryScope,
    namespace: String(row.namespace),
    key: String(row.key),
    value: String(row.value),
    userId: row.user_id != null ? String(row.user_id) : undefined,
    tenantId: row.tenant_id != null ? String(row.tenant_id) : undefined,
    sessionId: row.session_id != null ? String(row.session_id) : undefined,
    importance: Number(row.importance ?? 0.5),
    source: row.source != null ? String(row.source) : undefined,
    confidence: String(row.confidence ?? 'medium') as MemoryConfidence,
    expiresAt: row.expires_at != null ? String(row.expires_at) : undefined,
    accessCount: Number(row.access_count ?? 0),
    lastAccessAt: row.last_access_at != null ? String(row.last_access_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapUserRow(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: row.email != null ? String(row.email) : undefined,
    displayName: row.display_name != null ? String(row.display_name) : undefined,
    status: String(row.status ?? 'active'),
    createdAt: String(row.created_at)
  };
}

function mapTenantRow(row: Record<string, unknown>): Tenant {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at)
  };
}

function mapMembershipRow(row: Record<string, unknown>): Membership {
  return {
    userId: String(row.user_id),
    tenantId: String(row.tenant_id),
    role: String(row.role ?? 'member')
  };
}

// Build the identity WHERE fragment for scope+namespace+key+owner
function ownerClause(opts: {
  userId?: string;
  tenantId?: string;
  sessionId?: string;
}): { sql: string; values: (string | null)[] } {
  const parts: string[] = [];
  const values: (string | null)[] = [];

  if (opts.userId !== undefined) {
    parts.push('user_id = ?');
    values.push(opts.userId);
  } else {
    parts.push('user_id IS NULL');
  }
  if (opts.tenantId !== undefined) {
    parts.push('tenant_id = ?');
    values.push(opts.tenantId);
  } else {
    parts.push('tenant_id IS NULL');
  }
  if (opts.sessionId !== undefined) {
    parts.push('session_id = ?');
    values.push(opts.sessionId);
  } else {
    parts.push('session_id IS NULL');
  }

  return { sql: parts.join(' AND '), values };
}

export class AgentMemoryStore {
  private readonly limits: Record<MemoryScope, number>;
  /** Whether the FTS virtual table was successfully created/exists */
  private ftsAvailable: boolean;

  constructor(
    private readonly db: DatabaseSync,
    limits?: Partial<Record<MemoryScope, number>>
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.ftsAvailable = this.checkFtsAvailable();
  }

  private checkFtsAvailable(): boolean {
    try {
      this.db.prepare(`SELECT 1 FROM agent_memory_fts LIMIT 1`).all();
      return true;
    } catch {
      return false;
    }
  }

  // ── Memory CRUD ──

  set(memory: Omit<AgentMemory, 'id' | 'createdAt' | 'updatedAt' | 'accessCount'> & Partial<Pick<AgentMemory, 'id' | 'createdAt' | 'updatedAt' | 'accessCount'>>): AgentMemory {
    const now = nowIso();
    const owner = ownerClause({
      userId: memory.userId,
      tenantId: memory.tenantId,
      sessionId: memory.sessionId
    });

    const existing = this.db
      .prepare(
        `SELECT id FROM agent_memory WHERE scope = ? AND namespace = ? AND key = ? AND ${owner.sql}`
      )
      .get(memory.scope, memory.namespace, memory.key, ...owner.values) as
      | { id: string }
      | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE agent_memory SET value = ?, importance = ?, source = ?, confidence = ?,
           expires_at = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          memory.value,
          memory.importance ?? 0.5,
          memory.source ?? null,
          memory.confidence ?? 'medium',
          memory.expiresAt ?? null,
          now,
          existing.id
        );
      return this.getById(existing.id)!;
    }

    const id = memory.id ?? createId('amem');
    this.db
      .prepare(
        `INSERT INTO agent_memory
           (id, scope, namespace, key, value, user_id, tenant_id, session_id,
            importance, source, confidence, expires_at, access_count,
            last_access_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
      )
      .run(
        id,
        memory.scope,
        memory.namespace,
        memory.key,
        memory.value,
        memory.userId ?? null,
        memory.tenantId ?? null,
        memory.sessionId ?? null,
        memory.importance ?? 0.5,
        memory.source ?? null,
        memory.confidence ?? 'medium',
        memory.expiresAt ?? null,
        now,
        memory.createdAt ?? now,
        now
      );

    this.enforceLimit(memory.scope, memory.userId, memory.tenantId, memory.sessionId);
    return this.getById(id)!;
  }

  get(opts: {
    scope: MemoryScope;
    namespace: string;
    key: string;
    userId?: string;
    tenantId?: string;
    sessionId?: string;
  }): AgentMemory | null {
    const owner = ownerClause({
      userId: opts.userId,
      tenantId: opts.tenantId,
      sessionId: opts.sessionId
    });
    const row = this.db
      .prepare(
        `SELECT * FROM agent_memory WHERE scope = ? AND namespace = ? AND key = ? AND ${owner.sql}`
      )
      .get(opts.scope, opts.namespace, opts.key, ...owner.values) as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;

    // Increment access count
    const now = nowIso();
    this.db
      .prepare(`UPDATE agent_memory SET access_count = access_count + 1, last_access_at = ? WHERE id = ?`)
      .run(now, String(row.id));

    return mapMemoryRow({ ...row, access_count: Number(row.access_count ?? 0) + 1, last_access_at: now });
  }

  private getById(id: string): AgentMemory | null {
    const row = this.db.prepare(`SELECT * FROM agent_memory WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapMemoryRow(row) : null;
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM agent_memory WHERE id = ?`).run(id);
  }

  search(filter: MemoryFilter): AgentMemory[] {
    const limit = filter.limit ?? 20;

    if (filter.query && this.ftsAvailable) {
      return this.ftsSearch(filter);
    }

    const conditions: string[] = [];
    const values: (string | number | null)[] = [];

    if (filter.scope) {
      conditions.push('scope = ?');
      values.push(filter.scope);
    }
    if (filter.namespace) {
      conditions.push('namespace = ?');
      values.push(filter.namespace);
    }
    if (filter.userId !== undefined) {
      conditions.push('user_id = ?');
      values.push(filter.userId);
    }
    if (filter.tenantId !== undefined) {
      conditions.push('tenant_id = ?');
      values.push(filter.tenantId);
    }
    if (filter.sessionId !== undefined) {
      conditions.push('session_id = ?');
      values.push(filter.sessionId);
    }
    if (filter.query) {
      // Fallback LIKE when FTS unavailable
      conditions.push('(key LIKE ? OR value LIKE ?)');
      values.push(`%${filter.query}%`, `%${filter.query}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy =
      filter.orderBy === 'importance'
        ? 'importance DESC'
        : filter.orderBy === 'access_count'
        ? 'access_count DESC'
        : 'updated_at DESC';

    const rows = this.db
      .prepare(`SELECT * FROM agent_memory ${where} ORDER BY ${orderBy} LIMIT ?`)
      .all(...values, limit) as Array<Record<string, unknown>>;

    return rows.map(mapMemoryRow);
  }

  private ftsSearch(filter: MemoryFilter): AgentMemory[] {
    const limit = filter.limit ?? 20;
    const rows = this.db
      .prepare(
        `SELECT am.* FROM agent_memory am
         JOIN agent_memory_fts fts ON am.rowid = fts.rowid
         WHERE agent_memory_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(filter.query!, limit) as Array<Record<string, unknown>>;
    return rows.map(mapMemoryRow);
  }

  /** Delete expired entries; returns count deleted. */
  expire(): number {
    const now = nowIso();
    const result = this.db
      .prepare(`DELETE FROM agent_memory WHERE expires_at IS NOT NULL AND expires_at < ?`)
      .run(now);
    return Number(result.changes);
  }

  /**
   * Enforce capacity limit for a scope+owner combination.
   * When over limit, removes lowest-importance + oldest entries.
   */
  enforceLimit(
    scope: MemoryScope,
    userId?: string,
    tenantId?: string,
    sessionId?: string
  ): void {
    const maxCount = this.limits[scope];
    const owner = ownerClause({ userId, tenantId, sessionId });

    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS cnt FROM agent_memory WHERE scope = ? AND ${owner.sql}`)
      .get(scope, ...owner.values) as { cnt: number };

    const over = countRow.cnt - maxCount;
    if (over <= 0) return;

    const evictArgs: (string | number | null)[] = [scope, ...owner.values, over];
    const evictRows = this.db
      .prepare(
        `SELECT id FROM agent_memory WHERE scope = ? AND ${owner.sql}
         ORDER BY importance ASC, updated_at ASC LIMIT ?`
      )
      .all(...evictArgs) as Array<{ id: string }>;

    const stmt = this.db.prepare(`DELETE FROM agent_memory WHERE id = ?`);
    for (const row of evictRows) {
      stmt.run(row.id);
    }
  }

  // ── User management ──

  upsertUser(user: User): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO users (id, email, display_name, status, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           email = excluded.email,
           display_name = excluded.display_name,
           status = excluded.status`
      )
      .run(
        user.id,
        user.email ?? null,
        user.displayName ?? null,
        user.status,
        user.createdAt ?? now
      );
  }

  getUser(id: string): User | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapUserRow(row) : null;
  }

  getUserByEmail(email: string): User | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as
      | Record<string, unknown>
      | undefined;
    return row ? mapUserRow(row) : null;
  }

  listUsers(): User[] {
    const rows = this.db.prepare(`SELECT * FROM users ORDER BY created_at DESC`).all() as Array<
      Record<string, unknown>
    >;
    return rows.map(mapUserRow);
  }

  // ── Tenant management ──

  upsertTenant(tenant: Tenant): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO tenants (id, name, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name`
      )
      .run(tenant.id, tenant.name, tenant.createdAt ?? now);
  }

  getTenant(id: string): Tenant | null {
    const row = this.db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapTenantRow(row) : null;
  }

  listTenants(): Tenant[] {
    const rows = this.db.prepare(`SELECT * FROM tenants ORDER BY created_at DESC`).all() as Array<
      Record<string, unknown>
    >;
    return rows.map(mapTenantRow);
  }

  // ── Membership management ──

  addMembership(m: Membership): void {
    this.db
      .prepare(
        `INSERT INTO memberships (user_id, tenant_id, role)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, tenant_id) DO UPDATE SET role = excluded.role`
      )
      .run(m.userId, m.tenantId, m.role);
  }

  getMemberships(userId: string): Membership[] {
    const rows = this.db
      .prepare(`SELECT * FROM memberships WHERE user_id = ?`)
      .all(userId) as Array<Record<string, unknown>>;
    return rows.map(mapMembershipRow);
  }
}
