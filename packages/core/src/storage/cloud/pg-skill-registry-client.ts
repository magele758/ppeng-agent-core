import type { Pool } from 'pg';
import { createClient } from 'redis';
import type { SkillCatalogRow, SkillRegistryClient } from '../interfaces.js';
import type { SkillSpec } from '../../types.js';

const CACHE_KEY = 'ppeng:skills:catalog:v1';

function rowFromDb(r: {
  id: string;
  version: string;
  sha256: string;
  size_bytes: string | number;
  download_url: string | null;
  meta: unknown;
}): SkillCatalogRow {
  return {
    id: r.id,
    version: r.version ?? '',
    sha256: r.sha256 ?? '',
    sizeBytes: typeof r.size_bytes === 'string' ? Number(r.size_bytes) : Number(r.size_bytes),
    downloadUrl: r.download_url,
    meta:
      r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta)
        ? (r.meta as Record<string, unknown>)
        : {},
  };
}

/**
 * PostgreSQL skill catalog + optional Redis cache (short TTL).
 * When Redis is absent, reads PG every time.
 *
 * `SkillSpec.content` prefers `meta.body` (markdown) for routing; download_url fetch is not implemented in this skeleton.
 */
export class PgSkillRegistryClient implements SkillRegistryClient {
  private redis: ReturnType<typeof createClient> | undefined;
  private redisConnect: Promise<void> | undefined;

  constructor(
    private readonly pool: Pool,
    redisUrl: string | undefined,
    private readonly cacheTtlSeconds: number
  ) {
    if (redisUrl?.trim()) {
      this.redis = createClient({ url: redisUrl.trim() });
    }
  }

  private async ensureRedis(): Promise<void> {
    if (!this.redis) return;
    if (!this.redisConnect) {
      this.redisConnect = this.redis.connect().then(
        () => undefined,
        (err: unknown) => {
          this.redisConnect = undefined;
          throw err;
        }
      );
    }
    await this.redisConnect;
  }

  async listCatalogRows(): Promise<SkillCatalogRow[]> {
    if (this.redis) {
      try {
        await this.ensureRedis();
        const cached = await this.redis.get(CACHE_KEY);
        if (cached) {
          return JSON.parse(cached) as SkillCatalogRow[];
        }
      } catch {
        /* fall through */
      }
    }

    const res = await this.pool.query(
      `SELECT id, version, sha256, size_bytes, download_url, meta
       FROM ppeng_skill_catalog ORDER BY id`
    );
    const rows = res.rows.map(rowFromDb);

    if (this.redis) {
      try {
        await this.ensureRedis();
        await this.redis.set(CACHE_KEY, JSON.stringify(rows), { EX: this.cacheTtlSeconds });
      } catch {
        /* ignore */
      }
    }

    return rows;
  }

  /** Map catalog rows to in-memory SkillSpec (cloud source). */
  async listSkillsAsSpecs(): Promise<SkillSpec[]> {
    const rows = await this.listCatalogRows();
    const out: SkillSpec[] = [];
    for (const r of rows) {
      const name = String(r.meta.name ?? r.id);
      const description = String(r.meta.description ?? `${r.id} catalog skill`);
      const body = String(r.meta.body ?? '');
      const id = String(r.meta.id ?? r.id);
      const aliasesRaw = r.meta.aliases;
      const triggersRaw = r.meta.triggerWords ?? r.meta.trigger_words;
      const aliases = Array.isArray(aliasesRaw)
        ? aliasesRaw.map((x) => String(x))
        : undefined;
      const triggerWords = Array.isArray(triggersRaw)
        ? triggersRaw.map((x) => String(x))
        : undefined;
      out.push({
        id,
        name,
        description,
        content: body,
        promptFragment: body.slice(0, 4000),
        source: 'workspace',
        aliases,
        triggerWords,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}
