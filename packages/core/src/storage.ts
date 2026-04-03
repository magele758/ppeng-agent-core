import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from './id.js';
import { normalizeSelfHealPolicy } from './self-heal/self-heal-policy.js';
import type {
  AgentSpec,
  ApprovalRecord,
  ApprovalStatus,
  BackgroundJobRecord,
  BackgroundJobStatus,
  DaemonRestartRequest,
  ImageAssetRecord,
  MailRecord,
  MailStatus,
  MessageRole,
  SelfHealEventRecord,
  SelfHealRunRecord,
  SelfHealStatus,
  SessionMessage,
  SessionRecord,
  SessionStatus,
  TaskEvent,
  SessionMemoryEntry,
  TaskRecord,
  TaskStatus,
  WorkspaceRecord
} from './types.js';

function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string | null): T {
  return (value ? JSON.parse(value) : null) as T;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function intToBool(value: unknown): boolean {
  return Number(value) === 1;
}

export interface CreateSessionInput {
  title: string;
  mode: SessionRecord['mode'];
  agentId: string;
  taskId?: string;
  workspaceId?: string;
  parentSessionId?: string;
  background?: boolean;
  summary?: string;
  metadata?: Record<string, unknown>;
}

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

export class SqliteStateStore {
  readonly dbPath: string;
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    if (!existsSync(dirname(dbPath))) {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.initialize();
  }

  initialize(): void {
    this.resetLegacySchemaIfNeeded();
    this.db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        spec_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        task_id TEXT,
        workspace_id TEXT,
        parent_session_id TEXT,
        background INTEGER NOT NULL,
        summary TEXT,
        todo_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        parts_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        owner_agent_id TEXT,
        session_id TEXT,
        parent_task_id TEXT,
        workspace_id TEXT,
        blocked_by_json TEXT NOT NULL,
        artifacts_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        actor TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        args_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mode TEXT NOT NULL,
        source_path TEXT NOT NULL,
        root_path TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mailbox (
        id TEXT PRIMARY KEY,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        correlation_id TEXT,
        session_id TEXT,
        task_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT
      );

      CREATE TABLE IF NOT EXISTS background_jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        command TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_messages_session ON session_messages(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
      CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
      CREATE INDEX IF NOT EXISTS idx_workspaces_task ON workspaces(task_id);
      CREATE INDEX IF NOT EXISTS idx_mail_to_status ON mailbox(to_agent_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_bg_jobs_status ON background_jobs(status, updated_at);
    `);
    this.migrateSchema();
  }

  private migrateSchema(): void {
    const approvalCols = this.db.prepare(`PRAGMA table_info(approvals)`).all() as Array<{ name: string }>;
    if (!approvalCols.some((column) => column.name === 'idempotency_key')) {
      this.db.exec(`ALTER TABLE approvals ADD COLUMN idempotency_key TEXT`);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS image_assets (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_url TEXT,
        local_rel_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        derived_from_json TEXT NOT NULL,
        retention_tier TEXT NOT NULL,
        kind TEXT NOT NULL,
        last_access_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_image_assets_session ON image_assets(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_image_assets_sha ON image_assets(session_id, sha256);

      CREATE TABLE IF NOT EXISTS session_memory (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(session_id, scope, key)
      );
      CREATE INDEX IF NOT EXISTS idx_session_memory_session ON session_memory(session_id, scope);

      CREATE TABLE IF NOT EXISTS scheduler_wake (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scheduler_wake_created ON scheduler_wake(created_at ASC);

      CREATE TABLE IF NOT EXISTS self_heal_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        policy_json TEXT NOT NULL,
        task_id TEXT,
        session_id TEXT,
        workspace_id TEXT,
        worktree_branch TEXT,
        fix_iteration INTEGER NOT NULL DEFAULT 0,
        last_error_summary TEXT,
        last_test_output TEXT,
        merge_commit_sha TEXT,
        block_reason TEXT,
        stopped INTEGER NOT NULL DEFAULT 0,
        restart_requested_at TEXT,
        restart_ack_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_self_heal_runs_status ON self_heal_runs(status, updated_at);

      CREATE TABLE IF NOT EXISTS self_heal_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_self_heal_events_run ON self_heal_events(run_id, created_at);

      CREATE TABLE IF NOT EXISTS daemon_control (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Migrate session_memory table with new columns for memory consolidation
    const memoryCols = this.db.prepare(`PRAGMA table_info(session_memory)`).all() as Array<{ name: string }>;
    if (!memoryCols.some((column) => column.name === 'importance')) {
      this.db.exec(`ALTER TABLE session_memory ADD COLUMN importance REAL DEFAULT 0.5`);
    }
    if (!memoryCols.some((column) => column.name === 'access_count')) {
      this.db.exec(`ALTER TABLE session_memory ADD COLUMN access_count INTEGER DEFAULT 0`);
    }
    if (!memoryCols.some((column) => column.name === 'last_access_at')) {
      this.db.exec(`ALTER TABLE session_memory ADD COLUMN last_access_at TEXT`);
    }
    if (!memoryCols.some((column) => column.name === 'source')) {
      this.db.exec(`ALTER TABLE session_memory ADD COLUMN source TEXT`);
    }
    if (!memoryCols.some((column) => column.name === 'merged_from_json')) {
      this.db.exec(`ALTER TABLE session_memory ADD COLUMN merged_from_json TEXT`);
    }
  }

  private resetLegacySchemaIfNeeded(): void {
    const hasTasksTable = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'`)
      .get() as { name: string } | undefined;

    if (!hasTasksTable) {
      return;
    }

    const taskColumns = this.db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>;
    const hasNewTaskSchema = taskColumns.some((column) => column.name === 'title');
    if (hasNewTaskSchema) {
      return;
    }

    this.db.exec(`
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS session_messages;
      DROP TABLE IF EXISTS tasks;
      DROP TABLE IF EXISTS task_events;
      DROP TABLE IF EXISTS approvals;
      DROP TABLE IF EXISTS workspaces;
      DROP TABLE IF EXISTS mailbox;
      DROP TABLE IF EXISTS background_jobs;
    `);
  }

  upsertAgent(agent: AgentSpec): void {
    const now = nowIso();
    this.db
      .prepare(`
        INSERT INTO agents (id, name, role, spec_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          role = excluded.role,
          spec_json = excluded.spec_json,
          updated_at = excluded.updated_at
      `)
      .run(agent.id, agent.name, agent.role, serializeJson(agent), now, now);
  }

  listAgents(): AgentSpec[] {
    const rows = this.db.prepare(`SELECT spec_json FROM agents ORDER BY id`).all() as Array<{ spec_json: string }>;
    return rows.map((row) => parseJson<AgentSpec>(row.spec_json));
  }

  getAgent(id: string): AgentSpec | undefined {
    const row = this.db.prepare(`SELECT spec_json FROM agents WHERE id = ?`).get(id) as
      | { spec_json: string }
      | undefined;
    return row ? parseJson<AgentSpec>(row.spec_json) : undefined;
  }

  createSession(input: CreateSessionInput): SessionRecord {
    const now = nowIso();
    const session: SessionRecord = {
      id: createId('session'),
      title: input.title,
      mode: input.mode,
      status: 'idle',
      agentId: input.agentId,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      parentSessionId: input.parentSessionId,
      background: input.background ?? false,
      summary: input.summary,
      todo: [],
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(`
        INSERT INTO sessions (
          id, title, mode, status, agent_id, task_id, workspace_id, parent_session_id, background,
          summary, todo_json, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        session.id,
        session.title,
        session.mode,
        session.status,
        session.agentId,
        session.taskId ?? null,
        session.workspaceId ?? null,
        session.parentSessionId ?? null,
        boolToInt(session.background),
        session.summary ?? null,
        serializeJson(session.todo),
        serializeJson(session.metadata),
        session.createdAt,
        session.updatedAt
      );

    return session;
  }

  listSessions(): SessionRecord[] {
    const rows = this.db.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`).all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapSessionRow(row));
  }

  getSession(id: string): SessionRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapSessionRow(row) : undefined;
  }

  updateSession(
    sessionId: string,
    patch: Partial<Omit<SessionRecord, 'id' | 'createdAt'>>
  ): SessionRecord {
    const existing = this.getSession(sessionId);
    if (!existing) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const next: SessionRecord = {
      ...existing,
      ...patch,
      updatedAt: nowIso()
    };

    this.db
      .prepare(`
        UPDATE sessions
        SET title = ?, mode = ?, status = ?, agent_id = ?, task_id = ?, workspace_id = ?,
            parent_session_id = ?, background = ?, summary = ?, todo_json = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        next.title,
        next.mode,
        next.status,
        next.agentId,
        next.taskId ?? null,
        next.workspaceId ?? null,
        next.parentSessionId ?? null,
        boolToInt(next.background),
        next.summary ?? null,
        serializeJson(next.todo),
        serializeJson(next.metadata),
        next.updatedAt,
        next.id
      );

    return next;
  }

  appendMessage(sessionId: string, role: MessageRole, parts: SessionMessage['parts']): SessionMessage {
    const message: SessionMessage = {
      id: createId('msg'),
      sessionId,
      role,
      parts,
      createdAt: nowIso()
    };

    this.db
      .prepare(`
        INSERT INTO session_messages (id, session_id, role, parts_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(message.id, message.sessionId, message.role, serializeJson(message.parts), message.createdAt);

    this.db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(message.createdAt, sessionId);
    return message;
  }

  listMessages(sessionId: string): SessionMessage[] {
    const rows = this.db
      .prepare(`SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at ASC`)
      .all(sessionId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      role: String(row.role) as MessageRole,
      parts: parseJson<SessionMessage['parts']>(String(row.parts_json)),
      createdAt: String(row.created_at)
    }));
  }

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

  createApproval(
    input: Omit<ApprovalRecord, 'id' | 'status' | 'createdAt' | 'updatedAt'> & { idempotencyKey?: string }
  ): ApprovalRecord {
    if (input.idempotencyKey) {
      const dup = this.db
        .prepare(
          `SELECT * FROM approvals WHERE session_id = ? AND idempotency_key = ? AND status = 'pending' LIMIT 1`
        )
        .get(input.sessionId, input.idempotencyKey) as Record<string, unknown> | undefined;
      if (dup) {
        return {
          id: String(dup.id),
          sessionId: String(dup.session_id),
          toolName: String(dup.tool_name),
          status: 'pending',
          reason: String(dup.reason),
          args: parseJson<Record<string, unknown>>(String(dup.args_json)),
          idempotencyKey: optionalString(dup.idempotency_key),
          createdAt: String(dup.created_at),
          updatedAt: String(dup.updated_at)
        };
      }
    }

    const approval: ApprovalRecord = {
      id: createId('approval'),
      sessionId: input.sessionId,
      toolName: input.toolName,
      status: 'pending',
      reason: input.reason,
      args: input.args,
      idempotencyKey: input.idempotencyKey,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    this.db
      .prepare(`
        INSERT INTO approvals (id, session_id, tool_name, status, reason, args_json, idempotency_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        approval.id,
        approval.sessionId,
        approval.toolName,
        approval.status,
        approval.reason,
        serializeJson(approval.args),
        approval.idempotencyKey ?? null,
        approval.createdAt,
        approval.updatedAt
      );

    return approval;
  }

  listApprovals(filter?: { status?: ApprovalStatus }): ApprovalRecord[] {
    const rows = (filter?.status
      ? this.db.prepare(`SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC`).all(filter.status)
      : this.db.prepare(`SELECT * FROM approvals ORDER BY created_at DESC`).all()) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      toolName: String(row.tool_name),
      status: String(row.status) as ApprovalStatus,
      reason: String(row.reason),
      args: parseJson<Record<string, unknown>>(String(row.args_json)),
      idempotencyKey: optionalString((row as { idempotency_key?: unknown }).idempotency_key),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }));
  }

  getApproval(id: string): ApprovalRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM approvals WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row
      ? {
          id: String(row.id),
          sessionId: String(row.session_id),
          toolName: String(row.tool_name),
          status: String(row.status) as ApprovalStatus,
          reason: String(row.reason),
          args: parseJson<Record<string, unknown>>(String(row.args_json)),
          idempotencyKey: optionalString((row as { idempotency_key?: unknown }).idempotency_key),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at)
        }
      : undefined;
  }

  updateApproval(id: string, status: ApprovalStatus): ApprovalRecord {
    const approval = this.getApproval(id);
    if (!approval) {
      throw new Error(`Approval ${id} not found`);
    }

    const next: ApprovalRecord = {
      ...approval,
      status,
      updatedAt: nowIso()
    };

    this.db.prepare(`UPDATE approvals SET status = ?, updated_at = ? WHERE id = ?`).run(next.status, next.updatedAt, next.id);
    return next;
  }

  deleteApproval(id: string): void {
    this.db.prepare(`DELETE FROM approvals WHERE id = ?`).run(id);
  }

  createWorkspace(workspace: WorkspaceRecord): WorkspaceRecord {
    this.db
      .prepare(`
        INSERT INTO workspaces (id, task_id, name, mode, source_path, root_path, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        workspace.id,
        workspace.taskId,
        workspace.name,
        workspace.mode,
        workspace.sourcePath,
        workspace.rootPath,
        workspace.status,
        workspace.createdAt
      );

    return workspace;
  }

  listWorkspaces(): WorkspaceRecord[] {
    const rows = this.db.prepare(`SELECT * FROM workspaces ORDER BY created_at DESC`).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      name: String(row.name),
      mode: String(row.mode) as WorkspaceRecord['mode'],
      sourcePath: String(row.source_path),
      rootPath: String(row.root_path),
      status: String(row.status) as WorkspaceRecord['status'],
      createdAt: String(row.created_at)
    }));
  }

  getWorkspace(id: string): WorkspaceRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM workspaces WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row
      ? {
          id: String(row.id),
          taskId: String(row.task_id),
          name: String(row.name),
          mode: String(row.mode) as WorkspaceRecord['mode'],
          sourcePath: String(row.source_path),
          rootPath: String(row.root_path),
          status: String(row.status) as WorkspaceRecord['status'],
          createdAt: String(row.created_at)
        }
      : undefined;
  }

  createMail(input: Omit<MailRecord, 'id' | 'status' | 'createdAt' | 'readAt'>): MailRecord {
    const mail: MailRecord = {
      id: createId('mail'),
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      type: input.type,
      content: input.content,
      correlationId: input.correlationId,
      sessionId: input.sessionId,
      taskId: input.taskId,
      status: 'pending',
      createdAt: nowIso()
    };

    this.db
      .prepare(`
        INSERT INTO mailbox (
          id, from_agent_id, to_agent_id, type, content, correlation_id, session_id, task_id, status, created_at, read_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        mail.id,
        mail.fromAgentId,
        mail.toAgentId,
        mail.type,
        mail.content,
        mail.correlationId ?? null,
        mail.sessionId ?? null,
        mail.taskId ?? null,
        mail.status,
        mail.createdAt,
        null
      );

    return mail;
  }

  listMailbox(agentId: string, onlyPending = false): MailRecord[] {
    const rows = (onlyPending
      ? this.db
          .prepare(`SELECT * FROM mailbox WHERE to_agent_id = ? AND status = 'pending' ORDER BY created_at ASC`)
          .all(agentId)
      : this.db.prepare(`SELECT * FROM mailbox WHERE to_agent_id = ? ORDER BY created_at ASC`).all(agentId)) as Array<
      Record<string, unknown>
    >;

    return rows.map((row) => this.mapMailRow(row));
  }

  /** Recent mailbox rows for team visualization (newest first). */
  listAllMailbox(options?: { limit?: number }): MailRecord[] {
    const cap = Math.min(Math.max(options?.limit ?? 200, 1), 2000);
    const rows = this.db
      .prepare(`SELECT * FROM mailbox ORDER BY created_at DESC LIMIT ?`)
      .all(cap) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapMailRow(row));
  }

  markMailRead(id: string): MailRecord {
    const row = this.db.prepare(`SELECT * FROM mailbox WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`Mail ${id} not found`);
    }

    const readAt = nowIso();
    this.db.prepare(`UPDATE mailbox SET status = 'read', read_at = ? WHERE id = ?`).run(readAt, id);
    return this.mapMailRow({
      ...row,
      status: 'read',
      read_at: readAt
    });
  }

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

  upsertSessionMemory(input: {
    sessionId: string;
    scope: SessionMemoryEntry['scope'];
    key: string;
    value: string;
    metadata?: Record<string, unknown>;
    /** Importance score (0-1). Higher = more relevant for retrieval. */
    importance?: number;
    /** Source of this memory entry. */
    source?: SessionMemoryEntry['source'];
    /** IDs of memory entries merged into this one. */
    mergedFrom?: string[];
  }): SessionMemoryEntry {
    const now = nowIso();
    const existing = this.db
      .prepare(`SELECT id, access_count FROM session_memory WHERE session_id = ? AND scope = ? AND key = ?`)
      .get(input.sessionId, input.scope, input.key) as { id: string; access_count: number } | undefined;

    const metadata = input.metadata ?? {};
    const importance = input.importance ?? 0.5;
    const source = input.source ?? 'user_provided';

    if (existing) {
      // Preserve existing access_count on update
      const newAccessCount = existing.access_count ?? 0;
      this.db
        .prepare(
          `UPDATE session_memory SET value = ?, metadata_json = ?, importance = ?, source = ?, merged_from_json = ?, updated_at = ?, access_count = ?, last_access_at = ? WHERE id = ?`
        )
        .run(
          input.value,
          serializeJson(metadata),
          importance,
          source,
          serializeJson(input.mergedFrom ?? null),
          now,
          newAccessCount,
          now,
          existing.id
        );
      return this.getSessionMemoryEntry(existing.id) as SessionMemoryEntry;
    }

    const entry: SessionMemoryEntry = {
      id: createId('mem'),
      sessionId: input.sessionId,
      scope: input.scope,
      key: input.key,
      value: input.value,
      metadata,
      importance,
      accessCount: 0,
      lastAccessAt: now,
      source,
      mergedFrom: input.mergedFrom,
      updatedAt: now
    };

    this.db
      .prepare(
        `INSERT INTO session_memory (id, session_id, scope, key, value, metadata_json, importance, access_count, last_access_at, source, merged_from_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.sessionId,
        entry.scope,
        entry.key,
        entry.value,
        serializeJson(entry.metadata),
        entry.importance ?? 0.5,
        entry.accessCount ?? 0,
        entry.lastAccessAt ?? now,
        entry.source ?? 'user_provided',
        serializeJson(entry.mergedFrom ?? null),
        entry.updatedAt
      );

    return entry;
  }

  getSessionMemoryEntry(id: string): SessionMemoryEntry | undefined {
    const row = this.db.prepare(`SELECT * FROM session_memory WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapSessionMemoryRow(row) : undefined;
  }

  listSessionMemory(sessionId: string, scope?: SessionMemoryEntry['scope']): SessionMemoryEntry[] {
    const rows = (scope
      ? this.db
          .prepare(`SELECT * FROM session_memory WHERE session_id = ? AND scope = ? ORDER BY key ASC`)
          .all(sessionId, scope)
      : this.db.prepare(`SELECT * FROM session_memory WHERE session_id = ? ORDER BY scope ASC, key ASC`).all(sessionId)) as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => this.mapSessionMemoryRow(row));
  }

  deleteSessionMemory(sessionId: string, scope: SessionMemoryEntry['scope'], key: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM session_memory WHERE session_id = ? AND scope = ? AND key = ?`)
      .run(sessionId, scope, key);
    return result.changes > 0;
  }

  /** Copy memory rows from one session to another (upsert by key). */
  copySessionMemory(fromSessionId: string, toSessionId: string, scope: SessionMemoryEntry['scope']): number {
    const rows = this.listSessionMemory(fromSessionId, scope);
    for (const row of rows) {
      this.upsertSessionMemory({
        sessionId: toSessionId,
        scope,
        key: row.key,
        value: row.value,
        metadata: row.metadata,
        importance: row.importance,
        source: row.source,
        mergedFrom: row.mergedFrom
      });
    }
    return rows.length;
  }

  enqueueSchedulerWake(sessionId: string, reason: string): void {
    this.db
      .prepare(`INSERT INTO scheduler_wake (id, session_id, reason, created_at) VALUES (?, ?, ?, ?)`)
      .run(createId('wake'), sessionId, reason, nowIso());
  }

  /** Returns distinct session ids in FIFO order (by first enqueue time per id in this batch). */
  dequeueSchedulerWakes(limit = 32): string[] {
    const rows = this.db
      .prepare(`SELECT id, session_id FROM scheduler_wake ORDER BY created_at ASC LIMIT ?`)
      .all(limit) as Array<{ id: string; session_id: string }>;
    if (rows.length === 0) {
      return [];
    }
    const del = this.db.prepare(`DELETE FROM scheduler_wake WHERE id = ?`);
    for (const row of rows) {
      del.run(row.id);
    }
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const row of rows) {
      if (!seen.has(row.session_id)) {
        seen.add(row.session_id);
        ordered.push(row.session_id);
      }
    }
    return ordered;
  }

  createSelfHealRun(input: { policy: SelfHealRunRecord['policy'] }): SelfHealRunRecord {
    const now = nowIso();
    const run: SelfHealRunRecord = {
      id: createId('sheal'),
      status: 'pending',
      policy: input.policy,
      fixIteration: 0,
      stopped: false,
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `
        INSERT INTO self_heal_runs (
          id, status, policy_json, task_id, session_id, workspace_id, worktree_branch,
          fix_iteration, last_error_summary, last_test_output, merge_commit_sha, block_reason,
          stopped, restart_requested_at, restart_ack_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        run.id,
        run.status,
        serializeJson(run.policy),
        null,
        null,
        null,
        null,
        run.fixIteration,
        null,
        null,
        null,
        null,
        boolToInt(run.stopped),
        null,
        null,
        run.createdAt,
        run.updatedAt
      );
    return run;
  }

  getSelfHealRun(id: string): SelfHealRunRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM self_heal_runs WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapSelfHealRunRow(row) : undefined;
  }

  listSelfHealRuns(options?: { limit?: number }): SelfHealRunRecord[] {
    const cap = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    const rows = this.db
      .prepare(`SELECT * FROM self_heal_runs ORDER BY updated_at DESC LIMIT ?`)
      .all(cap) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapSelfHealRunRow(row));
  }

  /** Active = not in terminal state and not user-stopped. */
  listActiveSelfHealRuns(): SelfHealRunRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM self_heal_runs WHERE stopped = 0
         AND status NOT IN ('completed','failed','blocked','stopped')`
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapSelfHealRunRow(row));
  }

  updateSelfHealRun(
    id: string,
    patch: Partial<
      Omit<SelfHealRunRecord, 'id' | 'createdAt' | 'policy'> & { policy?: SelfHealRunRecord['policy'] }
    >
  ): SelfHealRunRecord {
    const existing = this.getSelfHealRun(id);
    if (!existing) {
      throw new Error(`Self-heal run ${id} not found`);
    }
    const next: SelfHealRunRecord = {
      ...existing,
      ...patch,
      policy: patch.policy ?? existing.policy,
      updatedAt: nowIso()
    };
    this.db
      .prepare(
        `
        UPDATE self_heal_runs SET
          status = ?, policy_json = ?, task_id = ?, session_id = ?, workspace_id = ?, worktree_branch = ?,
          fix_iteration = ?, last_error_summary = ?, last_test_output = ?, merge_commit_sha = ?, block_reason = ?,
          stopped = ?, restart_requested_at = ?, restart_ack_at = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        next.status,
        serializeJson(next.policy),
        next.taskId ?? null,
        next.sessionId ?? null,
        next.workspaceId ?? null,
        next.worktreeBranch ?? null,
        next.fixIteration,
        next.lastErrorSummary ?? null,
        next.lastTestOutput ?? null,
        next.mergeCommitSha ?? null,
        next.blockReason ?? null,
        boolToInt(next.stopped),
        next.restartRequestedAt ?? null,
        next.restartAckAt ?? null,
        next.updatedAt,
        id
      );
    return next;
  }

  appendSelfHealEvent(input: { runId: string; kind: string; payload?: Record<string, unknown> }): SelfHealEventRecord {
    const ev: SelfHealEventRecord = {
      id: createId('sheal_ev'),
      runId: input.runId,
      kind: input.kind,
      payload: input.payload ?? {},
      createdAt: nowIso()
    };
    this.db
      .prepare(
        `INSERT INTO self_heal_events (id, run_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(ev.id, ev.runId, ev.kind, serializeJson(ev.payload), ev.createdAt);
    return ev;
  }

  listSelfHealEvents(runId: string, limit = 200): SelfHealEventRecord[] {
    const cap = Math.min(Math.max(limit, 1), 1000);
    const rows = this.db
      .prepare(`SELECT * FROM self_heal_events WHERE run_id = ? ORDER BY created_at ASC LIMIT ?`)
      .all(runId, cap) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapSelfHealEventRow(row));
  }

  setDaemonControl(key: string, value: unknown): void {
    const now = nowIso();
    this.db
      .prepare(
        `
        INSERT INTO daemon_control (key, value_json, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `
      )
      .run(key, serializeJson(value), now);
  }

  getDaemonControl<T>(key: string): T | undefined {
    const row = this.db.prepare(`SELECT value_json FROM daemon_control WHERE key = ?`).get(key) as
      | { value_json: string }
      | undefined;
    return row ? (parseJson<T>(row.value_json) ?? undefined) : undefined;
  }

  deleteDaemonControl(key: string): void {
    this.db.prepare(`DELETE FROM daemon_control WHERE key = ?`).run(key);
  }

  private mapSelfHealRunRow(row: Record<string, unknown>): SelfHealRunRecord {
    return {
      id: String(row.id),
      status: String(row.status) as SelfHealStatus,
      policy: normalizeSelfHealPolicy(parseJson<Partial<SelfHealRunRecord['policy']>>(String(row.policy_json))),
      taskId: optionalString(row.task_id),
      sessionId: optionalString(row.session_id),
      workspaceId: optionalString(row.workspace_id),
      worktreeBranch: optionalString(row.worktree_branch),
      fixIteration: Number(row.fix_iteration) || 0,
      lastErrorSummary: optionalString(row.last_error_summary),
      lastTestOutput: optionalString(row.last_test_output),
      mergeCommitSha: optionalString(row.merge_commit_sha),
      blockReason: optionalString(row.block_reason),
      stopped: intToBool(row.stopped),
      restartRequestedAt: optionalString(row.restart_requested_at),
      restartAckAt: optionalString(row.restart_ack_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapSelfHealEventRow(row: Record<string, unknown>): SelfHealEventRecord {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      kind: String(row.kind),
      payload: parseJson<Record<string, unknown>>(String(row.payload_json)) ?? {},
      createdAt: String(row.created_at)
    };
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

  private mapSessionRow(row: Record<string, unknown>): SessionRecord {
    return {
      id: String(row.id),
      title: String(row.title),
      mode: String(row.mode) as SessionRecord['mode'],
      status: String(row.status) as SessionStatus,
      agentId: String(row.agent_id),
      taskId: optionalString(row.task_id),
      workspaceId: optionalString(row.workspace_id),
      parentSessionId: optionalString(row.parent_session_id),
      background: intToBool(row.background),
      summary: optionalString(row.summary),
      todo: parseJson<SessionRecord['todo']>(String(row.todo_json)) ?? [],
      metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)) ?? {},
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
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

  private mapMailRow(row: Record<string, unknown>): MailRecord {
    return {
      id: String(row.id),
      fromAgentId: String(row.from_agent_id),
      toAgentId: String(row.to_agent_id),
      type: String(row.type),
      content: String(row.content),
      correlationId: optionalString(row.correlation_id),
      sessionId: optionalString(row.session_id),
      taskId: optionalString(row.task_id),
      status: String(row.status) as MailStatus,
      createdAt: String(row.created_at),
      readAt: optionalString(row.read_at)
    };
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

  private mapSessionMemoryRow(row: Record<string, unknown>): SessionMemoryEntry {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      scope: String(row.scope) as SessionMemoryEntry['scope'],
      key: String(row.key),
      value: String(row.value),
      metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)) ?? {},
      importance: row.importance != null ? Number(row.importance) : undefined,
      accessCount: row.access_count != null ? Number(row.access_count) : undefined,
      lastAccessAt: optionalString(row.last_access_at),
      source: optionalString(row.source) as SessionMemoryEntry['source'] | undefined,
      mergedFrom: parseJson<string[]>(String(row.merged_from_json ?? 'null')) ?? undefined,
      updatedAt: String(row.updated_at)
    };
  }

  /**
   * Record access to a memory entry (increments access_count, updates last_access_at).
   * Returns the updated entry or undefined if not found.
   */
  touchSessionMemory(id: string): SessionMemoryEntry | undefined {
    const existing = this.getSessionMemoryEntry(id);
    if (!existing) return undefined;

    const now = nowIso();
    const newCount = (existing.accessCount ?? 0) + 1;
    this.db
      .prepare(`UPDATE session_memory SET access_count = ?, last_access_at = ? WHERE id = ?`)
      .run(newCount, now, id);

    return this.getSessionMemoryEntry(id);
  }

  /**
   * List memory entries sorted by importance (descending) then recency.
   * Implements Mem0-style retrieval prioritization for efficient context window usage.
   */
  listSessionMemoryByRelevance(
    sessionId: string,
    scope?: SessionMemoryEntry['scope'],
    limit?: number
  ): SessionMemoryEntry[] {
    const baseQuery = scope
      ? `SELECT * FROM session_memory WHERE session_id = ? AND scope = ?`
      : `SELECT * FROM session_memory WHERE session_id = ?`;
    const orderClause = ` ORDER BY importance DESC, last_access_at DESC`;
    const limitClause = limit ? ` LIMIT ?` : '';

    const rows = (scope
      ? this.db.prepare(baseQuery + orderClause + limitClause).all(sessionId, scope, ...(limit ? [limit] : []))
      : this.db.prepare(baseQuery + orderClause + limitClause).all(sessionId, ...(limit ? [limit] : []))
    ) as Array<Record<string, unknown>>;

    return rows.map((row) => this.mapSessionMemoryRow(row));
  }

  /**
   * Consolidate multiple memory entries into a single entry.
   * Implements Mem0-style memory consolidation for reducing redundancy.
   * The merged entries are deleted after consolidation.
   */
  consolidateSessionMemory(
    sessionId: string,
    scope: SessionMemoryEntry['scope'],
    keys: string[],
    newKey: string,
    consolidatedValue: string,
    importance?: number
  ): SessionMemoryEntry | undefined {
    if (keys.length === 0) return undefined;

    // Get the entries to merge
    const entries = keys
      .map((k) =>
        this.db
          .prepare(`SELECT * FROM session_memory WHERE session_id = ? AND scope = ? AND key = ?`)
          .get(sessionId, scope, k) as SessionMemoryEntry | undefined
      )
      .filter((e): e is SessionMemoryEntry => e !== undefined);

    if (entries.length === 0) return undefined;

    // Calculate merged importance (max of merged entries, or provided value)
    const mergedImportance =
      importance ?? Math.max(...entries.map((e) => e.importance ?? 0.5));
    const mergedIds = entries.map((e) => e.id);

    // Create the consolidated entry
    const consolidated = this.upsertSessionMemory({
      sessionId,
      scope,
      key: newKey,
      value: consolidatedValue,
      importance: mergedImportance,
      source: 'consolidated',
      mergedFrom: mergedIds
    });

    // Delete the original entries
    for (const key of keys) {
      this.deleteSessionMemory(sessionId, scope, key);
    }

    return consolidated;
  }

  /**
   * Calculate time-decayed relevance score for a memory entry.
   *
   * Inspired by time-dependent leachate chemistry (arXiv:2510.03344):
   * - Fresh memories have higher "reactivity" (relevance)
   * - Relevance decays exponentially over time if not accessed
   * - Access reinforces memory strength (similar to saturation effects)
   *
   * Decay model: relevance = importance * e^(-decay_rate * hours_since_access) * log(1 + access_count)
   *
   * @param entry - The memory entry to score
   * @param halfLifeHours - Time in hours for relevance to halve (default: 24)
   * @param now - Current timestamp (default: new Date())
   * @returns Decay-adjusted relevance score (0-1+)
   */
  calculateDecayedRelevance(
    entry: SessionMemoryEntry,
    options?: { halfLifeHours?: number; now?: Date }
  ): number {
    const halfLife = options?.halfLifeHours ?? 24;
    const now = options?.now ?? new Date();

    const importance = entry.importance ?? 0.5;
    const accessCount = entry.accessCount ?? 0;

    // Calculate hours since last access
    const lastAccess = entry.lastAccessAt ? new Date(entry.lastAccessAt) : new Date(entry.updatedAt);
    const hoursSinceAccess = Math.max(0, (now.getTime() - lastAccess.getTime()) / (1000 * 60 * 60));

    // Exponential decay: e^(-ln(2) * t / halfLife)
    const decayRate = Math.LN2 / halfLife;
    const decayFactor = Math.exp(-decayRate * hoursSinceAccess);

    // Reinforcement factor: log(1 + access_count) gives diminishing returns
    // This mirrors the paper's "gradual saturation" effect
    const reinforcementFactor = Math.log(1 + accessCount) + 1;

    // Combined relevance score
    const relevance = importance * decayFactor * reinforcementFactor;

    return Math.max(0, relevance);
  }

  /**
   * List memory entries sorted by decayed relevance score.
   * Combines time-decay with importance and access patterns for
   * optimal context window prioritization.
   *
   * @param sessionId - Session to query
   * @param scope - Optional scope filter
   * @param limit - Maximum entries to return
   * @param halfLifeHours - Decay half-life in hours (default: 24)
   */
  listSessionMemoryByDecayedRelevance(
    sessionId: string,
    scope?: SessionMemoryEntry['scope'],
    options?: { limit?: number; halfLifeHours?: number }
  ): Array<SessionMemoryEntry & { decayedRelevance: number }> {
    const entries = this.listSessionMemory(sessionId, scope);
    const now = new Date();
    const halfLife = options?.halfLifeHours ?? 24;

    // Calculate decayed relevance for each entry
    const scored = entries.map((entry) => ({
      ...entry,
      decayedRelevance: this.calculateDecayedRelevance(entry, { halfLifeHours: halfLife, now })
    }));

    // Sort by decayed relevance descending
    scored.sort((a, b) => b.decayedRelevance - a.decayedRelevance);

    // Apply limit
    const limit = options?.limit;
    return limit ? scored.slice(0, limit) : scored;
  }
}
