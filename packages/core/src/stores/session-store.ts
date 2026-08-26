import { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from '../id.js';
import { serializeJson, parseJson, optionalString, boolToInt, intToBool } from './storage-helpers.js';
import type { MessageRole, SessionMessage, SessionRecord, SessionStatus } from '../types.js';
import {
  assertNoOpenToolWaveForCompact,
  assertReplaceRangeClosed,
  assertReplaceRangeCovered,
  assertSeqStrictlyIncreasing,
  foldSurface,
  parseSurfaceOp,
  type SurfaceNode,
  type SurfaceOp
} from '../session/surface-invariants.js';

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

export interface AppendReplacementInput {
  startSeq: number;
  endSeq: number;
  role: MessageRole;
  parts: SessionMessage['parts'];
  key?: string;
}

/**
 * Domain store for session + message persistence.
 * Shares the same DatabaseSync instance with SqliteStateStore.
 *
 * `session_messages` is an append-only WAL. Visibility is a surface algebra
 * (append / replace / hide). The model path must use {@link foldMessages},
 * never {@link listMessages}.
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

  appendMessage(
    sessionId: string,
    role: MessageRole,
    parts: SessionMessage['parts'],
    opts?: { key?: string }
  ): SessionMessage {
    const node = this.insertSurfaceNode({
      sessionId,
      role,
      parts,
      surfaceOp: 'append',
      key: opts?.key
    });
    return this.surfaceToMessage(node);
  }

  appendReplacement(sessionId: string, input: AppendReplacementInput): SessionMessage {
    const wal = this.listSurfaceNodes(sessionId);
    assertSeqStrictlyIncreasing(wal);
    assertReplaceRangeCovered(wal, input.startSeq, input.endSeq);
    assertReplaceRangeClosed(wal, input.startSeq, input.endSeq);
    const node = this.insertSurfaceNode({
      sessionId,
      role: input.role,
      parts: input.parts,
      surfaceOp: 'replace',
      key: input.key,
      replacesStart: input.startSeq,
      replacesEnd: input.endSeq
    });
    return this.surfaceToMessage(node);
  }

  hideByKey(sessionId: string, key: string): number {
    if (!key) return 0;
    const folded = this.foldMessages(sessionId);
    const targets = folded.filter((m) => m.key === key && m.seq !== undefined);
    for (const message of targets) {
      this.insertSurfaceNode({
        sessionId,
        role: message.role,
        parts: [],
        surfaceOp: 'hide',
        key,
        replacesStart: message.seq,
        replacesEnd: message.seq
      });
    }
    return targets.length;
  }

  hideRange(sessionId: string, startSeq: number, endSeq: number): SessionMessage {
    const wal = this.listSurfaceNodes(sessionId);
    assertSeqStrictlyIncreasing(wal);
    assertReplaceRangeCovered(wal, startSeq, endSeq);
    const node = this.insertSurfaceNode({
      sessionId,
      role: 'system',
      parts: [],
      surfaceOp: 'hide',
      replacesStart: startSeq,
      replacesEnd: endSeq
    });
    return this.surfaceToMessage(node);
  }

  /**
   * Unique packing entry for the model path. Hide/replace ops shadow earlier
   * seqs; hide rows themselves never appear.
   */
  foldMessages(sessionId: string): SessionMessage[] {
    return foldSurface(this.listSurfaceNodes(sessionId));
  }

  /**
   * Full WAL for audit / UI (append + replace rows). Hide ops are not content.
   * The model path must not use this as input.
   */
  listMessages(sessionId: string): SessionMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM session_messages
         WHERE session_id = ?
           AND (surface_op IS NULL OR surface_op != 'hide')
         ORDER BY seq ASC, created_at ASC, id ASC`
      )
      .all(sessionId) as Array<Record<string, unknown>>;

    return rows.map((row) => this.surfaceToMessage(this.mapSurfaceRow(row)));
  }

  listSurfaceNodes(sessionId: string): SurfaceNode[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM session_messages WHERE session_id = ? ORDER BY seq ASC, created_at ASC, id ASC`
      )
      .all(sessionId) as Array<Record<string, unknown>>;
    const nodes = rows.map((row) => this.mapSurfaceRow(row));
    assertSeqStrictlyIncreasing(nodes);
    return nodes;
  }

  /** Compact helpers: throw if fold currently has an unmatched tool_call. */
  assertFoldClosedForCompact(sessionId: string): void {
    assertNoOpenToolWaveForCompact(this.foldMessages(sessionId));
  }

  private nextSeq(sessionId: string): number {
    const row = this.db
      .prepare(`SELECT MAX(seq) AS m FROM session_messages WHERE session_id = ?`)
      .get(sessionId) as { m: number | null } | undefined;
    return (row?.m ?? 0) + 1;
  }

  private insertSurfaceNode(input: {
    sessionId: string;
    role: MessageRole;
    parts: SessionMessage['parts'];
    surfaceOp: SurfaceOp;
    key?: string;
    replacesStart?: number;
    replacesEnd?: number;
  }): SurfaceNode {
    const now = nowIso();
    const node: SurfaceNode = {
      id: createId('msg'),
      sessionId: input.sessionId,
      seq: this.nextSeq(input.sessionId),
      key: input.key,
      surfaceOp: input.surfaceOp,
      replacesStart: input.replacesStart,
      replacesEnd: input.replacesEnd,
      role: input.role,
      parts: input.parts,
      createdAt: now
    };

    this.db
      .prepare(`
        INSERT INTO session_messages (
          id, session_id, role, parts_json, created_at,
          seq, key, surface_op, replaces_start, replaces_end
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        node.id,
        node.sessionId,
        node.role,
        serializeJson(node.parts),
        node.createdAt,
        node.seq,
        node.key ?? null,
        node.surfaceOp,
        node.replacesStart ?? null,
        node.replacesEnd ?? null
      );

    this.db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(node.createdAt, input.sessionId);
    return node;
  }

  private mapSurfaceRow(row: Record<string, unknown>): SurfaceNode {
    const seqRaw = row.seq;
    const seq = typeof seqRaw === 'number' ? seqRaw : Number(seqRaw);
    const key = optionalString(row.key);
    const replacesStart =
      row.replaces_start == null ? undefined : Number(row.replaces_start);
    const replacesEnd = row.replaces_end == null ? undefined : Number(row.replaces_end);
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      seq,
      key,
      surfaceOp: parseSurfaceOp(row.surface_op),
      replacesStart: Number.isFinite(replacesStart as number) ? replacesStart : undefined,
      replacesEnd: Number.isFinite(replacesEnd as number) ? replacesEnd : undefined,
      role: String(row.role) as MessageRole,
      parts: parseJson<SessionMessage['parts']>(String(row.parts_json)) ?? [],
      createdAt: String(row.created_at)
    };
  }

  private surfaceToMessage(node: SurfaceNode): SessionMessage {
    return {
      id: node.id,
      sessionId: node.sessionId,
      role: node.role,
      parts: node.parts,
      createdAt: node.createdAt,
      seq: node.seq,
      ...(node.key ? { key: node.key } : {})
    };
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
