import { DatabaseSync } from 'node:sqlite';
import { optionalString } from './storage-helpers.js';
import type { AttachmentRecord } from '../ingestion/attachment-ingest-service.js';
import type { AttachmentKind } from '../ingestion/types.js';
import type { AttachmentStatus } from '../ingestion/status.js';

export class AttachmentStore {
  constructor(private readonly db: DatabaseSync) {}

  createAttachment(row: AttachmentRecord): AttachmentRecord {
    this.db
      .prepare(
        `
      INSERT INTO attachments (
        id, session_id, file_name, mime_type, kind, source_type, source_url, local_rel_path,
        size_bytes, status, status_reason, encoding, image_asset_id, artifact_handle, emit_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        row.id,
        row.sessionId,
        row.fileName,
        row.mimeType ?? null,
        row.kind,
        row.sourceType,
        row.sourceUrl ?? null,
        row.localRelPath ?? null,
        row.sizeBytes,
        row.status,
        row.statusReason ?? null,
        row.encoding ?? null,
        row.imageAssetId ?? null,
        row.artifactHandle ?? null,
        row.emitText ?? null,
        row.createdAt
      );
    return row;
  }

  getAttachment(id: string): AttachmentRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.map(row) : undefined;
  }

  listAttachmentsForSession(sessionId: string): AttachmentRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM attachments WHERE session_id = ? ORDER BY created_at ASC`)
      .all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.map(r));
  }

  private map(row: Record<string, unknown>): AttachmentRecord {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      fileName: String(row.file_name),
      mimeType: optionalString(row.mime_type),
      kind: String(row.kind) as AttachmentKind,
      sourceType: String(row.source_type) as AttachmentRecord['sourceType'],
      sourceUrl: optionalString(row.source_url),
      localRelPath: optionalString(row.local_rel_path),
      sizeBytes: Number(row.size_bytes),
      status: String(row.status) as AttachmentStatus['state'],
      statusReason: optionalString(row.status_reason),
      encoding: optionalString(row.encoding) as AttachmentRecord['encoding'],
      imageAssetId: optionalString(row.image_asset_id),
      artifactHandle: optionalString(row.artifact_handle),
      emitText: optionalString(row.emit_text),
      createdAt: String(row.created_at)
    };
  }
}
