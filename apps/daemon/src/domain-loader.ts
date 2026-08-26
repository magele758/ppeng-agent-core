/**
 * Resolve domain bundles from `RAW_AGENT_DOMAINS` (CSV).
 *
 * Known domain ids come from repo-root `domains.manifest.json` (single source of
 * truth with build / Docker / desktop assembly). Bundle modules are still
 * static-imported so production stays free of dynamic-import surprises.
 *
 * Unknown ids are logged once and skipped (rather than crashing the daemon)
 * so a typo in an ops-set env var doesn't take down the whole runtime.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeDomainBundles,
  type DomainBundle,
  type MergedDomainBundles,
} from '@ppeng/agent-core';
import { sreBundle } from '@ppeng/agent-sre';
import { stockBundle } from '@ppeng/agent-stock';
import { homeiotBundle } from '@ppeng/agent-homeiot';
import { erpBundle } from '@ppeng/agent-erp';

type DomainManifestEntry = {
  id: string;
  npmName: string;
  path: string;
  bundleExport: string;
};

type DomainsManifest = {
  domains: DomainManifestEntry[];
};

function loadManifest(): DomainsManifest {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/ and dist/ are both apps/daemon/{src|dist} → three levels up is repo root
  const manifestPath = join(here, '../../../domains.manifest.json');
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as DomainsManifest;
}

const MANIFEST = loadManifest();

/** Domain ids from domains.manifest.json (manifest order). */
export const KNOWN_DOMAINS: readonly string[] = MANIFEST.domains.map((d) => d.id);

const REGISTRY: Record<string, DomainBundle> = {
  sre: sreBundle,
  stock: stockBundle,
  homeiot: homeiotBundle,
  erp: erpBundle,
};

function assertRegistryMatchesManifest(): void {
  const registryIds = new Set(Object.keys(REGISTRY));
  const missing = KNOWN_DOMAINS.filter((id) => !registryIds.has(id));
  const extra = [...registryIds].filter((id) => !KNOWN_DOMAINS.includes(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `domain-loader REGISTRY drifted from domains.manifest.json: missing=[${missing.join(',')}] extra=[${extra.join(',')}]`
    );
  }
}

assertRegistryMatchesManifest();

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
  return [...KNOWN_DOMAINS];
}
