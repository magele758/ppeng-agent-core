/**
 * Single loader for domains.manifest.json (repo root).
 * Used by build, Docker helper paths, and desktop server assembly.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = join(repoRoot, 'domains.manifest.json');

/**
 * @typedef {{ id: string, npmName: string, path: string, bundleExport: string }} DomainManifestEntry
 * @typedef {{ domains: DomainManifestEntry[] }} DomainsManifest
 */

/** @returns {DomainsManifest} */
export function loadDomainsManifest() {
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

/** @returns {string[]} workspace-relative package dirs, e.g. packages/agent-sre */
export function domainPackagePaths() {
  return loadDomainsManifest().domains.map((d) => d.path);
}

/** @returns {string[]} domain ids in manifest order */
export function knownDomainIds() {
  return loadDomainsManifest().domains.map((d) => d.id);
}

export { repoRoot, manifestPath };
