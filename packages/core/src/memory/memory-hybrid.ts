/**
 * Lexical (FTS) + optional embedding hybrid rank. Default backend is SQLite
 * vectors in-process — no PostgreSQL / pgvector dependency.
 */

import { cosineSimilarity } from '../evolving/embedding.js';

export const MEMORY_RRF_K = 60;

export interface RankedId {
  id: string;
  score: number;
}

/** Reserved vector port. Default impl is SQLite JSON blobs. */
export interface MemoryVectorBackend {
  get(id: string): number[] | null;
  put(id: string, vector: number[], model?: string): void;
  list(ids?: string[]): Map<string, number[]>;
}

export function reciprocalRankFusion(lists: string[][], k = MEMORY_RRF_K): RankedId[] {
  const scores = new Map<string, number>();
  const firstIndex = new Map<string, number>();
  for (const list of lists) {
    for (let i = 0; i < list.length; i += 1) {
      const id = list[i]!;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
      if (!firstIndex.has(id)) firstIndex.set(id, i);
    }
  }
  return [...scores.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return (firstIndex.get(a[0]) ?? 0) - (firstIndex.get(b[0]) ?? 0);
    })
    .map(([id, score]) => ({ id, score }));
}

/**
 * Fuse lexical and semantic id lists. Empty semantic → lexical order (fail-open).
 */
export function hybridRankIds(input: { lexicalIds: string[]; semanticIds?: string[] }): string[] {
  const lexicalIds = uniqueIds(input.lexicalIds);
  const semanticIds = uniqueIds(input.semanticIds ?? []);
  if (semanticIds.length === 0) return lexicalIds;
  if (lexicalIds.length === 0) return semanticIds;
  return reciprocalRankFusion([lexicalIds, semanticIds]).map((row) => row.id);
}

export function rankByCosine(
  queryEmbedding: number[],
  items: Array<{ id: string; embedding: number[] }>
): string[] {
  return items
    .filter((item) => item.embedding.length === queryEmbedding.length)
    .sort(
      (a, b) =>
        cosineSimilarity(queryEmbedding, b.embedding) - cosineSimilarity(queryEmbedding, a.embedding)
    )
    .map((item) => item.id);
}

export function sqliteMemoryVectorBackend(store: {
  getEmbedding(id: string): number[] | null;
  putEmbedding(id: string, embedding: number[], model?: string): void;
  listEmbeddings(ids?: string[]): Map<string, number[]>;
}): MemoryVectorBackend {
  return {
    get: (id) => store.getEmbedding(id),
    put: (id, vector, model) => store.putEmbedding(id, vector, model),
    list: (ids) => store.listEmbeddings(ids)
  };
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
