import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from './logger.js';
import { NotFoundError, ValidationError } from './errors.js';
import { createAgentSandboxFromEnv } from './sandbox/create-agent-sandbox.js';
import type { AgentSandbox } from './sandbox/agent-sandbox-types.js';
import { SelfHealScheduler, type SelfHealContext } from './self-heal/self-heal-scheduler.js';
import { PromptBuilder, type PromptContext } from './model/prompt-builder.js';
import {
  parseApprovalPolicyFromEnv,
  type ApprovalPolicy
} from './approval/approval-policy.js';
import {
  loadPolicyFromRepo,
  mergeApprovalPolicies,
  type FileApprovalPolicy
} from './approval/policy-loader.js';
import {
  lifecycleBlocks,
  runLifecycleHook
} from './hooks/lifecycle-hooks.js';
import {
  assertToolsetInvariant,
  promptCacheStrictFromEnv
} from './session/prompt-cache.js';
import {
  createExtensionRegistry,
  type ExtensionRegistry,
  type ExtensionSpec
} from './extensions/extension-registry.js';
import {
  describePermissionMode,
  parsePermissionMode,
  resolvePermissionMode,
  shiftPermissionMode,
  type PermissionMode
} from './approval/permission-mode.js';
import { runDoctor, formatDoctorReport, type DoctorReport } from './doctor/doctor.js';
import {
  formatSubagentSummary,
  resolveSubagentAgentId,
  type SubagentSpawnArgs
} from './session/subagent-contract.js';
import { discloseSkillBody, formatDisclosedSkillContent } from './skills/skill-disclosure.js';
import {
  browserToolsFeatureEnabled,
  createBrowserTools,
  defaultBrowserAction
} from './tools/browser-tools.js';
import { CronJobStore, createCronTools, cronToolsFeatureEnabled, markCronJobRan } from './cron/cron-store.js';
import {
  filterToolsByOptionalGroups,
  loadOptionalToolGroupsFromEnv,
  optionalToolGroupsFeatureEnabled
} from './tools/optional-tool-groups.js';
import { maybeExportOtelSpan } from './otel.js';
import { builtinAgents } from './builtin-agents.js';
import {
  skillLoadStrictFromEnv,
  skillRoutingModeFromEnv,
} from './skills/skill-router.js';
import { createId } from './id.js';
import {
  createModelAdapterFromEnv,
  textSummaryFromParts
} from './model/model-adapters.js';
import { applyRefusalPreservationGuard } from './model/refusal-preservation.js';
import { recoveryPolicyEnabled, SessionLoopGuard } from './recovery/session-loop-guard.js';
import {
  applyEvolvingPositiveFeedback,
  buildEvolvingCoachAdvisory,
  evolvingReviewerEnabled,
  scheduleBackgroundCaseReview
} from './evolving/index.js';
import { llmPromptDebugEnabled } from './model/llm-prompt-debug.js';
import {
  imageBufferToDataUrl,
  touchImageAccess
} from './image-assets.js';
import { SqliteStateStore } from './storage.js';
import { readSessionTraceEvents } from './stores/read-traces.js';
import { appendTraceEvent } from './stores/trace.js';
import type { TraceEvent } from './stores/trace.js';
import { createBuiltinTools } from './tools/builtin-tools.js';
import { estimateMessageTokens } from './model/token-estimate.js';
import {
  selectEpisodicMessages,
  selectEpisodicMessagesWithCognitiveState
} from './model/episodic-selection.js';
import { type CognitivePhase } from './model/cognitive-state.js';
import {
  gitCheckoutBranch,
  gitMergeAbort,
  gitMergeBranch,
  gitPushBranch,
  gitResolveBranch,
  gitRevParseHead,
  gitStashPop,
  gitStashPush,
  gitWorktreeClean,
  runSelfHealNpmTest
} from './self-heal/self-heal-executors.js';
import { normalizeSelfHealPolicy, npmScriptForSelfHealPolicy } from './self-heal/self-heal-policy.js';
import {
  type AgentSpec,
  type ApprovalRecord,
  type BackgroundJobRecord,
  type DaemonRestartRequest,
  type MailRecord,
  type MessagePart,
  type ModelAdapter,
  type ModelStreamChunk,
  type ModelTurnInput,
  type ModelTurnResult,
  type RunContext,
  type SelfHealEventRecord,
  type SelfHealPolicy,
  type SelfHealRunRecord,
  type SessionMessage,
  type SessionRecord,
  type ImageAssetRecord,
  type ImagePart,
  type SkillSpec,
  type TaskRecord,
  type ToolContract,
  type TodoItem
} from './types.js';
import type { ApiSocialPostScheduleItem } from './api-types.js';
import { type SocialPostDeliverFn } from './social-schedule.js';
import { SocialScheduleService, type SocialScheduleAction } from './services/social-schedule-service.js';
import { AutonomousScheduler } from './services/autonomous-scheduler.js';
import { SwarmExecutor } from './swarm/executor.js';
import { loadRuntimeEnvConfig } from './runtime-env.js';
import { OrchestrationEngine } from './orchestrator/engine.js';
import type { OrchestrationRun } from './orchestrator/types.js';
import { ResearchPipeline } from './deepresearch/pipeline.js';
import { createSwarmId, nowIso as swarmNowIso } from './swarm/store.js';
import { ImageIngestService } from './services/image-ingest-service.js';
import { WorkspaceManager } from './workspaces.js';
import { McpManager } from './mcp/mcp-manager.js';
import {
  discoverPlugins,
  mergePlugins,
  pluginDirsFromEnv
} from './plugins/plugin-loader.js';
import { envInt, envBool } from './env.js';
import type { AssetStorage, EventBufferRepository } from './storage/interfaces.js';
import {
  defaultTenantIdFromEnv,
  defaultUserIdFromEnv,
} from './storage/provider-config.js';
import {
  checkToolApprovals as toolLoopCheckApprovals,
  executeToolCalls as toolLoopExecuteCalls,
  filterValidToolCalls as toolLoopFilterValid,
  processToolResults as toolLoopProcessResults,
  runTurnWithRetries as toolLoopRunTurn,
  type ToolLoopDeps
} from './runtime/tool-loop.js';
import { createToolServices as buildToolServices } from './runtime/tool-services.js';

const MAX_VISIBLE_MESSAGES = 24;

/** 滚动 session.summary 过长时保留尾部，避免合成进可见窗口后 token 估算永久虚高 */
function capRollingSummaryText(text: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `…[earlier summary truncated]\n\n${text.slice(-maxChars)}`;
}

/**
 * 摘要字符上限：未设置 RAW_AGENT_COMPACT_SUMMARY_MAX_CHARS 时 = 阈值×2（est≈len/4，约为阈值一半预算给摘要，余量给最近 N 条）。
 */
function compactSummaryMaxChars(env: NodeJS.ProcessEnv): number {
  const thr = envInt(env, 'RAW_AGENT_COMPACT_TOKEN_THRESHOLD', 24_000);
  return envInt(env, 'RAW_AGENT_COMPACT_SUMMARY_MAX_CHARS', thr * 2);
}

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

function textPart(text: string): MessagePart {
  return {
    type: 'text',
    text
  };
}

function textFromMessage(message: SessionMessage): string {
  return textSummaryFromParts(message.parts);
}

function userMessageParts(text: string, imageAssetIds: string[], store: SqliteStateStore): MessagePart[] {
  const parts: MessagePart[] = [];
  const t = text.trim();
  if (t) parts.push(textPart(t));
  for (const id of imageAssetIds) {
    const asset = store.getImageAsset(id);
    if (!asset) continue;
    const im: ImagePart = {
      type: 'image',
      assetId: id,
      mimeType: asset.mimeType,
      sourceUrl: asset.sourceUrl,
      retentionTier: asset.retentionTier
    };
    parts.push(im);
  }
  return parts;
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
  private readonly envApprovalPolicy: ApprovalPolicy | undefined;
  private readonly mcpManager: McpManager;
  private filePolicyCache: FileApprovalPolicy | undefined | null = null;
  /** Sub-service: social post schedule list / approval / dispatch. */
  private readonly socialSchedule: SocialScheduleService;
  /** Sub-service: wake/run idle background sessions on task/mailbox events. */
  private readonly autonomousScheduler: AutonomousScheduler;
  private readonly swarmExecutor: SwarmExecutor;
  private readonly orchestrationEngine: OrchestrationEngine;
  /** Sub-service: image ingest + retention sweep. */
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

    const selfHealCtx: SelfHealContext = {
      store: this.store,
      repoRoot: this.repoRoot,
      createTaskSession: (input) => this.createTaskSession(input),
      runSession: (sid) => this.runSession(sid).then(() => {}),
      bindWorkspaceForTask: (tid) => this.bindWorkspaceForTask(tid),
    };
    this.selfHeal = new SelfHealScheduler(selfHealCtx);
    this.socialSchedule = new SocialScheduleService(this.store);
    this.autonomousScheduler = new AutonomousScheduler({
      store: this.store,
      runSession: (sid) => this.runSession(sid).then(() => {}),
      isSelfHealControlled: (session) =>
        (session.metadata as { selfHealControlled?: boolean }).selfHealControlled === true
    });

    this.swarmExecutor = new SwarmExecutor({
      store: this.store.swarm(),
      listSessions: () => this.store.listSessions(),
      getSession: (id) => this.store.getSession(id),
      createTeammateSession: (input) => this.createTeammateSession(input),
      runSession: (sid) => this.runSession(sid).then(() => {}),
      enqueueSchedulerWake: (sid, reason) => this.store.enqueueSchedulerWake(sid, reason),
      sessionTeammateFinished: (sid) => this.sessionTeammateFinished(sid)
    });

    this.orchestrationEngine = new OrchestrationEngine({
      store: this.store.orchestrator(),
      startSwarmForRun: async (run) => {
        const swarmStore = this.store.swarm();
        const swarmId = createSwarmId('srun');
        swarmStore.createRun({
          id: swarmId,
          goal: run.title,
          orchestrationRunId: run.id,
          status: 'pending',
          strategy: 'pipeline',
          budget: { maxTeammates: 3, maxTurnsPerAgent: 20, maxDurationMs: 600_000 },
          qualityGate: ['completed'],
          createdAt: swarmNowIso(),
          updatedAt: swarmNowIso()
        });
        this.swarmExecutor.startRun(swarmId, [
          { title: run.title, requiredRole: 'implementer' }
        ]);
      },
      tickSwarm: () => this.swarmExecutor.tick(),
      getSwarmForOrchestrationRun: (orchestrationRunId) =>
        this.store
          .swarm()
          .listRuns({ limit: 100 })
          .find((r) => r.orchestrationRunId === orchestrationRunId),
      runResearch: (run) => this.runOrchestrationResearch(run),
      runReview: (run) => this.runOrchestrationSubagentStage(run, 'review'),
      runTest: (run) => this.runOrchestrationSubagentStage(run, 'test')
    });
    this.imageIngest = new ImageIngestService({
      store: this.store,
      stateDir: this.stateDir,
      log: this.log,
      appendSystemNote: (sessionId, note) =>
        this.store.appendMessage(sessionId, 'system', [textPart(note)])
    });

    for (const agent of options.agents ?? builtinAgents) {
      this.store.upsertAgent(agent);
    }
    for (const agent of options.extraAgents ?? []) {
      this.store.upsertAgent(agent);
    }
    for (const agent of mergedPlugins.agents) {
      this.store.upsertAgent(agent);
    }

    const baseTools = options.tools ?? createBuiltinTools(this.createToolServices());
    const optionalExtras: ToolContract<any>[] = [];
    if (browserToolsFeatureEnabled(process.env)) {
      optionalExtras.push(
        ...createBrowserTools({
          runBrowserAction: (ctx, action) => defaultBrowserAction(ctx, action)
        })
      );
    }
    if (cronToolsFeatureEnabled(process.env)) {
      optionalExtras.push(
        ...createCronTools(() => {
          if (!this.cronStore) this.cronStore = new CronJobStore(this.stateDir);
          return this.cronStore;
        })
      );
    }
    this.tools = [...baseTools, ...optionalExtras, ...(options.extraTools ?? [])];
    this.mcpManager = new McpManager({ stateDir: this.stateDir, tools: this.tools, env: process.env, log: this.log });
  }

  /** Tick due cron jobs: append prompt to owning session and enqueue a run. */
  async tickCronJobs(): Promise<number> {
    if (!this.cronStore) this.cronStore = new CronJobStore(this.stateDir);
    const due = this.cronStore.dueJobs();
    let n = 0;
    for (const job of due) {
      const session = this.store.getSession(job.sessionId);
      if (!session) {
        this.cronStore.update(job.id, { enabled: false });
        continue;
      }
      this.store.appendMessage(job.sessionId, 'user', [
        textPart(`[cron:${job.name}] ${job.prompt}`)
      ]);
      markCronJobRan(this.cronStore, job);
      if (session.background && session.status === 'idle') {
        this.store.enqueueSchedulerWake(job.sessionId, `cron:${job.id}`);
      } else if (session.status === 'idle') {
        void this.runSession(job.sessionId).catch((err) => {
          this.log.warn('cron session run failed', {
            sessionId: job.sessionId,
            error: err instanceof Error ? err.message : String(err)
          });
        });
      }
      n += 1;
    }
    return n;
  }

  /** Abort in-flight model/tool work for a session (best-effort). */
  cancelSession(sessionId: string): void {
    const controller = this.sessionAbortControllers.get(sessionId);
    controller?.abort();
    this.sessionAbortControllers.delete(sessionId);
    // Abort sandbox-managed background jobs owned by this session.
    // Snapshot keys before mutation so a single iteration can remove entries safely.
    for (const jobId of [...this.backgroundJobAborts.keys()]) {
      const ac = this.backgroundJobAborts.get(jobId);
      if (!ac) continue;
      const job = this.store.getBackgroundJob(jobId);
      if (job?.sessionId === sessionId) {
        ac.abort();
        this.backgroundJobAborts.delete(jobId);
      }
    }
    void this.emitTrace(sessionId, { kind: 'cancel', payload: {} });
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
    const s = this.store.getSession(sessionId);
    if (!s) {
      throw new NotFoundError('Session', sessionId);
    }
    return this.store.updateSession(sessionId, {
      metadata: { ...s.metadata, ...patch }
    });
  }

  /** Current effective permission mode for a session. */
  getPermissionMode(sessionId: string): PermissionMode {
    const s = this.store.getSession(sessionId);
    if (!s) throw new NotFoundError('Session', sessionId);
    return resolvePermissionMode(s.metadata, process.env);
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
    const previous = this.getPermissionMode(sessionId);
    let next: PermissionMode | undefined;
    if (input.shift) {
      next = shiftPermissionMode(previous, input.shift);
    } else if (input.mode !== undefined) {
      next = parsePermissionMode(input.mode);
      if (!next) {
        throw new ValidationError(
          `Invalid permissionMode "${String(input.mode)}" (expected plan|ask|acceptEdits|auto|bypass)`
        );
      }
    } else {
      throw new ValidationError('Provide mode or shift=elevate|demote');
    }
    this.mergeSessionMetadata(sessionId, {
      permissionMode: next,
      permissionModeChangedAt: new Date().toISOString(),
      permissionModePrevious: previous
    });
    return {
      sessionId,
      previous,
      mode: next,
      description: describePermissionMode(next)
    };
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

  // ── Social post schedule (delegated to SocialScheduleService) ──
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
    const session = this.store.createSession({
      title: input.title ?? 'Chat Session',
      mode: 'chat',
      agentId: input.agentId?.trim() ? input.agentId.trim() : 'main',
      background: input.background ?? false,
      metadata: input.metadata
    });

    const ids = input.imageAssetIds?.filter(Boolean) ?? [];
    const msg = input.message?.trim() ?? '';
    if (msg || ids.length > 0) {
      this.store.appendMessage(session.id, 'user', userMessageParts(msg || '(image)', ids, this.store));
      void this.runImageRetention(session.id);
    }

    return session;
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
    const task = this.store.createTask({
      title: input.title,
      description: input.description,
      ownerAgentId: input.agentId?.trim() ? input.agentId.trim() : 'main',
      blockedBy: input.blockedBy
    });
    this.wakeAllAutonomousSessions('task.created');

    const session = this.store.createSession({
      title: input.title,
      mode: 'task',
      agentId: input.agentId?.trim() ? input.agentId.trim() : 'main',
      taskId: task.id,
      background: input.background ?? true,
      metadata: {
        autoRun: true,
        ...(input.metadata ?? {})
      }
    });

    this.store.updateTask(task.id, { sessionId: session.id });
    const ids = input.imageAssetIds?.filter(Boolean) ?? [];
    if (input.message?.trim() || ids.length > 0) {
      const msg = input.message?.trim() ?? (ids.length ? '(image)' : '');
      this.store.appendMessage(session.id, 'user', userMessageParts(msg, ids, this.store));
      void this.runImageRetention(session.id);
    } else {
      this.store.appendMessage(
        session.id,
        'user',
        [textPart(`Work on task "${task.title}". ${task.description}`.trim())]
      );
    }

    return {
      task: this.store.getTask(task.id) as TaskRecord,
      session
    };
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
    const agent = this.ensureAgent({
      id: input.name,
      name: input.name,
      role: input.role,
      instructions: `You are teammate ${input.name}. ${input.role}. Check inbox, work on assigned tasks, and reply through send_message when handing off work.`,
      capabilities: ['teammate', 'tool-use', 'task-management'],
      autonomous: true
    });

    const session = this.store.createSession({
      title: `Teammate ${input.name}`,
      mode: 'teammate',
      agentId: agent.id,
      taskId: input.taskId,
      parentSessionId: input.parentSessionId,
      background: input.background ?? true,
      metadata: {
        autoRun: true,
        ...(input.metadata ?? {})
      }
    });

    this.store.appendMessage(
      session.id,
      'user',
      [textPart(`${input.prompt}\n\nYou are teammate ${input.name}. Work asynchronously and use mailbox tools when needed.`)]
    );

    return session;
  }

  sendUserMessage(sessionId: string, message: string, options?: { imageAssetIds?: string[] }): SessionRecord {
    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new NotFoundError('Session', sessionId);
    }

    const ids = options?.imageAssetIds?.filter(Boolean) ?? [];
    const text = message.trim();
    if (!text && ids.length === 0) {
      throw new ValidationError('Message or imageAssetIds required');
    }
    this.store.appendMessage(session.id, 'user', userMessageParts(text || '(image)', ids, this.store));
    void this.runImageRetention(session.id);
    return this.store.getSession(session.id) as SessionRecord;
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

  private async runImageRetention(sessionId: string): Promise<void> {
    return this.imageIngest.runRetention(sessionId);
  }

  /**
   * Prepares messages for model ingestion:
   * - Replaces cold/missing image parts with archived-image text markers.
   * - Appends warm contact sheet as a tail user message (NOT prepended), so the
   *   beginning of message history stays stable for prompt-cache reuse.
   */
  private async prepareMessagesForModel(session: SessionRecord, messages: SessionMessage[]): Promise<SessionMessage[]> {
    const warmId = session.metadata?.imageWarmContactAssetId;
    const warmIdStr = typeof warmId === 'string' ? warmId : undefined;

    const mapped: SessionMessage[] = messages.map((msg) => ({
      ...msg,
      parts: msg.parts.flatMap((part): MessagePart[] => {
        if (part.type !== 'image') return [part];
        const asset = this.store.getImageAsset(part.assetId);
        if (!asset || asset.retentionTier === 'cold') {
          return [{ type: 'text', text: `[archived image ${part.assetId}]` }];
        }
        const im: ImagePart = {
          type: 'image',
          assetId: part.assetId,
          mimeType: asset.mimeType,
          sourceUrl: part.sourceUrl ?? asset.sourceUrl,
          retentionTier: asset.retentionTier
        };
        return [im];
      })
    }));

    if (warmIdStr) {
      const warmAsset = this.store.getImageAsset(warmIdStr);
      const already = mapped.some((m) => m.parts.some((p) => p.type === 'image' && p.assetId === warmIdStr));
      if (warmAsset && !already) {
        const contactSheet: SessionMessage = {
          id: createId('msg'),
          sessionId: session.id,
          role: 'user',
          parts: [
            textPart('Earlier screenshots (contact sheet, compressed memory):'),
            {
              type: 'image',
              assetId: warmIdStr,
              mimeType: warmAsset.mimeType,
              retentionTier: 'warm'
            }
          ],
          createdAt: new Date(0).toISOString()
        };
        // Append contact sheet just before the last user message so the model
        // sees it as recent context, while keeping early message indices stable.
        const lastUserIdx = mapped.reduceRight((found, _, i) => found === -1 && mapped[i]!.role === 'user' ? i : found, -1);
        if (lastUserIdx > 0) {
          mapped.splice(lastUserIdx, 0, contactSheet);
        } else {
          mapped.push(contactSheet);
        }
      }
    }

    // Trajectory-integrity guard: refusal preservation (arXiv:2604.08557)
    // When enabled, detects prior assistant refusals followed by short redirect
    // attempts and injects a protective reminder to anchor the model's decision.
    if (envBool(process.env, 'RAW_AGENT_REFUSAL_PRESERVATION', true)) {
      const { messages: guarded, result } = applyRefusalPreservationGuard(mapped);
      if (result.shouldInjectReminder) {
        void this.emitTrace(session.id, {
          kind: 'refusal_preservation',
          payload: {
            refusalCount: result.refusalMessageIds.length,
            isRedirectAttempt: result.isRedirectAttempt
          }
        });
        return guarded;
      }
    }

    return mapped;
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
    if (!this.store.getAgent(input.fromAgentId)) {
      throw new NotFoundError('Agent', input.fromAgentId);
    }
    if (!this.store.getAgent(input.toAgentId)) {
      throw new NotFoundError('Agent', input.toAgentId);
    }

    const mail = this.store.createMail({
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      type: input.type ?? 'message',
      content: input.content,
      correlationId: input.correlationId,
      sessionId: input.sessionId,
      taskId: input.taskId
    });
    this.wakeAgentSessions(input.toAgentId, 'mailbox');
    return mail;
  }

  private wakeAgentSessions(agentId: string, reason: string): void {
    this.autonomousScheduler.wakeAgent(agentId, reason);
  }

  private wakeAllAutonomousSessions(reason: string): void {
    this.autonomousScheduler.wakeAll(reason);
  }

  getLatestAssistantText(sessionId: string): string | undefined {
    const messages = this.store.listMessages(sessionId);
    const assistant = [...messages].reverse().find((message) => message.role === 'assistant');
    return assistant ? textFromMessage(assistant) : undefined;
  }

  async approve(approvalId: string, decision: 'approved' | 'rejected'): Promise<ApprovalRecord> {
    const approval = this.store.updateApproval(approvalId, decision);
    const session = this.store.getSession(approval.sessionId);
    if (session && session.status === 'waiting_approval') {
      this.store.updateSession(session.id, { status: 'idle' });
      this.store.appendMessage(
        session.id,
        'user',
        [textPart(`Approval for ${approval.toolName} was ${decision}. Continue.`)]
      );
    }
    return approval;
  }

  async runScheduler(): Promise<void> {
    await this.selfHeal.processRuns();
    await this.swarmExecutor.tick();
    await this.orchestrationEngine.tick();
    if (cronToolsFeatureEnabled(process.env)) {
      await this.tickCronJobs();
    }
    await this.processAutonomousSessions();
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
    return this.ensureWorkspaceRoot(session, task);
  }


  async runSession(
    sessionId: string,
    options?: { onModelStreamChunk?: (chunk: ModelStreamChunk) => void }
  ): Promise<SessionRecord> {
    // Prevent concurrent runs on the same session
    const existing = this.runningSessions.get(sessionId);
    if (existing) return existing;

    const promise = this._runSessionInner(sessionId, options).finally(() => {
      this.runningSessions.delete(sessionId);
    });
    this.runningSessions.set(sessionId, promise);
    return promise;
  }

  private async _runSessionInner(
    sessionId: string,
    options?: { onModelStreamChunk?: (chunk: ModelStreamChunk) => void }
  ): Promise<SessionRecord> {
    let session = this.store.getSession(sessionId);
    if (!session) {
      throw new NotFoundError('Session', sessionId);
    }
    if (session.status === 'waiting_approval') {
      return session;
    }

    const agent = this.store.getAgent(session.agentId);
    if (!agent) {
      throw new NotFoundError('Agent', session.agentId);
    }

    const controller = new AbortController();
    this.sessionAbortControllers.set(sessionId, controller);
    const signal = controller.signal;
    const sid = session.id;
    const loopGuard = recoveryPolicyEnabled(process.env) ? new SessionLoopGuard(process.env) : null;

    try {
      await this.mcpManager.ensureLoaded(sid);
      const filePolicy = await this.mergedFilePolicy();
      session = this.store.updateSession(session.id, { status: 'running' });
      await this.ingestMailbox(session);
      await this.autoClaimTask(session);

      for (let turn = 0; turn < this.maxTurnsPerRun; turn += 1) {
        if (signal.aborted) {
          return this.store.updateSession(session.id, { status: 'failed' });
        }

        const refreshedSession = this.store.getSession(session.id) as SessionRecord;
        const task = refreshedSession.taskId ? this.store.getTask(refreshedSession.taskId) : undefined;
        const workspaceRoot = await this.ensureWorkspaceRoot(refreshedSession, task);
        let context: RunContext = {
          repoRoot: this.repoRoot,
          stateDir: this.stateDir,
          session: this.store.getSession(session.id) as SessionRecord,
          agent,
          workspaceRoot,
          task,
          abortSignal: signal
        };

        await this.autoCompact(context);

        const rawVisible = this.visibleMessages(context.session);
        const visibleMessages = await this.prepareMessagesForModel(context.session, rawVisible);
        const promptCtx: PromptContext = context;
        const systemPrompt = await this.promptBuilder.buildSystemPrompt(promptCtx, rawVisible);
        const stablePrefixHash = createHash('sha256')
          .update(this.promptBuilder.buildStablePrefix(promptCtx))
          .digest('hex')
          .slice(0, 16);
        const routing = this.promptBuilder.getRouting(sid);
        void this.emitTrace(sid, {
          kind: 'turn_start',
          payload: {
            turn,
            adapter: this.modelAdapter.name,
            stablePrefixHash,
            routing: routing ? {
              mode: routing.mode,
              confidence: routing.confidence.level,
              shortlistCount: routing.shortlistNames.length,
              topSkill: routing.routed[0]?.skill.name
            } : undefined
          }
        });

        const resolveImageDataUrl = async (assetId: string, sig?: AbortSignal) => {
          const asset = this.store.getImageAsset(assetId);
          if (!asset || asset.sessionId !== context.session.id) {
            return undefined;
          }
          await touchImageAccess(this.store, assetId);
          return imageBufferToDataUrl(this.store, this.stateDir, assetId);
        };

        // Env var is a capability gate: feature must be enabled globally.
        // Session metadata is the opt-in: each session must explicitly request external AI tools.
        const externalAiCapabilityGate = envBool(process.env, 'RAW_AGENT_EXTERNAL_AI_TOOLS', false);
        const sessionOptIn = context.session.metadata?.allowExternalAiTools === true;
        const allowExternalAiTools = externalAiCapabilityGate && sessionOptIn;
        const externallyGated = allowExternalAiTools ? this.tools : this.tools.filter((t) => !t.isExternal);
        // Per-agent whitelist: when AgentSpec.allowedTools is set, scope this turn's
        // tool list to that subset so e.g. an SRE persona can't see stock tools.
        let turnTools =
          agent.allowedTools && agent.allowedTools.length > 0
            ? externallyGated.filter((t) => agent.allowedTools!.includes(t.name))
            : externallyGated;

        // Subagent spawn may pin an extra allowlist on session.metadata.allowedTools
        const metaAllowed = context.session.metadata?.allowedTools;
        if (Array.isArray(metaAllowed) && metaAllowed.length > 0) {
          const allow = new Set(metaAllowed.map((n) => String(n)));
          turnTools = turnTools.filter((t) => allow.has(t.name));
        }

        const hasExplicitOptionalToolSelection =
          context.session.metadata &&
          Object.prototype.hasOwnProperty.call(context.session.metadata, 'enabledOptionalToolGroups');
        if (optionalToolGroupsFeatureEnabled(process.env) && hasExplicitOptionalToolSelection) {
          const ogroups = loadOptionalToolGroupsFromEnv(process.env);
          const enabled = context.session.metadata?.enabledOptionalToolGroups;
          turnTools = filterToolsByOptionalGroups(turnTools, enabled, ogroups).tools;
        }

        const toolsetLock = assertToolsetInvariant(
          sid,
          turnTools.map((t) => t.name),
          context.session.metadata,
          { strict: promptCacheStrictFromEnv(process.env) }
        );
        if (Object.keys(toolsetLock.metadataPatch).length > 0) {
          this.mergeSessionMetadata(sid, toolsetLock.metadataPatch);
          context = {
            ...context,
            session: this.store.getSession(sid) as SessionRecord
          };
        }
        if (toolsetLock.drifted) {
          void this.emitTrace(sid, {
            kind: 'prompt_cache_bust',
            payload: { fingerprint: toolsetLock.fingerprint, reason: 'toolset_drift' }
          });
        }

        if (turn === 0) {
          const startHook = await runLifecycleHook(process.env, {
            phase: 'session_start',
            sessionId: sid,
            context: { agentId: agent.id, mode: context.session.mode }
          });
          if (startHook.systemMessage || startHook.message) {
            this.store.appendMessage(sid, 'system', [
              textPart(startHook.systemMessage ?? startHook.message ?? '')
            ]);
          }
          const startExt = await this.extensionRegistry.run('session_start', {
            sessionId: sid,
            agentId: agent.id,
            meta: { mode: context.session.mode }
          });
          if (startExt.systemMessage || startExt.message) {
            this.store.appendMessage(sid, 'system', [
              textPart(startExt.systemMessage ?? startExt.message ?? '')
            ]);
          }
        }

        const beforeTurn = await this.extensionRegistry.run('before_turn', {
          sessionId: sid,
          agentId: agent.id,
          meta: { turn }
        });
        if (beforeTurn.block) {
          this.store.appendMessage(sid, 'system', [
            textPart(beforeTurn.message ?? beforeTurn.systemMessage ?? 'blocked by before_turn extension')
          ]);
          return this.store.updateSession(session.id, { status: 'failed' });
        }
        if (beforeTurn.systemMessage) {
          this.store.appendMessage(sid, 'system', [textPart(beforeTurn.systemMessage)]);
        }

        let turnResult: ModelTurnResult;
        try {
          turnResult = await this.runTurnWithRetries(
            {
              agent,
              systemPrompt,
              messages: visibleMessages,
              tools: turnTools,
              signal,
              resolveImageDataUrl,
              promptCacheKey: toolsetLock.promptCacheKey,
              ...(llmPromptDebugEnabled(process.env)
                ? { debugLlmContext: { stateDir: this.stateDir, sessionId: sid } }
                : {})
            },
            options?.onModelStreamChunk
          );
        } catch (error) {
          void this.emitTrace(sid, {
            kind: 'model_error',
            payload: { message: error instanceof Error ? error.message : String(error) }
          });
          throw error;
        }

        void this.emitTrace(sid, {
          kind: 'turn_end',
          payload: { stopReason: turnResult.stopReason }
        });

        if (turnResult.assistantParts.length === 0) {
          this.store.updateSession(session.id, { status: 'failed' });
          throw new ValidationError('Model returned no assistant content');
        }

        if (loopGuard) {
          const rep = loopGuard.checkAssistantRepetition(turnResult.assistantParts);
          if (rep.abort) {
            this.store.appendMessage(session.id, 'assistant', turnResult.assistantParts);
            await this.injectEvolvingCoachBeforeRecovery(session, agent, 'repetition', rep.reason);
            this.store.appendMessage(session.id, 'system', [textPart(`[recovery] Stopped: ${rep.reason}`)]);
            void this.emitTrace(sid, {
              kind: 'recovery_abort',
              payload: { reason: rep.reason, trigger: 'repetition' }
            });
            if (evolvingReviewerEnabled(process.env)) {
              scheduleBackgroundCaseReview(this.store, process.env, {
                stateDir: this.stateDir,
                sessionId: session.id,
                agentId: agent.id,
                outcome: 'failure',
                signals: { trigger: 'repetition', reason: rep.reason }
              });
            }
            return this.store.updateSession(session.id, { status: 'idle' });
          }
        }

        this.store.appendMessage(session.id, 'assistant', turnResult.assistantParts);

        if (turnResult.stopReason !== 'tool_use') {
          const stopPhase = context.session.mode === 'subagent' ? 'subagent_stop' : 'stop';
          const stopHook = await runLifecycleHook(process.env, {
            phase: stopPhase,
            sessionId: sid,
            context: { stopReason: turnResult.stopReason, agentId: agent.id }
          });
          if (lifecycleBlocks(stopHook)) {
            this.store.appendMessage(sid, 'system', [
              textPart(
                `[stop-hook] ${stopHook.message ?? stopHook.systemMessage ?? 'stop blocked; continuing verification loop'}`
              )
            ]);
            continue;
          }
          if (stopHook.systemMessage) {
            this.store.appendMessage(sid, 'system', [textPart(stopHook.systemMessage)]);
          }
          const stopExt = await this.extensionRegistry.run('stop', {
            sessionId: sid,
            agentId: agent.id,
            meta: { stopReason: turnResult.stopReason, mode: context.session.mode }
          });
          if (stopExt.block) {
            this.store.appendMessage(sid, 'system', [
              textPart(
                `[stop-extension] ${stopExt.message ?? stopExt.systemMessage ?? 'stop blocked; continuing'}`
              )
            ]);
            continue;
          }
          if (stopExt.systemMessage) {
            this.store.appendMessage(sid, 'system', [textPart(stopExt.systemMessage)]);
          }
          return this.handleTurnCompletion(session, agent, task);
        }

        const assistantMessage = this.store.listMessages(session.id).slice(-1)[0];
        if (!assistantMessage) {
          return this.store.updateSession(session.id, { status: 'failed' });
        }
        type ToolCallPart = Extract<MessagePart, { type: 'tool_call' }>;
        const toolCalls = assistantMessage.parts.filter(
          (part): part is ToolCallPart => part.type === 'tool_call'
        );

        const validToolCalls = this.filterValidToolCalls(toolCalls, allowExternalAiTools, session.id);

        const approvalResult = this.checkToolApprovals(validToolCalls, context, filePolicy, session);
        if (approvalResult === 'waiting') {
          return this.store.updateSession(session.id, { status: 'waiting_approval' });
        }
        if (approvalResult === 'skip') {
          continue;
        }

        const results = await this.executeToolCalls(validToolCalls, context, allowExternalAiTools, sid);
        this.processToolResults(results, validToolCalls, session, task, sid, options?.onModelStreamChunk);

        if (loopGuard) {
          const ar = loopGuard.afterToolRound(
            validToolCalls.map((tc) => ({ name: tc.name })),
            results.map((r) => ({ name: r.name, ok: r.ok }))
          );
          if (ar.abort) {
            const fresh = this.store.getSession(session.id) as SessionRecord;
            await this.injectEvolvingCoachBeforeRecovery(fresh, agent, 'tools', ar.reason);
            this.store.appendMessage(session.id, 'system', [textPart(`[recovery] Stopped: ${ar.reason}`)]);
            void this.emitTrace(sid, {
              kind: 'recovery_abort',
              payload: { reason: ar.reason, trigger: 'tools' }
            });
            if (evolvingReviewerEnabled(process.env)) {
              scheduleBackgroundCaseReview(this.store, process.env, {
                stateDir: this.stateDir,
                sessionId: session.id,
                agentId: agent.id,
                outcome: 'failure',
                signals: { trigger: 'tools', reason: ar.reason }
              });
            }
            return this.store.updateSession(session.id, { status: 'idle' });
          }
        }
      }

      if (evolvingReviewerEnabled(process.env)) {
        scheduleBackgroundCaseReview(this.store, process.env, {
          stateDir: this.stateDir,
          sessionId: session.id,
          agentId: agent.id,
          outcome: 'partial',
          signals: { reason: 'max_turns_exhausted', maxTurns: this.maxTurnsPerRun }
        });
      }
      return this.store.updateSession(session.id, { status: 'idle' });
    } finally {
      this.sessionAbortControllers.delete(sessionId);
    }
  }

  /** Handle model completion (non-tool_use stop): update session + optional task completion. */
  private async handleTurnCompletion(
    session: SessionRecord,
    agent: { id: string },
    task?: TaskRecord
  ): Promise<SessionRecord> {
    applyEvolvingPositiveFeedback(process.env, this.store, session.id);
    const nextStatus = session.mode === 'task' ? 'completed' : 'idle';
    const updated = this.store.updateSession(session.id, { status: nextStatus });
    if (task && nextStatus === 'completed') {
      const latestText = this.getLatestAssistantText(session.id);
      this.store.updateTask(task.id, {
        status: 'completed',
        artifacts: latestText
          ? [...task.artifacts, { kind: 'summary', label: 'assistant', value: latestText }]
          : task.artifacts
      });
      this.store.appendEvent({
        taskId: task.id,
        kind: 'task.completed',
        actor: agent.id,
        payload: { sessionId: session.id }
      });
      await this.unblockDependentTasks(task.id);
    }
    if (evolvingReviewerEnabled(process.env)) {
      scheduleBackgroundCaseReview(this.store, process.env, {
        stateDir: this.stateDir,
        sessionId: session.id,
        agentId: agent.id,
        outcome: 'success'
      });
    }
    return updated;
  }

  private evolvingQueryText(sessionId: string, maxMessages = 12): string {
    const msgs = this.store.listMessages(sessionId).slice(-maxMessages);
    const lines: string[] = [];
    for (const m of msgs) {
      const sum = textSummaryFromParts(m.parts).trim();
      if (!sum) continue;
      lines.push(`${m.role}: ${sum}`);
    }
    return lines.join('\n').slice(0, 12_000);
  }

  private async injectEvolvingCoachBeforeRecovery(
    session: SessionRecord,
    agent: { id: string },
    trigger: string,
    reason: string
  ): Promise<void> {
    const advisory = await buildEvolvingCoachAdvisory(process.env, this.store, {
      sessionId: session.id,
      agentId: agent.id,
      metadata: session.metadata ?? {},
      trigger,
      reason,
      queryText: this.evolvingQueryText(session.id)
    });
    if (!advisory?.text.trim()) return;
    this.store.appendMessage(session.id, 'system', [textPart(advisory.text)]);
    if (advisory.caseIds.length) {
      this.mergeSessionMetadata(session.id, { evolvingPendingCaseIds: advisory.caseIds });
    }
    void this.emitTrace(session.id, {
      kind: 'evolving_coach',
      payload: { caseIds: advisory.caseIds, trigger }
    });
  }

  private toolLoopDeps(): ToolLoopDeps {
    return {
      tools: this.tools,
      store: this.store,
      envApprovalPolicy: this.envApprovalPolicy,
      maxParallelToolCalls: this.maxParallelToolCalls,
      modelAdapter: this.modelAdapter,
      stateDir: this.stateDir,
      emitTrace: (sessionId, event) => {
        void this.emitTrace(sessionId, {
          kind: event.kind as TraceEvent['kind'],
          payload: event.payload
        });
      },
      runAfterToolExtension: async (ctx) => {
        const r = await this.extensionRegistry.run('after_tool', {
          sessionId: ctx.sessionId,
          tool: ctx.tool,
          input: ctx.input,
          ok: ctx.ok,
          content: ctx.content
        });
        return r.systemMessage ? { systemMessage: r.systemMessage } : undefined;
      }
    };
  }

  /** Filter tool calls: reject external AI calls when gate is off, keep valid ones. */
  private filterValidToolCalls(
    toolCalls: Extract<MessagePart, { type: 'tool_call' }>[],
    allowExternalAiTools: boolean,
    sessionId: string
  ) {
    return toolLoopFilterValid(this.toolLoopDeps(), toolCalls, allowExternalAiTools, sessionId);
  }

  /** Check if any tool call requires approval; return 'waiting' | 'skip' | 'proceed'. */
  private checkToolApprovals(
    validToolCalls: Extract<MessagePart, { type: 'tool_call' }>[],
    context: RunContext,
    filePolicy: FileApprovalPolicy | undefined,
    session: SessionRecord
  ) {
    return toolLoopCheckApprovals(this.toolLoopDeps(), validToolCalls, context, filePolicy, session);
  }

  /** Execute tool calls in parallel chunks. */
  private async executeToolCalls(
    validToolCalls: Extract<MessagePart, { type: 'tool_call' }>[],
    context: RunContext,
    allowExternalAiTools: boolean,
    sessionId: string
  ) {
    return toolLoopExecuteCalls(
      this.toolLoopDeps(),
      validToolCalls,
      context,
      allowExternalAiTools,
      sessionId
    );
  }

  /** Store tool results, clean up external AI approvals, attach artifacts. */
  private processToolResults(
    results: Awaited<ReturnType<typeof toolLoopExecuteCalls>>,
    validToolCalls: Extract<MessagePart, { type: 'tool_call' }>[],
    session: SessionRecord,
    task: TaskRecord | undefined,
    sessionId: string,
    onModelStreamChunk?: (chunk: ModelStreamChunk) => void
  ): void {
    toolLoopProcessResults(
      this.toolLoopDeps(),
      results,
      validToolCalls,
      session,
      task,
      sessionId,
      onModelStreamChunk
    );
  }

  private async runTurnWithRetries(
    input: ModelTurnInput & { signal?: AbortSignal },
    onStream?: (chunk: ModelStreamChunk) => void
  ): Promise<ModelTurnResult> {
    return toolLoopRunTurn(this.modelAdapter, input, onStream);
  }

  private createToolServices() {
    return buildToolServices({
      store: this.store,
      stateDir: this.stateDir,
      resolveSkillLoad: (name, sessionId) => this.resolveSkillLoad(name, sessionId),
      unblockDependentTasks: (taskId) => this.unblockDependentTasks(taskId),
      spawnSubagent: (context, prompt, role, opts) => this.spawnSubagent(context, prompt, role, opts),
      spawnTeammate: (context, input) => this.spawnTeammate(context, input),
      startBackgroundJob: (sessionId, command) => this.startBackgroundJob(sessionId, command)
    });
  }

  /** Resolve a skill load request with routing/shortlist validation. */
  private async resolveSkillLoad(name: string, sessionId: string): Promise<{ content?: string; error?: string }> {
    const skills = await this.promptBuilder.allSkills();
    const normalizedName = name.trim().toLowerCase();
    const found = skills.find((skill) => {
      const lookupKeys = [skill.name, skill.id, ...(skill.aliases ?? [])];
      return lookupKeys.some((candidate) => candidate.trim().toLowerCase() === normalizedName);
    });
    if (!found?.content) {
      return { error: `Skill "${name}" not found.` };
    }

    const mode = skillRoutingModeFromEnv(process.env);
    const routing = this.promptBuilder.getRouting(sessionId);
    const shortlist = new Set(routing?.shortlistNames ?? []);

    const inShortlist = mode === 'legacy' || !routing
      ? true
      : shortlist.has(found.name) || shortlist.has(found.id);
    const isStrict = mode !== 'legacy' && skillLoadStrictFromEnv(process.env);

    if (isStrict && !inShortlist) {
      const suggestions = routing?.routed.slice(0, 3).map(r => r.skill.name).join(', ');
      void this.emitTrace(sessionId, {
        kind: 'skill_load',
        payload: { name, skillId: found.id, skillName: found.name, inShortlist: false, rejected: true, reason: 'strict_off_shortlist', confidence: routing?.confidence.level }
      });
      return { error: `Skill "${found.name}" is not in the current turn's shortlist. Strict mode is ON. Try one of these: ${suggestions || 'none suggested'}` };
    }

    void this.emitTrace(sessionId, {
      kind: 'skill_load',
      payload: { name, skillId: found.id, skillName: found.name, inShortlist, rejected: false, override: !inShortlist && mode !== 'legacy', confidence: routing?.confidence.level }
    });
    const progressive = envBool(process.env, 'RAW_AGENT_SKILL_PROGRESSIVE', true);
    const disclosed = discloseSkillBody(found.content, { progressive });
    return { content: formatDisclosedSkillContent(disclosed) };
  }

  private async ensureWorkspaceRoot(session: SessionRecord, task?: TaskRecord): Promise<string | undefined> {
    if (!task) {
      return undefined;
    }

    if (task.workspaceId) {
      return this.store.getWorkspace(task.workspaceId)?.rootPath;
    }

    const workspace = await this.workspaceManager.createForTask(task.id, task.title);
    this.store.createWorkspace(workspace);
    this.store.updateTask(task.id, { workspaceId: workspace.id });
    this.store.updateSession(session.id, { workspaceId: workspace.id });
    this.store.appendEvent({
      taskId: task.id,
      kind: 'workspace.bound',
      actor: 'system',
      payload: {
        workspaceId: workspace.id,
        rootPath: workspace.rootPath
      }
    });
    return workspace.rootPath;
  }

  /**
   * Returns the visible message window for a session.
   * Uses episodic selection with cognitive state adaptation to preserve context
   * from earlier conversation episodes when message history exceeds the threshold.
   * Inspired by EpiCache (arXiv:2509.17396) and GCSD cognitive state modeling (arXiv:2603.10034).
   * Summary is NOT injected here — it lives in the dynamic context block of the system prompt,
   * preventing double-write and keeping message history structure stable across turns.
   */
  private visibleMessages(session: SessionRecord): SessionMessage[] {
    const messages = this.store.listMessages(session.id);
    if (messages.length <= MAX_VISIBLE_MESSAGES) {
      return messages;
    }

    // Check if episodic selection is enabled (default: true for better long-conversation support)
    const useEpisodic = envBool(process.env, 'RAW_AGENT_EPISODIC_SELECTION', true);

    if (!useEpisodic) {
      // Fall back to simple truncation
      return messages.slice(-MAX_VISIBLE_MESSAGES);
    }

    // Check if cognitive state adaptation is enabled (default: true)
    const useCognitiveState = envBool(process.env, 'RAW_AGENT_COGNITIVE_STATE_SELECTION', true);

    // Use episodic selection with token budget
    // Budget: estimate ~1000 tokens per message, capped at 24k total
    const tokenBudget = envInt(process.env, 'RAW_AGENT_EPISODIC_TOKEN_BUDGET', 24_000);

    if (useCognitiveState) {
      // Use cognitive state-adapted selection for phase-aware context
      const result = selectEpisodicMessagesWithCognitiveState(messages, tokenBudget);
      // Store cognitive phase for system prompt injection
      this.promptBuilder.lastCognitivePhaseBySession.set(session.id, {
        phase: result.cognitivePhase,
        confidence: result.cognitiveConfidence
      });
      return result.selected;
    }

    const selected = selectEpisodicMessages(messages, tokenBudget, {
      minRecentMessages: MAX_VISIBLE_MESSAGES,
      includeInitialContext: true
    });

    return selected;
  }

  private async autoCompact(context: RunContext): Promise<void> {
    const messages = this.store.listMessages(context.session.id);
    const tokenThreshold = envInt(process.env, 'RAW_AGENT_COMPACT_TOKEN_THRESHOLD', 24_000);
    const rawVisible = this.visibleMessages(context.session);
    const forModel = await this.prepareMessagesForModel(context.session, rawVisible);
    const est = estimateMessageTokens(forModel);
    if (est < tokenThreshold) {
      return;
    }

    const last24 = messages.slice(-MAX_VISIBLE_MESSAGES);
    const last24ForModel = await this.prepareMessagesForModel(context.session, last24);
    const estLast24 = estimateMessageTokens(last24ForModel);
    if (messages.length <= MAX_VISIBLE_MESSAGES) {
      return;
    }
    if (estLast24 >= tokenThreshold) {
      return;
    }

    const preCompact = await runLifecycleHook(process.env, {
      phase: 'pre_compact',
      sessionId: context.session.id,
      context: { estTokens: est, reason: 'token_threshold' }
    });
    if (lifecycleBlocks(preCompact)) {
      void this.emitTrace(context.session.id, {
        kind: 'compact_skipped',
        payload: { reason: preCompact.message ?? 'pre_compact blocked' }
      });
      return;
    }
    if (preCompact.systemMessage || preCompact.message) {
      this.store.appendMessage(context.session.id, 'system', [
        textPart(`[pre-compact] ${preCompact.systemMessage ?? preCompact.message}`)
      ]);
    }

    const onCompactExt = await this.extensionRegistry.run('on_compact', {
      sessionId: context.session.id,
      agentId: context.agent.id,
      meta: { estTokens: est, reason: 'token_threshold' }
    });
    if (onCompactExt.block) {
      void this.emitTrace(context.session.id, {
        kind: 'compact_skipped',
        payload: { reason: onCompactExt.message ?? 'on_compact extension blocked' }
      });
      return;
    }
    if (onCompactExt.systemMessage) {
      this.store.appendMessage(context.session.id, 'system', [
        textPart(`[on-compact] ${onCompactExt.systemMessage}`)
      ]);
    }

    const keep = messages.slice(-MAX_VISIBLE_MESSAGES);
    const older = messages.slice(0, -MAX_VISIBLE_MESSAGES);
    const summary = await this.modelAdapter.summarizeMessages({
      agent: context.agent,
      messages: older,
      reason: `compact session ${context.session.id}`
    });

    await this.archiveMessages(context.session.id, older);
    const maxSummaryChars = compactSummaryMaxChars(process.env);
    let mergedSummary = context.session.summary ? `${context.session.summary}\n\n${summary}` : summary;
    mergedSummary = capRollingSummaryText(mergedSummary, maxSummaryChars);
    this.store.updateSession(context.session.id, {
      summary: mergedSummary
    });
    this.store.appendMessage(context.session.id, 'system', [textPart('Context compacted. Continuing with summary plus recent turns.')]);
    void this.emitTrace(context.session.id, { kind: 'compact', payload: { estTokens: est } });

    void keep;
  }

  private async archiveMessages(sessionId: string, messages: SessionMessage[]): Promise<void> {
    const dir = join(this.stateDir, 'transcripts', sessionId);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${Date.now()}.jsonl`);
    await writeFile(path, messages.map((message) => JSON.stringify(message)).join('\n'), 'utf8');
  }

  /** Swarm teammate is done when completed, or idle after at least one assistant/tool turn. */
  private sessionTeammateFinished(sessionId: string): boolean {
    const session = this.store.getSession(sessionId);
    if (!session) return false;
    if (session.status === 'completed') return true;
    if (session.status !== 'idle') return false;
    return this.store.listMessages(sessionId).some((m) => m.role === 'assistant' || m.role === 'tool');
  }

  private async runOrchestrationResearch(run: OrchestrationRun): Promise<string> {
    const researchStore = this.store.research();
    const task = researchStore.createTask({
      query: run.title,
      scope: run.sourceRef,
      capabilityTags: [...run.capabilityTags]
    });
    await new ResearchPipeline({
      store: researchStore,
      stateDir: this.stateDir,
      env: process.env
    }).runTask(task.id);
    return `research:${task.id}`;
  }

  private async runOrchestrationSubagentStage(
    run: OrchestrationRun,
    stage: 'review' | 'test'
  ): Promise<string> {
    const agentId = stage === 'test' ? 'evaluator' : 'reviewer';
    const spec =
      builtinAgents.find((a) => a.id === agentId) ??
      builtinAgents.find((a) => a.id === 'general') ??
      builtinAgents[0]!;
    this.ensureAgent(spec);
    const subagent = this.store.createSession({
      title: `Orchestration ${stage}: ${run.title.slice(0, 60)}`,
      mode: 'subagent',
      agentId,
      background: false,
      metadata: { orchestrationRunId: run.id, orchestrationStage: stage }
    });
    const prompt =
      stage === 'review'
        ? `Review this orchestration item.\nTitle: ${run.title}\nSource: ${run.sourceRef}\nTags: ${run.capabilityTags.join(', ')}\nGive a brief pass/fail review.`
        : `Run a lightweight harness check for:\nTitle: ${run.title}\nSource: ${run.sourceRef}\nReport pass/fail in one short paragraph.`;
    this.store.appendMessage(subagent.id, 'user', [textPart(prompt)]);
    await this.runSession(subagent.id);
    const summary = (this.getLatestAssistantText(subagent.id) ?? 'no-output').slice(0, 200);
    return `${stage}:${subagent.id}:${summary}`;
  }

  private async spawnSubagent(
    context: RunContext,
    prompt: string,
    role?: string,
    opts?: Omit<SubagentSpawnArgs, 'prompt' | 'role'>
  ): Promise<string> {
    const parentAgent = context.agent;
    const agentId = resolveSubagentAgentId(role, parentAgent.id);
    const childMeta: Record<string, unknown> = {
      parentSessionId: context.session.id,
      subagentRole: role ?? parentAgent.role
    };
    if (opts?.allowedTools?.length) {
      childMeta.allowedTools = opts.allowedTools;
    }
    if (opts?.model) {
      childMeta.modelOverride = opts.model;
    }
    if (opts?.minConfidence != null) {
      childMeta.minConfidence = opts.minConfidence;
    }

    // Inherit parent permission mode unless child overrides later
    if (context.session.metadata?.permissionMode) {
      childMeta.permissionMode = context.session.metadata.permissionMode;
    }

    const subagent = this.store.createSession({
      title: `Subagent: ${role ?? parentAgent.role}`,
      mode: 'subagent',
      agentId,
      taskId: context.task?.id,
      parentSessionId: context.session.id,
      background: false,
      metadata: childMeta
    });

    this.store.copySessionMemory(context.session.id, subagent.id, 'scratch');
    const reviewHint =
      role === 'review' || role === 'evaluator' || role === 'reviewer'
        ? `\n\nWhen finished, include a line: confidence: <0-100>`
        : '';
    this.store.appendMessage(subagent.id, 'user', [textPart(`${prompt}${reviewHint}`)]);
    await this.runSession(subagent.id);
    const raw = this.getLatestAssistantText(subagent.id) ?? '(subagent returned no text)';
    const summary = formatSubagentSummary({
      text: raw,
      sessionId: subagent.id,
      role,
      minConfidence: opts?.minConfidence ?? (role === 'review' || role === 'evaluator' ? 80 : undefined),
      summaryMaxChars: opts?.summaryMaxChars
    });
    return summary.text;
  }

  private async spawnTeammate(
    context: RunContext,
    input: { name: string; role: string; prompt: string }
  ): Promise<string> {
    const session = this.createTeammateSession({
      name: input.name,
      role: input.role,
      prompt: input.prompt,
      taskId: context.task?.id,
      parentSessionId: context.session.id,
      background: true
    });
    this.store.copySessionMemory(context.session.id, session.id, 'scratch');
    await this.runSession(session.id);
    return `Spawned teammate ${input.name} in session ${session.id}`;
  }

  private ensureAgent(agent: AgentSpec): AgentSpec {
    const existing = this.store.getAgent(agent.id);
    if (existing) {
      return existing;
    }
    this.store.upsertAgent(agent);
    return agent;
  }

  private async startBackgroundJob(sessionId: string, command: string): Promise<BackgroundJobRecord> {
    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new NotFoundError('Session', sessionId);
    }

    const workspaceRoot = session.workspaceId ? this.store.getWorkspace(session.workspaceId)?.rootPath : undefined;
    const cwd = workspaceRoot ?? this.repoRoot;
    const job = this.store.createBackgroundJob({
      sessionId,
      command,
      status: 'running'
    });

    // Route through AgentSandbox: native OS sandbox or remote/microservice runner
    if (!this.sandbox) this.sandbox = createAgentSandboxFromEnv();
    const ac = new AbortController();
    this.backgroundJobAborts.set(job.id, ac);
    this.sandbox
      .execute({
        command,
        cwd,
        workspace: cwd,
        signal: ac.signal,
        sessionId
      })
      .then((result) => {
      this.backgroundJobAborts.delete(job.id);
      const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n') || '(no output)';
      this.store.updateBackgroundJob(job.id, 'completed', output);
      this.store.appendMessage(sessionId, 'user', [textPart(`Background job ${job.id} completed.\n${output.slice(0, 4000)}`)]);
    }).catch((error) => {
      this.backgroundJobAborts.delete(job.id);
      this.store.updateBackgroundJob(job.id, 'error', String(error));
      this.store.appendMessage(sessionId, 'user', [textPart(`Background job ${job.id} failed: ${String(error)}`)]);
    });

    return job;
  }

  private async ingestMailbox(session: SessionRecord): Promise<void> {
    const pending = this.store.listMailbox(session.agentId, true);
    if (pending.length === 0) {
      return;
    }

    const delivered = pending.map((mail) => this.store.markMailRead(mail.id));
    const text = delivered
      .map((mail) => `[${mail.type}] from ${mail.fromAgentId}${mail.correlationId ? ` (${mail.correlationId})` : ''}: ${mail.content}`)
      .join('\n');

    this.store.appendMessage(session.id, 'user', [textPart(`Inbox:\n${text}`)]);
  }

  private async autoClaimTask(session: SessionRecord): Promise<void> {
    if (session.mode !== 'teammate') {
      return;
    }

    const available = this.store
      .listTasks({ status: 'pending' })
      .find((task) => !task.ownerAgentId && task.blockedBy.length === 0);

    if (!available) {
      return;
    }

    this.store.updateTask(available.id, {
      ownerAgentId: session.agentId,
      status: 'in_progress',
      sessionId: session.id
    });
    this.store.appendMessage(
      session.id,
      'user',
      [textPart(`You auto-claimed task ${available.id}: ${available.title}\n${available.description}`)]
    );
  }

  private async processAutonomousSessions(): Promise<void> {
    await this.autonomousScheduler.tick();
  }

  private async unblockDependentTasks(completedTaskId: string): Promise<void> {
    const tasks = this.store.listTasks();
    for (const task of tasks) {
      if (!task.blockedBy.includes(completedTaskId)) {
        continue;
      }

      const nextBlockedBy = task.blockedBy.filter((candidate) => candidate !== completedTaskId);
      const nextStatus = task.status === 'pending' ? 'pending' : nextBlockedBy.length === 0 ? 'pending' : task.status;
      this.store.updateTask(task.id, {
        blockedBy: nextBlockedBy,
        status: nextStatus
      });
    }
  }

  /** Gracefully shut down all in-flight work, MCP sessions, and release SQLite. */
  async destroy(): Promise<void> {
    // 1. Abort every in-flight session (model HTTP calls, tool executions).
    for (const ac of this.sessionAbortControllers.values()) {
      try { ac.abort(); } catch { /* best effort */ }
    }
    this.sessionAbortControllers.clear();

    // 2. Abort sandbox-managed background jobs.
    for (const [, ac] of this.backgroundJobAborts) {
      try { ac.abort(); } catch { /* best effort */ }
    }
    this.backgroundJobAborts.clear();

    // 3. MCP stdio child processes.
    await this.mcpManager.destroy();

    // 4. Close the SQLite handle so WAL is checkpointed cleanly.
    try { this.store.db.close(); } catch { /* best effort — may already be closed */ }
  }
}
