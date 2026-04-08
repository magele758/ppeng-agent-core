/**
 * Task store: CRUD for tasks and task events.
 *
 * Extracted from SqliteStateStore to isolate the task management domain.
 * Takes a DatabaseSync instance via constructor injection (same pattern
 * as SessionMemoryStore).
 */
import type { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from '../id.js';
import { serializeJson, parseJson, optionalString } from './storage-helpers.js';
import type { TaskEvent, TaskRecord, TaskStatus } from '../types.js';

export interface CreateTaskInput {
  title: string;
  description?: string;
  ownerAgentId?: string;
  sessionId?: string;
  parentTaskId?: string;
  workspaceId?: string;
  blockedBy?: string[];
  metadata?: Record<string, unknown>;
}

export class TaskStore {
  constructor(private readonly db: DatabaseSync) {}

  createTask(input: CreateTaskInput): TaskRecord {
    const now = nowIso();
    const task: TaskRecord = {
      id: createId('task'),
      title: input.title,
      description: input.description ?? '',
      status: 'pending',
      ownerAgentId: input.ownerAgentId,
      sessionId: input.sessionId,
      parentTaskId: input.parentTaskId,
      workspaceId: input.workspaceId,
      blockedBy: input.blockedBy ?? [],
      artifacts: [],
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(`
        INSERT INTO tasks (
          id, title, description, status, owner_agent_id, session_id, parent_task_id, workspace_id,
          blocked_by_json, artifacts_json, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        task.id,
        task.title,
        task.description,
        task.status,
        task.ownerAgentId ?? null,
        task.sessionId ?? null,
        task.parentTaskId ?? null,
        task.workspaceId ?? null,
        serializeJson(task.blockedBy),
        serializeJson(task.artifacts),
        serializeJson(task.metadata),
        task.createdAt,
        task.updatedAt
      );

    this.appendEvent({
      taskId: task.id,
      kind: 'task.created',
      actor: task.ownerAgentId ?? 'system',
      payload: {
        title: task.title,
        sessionId: task.sessionId ?? null,
        parentTaskId: task.parentTaskId ?? null
      }
    });

    return task;
  }

  listTasks(filter?: { status?: TaskStatus }): TaskRecord[] {
    const rows = (filter?.status
      ? this.db.prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC`).all(filter.status)
      : this.db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`).all()) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapTaskRow(row));
  }

  listChildTasks(parentTaskId: string): TaskRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC`)
      .all(parentTaskId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapTaskRow(row));
  }

  getTask(id: string): TaskRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapTaskRow(row) : undefined;
  }

  updateTask(taskId: string, patch: Partial<Omit<TaskRecord, 'id' | 'createdAt'>>): TaskRecord {
    const existing = this.getTask(taskId);
    if (!existing) {
      throw new Error(`Task ${taskId} not found`);
    }

    const definedPatch: Partial<Omit<TaskRecord, 'id' | 'createdAt'>> = {};
    for (const [key, value] of Object.entries(patch) as [keyof typeof patch, unknown][]) {
      if (value !== undefined) {
        (definedPatch as Record<string, unknown>)[key as string] = value;
      }
    }

    const next: TaskRecord = {
      ...existing,
      ...definedPatch,
      updatedAt: nowIso()
    };

    this.db
      .prepare(`
        UPDATE tasks
        SET title = ?, description = ?, status = ?, owner_agent_id = ?, session_id = ?, parent_task_id = ?,
            workspace_id = ?, blocked_by_json = ?, artifacts_json = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        next.title,
        next.description,
        next.status,
        next.ownerAgentId ?? null,
        next.sessionId ?? null,
        next.parentTaskId ?? null,
        next.workspaceId ?? null,
        serializeJson(next.blockedBy),
        serializeJson(next.artifacts),
        serializeJson(next.metadata),
        next.updatedAt,
        next.id
      );

    return next;
  }

  appendEvent(input: Omit<TaskEvent, 'id' | 'createdAt'> & { createdAt?: string }): TaskEvent {
    const event: TaskEvent = {
      id: createId('evt'),
      taskId: input.taskId,
      kind: input.kind,
      actor: input.actor,
      payload: input.payload,
      createdAt: input.createdAt ?? nowIso()
    };

    this.db
      .prepare(`
        INSERT INTO task_events (id, task_id, kind, actor, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(event.id, event.taskId, event.kind, event.actor, serializeJson(event.payload), event.createdAt);

    return event;
  }

  listEvents(taskId: string): TaskEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC`)
      .all(taskId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      kind: String(row.kind),
      actor: String(row.actor),
      payload: parseJson<Record<string, unknown>>(String(row.payload_json)),
      createdAt: String(row.created_at)
    }));
  }

  private mapTaskRow(row: Record<string, unknown>): TaskRecord {
    return {
      id: String(row.id),
      title: String(row.title),
      description: String(row.description),
      status: String(row.status) as TaskStatus,
      ownerAgentId: optionalString(row.owner_agent_id),
      sessionId: optionalString(row.session_id),
      parentTaskId: optionalString(row.parent_task_id),
      workspaceId: optionalString(row.workspace_id),
      blockedBy: parseJson<string[]>(String(row.blocked_by_json)) ?? [],
      artifacts: parseJson<TaskRecord['artifacts']>(String(row.artifacts_json)) ?? [],
      metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)) ?? {},
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }
}
