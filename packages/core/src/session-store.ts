import { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from './id.js';
import { serializeJson, parseJson, optionalString, boolToInt, intToBool } from './storage-helpers.js';
import type { MessageRole, SessionMessage, SessionRecord, SessionStatus } from './types.js';

export interface CreateSessionInput {
  title: string;
  mode: SessionRecord['mode'];
  agentId: string;
  taskId?: string;
  workspaceId?: string;
  parentSessionId?: string;
  background?: boolean;
  summary?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Domain store for session + message persistence.
 * Shares the same DatabaseSync instance with SqliteStateStore.
 */
export class SessionStore {
  constructor(private readonly db: DatabaseSync) {}

  createSession(input: CreateSessionInput): SessionRecord {
    const now = nowIso();
    const session: SessionRecord = {
      id: createId('session'),
      title: input.title,
      mode: input.mode,
      status: 'idle',
      agentId: input.agentId,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      parentSessionId: input.parentSessionId,
      background: input.background ?? false,
      summary: input.summary,
      todo: [],
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(`
        INSERT INTO sessions (
          id, title, mode, status, agent_id, task_id, workspace_id, parent_session_id, background,
          summary, todo_json, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        session.id,
        session.title,
        session.mode,
        session.status,
        session.agentId,
        session.taskId ?? null,
        session.workspaceId ?? null,
        session.parentSessionId ?? null,
        boolToInt(session.background),
        session.summary ?? null,
        serializeJson(session.todo),
        serializeJson(session.metadata),
        session.createdAt,
        session.updatedAt
      );

    return session;
  }

  listSessions(): SessionRecord[] {
    const rows = this.db.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`).all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapSessionRow(row));
  }

  getSession(id: string): SessionRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapSessionRow(row) : undefined;
  }

  updateSession(
    sessionId: string,
    patch: Partial<Omit<SessionRecord, 'id' | 'createdAt'>>
  ): SessionRecord {
    const existing = this.getSession(sessionId);
    if (!existing) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const next: SessionRecord = {
      ...existing,
      ...patch,
      updatedAt: nowIso()
    };

    this.db
      .prepare(`
        UPDATE sessions
        SET title = ?, mode = ?, status = ?, agent_id = ?, task_id = ?, workspace_id = ?,
            parent_session_id = ?, background = ?, summary = ?, todo_json = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        next.title,
        next.mode,
        next.status,
        next.agentId,
        next.taskId ?? null,
        next.workspaceId ?? null,
        next.parentSessionId ?? null,
        boolToInt(next.background),
        next.summary ?? null,
        serializeJson(next.todo),
        serializeJson(next.metadata),
        next.updatedAt,
        next.id
      );

    return next;
  }

  appendMessage(sessionId: string, role: MessageRole, parts: SessionMessage['parts']): SessionMessage {
    const message: SessionMessage = {
      id: createId('msg'),
      sessionId,
      role,
      parts,
      createdAt: nowIso()
    };

    this.db
      .prepare(`
        INSERT INTO session_messages (id, session_id, role, parts_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(message.id, message.sessionId, message.role, serializeJson(message.parts), message.createdAt);

    // Keep session.updated_at in sync with latest message
    this.db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(message.createdAt, sessionId);
    return message;
  }

  listMessages(sessionId: string): SessionMessage[] {
    const rows = this.db
      .prepare(`SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at ASC`)
      .all(sessionId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      role: String(row.role) as MessageRole,
      parts: parseJson<SessionMessage['parts']>(String(row.parts_json)),
      createdAt: String(row.created_at)
    }));
  }

  private mapSessionRow(row: Record<string, unknown>): SessionRecord {
    return {
      id: String(row.id),
      title: String(row.title),
      mode: String(row.mode) as SessionRecord['mode'],
      status: String(row.status) as SessionStatus,
      agentId: String(row.agent_id),
      taskId: optionalString(row.task_id),
      workspaceId: optionalString(row.workspace_id),
      parentSessionId: optionalString(row.parent_session_id),
      background: intToBool(row.background),
      summary: optionalString(row.summary),
      todo: parseJson<SessionRecord['todo']>(String(row.todo_json)) ?? [],
      metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)) ?? {},
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }
}
