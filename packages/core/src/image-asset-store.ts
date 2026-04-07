import { DatabaseSync } from 'node:sqlite';
import { serializeJson, parseJson, optionalString } from './storage-helpers.js';
import type { ImageAssetRecord } from './types.js';

/**
 * Domain store for image asset persistence.
 * Shares the same DatabaseSync instance with SqliteStateStore.
 */
export class ImageAssetStore {
  constructor(private readonly db: DatabaseSync) {}

  createImageAsset(asset: ImageAssetRecord): ImageAssetRecord {
    this.db
      .prepare(
        `
      INSERT INTO image_assets (
        id, session_id, sha256, mime_type, source_type, source_url, local_rel_path, size_bytes,
        derived_from_json, retention_tier, kind, last_access_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        asset.id,
        asset.sessionId,
        asset.sha256,
        asset.mimeType,
        asset.sourceType,
        asset.sourceUrl ?? null,
        asset.localRelPath,
        asset.sizeBytes,
        serializeJson(asset.derivedFromIds),
        asset.retentionTier,
        asset.kind,
        asset.lastAccessAt,
        asset.createdAt
      );
    return asset;
  }

  getImageAsset(id: string): ImageAssetRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM image_assets WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapImageAssetRow(row) : undefined;
  }

  listImageAssetsForSession(sessionId: string): ImageAssetRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM image_assets WHERE session_id = ? ORDER BY created_at ASC`)
      .all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapImageAssetRow(row));
  }

  updateImageAsset(
    id: string,
    patch: Partial<Pick<ImageAssetRecord, 'retentionTier' | 'lastAccessAt' | 'localRelPath' | 'sizeBytes' | 'mimeType'>>
  ): ImageAssetRecord {
    const existing = this.getImageAsset(id);
    if (!existing) {
      throw new Error(`Image asset ${id} not found`);
    }
    const next: ImageAssetRecord = {
      ...existing,
      ...patch,
      lastAccessAt: patch.lastAccessAt ?? existing.lastAccessAt
    };
    this.db
      .prepare(
        `
      UPDATE image_assets SET
        retention_tier = ?, last_access_at = ?, local_rel_path = ?, size_bytes = ?, mime_type = ?
      WHERE id = ?
    `
      )
      .run(
        next.retentionTier,
        next.lastAccessAt,
        next.localRelPath,
        next.sizeBytes,
        next.mimeType,
        id
      );
    return next;
  }

  deleteImageAsset(id: string): void {
    this.db.prepare(`DELETE FROM image_assets WHERE id = ?`).run(id);
  }

  private mapImageAssetRow(row: Record<string, unknown>): ImageAssetRecord {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      sha256: String(row.sha256),
      mimeType: String(row.mime_type),
      sourceType: String(row.source_type) as ImageAssetRecord['sourceType'],
      sourceUrl: optionalString(row.source_url),
      localRelPath: String(row.local_rel_path),
      sizeBytes: Number(row.size_bytes),
      derivedFromIds: parseJson<string[]>(String(row.derived_from_json)),
      retentionTier: String(row.retention_tier) as ImageAssetRecord['retentionTier'],
      kind: String(row.kind) as ImageAssetRecord['kind'],
      lastAccessAt: String(row.last_access_at),
      createdAt: String(row.created_at)
    };
  }
}
