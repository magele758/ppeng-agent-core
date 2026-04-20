import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from './logger.js';
import { NotFoundError, ValidationError } from './errors.js';
import { createSandboxFromEnv, type SandboxManager } from './sandbox/os-sandbox.js';
import { SelfHealScheduler, type SelfHealContext } from './self-heal/self-heal-scheduler.js';
import { PromptBuilder, type PromptContext } from './model/prompt-builder.js';
import {
  contextHasApprovalPolicy,
  parseApprovalPolicyFromEnv,
  policyRequiresApproval,
  policySkipsAutoApproval,
  type ApprovalPolicy
} from './approval/approval-policy.js';
import {
  filePolicyRequiresBashApproval,
  filePolicyRequiresPathApproval,
  loadPolicyFromRepo,
  mergeApprovalPolicies,
  type FileApprovalPolicy
} from './approval/policy-loader.js';
import { runToolHook } from './tools/tool-hooks.js';
import { envToolResultMaxChars, findToolByName, partitionForParallel, truncateToolContent } from './tools/tool-orchestration.js';
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
import {
  imageBufferToDataUrl,
  touchImageAccess
} from './image-assets.js';
import { SqliteStateStore } from './storage.js';
import { readSessionTraceEvents } from './stores/read-traces.js';
import { appendTraceEvent } from './stores/trace.js';
import type { TraceEvent } from './stores/trace.js';
import { createBuiltinTools, type RuntimeToolServices } from './tools/builtin-tools.js';
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
  HARNESS_ARTIFACT_DIR,
  HARNESS_ARTIFACT_FILES,
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
  type TaskArtifact,
  type TaskRecord,
  type ToolContract,
  type TodoItem
} from './types.js';
import type { ApiSocialPostScheduleItem } from './api-types.js';
import { type SocialPostDeliverFn } from './social-schedule.js';
import { SocialScheduleService, type SocialScheduleAction } from './services/social-schedule-service.js';
import { AutonomousScheduler } from './services/autonomous-scheduler.js';
import { ImageIngestService } from './services/image-ingest-service.js';
import { WorkspaceManager } from './workspaces.js';
import { McpManager } from './mcp/mcp-manager.js';
import { envInt, envBool } from './env.js';

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
  /** Max tool calls executed in parallel when none need approval (default 8). */
  maxParallelToolCalls?: number;
}

function textPart(text: string): MessagePart {
  return {
    type: 'text',
    text
  };
}

/** Recursively sort object keys for deterministic JSON serialization. */
function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  return Object.keys(obj as Record<string, unknown>).sort().reduce((acc, key) => {
    acc[key] = sortKeys((obj as Record<string, unknown>)[key]);
    return acc;
  }, {} as Record<string, unknown>);
}

/** Deterministic JSON serialization for idempotency hashing (deep sorted keys). */
function stableJsonHash(toolName: string, input: unknown): string {
  const stable = JSON.stringify(sortKeys(input));
  return createHash('sha256').update(`${toolName}:${stable}`).digest('hex').slice(0, 32);
}

/** Safely extract a string field from tool call input. */
function extractInputString(input: unknown, key: string): string {
  if (typeof input === 'object' && input && key in input) {
    return String((input as Record<string, unknown>)[key] ?? '');
  }
  return '';
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
  readonly workspaceManager: WorkspaceManager;
  readonly modelAdapter: ModelAdapter;
  readonly selfHeal: SelfHealScheduler;
  readonly promptBuilder: PromptBuilder;
  tools: ToolContract<any>[];

  private readonly maxParallelToolCalls: number;
  private readonly maxTurnsPerRun: number;
  /** AbortControllers for sandbox-managed background jobs (only path actually used; legacy spawn-tracker removed). */
  private readonly backgroundJobAborts = new Map<string, AbortController>();
  private sandbox: SandboxManager | undefined;
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
  /** Sub-service: image ingest + retention sweep. */
  private readonly imageIngest: ImageIngestService;

  constructor(options: RuntimeOptions) {
    this.repoRoot = options.repoRoot;
    this.stateDir = options.stateDir;
    this.store = new SqliteStateStore(join(this.stateDir, 'runtime.sqlite'));
    this.workspaceManager = new WorkspaceManager(join(this.stateDir, 'workspaces'), this.repoRoot);
    this.modelAdapter = options.modelAdapter ?? createModelAdapterFromEnv(process.env);
    this.maxParallelToolCalls = options.maxParallelToolCalls ?? envInt(process.env, 'RAW_AGENT_MAX_PARALLEL_TOOLS', 8);
    this.maxTurnsPerRun = envInt(process.env, 'RAW_AGENT_MAX_TURNS', 24);
    this.envApprovalPolicy = parseApprovalPolicyFromEnv(process.env);

    this.promptBuilder = new PromptBuilder({
      store: this.store,
      repoRoot: this.repoRoot,
      extraSkills: options.extraSkills,
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

    const baseTools = options.tools ?? createBuiltinTools(this.createToolServices());
    this.tools = [...baseTools, ...(options.extraTools ?? [])];
    this.mcpManager = new McpManager({ stateDir: this.stateDir, tools: this.tools, env: process.env, log: this.log });
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
    void appendTraceEvent(this.stateDir, sessionId, { kind: 'cancel', payload: {} });
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
        autoRun: true
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
        void appendTraceEvent(this.stateDir, session.id, {
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
    await this.processAutonomousSessions();
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
        const context: RunContext = {
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
        void appendTraceEvent(this.stateDir, sid, {
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
        const turnTools = agent.allowedTools && agent.allowedTools.length > 0
          ? externallyGated.filter((t) => agent.allowedTools!.includes(t.name))
          : externallyGated;

        let turnResult: ModelTurnResult;
        try {
          turnResult = await this.runTurnWithRetries(
            {
              agent,
              systemPrompt,
              messages: visibleMessages,
              tools: turnTools,
              signal,
              resolveImageDataUrl
            },
            options?.onModelStreamChunk
          );
        } catch (error) {
          void appendTraceEvent(this.stateDir, sid, {
            kind: 'model_error',
            payload: { message: error instanceof Error ? error.message : String(error) }
          });
          throw error;
        }

        void appendTraceEvent(this.stateDir, sid, {
          kind: 'turn_end',
          payload: { stopReason: turnResult.stopReason }
        });

        if (turnResult.assistantParts.length === 0) {
          this.store.updateSession(session.id, { status: 'failed' });
          throw new ValidationError('Model returned no assistant content');
        }

        this.store.appendMessage(session.id, 'assistant', turnResult.assistantParts);

        if (turnResult.stopReason !== 'tool_use') {
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

        const approvalResult = this.checkToolApprovals(validToolCalls, context, filePolicy, allowExternalAiTools, session);
        if (approvalResult === 'waiting') {
          return this.store.updateSession(session.id, { status: 'waiting_approval' });
        }
        if (approvalResult === 'skip') {
          continue;
        }

        const results = await this.executeToolCalls(validToolCalls, context, allowExternalAiTools, sid);
        this.processToolResults(results, validToolCalls, session, task, sid, options?.onModelStreamChunk);
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
    return updated;
  }

  /** Filter tool calls: reject external AI calls when gate is off, keep valid ones. */
  private filterValidToolCalls(
    toolCalls: Extract<MessagePart, { type: 'tool_call' }>[],
    allowExternalAiTools: boolean,
    sessionId: string
  ): Extract<MessagePart, { type: 'tool_call' }>[] {
    const valid: Extract<MessagePart, { type: 'tool_call' }>[] = [];
    for (const tc of toolCalls) {
      const t = findToolByName(this.tools, tc.name);
      if (t?.isExternal && !allowExternalAiTools) {
        this.store.appendMessage(sessionId, 'tool', [{
          type: 'tool_result', toolCallId: tc.toolCallId, name: tc.name,
          ok: false, content: `Tool ${tc.name} is not available in this session`
        }]);
      } else {
        valid.push(tc);
      }
    }
    return valid;
  }

  /** Check if any tool call requires approval; return 'waiting' | 'skip' | 'proceed'. */
  private checkToolApprovals(
    validToolCalls: Extract<MessagePart, { type: 'tool_call' }>[],
    context: RunContext,
    filePolicy: FileApprovalPolicy | undefined,
    allowExternalAiTools: boolean,
    session: SessionRecord
  ): 'waiting' | 'skip' | 'proceed' {
    const policy = this.envApprovalPolicy ?? contextHasApprovalPolicy(context);
    const sid = session.id;

    const needsApproval = (tool: ToolContract<any>, toolCall: Extract<MessagePart, { type: 'tool_call' }>) => {
      if (policyRequiresApproval(policy, tool.name)) return true;
      if (filePolicy) {
        if (tool.name === 'bash') {
          const cmd = extractInputString(toolCall.input, 'command');
          if (filePolicyRequiresBashApproval(filePolicy, cmd)) return true;
        }
        if (tool.name === 'write_file' || tool.name === 'edit_file') {
          const p = extractInputString(toolCall.input, 'path');
          if (filePolicyRequiresPathApproval(filePolicy, tool.name, p)) return true;
        }
      }
      if (policy?.defaultRisky && tool.approvalMode === 'auto') return true;
      if (tool.approvalMode === 'always') return true;
      if (policySkipsAutoApproval(policy, tool.name)) return false;
      return tool.approvalMode === 'auto' && tool.needsApproval?.(context, toolCall.input) === true;
    };

    const pendingApproval = validToolCalls.find((tc) => {
      const t = findToolByName(this.tools, tc.name);
      return t ? needsApproval(t, tc) : false;
    });

    if (!pendingApproval) return 'proceed';

    const tool = findToolByName(this.tools, pendingApproval.name);
    if (!tool) {
      this.store.appendMessage(sid, 'tool', [{
        type: 'tool_result', toolCallId: pendingApproval.toolCallId,
        name: pendingApproval.name, ok: false, content: `Unknown tool ${pendingApproval.name}`
      }]);
      return 'skip';
    }

    const idemKey = tool.approvalMode !== 'never'
      ? stableJsonHash(tool.name, pendingApproval.input) : undefined;
    const existingApproved = idemKey
      ? this.store.listApprovals({ status: 'approved' }).find(
          (a) => a.sessionId === sid && a.idempotencyKey === idemKey)
      : undefined;

    if (!existingApproved) {
      this.store.createApproval({
        sessionId: sid, toolName: tool.name,
        reason: `Approval required for ${tool.name}`,
        args: pendingApproval.input, idempotencyKey: idemKey
      });
      return 'waiting';
    }
    return 'proceed';
  }

  /** Execute tool calls in parallel chunks. */
  private async executeToolCalls(
    validToolCalls: Extract<MessagePart, { type: 'tool_call' }>[],
    context: RunContext,
    allowExternalAiTools: boolean,
    sessionId: string
  ): Promise<Array<{ toolCallId: string; name: string; ok: boolean; content: string; isExternal?: boolean; artifacts?: TaskArtifact[]; metadata?: Record<string, unknown> }>> {
    const results: Array<{ toolCallId: string; name: string; ok: boolean; content: string; isExternal?: boolean; artifacts?: TaskArtifact[]; metadata?: Record<string, unknown> }> = [];

    for (const chunk of partitionForParallel(validToolCalls, this.maxParallelToolCalls)) {
      const chunkResults = await Promise.all(
        chunk.map((tc) => this.executeSingleTool(tc, context, allowExternalAiTools, sessionId))
      );
      results.push(...chunkResults);
    }
    return results;
  }

  /** Execute one tool call with hooks, truncation, and tracing. */
  private async executeSingleTool(
    toolCall: Extract<MessagePart, { type: 'tool_call' }>,
    context: RunContext,
    allowExternalAiTools: boolean,
    sessionId: string
  ): Promise<{ toolCallId: string; name: string; ok: boolean; content: string; isExternal?: boolean; artifacts?: TaskArtifact[]; metadata?: Record<string, unknown> }> {
    const tool = findToolByName(this.tools, toolCall.name);
    if (!tool) {
      return { toolCallId: toolCall.toolCallId, name: toolCall.name, ok: false, content: `Unknown tool ${toolCall.name}`, artifacts: undefined };
    }
    if (tool.isExternal && !allowExternalAiTools) {
      return { toolCallId: toolCall.toolCallId, name: tool.name, ok: false, content: `Tool ${tool.name} is not available in this session`, isExternal: true, artifacts: undefined };
    }

    void appendTraceEvent(this.stateDir, sessionId, { kind: 'tool_start', payload: { name: tool.name } });

    const pre = await runToolHook(process.env, {
      phase: 'pre_tool_use', tool: tool.name, sessionId, input: toolCall.input
    });
    if (pre.block) {
      return { toolCallId: toolCall.toolCallId, name: tool.name, ok: false, content: pre.message ?? 'blocked by pre_tool_use hook', artifacts: undefined };
    }

    const execInput = pre.input !== undefined ? pre.input : toolCall.input;
    try {
      let result = await tool.execute(context, execInput);
      const maxChars = envToolResultMaxChars(process.env);
      result = { ...result, content: truncateToolContent(result.content, maxChars) };
      void maybeExportOtelSpan(process.env, this.stateDir, sessionId, `tool.${tool.name}`, { ok: String(result.ok) });
      await runToolHook(process.env, {
        phase: 'post_tool_use', tool: tool.name, sessionId, input: execInput, ok: result.ok, content: result.content
      });
      return { toolCallId: toolCall.toolCallId, name: tool.name, ok: result.ok, content: result.content, isExternal: tool.isExternal, artifacts: result.artifacts, metadata: result.metadata };
    } catch (error) {
      const content = error instanceof Error ? error.message : String(error);
      await runToolHook(process.env, {
        phase: 'post_tool_use', tool: tool.name, sessionId, input: execInput, ok: false, content
      });
      return { toolCallId: toolCall.toolCallId, name: tool.name, ok: false, content, isExternal: tool.isExternal, artifacts: undefined };
    }
  }

  /** Store tool results, clean up external AI approvals, attach artifacts. */
  private processToolResults(
    results: Array<{ toolCallId: string; name: string; ok: boolean; content: string; isExternal?: boolean; artifacts?: TaskArtifact[]; metadata?: Record<string, unknown> }>,
    validToolCalls: Extract<MessagePart, { type: 'tool_call' }>[],
    session: SessionRecord,
    task: TaskRecord | undefined,
    sessionId: string,
    onModelStreamChunk?: (chunk: ModelStreamChunk) => void
  ): void {
    for (const r of results) {
      const parts: MessagePart[] = [{
        type: 'tool_result', toolCallId: r.toolCallId, name: r.name,
        ok: r.ok, content: r.content, isExternal: r.isExternal
      }];

      // A2UI: when a tool returns envelope messages in metadata.a2uiMessages,
      // persist a SurfaceUpdatePart alongside the tool_result so reload replays
      // the surface, and emit a2ui_message stream chunks for live SSE clients.
      const a2uiMessages = Array.isArray(r.metadata?.a2uiMessages)
        ? (r.metadata!.a2uiMessages as unknown[])
        : undefined;
      if (a2uiMessages && a2uiMessages.length > 0) {
        const surfaceId =
          typeof r.metadata?.a2uiSurfaceId === 'string' ? (r.metadata!.a2uiSurfaceId as string) : '';
        const catalogId =
          typeof r.metadata?.a2uiCatalogId === 'string' ? (r.metadata!.a2uiCatalogId as string) : '';
        if (surfaceId) {
          parts.push({
            type: 'surface_update',
            surfaceId,
            catalogId,
            messages: a2uiMessages
          });
          if (onModelStreamChunk) {
            for (const env of a2uiMessages) {
              try {
                onModelStreamChunk({ type: 'a2ui_message', surfaceId, envelope: env });
              } catch {
                // Stream sink is best-effort; ignore observer errors.
              }
            }
          }
        }
      }

      this.store.appendMessage(session.id, 'tool', parts);
      if (r.isExternal) {
        const idemKey = stableJsonHash(r.name, validToolCalls.find(tc => tc.toolCallId === r.toolCallId)?.input ?? {});
        if (idemKey) {
          const matchingApproval = this.store.listApprovals({ status: 'approved' }).find(
            (a) => a.sessionId === sessionId && a.idempotencyKey === idemKey
          );
          if (matchingApproval) this.store.deleteApproval(matchingApproval.id);
        }
      }
      if (task && r.artifacts?.length) {
        const latestTask = this.store.getTask(task.id) as TaskRecord;
        this.store.updateTask(task.id, { artifacts: [...latestTask.artifacts, ...r.artifacts] });
      }
      void appendTraceEvent(this.stateDir, sessionId, { kind: 'tool_end', payload: { name: r.name, ok: r.ok } });
    }
  }

  private async runTurnWithRetries(
    input: ModelTurnInput & { signal?: AbortSignal },
    onStream?: (chunk: ModelStreamChunk) => void
  ): Promise<ModelTurnResult> {
    const maxRetries = envInt(process.env, 'RAW_AGENT_MODEL_MAX_RETRIES', 2);
    const { signal, ...turnInput } = input;
    const useStream =
      Boolean(onStream) &&
      typeof this.modelAdapter.runTurnStream === 'function' &&
      envBool(process.env, 'RAW_AGENT_STREAM', true);
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (signal?.aborted) {
        throw new Error('Session aborted');
      }
      try {
        if (useStream && onStream) {
          return await this.modelAdapter.runTurnStream!({ ...turnInput, signal }, onStream);
        }
        return await this.modelAdapter.runTurn({ ...turnInput, signal });
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries) {
          break;
        }
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private createToolServices(): RuntimeToolServices {
    return {
      loadSkill: (name, sessionId) => this.resolveSkillLoad(name, sessionId),
      updateTodo: async (sessionId, items) => {
        const session = this.store.getSession(sessionId);
        if (!session) {
          throw new NotFoundError('Session', sessionId);
        }
        return this.store.updateSession(sessionId, { todo: items }).todo;
      },
      createTask: async (input) => this.store.createTask(input),
      getTask: async (taskId) => this.store.getTask(taskId),
      listTasks: async () => this.store.listTasks(),
      updateTask: async (taskId, patch) => {
        const mergedPatch = { ...patch };
        if (patch.metadata) {
          const existing = this.store.getTask(taskId);
          mergedPatch.metadata = { ...(existing?.metadata ?? {}), ...patch.metadata };
        }
        const task = this.store.updateTask(taskId, mergedPatch);
        if (patch.status === 'completed') {
          await this.unblockDependentTasks(taskId);
        }
        return task;
      },
      harnessWriteSpec: async (context, input) => {
        const root = context.workspaceRoot ?? context.repoRoot;
        const relName =
          input.kind === 'product_spec'
            ? HARNESS_ARTIFACT_FILES.productSpec
            : input.kind === 'sprint_contract'
              ? HARNESS_ARTIFACT_FILES.sprintContract
              : HARNESS_ARTIFACT_FILES.evaluatorFeedback;
        const relPath = join(HARNESS_ARTIFACT_DIR, relName);
        const dir = join(root, HARNESS_ARTIFACT_DIR);
        await mkdir(dir, { recursive: true });
        const abs = join(root, relPath);
        await writeFile(abs, input.content, 'utf8');
        return relPath;
      },
      spawnSubagent: async (context, prompt, role) => this.spawnSubagent(context, prompt, role),
      spawnTeammate: async (context, input) => this.spawnTeammate(context, input),
      listAgents: async () => this.store.listAgents(),
      sendMail: async (context, input) =>
        this.store.createMail({
          fromAgentId: context.agent.id,
          toAgentId: input.toAgentId,
          type: input.type ?? 'message',
          content: input.content,
          correlationId: input.correlationId,
          sessionId: context.session.id,
          taskId: context.task?.id
        }),
      readInbox: async (agentId) => {
        const messages = this.store.listMailbox(agentId, true);
        return messages.map((message) => this.store.markMailRead(message.id));
      },
      startBackgroundJob: async (sessionId, command) => this.startBackgroundJob(sessionId, command),
      getBackgroundJob: async (jobId) => this.store.getBackgroundJob(jobId),
      listBackgroundJobs: async (sessionId) => this.store.listBackgroundJobs(sessionId),
      listWorkspaces: async () =>
        this.store.listWorkspaces().map((workspace) => ({
          id: workspace.id,
          taskId: workspace.taskId,
          name: workspace.name,
          rootPath: workspace.rootPath,
          mode: workspace.mode
        })),
      upsertSessionMemory: async (sessionId, scope, key, value, metadata) =>
        this.store.upsertSessionMemory({ sessionId, scope, key, value, metadata }),
      listSessionMemory: async (sessionId, scope) => this.store.listSessionMemory(sessionId, scope),
      deleteSessionMemory: async (sessionId, scope, key) => this.store.deleteSessionMemory(sessionId, scope, key),
      visionAnalyze: async ({ sessionId: sid, assetIds, prompt, signal: sig }) => {
        const vlModel = process.env.RAW_AGENT_VL_MODEL_NAME?.trim();
        const baseUrl = (process.env.RAW_AGENT_VL_BASE_URL ?? process.env.RAW_AGENT_BASE_URL ?? '').trim();
        const apiKey = (process.env.RAW_AGENT_VL_API_KEY ?? process.env.RAW_AGENT_API_KEY ?? '').trim();
        if (!vlModel || !baseUrl || !apiKey) {
          throw new ValidationError('vision_analyze requires RAW_AGENT_VL_MODEL_NAME and API base URL/key');
        }
        const { runOpenAiVisionTurn } = await import('./model/model-adapters.js');
        const urls: string[] = [];
        for (const id of assetIds) {
          const asset = this.store.getImageAsset(id);
          if (!asset || asset.sessionId !== sid) continue;
          await touchImageAccess(this.store, id);
          const u = await imageBufferToDataUrl(this.store, this.stateDir, id);
          if (u) urls.push(u);
        }
        if (urls.length === 0) {
          throw new NotFoundError('image assets', sid);
        }
        return runOpenAiVisionTurn({
          baseUrl,
          apiKey,
          model: vlModel,
          userPrompt: prompt,
          imageDataUrls: urls,
          signal: sig
        });
      }
    };
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
      void appendTraceEvent(this.stateDir, sessionId, {
        kind: 'skill_load',
        payload: { name, skillId: found.id, skillName: found.name, inShortlist: false, rejected: true, reason: 'strict_off_shortlist', confidence: routing?.confidence.level }
      });
      return { error: `Skill "${found.name}" is not in the current turn's shortlist. Strict mode is ON. Try one of these: ${suggestions || 'none suggested'}` };
    }

    void appendTraceEvent(this.stateDir, sessionId, {
      kind: 'skill_load',
      payload: { name, skillId: found.id, skillName: found.name, inShortlist, rejected: false, override: !inShortlist && mode !== 'legacy', confidence: routing?.confidence.level }
    });
    return { content: found.content };
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
    void appendTraceEvent(this.stateDir, context.session.id, { kind: 'compact', payload: { estTokens: est } });

    void keep;
  }

  private async archiveMessages(sessionId: string, messages: SessionMessage[]): Promise<void> {
    const dir = join(this.stateDir, 'transcripts', sessionId);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${Date.now()}.jsonl`);
    await writeFile(path, messages.map((message) => JSON.stringify(message)).join('\n'), 'utf8');
  }

  private async spawnSubagent(context: RunContext, prompt: string, role?: string): Promise<string> {
    const parentAgent = context.agent;
    const normalized = role?.toLowerCase();
    const agentId =
      normalized === 'review'
        ? 'reviewer'
        : normalized === 'evaluator'
          ? 'evaluator'
          : normalized === 'research'
            ? 'researcher'
            : normalized === 'implement'
              ? 'implementer'
              : normalized === 'generator'
                ? 'generator'
                : normalized === 'planner'
                  ? 'planner'
                  : parentAgent.id;
    const subagent = this.store.createSession({
      title: `Subagent: ${role ?? parentAgent.role}`,
      mode: 'subagent',
      agentId,
      taskId: context.task?.id,
      parentSessionId: context.session.id,
      background: false
    });

    this.store.copySessionMemory(context.session.id, subagent.id, 'scratch');
    this.store.appendMessage(subagent.id, 'user', [textPart(prompt)]);
    await this.runSession(subagent.id);
    return this.getLatestAssistantText(subagent.id) ?? '(subagent returned no text)';
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

    // Route through sandbox (Tier 0 env sanitization + Tier 1 OS sandbox if available)
    if (!this.sandbox) this.sandbox = createSandboxFromEnv();
    const ac = new AbortController();
    this.backgroundJobAborts.set(job.id, ac);
    this.sandbox.execute(command, cwd, { signal: ac.signal }).then((result) => {
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
