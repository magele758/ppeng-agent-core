import type { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from '../id.js';
import type { CloudFolderBackend, CloudFolderRecord } from './types.js';

function mapRow(row: Record<string, unknown>): CloudFolderRecord {
  const backend = row.backend === 's3' ? 's3' : 'local';
  return {
    id: String(row.id),
    name: String(row.name),
    backend,
    localPath: String(row.local_path),
    s3Prefix: String(row.s3_prefix ?? ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export class CloudFolderStore {
  constructor(private readonly db: DatabaseSync) {}

  list(): CloudFolderRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM cloud_folders ORDER BY updated_at DESC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map(mapRow);
  }

  get(id: string): CloudFolderRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM cloud_folders WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : undefined;
  }

  create(input: {
    name: string;
    backend: CloudFolderBackend;
    localPath: string;
    s3Prefix: string;
  }): CloudFolderRecord {
    const now = nowIso();
    const id = createId('cfl');
    const name = input.name.trim() || 'Untitled folder';
    this.db
      .prepare(
        `INSERT INTO cloud_folders (id, name, backend, local_path, s3_prefix, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, name, input.backend, input.localPath, input.s3Prefix, now, now);
    return this.get(id)!;
  }

  update(
    id: string,
    patch: Partial<Pick<CloudFolderRecord, 'name' | 'backend' | 'localPath' | 's3Prefix'>>
  ): CloudFolderRecord | undefined {
    const cur = this.get(id);
    if (!cur) return undefined;
    const next = {
      name: typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : cur.name,
      backend: patch.backend ?? cur.backend,
      localPath: patch.localPath ?? cur.localPath,
      s3Prefix: patch.s3Prefix ?? cur.s3Prefix
    };
    this.db
      .prepare(
        `UPDATE cloud_folders
         SET name = ?, backend = ?, local_path = ?, s3_prefix = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(next.name, next.backend, next.localPath, next.s3Prefix, nowIso(), id);
    return this.get(id);
  }

  remove(id: string): boolean {
    const res = this.db.prepare(`DELETE FROM cloud_folders WHERE id = ?`).run(id);
    return Number(res.changes) > 0;
  }
}
