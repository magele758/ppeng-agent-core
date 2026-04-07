/**
 * Approval store: CRUD for tool-call approval records.
 *
 * Extracted from SqliteStateStore to isolate the approval domain.
 * Takes a DatabaseSync instance via constructor injection.
 */
import type { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from './id.js';
import { serializeJson, parseJson, optionalString } from './storage-helpers.js';
import type { ApprovalRecord, ApprovalStatus } from './types.js';

export class ApprovalStore {
  constructor(private readonly db: DatabaseSync) {}

  createApproval(
    input: Omit<ApprovalRecord, 'id' | 'status' | 'createdAt' | 'updatedAt'> & { idempotencyKey?: string }
  ): ApprovalRecord {
    if (input.idempotencyKey) {
      const dup = this.db
        .prepare(
          `SELECT * FROM approvals WHERE session_id = ? AND idempotency_key = ? AND status = 'pending' LIMIT 1`
        )
        .get(input.sessionId, input.idempotencyKey) as Record<string, unknown> | undefined;
      if (dup) {
        return this.mapApprovalRow(dup);
      }
    }

    const approval: ApprovalRecord = {
      id: createId('approval'),
      sessionId: input.sessionId,
      toolName: input.toolName,
      status: 'pending',
      reason: input.reason,
      args: input.args,
      idempotencyKey: input.idempotencyKey,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    this.db
      .prepare(`
        INSERT INTO approvals (id, session_id, tool_name, status, reason, args_json, idempotency_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        approval.id,
        approval.sessionId,
        approval.toolName,
        approval.status,
        approval.reason,
        serializeJson(approval.args),
        approval.idempotencyKey ?? null,
        approval.createdAt,
        approval.updatedAt
      );

    return approval;
  }

  listApprovals(filter?: { status?: ApprovalStatus }): ApprovalRecord[] {
    const rows = (filter?.status
      ? this.db.prepare(`SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC`).all(filter.status)
      : this.db.prepare(`SELECT * FROM approvals ORDER BY created_at DESC`).all()) as Array<Record<string, unknown>>;

    return rows.map((row) => this.mapApprovalRow(row));
  }

  getApproval(id: string): ApprovalRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM approvals WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapApprovalRow(row) : undefined;
  }

  updateApproval(id: string, status: ApprovalStatus): ApprovalRecord {
    const approval = this.getApproval(id);
    if (!approval) {
      throw new Error(`Approval ${id} not found`);
    }

    const next: ApprovalRecord = {
      ...approval,
      status,
      updatedAt: nowIso()
    };

    this.db.prepare(`UPDATE approvals SET status = ?, updated_at = ? WHERE id = ?`).run(next.status, next.updatedAt, next.id);
    return next;
  }

  deleteApproval(id: string): void {
    this.db.prepare(`DELETE FROM approvals WHERE id = ?`).run(id);
  }

  private mapApprovalRow(row: Record<string, unknown>): ApprovalRecord {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      toolName: String(row.tool_name),
      status: String(row.status) as ApprovalStatus,
      reason: String(row.reason),
      args: parseJson<Record<string, unknown>>(String(row.args_json)),
      idempotencyKey: optionalString((row as { idempotency_key?: unknown }).idempotency_key),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }
}
