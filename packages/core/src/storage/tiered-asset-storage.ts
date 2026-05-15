import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createClient } from 'redis';
import { envInt } from '../env.js';
import type { AssetStorage, TieredAssetDescriptor } from './interfaces.js';

function redisLruKey(tenantId: string): string {
  return `ppeng:lru:assets:${tenantId}`;
}

function hotFsPath(cacheRoot: string, key: string): string {
  const safe = key.replace(/^\/+/, '').replace(/\.\./g, '_');
  return join(cacheRoot, safe);
}

/**
 * L2: local path (emptyDir per pod when `RAW_AGENT_TIERED_CACHE_DIR=/cache`).
 * L3: S3-compatible (MinIO) global SoT.
 * Redis ZSET: global last-access ordering for optional eviction / observability (per-tenant key).
 */
export class TieredAssetStorage implements AssetStorage {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly cacheRoot: string;
  private redis: ReturnType<typeof createClient> | undefined;
  private redisConnect: Promise<void> | undefined;

  constructor(
    env: NodeJS.ProcessEnv,
    private readonly redisUrl: string
  ) {
    const endpoint = String(env.RAW_AGENT_S3_ENDPOINT ?? '').trim();
    const region = String(env.RAW_AGENT_S3_REGION ?? 'us-east-1').trim() || 'us-east-1';
    this.bucket = String(env.RAW_AGENT_S3_BUCKET ?? '').trim();
    this.prefix = String(env.RAW_AGENT_S3_PREFIX ?? 'assets/').replace(/\/?$/, '/');
    this.cacheRoot = String(env.RAW_AGENT_TIERED_CACHE_DIR ?? '').trim();

    this.s3 = new S3Client({
      region,
      endpoint: endpoint || undefined,
      credentials: {
        accessKeyId: String(env.RAW_AGENT_S3_ACCESS_KEY ?? ''),
        secretAccessKey: String(env.RAW_AGENT_S3_SECRET_KEY ?? ''),
      },
      forcePathStyle: true,
    });

    if (redisUrl.trim()) {
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

  private objectKey(desc: TieredAssetDescriptor): string {
    return `${this.prefix}${desc.key.replace(/^\/+/, '')}`;
  }

  async read(desc: TieredAssetDescriptor): Promise<Buffer | null> {
    const abs = hotFsPath(this.cacheRoot, desc.key);
    try {
      const buf = await readFile(abs);
      if (desc.sha256) {
        const h = createHash('sha256').update(buf).digest('hex');
        if (h !== desc.sha256) {
          /* stale local; fall through to cold */
        } else {
          await this.touchAccess(desc);
          return buf;
        }
      } else {
        await this.touchAccess(desc);
        return buf;
      }
    } catch {
      /* cold pull */
    }

    try {
      const out = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.objectKey(desc),
        })
      );
      const body = out.Body;
      if (!body) return null;
      const buf = Buffer.from(await body.transformToByteArray());
      if (desc.sha256) {
        const h = createHash('sha256').update(buf).digest('hex');
        if (h !== desc.sha256) {
          throw new Error('tiered_asset: sha256 mismatch from object store');
        }
      }
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, buf);
      await this.touchAccess(desc);
      return buf;
    } catch {
      return null;
    }
  }

  async write(desc: TieredAssetDescriptor, body: Buffer): Promise<void> {
    const abs = hotFsPath(this.cacheRoot, desc.key);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body);
    await this.touchAccess(desc, body.length);

    const key = this.objectKey(desc);
    void this.s3
      .send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
        })
      )
      .catch(() => {
        /* background best-effort */
      });
  }

  async touchAccess(desc: TieredAssetDescriptor, sizeBytes?: number): Promise<void> {
    if (!this.redis) return;
    try {
      await this.ensureRedis();
      const score = Date.now();
      const member = desc.key;
      await this.redis.zAdd(redisLruKey(desc.tenantId), { score, value: member });
      if (sizeBytes != null && sizeBytes > 0) {
        await this.redis.hSet(`ppeng:lru:asset:size:${desc.tenantId}`, member, String(sizeBytes));
      }
      const max = envInt(process.env, 'RAW_AGENT_TIERED_LRU_MAX_KEYS', 10_000);
      const n = await this.redis.zCard(redisLruKey(desc.tenantId));
      if (n > max) {
        const trim = n - max;
        const old = await this.redis.zRange(redisLruKey(desc.tenantId), 0, trim - 1);
        if (old.length) {
          await this.redis.zRem(redisLruKey(desc.tenantId), old);
        }
      }
    } catch {
      /* redis optional for correctness */
    }
  }
}
