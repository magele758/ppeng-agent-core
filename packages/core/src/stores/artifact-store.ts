import { DatabaseSync } from 'node:sqlite';
import { optionalString } from './storage-helpers.js';

export interface ArtifactIndexRecord {
  id: string;
  sessionId: string;
  sourceTool: string;
  fileName?: string;
  mimeType: string;
  localRelPath: string;
  totalBytes: number;
  totalChars: number;
  pageSizeChars: number;
  totalPages: number;
  createdAt: string;
}

export class ArtifactStore {
  constructor(private readonly db: DatabaseSync) {}

  createArtifactIndex(row: ArtifactIndexRecord): ArtifactIndexRecord {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO artifacts (
        id, session_id, source_tool, file_name, mime_type, local_rel_path,
        total_bytes, total_chars, page_size_chars, total_pages, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        row.id,
        row.sessionId,
        row.sourceTool,
        row.fileName ?? null,
        row.mimeType,
        row.localRelPath,
        row.totalBytes,
        row.totalChars,
        row.pageSizeChars,
        row.totalPages,
        row.createdAt
      );
    return row;
  }

  getArtifactIndex(id: string): ArtifactIndexRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.map(row) : undefined;
  }

  listArtifactsForSession(sessionId: string): ArtifactIndexRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at ASC`)
      .all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.map(r));
  }

  private map(row: Record<string, unknown>): ArtifactIndexRecord {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      sourceTool: String(row.source_tool),
      fileName: optionalString(row.file_name),
      mimeType: String(row.mime_type),
      localRelPath: String(row.local_rel_path),
      totalBytes: Number(row.total_bytes),
      totalChars: Number(row.total_chars),
      pageSizeChars: Number(row.page_size_chars),
      totalPages: Number(row.total_pages),
      createdAt: String(row.created_at)
    };
  }
}
