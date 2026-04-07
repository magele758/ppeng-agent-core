/**
 * Mail store: CRUD for inter-agent mailbox messages.
 *
 * Extracted from SqliteStateStore to isolate the mail domain.
 * Takes a DatabaseSync instance via constructor injection.
 */
import type { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from './id.js';
import { optionalString } from './storage-helpers.js';
import type { MailRecord, MailStatus } from './types.js';

export class MailStore {
  constructor(private readonly db: DatabaseSync) {}

  createMail(input: Omit<MailRecord, 'id' | 'status' | 'createdAt' | 'readAt'>): MailRecord {
    const mail: MailRecord = {
      id: createId('mail'),
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      type: input.type,
      content: input.content,
      correlationId: input.correlationId,
      sessionId: input.sessionId,
      taskId: input.taskId,
      status: 'pending',
      createdAt: nowIso()
    };

    this.db
      .prepare(`
        INSERT INTO mailbox (
          id, from_agent_id, to_agent_id, type, content, correlation_id, session_id, task_id, status, created_at, read_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        mail.id,
        mail.fromAgentId,
        mail.toAgentId,
        mail.type,
        mail.content,
        mail.correlationId ?? null,
        mail.sessionId ?? null,
        mail.taskId ?? null,
        mail.status,
        mail.createdAt,
        null
      );

    return mail;
  }

  listMailbox(agentId: string, onlyPending = false): MailRecord[] {
    const rows = (onlyPending
      ? this.db
          .prepare(`SELECT * FROM mailbox WHERE to_agent_id = ? AND status = 'pending' ORDER BY created_at ASC`)
          .all(agentId)
      : this.db.prepare(`SELECT * FROM mailbox WHERE to_agent_id = ? ORDER BY created_at ASC`).all(agentId)) as Array<
      Record<string, unknown>
    >;

    return rows.map((row) => this.mapMailRow(row));
  }

  /** Recent mailbox rows for team visualization (newest first). */
  listAllMailbox(options?: { limit?: number }): MailRecord[] {
    const cap = Math.min(Math.max(options?.limit ?? 200, 1), 2000);
    const rows = this.db
      .prepare(`SELECT * FROM mailbox ORDER BY created_at DESC LIMIT ?`)
      .all(cap) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapMailRow(row));
  }

  markMailRead(id: string): MailRecord {
    const row = this.db.prepare(`SELECT * FROM mailbox WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`Mail ${id} not found`);
    }

    const readAt = nowIso();
    this.db.prepare(`UPDATE mailbox SET status = 'read', read_at = ? WHERE id = ?`).run(readAt, id);
    return this.mapMailRow({
      ...row,
      status: 'read',
      read_at: readAt
    });
  }

  private mapMailRow(row: Record<string, unknown>): MailRecord {
    return {
      id: String(row.id),
      fromAgentId: String(row.from_agent_id),
      toAgentId: String(row.to_agent_id),
      type: String(row.type),
      content: String(row.content),
      correlationId: optionalString(row.correlation_id),
      sessionId: optionalString(row.session_id),
      taskId: optionalString(row.task_id),
      status: String(row.status) as MailStatus,
      createdAt: String(row.created_at),
      readAt: optionalString(row.read_at)
    };
  }
}
