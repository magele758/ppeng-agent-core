/**
 * Resolve domain bundles from `RAW_AGENT_DOMAINS` (CSV).
 *
 * Static map for now — keeping it explicit makes the bundle list visible from
 * one place and avoids any dynamic-import surprises in production. Add a new
 * domain here once and the daemon picks it up via the env var.
 *
 * Unknown ids are logged once and skipped (rather than crashing the daemon)
 * so a typo in an ops-set env var doesn't take down the whole runtime.
 */

import {
  mergeDomainBundles,
  type DomainBundle,
  type MergedDomainBundles,
} from '@ppeng/agent-core';
import { sreBundle } from '@ppeng/agent-sre';
import { stockBundle } from '@ppeng/agent-stock';

const REGISTRY: Record<string, DomainBundle> = {
  sre: sreBundle,
  stock: stockBundle,
};

export interface LoadedDomains {
  ids: string[];
  unknown: string[];
  merged: MergedDomainBundles;
}

export function loadDomainBundles(env: NodeJS.ProcessEnv): LoadedDomains {
  const wanted = (env.RAW_AGENT_DOMAINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const bundles: DomainBundle[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();

  for (const id of wanted) {
    if (seen.has(id)) continue;
    seen.add(id);
    const bundle = REGISTRY[id];
    if (!bundle) {
      unknown.push(id);
      continue;
    }
    bundles.push(bundle);
  }

  return {
    ids: bundles.map((b) => b.id),
    unknown,
    merged: mergeDomainBundles(bundles),
  };
}

/** Available bundle ids — useful for UI hints / `--help` output. */
export function availableDomainIds(): string[] {
  return Object.keys(REGISTRY);
}
