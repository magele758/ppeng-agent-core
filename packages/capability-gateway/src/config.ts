import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from 'node:process';
import type { GatewayEnvOptions, GatewayFileConfig } from './types.js';

const DEFAULT_PREFIX = '/gateway/v1';

export function parseGatewayEnv(repoRoot: string): GatewayEnvOptions {
  const enabled = ['1', 'true', 'yes', 'on'].includes(String(env.RAW_AGENT_GATEWAY_ENABLED ?? '').toLowerCase());
  const pathPrefix = normalizePrefix(String(env.RAW_AGENT_GATEWAY_PREFIX ?? DEFAULT_PREFIX));
  const configPath = env.RAW_AGENT_GATEWAY_CONFIG
    ? join(repoRoot, env.RAW_AGENT_GATEWAY_CONFIG)
    : join(repoRoot, 'gateway.config.json');
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
