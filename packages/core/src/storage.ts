import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SessionMemoryStore } from './stores/session-memory-store.js';
import { TaskStore } from './stores/task-store.js';
import type { CreateTaskInput } from './stores/task-store.js';
import { SelfHealStore } from './stores/self-heal-store.js';
import { MailStore } from './stores/mail-store.js';
import { ApprovalStore } from './stores/approval-store.js';
import { BackgroundJobStore } from './stores/background-job-store.js';
import { MiscStore } from './stores/misc-store.js';
import { SessionStore } from './stores/session-store.js';
import type { CreateSessionInput } from './stores/session-store.js';
import { ImageAssetStore } from './stores/image-asset-store.js';
import type {
  AgentSpec,
  ApprovalRecord,
  ApprovalStatus,
  BackgroundJobRecord,
  BackgroundJobStatus,
  ImageAssetRecord,
  MailRecord,
  MessageRole,
  SelfHealEventRecord,
  SelfHealRunRecord,
  SessionMessage,
  SessionRecord,
  TaskEvent,
  SessionMemoryEntry,
  TaskRecord,
  TaskStatus,
  WorkspaceRecord
} from './types.js';

// Re-export for backward compatibility
export type { CreateSessionInput } from './stores/session-store.js';

export class SqliteStateStore {
  readonly dbPath: string;
  readonly db: DatabaseSync;
  /** Extracted session-memory domain store (delegates to the same db). */
  readonly memory: SessionMemoryStore;
  /** Extracted task domain store (delegates to the same db). */
  readonly tasks: TaskStore;
  /** Extracted self-heal domain store (delegates to the same db). */
  readonly selfHeal: SelfHealStore;
  /** Extracted mail domain store (delegates to the same db). */
  readonly mail: MailStore;
  /** Extracted approval domain store (delegates to the same db). */
  readonly approvals: ApprovalStore;
  /** Extracted background-job domain store (delegates to the same db). */
  readonly jobs: BackgroundJobStore;
  /** Extracted misc domain store: agents, workspaces, scheduler-wake, daemon-control. */
  readonly misc: MiscStore;
  /** Extracted session + message domain store. */
  readonly sessions: SessionStore;
  /** Extracted image asset domain store. */
  readonly imageAssets: ImageAssetStore;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    if (!existsSync(dirname(dbPath))) {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.memory = new SessionMemoryStore(this.db);
    this.tasks = new TaskStore(this.db);
    this.selfHeal = new SelfHealStore(this.db);
    this.mail = new MailStore(this.db);
    this.approvals = new ApprovalStore(this.db);
    this.jobs = new BackgroundJobStore(this.db);
    this.misc = new MiscStore(this.db);
    this.sessions = new SessionStore(this.db);
    this.imageAssets = new ImageAssetStore(this.db);
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
    return this.misc.upsertAgent(agent);
  }

  listAgents(): AgentSpec[] {
    return this.misc.listAgents();
  }

  getAgent(id: string): AgentSpec | undefined {
    return this.misc.getAgent(id);
  }

  // ── Session + Message domain (delegated to SessionStore) ──

  createSession(input: CreateSessionInput): SessionRecord {
    return this.sessions.createSession(input);
  }

  listSessions(): SessionRecord[] {
    return this.sessions.listSessions();
  }

  getSession(id: string): SessionRecord | undefined {
    return this.sessions.getSession(id);
  }

  updateSession(
    sessionId: string,
    patch: Partial<Omit<SessionRecord, 'id' | 'createdAt'>>
  ): SessionRecord {
    return this.sessions.updateSession(sessionId, patch);
  }

  appendMessage(sessionId: string, role: MessageRole, parts: SessionMessage['parts']): SessionMessage {
    return this.sessions.appendMessage(sessionId, role, parts);
  }

  listMessages(sessionId: string): SessionMessage[] {
    return this.sessions.listMessages(sessionId);
  }

  // ── Image Asset domain (delegated to ImageAssetStore) ──

  createImageAsset(asset: ImageAssetRecord): ImageAssetRecord {
    return this.imageAssets.createImageAsset(asset);
  }

  getImageAsset(id: string): ImageAssetRecord | undefined {
    return this.imageAssets.getImageAsset(id);
  }

  listImageAssetsForSession(sessionId: string): ImageAssetRecord[] {
    return this.imageAssets.listImageAssetsForSession(sessionId);
  }

  updateImageAsset(
    id: string,
    patch: Partial<Pick<ImageAssetRecord, 'retentionTier' | 'lastAccessAt' | 'localRelPath' | 'sizeBytes' | 'mimeType'>>
  ): ImageAssetRecord {
    return this.imageAssets.updateImageAsset(id, patch);
  }

  deleteImageAsset(id: string): void {
    return this.imageAssets.deleteImageAsset(id);
  }

  // ── Task domain (delegated to TaskStore) ──

  createTask(input: CreateTaskInput): TaskRecord {
    return this.tasks.createTask(input);
  }

  listTasks(filter?: { status?: TaskStatus }): TaskRecord[] {
    return this.tasks.listTasks(filter);
  }

  listChildTasks(parentTaskId: string): TaskRecord[] {
    return this.tasks.listChildTasks(parentTaskId);
  }

  getTask(id: string): TaskRecord | undefined {
    return this.tasks.getTask(id);
  }

  updateTask(taskId: string, patch: Partial<Omit<TaskRecord, 'id' | 'createdAt'>>): TaskRecord {
    return this.tasks.updateTask(taskId, patch);
  }

  appendEvent(input: Omit<TaskEvent, 'id' | 'createdAt'> & { createdAt?: string }): TaskEvent {
    return this.tasks.appendEvent(input);
  }

  listEvents(taskId: string): TaskEvent[] {
    return this.tasks.listEvents(taskId);
  }

  createApproval(
    input: Omit<ApprovalRecord, 'id' | 'status' | 'createdAt' | 'updatedAt'> & { idempotencyKey?: string }
  ): ApprovalRecord {
    return this.approvals.createApproval(input);
  }

  listApprovals(filter?: { status?: ApprovalStatus }): ApprovalRecord[] {
    return this.approvals.listApprovals(filter);
  }

  getApproval(id: string): ApprovalRecord | undefined {
    return this.approvals.getApproval(id);
  }

  updateApproval(id: string, status: ApprovalStatus): ApprovalRecord {
    return this.approvals.updateApproval(id, status);
  }

  deleteApproval(id: string): void {
    return this.approvals.deleteApproval(id);
  }

  createWorkspace(workspace: WorkspaceRecord): WorkspaceRecord {
    return this.misc.createWorkspace(workspace);
  }

  listWorkspaces(): WorkspaceRecord[] {
    return this.misc.listWorkspaces();
  }

  getWorkspace(id: string): WorkspaceRecord | undefined {
    return this.misc.getWorkspace(id);
  }

  createMail(input: Omit<MailRecord, 'id' | 'status' | 'createdAt' | 'readAt'>): MailRecord {
    return this.mail.createMail(input);
  }

  listMailbox(agentId: string, onlyPending = false): MailRecord[] {
    return this.mail.listMailbox(agentId, onlyPending);
  }

  /** Recent mailbox rows for team visualization (newest first). */
  listAllMailbox(options?: { limit?: number }): MailRecord[] {
    return this.mail.listAllMailbox(options);
  }

  markMailRead(id: string): MailRecord {
    return this.mail.markMailRead(id);
  }

  createBackgroundJob(input: Omit<BackgroundJobRecord, 'id' | 'createdAt' | 'updatedAt'>): BackgroundJobRecord {
    return this.jobs.createBackgroundJob(input);
  }

  listBackgroundJobs(sessionId?: string): BackgroundJobRecord[] {
    return this.jobs.listBackgroundJobs(sessionId);
  }

  getBackgroundJob(id: string): BackgroundJobRecord | undefined {
    return this.jobs.getBackgroundJob(id);
  }

  // ── Session Memory (delegated to SessionMemoryStore) ──

  upsertSessionMemory(input: Parameters<SessionMemoryStore['upsertSessionMemory']>[0]): SessionMemoryEntry {
    return this.memory.upsertSessionMemory(input);
  }

  getSessionMemoryEntry(id: string): SessionMemoryEntry | undefined {
    return this.memory.getSessionMemoryEntry(id);
  }

  listSessionMemory(sessionId: string, scope?: SessionMemoryEntry['scope']): SessionMemoryEntry[] {
    return this.memory.listSessionMemory(sessionId, scope);
  }

  deleteSessionMemory(sessionId: string, scope: SessionMemoryEntry['scope'], key: string): boolean {
    return this.memory.deleteSessionMemory(sessionId, scope, key);
  }

  copySessionMemory(fromSessionId: string, toSessionId: string, scope: SessionMemoryEntry['scope']): number {
    return this.memory.copySessionMemory(fromSessionId, toSessionId, scope);
  }

  enqueueSchedulerWake(sessionId: string, reason: string): void {
    return this.misc.enqueueSchedulerWake(sessionId, reason);
  }

  /** Returns distinct session ids in FIFO order (by first enqueue time per id in this batch). */
  dequeueSchedulerWakes(limit = 32): string[] {
    return this.misc.dequeueSchedulerWakes(limit);
  }

  // ── Self-heal domain (delegated to SelfHealStore) ──

  createSelfHealRun(input: { policy: SelfHealRunRecord['policy'] }): SelfHealRunRecord {
    return this.selfHeal.createSelfHealRun(input);
  }

  getSelfHealRun(id: string): SelfHealRunRecord | undefined {
    return this.selfHeal.getSelfHealRun(id);
  }

  listSelfHealRuns(options?: { limit?: number }): SelfHealRunRecord[] {
    return this.selfHeal.listSelfHealRuns(options);
  }

  listActiveSelfHealRuns(): SelfHealRunRecord[] {
    return this.selfHeal.listActiveSelfHealRuns();
  }

  updateSelfHealRun(
    id: string,
    patch: Partial<
      Omit<SelfHealRunRecord, 'id' | 'createdAt' | 'policy'> & { policy?: SelfHealRunRecord['policy'] }
    >
  ): SelfHealRunRecord {
    return this.selfHeal.updateSelfHealRun(id, patch);
  }

  appendSelfHealEvent(input: { runId: string; kind: string; payload?: Record<string, unknown> }): SelfHealEventRecord {
    return this.selfHeal.appendSelfHealEvent(input);
  }

  listSelfHealEvents(runId: string, limit = 200): SelfHealEventRecord[] {
    return this.selfHeal.listSelfHealEvents(runId, limit);
  }

  setDaemonControl(key: string, value: unknown): void {
    return this.misc.setDaemonControl(key, value);
  }

  getDaemonControl<T>(key: string): T | undefined {
    return this.misc.getDaemonControl<T>(key);
  }

  deleteDaemonControl(key: string): void {
    return this.misc.deleteDaemonControl(key);
  }

  updateBackgroundJob(id: string, status: BackgroundJobStatus, result?: string): BackgroundJobRecord {
    return this.jobs.updateBackgroundJob(id, status, result);
  }

  touchSessionMemory(id: string): SessionMemoryEntry | undefined {
    return this.memory.touchSessionMemory(id);
  }

  listSessionMemoryByRelevance(
    sessionId: string,
    scope?: SessionMemoryEntry['scope'],
    limit?: number,
  ): SessionMemoryEntry[] {
    return this.memory.listSessionMemoryByRelevance(sessionId, scope, limit);
  }

  consolidateSessionMemory(
    sessionId: string,
    scope: SessionMemoryEntry['scope'],
    keys: string[],
    newKey: string,
    consolidatedValue: string,
    importance?: number,
  ): SessionMemoryEntry | undefined {
    return this.memory.consolidateSessionMemory(sessionId, scope, keys, newKey, consolidatedValue, importance);
  }

  calculateDecayedRelevance(
    entry: SessionMemoryEntry,
    options?: { halfLifeHours?: number; now?: Date },
  ): number {
    return this.memory.calculateDecayedRelevance(entry, options);
  }

  listSessionMemoryByDecayedRelevance(
    sessionId: string,
    scope?: SessionMemoryEntry['scope'],
    options?: { limit?: number; halfLifeHours?: number },
  ): Array<SessionMemoryEntry & { decayedRelevance: number }> {
    return this.memory.listSessionMemoryByDecayedRelevance(sessionId, scope, options);
  }
}
