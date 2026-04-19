import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/**
 * Single source of truth for gateway.config.json path resolution.
 *
 * Candidate order (first existing match wins for {@link findGatewayConfigPath};
 * for {@link gatewayConfigPath} the first **explicit** env wins regardless of file existence):
 *   1. `RAW_AGENT_GATEWAY_CONFIG`        (canonical; honoured by both core and capability-gateway)
 *   2. `EVOLUTION_GATEWAY_CONFIG`        (legacy alias used by evolution scripts)
 *   3. `<repoRoot>/gateway.config.json`  (gitignored local config)
 *   4. `<repoRoot>/gateway.config.example.json` (committed minimal example — only used by `find...`)
 */
function joinIfRelative(root: string, p: string): string {
  return isAbsolute(p) ? p : join(root, p);
}

/**
 * Returns the *intended* config path (the first env-pointed path, or the
 * default `gateway.config.json`). Does NOT check existence — callers that
 * want to fall back to the committed example should use {@link findGatewayConfigPath}.
 */
export function gatewayConfigPath(repoRoot: string): string {
  const explicit =
    process.env.RAW_AGENT_GATEWAY_CONFIG?.trim() ||
    process.env.EVOLUTION_GATEWAY_CONFIG?.trim();
  if (explicit) return joinIfRelative(repoRoot, explicit);
  return join(repoRoot, 'gateway.config.json');
}

/**
 * Returns the first candidate path that **exists** on disk, or `null` if none do.
 * Use this in scripts that want to gracefully fall back from the env-pointed file
 * to the committed example (e.g. `evolution:learn` on a fresh checkout).
 */
export function findGatewayConfigPath(repoRoot: string): string | null {
  const candidates: string[] = [];
  const explicit =
    process.env.RAW_AGENT_GATEWAY_CONFIG?.trim() ||
    process.env.EVOLUTION_GATEWAY_CONFIG?.trim();
  if (explicit) candidates.push(joinIfRelative(repoRoot, explicit));
  candidates.push(join(repoRoot, 'gateway.config.json'));
  candidates.push(join(repoRoot, 'gateway.config.example.json'));
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Sync read of `channels[].id` from gateway file config (same file as capability-gateway). */
export function loadGatewayChannelIdsSync(repoRoot: string): ReadonlySet<string> {
  const p = findGatewayConfigPath(repoRoot) ?? gatewayConfigPath(repoRoot);
  try {
    if (!existsSync(p)) return new Set();
    const raw = readFileSync(p, 'utf8');
    const cfg = JSON.parse(raw) as { channels?: Array<{ id?: unknown }> };
    const ids = new Set<string>();
    for (const c of cfg.channels ?? []) {
      if (typeof c?.id === 'string' && c.id.trim()) ids.add(c.id.trim());
    }
    return ids;
  } catch {
    return new Set();
  }
}
