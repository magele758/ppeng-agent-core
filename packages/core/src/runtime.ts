import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  contextHasApprovalPolicy,
  parseApprovalPolicyFromEnv,
  policyRequiresApproval,
  policySkipsAutoApproval,
  type ApprovalPolicy
} from './approval-policy.js';
import {
  filePolicyRequiresBashApproval,
  filePolicyRequiresPathApproval,
  loadPolicyFromRepo,
  mergeApprovalPolicies,
  type FileApprovalPolicy
} from './policy-loader.js';
import { runToolHook } from './tool-hooks.js';
import { envToolResultMaxChars, findToolByName, partitionForParallel, truncateToolContent } from './tool-orchestration.js';
import { maybeExportOtelSpan } from './otel.js';
import { builtinAgents } from './builtin-agents.js';
import { builtinSkills, loadAgentsDirSkills, loadWorkspaceSkills, mergeSkillsByName } from './builtin-skills.js';
import {
  buildSkillRouting,
  skillLoadStrictFromEnv,
  skillRoutingModeFromEnv,
  skillRoutingTopKFromEnv,
  type RoutingConfidenceInfo,
  type SkillRoutingResult
} from './skill-router.js';
import { createId } from './id.js';
import {
  createModelAdapterFromEnv,
  textSummaryFromParts
} from './model-adapters.js';
import {
  fetchImageFromUrl,
  imageBufferToDataUrl,
  ingestImageAsset,
  maintainImageRetention,
  touchImageAccess
} from './image-assets.js';
import { SqliteStateStore } from './storage.js';
import { readSessionTraceEvents } from './read-traces.js';
import { appendTraceEvent } from './trace.js';
import type { TraceEvent } from './trace.js';
import { createBuiltinTools, type RuntimeToolServices } from './tools.js';
import { estimateMessageTokens } from './token-estimate.js';
import {
  selectEpisodicMessages,
  selectEpisodicMessagesWithCognitiveState
} from './episodic-selection.js';
import { type CognitivePhase } from './cognitive-state.js';
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
} from './self-heal-executors.js';
import { normalizeSelfHealPolicy, npmScriptForSelfHealPolicy } from './self-heal-policy.js';
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
import { WorkspaceManager } from './workspaces.js';
import { McpStdioSession, parseMcpStdioConfigs, sanitizeMcpToolSuffix } from './mcp-stdio.js';

const MAX_VISIBLE_MESSAGES = 24;
const MAX_MEMORY_ENTRIES = 20;

function envInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const v = Number(env[key]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

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

function formatAgeSince(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '?';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm}m`;
}

export interface RuntimeOptions {
  repoRoot: string;
  stateDir: string;
  modelAdapter?: ModelAdapter;
  agents?: AgentSpec[];
  tools?: ToolContract<any>[];
  /** Max tool calls executed in parallel when none need approval (default 8). */
  maxParallelToolCalls?: number;
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
  readonly repoRoot: string;
  readonly stateDir: string;
  /** 当轮 routing 结果（lexical/hybrid）；用于 load_skill 校验与观测 */
  private routingBySession = new Map<string, SkillRoutingResult>();
  readonly store: SqliteStateStore;
  readonly workspaceManager: WorkspaceManager;
  readonly modelAdapter: ModelAdapter;
  tools: ToolContract<any>[];

  private readonly maxParallelToolCalls: number;
  private readonly maxTurnsPerRun: number;
  private readonly backgroundProcesses = new Map<string, ReturnType<typeof spawn>>();
  private readonly sessionAbortControllers = new Map<string, AbortController>();
  private readonly envApprovalPolicy: ApprovalPolicy | undefined;
  private workspaceSkillsPromise?: Promise<SkillSpec[]>;
  private mcpUrls: string[];
  private mcpToolsPromise?: Promise<void>;
  private mcpExpansionDone = false;
  private readonly mcpStdioSessions: McpStdioSession[] = [];
  private filePolicyCache: FileApprovalPolicy | undefined | null = null;
  /** Self-heal console: last heartbeat time + last printed status (avoid spam). */
  private selfHealHeartbeatAt = new Map<string, number>();
  private selfHealLastPrintedStatus = new Map<string, string>();
  private selfHealMultiRunWarned = false;

  constructor(options: RuntimeOptions) {
    this.repoRoot = options.repoRoot;
    this.stateDir = options.stateDir;
    this.store = new SqliteStateStore(join(this.stateDir, 'runtime.sqlite'));
    this.workspaceManager = new WorkspaceManager(join(this.stateDir, 'workspaces'), this.repoRoot);
    this.modelAdapter = options.modelAdapter ?? createModelAdapterFromEnv(process.env);
    this.maxParallelToolCalls = options.maxParallelToolCalls ?? envInt(process.env, 'RAW_AGENT_MAX_PARALLEL_TOOLS', 8);
    this.maxTurnsPerRun = envInt(process.env, 'RAW_AGENT_MAX_TURNS', 24);
    this.envApprovalPolicy = parseApprovalPolicyFromEnv(process.env);
    this.mcpUrls = (process.env.RAW_AGENT_MCP_URLS ?? process.env.RAW_AGENT_MCP_URL ?? '')
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const agent of options.agents ?? builtinAgents) {
      this.store.upsertAgent(agent);
    }

    this.tools = [...(options.tools ?? createBuiltinTools(this.createToolServices()))];
  }

  /** Abort in-flight model/tool work for a session (best-effort). */
  cancelSession(sessionId: string): void {
    const controller = this.sessionAbortControllers.get(sessionId);
    controller?.abort();
    this.sessionAbortControllers.delete(sessionId);
    const childPids = [...this.backgroundProcesses.entries()];
    for (const [jobId, child] of childPids) {
      const job = this.store.getBackgroundJob(jobId);
      if (job?.sessionId === sessionId) {
        child.kill('SIGTERM');
      }
    }
    void appendTraceEvent(this.stateDir, sessionId, { kind: 'cancel', payload: {} });
  }

  private async ensureMcpTools(sessionId: string): Promise<void> {
    if (this.mcpExpansionDone) {
      return;
    }
    const rt = this;
    const urls = [...this.mcpUrls];
    const stdioConfigs = parseMcpStdioConfigs(process.env);
    const expandStdio = !['0', 'false', 'no'].includes(String(process.env.RAW_AGENT_MCP_EXPAND_STDIO ?? '1').toLowerCase());
    const expandHttp = ['1', 'true', 'yes'].includes(String(process.env.RAW_AGENT_MCP_EXPAND_HTTP ?? '').toLowerCase());

    if (urls.length === 0 && stdioConfigs.length === 0) {
      this.mcpExpansionDone = true;
      return;
    }

    if (!this.mcpToolsPromise) {
      this.mcpToolsPromise = (async () => {
        try {
        const mod = await import('./mcp-jsonrpc.js');
        const { mcpCallTool, mcpListResources, mcpReadResource } = mod;

        if (urls.length > 0 && !this.tools.some((t) => t.name === 'mcp_invoke')) {
          const httpUrls = [...urls];
          const mcpTool: ToolContract<{ server: number; tool: string; arguments?: Record<string, unknown> }> = {
            name: 'mcp_invoke',
            description:
              'Invoke a tool on an HTTP JSON-RPC MCP server. server is 0-based index into RAW_AGENT_MCP_URLS list.',
            inputSchema: {
              type: 'object',
              properties: {
                server: { type: 'number', description: 'MCP server index (from env URL list)' },
                tool: { type: 'string' },
                arguments: { type: 'object' }
              },
              required: ['server', 'tool']
            },
            approvalMode: 'auto',
            sideEffectLevel: 'system',
            needsApproval: () => true,
            async execute(_ctx, args) {
              const url = httpUrls[Math.floor(args.server)];
              if (!url) {
                return { ok: false, content: `Invalid MCP server index ${args.server}` };
              }
              const out = await mcpCallTool(url, args.tool, args.arguments ?? {});
              return { ok: !out.isError, content: out.content };
            }
          };
          this.tools.push(mcpTool);

          if (expandHttp) {
            for (let hi = 0; hi < httpUrls.length; hi++) {
              const baseUrl = httpUrls[hi];
              if (!baseUrl) {
                continue;
              }
              let listed: { name: string; description?: string; inputSchema?: Record<string, unknown> }[] = [];
              try {
                listed = await mod.mcpListTools(baseUrl);
              } catch {
                listed = [];
              }
              for (const t of listed) {
                const name = `mcp_h${hi}_${sanitizeMcpToolSuffix(t.name)}`;
                if (this.tools.some((x) => x.name === name)) {
                  continue;
                }
                const toolName = t.name;
                const bu = baseUrl;
                this.tools.push({
                  name,
                  description: t.description ?? `MCP HTTP server ${hi} tool ${toolName}`,
                  inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object' },
                  approvalMode: 'auto',
                  sideEffectLevel: 'system',
                  needsApproval: () => true,
                  async execute(_ctx, args) {
                    const out = await mcpCallTool(bu, toolName, args as Record<string, unknown>);
                    return { ok: !out.isError, content: out.content };
                  }
                });
              }
            }
          }
        }

        for (let si = 0; si < stdioConfigs.length; si++) {
          const cfg = stdioConfigs[si];
          if (!cfg) {
            continue;
          }
          const session = new McpStdioSession(si, cfg);
          try {
            await session.connect();
            this.mcpStdioSessions.push(session);
            if (expandStdio) {
              const listed = await session.listTools();
              for (const t of listed) {
                const name = `mcp_s${si}_${sanitizeMcpToolSuffix(t.name)}`;
                if (this.tools.some((x) => x.name === name)) {
                  continue;
                }
                const toolName = t.name;
                this.tools.push({
                  name,
                  description: t.description ?? `MCP stdio server ${si} tool ${toolName}`,
                  inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object' },
                  approvalMode: 'auto',
                  sideEffectLevel: 'system',
                  needsApproval: () => true,
                  async execute(_ctx, args) {
                    const out = await session.callTool(toolName, args as Record<string, unknown>);
                    return { ok: !out.isError, content: out.content };
                  }
                });
              }
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            void appendTraceEvent(rt.stateDir, sessionId, {
              kind: 'model_error',
              payload: { mcpStdio: si, message: msg }
            });
          }
        }

        const totalServers = urls.length + rt.mcpStdioSessions.length;
        if (totalServers > 0 && !rt.tools.some((t) => t.name === 'mcp_list_resources')) {
          const listRes: ToolContract<{ server: number }> = {
            name: 'mcp_list_resources',
            description:
              'List MCP resources. server index: 0..N-1 where HTTP URLs (RAW_AGENT_MCP_URLS) come first, then stdio servers (RAW_AGENT_MCP_STDIO order).',
            inputSchema: {
              type: 'object',
              properties: {
                server: { type: 'number' }
              },
              required: ['server']
            },
            approvalMode: 'auto',
            sideEffectLevel: 'system',
            needsApproval: () => false,
            async execute(_ctx, args) {
              const idx = Math.floor(args.server);
              if (idx < 0 || idx >= totalServers) {
                return { ok: false, content: `Invalid server ${args.server}` };
              }
              if (idx < urls.length) {
                const u = urls[idx];
                if (!u) {
                  return { ok: false, content: 'Invalid URL index' };
                }
                try {
                  const r = await mcpListResources(u);
                  return { ok: true, content: JSON.stringify(r, null, 2) };
                } catch (e) {
                  return { ok: false, content: e instanceof Error ? e.message : String(e) };
                }
              }
              const s = rt.mcpStdioSessions[idx - urls.length];
              if (!s) {
                return { ok: false, content: 'Stdio server not connected' };
              }
              const r = await s.listResources();
              return { ok: true, content: JSON.stringify(r, null, 2) };
            }
          };
          rt.tools.push(listRes);
        }

        if (totalServers > 0 && !rt.tools.some((t) => t.name === 'mcp_read_resource')) {
          const readRes: ToolContract<{ server: number; uri: string }> = {
            name: 'mcp_read_resource',
            description: 'Read one MCP resource by URI (same server indexing as mcp_list_resources).',
            inputSchema: {
              type: 'object',
              properties: {
                server: { type: 'number' },
                uri: { type: 'string' }
              },
              required: ['server', 'uri']
            },
            approvalMode: 'auto',
            sideEffectLevel: 'system',
            needsApproval: () => true,
            async execute(_ctx, args) {
              const idx = Math.floor(args.server);
              if (idx < 0 || idx >= totalServers) {
                return { ok: false, content: `Invalid server ${args.server}` };
              }
              if (idx < urls.length) {
                const u = urls[idx];
                if (!u) {
                  return { ok: false, content: 'Invalid URL index' };
                }
                try {
                  const r = await mcpReadResource(u, args.uri);
                  return { ok: true, content: r.mimeType ? `${r.mimeType}\n\n${r.text}` : r.text };
                } catch (e) {
                  return { ok: false, content: e instanceof Error ? e.message : String(e) };
                }
              }
              const s = rt.mcpStdioSessions[idx - urls.length];
              if (!s) {
                return { ok: false, content: 'Stdio server not connected' };
              }
              const r = await s.readResource(args.uri);
              return { ok: true, content: r.mimeType ? `${r.mimeType}\n\n${r.text}` : r.text };
            }
          };
          rt.tools.push(readRes);
        }
        } finally {
          rt.mcpExpansionDone = true;
        }
      })();
    }
    await this.mcpToolsPromise;
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
    this.workspaceSkillsPromise = undefined;
    this.routingBySession.clear();
    this.filePolicyCache = null;
    return this.allSkills();
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
  }): SessionRecord {
    const session = this.store.createSession({
      title: input.title ?? 'Chat Session',
      mode: 'chat',
      agentId: input.agentId?.trim() ? input.agentId.trim() : 'main',
      background: input.background ?? false
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
      throw new Error(`Session ${sessionId} not found`);
    }

    const ids = options?.imageAssetIds?.filter(Boolean) ?? [];
    const text = message.trim();
    if (!text && ids.length === 0) {
      throw new Error('Message or imageAssetIds required');
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
    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    const buf = Buffer.from(input.dataBase64, 'base64');
    return ingestImageAsset(this.store, this.stateDir, {
      sessionId,
      buffer: buf,
      mimeType: input.mimeType,
      sourceType: input.sourceUrl ? 'url' : 'upload',
      sourceUrl: input.sourceUrl
    });
  }

  /** Download image from URL into session store (server-side fetch). */
  async ingestImageFromUrl(sessionId: string, imageUrl: string, signal?: AbortSignal): Promise<ImageAssetRecord> {
    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    const maxBytes = Number(process.env.RAW_AGENT_IMAGE_MAX_BYTES ?? 12_000_000);
    const timeoutMs = Number(process.env.RAW_AGENT_IMAGE_FETCH_TIMEOUT_MS ?? 30_000);
    const { buffer, mimeType } = await fetchImageFromUrl(imageUrl, maxBytes, timeoutMs, signal);
    return ingestImageAsset(this.store, this.stateDir, {
      sessionId,
      buffer,
      mimeType,
      sourceType: 'url',
      sourceUrl: imageUrl
    });
  }

  private async runImageRetention(sessionId: string): Promise<void> {
    const session = this.store.getSession(sessionId);
    if (!session) return;
    try {
      const r = await maintainImageRetention({
        store: this.store,
        stateDir: this.stateDir,
        session
      });
      if (r.contactAsset && r.summaryNote) {
        this.store.appendMessage(sessionId, 'system', [textPart(r.summaryNote)]);
      }
    } catch (e) {
      console.error('image retention failed', e);
    }
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
      throw new Error(`Agent ${input.fromAgentId} not found`);
    }
    if (!this.store.getAgent(input.toAgentId)) {
      throw new Error(`Agent ${input.toAgentId} not found`);
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
    for (const session of this.store.listSessions()) {
      if (session.agentId === agentId && session.background && session.status === 'idle') {
        this.store.enqueueSchedulerWake(session.id, reason);
      }
    }
  }

  private wakeAllAutonomousSessions(reason: string): void {
    for (const session of this.store.listSessions()) {
      if (session.background && session.status === 'idle' && ['task', 'teammate'].includes(session.mode)) {
        this.store.enqueueSchedulerWake(session.id, reason);
      }
    }
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
    await this.processSelfHealRuns();
    await this.processAutonomousSessions();
  }

  /** Create self-heal run (single active run at a time). */
  startSelfHealRun(policy?: Partial<SelfHealPolicy>): SelfHealRunRecord {
    const active = this.store.listActiveSelfHealRuns();
    if (active.length > 0) {
      throw new Error(`Another self-heal run is active: ${active[0]!.id}`);
    }
    const normalized = normalizeSelfHealPolicy(policy);
    const run = this.store.createSelfHealRun({ policy: normalized });
    this.store.appendSelfHealEvent({ runId: run.id, kind: 'created', payload: { policy: normalized } });
    return this.store.getSelfHealRun(run.id) as SelfHealRunRecord;
  }

  stopSelfHealRun(id: string): SelfHealRunRecord {
    return this.store.updateSelfHealRun(id, { stopped: true, status: 'stopped' });
  }

  resumeSelfHealRun(id: string): SelfHealRunRecord {
    const run = this.store.getSelfHealRun(id);
    if (!run) {
      throw new Error(`Self-heal run ${id} not found`);
    }
    if (run.status === 'stopped') {
      return this.store.updateSelfHealRun(id, {
        stopped: false,
        status: 'running_tests',
        blockReason: undefined
      });
    }
    const nextStatus =
      run.status === 'fixing'
        ? 'fixing'
        : run.status === 'merging'
          ? 'merging'
          : 'running_tests';
    return this.store.updateSelfHealRun(id, {
      stopped: false,
      status: run.status === 'blocked' ? 'running_tests' : nextStatus,
      blockReason: undefined
    });
  }

  getSelfHealRun(id: string): SelfHealRunRecord | undefined {
    return this.store.getSelfHealRun(id);
  }

  listSelfHealRuns(limit?: number): SelfHealRunRecord[] {
    return this.store.listSelfHealRuns({ limit });
  }

  listActiveSelfHealRuns(): SelfHealRunRecord[] {
    return this.store.listActiveSelfHealRuns();
  }

  listSelfHealEvents(runId: string, limit?: number): SelfHealEventRecord[] {
    return this.store.listSelfHealEvents(runId, limit);
  }

  getDaemonRestartRequest(): DaemonRestartRequest | undefined {
    return this.store.getDaemonControl<DaemonRestartRequest>('restart_request');
  }

  acknowledgeDaemonRestart(): void {
    const req = this.store.getDaemonControl<DaemonRestartRequest>('restart_request');
    this.store.deleteDaemonControl('restart_request');
    const runId = req?.runId;
    if (runId) {
      const run = this.store.getSelfHealRun(runId);
      if (run?.status === 'restart_pending') {
        this.store.updateSelfHealRun(runId, {
          restartAckAt: new Date().toISOString(),
          status: 'completed'
        });
        this.store.appendSelfHealEvent({ runId, kind: 'restart_acked', payload: {} });
      }
    }
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

  private logSelfHeal(runId: string, message: string): void {
    const short = runId.length > 14 ? runId.slice(-14) : runId;
    console.log(`[self-heal] ${short} ${message}`);
  }

  /** One-line context so heartbeat lines are readable without opening SQLite. */
  private selfHealRunSummary(run: SelfHealRunRecord): string {
    let npm = 'test:unit';
    try {
      npm = npmScriptForSelfHealPolicy(run.policy);
    } catch {
      /* keep default */
    }
    const sid = run.sessionId;
    const sess = sid ? this.store.getSession(sid) : undefined;
    const sessTail = sid ? (sid.length > 10 ? `…${sid.slice(-8)}` : sid) : '—';
    const sessSt = sess?.status ?? '—';
    const branch = run.worktreeBranch ?? '—';
    const age = formatAgeSince(run.createdAt);
    return `phase=${run.status} npm run ${npm} branch=${branch} fix#${run.fixIteration} age=${age} session=${sessTail}(${sessSt})`;
  }

  /** Periodic line so supervised/daemon terminal shows the run is alive (every ~8s per run). */
  private emitSelfHealHeartbeat(run: SelfHealRunRecord): void {
    const terminal = new Set(['completed', 'failed', 'blocked', 'stopped']);
    if (terminal.has(run.status)) {
      this.selfHealHeartbeatAt.delete(run.id);
      this.selfHealLastPrintedStatus.delete(run.id);
      return;
    }
    const st = run.status;
    if (this.selfHealLastPrintedStatus.get(run.id) !== st) {
      this.selfHealLastPrintedStatus.set(run.id, st);
      this.logSelfHeal(run.id, `status → ${st} | ${this.selfHealRunSummary(run)}`);
    }
    const now = Date.now();
    const last = this.selfHealHeartbeatAt.get(run.id) ?? 0;
    if (now - last < 8000) {
      return;
    }
    this.selfHealHeartbeatAt.set(run.id, now);
    const hint = this.selfHealWaitHint(run);
    this.logSelfHeal(run.id, `heartbeat | ${this.selfHealRunSummary(run)} | ${hint}`);
  }

  private selfHealWaitHint(run: SelfHealRunRecord): string {
    const sid = run.sessionId;
    const sess = sid ? this.store.getSession(sid) : undefined;
    switch (run.status) {
      case 'pending':
        return 'starting worktree + task (next: whitelist npm test)';
      case 'running_tests':
        if (sess?.status === 'running') {
          return 'waiting: self-healer chat still active (LLM/tools) — next npm test runs after this session finishes';
        }
        return 'running or scheduling whitelist tests in worktree';
      case 'fixing':
        if (sess?.status === 'running') {
          return 'waiting: fix wave — self-healer model still working';
        }
        return 'fix phase (scheduling)';
      case 'merging':
        return 'merging worktree branch into main (may stash)';
      case 'restart_pending':
        return 'merge done — supervisor must restart daemon (restart-request pending)';
      case 'tests_passed':
        return 'finishing (merge/restart bookkeeping)';
      default:
        return run.status;
    }
  }

  private async processSelfHealRuns(): Promise<void> {
    const active = this.store.listActiveSelfHealRuns();
    for (const run of active) {
      try {
        await this.advanceSelfHealRun(run);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.store.updateSelfHealRun(run.id, { status: 'failed', blockReason: message });
        this.store.appendSelfHealEvent({ runId: run.id, kind: 'error', payload: { message } });
        this.logSelfHeal(run.id, `fatal: ${message}`);
      }
    }
    const activeHb = this.store.listActiveSelfHealRuns();
    if (activeHb.length > 1) {
      if (!this.selfHealMultiRunWarned) {
        this.selfHealMultiRunWarned = true;
        console.log(
          `[self-heal] note: ${activeHb.length} concurrent runs (only one is normal). List: npm run start:cli -- self-heal runs — stop one: npm run start:cli -- self-heal stop <runId>`
        );
      }
    } else {
      this.selfHealMultiRunWarned = false;
    }
    for (const run of activeHb) {
      this.emitSelfHealHeartbeat(run);
    }
  }

  private async advanceSelfHealRun(run: SelfHealRunRecord): Promise<void> {
    const r = this.store.getSelfHealRun(run.id);
    if (!r || r.stopped) {
      return;
    }
    const policy = r.policy;

    if (r.status === 'restart_pending') {
      if (r.restartAckAt) {
        this.logSelfHeal(r.id, 'restart acknowledged — run completed');
        this.store.updateSelfHealRun(r.id, { status: 'completed' });
      }
      return;
    }

    if (r.status === 'pending') {
      const externalAiToolNames = ['claude_code', 'codex_exec', 'cursor_agent'];
      const sessionMeta: Record<string, unknown> = {
        selfHealControlled: true,
        selfHealRunId: r.id
      };
      if (policy.allowExternalAiTools) {
        sessionMeta.approvalPolicy = {
          rules: externalAiToolNames.map((name) => ({ toolPattern: name, match: 'exact', when: 'auto' }))
        };
      }
      const { task, session } = this.createTaskSession({
        title: `Self-heal ${r.id.slice(-8)}`,
        description: `Automated self-heal. Policy: ${JSON.stringify(policy)}`,
        message: [
          `Self-heal run ${r.id}.`,
          'Tests run automatically in this task workspace (git worktree).',
          'STACK: backend = packages/core + apps/daemon (TypeScript); frontend = apps/web-console (Next.js 15 App Router, entry: app/page.tsx → components/AgentLabApp.tsx, helpers in lib/). E2E Playwright tests hit the Next origin; /api/* is proxied to daemon via DAEMON_PROXY_TARGET.',
          policy.allowExternalAiTools
            ? 'You may use claude_code, codex_exec, or cursor_agent for complex fixes; they are pre-approved in this session.'
            : 'Fix using read_file / write_file / edit_file / bash only under the workspace root.',
          'Do not merge into the main repository or run git push; the harness merges after tests pass.',
          `Test command: npm run … (preset ${policy.testPreset}).`
        ].join('\n'),
        agentId: policy.agentId ?? 'self-healer',
        background: true,
        metadata: sessionMeta
      });
      this.store.updateTask(task.id, { status: 'in_progress' });
      this.store.updateSelfHealRun(r.id, {
        status: 'running_tests',
        taskId: task.id,
        sessionId: session.id
      });
      this.store.appendSelfHealEvent({
        runId: r.id,
        kind: 'task_created',
        payload: { taskId: task.id, sessionId: session.id }
      });
      this.logSelfHeal(r.id, 'task + session created; next tick will run tests in worktree');
      return;
    }

    const sessionId = r.sessionId;
    const taskId = r.taskId;
    if (!sessionId || !taskId) {
      this.store.updateSelfHealRun(r.id, { status: 'failed', blockReason: 'missing session or task' });
      return;
    }

    if (r.status === 'running_tests') {
      const wsRoot = await this.bindWorkspaceForTask(taskId);
      if (!wsRoot) {
        this.store.updateSelfHealRun(r.id, { status: 'blocked', blockReason: 'no workspace root' });
        return;
      }
      const task = this.store.getTask(taskId);
      const ws = task?.workspaceId ? this.store.getWorkspace(task.workspaceId) : undefined;
      const branch = await gitResolveBranch(wsRoot);
      const branchPatch: Partial<SelfHealRunRecord> = {};
      if (branch) {
        branchPatch.worktreeBranch = branch;
      }
      if (Object.keys(branchPatch).length > 0) {
        this.store.updateSelfHealRun(r.id, branchPatch);
      }

      const session = this.store.getSession(sessionId);
      if (session?.status === 'running') {
        return;
      }

      let npmScript: string = String(policy.testPreset);
      try {
        npmScript = npmScriptForSelfHealPolicy(policy);
      } catch {
        /* keep preset label */
      }
      this.logSelfHeal(r.id, `running npm run ${npmScript} (worktree ${ws?.mode ?? '?'}) …`);

      const { ok, output } = await runSelfHealNpmTest(wsRoot, policy);
      const trimmedOut = output.slice(0, 120_000);
      this.store.updateSelfHealRun(r.id, { lastTestOutput: trimmedOut });
      this.store.appendSelfHealEvent({
        runId: r.id,
        kind: ok ? 'test_pass' : 'test_fail',
        payload: { ok, snippet: output.slice(0, 2000), workspaceMode: ws?.mode }
      });

      if (ok) {
        this.logSelfHeal(r.id, 'tests passed');
        if (policy.autoMerge) {
          if (ws?.mode === 'directory-copy' || !branch) {
            this.logSelfHeal(
              r.id,
              'blocked: autoMerge needs git worktree with a branch (not directory-copy)'
            );
            this.store.updateSelfHealRun(r.id, {
              status: 'blocked',
              blockReason:
                'autoMerge requires git worktree with a named branch; directory-copy workspace cannot auto-merge'
            });
            return;
          }
          this.store.updateSelfHealRun(r.id, { status: 'merging', lastErrorSummary: undefined });
        } else {
          this.logSelfHeal(r.id, 'done (autoMerge off)');
          this.store.updateSelfHealRun(r.id, { status: 'completed', lastErrorSummary: undefined });
        }
        return;
      }

      const summary = output.split('\n').find((line) => line.trim()) ?? 'tests failed';
      if (r.fixIteration >= policy.maxFixIterations) {
        this.store.updateSelfHealRun(r.id, {
          status: 'failed',
          lastErrorSummary: summary.slice(0, 2000)
        });
        return;
      }

      this.logSelfHeal(
        r.id,
        `tests failed (iter ${r.fixIteration + 1}/${policy.maxFixIterations}) → self-healer will fix`
      );
      this.store.appendMessage(sessionId, 'user', [
        textPart(
          `Tests failed (iteration ${r.fixIteration + 1}/${policy.maxFixIterations}). Output:\n\n${output.slice(0, 80_000)}`
        )
      ]);
      this.store.updateSelfHealRun(r.id, {
        status: 'fixing',
        lastErrorSummary: summary.slice(0, 2000)
      });
      return;
    }

    if (r.status === 'fixing') {
      const session = this.store.getSession(sessionId);
      if (!session) {
        return;
      }
      if (session.status === 'waiting_approval') {
        this.store.updateSelfHealRun(r.id, { status: 'blocked', blockReason: 'session waiting for approval' });
        return;
      }
      if (session.status === 'running') {
        return;
      }

      this.logSelfHeal(r.id, `self-healer turn (fix wave, iteration ${r.fixIteration + 1}) …`);
      await this.runSession(sessionId);

      const after = this.store.getSession(sessionId);
      if (after?.status === 'waiting_approval') {
        this.store.updateSelfHealRun(r.id, { status: 'blocked', blockReason: 'approval required mid-fix' });
        return;
      }

      if (after?.status === 'completed') {
        this.store.updateSession(sessionId, { status: 'idle' });
        const t = this.store.getTask(taskId);
        if (t) {
          this.store.updateTask(taskId, { status: 'in_progress' });
        }
      }

      this.store.updateSelfHealRun(r.id, {
        status: 'running_tests',
        fixIteration: r.fixIteration + 1
      });
      this.store.appendSelfHealEvent({
        runId: r.id,
        kind: 'fix_wave_done',
        payload: { iteration: r.fixIteration + 1 }
      });
      return;
    }

    if (r.status === 'tests_passed') {
      this.store.updateSelfHealRun(r.id, { status: policy.autoMerge ? 'merging' : 'completed' });
      return;
    }

    if (r.status === 'merging') {
      const fresh = this.store.getSelfHealRun(r.id) as SelfHealRunRecord;
      const wtBranch = fresh.worktreeBranch;
      if (!wtBranch) {
        this.logSelfHeal(r.id, 'blocked: unknown worktree branch');
        this.store.updateSelfHealRun(r.id, { status: 'blocked', blockReason: 'unknown worktree branch' });
        return;
      }

      this.logSelfHeal(r.id, `merging ${wtBranch} into main at ${this.repoRoot} …`);

      const autoStashMain = ['1', 'true', 'yes'].includes(
        String(process.env.RAW_AGENT_SELF_HEAL_AUTO_STASH_MAIN ?? '').toLowerCase()
      );
      let stashedForMerge = false;
      let mainClean = await gitWorktreeClean(this.repoRoot);
      if (!mainClean && autoStashMain) {
        const stash = await gitStashPush(this.repoRoot, `self-heal merge ${r.id}`);
        if (stash.ok) {
          stashedForMerge = true;
          this.store.appendSelfHealEvent({
            runId: r.id,
            kind: 'main_stashed',
            payload: { snippet: stash.output.slice(0, 500) }
          });
          mainClean = await gitWorktreeClean(this.repoRoot);
        }
      }
      if (!mainClean) {
        this.logSelfHeal(
          r.id,
          'blocked: main repo dirty (enable RAW_AGENT_SELF_HEAL_AUTO_STASH_MAIN=1 or stash/commit)'
        );
        this.store.updateSelfHealRun(r.id, {
          status: 'blocked',
          blockReason: autoStashMain
            ? 'main repo has uncommitted changes and git stash push failed or left a dirty tree; commit/stash manually or fix git stash'
            : 'main repo has uncommitted changes; refusing to merge (set RAW_AGENT_SELF_HEAL_AUTO_STASH_MAIN=1 to auto-stash, or commit/stash manually)'
        });
        return;
      }

      if (policy.targetBranch) {
        const co = await gitCheckoutBranch(this.repoRoot, policy.targetBranch);
        if (!co.ok) {
          if (stashedForMerge) {
            await gitStashPop(this.repoRoot);
          }
          this.store.updateSelfHealRun(r.id, {
            status: 'blocked',
            blockReason: `git checkout failed: ${co.output.slice(0, 2000)}`
          });
          return;
        }
      }

      const mergeResult = await gitMergeBranch(this.repoRoot, wtBranch);
      if (!mergeResult.ok) {
        this.logSelfHeal(r.id, `merge failed (blocked): ${mergeResult.output.split('\n')[0]?.slice(0, 120) ?? 'see blockReason'}`);
        if (stashedForMerge) {
          await gitMergeAbort(this.repoRoot);
          const pop = await gitStashPop(this.repoRoot);
          if (!pop.ok) {
            this.store.appendSelfHealEvent({
              runId: r.id,
              kind: 'stash_pop_after_merge_abort',
              payload: { output: pop.output.slice(0, 2000) }
            });
          }
        }
        this.store.updateSelfHealRun(r.id, {
          status: 'blocked',
          blockReason: `merge failed: ${mergeResult.output.slice(0, 4000)}`
        });
        return;
      }

      if (stashedForMerge) {
        const pop = await gitStashPop(this.repoRoot);
        if (!pop.ok) {
          this.store.updateSelfHealRun(r.id, {
            status: 'blocked',
            blockReason: `merge succeeded but git stash pop failed; fix conflicts then: git stash pop — ${pop.output.slice(0, 2000)}`
          });
          return;
        }
        this.store.appendSelfHealEvent({ runId: r.id, kind: 'main_stash_popped', payload: {} });
      }

      const pushEnabled = ['1', 'true', 'yes'].includes(
        String(process.env.RAW_AGENT_SELF_HEAL_GIT_PUSH ?? '').toLowerCase()
      );
      if (pushEnabled) {
        const remote = process.env.RAW_AGENT_SELF_HEAL_GIT_REMOTE?.trim() || 'origin';
        const branchName =
          (await gitResolveBranch(this.repoRoot)) ?? policy.targetBranch ?? 'main';
        const pushResult = await gitPushBranch(this.repoRoot, remote, branchName);
        if (!pushResult.ok) {
          this.store.updateSelfHealRun(r.id, {
            status: 'blocked',
            blockReason: `git push failed: ${pushResult.output.slice(0, 4000)}`
          });
          return;
        }
        this.store.appendSelfHealEvent({
          runId: r.id,
          kind: 'git_pushed',
          payload: { remote, branch: branchName, snippet: pushResult.output.slice(0, 500) }
        });
      }

      const sha = await gitRevParseHead(this.repoRoot);
      this.logSelfHeal(r.id, `merge OK @ ${sha?.slice(0, 12) ?? '?'}`);
      if (policy.autoRestartDaemon) {
        const req: DaemonRestartRequest = {
          requestedAt: new Date().toISOString(),
          reason: `self-heal merge ${r.id}`,
          runId: r.id
        };
        this.store.setDaemonControl('restart_request', req);
        this.store.updateSelfHealRun(r.id, {
          status: 'restart_pending',
          restartRequestedAt: req.requestedAt,
          mergeCommitSha: sha
        });
        this.store.appendSelfHealEvent({
          runId: r.id,
          kind: 'restart_requested',
          payload: { ...req } as Record<string, unknown>
        });
        this.logSelfHeal(r.id, 'daemon restart requested — supervisor will restart process');
      } else {
        this.logSelfHeal(r.id, 'completed (no auto-restart)');
        this.store.updateSelfHealRun(r.id, { status: 'completed', mergeCommitSha: sha });
        this.store.appendSelfHealEvent({ runId: r.id, kind: 'merge_done', payload: { sha } });
      }
      return;
    }
  }

  async runSession(
    sessionId: string,
    options?: { onModelStreamChunk?: (chunk: ModelStreamChunk) => void }
  ): Promise<SessionRecord> {
    let session = this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    if (session.status === 'waiting_approval') {
      return session;
    }

    const agent = this.store.getAgent(session.agentId);
    if (!agent) {
      throw new Error(`Agent ${session.agentId} not found`);
    }

    const controller = new AbortController();
    this.sessionAbortControllers.set(sessionId, controller);
    const signal = controller.signal;
    const sid = session.id;

    try {
      await this.ensureMcpTools(sid);
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
        const systemPrompt = await this.buildSystemPrompt(context, rawVisible);
        const stablePrefixHash = createHash('sha256')
          .update(this.buildStableSystemPrefix(context))
          .digest('hex')
          .slice(0, 16);
        const routing = this.routingBySession.get(sid);
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

        let turnResult: ModelTurnResult;
        try {
          turnResult = await this.runTurnWithRetries(
            {
              agent,
              systemPrompt,
              messages: visibleMessages,
              tools: this.tools,
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
          throw new Error('Model returned no assistant content');
        }

        this.store.appendMessage(session.id, 'assistant', turnResult.assistantParts);

        if (turnResult.stopReason !== 'tool_use') {
          const nextStatus = context.session.mode === 'task' ? 'completed' : 'idle';
          const updated = this.store.updateSession(session.id, { status: nextStatus });
          if (task && nextStatus === 'completed') {
            const latestText = this.getLatestAssistantText(session.id);
            this.store.updateTask(task.id, {
              status: 'completed',
              artifacts: latestText
                ? [
                    ...task.artifacts,
                    {
                      kind: 'summary',
                      label: 'assistant',
                      value: latestText
                    }
                  ]
                : task.artifacts
            });
            this.store.appendEvent({
              taskId: task.id,
              kind: 'task.completed',
              actor: agent.id,
              payload: {
                sessionId: session.id
              }
            });
            await this.unblockDependentTasks(task.id);
          }
          return updated;
        }

        const assistantMessage = this.store.listMessages(session.id).slice(-1)[0];
        if (!assistantMessage) {
          return this.store.updateSession(session.id, { status: 'failed' });
        }
        const toolCalls = assistantMessage.parts.filter(
          (part): part is Extract<MessagePart, { type: 'tool_call' }> => part.type === 'tool_call'
        );

        const policy = this.envApprovalPolicy ?? contextHasApprovalPolicy(context);

        const resolveApproval = (tool: ToolContract<any>, toolCall: Extract<MessagePart, { type: 'tool_call' }>) => {
          if (policyRequiresApproval(policy, tool.name)) {
            return true;
          }
          if (filePolicy) {
            if (tool.name === 'bash') {
              const cmd =
                typeof toolCall.input === 'object' && toolCall.input && 'command' in toolCall.input
                  ? String((toolCall.input as { command?: string }).command ?? '')
                  : '';
              if (filePolicyRequiresBashApproval(filePolicy, cmd)) {
                return true;
              }
            }
            if (tool.name === 'write_file' || tool.name === 'edit_file') {
              const p =
                typeof toolCall.input === 'object' && toolCall.input && 'path' in toolCall.input
                  ? String((toolCall.input as { path?: string }).path ?? '')
                  : '';
              if (filePolicyRequiresPathApproval(filePolicy, tool.name, p)) {
                return true;
              }
            }
          }
          if (policy?.defaultRisky && tool.approvalMode === 'auto') {
            return true;
          }
          if (tool.approvalMode === 'always') {
            return true;
          }
          if (policySkipsAutoApproval(policy, tool.name)) {
            return false;
          }
          return tool.approvalMode === 'auto' && tool.needsApproval?.(context, toolCall.input) === true;
        };

        const pendingApproval = toolCalls.find((tc) => {
          const t = this.tools.find((c) => c.name === tc.name);
          return t ? resolveApproval(t, tc) : false;
        });

        if (pendingApproval) {
          const tool = this.tools.find((c) => c.name === pendingApproval.name);
          if (!tool) {
            this.store.appendMessage(session.id, 'tool', [
              {
                type: 'tool_result',
                toolCallId: pendingApproval.toolCallId,
                name: pendingApproval.name,
                ok: false,
                content: `Unknown tool ${pendingApproval.name}`
              }
            ]);
            continue;
          }
          const idemKey =
            tool.approvalMode !== 'never'
              ? createHash('sha256')
                  .update(`${tool.name}:${JSON.stringify(pendingApproval.input)}`)
                  .digest('hex')
                  .slice(0, 32)
              : undefined;
          this.store.createApproval({
            sessionId: session.id,
            toolName: tool.name,
            reason: `Approval required for ${tool.name}`,
            args: pendingApproval.input,
            idempotencyKey: idemKey
          });
          return this.store.updateSession(session.id, { status: 'waiting_approval' });
        }

        const runOne = async (toolCall: Extract<MessagePart, { type: 'tool_call' }>) => {
          const tool = findToolByName(this.tools, toolCall.name);
          if (!tool) {
            return {
              toolCallId: toolCall.toolCallId,
              name: toolCall.name,
              ok: false,
              content: `Unknown tool ${toolCall.name}`,
              artifacts: undefined as TaskArtifact[] | undefined
            };
          }
          void appendTraceEvent(this.stateDir, sid, {
            kind: 'tool_start',
            payload: { name: tool.name }
          });
          const pre = await runToolHook(process.env, {
            phase: 'pre_tool_use',
            tool: tool.name,
            sessionId: sid,
            input: toolCall.input
          });
          if (pre.block) {
            return {
              toolCallId: toolCall.toolCallId,
              name: tool.name,
              ok: false,
              content: pre.message ?? 'blocked by pre_tool_use hook',
              artifacts: undefined
            };
          }
          const execInput = pre.input !== undefined ? pre.input : toolCall.input;
          try {
            let result = await tool.execute(context, execInput);
            const maxChars = envToolResultMaxChars(process.env);
            result = {
              ...result,
              content: truncateToolContent(result.content, maxChars)
            };
            void maybeExportOtelSpan(process.env, this.stateDir, sid, `tool.${tool.name}`, {
              ok: String(result.ok)
            });
            await runToolHook(process.env, {
              phase: 'post_tool_use',
              tool: tool.name,
              sessionId: sid,
              input: execInput,
              ok: result.ok,
              content: result.content
            });
            return {
              toolCallId: toolCall.toolCallId,
              name: tool.name,
              ok: result.ok,
              content: result.content,
              artifacts: result.artifacts
            };
          } catch (error) {
            const content = error instanceof Error ? error.message : String(error);
            await runToolHook(process.env, {
              phase: 'post_tool_use',
              tool: tool.name,
              sessionId: sid,
              input: execInput,
              ok: false,
              content
            });
            return {
              toolCallId: toolCall.toolCallId,
              name: tool.name,
              ok: false,
              content,
              artifacts: undefined
            };
          }
        };

        const results: Array<{
          toolCallId: string;
          name: string;
          ok: boolean;
          content: string;
          artifacts?: TaskArtifact[];
        }> = [];

        for (const chunk of partitionForParallel(toolCalls, this.maxParallelToolCalls)) {
          const chunkResults = await Promise.all(chunk.map((tc) => runOne(tc)));
          results.push(...chunkResults);
        }

        for (const r of results) {
          this.store.appendMessage(session.id, 'tool', [
            {
              type: 'tool_result',
              toolCallId: r.toolCallId,
              name: r.name,
              ok: r.ok,
              content: r.content
            }
          ]);
          if (task && r.artifacts?.length) {
            const latestTask = this.store.getTask(task.id) as TaskRecord;
            this.store.updateTask(task.id, {
              artifacts: [...latestTask.artifacts, ...r.artifacts]
            });
          }
          void appendTraceEvent(this.stateDir, sid, {
            kind: 'tool_end',
            payload: { name: r.name, ok: r.ok }
          });
        }
      }

      return this.store.updateSession(session.id, { status: 'idle' });
    } finally {
      this.sessionAbortControllers.delete(sessionId);
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
      !['0', 'false', 'off'].includes(String(process.env.RAW_AGENT_STREAM ?? '').toLowerCase());
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
      loadSkill: async (name, sessionId) => {
        const skills = await this.allSkills();
        const normalizedName = name.trim().toLowerCase();
        const found = skills.find((skill) => {
          const lookupKeys = [skill.name, skill.id, ...(skill.aliases ?? [])];
          return lookupKeys.some((candidate) => candidate.trim().toLowerCase() === normalizedName);
        });
        if (!found?.content) {
          return { error: `Skill "${name}" not found.` };
        }

        const mode = skillRoutingModeFromEnv(process.env);
        const routing = this.routingBySession.get(sessionId);
        const shortlist = new Set(routing?.shortlistNames ?? []);

        const inShortlist = (() => {
          if (mode === 'legacy') return true;
          if (!routing) return true;
          return shortlist.has(found.name) || shortlist.has(found.id);
        })();

        const isStrict = mode !== 'legacy' && skillLoadStrictFromEnv(process.env);

        if (isStrict && !inShortlist) {
          const suggestions = routing?.routed.slice(0, 3).map(r => r.skill.name).join(', ');
          const error = `Skill "${found.name}" is not in the current turn's shortlist. Strict mode is ON. Try one of these: ${suggestions || 'none suggested'}`;
          void appendTraceEvent(this.stateDir, sessionId, {
            kind: 'skill_load',
            payload: {
              name,
              skillId: found.id,
              skillName: found.name,
              inShortlist: false,
              rejected: true,
              reason: 'strict_off_shortlist',
              confidence: routing?.confidence.level
            }
          });
          return { error };
        }

        // Trace successful load (or non-strict off-shortlist load)
        void appendTraceEvent(this.stateDir, sessionId, {
          kind: 'skill_load',
          payload: {
            name,
            skillId: found.id,
            skillName: found.name,
            inShortlist,
            rejected: false,
            override: !inShortlist && mode !== 'legacy',
            confidence: routing?.confidence.level
          }
        });

        return { content: found.content };
      },
      updateTodo: async (sessionId, items) => {
        const session = this.store.getSession(sessionId);
        if (!session) {
          throw new Error(`Session ${sessionId} not found`);
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
          throw new Error('vision_analyze requires RAW_AGENT_VL_MODEL_NAME and API base URL/key');
        }
        const { runOpenAiVisionTurn } = await import('./model-adapters.js');
        const urls: string[] = [];
        for (const id of assetIds) {
          const asset = this.store.getImageAsset(id);
          if (!asset || asset.sessionId !== sid) continue;
          await touchImageAccess(this.store, id);
          const u = await imageBufferToDataUrl(this.store, this.stateDir, id);
          if (u) urls.push(u);
        }
        if (urls.length === 0) {
          throw new Error('No valid image assets for this session');
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
   * Stable part of the system prompt: identity, rules, repo/workspace, harness role.
   * Only changes when agent config or workspace changes — NOT per turn.
   * Keeping this stable lets the provider reuse its KV cache prefix across turns.
   */
  private buildStableSystemPrefix(context: RunContext): string {
    const harnessLines: string[] = [];
    if (context.agent.harnessRole === 'planner') {
      harnessLines.push(
        'Harness role: PLANNER — expand short goals into a high-level product spec and feature boundaries; avoid brittle low-level specs. Write product_spec.md via harness_write_spec.'
      );
    } else if (context.agent.harnessRole === 'generator') {
      harnessLines.push(
        'Harness role: GENERATOR — one sprint/feature at a time. Write sprint_contract.md (scope + verifiable acceptance criteria) before deep implementation; after work, prefer external review via spawn_subagent(role=evaluator) or role=review.'
      );
    } else if (context.agent.harnessRole === 'evaluator') {
      harnessLines.push(
        'Harness role: EVALUATOR — skeptical QA; probe edge cases; document findings in evaluator_feedback.md. Do not rubber-stamp generator output.'
      );
    }
    if (context.agent.id === 'main' || context.agent.capabilities.includes('orchestration')) {
      harnessLines.push(
        `Long-running harness: orchestrate planner → generator sprints → evaluator; structured files under ${HARNESS_ARTIFACT_DIR}/ (${HARNESS_ARTIFACT_FILES.productSpec}, ${HARNESS_ARTIFACT_FILES.sprintContract}, ${HARNESS_ARTIFACT_FILES.evaluatorFeedback}).`
      );
    }

    return [
      `You are ${context.agent.name} (${context.agent.role}).`,
      context.agent.instructions,
      `Repository root: ${context.repoRoot}`,
      context.workspaceRoot ? `Workspace root: ${context.workspaceRoot}` : 'No isolated workspace bound.',
      `Conversation mode: ${context.session.mode}`,
      'You are running in a raw agent loop. Respond normally when no tools are needed.',
      'For multi-step work, call TodoWrite before broad execution and keep exactly one item in progress.',
      'Load skills from repo `skills/` and `~/.agents/**/SKILL.md` only when relevant with load_skill(name).',
      'Use persistent tasks for long-lived work and teammates only for clearly separable work.',
      'For large builds: load_skill(Long-running harness) and use harness_write_spec for cross-session handoffs.',
      'Use memory_set/memory_get for scratch and long-term notes; handoff_state copies scratch to subagents.',
      'When the user attaches images or you need OCR/visual detail from stored screenshots, call vision_analyze with asset_ids (from [image id] markers) and a focused prompt. Requires RAW_AGENT_VL_MODEL_NAME.',
      harnessLines.length > 0 ? harnessLines.join('\n') : ''
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  /**
   * Dynamic per-turn context: todos, task status, rolling summary, memory, skill routing.
   * Placed AFTER the stable prefix so only the tail of the system prompt varies each turn.
   */
  private async buildDynamicContextBlock(context: RunContext, messages: SessionMessage[]): Promise<string> {
    const skills = await this.allSkills();
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    const userText = textFromMessage(lastUser ?? { parts: [], role: 'user', id: '', sessionId: '', createdAt: '' });
    const mode = skillRoutingModeFromEnv(process.env);
    const topK = skillRoutingTopKFromEnv(process.env);
    const routing = buildSkillRouting(userText, skills, { mode, topK });
    this.routingBySession.set(context.session.id, routing);

    let skillBlock: string;
    if (routing.mode === 'legacy') {
      const skillLines = skills.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n');
      const matchedLines = routing.keywordMatched
        .map((skill) => `- ${skill.name}: ${skill.promptFragment ?? skill.description}`)
        .join('\n');
      skillBlock = [
        'Available skills:',
        skillLines || '(none)',
        routing.keywordMatched.length > 0 ? `Matched guidance:\n${matchedLines}` : 'No matched guidance.'
      ].join('\n\n');
    } else {
      const routedNames = new Set(routing.routed.map((r) => r.skill.name));
      const lines: string[] = [
        `Skill routing (${routing.mode}). Likely-relevant skills for this turn — call load_skill(name) for full SKILL.md:`,
        'Use exact skill names as shown.'
      ];
      if (routing.routed.length === 0 && routing.keywordMatched.length === 0) {
        lines.push('(no strong matches — rely on tools, or ask a clarifying question)');
      }
      // Add confidence indicator when routing is ambiguous
      if (routing.confidence.level === 'low') {
        lines.push(`⚠️ Routing confidence: ${routing.confidence.level}. ${routing.confidence.reason}`);
        lines.push('Consider asking a clarifying question to narrow intent before loading skills.');
      } else if (routing.confidence.level === 'medium' && routing.confidence.nearTopCount > 1) {
        lines.push(`ℹ️ Routing confidence: ${routing.confidence.level}. ${routing.confidence.reason}`);
      }
      for (const r of routing.routed) {
        lines.push(`- ${r.skill.name}: ${r.skill.description} [score=${r.score}; ${r.reason}]`);
      }
      for (const s of routing.keywordMatched) {
        if (routedNames.has(s.name)) {
          continue;
        }
        lines.push(`- ${s.name}: ${s.description} [keyword hint]`);
      }
      const strict = skillLoadStrictFromEnv(process.env);
      lines.push(
        strict
          ? 'Strict: only call load_skill for names listed above this turn.'
          : 'If you need a skill not listed, you may still call load_skill; off-shortlist loads are traced for routing quality.'
      );
      skillBlock = lines.join('\n');
    }

    const todoLine = context.session.todo.length > 0 ? JSON.stringify(context.session.todo) : 'No active todos.';
    const taskLine = context.task
      ? `Task: ${context.task.id} | ${context.task.title} | status=${context.task.status} | blockedBy=${context.task.blockedBy.join(', ') || 'none'}`
      : 'No bound task.';

    // Cognitive state block - shows detected session phase for context awareness
    const cognitiveInfo = this.lastCognitivePhaseBySession.get(context.session.id);
    const cognitiveLine = cognitiveInfo
      ? `Session phase: ${cognitiveInfo.phase} (${(cognitiveInfo.confidence * 100).toFixed(0)}% confidence)`
      : '';

    const summaryMaxChars = compactSummaryMaxChars(process.env);
    const summaryLine = context.session.summary
      ? `Compressed summary:\n${capRollingSummaryText(context.session.summary, summaryMaxChars)}`
      : '';

    // Cap memory injection to avoid unbounded growth of per-turn context.
    const mem = this.store.listSessionMemory(context.session.id);
    const scratch = mem.filter((m) => m.scope === 'scratch').slice(0, MAX_MEMORY_ENTRIES);
    const longMem = mem.filter((m) => m.scope === 'long').slice(0, MAX_MEMORY_ENTRIES);
    const scratchLine =
      scratch.length > 0
        ? `Handoff scratch (key/value):\n${scratch.map((m) => `- ${m.key}: ${m.value}`).join('\n')}`
        : 'Handoff scratch: (empty)';
    const longLine =
      longMem.length > 0
        ? `Long-term memory:\n${longMem.map((m) => `- ${m.key}: ${m.value}`).join('\n')}`
        : 'Long-term memory: (empty)';

    return [
      taskLine,
      `Todos: ${todoLine}`,
      cognitiveLine,
      summaryLine,
      scratchLine,
      longLine,
      skillBlock
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  /**
   * Builds the full system prompt by joining the stable prefix and the dynamic context block.
   * The separator "---" visually marks where the stable/cached portion ends.
   */
  private async buildSystemPrompt(context: RunContext, messages: SessionMessage[]): Promise<string> {
    const stablePrefix = this.buildStableSystemPrefix(context);
    const dynamicContext = await this.buildDynamicContextBlock(context, messages);
    return [stablePrefix, dynamicContext].filter(Boolean).join('\n\n---\n\n');
  }

  private async allSkills() {
    if (!this.workspaceSkillsPromise) {
      this.workspaceSkillsPromise = (async () => {
        const [ws, ag] = await Promise.all([loadWorkspaceSkills(this.repoRoot), loadAgentsDirSkills()]);
        return mergeSkillsByName(ws, ag);
      })();
    }
    const merged = await this.workspaceSkillsPromise;
    return [...builtinSkills, ...merged];
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
    const useEpisodic = !['0', 'false', 'off'].includes(
      String(process.env.RAW_AGENT_EPISODIC_SELECTION ?? 'true').toLowerCase()
    );

    if (!useEpisodic) {
      // Fall back to simple truncation
      return messages.slice(-MAX_VISIBLE_MESSAGES);
    }

    // Check if cognitive state adaptation is enabled (default: true)
    const useCognitiveState = !['0', 'false', 'off'].includes(
      String(process.env.RAW_AGENT_COGNITIVE_STATE_SELECTION ?? 'true').toLowerCase()
    );

    // Use episodic selection with token budget
    // Budget: estimate ~1000 tokens per message, capped at 24k total
    const tokenBudget = envInt(process.env, 'RAW_AGENT_EPISODIC_TOKEN_BUDGET', 24_000);

    if (useCognitiveState) {
      // Use cognitive state-adapted selection for phase-aware context
      const result = selectEpisodicMessagesWithCognitiveState(messages, tokenBudget);
      // Store cognitive phase for system prompt injection
      this.lastCognitivePhaseBySession.set(session.id, {
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

  /** Tracks the last computed cognitive phase per session for system prompt injection. */
  private lastCognitivePhaseBySession = new Map<string, { phase: CognitivePhase; confidence: number }>();

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
      throw new Error(`Session ${sessionId} not found`);
    }

    const workspaceRoot = session.workspaceId ? this.store.getWorkspace(session.workspaceId)?.rootPath : undefined;
    const cwd = workspaceRoot ?? this.repoRoot;
    const job = this.store.createBackgroundJob({
      sessionId,
      command,
      status: 'running'
    });

    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this.backgroundProcesses.set(job.id, child);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', () => {
      const result = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n') || '(no output)';
      this.backgroundProcesses.delete(job.id);
      this.store.updateBackgroundJob(job.id, 'completed', result);
      this.store.appendMessage(sessionId, 'user', [textPart(`Background job ${job.id} completed.\n${result.slice(0, 4000)}`)]);
    });

    child.on('error', (error) => {
      this.backgroundProcesses.delete(job.id);
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

  private isSelfHealControlledSession(session: SessionRecord): boolean {
    return (session.metadata as { selfHealControlled?: boolean }).selfHealControlled === true;
  }

  private async processAutonomousSessions(): Promise<void> {
    const woken = this.store.dequeueSchedulerWakes(64);
    for (const sessionId of woken) {
      const s = this.store.getSession(sessionId);
      if (
        s &&
        s.background &&
        s.status === 'idle' &&
        ['task', 'teammate'].includes(s.mode) &&
        !this.isSelfHealControlledSession(s)
      ) {
        await this.runSession(sessionId);
      }
    }

    const sessions = this.store
      .listSessions()
      .filter((session) => session.background && session.status === 'idle' && ['task', 'teammate'].includes(session.mode))
      .filter((session) => !this.isSelfHealControlledSession(session));

    for (const session of sessions) {
      const inbox = this.store.listMailbox(session.agentId, true);
      const shouldRun =
        inbox.length > 0 ||
        session.mode === 'task' ||
        this.store.listTasks({ status: 'pending' }).some((task) => !task.ownerAgentId && task.blockedBy.length === 0);

      if (shouldRun) {
        await this.runSession(session.id);
      }
    }
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
}
