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
import { builtinAgents } from './builtin-agents.js';
import { builtinSkills, loadWorkspaceSkills, matchSkills } from './builtin-skills.js';
import { createId } from './id.js';
import { createModelAdapterFromEnv } from './model-adapters.js';
import { SqliteStateStore } from './storage.js';
import { appendTraceEvent } from './trace.js';
import { createBuiltinTools, type RuntimeToolServices } from './tools.js';
import { estimateMessageTokens } from './token-estimate.js';
import type {
  AgentSpec,
  ApprovalRecord,
  BackgroundJobRecord,
  MailRecord,
  MessagePart,
  ModelAdapter,
  ModelStreamChunk,
  ModelTurnInput,
  ModelTurnResult,
  RunContext,
  SessionMessage,
  SessionRecord,
  SkillSpec,
  TaskArtifact,
  TaskRecord,
  ToolContract,
  TodoItem
} from './types.js';
import { WorkspaceManager } from './workspaces.js';

const MAX_VISIBLE_MESSAGES = 24;
const MAX_TURNS = 24;

function envInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const v = Number(env[key]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
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
  return message.parts
    .filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

export class RawAgentRuntime {
  readonly repoRoot: string;
  readonly stateDir: string;
  readonly store: SqliteStateStore;
  readonly workspaceManager: WorkspaceManager;
  readonly modelAdapter: ModelAdapter;
  tools: ToolContract<any>[];

  private readonly maxParallelToolCalls: number;
  private readonly backgroundProcesses = new Map<string, ReturnType<typeof spawn>>();
  private readonly sessionAbortControllers = new Map<string, AbortController>();
  private readonly envApprovalPolicy: ApprovalPolicy | undefined;
  private workspaceSkillsPromise?: Promise<SkillSpec[]>;
  private mcpUrls: string[];
  private mcpToolsPromise?: Promise<void>;

  constructor(options: RuntimeOptions) {
    this.repoRoot = options.repoRoot;
    this.stateDir = options.stateDir;
    this.store = new SqliteStateStore(join(this.stateDir, 'runtime.sqlite'));
    this.workspaceManager = new WorkspaceManager(join(this.stateDir, 'workspaces'), this.repoRoot);
    this.modelAdapter = options.modelAdapter ?? createModelAdapterFromEnv(process.env);
    this.maxParallelToolCalls = options.maxParallelToolCalls ?? envInt(process.env, 'RAW_AGENT_MAX_PARALLEL_TOOLS', 8);
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

  private async ensureMcpTools(): Promise<void> {
    if (this.mcpUrls.length === 0) {
      return;
    }
    if (this.tools.some((t) => t.name === 'mcp_invoke')) {
      return;
    }
    if (!this.mcpToolsPromise) {
      const urls = [...this.mcpUrls];
      this.mcpToolsPromise = import('./mcp-jsonrpc.js').then(({ mcpCallTool }) => {
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
            const url = urls[Math.floor(args.server)];
            if (!url) {
              return { ok: false, content: `Invalid MCP server index ${args.server}` };
            }
            const out = await mcpCallTool(url, args.tool, args.arguments ?? {});
            return { ok: !out.isError, content: out.content };
          }
        };
        this.tools.push(mcpTool);
      });
    }
    await this.mcpToolsPromise;
  }

  listAgents(): AgentSpec[] {
    return this.store.listAgents();
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

  createChatSession(input: {
    title?: string;
    message?: string;
    agentId?: string;
    background?: boolean;
  }): SessionRecord {
    const session = this.store.createSession({
      title: input.title ?? 'Chat Session',
      mode: 'chat',
      agentId: input.agentId ?? 'main',
      background: input.background ?? false
    });

    if (input.message?.trim()) {
      this.store.appendMessage(session.id, 'user', [textPart(input.message.trim())]);
    }

    return session;
  }

  createTaskSession(input: {
    title: string;
    description?: string;
    message?: string;
    agentId?: string;
    blockedBy?: string[];
    background?: boolean;
  }): { task: TaskRecord; session: SessionRecord } {
    const task = this.store.createTask({
      title: input.title,
      description: input.description,
      ownerAgentId: input.agentId ?? 'main',
      blockedBy: input.blockedBy
    });
    this.wakeAllAutonomousSessions('task.created');

    const session = this.store.createSession({
      title: input.title,
      mode: 'task',
      agentId: input.agentId ?? 'main',
      taskId: task.id,
      background: input.background ?? true,
      metadata: {
        autoRun: true
      }
    });

    this.store.updateTask(task.id, { sessionId: session.id });
    if (input.message?.trim()) {
      this.store.appendMessage(session.id, 'user', [textPart(input.message.trim())]);
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

  sendUserMessage(sessionId: string, message: string): SessionRecord {
    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    this.store.appendMessage(session.id, 'user', [textPart(message.trim())]);
    return this.store.getSession(session.id) as SessionRecord;
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
    await this.processAutonomousSessions();
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
      await this.ensureMcpTools();
      session = this.store.updateSession(session.id, { status: 'running' });
      await this.ingestMailbox(session);
      await this.autoClaimTask(session);

      for (let turn = 0; turn < MAX_TURNS; turn += 1) {
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

        const visibleMessages = await this.visibleMessages(context.session);
        const systemPrompt = await this.buildSystemPrompt(context, visibleMessages);
        void appendTraceEvent(this.stateDir, sid, {
          kind: 'turn_start',
          payload: { turn, adapter: this.modelAdapter.name }
        });

        let turnResult: ModelTurnResult;
        try {
          turnResult = await this.runTurnWithRetries(
            {
              agent,
              systemPrompt,
              messages: visibleMessages,
              tools: this.tools,
              signal
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
          const tool = this.tools.find((candidate) => candidate.name === toolCall.name);
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
          try {
            const result = await tool.execute(context, toolCall.input);
            return {
              toolCallId: toolCall.toolCallId,
              name: tool.name,
              ok: result.ok,
              content: result.content,
              artifacts: result.artifacts
            };
          } catch (error) {
            const content = error instanceof Error ? error.message : String(error);
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

        for (let i = 0; i < toolCalls.length; i += this.maxParallelToolCalls) {
          const chunk = toolCalls.slice(i, i + this.maxParallelToolCalls);
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
      loadSkill: async (name) => {
        const skills = await this.allSkills();
        return skills.find((skill) => skill.name === name || skill.id === name)?.content;
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
        const task = this.store.updateTask(taskId, patch);
        if (patch.status === 'completed') {
          await this.unblockDependentTasks(taskId);
        }
        return task;
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
      deleteSessionMemory: async (sessionId, scope, key) => this.store.deleteSessionMemory(sessionId, scope, key)
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

  private async buildSystemPrompt(context: RunContext, messages: SessionMessage[]): Promise<string> {
    const skills = await this.allSkills();
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    const matched = matchSkills(textFromMessage(lastUser ?? { parts: [], role: 'user', id: '', sessionId: '', createdAt: '' }), skills);
    const skillLines = skills.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n');
    const matchedLines = matched.map((skill) => `- ${skill.name}: ${skill.promptFragment ?? skill.description}`).join('\n');
    const todoLine = context.session.todo.length > 0 ? JSON.stringify(context.session.todo) : 'No active todos.';
    const summaryLine = context.session.summary ? `Compressed summary:\n${context.session.summary}` : 'No compressed summary yet.';
    const taskLine = context.task
      ? `Task: ${context.task.id} | ${context.task.title} | status=${context.task.status} | blockedBy=${context.task.blockedBy.join(', ') || 'none'}`
      : 'No bound task.';

    const mem = this.store.listSessionMemory(context.session.id);
    const scratch = mem.filter((m) => m.scope === 'scratch');
    const longMem = mem.filter((m) => m.scope === 'long');
    const scratchLine =
      scratch.length > 0
        ? `Handoff scratch (key/value):\n${scratch.map((m) => `- ${m.key}: ${m.value}`).join('\n')}`
        : 'Handoff scratch: (empty)';
    const longLine =
      longMem.length > 0
        ? `Long-term memory:\n${longMem.map((m) => `- ${m.key}: ${m.value}`).join('\n')}`
        : 'Long-term memory: (empty)';

    return [
      `You are ${context.agent.name} (${context.agent.role}).`,
      context.agent.instructions,
      `Repository root: ${context.repoRoot}`,
      context.workspaceRoot ? `Workspace root: ${context.workspaceRoot}` : 'No isolated workspace bound.',
      taskLine,
      `Conversation mode: ${context.session.mode}`,
      'You are running in a raw agent loop. Respond normally when no tools are needed.',
      'For multi-step work, call TodoWrite before broad execution and keep exactly one item in progress.',
      'Load workspace skills only when relevant with load_skill(name).',
      'Use persistent tasks for long-lived work and teammates only for clearly separable work.',
      'Use memory_set/memory_get for scratch and long-term notes; handoff_state copies scratch to subagents.',
      `Todos: ${todoLine}`,
      summaryLine,
      scratchLine,
      longLine,
      'Available skills:',
      skillLines || '(none)',
      matchedLines ? `Matched guidance:\n${matchedLines}` : 'No matched guidance.'
    ].join('\n\n');
  }

  private async allSkills() {
    if (!this.workspaceSkillsPromise) {
      this.workspaceSkillsPromise = loadWorkspaceSkills(this.repoRoot);
    }
    const workspaceSkills = await this.workspaceSkillsPromise;
    return [...builtinSkills, ...workspaceSkills];
  }

  private async visibleMessages(session: SessionRecord): Promise<SessionMessage[]> {
    const messages = this.store.listMessages(session.id);
    if (!session.summary && messages.length <= MAX_VISIBLE_MESSAGES) {
      return messages;
    }

    const visible = messages.slice(-MAX_VISIBLE_MESSAGES);
    if (!session.summary) {
      return visible;
    }

    return [
      {
        id: createId('msg'),
        sessionId: session.id,
        role: 'system',
        parts: [textPart(session.summary)],
        createdAt: new Date(0).toISOString()
      },
      ...visible
    ];
  }

  private async autoCompact(context: RunContext): Promise<void> {
    const messages = this.store.listMessages(context.session.id);
    const tokenThreshold = envInt(process.env, 'RAW_AGENT_COMPACT_TOKEN_THRESHOLD', 24_000);
    const est = estimateMessageTokens(messages);
    if (est < tokenThreshold && messages.length <= MAX_VISIBLE_MESSAGES + 4) {
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
    const mergedSummary = context.session.summary ? `${context.session.summary}\n\n${summary}` : summary;
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
    const subagent = this.store.createSession({
      title: `Subagent: ${role ?? parentAgent.role}`,
      mode: 'subagent',
      agentId: role === 'review' ? 'reviewer' : role === 'research' ? 'researcher' : role === 'implement' ? 'implementer' : parentAgent.id,
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

  private async processAutonomousSessions(): Promise<void> {
    const woken = this.store.dequeueSchedulerWakes(64);
    for (const sessionId of woken) {
      const s = this.store.getSession(sessionId);
      if (s && s.background && s.status === 'idle' && ['task', 'teammate'].includes(s.mode)) {
        await this.runSession(sessionId);
      }
    }

    const sessions = this.store
      .listSessions()
      .filter((session) => session.background && session.status === 'idle' && ['task', 'teammate'].includes(session.mode));

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
