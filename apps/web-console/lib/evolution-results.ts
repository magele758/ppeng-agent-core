export type EvolutionResultType = 'success' | 'failure' | 'skip' | 'no-op';

export interface EvolutionResultLike {
  type: string;
  name: string;
  sourceTitle: string;
  experimentBranch: string;
  detectedTool: string | null;
}

export const EVOLUTION_TYPES: readonly EvolutionResultType[] = ['success', 'failure', 'skip', 'no-op'];

/** `type` = null means every status; `query` matches title / branch / tool, case-insensitively. */
export function filterEvolutionResults<T extends EvolutionResultLike>(
  results: T[],
  filter: { type: string | null; query: string }
): T[] {
  const q = filter.query.trim().toLowerCase();
  return results.filter((r) => {
    if (filter.type && r.type !== filter.type) return false;
    if (!q) return true;
    return (
      (r.sourceTitle || r.name).toLowerCase().includes(q) ||
      (r.experimentBranch || '').toLowerCase().includes(q) ||
      (r.detectedTool || '').toLowerCase().includes(q)
    );
  });
}
