/**
 * Lexical shortlist for dynamic tools (legacy skill-router style). No new vector dep.
 */

import type { DynToolRecord } from './types.js';

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_\u4e00-\u9fff]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

export function scoreDynToolLexical(record: Pick<DynToolRecord, 'name' | 'description'>, query: string): number {
  const q = tokens(query);
  if (q.length === 0) return 0;
  const name = record.name.toLowerCase();
  const desc = (record.description ?? '').toLowerCase();
  let score = 0;
  for (const t of q) {
    if (name === t) score += 20;
    else if (name.includes(t)) score += 14;
    else if (desc.includes(t)) score += 6;
  }
  const phrase = q.join(' ');
  if (phrase.length >= 4 && (`${name} ${desc}`).includes(phrase)) score += 22;
  return score;
}

export function searchDynTools(
  query: string,
  records: DynToolRecord[],
  topK: number
): DynToolRecord[] {
  const k = Math.max(1, Math.min(20, Math.floor(topK)));
  const active = records.filter((r) => r.status === 'active');
  const q = query.trim();
  if (!q) {
    return [...active]
      .sort((a, b) => (b.stats.uses ?? 0) - (a.stats.uses ?? 0) || a.name.localeCompare(b.name))
      .slice(0, k);
  }
  return [...active]
    .map((r) => ({ r, score: scoreDynToolLexical(r, q) }))
    .sort((a, b) => b.score - a.score || a.r.name.localeCompare(b.r.name))
    .slice(0, k)
    .map((row) => row.r);
}

export function suggestUnusedRetired(
  records: DynToolRecord[],
  currentTurn: number,
  unusedSuggestTurns: number
): string[] {
  return records
    .filter((r) => r.status === 'active' && (r.stats.uses ?? 0) === 0)
    .filter((r) => {
      const last = r.stats.lastUsedTurn;
      if (last == null) {
        return true;
      }
      return currentTurn - last >= unusedSuggestTurns;
    })
    .map((r) => r.name);
}
