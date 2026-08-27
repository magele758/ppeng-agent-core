/**
 * L5 runtime host façade: MCP / mailbox / approvals / scheduler / public API.
 * The session turn loop lives in `turn/kernel.ts` (`runSessionKernel`).
 */

import { join } from 'node:path';
import { createLogger } from './logger.js';
import { NotFoundError } from './errors.js';
import type { AgentSandbox } from './sandbox/agent-sandbox-types.js';
import { SelfHealScheduler } from './self-heal/self-heal-scheduler.js';
import { PromptBuilder } from './model/prompt-builder.js';
import type { ApprovalPolicy } from './approval/approval-policy.js';
import {
  loadPolicyFromRepo,
  mergeApprovalPolicies,
  type FileApprovalPolicy
} from './approval/policy-loader.js';
import {
  createExtensionRegistry,
  type ExtensionRegistry,
  type ExtensionSpec
} from './extensions/extension-registry.js';
import type { PermissionMode } from './approval/permission-mode.js';
import { runDoctor, formatDoctorReport, type DoctorReport } from './doctor/doctor.js';
import { CronJobStore } from './cron/cron-store.js';
import { builtinAgents } from './builtin-agents.js';
import { createModelAdapterFromEnv } from './model/model-adapters.js';
import { SqliteStateStore } from './storage.js';
import { readSessionTraceEvents } from './stores/read-traces.js';
import { appendTraceEvent } from './stores/trace.js';
import type { TraceEvent } from './stores/trace.js';
import { createBuiltinTools } from './tools/builtin-tools.js';
import type {
  AgentSpec,
  ApprovalRecord,
  DaemonRestartRequest,
  MailRecord,
  ModelAdapter,
  ModelStreamChunk,
  SelfHealEventRecord,
  SelfHealPolicy,
  SelfHealRunRecord,
  SessionMessage,
  SessionRecord,
  ImageAssetRecord,
  SkillSpec,
  TaskRecord,
  ToolContract
} from './types.js';
import type { ApiSocialPostScheduleItem } from './api-types.js';
import { type SocialPostDeliverFn } from './social-schedule.js';
import { SocialScheduleService, type SocialScheduleAction } from './services/social-schedule-service.js';
import { AutonomousScheduler } from './services/autonomous-scheduler.js';
import { SwarmExecutor } from './swarm/executor.js';
import { loadRuntimeEnvConfig } from './runtime-env.js';
import { OrchestrationEngine } from './orchestrator/engine.js';
import { ResearchPipeline } from './deepresearch/pipeline.js';
import { ImageIngestService } from './services/image-ingest-service.js';
import { WorkspaceManager } from './workspaces.js';
import { McpManager } from './mcp/mcp-manager.js';
import { discoverPlugins, mergePlugins, pluginDirsFromEnv } from './plugins/plugin-loader.js';
import type { AssetStorage, EventBufferRepository } from './storage/interfaces.js';
import { defaultTenantIdFromEnv, defaultUserIdFromEnv } from './storage/provider-config.js';
import { AgentLoopHandle, type AgentLoopLatch } from './runtime/agent-loop.js';
import type { EnqueueSteerOptions } from './session/step-inbox.js';
import type { SteerAck } from './session/steer-ack.js';
import { type SteerDrainPolicy } from './session/steer-drain.js';
import { runSessionKernel } from './turn/kernel.js';
import { assembleOptionalTools } from './runtime/tool-assembly.js';
import {
  approve as approveDecision,
  createChatSession as createChatSessionFn,
  createTaskSession as createTaskSessionFn,
  createTeammateSession as createTeammateSessionFn,
  enqueueSteer as enqueueSteerFn,
  getLatestAssistantText as latestAssistantText,
  getPermissionMode as getPermissionModeFn,
  mergeSessionMetadata as mergeSessionMetadataFn,
  sendMailboxMessage as sendMailboxMessageFn,
  sendUserMessage as sendUserMessageFn,
  setPermissionMode as setPermissionModeFn
} from './runtime/session-facade.js';
import {
  runScheduler as runSchedulerFn,
  tickCronJobs as tickCronJobsFn
} from './runtime/scheduler-host.js';
import { cancelSession as cancelSessionFn, destroyRuntime } from './runtime/session-control.js';
import { ensureWorkspaceRoot as ensureWorkspaceRootFn } from './runtime/spawn-host.js';
import { createRuntimeCollaborators } from './runtime/collaborators.js';
import {
  bindTurnKernelHost,
  createRuntimeToolServices,
  schedulerFrom,
  sessionFacadeFrom,
  spawnFrom,
  type L5Bindable
} from './runtime/l5-bindings.js';

export interface RuntimeOptions {
  repoRoot: string;
  stateDir: string;
  modelAdapter?: ModelAdapter;
  agents?: AgentSpec[];
  tools?: ToolContract<any>[];
  /**
   * Append on top of `builtinAgents` (or the explicit `agents` list) without
   * replacing them. Use this to mount domain personas alongside the core.
   */
  extraAgents?: AgentSpec[];
  /**
   * Append on top of the builtin tool set (or the explicit `tools` list)
   * without replacing it. Used to mount domain-specific tools.
   */
  extraTools?: ToolContract<any>[];
  /**
   * Append on top of the discovered SkillSpecs (workspace + ~/.agents).
   * Used by domain bundles to ship runbooks alongside the core agent.
   */
  extraSkills?: SkillSpec[];
  /** Optional PG-backed trace/event buffer (multi-replica daemon). */
  eventBufferRepository?: EventBufferRepository;
  /** Optional cloud catalog skills merged after workspace/~.agents discovery. */
  cloudSkillsLoader?: () => Promise<SkillSpec[]>;
  /** Optional tiered asset store (emptyDir hot + MinIO cold). */
  tieredAssetStorage?: AssetStorage;
  /** Max tool calls executed in parallel when none need approval (default 8). */
  maxParallelToolCalls?: number;
  /** In-process extension handlers (pi-style phases). */
  extensions?: ExtensionSpec[];
}

export class RawAgentRuntime {
  private readonly log = createLogger('runtime');
  readonly repoRoot: string;
  readonly stateDir: string;
  readonly store: SqliteStateStore;
  /** Optional L2/L3 asset facade when `ASSET_STORAGE_PROVIDER=tiered`. */
  readonly tieredAssetStorage?: AssetStorage;
  readonly workspaceManager: WorkspaceManager;
  readonly modelAdapter: ModelAdapter;
  readonly selfHeal: SelfHealScheduler;
  readonly promptBuilder: PromptBuilder;
  tools: ToolContract<any>[];

  private readonly maxParallelToolCalls: number;
  private readonly maxTurnsPerRun: number;
  /** AbortControllers for sandbox-managed background jobs (only path actually used; legacy spawn-tracker removed). */
  private readonly backgroundJobAborts = new Map<string, AbortController>();
  private sandbox: AgentSandbox | undefined;
  private readonly sessionAbortControllers = new Map<string, AbortController>();
  /** Tracks sessions currently in runSession() to prevent concurrent runs on the same session. */
  private readonly runningSessions = new Map<string, Promise<SessionRecord>>();
  /**
   * Last turn's system-prompt size and tool count per session, used to derive the
   * history token budget. Populated after the first turn assembles its prompt;
   * before that the budget falls back to the input-free defaults.
   */
  private readonly turnShapeBySession = new Map<
    string,
    { systemPromptChars: number; toolCount: number }
  >();
  /**
   * Sticky cumulative-input-token detector: some gateways report prompt_tokens as a
   * running total. We remember the last cumulative value so we can split it.
   */
  private readonly cumulativeInputTokensBySession = new Map<
    string,
    { cumulative: number; sticky: boolean }
  >();
  private readonly envApprovalPolicy: ApprovalPolicy | undefined;
  private readonly mcpManager: McpManager;
  private filePolicyCache: FileApprovalPolicy | undefined | null = null;
  private readonly socialSchedule: SocialScheduleService;
  private readonly autonomousScheduler: AutonomousScheduler;
  private readonly swarmExecutor: SwarmExecutor;
  private readonly orchestrationEngine: OrchestrationEngine;
  private readonly imageIngest: ImageIngestService;
  private cronStore: CronJobStore | undefined;
  private readonly extensionRegistry: ExtensionRegistry;
  private readonly traceCloudOptions: {
    eventBuffer: EventBufferRepository;
    tenantId: string;
    userId: string;
  } | undefined;

  constructor(options: RuntimeOptions) {
    this.repoRoot = options.repoRoot;
    this.stateDir = options.stateDir;
    this.tieredAssetStorage = options.tieredAssetStorage;
    this.traceCloudOptions = options.eventBufferRepository
      ? {
          eventBuffer: options.eventBufferRepository,
          tenantId: defaultTenantIdFromEnv(process.env),
          userId: defaultUserIdFromEnv(process.env),
        }
      : undefined;
    this.store = new SqliteStateStore(join(this.stateDir, 'runtime.sqlite'));
    this.workspaceManager = new WorkspaceManager(join(this.stateDir, 'workspaces'), this.repoRoot);
    this.modelAdapter = options.modelAdapter ?? createModelAdapterFromEnv(process.env);
    const runtimeEnv = loadRuntimeEnvConfig(process.env);
    this.maxParallelToolCalls = options.maxParallelToolCalls ?? runtimeEnv.maxParallelToolCalls;
    this.maxTurnsPerRun = runtimeEnv.maxTurnsPerRun;
    this.envApprovalPolicy = runtimeEnv.approvalPolicy;
    this.extensionRegistry = createExtensionRegistry(options.extensions);

    const discoveredPlugins = discoverPlugins(pluginDirsFromEnv(process.env));
    const mergedPlugins = mergePlugins(discoveredPlugins);
    for (const [k, v] of Object.entries(mergedPlugins.hookEnv)) {
      if (!process.env[k]?.trim()) process.env[k] = v;
    }

    this.promptBuilder = new PromptBuilder({
      store: this.store,
      repoRoot: this.repoRoot,
      extraSkills: [...(options.extraSkills ?? []), ...mergedPlugins.skills],
      cloudSkillsLoader: options.cloudSkillsLoader,
    });

    const collab = createRuntimeCollaborators({
      store: this.store,
      repoRoot: this.repoRoot,
      stateDir: this.stateDir,
      log: this.log,
      createTaskSession: (input) => this.createTaskSession(input),
      createTeammateSession: (input) => this.createTeammateSession(input),
      runSession: (sid) => this.runSession(sid).then(() => {}),
      bindWorkspaceForTask: (tid) => this.bindWorkspaceForTask(tid),
      spawnHost: () => spawnFrom(this.l5())
    });
    this.selfHeal = collab.selfHeal;
    this.socialSchedule = collab.socialSchedule;
    this.autonomousScheduler = collab.autonomousScheduler;
    this.swarmExecutor = collab.swarmExecutor;
    this.orchestrationEngine = collab.orchestrationEngine;
    this.imageIngest = collab.imageIngest;

    for (const agent of options.agents ?? builtinAgents) {
      this.store.upsertAgent(agent);
    }
    for (const agent of options.extraAgents ?? []) {
      this.store.upsertAgent(agent);
    }
    for (const agent of mergedPlugins.agents) {
      this.store.upsertAgent(agent);
    }

    const baseTools = options.tools ?? createBuiltinTools(createRuntimeToolServices(this.l5()));
    const optionalExtras = assembleOptionalTools({
      env: process.env,
      store: this.store,
      stateDir: this.stateDir,
      getCronStore: () => {
        if (!this.cronStore) this.cronStore = new CronJobStore(this.stateDir);
        return this.cronStore;
      }
    });
    this.tools = [...baseTools, ...optionalExtras, ...(options.extraTools ?? [])];
    this.mcpManager = new McpManager({ stateDir: this.stateDir, tools: this.tools, env: process.env, log: this.log });
  }

  /** Tick due cron jobs: append prompt to owning session and enqueue a run. */
  async tickCronJobs(): Promise<number> {
    return tickCronJobsFn(schedulerFrom(this.l5()));
  }

  /** Abort in-flight model/tool work for a session (best-effort). Closes any open tool wave. */
  cancelSession(sessionId: string): void {
    cancelSessionFn({
      store: this.store,
      sessionAbortControllers: this.sessionAbortControllers,
      backgroundJobAborts: this.backgroundJobAborts,
      emitTrace: (id, event) => this.emitTrace(id, event)
    }, sessionId);
  }

  listAgents(): AgentSpec[] {
    return this.store.listAgents();
  }

  /**
   * Upsert 当前包内的内置 Agent 列表（幂等）。升级后若 SQLite 里缺新 id，调一次即可补齐；
   * daemon 在 GET /api/agents 前会调用，避免只编了 apps/daemon、未重编 core 时长期缺条目。
   */
  ensureBuiltinAgentsSynced(): void {
    for (const agent of builtinAgents) {
      this.store.upsertAgent(agent);
    }
  }

  /** Re-scan repo skills/ 与 ~/.agents 下的 SKILL.md（合并；同名时 ~/.agents 覆盖）。 */
  reloadWorkspaceSkills(): Promise<SkillSpec[]> {
    this.promptBuilder.invalidateSkillsCache();
    this.filePolicyCache = null;
    return this.promptBuilder.allSkills();
  }

  /** 列出当前加载的所有技能（用于 HTTP /api/skills 展示）。 */
  listSkills(): Promise<SkillSpec[]> {
    return this.promptBuilder.allSkills();
  }

  /**
   * Process-local monotonic version of mutable state. Daemon emits this as
   * `ETag: W/"<n>"` on poll-friendly list endpoints so the web-console can
   * short-circuit unchanged refreshes with HTTP 304.
   */
  getStateVersion(): number {
    return this.store.stateVersion;
  }

  listSessions(): SessionRecord[] {
    return this.store.listSessions();
  }

  getSession(sessionId: string): SessionRecord | undefined {
    return this.store.getSession(sessionId);
  }

  getSessionMessages(sessionId: string): SessionMessage[] {
    return this.store.listMessages(sessionId);
  }

  /** Shallow-merge keys into session.metadata (daemon PATCH / UI toggles). */
  mergeSessionMetadata(sessionId: string, patch: Record<string, unknown>): SessionRecord {
    return mergeSessionMetadataFn(this.store, sessionId, patch);
  }

  /** Current effective permission mode for a session. */
  getPermissionMode(sessionId: string): PermissionMode {
    return getPermissionModeFn(this.store, sessionId);
  }

  /**
   * Set or shift session permissionMode (Lab temporary elevate/demote).
   * Returns previous + next mode with human-readable descriptions.
   */
  setPermissionMode(
    sessionId: string,
    input: { mode?: PermissionMode | string; shift?: 'elevate' | 'demote' }
  ): {
    sessionId: string;
    previous: PermissionMode;
    mode: PermissionMode;
    description: string;
  } {
    return setPermissionModeFn(this.store, sessionId, input);
  }

  registerExtension(ext: ExtensionSpec): void {
    this.extensionRegistry.register(ext);
  }

  listExtensions(): Array<{ id: string; name?: string; phases: string[] }> {
    return this.extensionRegistry.list();
  }

  runDoctorCheck(): DoctorReport {
    return runDoctor({ repoRoot: this.repoRoot, stateDir: this.stateDir });
  }

  formatDoctorCheck(): string {
    return formatDoctorReport(this.runDoctorCheck());
  }

  listTasks(status?: TaskRecord['status']): TaskRecord[] {
    return this.store.listTasks(status ? { status } : undefined);
  }

  getTask(taskId: string): TaskRecord | undefined {
    return this.store.getTask(taskId);
  }

  listSocialPostScheduleSummaries(): ApiSocialPostScheduleItem[] {
    return this.socialSchedule.list();
  }

  applySocialPostScheduleAction(taskId: string, action: SocialScheduleAction): TaskRecord {
    return this.socialSchedule.applyAction(taskId, action);
  }

  async dispatchSocialPostScheduleNow(taskId: string, deliver: SocialPostDeliverFn): Promise<TaskRecord> {
    return this.socialSchedule.dispatchNow(taskId, deliver);
  }

  getTaskEvents(taskId: string) {
    return this.store.listEvents(taskId);
  }

  listApprovals(status?: ApprovalRecord['status']): ApprovalRecord[] {
    return this.store.listApprovals(status ? { status } : undefined);
  }

  listWorkspaces() {
    return this.store.listWorkspaces();
  }

  listBackgroundJobs(sessionId?: string) {
    return this.store.listBackgroundJobs(sessionId);
  }

  listMailbox(agentId: string, onlyPending = false): MailRecord[] {
    return this.store.listMailbox(agentId, onlyPending);
  }

  listAllMailbox(limit?: number): MailRecord[] {
    return this.store.listAllMailbox({ limit });
  }

  /** Pending inter-agent mail grouped by recipient agent id (dashboards / team-overview). */
  countPendingMailboxByRecipient(): { total: number; byRecipientAgentId: Record<string, number> } {
    return this.store.countPendingMailboxByRecipient();
  }

  async listTraceEvents(sessionId: string, limit?: number): Promise<TraceEvent[]> {
    return readSessionTraceEvents(this.stateDir, sessionId, limit ?? 500);
  }

  createChatSession(input: {
    title?: string;
    message?: string;
    imageAssetIds?: string[];
    agentId?: string;
    background?: boolean;
    metadata?: Record<string, unknown>;
  }): SessionRecord {
    return createChatSessionFn(sessionFacadeFrom(this.l5()), input);
  }

  createTaskSession(input: {
    title: string;
    description?: string;
    message?: string;
    imageAssetIds?: string[];
    agentId?: string;
    blockedBy?: string[];
    background?: boolean;
    metadata?: Record<string, unknown>;
  }): { task: TaskRecord; session: SessionRecord } {
    return createTaskSessionFn(sessionFacadeFrom(this.l5()), input);
  }

  createTeammateSession(input: {
    name: string;
    role: string;
    prompt: string;
    taskId?: string;
    parentSessionId?: string;
    background?: boolean;
    metadata?: Record<string, unknown>;
  }): SessionRecord {
    return createTeammateSessionFn(sessionFacadeFrom(this.l5()), input);
  }

  sendUserMessage(sessionId: string, message: string, options?: { imageAssetIds?: string[] }): SessionRecord {
    return sendUserMessageFn(sessionFacadeFrom(this.l5()), sessionId, message, options);
  }

  enqueueSteer(sessionId: string, text: string, opts?: EnqueueSteerOptions): SteerAck {
    return enqueueSteerFn(this.store, sessionId, text, opts);
  }

  createAgentLoop(
    sessionId: string,
    options?: { steerDrainPolicy?: SteerDrainPolicy }
  ): AgentLoopHandle {
    if (!this.store.getSession(sessionId)) {
      throw new NotFoundError('Session', sessionId);
    }
    return new AgentLoopHandle(
      {
        getSession: (id) => this.getSession(id),
        foldMessages: (id) => this.store.foldMessages(id),
        enqueueSteer: (id, text, opts) => this.enqueueSteer(id, text, opts),
        abortSession: (id) => this.cancelSession(id),
        startRun: (id, latch, opts) =>
          this.runSession(id, {
            onModelStreamChunk: opts?.onModelStreamChunk as ((chunk: ModelStreamChunk) => void) | undefined,
            latch,
            steerDrainPolicy: opts?.steerDrainPolicy
          })
      },
      sessionId,
      options
    );
  }

  /** Ingest base64 image bytes into session image store. */
  async ingestImageBase64(
    sessionId: string,
    input: { dataBase64: string; mimeType: string; sourceUrl?: string }
  ): Promise<ImageAssetRecord> {
    return this.imageIngest.ingestBase64(sessionId, input);
  }

  /** Download image from URL into session store (server-side fetch). */
  async ingestImageFromUrl(sessionId: string, imageUrl: string, signal?: AbortSignal): Promise<ImageAssetRecord> {
    return this.imageIngest.ingestFromUrl(sessionId, imageUrl, signal);
  }

  sendMailboxMessage(input: {
    fromAgentId: string;
    toAgentId: string;
    content: string;
    type?: string;
    correlationId?: string;
    sessionId?: string;
    taskId?: string;
  }): MailRecord {
    return sendMailboxMessageFn(sessionFacadeFrom(this.l5()), input);
  }

  getLatestAssistantText(sessionId: string): string | undefined {
    return latestAssistantText(this.store, sessionId);
  }

  async approve(approvalId: string, decision: 'approved' | 'rejected'): Promise<ApprovalRecord> {
    return approveDecision(this.store, approvalId, decision);
  }

  async runScheduler(): Promise<void> {
    await runSchedulerFn(schedulerFrom(this.l5()));
  }

  runResearchTask(taskId: string) {
    return new ResearchPipeline({
      store: this.store.research(),
      stateDir: this.stateDir,
      env: process.env
    }).runTask(taskId);
  }

  startSwarmRun(
    runId: string,
    seedTasks?: Array<{ title: string; description?: string; requiredRole?: string; blockedBy?: string[] }>
  ) {
    return this.swarmExecutor.startRun(
      runId,
      seedTasks?.map((t) => ({
        ...t,
        requiredRole: t.requiredRole as import('./swarm/types.js').SwarmRole | undefined
      }))
    );
  }

  startSelfHealRun(policy?: Partial<SelfHealPolicy>): SelfHealRunRecord {
    return this.selfHeal.startRun(policy);
  }

  stopSelfHealRun(id: string): SelfHealRunRecord {
    return this.selfHeal.stopRun(id);
  }

  resumeSelfHealRun(id: string): SelfHealRunRecord {
    return this.selfHeal.resumeRun(id);
  }

  getSelfHealRun(id: string): SelfHealRunRecord | undefined {
    return this.selfHeal.getRun(id);
  }

  listSelfHealRuns(limit?: number): SelfHealRunRecord[] {
    return this.selfHeal.listRuns(limit);
  }

  listActiveSelfHealRuns(): SelfHealRunRecord[] {
    return this.selfHeal.listActiveRuns();
  }

  listSelfHealEvents(runId: string, limit?: number): SelfHealEventRecord[] {
    return this.selfHeal.listEvents(runId, limit);
  }

  getDaemonRestartRequest(): DaemonRestartRequest | undefined {
    return this.selfHeal.getDaemonRestartRequest();
  }

  acknowledgeDaemonRestart(): void {
    this.selfHeal.acknowledgeDaemonRestart();
  }

  /** Ensure task workspace exists; returns workspace root. */
  async bindWorkspaceForTask(taskId: string): Promise<string | undefined> {
    const task = this.store.getTask(taskId);
    if (!task?.sessionId) {
      return undefined;
    }
    const session = this.store.getSession(task.sessionId);
    if (!session) {
      return undefined;
    }
    return ensureWorkspaceRootFn(spawnFrom(this.l5()), session, task);
  }

  async runSession(
    sessionId: string,
    options?: {
      onModelStreamChunk?: (chunk: ModelStreamChunk) => void;
      latch?: AgentLoopLatch;
      steerDrainPolicy?: SteerDrainPolicy;
    }
  ): Promise<SessionRecord> {
    const existing = this.runningSessions.get(sessionId);
    if (existing && !options?.latch) return existing;
    if (existing && options?.latch) {
      await existing.catch(() => undefined);
    }

    const promise = runSessionKernel(bindTurnKernelHost(this.l5()), sessionId, options).finally(() => {
      this.runningSessions.delete(sessionId);
    });
    this.runningSessions.set(sessionId, promise);
    return promise;
  }

  /** Gracefully shut down all in-flight work, MCP sessions, and release SQLite. */
  async destroy(): Promise<void> {
    await destroyRuntime({
      sessionAbortControllers: this.sessionAbortControllers,
      backgroundJobAborts: this.backgroundJobAborts,
      mcpManager: this.mcpManager,
      store: this.store
    });
  }

  /** Trace JSONL on disk; optional PG fan-out when `EVENT_BUFFER_PROVIDER=redis_postgres`. */
  private emitTrace(sessionId: string, event: Omit<TraceEvent, 'ts' | 'sessionId'>): void {
    void appendTraceEvent(this.stateDir, sessionId, event, this.traceCloudOptions);
  }

  private async mergedFilePolicy(): Promise<FileApprovalPolicy | undefined> {
    if (this.filePolicyCache === null) {
      const file = await loadPolicyFromRepo(this.repoRoot);
      this.filePolicyCache = mergeApprovalPolicies(file, this.envApprovalPolicy) ?? undefined;
    }
    return this.filePolicyCache;
  }

  private l5(): L5Bindable {
    return {
      store: this.store,
      repoRoot: this.repoRoot,
      stateDir: this.stateDir,
      tools: this.tools,
      modelAdapter: this.modelAdapter,
      promptBuilder: this.promptBuilder,
      mcpManager: this.mcpManager,
      extensionRegistry: this.extensionRegistry,
      maxTurnsPerRun: this.maxTurnsPerRun,
      maxParallelToolCalls: this.maxParallelToolCalls,
      envApprovalPolicy: this.envApprovalPolicy,
      turnShapeBySession: this.turnShapeBySession,
      cumulativeInputTokensBySession: this.cumulativeInputTokensBySession,
      sessionAbortControllers: this.sessionAbortControllers,
      workspaceManager: this.workspaceManager,
      sandbox: this.sandbox,
      setSandbox: (sandbox) => {
        this.sandbox = sandbox;
      },
      backgroundJobAborts: this.backgroundJobAborts,
      cronStore: this.cronStore,
      setCronStore: (store) => {
        this.cronStore = store;
      },
      selfHeal: this.selfHeal,
      swarmExecutor: this.swarmExecutor,
      orchestrationEngine: this.orchestrationEngine,
      autonomousScheduler: this.autonomousScheduler,
      imageIngest: this.imageIngest,
      log: this.log,
      emitTrace: (sessionId, event) => this.emitTrace(sessionId, event),
      mergeSessionMetadata: (sessionId, patch) => this.mergeSessionMetadata(sessionId, patch),
      mergedFilePolicy: () => this.mergedFilePolicy(),
      runSession: (sessionId) => this.runSession(sessionId)
    };
  }
}
