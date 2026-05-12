/**
 * Lexical helpers inspired by semantic-sampling calibration (Sem-ECE): bucket stochastic
 * answers into equivalence classes, then treat empirical class frequencies as a confidence proxy.
 * Full Sem-ECE needs learned semantic classes; here we use deterministic Unicode-normalized keys
 * as a cheap, dependency-free stand-in for offline QA / harness scripts.
 */

const MAX_EXAMPLE_LEN = 240;

/** NFKC + lowercase + whitespace collapse + strip most punctuation for stable bucketing. */
export function normalizeOpenAnswerKey(input: string): string {
  const base = input.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
  return base.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/gu, ' ').trim();
}

export interface OpenAnswerCluster {
  /** Normalized bucket key shared by the cluster */
  key: string;
  count: number;
  /** Up to two short example strings (verbatim from input, trimmed) */
  examples: string[];
}

/**
 * Group raw answer strings into clusters by {@link normalizeOpenAnswerKey}.
 * Clusters are sorted by descending count, then key.
 */
export function clusterOpenAnswerSamples(samples: string[]): OpenAnswerCluster[] {
  const map = new Map<string, { count: number; examples: string[] }>();
  for (const raw of samples) {
    const s = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
    if (!s) continue;
    const key = normalizeOpenAnswerKey(s) || '(empty)';
    let row = map.get(key);
    if (!row) {
      row = { count: 0, examples: [] };
      map.set(key, row);
    }
    row.count += 1;
    if (row.examples.length < 2) {
      const ex = s.length > MAX_EXAMPLE_LEN ? `${s.slice(0, MAX_EXAMPLE_LEN)}…` : s;
      if (!row.examples.includes(ex)) row.examples.push(ex);
    }
  }
  const out: OpenAnswerCluster[] = [];
  for (const [key, { count, examples }] of map) {
    out.push({ key, count, examples });
  }
  out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return out;
}

/** Sem$_1$-style self-consistency: largest cluster size / sample count. Empty input → 0. */
export function selfConsistencyConfidence(samples: string[]): number {
  const clusters = clusterOpenAnswerSamples(samples);
  const n = clusters.reduce((acc, c) => acc + c.count, 0);
  if (n === 0) return 0;
  const top = clusters[0]?.count ?? 0;
  return top / n;
}

/**
 * Shannon entropy of the cluster distribution, divided by log(#distinct) so result is in [0,1]
 * when there are at least 2 clusters; single cluster → 0. Measures spread across buckets.
 */
export function normalizedClusterEntropy(samples: string[]): number {
  const clusters = clusterOpenAnswerSamples(samples);
  const n = clusters.reduce((acc, c) => acc + c.count, 0);
  if (n === 0 || clusters.length <= 1) return 0;
  let h = 0;
  for (const c of clusters) {
    const p = c.count / n;
    h -= p * Math.log(p);
  }
  const denom = Math.log(clusters.length);
  if (denom <= 0) return 0;
  return Math.min(1, h / denom);
}

export interface OpenAnswerSampleSummary {
  sampleCount: number;
  nonEmptyCount: number;
  distinctClusters: number;
  /** Largest cluster mass in [0,1] — same-sample self-consistency proxy */
  sem1MajorityShare: number;
  /** 0 = one dominant bucket, 1 = spread evenly across buckets */
  normalizedEntropy: number;
  clusters: OpenAnswerCluster[];
}

/** Aggregate statistics for logging, dashboards, or lightweight calibration probes. */
export function summarizeOpenAnswerSamples(samples: string[]): OpenAnswerSampleSummary {
  const clusters = clusterOpenAnswerSamples(samples);
  const nonEmptyCount = clusters.reduce((acc, c) => acc + c.count, 0);
  return {
    sampleCount: samples.length,
    nonEmptyCount,
    distinctClusters: clusters.length,
    sem1MajorityShare: selfConsistencyConfidence(samples),
    normalizedEntropy: normalizedClusterEntropy(samples),
    clusters
  };
}
