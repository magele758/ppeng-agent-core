import type { AgentCaseRecord, AgentCaseStore } from '../stores/agent-case-store.js';
import { cosineSimilarity } from './embedding.js';

export interface RecallContext {
  agentId: string;
  /** Future tenant; omit/null = only global (namespace IS NULL) rows */
  namespace?: string | null;
  keywords: string[];
  queryText: string;
  limit: number;
}

function tokenizeHint(text: string): string[] {
  return text
    .split(/[\s/,:;|]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .slice(0, 12);
}

export function keywordsFromAbortReason(reason: string): string[] {
  return tokenizeHint(reason);
}

/** RRF constant (common default); fuses lexical FTS order with semantic cosine order. */
const RRF_K = 60;

function rankCasesBySemanticScore(queryEmbedding: number[], pool: AgentCaseRecord[]): AgentCaseRecord[] {
  const viable = pool.filter(
    (r) => r.embedding && r.embedding.length === queryEmbedding.length
  );
  return [...viable].sort(
    (a, b) =>
      cosineSimilarity(queryEmbedding, b.embedding!) * (b.confidence + 0.01) -
      cosineSimilarity(queryEmbedding, a.embedding!) * (a.confidence + 0.01)
  );
}

/**
 * Merge two ranked lists by reciprocal rank fusion (same family as hybrid retrieval in tools like probe).
 */
function fuseLexicalAndSemanticRrf(
  ftsRows: AgentCaseRecord[],
  semRanked: AgentCaseRecord[]
): AgentCaseRecord[] {
  const recordById = new Map<string, AgentCaseRecord>();
  for (const r of ftsRows) recordById.set(r.id, r);
  for (const r of semRanked) {
    if (!recordById.has(r.id)) recordById.set(r.id, r);
  }
  const scores = new Map<string, number>();
  for (let i = 0; i < ftsRows.length; i += 1) {
    const id = ftsRows[i]!.id;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1));
  }
  for (let i = 0; i < semRanked.length; i += 1) {
    const id = semRanked[i]!.id;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1));
  }
  return [...scores.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      const ra = recordById.get(a[0])!;
      const rb = recordById.get(b[0])!;
      return rb.confidence - ra.confidence;
    })
    .map(([id]) => recordById.get(id)!);
}

/**
 * Hybrid recall: SQLite FTS5 keyword hits plus optional embedding similarity, fused with RRF when both signals exist.
 * Avoids dropping strong lexical-only rows or strong semantic rows that FTS missed (previously the "some FTS rows
 * have embeddings" branch kept only embedded FTS hits).
 */
export function recallAgentCases(
  store: AgentCaseStore,
  ctx: RecallContext,
  queryEmbedding: number[] | null
): AgentCaseRecord[] {
  const kw = [...new Set([...ctx.keywords, ...tokenizeHint(ctx.queryText)])];
  const ftsRows = store.searchKeyword({
    agentId: ctx.agentId,
    namespace: ctx.namespace,
    keywords: kw,
    limit: Math.max(ctx.limit * 4, 16)
  });

  let rows: AgentCaseRecord[];

  if (!queryEmbedding) {
    rows = ftsRows;
  } else {
    const pool = store.listWithEmbeddings({
      agentId: ctx.agentId,
      namespace: ctx.namespace,
      maxScan: 200
    });
    const semRanked = rankCasesBySemanticScore(queryEmbedding, pool);

    if (semRanked.length === 0) {
      rows = ftsRows;
    } else if (ftsRows.length === 0) {
      rows = semRanked;
    } else {
      rows = fuseLexicalAndSemanticRrf(ftsRows, semRanked);
    }
  }

  const seen = new Set<string>();
  const out: AgentCaseRecord[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
    if (out.length >= ctx.limit) break;
  }
  return out;
}

export function formatAdvisoryFromCases(cases: AgentCaseRecord[], trigger: string): string {
  if (cases.length === 0) {
    return `[evolving] (${trigger}) No matching past cases in library. Try varying tools or narrowing the goal.`;
  }
  const lines: string[] = [`[evolving] (${trigger}) Retrieved ${cases.length} similar case(s):`];
  for (let i = 0; i < cases.length; i += 1) {
    const c = cases[i]!;
    lines.push(
      `\n--- Case ${i + 1} (outcome=${c.outcome}, conf=${c.confidence.toFixed(2)}) ---`,
      c.pivotHint ? `Pivot: ${c.pivotHint}` : '',
      c.whatWorked ? `Worked: ${c.whatWorked}` : '',
      c.whatFailed ? `Failed: ${c.whatFailed}` : '',
      c.applicableWhen ? `When: ${c.applicableWhen}` : ''
    );
  }
  lines.push('\nUse the above only if it fits the current task; do not repeat known-bad patterns.');
  return lines.filter(Boolean).join('\n');
}
