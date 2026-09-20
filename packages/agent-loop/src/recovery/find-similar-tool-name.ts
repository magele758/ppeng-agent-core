/**
 * Find the closest tool name to a bad/unknown name (normalize + levenshtein).
 * Ported from ai-agent-node `find-similar-tool-name.ts` for protocol self-heal hints.
 */

function normalize(s: string): string {
  return s.toLowerCase().replace(/[-_\s]/g, '');
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[a.length]![b.length]!;
}

/**
 * - Prefer exact match after normalize
 * - Else smallest edit distance, capped at max(3, floor(len * 0.4))
 * - Otherwise null
 */
export function findSimilarToolName(badName: string, toolNames: string[]): string | null {
  if (!toolNames.length) return null;
  const normBad = normalize(badName);

  const exact = toolNames.find((n) => normalize(n) === normBad);
  if (exact) return exact;

  let best: string | null = null;
  let bestDist = Infinity;
  for (const name of toolNames) {
    const d = levenshtein(normBad, normalize(name));
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return bestDist <= Math.max(3, Math.floor(normBad.length * 0.4)) ? best : null;
}
