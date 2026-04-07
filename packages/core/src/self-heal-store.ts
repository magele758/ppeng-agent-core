/**
 * Self-heal store: CRUD for self-heal runs and events.
 *
 * Extracted from SqliteStateStore to isolate the self-heal persistence domain.
 * Takes a DatabaseSync instance via constructor injection.
 */
import type { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from './id.js';
import { serializeJson, parseJson, optionalString, boolToInt, intToBool } from './storage-helpers.js';
import { normalizeSelfHealPolicy } from './self-heal/self-heal-policy.js';
import type { SelfHealEventRecord, SelfHealRunRecord, SelfHealStatus } from './types.js';

export class SelfHealStore {
  constructor(private readonly db: DatabaseSync) {}

  createSelfHealRun(input: { policy: SelfHealRunRecord['policy'] }): SelfHealRunRecord {
    const now = nowIso();
    const run: SelfHealRunRecord = {
      id: createId('sheal'),
      status: 'pending',
      policy: input.policy,
      fixIteration: 0,
      stopped: false,
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `
        INSERT INTO self_heal_runs (
          id, status, policy_json, task_id, session_id, workspace_id, worktree_branch,
          fix_iteration, last_error_summary, last_test_output, merge_commit_sha, block_reason,
          stopped, restart_requested_at, restart_ack_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        run.id,
        run.status,
        serializeJson(run.policy),
        null,
        null,
        null,
        null,
        run.fixIteration,
        null,
        null,
        null,
        null,
        boolToInt(run.stopped),
        null,
        null,
        run.createdAt,
        run.updatedAt
      );
    return run;
  }

  getSelfHealRun(id: string): SelfHealRunRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM self_heal_runs WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapSelfHealRunRow(row) : undefined;
  }

  listSelfHealRuns(options?: { limit?: number }): SelfHealRunRecord[] {
    const cap = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    const rows = this.db
      .prepare(`SELECT * FROM self_heal_runs ORDER BY updated_at DESC LIMIT ?`)
      .all(cap) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapSelfHealRunRow(row));
  }

  /** Active = not in terminal state and not user-stopped. */
  listActiveSelfHealRuns(): SelfHealRunRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM self_heal_runs WHERE stopped = 0
         AND status NOT IN ('completed','failed','blocked','stopped')`
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapSelfHealRunRow(row));
  }

  updateSelfHealRun(
    id: string,
    patch: Partial<
      Omit<SelfHealRunRecord, 'id' | 'createdAt' | 'policy'> & { policy?: SelfHealRunRecord['policy'] }
    >
  ): SelfHealRunRecord {
    const existing = this.getSelfHealRun(id);
    if (!existing) {
      throw new Error(`Self-heal run ${id} not found`);
    }
    const next: SelfHealRunRecord = {
      ...existing,
      ...patch,
      policy: patch.policy ?? existing.policy,
      updatedAt: nowIso()
    };
    this.db
      .prepare(
        `
        UPDATE self_heal_runs SET
          status = ?, policy_json = ?, task_id = ?, session_id = ?, workspace_id = ?, worktree_branch = ?,
          fix_iteration = ?, last_error_summary = ?, last_test_output = ?, merge_commit_sha = ?, block_reason = ?,
          stopped = ?, restart_requested_at = ?, restart_ack_at = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        next.status,
        serializeJson(next.policy),
        next.taskId ?? null,
        next.sessionId ?? null,
        next.workspaceId ?? null,
        next.worktreeBranch ?? null,
        next.fixIteration,
        next.lastErrorSummary ?? null,
        next.lastTestOutput ?? null,
        next.mergeCommitSha ?? null,
        next.blockReason ?? null,
        boolToInt(next.stopped),
        next.restartRequestedAt ?? null,
        next.restartAckAt ?? null,
        next.updatedAt,
        id
      );
    return next;
  }

  appendSelfHealEvent(input: { runId: string; kind: string; payload?: Record<string, unknown> }): SelfHealEventRecord {
    const ev: SelfHealEventRecord = {
      id: createId('sheal_ev'),
      runId: input.runId,
      kind: input.kind,
      payload: input.payload ?? {},
      createdAt: nowIso()
    };
    this.db
      .prepare(
        `INSERT INTO self_heal_events (id, run_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(ev.id, ev.runId, ev.kind, serializeJson(ev.payload), ev.createdAt);
    return ev;
  }

  listSelfHealEvents(runId: string, limit = 200): SelfHealEventRecord[] {
    const cap = Math.min(Math.max(limit, 1), 1000);
    const rows = this.db
      .prepare(`SELECT * FROM self_heal_events WHERE run_id = ? ORDER BY created_at ASC LIMIT ?`)
      .all(runId, cap) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapSelfHealEventRow(row));
  }

  private mapSelfHealRunRow(row: Record<string, unknown>): SelfHealRunRecord {
    return {
      id: String(row.id),
      status: String(row.status) as SelfHealStatus,
      policy: normalizeSelfHealPolicy(parseJson<Partial<SelfHealRunRecord['policy']>>(String(row.policy_json))),
      taskId: optionalString(row.task_id),
      sessionId: optionalString(row.session_id),
      workspaceId: optionalString(row.workspace_id),
      worktreeBranch: optionalString(row.worktree_branch),
      fixIteration: Number(row.fix_iteration) || 0,
      lastErrorSummary: optionalString(row.last_error_summary),
      lastTestOutput: optionalString(row.last_test_output),
      mergeCommitSha: optionalString(row.merge_commit_sha),
      blockReason: optionalString(row.block_reason),
      stopped: intToBool(row.stopped),
      restartRequestedAt: optionalString(row.restart_requested_at),
      restartAckAt: optionalString(row.restart_ack_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapSelfHealEventRow(row: Record<string, unknown>): SelfHealEventRecord {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      kind: String(row.kind),
      payload: parseJson<Record<string, unknown>>(String(row.payload_json)) ?? {},
      createdAt: String(row.created_at)
    };
  }
}
