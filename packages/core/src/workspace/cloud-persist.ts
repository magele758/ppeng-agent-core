import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import type { RunContext } from '../types.js';
import { workspaceBindingFromMetadata } from './binding.js';

export const CLOUD_FOLDERS_S3_PREFIX = 'cloud-folders/';

export function isS3Configured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    String(env.RAW_AGENT_S3_BUCKET ?? '').trim() &&
      String(env.RAW_AGENT_S3_ACCESS_KEY ?? '').trim() &&
      String(env.RAW_AGENT_S3_SECRET_KEY ?? '').trim()
  );
}

export function cloudFolderLocalPath(stateDir: string, folderId: string): string {
  return join(stateDir, 'cloud-folders', folderId);
}

export function cloudFolderS3Prefix(folderId: string): string {
  return `${CLOUD_FOLDERS_S3_PREFIX}${folderId}/`;
}

export interface CloudObjectStore {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  list(prefix: string): Promise<string[]>;
}

export class MemoryCloudObjectStore implements CloudObjectStore {
  readonly objects = new Map<string, Buffer>();

  async put(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(body));
  }

  async get(key: string): Promise<Buffer | null> {
    const found = this.objects.get(key);
    return found ? Buffer.from(found) : null;
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix));
  }
}

export class S3CloudObjectStore implements CloudObjectStore {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const endpoint = String(env.RAW_AGENT_S3_ENDPOINT ?? '').trim();
    const region = String(env.RAW_AGENT_S3_REGION ?? 'us-east-1').trim() || 'us-east-1';
    this.bucket = String(env.RAW_AGENT_S3_BUCKET ?? '').trim();
    this.s3 = new S3Client({
      region,
      endpoint: endpoint || undefined,
      credentials: {
        accessKeyId: String(env.RAW_AGENT_S3_ACCESS_KEY ?? ''),
        secretAccessKey: String(env.RAW_AGENT_S3_SECRET_KEY ?? '')
      },
      forcePathStyle: true
    });
  }

  async put(key: string, body: Buffer): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body
      })
    );
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const out = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key
        })
      );
      if (!out.Body) return null;
      return Buffer.from(await out.Body.transformToByteArray());
    } catch {
      return null;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const out = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token
        })
      );
      for (const obj of out.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
}

export class CloudFolderPersist {
  constructor(
    private readonly store: CloudObjectStore,
    private readonly configured: boolean
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): CloudFolderPersist {
    const configured = isS3Configured(env);
    return new CloudFolderPersist(configured ? new S3CloudObjectStore(env) : new MemoryCloudObjectStore(), configured);
  }

  isConfigured(): boolean {
    return this.configured;
  }

  objectKey(folderId: string, relPath: string): string {
    const safe = relPath.replace(/^\/+/, '').replaceAll('\\', '/');
    return `${cloudFolderS3Prefix(folderId)}${safe}`;
  }

  async writeMarker(folderId: string): Promise<void> {
    if (!this.configured) return;
    await this.store.put(this.objectKey(folderId, '.ppeng-cloud-folder'), Buffer.from(folderId, 'utf8'));
  }

  async persistFile(folderId: string, localRoot: string, relPath: string): Promise<void> {
    if (!this.configured) return;
    const abs = join(localRoot, relPath);
    const body = await readFile(abs);
    await this.store.put(this.objectKey(folderId, relPath.replaceAll('\\', '/')), body);
  }

  async persistAll(folderId: string, localRoot: string): Promise<number> {
    if (!this.configured) return 0;
    const files = await listFilesRecursive(localRoot);
    for (const abs of files) {
      const rel = relative(localRoot, abs).replaceAll('\\', '/');
      if (!rel || rel.startsWith('..')) continue;
      await this.persistFile(folderId, localRoot, rel);
    }
    return files.length;
  }

  async hydrate(folderId: string, localRoot: string): Promise<number> {
    if (!this.configured) return 0;
    await mkdir(localRoot, { recursive: true });
    const prefix = cloudFolderS3Prefix(folderId);
    const keys = await this.store.list(prefix);
    let n = 0;
    for (const key of keys) {
      const rel = key.slice(prefix.length);
      if (!rel || rel.endsWith('/')) continue;
      const body = await this.store.get(key);
      if (!body) continue;
      const abs = join(localRoot, rel.split('/').join(sep));
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, body);
      n += 1;
    }
    return n;
  }
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(abs)));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

export async function persistCloudFolderAfterWrite(
  context: RunContext,
  absPath: string,
  persist: CloudFolderPersist = CloudFolderPersist.fromEnv()
): Promise<void> {
  try {
    const binding = workspaceBindingFromMetadata(context.session.metadata);
    if (binding.kind !== 'cloud_folder' || !binding.cloudFolderId) return;
    if (!persist.isConfigured()) return;
    const root = context.workspaceRoot ?? context.workspaceRoots?.find((r) => r.primary)?.path;
    if (!root) return;
    const rel = relative(root, absPath).replaceAll('\\', '/');
    if (!rel || rel.startsWith('..')) return;
    await persist.persistFile(binding.cloudFolderId, root, rel);
  } catch {
    /* fail-soft */
  }
}
