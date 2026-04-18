import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function gatewayConfigPath(repoRoot: string): string {
  const rel = process.env.RAW_AGENT_GATEWAY_CONFIG?.trim();
  return rel ? join(repoRoot, rel) : join(repoRoot, 'gateway.config.json');
}

/** Sync read of `channels[].id` from gateway file config (same file as capability-gateway). */
export function loadGatewayChannelIdsSync(repoRoot: string): ReadonlySet<string> {
  const p = gatewayConfigPath(repoRoot);
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
