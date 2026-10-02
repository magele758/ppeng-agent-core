import type { Pool } from 'pg';
import { envInt } from '../env.js';
import {
  PG_MIGRATION_HINT,
  resolveStorage,
  type ConfigNote,
  type StorageFeature,
  type StorageResolution
} from '../config/effective-config.js';
import type { AssetStorage, EventBufferRepository } from './interfaces.js';
import { createPgPool } from './cloud/pg-backend.js';
import { RedisEventBufferRepository } from './cloud/redis-event-buffer-repository.js';
import { PgSkillRegistryClient } from './cloud/pg-skill-registry-client.js';
import type { ProviderConfig } from './provider-config.js';
import { TieredAssetStorage } from './tiered-asset-storage.js';
import type { SkillSpec } from '../types.js';

export type StorageFallbacks = Partial<Record<StorageFeature, ConfigNote>>;

export type CoreStorageContext = {
  /** 启动探测之后真正生效的档位（自动推断的云档连不上时已回退本地）。 */
  config: ProviderConfig;
  resolution: StorageResolution;
  /** 回退本地的存储项及原因；daemon 运行期（如 Redis 锁连不上）也往这里写，供「有效配置」展示。 */
  fallbacks: StorageFallbacks;
  /** 启动时产生的 warning（半配、PG 连不上、缺表…），已逐条回退本地，不阻止启动。 */
  warnings: ConfigNote[];
  eventBuffer?: EventBufferRepository;
  /** With `SKILL_REGISTRY_PROVIDER=pg_redis`, PG catalog loads first; workspace/~.agents skills override same name. */
  cloudSkillsLoader?: () => Promise<SkillSpec[]>;
  skillRegistryClient?: PgSkillRegistryClient;
  tieredAssets?: AssetStorage;
  /** 该存储项是否由 `RAW_AGENT_*_PROVIDER` 显式指定（显式的连不上要报错，自动的要回退）。 */
  isExplicit(feature: StorageFeature): boolean;
  shutdown: () => Promise<void>;
};

export type CoreStorageOptions = {
  stateDir?: string;
  pgConnectTimeoutMs?: number;
  log?: { warn(message: string): void };
};

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const PG_TABLES: Record<'eventBuffer' | 'skillRegistry', string[]> = {
  eventBuffer: ['ppeng_event_buffer_meta', 'ppeng_event_buffer_events'],
  skillRegistry: ['ppeng_skill_catalog']
};

/** 自动推断出的 PG 档：能连上且表齐才用，否则逐项回退本地（不 throw）。 */
async function probeAutoPostgres(
  pool: Pool,
  features: Array<'eventBuffer' | 'skillRegistry'>
): Promise<StorageFallbacks> {
  const out: StorageFallbacks = {};
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    const n: ConfigNote = {
      code: 'pg_unreachable',
      message: `DATABASE_URL is set but PostgreSQL is unreachable (${errText(e)}); using local mode.`,
      params: { error: errText(e) }
    };
    for (const f of features) out[f] = n;
    return out;
  }
  for (const f of features) {
    try {
      const missing: string[] = [];
      for (const table of PG_TABLES[f]) {
        const r = await pool.query<{ ok: string | null }>('SELECT to_regclass($1) AS ok', [`public.${table}`]);
        if (!r.rows[0]?.ok) missing.push(table);
      }
      if (missing.length > 0) {
        out[f] = {
          code: 'pg_schema_missing',
          message: `PostgreSQL is reachable but tables are missing (${missing.join(', ')}); using local mode. Apply ${PG_MIGRATION_HINT} to enable.`,
          params: { tables: missing.join(', '), migration: PG_MIGRATION_HINT }
        };
      }
    } catch (e) {
      out[f] = {
        code: 'pg_unreachable',
        message: `PostgreSQL probe failed (${errText(e)}); using local mode.`,
        params: { error: errText(e) }
      };
    }
  }
  return out;
}

/**
 * Async wiring for cloud providers. Local defaults return immediately without opening PG/Redis.
 *
 * 自动推断出的档位（只配了连接信息）连不上 / 缺表 → 回退本地并记入 `fallbacks` / `warnings`；
 * 显式 `RAW_AGENT_*_PROVIDER` 指定的档位缺依赖 → 仍然 throw（用户明确要求了）。
 */
export async function createCoreStorageContext(
  env: NodeJS.ProcessEnv,
  options: CoreStorageOptions = {}
): Promise<CoreStorageContext> {
  const log = options.log;
  const initial = resolveStorage(env, { stateDir: options.stateDir });
  if (initial.missingForced.length > 0) {
    throw new Error(
      `[storage] explicitly requested providers are missing required settings: ${initial.missingForced.join(', ')}`
    );
  }

  const isExplicit = (feature: StorageFeature): boolean =>
    initial.items.find((it) => it.id === `storage.${feature}`)?.source === 'explicit-env';

  const closers: Array<() => Promise<void>> = [];
  const fallbacks: StorageFallbacks = {};
  const warnings: ConfigNote[] = [];

  for (const it of initial.items) {
    for (const w of it.warnings) {
      warnings.push(w);
      log?.warn(`[config] ${it.id}: ${w.message}`);
    }
  }

  let pool: Pool | undefined;
  const wantsPg = (f: 'eventBuffer' | 'skillRegistry'): boolean =>
    f === 'eventBuffer' ? initial.config.eventBuffer === 'redis_postgres' : initial.config.skillRegistry === 'pg_redis';
  const pgFeatures = (['eventBuffer', 'skillRegistry'] as const).filter(wantsPg);

  if (pgFeatures.length > 0) {
    const url = String(env.DATABASE_URL ?? '').trim();
    const holder = await createPgPool({
      connectionString: url,
      connectionTimeoutMillis: options.pgConnectTimeoutMs ?? 5_000
    });
    pool = holder.pool;
    closers.push(holder.end);

    const autoOnes = pgFeatures.filter((f) => !isExplicit(f));
    if (autoOnes.length > 0) {
      const failed = await probeAutoPostgres(pool, autoOnes);
      for (const f of autoOnes) {
        const n = failed[f];
        if (n) {
          fallbacks[f] = n;
          warnings.push(n);
          log?.warn(`[config] storage.${f}: ${n.message}`);
        }
      }
    }
  }

  const useEventBuffer = wantsPg('eventBuffer') && !fallbacks.eventBuffer;
  const useSkillRegistry = wantsPg('skillRegistry') && !fallbacks.skillRegistry;
  if (pool && !useEventBuffer && !useSkillRegistry) {
    await closers.pop()?.();
    pool = undefined;
  }

  let eventBuffer: EventBufferRepository | undefined;
  if (useEventBuffer && pool) {
    const ttl = envInt(env, 'RAW_AGENT_EVENT_BUFFER_META_TTL_SEC', 86_400);
    eventBuffer = new RedisEventBufferRepository(pool, env.REDIS_URL, ttl);
  }

  let skillRegistryClient: PgSkillRegistryClient | undefined;
  if (useSkillRegistry && pool) {
    const ttl = envInt(env, 'RAW_AGENT_SKILL_REGISTRY_CACHE_TTL_SEC', 300);
    skillRegistryClient = new PgSkillRegistryClient(pool, env.REDIS_URL, ttl);
  }

  let tieredAssets: AssetStorage | undefined;
  if (initial.config.assetStorage === 'tiered') {
    const tieredEnv = { ...env, RAW_AGENT_TIERED_CACHE_DIR: initial.tieredCacheDir };
    tieredAssets = new TieredAssetStorage(tieredEnv, String(env.REDIS_URL ?? '').trim());
  }

  let cloudSkillsLoader: (() => Promise<SkillSpec[]>) | undefined;
  if (skillRegistryClient) {
    const client = skillRegistryClient;
    const strict = isExplicit('skillRegistry');
    let warned = false;
    cloudSkillsLoader = async () => {
      try {
        return await client.listSkillsAsSpecs();
      } catch (e) {
        if (strict) throw e;
        if (!warned) {
          warned = true;
          log?.warn(`[config] storage.skillRegistry: PG skill catalog unavailable (${errText(e)}); using local skills.`);
        }
        return [];
      }
    };
  }

  const effective = (): ProviderConfig => resolveStorage(env, { stateDir: options.stateDir, fallbacks }).config;

  return {
    get config() {
      return effective();
    },
    resolution: initial,
    fallbacks,
    warnings,
    eventBuffer,
    cloudSkillsLoader,
    skillRegistryClient,
    tieredAssets,
    isExplicit,
    async shutdown() {
      for (const c of closers) {
        await c();
      }
    }
  };
}
