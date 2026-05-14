import type { DatabaseSync } from 'node:sqlite';
import { NotFoundError } from '../errors.js';
import { createId, nowIso } from '../id.js';
import { serializeJson, parseJson, optionalString } from '../stores/storage-helpers.js';
import type {
  ResearchTask,
  ResearchSource,
  ResearchEvidence,
  ResearchClaim,
  ResearchStatus,
  SourceKind,
  TrustLevel,
  ClaimConfidence
} from './types.js';

export interface CreateResearchTaskInput {
  query: string;
  scope?: string;
  capabilityTags?: string[];
}

export interface UpdateResearchTaskInput {
  status?: ResearchStatus;
  reportPath?: string;
}

export interface ListResearchTasksOptions {
  status?: ResearchStatus;
  limit?: number;
  offset?: number;
}

export class ResearchStore {
  constructor(private readonly db: DatabaseSync) {}

  // ── Tasks ─────────────────────────────────────────────────────────────────

  createTask(input: CreateResearchTaskInput): ResearchTask {
    const task: ResearchTask = {
      id: createId('rtask'),
      query: input.query,
      scope: input.scope,
      status: 'pending',
      capabilityTags: input.capabilityTags ?? [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    this.db
      .prepare(`
        INSERT INTO research_tasks
          (id, query, scope, status, capability_tags, report_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        task.id,
        task.query,
        task.scope ?? null,
        task.status,
        serializeJson(task.capabilityTags),
        task.reportPath ?? null,
        task.createdAt,
        task.updatedAt
      );

    return task;
  }

  getTask(id: string): ResearchTask | undefined {
    const row = this.db
      .prepare(`SELECT * FROM research_tasks WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapTaskRow(row) : undefined;
  }

  updateTaskStatus(id: string, status: ResearchStatus, updates?: UpdateResearchTaskInput): ResearchTask {
    const task = this.getTask(id);
    if (!task) throw new NotFoundError('ResearchTask', id);
    const updatedAt = nowIso();
    const reportPath = updates?.reportPath ?? task.reportPath;
    this.db
      .prepare(`
        UPDATE research_tasks SET status = ?, report_path = ?, updated_at = ? WHERE id = ?
      `)
      .run(status, reportPath ?? null, updatedAt, id);
    return { ...task, status, reportPath, updatedAt };
  }

  listTasks(opts?: ListResearchTasksOptions): ResearchTask[] {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;
    const rows = (
      opts?.status
        ? this.db
            .prepare(
              `SELECT * FROM research_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
            )
            .all(opts.status, limit, offset)
        : this.db
            .prepare(`SELECT * FROM research_tasks ORDER BY created_at DESC LIMIT ? OFFSET ?`)
            .all(limit, offset)
    ) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapTaskRow(r));
  }

  // ── Sources ───────────────────────────────────────────────────────────────

  addSource(input: Omit<ResearchSource, 'id'>): ResearchSource {
    const source: ResearchSource = {
      id: createId('rsrc'),
      ...input
    };

    this.db
      .prepare(`
        INSERT INTO research_sources (id, task_id, kind, url, title, fetched_at, trust_level)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        source.taskId,
        source.kind,
        source.url ?? null,
        source.title,
        source.fetchedAt,
        source.trustLevel
      );

    return source;
  }

  listSources(taskId: string): ResearchSource[] {
    const rows = this.db
      .prepare(`SELECT * FROM research_sources WHERE task_id = ? ORDER BY fetched_at ASC`)
      .all(taskId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapSourceRow(r));
  }

  // ── Evidence ──────────────────────────────────────────────────────────────

  addEvidence(input: Omit<ResearchEvidence, 'id'>): ResearchEvidence {
    const evidence: ResearchEvidence = {
      id: createId('revid'),
      ...input
    };

    this.db
      .prepare(`
        INSERT INTO research_evidence (id, source_id, task_id, quote, location, relevance)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        evidence.id,
        evidence.sourceId,
        evidence.taskId,
        evidence.quote,
        evidence.location ?? null,
        evidence.relevance
      );

    return evidence;
  }

  listEvidence(taskId: string): ResearchEvidence[] {
    const rows = this.db
      .prepare(`SELECT * FROM research_evidence WHERE task_id = ? ORDER BY rowid ASC`)
      .all(taskId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapEvidenceRow(r));
  }

  // ── Claims ────────────────────────────────────────────────────────────────

  addClaim(input: Omit<ResearchClaim, 'id' | 'createdAt'>): ResearchClaim {
    const claim: ResearchClaim = {
      id: createId('rclm'),
      createdAt: nowIso(),
      ...input
    };

    this.db
      .prepare(`
        INSERT INTO research_claims (id, task_id, text, confidence, evidence_ids, caveats, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        claim.id,
        claim.taskId,
        claim.text,
        claim.confidence,
        serializeJson(claim.evidenceIds),
        claim.caveats != null ? serializeJson(claim.caveats) : null,
        claim.createdAt
      );

    return claim;
  }

  listClaims(taskId: string): ResearchClaim[] {
    const rows = this.db
      .prepare(`SELECT * FROM research_claims WHERE task_id = ? ORDER BY created_at ASC`)
      .all(taskId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapClaimRow(r));
  }

  // ── Mapping helpers ───────────────────────────────────────────────────────

  private mapTaskRow(row: Record<string, unknown>): ResearchTask {
    return {
      id: String(row.id),
      query: String(row.query),
      scope: optionalString(row.scope),
      status: String(row.status) as ResearchStatus,
      capabilityTags: parseJson<string[]>(String(row.capability_tags ?? '[]')),
      reportPath: optionalString(row.report_path),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapSourceRow(row: Record<string, unknown>): ResearchSource {
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      kind: String(row.kind) as SourceKind,
      url: optionalString(row.url),
      title: String(row.title),
      fetchedAt: String(row.fetched_at),
      trustLevel: String(row.trust_level) as TrustLevel
    };
  }

  private mapEvidenceRow(row: Record<string, unknown>): ResearchEvidence {
    return {
      id: String(row.id),
      sourceId: String(row.source_id),
      taskId: String(row.task_id),
      quote: String(row.quote),
      location: optionalString(row.location),
      relevance: Number(row.relevance ?? 0.5)
    };
  }

  private mapClaimRow(row: Record<string, unknown>): ResearchClaim {
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      text: String(row.text),
      confidence: String(row.confidence) as ClaimConfidence,
      evidenceIds: parseJson<string[]>(String(row.evidence_ids ?? '[]')),
      caveats: row.caveats != null ? parseJson<string[]>(String(row.caveats)) : undefined,
      createdAt: String(row.created_at)
    };
  }
}
