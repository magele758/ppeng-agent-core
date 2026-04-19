import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
// IMPORTANT: side-effect import — must run before `node:sqlite` is loaded so
// the experimental warning listener is in place when DatabaseSync emits it.
import './silence-sqlite-warning.js';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from './stores/migrations/index.js';
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
  /**
   * Monotonic version counter bumped on every state-mutating call. Used by
   * the daemon to emit `ETag: W/"<version>"` on list endpoints so the
   * web-console can short-circuit unchanged polls with HTTP 304.
   *
   * Zero on a fresh DB; lifecycle is in-memory (process-local) — clients only
   * need to compare two consecutive responses, not survive restarts.
   */
  private _stateVersion = 0;
  private readonly memory: SessionMemoryStore;
  private readonly tasks: TaskStore;
  private readonly selfHeal: SelfHealStore;
  private readonly mail: MailStore;
  private readonly approvals: ApprovalStore;
  private readonly jobs: BackgroundJobStore;
  private readonly misc: MiscStore;
  private readonly sessions: SessionStore;
  private readonly imageAssets: ImageAssetStore;

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
    // Connection-level pragmas (must precede the first table touch):
    //   - WAL: better concurrency for read+write mix.
    //   - synchronous=NORMAL: safe under WAL, ~30-50% faster writes than FULL.
    //   - temp_store=MEMORY: small temp tables/indexes stay off-disk.
    //   - mmap_size=128MB: page cache fits the typical agent state file.
    //   - busy_timeout=5000: retry briefly when another writer holds the lock
    //     (avoids the bare `SQLITE_BUSY: database is locked` errors that bite
    //     concurrent test runs).
    //   - foreign_keys=ON: opt-in now so future schemas with FKs are enforced.
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
      PRAGMA mmap_size = 134217728;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;

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
    // Tables that were historically created inside the ad-hoc migrate step
    // (image_assets, session_memory, scheduler_wake, self_heal_*, daemon_control)
    // are still part of the baseline so a fresh DB has them on startup; the
    // versioned migration framework then layers later schema changes on top.
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
    // Versioned migrations (idempotent; each runs in its own transaction).
    applyMigrations(this.db);
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
    this.misc.upsertAgent(agent);
    this.bumpVersion();
  }

  listAgents(): AgentSpec[] {
    return this.misc.listAgents();
  }

  getAgent(id: string): AgentSpec | undefined {
    return this.misc.getAgent(id);
  }

  /** Current write-version. Equality across two reads ⇒ no state changes between. */
  get stateVersion(): number {
    return this._stateVersion;
  }

  private bumpVersion(): void {
    this._stateVersion += 1;
  }

  // ── Session + Message domain (delegated to SessionStore) ──

  createSession(input: CreateSessionInput): SessionRecord {
    const r = this.sessions.createSession(input);
    this.bumpVersion();
    return r;
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
    const r = this.sessions.updateSession(sessionId, patch);
    this.bumpVersion();
    return r;
  }

  appendMessage(sessionId: string, role: MessageRole, parts: SessionMessage['parts']): SessionMessage {
    const r = this.sessions.appendMessage(sessionId, role, parts);
    this.bumpVersion();
    return r;
  }

  listMessages(sessionId: string): SessionMessage[] {
    return this.sessions.listMessages(sessionId);
  }

  // ── Image Asset domain (delegated to ImageAssetStore) ──

  createImageAsset(asset: ImageAssetRecord): ImageAssetRecord {
    const r = this.imageAssets.createImageAsset(asset);
    this.bumpVersion();
    return r;
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
    const r = this.imageAssets.updateImageAsset(id, patch);
    this.bumpVersion();
    return r;
  }

  deleteImageAsset(id: string): void {
    this.imageAssets.deleteImageAsset(id);
    this.bumpVersion();
  }

  // ── Task domain (delegated to TaskStore) ──

  createTask(input: CreateTaskInput): TaskRecord {
    const r = this.tasks.createTask(input);
    this.bumpVersion();
    return r;
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
    const r = this.tasks.updateTask(taskId, patch);
    this.bumpVersion();
    return r;
  }

  appendEvent(input: Omit<TaskEvent, 'id' | 'createdAt'> & { createdAt?: string }): TaskEvent {
    const r = this.tasks.appendEvent(input);
    this.bumpVersion();
    return r;
  }

  listEvents(taskId: string): TaskEvent[] {
    return this.tasks.listEvents(taskId);
  }

  createApproval(
    input: Omit<ApprovalRecord, 'id' | 'status' | 'createdAt' | 'updatedAt'> & { idempotencyKey?: string }
  ): ApprovalRecord {
    const r = this.approvals.createApproval(input);
    this.bumpVersion();
    return r;
  }

  listApprovals(filter?: { status?: ApprovalStatus }): ApprovalRecord[] {
    return this.approvals.listApprovals(filter);
  }

  getApproval(id: string): ApprovalRecord | undefined {
    return this.approvals.getApproval(id);
  }

  updateApproval(id: string, status: ApprovalStatus): ApprovalRecord {
    const r = this.approvals.updateApproval(id, status);
    this.bumpVersion();
    return r;
  }

  deleteApproval(id: string): void {
    this.approvals.deleteApproval(id);
    this.bumpVersion();
  }

  createWorkspace(workspace: WorkspaceRecord): WorkspaceRecord {
    const r = this.misc.createWorkspace(workspace);
    this.bumpVersion();
    return r;
  }

  listWorkspaces(): WorkspaceRecord[] {
    return this.misc.listWorkspaces();
  }

  getWorkspace(id: string): WorkspaceRecord | undefined {
    return this.misc.getWorkspace(id);
  }

  createMail(input: Omit<MailRecord, 'id' | 'status' | 'createdAt' | 'readAt'>): MailRecord {
    const r = this.mail.createMail(input);
    this.bumpVersion();
    return r;
  }

  listMailbox(agentId: string, onlyPending = false): MailRecord[] {
    return this.mail.listMailbox(agentId, onlyPending);
  }

  /** Recent mailbox rows for team visualization (newest first). */
  listAllMailbox(options?: { limit?: number }): MailRecord[] {
    return this.mail.listAllMailbox(options);
  }

  markMailRead(id: string): MailRecord {
    const r = this.mail.markMailRead(id);
    this.bumpVersion();
    return r;
  }

  createBackgroundJob(input: Omit<BackgroundJobRecord, 'id' | 'createdAt' | 'updatedAt'>): BackgroundJobRecord {
    const r = this.jobs.createBackgroundJob(input);
    this.bumpVersion();
    return r;
  }

  listBackgroundJobs(sessionId?: string): BackgroundJobRecord[] {
    return this.jobs.listBackgroundJobs(sessionId);
  }

  getBackgroundJob(id: string): BackgroundJobRecord | undefined {
    return this.jobs.getBackgroundJob(id);
  }

  // ── Session Memory (delegated to SessionMemoryStore) ──

  upsertSessionMemory(input: Parameters<SessionMemoryStore['upsertSessionMemory']>[0]): SessionMemoryEntry {
    const r = this.memory.upsertSessionMemory(input);
    this.bumpVersion();
    return r;
  }

  getSessionMemoryEntry(id: string): SessionMemoryEntry | undefined {
    return this.memory.getSessionMemoryEntry(id);
  }

  listSessionMemory(sessionId: string, scope?: SessionMemoryEntry['scope']): SessionMemoryEntry[] {
    return this.memory.listSessionMemory(sessionId, scope);
  }

  deleteSessionMemory(sessionId: string, scope: SessionMemoryEntry['scope'], key: string): boolean {
    const r = this.memory.deleteSessionMemory(sessionId, scope, key);
    this.bumpVersion();
    return r;
  }

  copySessionMemory(fromSessionId: string, toSessionId: string, scope: SessionMemoryEntry['scope']): number {
    const r = this.memory.copySessionMemory(fromSessionId, toSessionId, scope);
    this.bumpVersion();
    return r;
  }

  enqueueSchedulerWake(sessionId: string, reason: string): void {
    this.misc.enqueueSchedulerWake(sessionId, reason);
    this.bumpVersion();
  }

  /** Returns distinct session ids in FIFO order (by first enqueue time per id in this batch). */
  dequeueSchedulerWakes(limit = 32): string[] {
    return this.misc.dequeueSchedulerWakes(limit);
  }

  // ── Self-heal domain (delegated to SelfHealStore) ──

  createSelfHealRun(input: { policy: SelfHealRunRecord['policy'] }): SelfHealRunRecord {
    const r = this.selfHeal.createSelfHealRun(input);
    this.bumpVersion();
    return r;
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
    const r = this.selfHeal.updateSelfHealRun(id, patch);
    this.bumpVersion();
    return r;
  }

  appendSelfHealEvent(input: { runId: string; kind: string; payload?: Record<string, unknown> }): SelfHealEventRecord {
    const r = this.selfHeal.appendSelfHealEvent(input);
    this.bumpVersion();
    return r;
  }

  listSelfHealEvents(runId: string, limit = 200): SelfHealEventRecord[] {
    return this.selfHeal.listSelfHealEvents(runId, limit);
  }

  setDaemonControl(key: string, value: unknown): void {
    this.misc.setDaemonControl(key, value);
    this.bumpVersion();
  }

  getDaemonControl<T>(key: string): T | undefined {
    return this.misc.getDaemonControl<T>(key);
  }

  deleteDaemonControl(key: string): void {
    this.misc.deleteDaemonControl(key);
    this.bumpVersion();
  }

  updateBackgroundJob(id: string, status: BackgroundJobStatus, result?: string): BackgroundJobRecord {
    const r = this.jobs.updateBackgroundJob(id, status, result);
    this.bumpVersion();
    return r;
  }

  touchSessionMemory(id: string): SessionMemoryEntry | undefined {
    const r = this.memory.touchSessionMemory(id);
    this.bumpVersion();
    return r;
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
    const r = this.memory.consolidateSessionMemory(sessionId, scope, keys, newKey, consolidatedValue, importance);
    this.bumpVersion();
    return r;
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
