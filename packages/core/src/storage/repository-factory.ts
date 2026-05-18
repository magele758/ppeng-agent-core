import type { Pool } from 'pg';
import { envInt } from '../env.js';
import type { AssetStorage, EventBufferRepository } from './interfaces.js';
import { createPgPool } from './cloud/pg-backend.js';
import { RedisEventBufferRepository } from './cloud/redis-event-buffer-repository.js';
import { PgSkillRegistryClient } from './cloud/pg-skill-registry-client.js';
import type { ProviderConfig } from './provider-config.js';
import { createProviderConfigFromEnv } from './provider-config.js';
import { TieredAssetStorage } from './tiered-asset-storage.js';
import type { SkillSpec } from '../types.js';

export type CoreStorageContext = {
  config: ProviderConfig;
  eventBuffer?: EventBufferRepository;
  /** With `SKILL_REGISTRY_PROVIDER=pg_redis`, PG catalog loads first; workspace/~.agents skills override same name. */
  cloudSkillsLoader?: () => Promise<SkillSpec[]>;
  skillRegistryClient?: PgSkillRegistryClient;
  tieredAssets?: AssetStorage;
  shutdown: () => Promise<void>;
};

/**
 * Async wiring for cloud providers. Local defaults return immediately without opening PG/Redis.
 */
export async function createCoreStorageContext(env: NodeJS.ProcessEnv): Promise<CoreStorageContext> {
  const config = createProviderConfigFromEnv(env);
  const closers: Array<() => Promise<void>> = [];
  let eventBuffer: EventBufferRepository | undefined;
  let skillRegistryClient: PgSkillRegistryClient | undefined;
  let tieredAssets: AssetStorage | undefined;

  const needPg = config.eventBuffer === 'redis_postgres' || config.skillRegistry === 'pg_redis';

  let pool: Pool | undefined;
  if (needPg) {
    const url = String(env.DATABASE_URL ?? '').trim();
    if (!url) {
      throw new Error('[storage] DATABASE_URL required for enabled PostgreSQL-backed providers');
    }
    const holder = await createPgPool(url);
    pool = holder.pool;
    closers.push(holder.end);
  }

  if (config.eventBuffer === 'redis_postgres') {
    if (!pool) throw new Error('[storage] event buffer requires pool');
    const ttl = envInt(env, 'RAW_AGENT_EVENT_BUFFER_META_TTL_SEC', 86_400);
    eventBuffer = new RedisEventBufferRepository(pool, env.REDIS_URL, ttl);
  }

  if (config.skillRegistry === 'pg_redis') {
    if (!pool) throw new Error('[storage] skill registry requires pool');
    const ttl = envInt(env, 'RAW_AGENT_SKILL_REGISTRY_CACHE_TTL_SEC', 300);
    skillRegistryClient = new PgSkillRegistryClient(pool, env.REDIS_URL, ttl);
  }

  if (config.assetStorage === 'tiered') {
    const redisUrl = String(env.REDIS_URL ?? '').trim();
    if (!redisUrl) throw new Error('[storage] tiered assets require REDIS_URL');
    tieredAssets = new TieredAssetStorage(env, redisUrl);
  }

  const cloudSkillsLoader = skillRegistryClient
    ? () => skillRegistryClient!.listSkillsAsSpecs()
    : undefined;

  return {
    config,
    eventBuffer,
    cloudSkillsLoader,
    skillRegistryClient,
    tieredAssets,
    async shutdown() {
      for (const c of closers) {
        await c();
      }
    },
  };
}
