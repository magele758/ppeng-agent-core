import type { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from '../id.js';
import { parseJson, serializeJson } from '../stores/storage-helpers.js';
import { edgesFromTasks } from './dag.js';
import type {
  TeamDagEdge,
  TeamDagTask,
  TeamGateState,
  TeamPlan,
  TeamPlanReview,
  TeamPlanStatus,
  TeamPlannerSource,
  TeamWorkspaceSyncMode
} from './types.js';

export function createTeamPlanId(): string {
  return createId('tplan');
}

interface TeamPlanPersistV2 {
  v: 2;
  tasks: TeamDagTask[];
  edges: TeamDagEdge[];
  gates: TeamGateState[];
  workspaceSyncMode: TeamWorkspaceSyncMode;
  planDir?: string;
  releasable?: boolean;
  plannerSource?: TeamPlannerSource;
}

function isPersistV2(raw: unknown): raw is TeamPlanPersistV2 {
  return Boolean(raw && typeof raw === 'object' && (raw as { v?: unknown }).v === 2);
}

export class TeamPlanStore {
  constructor(private readonly db: DatabaseSync) {}

  upsert(plan: TeamPlan): void {
    const next = { ...plan, updatedAt: nowIso() };
    const doc: TeamPlanPersistV2 = {
      v: 2,
      tasks: next.tasks,
      edges: next.edges,
      gates: next.gates,
      workspaceSyncMode: next.workspaceSyncMode,
      planDir: next.planDir,
      releasable: next.releasable,
      plannerSource: next.plannerSource
    };
    this.db
      .prepare(
        `
        INSERT INTO team_plans (id, session_id, objective, status, tasks_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          session_id = excluded.session_id,
          objective = excluded.objective,
          status = excluded.status,
          tasks_json = excluded.tasks_json,
          updated_at = excluded.updated_at
      `
      )
      .run(
        next.id,
        next.sessionId ?? null,
        next.objective,
        next.status,
        serializeJson(doc),
        next.createdAt,
        next.updatedAt
      );
  }

  get(id: string): TeamPlan | null {
    const row = this.db
      .prepare(`SELECT * FROM team_plans WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapPlan(row) : null;
  }

  list(opts?: { status?: TeamPlanStatus; sessionId?: string; limit?: number }): TeamPlan[] {
    const limit = opts?.limit ?? 50;
    let rows: Array<Record<string, unknown>>;
    if (opts?.sessionId && opts.status) {
      rows = this.db
        .prepare(
          `SELECT * FROM team_plans WHERE session_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?`
        )
        .all(opts.sessionId, opts.status, limit) as Array<Record<string, unknown>>;
    } else if (opts?.sessionId) {
      rows = this.db
        .prepare(`SELECT * FROM team_plans WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`)
        .all(opts.sessionId, limit) as Array<Record<string, unknown>>;
    } else if (opts?.status) {
      rows = this.db
        .prepare(`SELECT * FROM team_plans WHERE status = ? ORDER BY created_at DESC LIMIT ?`)
        .all(opts.status, limit) as Array<Record<string, unknown>>;
    } else {
      rows = this.db
        .prepare(`SELECT * FROM team_plans ORDER BY created_at DESC LIMIT ?`)
        .all(limit) as Array<Record<string, unknown>>;
    }
    return rows.map((r) => this.mapPlan(r));
  }

  listActive(): TeamPlan[] {
    return this.list({ status: 'running', limit: 50 });
  }

  updateStatus(id: string, status: TeamPlanStatus): void {
    const plan = this.get(id);
    if (!plan) return;
    this.upsert({ ...plan, status });
  }

  addReview(review: TeamPlanReview): void {
    this.db
      .prepare(
        `
        INSERT INTO team_plan_reviews
          (id, plan_id, task_id, passed, feedback, reviewer_agent_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        review.id,
        review.planId,
        review.taskId,
        review.passed ? 1 : 0,
        review.feedback,
        review.reviewerAgentId,
        review.createdAt
      );
  }

  listReviews(planId: string): TeamPlanReview[] {
    const rows = this.db
      .prepare(`SELECT * FROM team_plan_reviews WHERE plan_id = ? ORDER BY created_at ASC`)
      .all(planId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      planId: String(r.plan_id),
      taskId: String(r.task_id),
      passed: Number(r.passed) === 1,
      feedback: String(r.feedback ?? ''),
      reviewerAgentId: String(r.reviewer_agent_id ?? ''),
      createdAt: String(r.created_at)
    }));
  }

  private mapPlan(row: Record<string, unknown>): TeamPlan {
    const parsed = parseJson<unknown>(String(row.tasks_json ?? '[]'));
    const tasks: TeamDagTask[] = isPersistV2(parsed)
      ? parsed.tasks ?? []
      : Array.isArray(parsed)
        ? (parsed as TeamDagTask[])
        : [];
    const edges = isPersistV2(parsed) ? parsed.edges ?? edgesFromTasks(tasks) : edgesFromTasks(tasks);
    return {
      id: String(row.id),
      sessionId: typeof row.session_id === 'string' && row.session_id ? row.session_id : undefined,
      objective: String(row.objective ?? ''),
      status: String(row.status) as TeamPlanStatus,
      tasks,
      edges,
      gates: isPersistV2(parsed) ? parsed.gates ?? [] : [],
      workspaceSyncMode: isPersistV2(parsed) ? parsed.workspaceSyncMode ?? 'directory-copy' : 'directory-copy',
      planDir: isPersistV2(parsed) ? parsed.planDir : undefined,
      releasable: isPersistV2(parsed) ? parsed.releasable : undefined,
      plannerSource: isPersistV2(parsed) ? parsed.plannerSource : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }
}
