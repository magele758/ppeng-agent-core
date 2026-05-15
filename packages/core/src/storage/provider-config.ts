export type DeploymentMode = 'local' | 'hybrid' | 'cloud';
export type SessionStoreProvider = 'sqlite' | 'postgres';
export type EventBufferProvider = 'local' | 'redis_postgres';
export type SkillRegistryProvider = 'local_fs' | 'pg_redis';
export type AssetStorageProvider = 'local' | 'tiered';
export type DispatchLockProvider = 'local' | 'redis';

export type ProviderConfig = {
  deploymentMode: DeploymentMode;
  sessionStore: SessionStoreProvider;
  eventBuffer: EventBufferProvider;
  skillRegistry: SkillRegistryProvider;
  assetStorage: AssetStorageProvider;
  dispatchLock: DispatchLockProvider;
};

function parseEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  const v = String(raw ?? '').trim().toLowerCase();
  if ((allowed as readonly string[]).includes(v)) {
    return v as T;
  }
  return fallback;
}

/**
 * Env-driven provider matrix. All defaults preserve today’s single-node SQLite + local disk behaviour.
 *
 * Keys:
 * - RAW_AGENT_DEPLOYMENT_MODE — local | hybrid | cloud (default local)
 * - RAW_AGENT_SESSION_STORE_PROVIDER — sqlite | postgres (default sqlite; postgres session path is phased — still SQLite in runtime until migrated)
 * - RAW_AGENT_EVENT_BUFFER_PROVIDER — local | redis_postgres
 * - RAW_AGENT_SKILL_REGISTRY_PROVIDER — local_fs | pg_redis
 * - RAW_AGENT_ASSET_STORAGE_PROVIDER — local | tiered
 * - RAW_AGENT_DISPATCH_LOCK_PROVIDER — local | redis
 */
export function createProviderConfigFromEnv(env: NodeJS.ProcessEnv): ProviderConfig {
  return {
    deploymentMode: parseEnum(env.RAW_AGENT_DEPLOYMENT_MODE, ['local', 'hybrid', 'cloud'] as const, 'local'),
    sessionStore: parseEnum(env.RAW_AGENT_SESSION_STORE_PROVIDER, ['sqlite', 'postgres'] as const, 'sqlite'),
    eventBuffer: parseEnum(env.RAW_AGENT_EVENT_BUFFER_PROVIDER, ['local', 'redis_postgres'] as const, 'local'),
    skillRegistry: parseEnum(env.RAW_AGENT_SKILL_REGISTRY_PROVIDER, ['local_fs', 'pg_redis'] as const, 'local_fs'),
    assetStorage: parseEnum(env.RAW_AGENT_ASSET_STORAGE_PROVIDER, ['local', 'tiered'] as const, 'local'),
    dispatchLock: parseEnum(env.RAW_AGENT_DISPATCH_LOCK_PROVIDER, ['local', 'redis'] as const, 'local'),
  };
}

/** Default tenant/user for trace → event-buffer fan-out when no multi-tenant headers exist yet. */
export function defaultTenantIdFromEnv(env: NodeJS.ProcessEnv): string {
  return String(env.RAW_AGENT_DEFAULT_TENANT_ID ?? 'default').trim() || 'default';
}

export function defaultUserIdFromEnv(env: NodeJS.ProcessEnv): string {
  return String(env.RAW_AGENT_DEFAULT_USER_ID ?? 'default').trim() || 'default';
}

/**
 * Returns human-readable missing env var names for enabled cloud/hybrid features.
 * Call on daemon startup; local dev should always return [] with defaults.
 */
export function validateProviderConfig(cfg: ProviderConfig, env: NodeJS.ProcessEnv): string[] {
  const missing: string[] = [];
  const need = (cond: boolean, key: string) => {
    if (cond && !String(env[key] ?? '').trim()) {
      missing.push(key);
    }
  };

  if (cfg.eventBuffer === 'redis_postgres') {
    need(true, 'DATABASE_URL');
    // Redis meta cache is optional; REDIS_URL absence only disables SET meta, PG remains valid.
  }

  if (cfg.skillRegistry === 'pg_redis') {
    need(true, 'DATABASE_URL');
  }

  if (cfg.assetStorage === 'tiered') {
    need(true, 'RAW_AGENT_S3_ENDPOINT');
    need(true, 'RAW_AGENT_S3_BUCKET');
    need(true, 'RAW_AGENT_S3_ACCESS_KEY');
    need(true, 'RAW_AGENT_S3_SECRET_KEY');
    need(true, 'REDIS_URL');
    need(true, 'RAW_AGENT_TIERED_CACHE_DIR');
  }

  if (cfg.dispatchLock === 'redis') {
    need(true, 'REDIS_URL');
  }

  if (cfg.sessionStore === 'postgres') {
    need(true, 'DATABASE_URL');
    // Full SqliteStateStore → PG migration is phased; DATABASE_URL is still required to validate intent.
  }

  if (cfg.deploymentMode === 'cloud') {
    need(true, 'DATABASE_URL');
  }

  return missing.filter((m, i, a) => a.indexOf(m) === i);
}
