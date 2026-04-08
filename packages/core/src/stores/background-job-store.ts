/**
 * Background job store: CRUD for background job records.
 *
 * Extracted from SqliteStateStore to isolate the background-job domain.
 * Takes a DatabaseSync instance via constructor injection.
 */
import type { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from '../id.js';
import { optionalString } from './storage-helpers.js';
import type { BackgroundJobRecord, BackgroundJobStatus } from '../types.js';

export class BackgroundJobStore {
  constructor(private readonly db: DatabaseSync) {}

  createBackgroundJob(input: Omit<BackgroundJobRecord, 'id' | 'createdAt' | 'updatedAt'>): BackgroundJobRecord {
    const job: BackgroundJobRecord = {
      id: createId('bg'),
      sessionId: input.sessionId,
      command: input.command,
      status: input.status,
      result: input.result,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    this.db
      .prepare(`
        INSERT INTO background_jobs (id, session_id, command, status, result, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(job.id, job.sessionId, job.command, job.status, job.result ?? null, job.createdAt, job.updatedAt);

    return job;
  }

  listBackgroundJobs(sessionId?: string): BackgroundJobRecord[] {
    const rows = (sessionId
      ? this.db.prepare(`SELECT * FROM background_jobs WHERE session_id = ? ORDER BY created_at DESC`).all(sessionId)
      : this.db.prepare(`SELECT * FROM background_jobs ORDER BY created_at DESC`).all()) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapBackgroundJobRow(row));
  }

  getBackgroundJob(id: string): BackgroundJobRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM background_jobs WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapBackgroundJobRow(row) : undefined;
  }

  updateBackgroundJob(id: string, status: BackgroundJobStatus, result?: string): BackgroundJobRecord {
    const existing = this.getBackgroundJob(id);
    if (!existing) {
      throw new Error(`Background job ${id} not found`);
    }

    const next: BackgroundJobRecord = {
      ...existing,
      status,
      result,
      updatedAt: nowIso()
    };

    this.db
      .prepare(`UPDATE background_jobs SET status = ?, result = ?, updated_at = ? WHERE id = ?`)
      .run(next.status, next.result ?? null, next.updatedAt, next.id);

    return next;
  }

  private mapBackgroundJobRow(row: Record<string, unknown>): BackgroundJobRecord {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      command: String(row.command),
      status: String(row.status) as BackgroundJobStatus,
      result: optionalString(row.result),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }
}
