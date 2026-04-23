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

/**
 * FTS keyword recall, optionally rerank by embedding when `queryEmbedding` provided.
 */
export function recallAgentCases(
  store: AgentCaseStore,
  ctx: RecallContext,
  queryEmbedding: number[] | null
): AgentCaseRecord[] {
  const kw = [...new Set([...ctx.keywords, ...tokenizeHint(ctx.queryText)])];
  let rows = store.searchKeyword({
    agentId: ctx.agentId,
    namespace: ctx.namespace,
    keywords: kw,
    limit: Math.max(ctx.limit * 4, 16)
  });

  if (queryEmbedding && rows.length > 0) {
    const withEmb = rows.filter((r) => r.embedding && r.embedding.length === queryEmbedding.length);
    if (withEmb.length > 0) {
      withEmb.sort(
        (a, b) =>
          cosineSimilarity(queryEmbedding, b.embedding!) * (b.confidence + 0.01) -
          cosineSimilarity(queryEmbedding, a.embedding!) * (a.confidence + 0.01)
      );
      rows = withEmb;
    } else {
      const pool = store.listWithEmbeddings({
        agentId: ctx.agentId,
        namespace: ctx.namespace,
        maxScan: 200
      });
      pool.sort(
        (a, b) =>
          cosineSimilarity(queryEmbedding, b.embedding ?? []) * (b.confidence + 0.01) -
          cosineSimilarity(queryEmbedding, a.embedding ?? []) * (a.confidence + 0.01)
      );
      rows = [...pool.filter((r) => r.embedding), ...rows].slice(0, ctx.limit * 4);
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
