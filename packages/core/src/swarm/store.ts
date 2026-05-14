import type { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from '../id.js';
import { serializeJson, parseJson, optionalString, intToBool, boolToInt } from '../stores/storage-helpers.js';
import type {
  SwarmRun,
  SwarmTask,
  SwarmReview,
  SwarmStatus,
  SwarmStrategy,
  SwarmRole,
  SwarmTaskStatus,
  SwarmBudget
} from './types.js';

export class SwarmStore {
  constructor(private readonly db: DatabaseSync) {}

  // ── SwarmRun ──────────────────────────────────────────────────────────────

  createRun(run: SwarmRun): void {
    this.db
      .prepare(`
        INSERT INTO swarm_runs
          (id, goal, orchestration_run_id, status, strategy, budget, quality_gate, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        run.id,
        run.goal,
        run.orchestrationRunId ?? null,
        run.status,
        run.strategy,
        serializeJson(run.budget),
        serializeJson(run.qualityGate),
        run.createdAt,
        run.updatedAt
      );
  }

  getRun(id: string): SwarmRun | null {
    const row = this.db
      .prepare(`SELECT * FROM swarm_runs WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRunRow(row) : null;
  }

  updateRunStatus(id: string, status: SwarmStatus): void {
    this.db
      .prepare(`UPDATE swarm_runs SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, nowIso(), id);
  }

  listRuns(opts?: { status?: SwarmStatus; limit?: number }): SwarmRun[] {
    const limit = opts?.limit ?? 100;
    const rows = (
      opts?.status
        ? this.db
            .prepare(`SELECT * FROM swarm_runs WHERE status = ? ORDER BY created_at DESC LIMIT ?`)
            .all(opts.status, limit)
        : this.db
            .prepare(`SELECT * FROM swarm_runs ORDER BY created_at DESC LIMIT ?`)
            .all(limit)
    ) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRunRow(r));
  }

  // ── SwarmTask ─────────────────────────────────────────────────────────────

  createTask(task: SwarmTask): void {
    this.db
      .prepare(`
        INSERT INTO swarm_tasks
          (id, swarm_run_id, title, description, status, required_role, owner_agent_id,
           capability_tags, acceptance_criteria, artifacts, blocked_by, budget, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        task.id,
        task.swarmRunId,
        task.title,
        task.description ?? null,
        task.status,
        task.requiredRole,
        task.ownerAgentId ?? null,
        serializeJson(task.capabilityTags),
        serializeJson(task.acceptanceCriteria),
        serializeJson(task.artifacts),
        serializeJson(task.blockedBy),
        task.budget != null ? serializeJson(task.budget) : null,
        task.createdAt,
        task.updatedAt
      );
  }

  getTask(id: string): SwarmTask | null {
    const row = this.db
      .prepare(`SELECT * FROM swarm_tasks WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapTaskRow(row) : null;
  }

  updateTask(id: string, updates: Partial<SwarmTask>): void {
    const task = this.getTask(id);
    if (!task) return;
    const next: SwarmTask = { ...task, ...updates, updatedAt: nowIso() };
    this.db
      .prepare(`
        UPDATE swarm_tasks
        SET title = ?, description = ?, status = ?, required_role = ?, owner_agent_id = ?,
            capability_tags = ?, acceptance_criteria = ?, artifacts = ?, blocked_by = ?,
            budget = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        next.title,
        next.description ?? null,
        next.status,
        next.requiredRole,
        next.ownerAgentId ?? null,
        serializeJson(next.capabilityTags),
        serializeJson(next.acceptanceCriteria),
        serializeJson(next.artifacts),
        serializeJson(next.blockedBy),
        next.budget != null ? serializeJson(next.budget) : null,
        next.updatedAt,
        id
      );
  }

  listTasks(
    swarmRunId: string,
    opts?: { status?: SwarmTaskStatus; role?: SwarmRole }
  ): SwarmTask[] {
    let rows: Array<Record<string, unknown>>;
    if (opts?.status && opts?.role) {
      rows = this.db
        .prepare(
          `SELECT * FROM swarm_tasks WHERE swarm_run_id = ? AND status = ? AND required_role = ? ORDER BY created_at ASC`
        )
        .all(swarmRunId, opts.status, opts.role) as Array<Record<string, unknown>>;
    } else if (opts?.status) {
      rows = this.db
        .prepare(
          `SELECT * FROM swarm_tasks WHERE swarm_run_id = ? AND status = ? ORDER BY created_at ASC`
        )
        .all(swarmRunId, opts.status) as Array<Record<string, unknown>>;
    } else if (opts?.role) {
      rows = this.db
        .prepare(
          `SELECT * FROM swarm_tasks WHERE swarm_run_id = ? AND required_role = ? ORDER BY created_at ASC`
        )
        .all(swarmRunId, opts.role) as Array<Record<string, unknown>>;
    } else {
      rows = this.db
        .prepare(`SELECT * FROM swarm_tasks WHERE swarm_run_id = ? ORDER BY created_at ASC`)
        .all(swarmRunId) as Array<Record<string, unknown>>;
    }
    return rows.map((r) => this.mapTaskRow(r));
  }

  claimTask(taskId: string, agentId: string): boolean {
    const result = this.db
      .prepare(`
        UPDATE swarm_tasks
        SET status = 'claimed', owner_agent_id = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `)
      .run(agentId, nowIso(), taskId) as { changes: number };
    return result.changes > 0;
  }

  // ── SwarmReview ───────────────────────────────────────────────────────────

  addReview(review: SwarmReview): void {
    this.db
      .prepare(`
        INSERT INTO swarm_reviews
          (id, swarm_run_id, task_id, reviewer_agent_id, role, scores, passed, feedback, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        review.id,
        review.swarmRunId,
        review.taskId,
        review.reviewerAgentId,
        review.role,
        serializeJson(review.scores),
        boolToInt(review.passed),
        review.feedback,
        review.createdAt
      );
  }

  listReviews(swarmRunId: string): SwarmReview[] {
    const rows = this.db
      .prepare(`SELECT * FROM swarm_reviews WHERE swarm_run_id = ? ORDER BY created_at ASC`)
      .all(swarmRunId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapReviewRow(r));
  }

  getReviewsForTask(taskId: string): SwarmReview[] {
    const rows = this.db
      .prepare(`SELECT * FROM swarm_reviews WHERE task_id = ? ORDER BY created_at ASC`)
      .all(taskId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapReviewRow(r));
  }

  // ── Timeout check ─────────────────────────────────────────────────────────

  getTimedOutRuns(nowMs: number): SwarmRun[] {
    const activeStatuses = ['pending', 'planning', 'running', 'reviewing'];
    const placeholders = activeStatuses.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT * FROM swarm_runs WHERE status IN (${placeholders}) ORDER BY created_at ASC`
      )
      .all(...activeStatuses) as Array<Record<string, unknown>>;

    return rows
      .map((r) => this.mapRunRow(r))
      .filter((run) => {
        const createdMs = new Date(run.createdAt).getTime();
        return createdMs + run.budget.maxDurationMs < nowMs;
      });
  }

  // ── Mapping helpers ───────────────────────────────────────────────────────

  private mapRunRow(row: Record<string, unknown>): SwarmRun {
    const defaultBudget: SwarmBudget = {
      maxTeammates: 3,
      maxTurnsPerAgent: 20,
      maxDurationMs: 600_000
    };
    return {
      id: String(row.id),
      goal: String(row.goal),
      orchestrationRunId: optionalString(row.orchestration_run_id),
      status: String(row.status) as SwarmStatus,
      strategy: String(row.strategy ?? 'pipeline') as SwarmStrategy,
      budget: row.budget != null
        ? parseJson<SwarmBudget>(String(row.budget))
        : defaultBudget,
      qualityGate: parseJson<string[]>(String(row.quality_gate ?? '[]')),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapTaskRow(row: Record<string, unknown>): SwarmTask {
    return {
      id: String(row.id),
      swarmRunId: String(row.swarm_run_id),
      title: String(row.title),
      description: optionalString(row.description),
      status: String(row.status) as SwarmTaskStatus,
      requiredRole: String(row.required_role ?? 'implementer') as SwarmRole,
      ownerAgentId: optionalString(row.owner_agent_id),
      capabilityTags: parseJson<string[]>(String(row.capability_tags ?? '[]')),
      acceptanceCriteria: parseJson<string[]>(String(row.acceptance_criteria ?? '[]')),
      artifacts: parseJson<string[]>(String(row.artifacts ?? '[]')),
      blockedBy: parseJson<string[]>(String(row.blocked_by ?? '[]')),
      budget: row.budget != null
        ? parseJson<{ maxTurns?: number }>(String(row.budget))
        : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapReviewRow(row: Record<string, unknown>): SwarmReview {
    return {
      id: String(row.id),
      swarmRunId: String(row.swarm_run_id),
      taskId: String(row.task_id),
      reviewerAgentId: String(row.reviewer_agent_id),
      role: String(row.role ?? 'reviewer') as SwarmRole,
      scores: parseJson<SwarmReview['scores']>(String(row.scores ?? '{}')),
      passed: intToBool(row.passed),
      feedback: String(row.feedback ?? ''),
      createdAt: String(row.created_at)
    };
  }
}

export function createSwarmId(prefix: 'srun' | 'stask' | 'srev'): string {
  return createId(prefix);
}

export { nowIso } from '../id.js';
