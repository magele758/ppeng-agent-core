import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from './id.js';
import type {
  AgentSpec,
  ApprovalRecord,
  ApprovalStatus,
  BackgroundJobRecord,
  BackgroundJobStatus,
  MailRecord,
  MailStatus,
  MessageRole,
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
    `);
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

    const next: TaskRecord = {
      ...existing,
      ...patch,
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
  }): SessionMemoryEntry {
    const now = nowIso();
    const existing = this.db
      .prepare(`SELECT id FROM session_memory WHERE session_id = ? AND scope = ? AND key = ?`)
      .get(input.sessionId, input.scope, input.key) as { id: string } | undefined;

    const metadata = input.metadata ?? {};
    if (existing) {
      this.db
        .prepare(
          `UPDATE session_memory SET value = ?, metadata_json = ?, updated_at = ? WHERE session_id = ? AND scope = ? AND key = ?`
        )
        .run(input.value, serializeJson(metadata), now, input.sessionId, input.scope, input.key);
      return this.getSessionMemoryEntry(existing.id) as SessionMemoryEntry;
    }

    const entry: SessionMemoryEntry = {
      id: createId('mem'),
      sessionId: input.sessionId,
      scope: input.scope,
      key: input.key,
      value: input.value,
      metadata,
      updatedAt: now
    };

    this.db
      .prepare(
        `INSERT INTO session_memory (id, session_id, scope, key, value, metadata_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(entry.id, entry.sessionId, entry.scope, entry.key, entry.value, serializeJson(entry.metadata), entry.updatedAt);

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
        metadata: row.metadata
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
      updatedAt: String(row.updated_at)
    };
  }
}
