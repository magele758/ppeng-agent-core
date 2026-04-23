import type { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from '../id.js';
import { parseJson, serializeJson } from './storage-helpers.js';

export type AgentCaseOutcome = 'success' | 'failure' | 'partial';
export type AgentCaseSource = 'reviewer' | 'manual' | 'import';

export interface AgentCaseRecord {
  id: string;
  /** Future tenant isolation; null = global for this DB */
  namespace: string | null;
  sessionId: string;
  agentId: string;
  taskFingerprint: string;
  outcome: AgentCaseOutcome;
  signalsJson: string | null;
  whatWorked: string | null;
  whatFailed: string | null;
  pivotHint: string | null;
  applicableWhen: string | null;
  notApplicableWhen: string | null;
  confidence: number;
  source: AgentCaseSource;
  embedding: number[] | null;
  recallCount: number;
  createdAt: string;
  extra: Record<string, unknown>;
}

export interface InsertAgentCaseInput {
  namespace?: string | null;
  sessionId: string;
  agentId: string;
  taskFingerprint: string;
  outcome: AgentCaseOutcome;
  signals?: Record<string, unknown>;
  whatWorked?: string;
  whatFailed?: string;
  pivotHint?: string;
  applicableWhen?: string;
  notApplicableWhen?: string;
  source: AgentCaseSource;
  embedding?: number[] | null;
  confidence?: number;
  extra?: Record<string, unknown>;
}

function ftsEscapeToken(t: string): string {
  return t.replace(/"/g, '""').replace(/[^\p{L}\p{N}_-]/gu, ' ').trim();
}

function buildFtsBody(row: {
  taskFingerprint: string;
  whatWorked?: string | null;
  whatFailed?: string | null;
  pivotHint?: string | null;
  applicableWhen?: string | null;
  notApplicableWhen?: string | null;
}): string {
  return [
    row.taskFingerprint,
    row.whatWorked ?? '',
    row.whatFailed ?? '',
    row.pivotHint ?? '',
    row.applicableWhen ?? '',
    row.notApplicableWhen ?? ''
  ]
    .join('\n')
    .slice(0, 50_000);
}

/**
 * Persisted agent experience cases (evolving / recall). FTS5 on `body` for keyword recall;
 * optional `embedding_json` for vector rerank (P2).
 */
export class AgentCaseStore {
  constructor(private readonly db: DatabaseSync) {}

  insert(input: InsertAgentCaseInput): AgentCaseRecord {
    const id = createId('case');
    const now = nowIso();
    const conf =
      typeof input.confidence === 'number' && input.confidence >= 0 && input.confidence <= 1
        ? input.confidence
        : 0.5;
    const signalsJson = input.signals ? serializeJson(input.signals) : null;
    const embJson = input.embedding?.length ? serializeJson(input.embedding) : null;
    const extra = input.extra ?? {};
    const ns = input.namespace === undefined ? null : input.namespace;

    const body = buildFtsBody({
      taskFingerprint: input.taskFingerprint,
      whatWorked: input.whatWorked,
      whatFailed: input.whatFailed,
      pivotHint: input.pivotHint,
      applicableWhen: input.applicableWhen,
      notApplicableWhen: input.notApplicableWhen
    });
    const bodyFts = body.trim() || input.taskFingerprint || '.';

    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO agent_cases (
          id, namespace, session_id, agent_id, task_fingerprint, outcome, signals_json,
          what_worked, what_failed, pivot_hint, applicable_when, not_applicable_when,
          confidence, source, embedding_json, recall_count, created_at, extra_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(
          id,
          ns,
          input.sessionId,
          input.agentId,
          input.taskFingerprint,
          input.outcome,
          signalsJson,
          input.whatWorked ?? null,
          input.whatFailed ?? null,
          input.pivotHint ?? null,
          input.applicableWhen ?? null,
          input.notApplicableWhen ?? null,
          conf,
          input.source,
          embJson,
          now,
          serializeJson(extra)
        );

      this.db.prepare(`INSERT INTO agent_cases_fts(body, case_id) VALUES (?, ?)`).run(bodyFts, id);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }

    return this.getById(id) as AgentCaseRecord;
  }

  getById(id: string): AgentCaseRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM agent_cases WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapRow(row) : undefined;
  }

  /**
   * Keyword recall: FTS OR of tokens; scoped by agent_id and namespace (null = only rows where namespace IS NULL).
   */
  searchKeyword(args: {
    agentId: string;
    namespace?: string | null;
    keywords: string[];
    limit: number;
  }): AgentCaseRecord[] {
    const tokens = args.keywords.map(ftsEscapeToken).filter((t) => t.length >= 2);
    if (tokens.length === 0) return [];

    const matchExpr = tokens.map((t) => `"${t}"`).join(' OR ');
    let sql = `
      SELECT c.* FROM agent_cases c
      WHERE c.id IN (
        SELECT case_id FROM agent_cases_fts WHERE agent_cases_fts MATCH ?
      )
      AND c.agent_id = ?
    `;
    const params: Array<string | number> = [matchExpr, args.agentId];

    if (args.namespace === undefined || args.namespace === null) {
      sql += ` AND c.namespace IS NULL`;
    } else {
      sql += ` AND c.namespace = ?`;
      params.push(args.namespace);
    }
    sql += ` ORDER BY c.confidence DESC, c.created_at DESC LIMIT ?`;
    params.push(args.limit);

    try {
      const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      return rows.map((r) => this.mapRow(r));
    } catch {
      return [];
    }
  }

  /** Candidates with embeddings for cosine rerank (cap scan for local DB). */
  listWithEmbeddings(args: { agentId: string; namespace?: string | null; maxScan: number }): AgentCaseRecord[] {
    let sql = `SELECT * FROM agent_cases WHERE agent_id = ? AND embedding_json IS NOT NULL`;
    const params: Array<string | number> = [args.agentId];
    if (args.namespace === undefined || args.namespace === null) {
      sql += ` AND namespace IS NULL`;
    } else {
      sql += ` AND namespace = ?`;
      params.push(args.namespace);
    }
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(args.maxScan);
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRow(r));
  }

  bumpConfidence(id: string, delta: number): void {
    const row = this.db.prepare(`SELECT confidence FROM agent_cases WHERE id = ?`).get(id) as
      | { confidence: number }
      | undefined;
    if (!row) return;
    const next = Math.min(1, Math.max(0, Number(row.confidence) + delta));
    this.db.prepare(`UPDATE agent_cases SET confidence = ? WHERE id = ?`).run(next, id);
  }

  incrementRecall(id: string): void {
    this.db.prepare(`UPDATE agent_cases SET recall_count = recall_count + 1 WHERE id = ?`).run(id);
  }

  private mapRow(row: Record<string, unknown>): AgentCaseRecord {
    const embRaw = row.embedding_json ? String(row.embedding_json) : null;
    let embedding: number[] | null = null;
    if (embRaw) {
      try {
        const p = JSON.parse(embRaw) as unknown;
        if (Array.isArray(p) && p.every((x) => typeof x === 'number')) embedding = p;
      } catch {
        /* ignore */
      }
    }
    return {
      id: String(row.id),
      namespace: row.namespace === null || row.namespace === undefined ? null : String(row.namespace),
      sessionId: String(row.session_id),
      agentId: String(row.agent_id),
      taskFingerprint: String(row.task_fingerprint),
      outcome: String(row.outcome) as AgentCaseOutcome,
      signalsJson: row.signals_json ? String(row.signals_json) : null,
      whatWorked: row.what_worked ? String(row.what_worked) : null,
      whatFailed: row.what_failed ? String(row.what_failed) : null,
      pivotHint: row.pivot_hint ? String(row.pivot_hint) : null,
      applicableWhen: row.applicable_when ? String(row.applicable_when) : null,
      notApplicableWhen: row.not_applicable_when ? String(row.not_applicable_when) : null,
      confidence: Number(row.confidence),
      source: String(row.source) as AgentCaseSource,
      embedding,
      recallCount: Number(row.recall_count ?? 0),
      createdAt: String(row.created_at),
      extra: parseJson<Record<string, unknown>>(String(row.extra_json ?? '{}')) ?? {}
    };
  }
}
