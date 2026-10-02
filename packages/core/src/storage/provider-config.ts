import { resolveStorage } from '../config/effective-config.js';

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

/**
 * 按连接信息推导存储档位（逻辑集中在 `config/effective-config.ts`）：
 * - `DATABASE_URL` → 事件缓冲 `redis_postgres`、技能注册表 `pg_redis`（`REDIS_URL` 可选）
 * - `REDIS_URL` → 调度锁 `redis`
 * - `RAW_AGENT_S3_{ENDPOINT,BUCKET,ACCESS_KEY,SECRET_KEY}` 配齐 → 资产 `tiered`
 * - 都没配 → 全本地（SQLite + 本地盘）；配了一半 → 回退本地并给 warning
 *
 * 旧的 `RAW_AGENT_*_PROVIDER` 仍是「高级覆盖」，显式值优先（含显式 local）：
 * `DEPLOYMENT_MODE` / `SESSION_STORE_PROVIDER`（运行时仍是 SQLite）/ `EVENT_BUFFER_PROVIDER` /
 * `SKILL_REGISTRY_PROVIDER` / `ASSET_STORAGE_PROVIDER` / `DISPATCH_LOCK_PROVIDER`。
 */
export function createProviderConfigFromEnv(env: NodeJS.ProcessEnv): ProviderConfig {
  return resolveStorage(env).config;
}

/** Default tenant/user for trace → event-buffer fan-out when no multi-tenant headers exist yet. */
export function defaultTenantIdFromEnv(env: NodeJS.ProcessEnv): string {
  return String(env.RAW_AGENT_DEFAULT_TENANT_ID ?? 'default').trim() || 'default';
}

export function defaultUserIdFromEnv(env: NodeJS.ProcessEnv): string {
  return String(env.RAW_AGENT_DEFAULT_USER_ID ?? 'default').trim() || 'default';
}

/**
 * 返回「显式强制了云档却缺依赖」的 env 名。没配 / 自动推断出的档位永远返回 []。
 * 仅在这种用户明确要求、却无法满足的情况下，启动时才应报错退出。
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
    // REDIS_URL（LRU 记分牌）与 RAW_AGENT_TIERED_CACHE_DIR（默认 <stateDir>/tiered-cache）均可选。
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
