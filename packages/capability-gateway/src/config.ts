import { readFile } from 'node:fs/promises';
import { env } from 'node:process';
import { gatewayConfigPath, loadGatewayChannelIdsSync } from '@ppeng/agent-core';
import type { GatewayEnvOptions, GatewayFileConfig } from './types.js';

// Re-export the canonical impl so callers can import from `@ppeng/agent-capability-gateway`
// without separately depending on `@ppeng/agent-core`.
export { loadGatewayChannelIdsSync };
export const resolveGatewayConfigPath = gatewayConfigPath;

const DEFAULT_PREFIX = '/gateway/v1';

export function parseGatewayEnv(repoRoot: string): GatewayEnvOptions {
  const enabled = ['1', 'true', 'yes', 'on'].includes(String(env.RAW_AGENT_GATEWAY_ENABLED ?? '').toLowerCase());
  const pathPrefix = normalizePrefix(String(env.RAW_AGENT_GATEWAY_PREFIX ?? DEFAULT_PREFIX));
  // Single source of truth for the candidate path (see core/src/gateway-config-channels.ts).
  const configPath = gatewayConfigPath(repoRoot);
  const learnEnabled = ['1', 'true', 'yes', 'on'].includes(
    String(env.RAW_AGENT_GATEWAY_LEARN_ENABLED ?? '').toLowerCase()
  );
  const hour = Number(env.RAW_AGENT_GATEWAY_LEARN_HOUR_UTC ?? '6');
  const learnDailyHourUtc =
    Number.isFinite(hour) && hour >= 0 && hour <= 23 ? Math.floor(hour) : 6;
  const authToken = env.RAW_AGENT_GATEWAY_TOKEN?.trim() || undefined;
  return {
    enabled,
    pathPrefix,
    configPath,
    learnEnabled,
    learnDailyHourUtc,
    authToken
  };
}

function normalizePrefix(p: string): string {
  const t = p.trim() || DEFAULT_PREFIX;
  return t.endsWith('/') ? t.slice(0, -1) : t;
}

export async function loadGatewayFileConfig(path: string): Promise<GatewayFileConfig | undefined> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as GatewayFileConfig;
  } catch {
    return undefined;
  }
}
