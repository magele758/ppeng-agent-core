import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { builtinAgents } from './builtin-agents.js';
import { builtinSkills, loadWorkspaceSkills, matchSkills } from './builtin-skills.js';
import { createId } from './id.js';
import { createModelAdapterFromEnv } from './model-adapters.js';
import { SqliteStateStore } from './storage.js';
import { createBuiltinTools, type RuntimeToolServices } from './tools.js';
import type {
  AgentSpec,
  ApprovalRecord,
  BackgroundJobRecord,
  MailRecord,
  MessagePart,
  ModelAdapter,
  RunContext,
  SessionMessage,
  SessionRecord,
  SkillSpec,
  TaskRecord,
  ToolContract,
  TodoItem
} from './types.js';
import { WorkspaceManager } from './workspaces.js';

const AUTO_COMPACT_THRESHOLD = 32_000;
const MAX_VISIBLE_MESSAGES = 24;
const MAX_TURNS = 24;

export interface RuntimeOptions {
  repoRoot: string;
  stateDir: string;
  modelAdapter?: ModelAdapter;
  agents?: AgentSpec[];
  tools?: ToolContract<any>[];
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

function estimateSize(messages: SessionMessage[]): number {
  return JSON.stringify(messages).length;
}

export class RawAgentRuntime {
  readonly repoRoot: string;
  readonly stateDir: string;
  readonly store: SqliteStateStore;
  readonly workspaceManager: WorkspaceManager;
  readonly modelAdapter: ModelAdapter;
  readonly tools: ToolContract<any>[];

  private readonly backgroundProcesses = new Map<string, ReturnType<typeof spawn>>();
  private workspaceSkillsPromise?: Promise<SkillSpec[]>;

  constructor(options: RuntimeOptions) {
    this.repoRoot = options.repoRoot;
    this.stateDir = options.stateDir;
    this.store = new SqliteStateStore(join(this.stateDir, 'runtime.sqlite'));
    this.workspaceManager = new WorkspaceManager(join(this.stateDir, 'workspaces'), this.repoRoot);
    this.modelAdapter = options.modelAdapter ?? createModelAdapterFromEnv(process.env);

    for (const agent of options.agents ?? builtinAgents) {
      this.store.upsertAgent(agent);
    }

    this.tools = options.tools ?? createBuiltinTools(this.createToolServices());
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

    return this.store.createMail({
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      type: input.type ?? 'message',
      content: input.content,
      correlationId: input.correlationId,
      sessionId: input.sessionId,
      taskId: input.taskId
    });
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

  async runSession(sessionId: string): Promise<SessionRecord> {
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

    session = this.store.updateSession(session.id, { status: 'running' });
    await this.ingestMailbox(session);
    await this.autoClaimTask(session);

    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      const refreshedSession = this.store.getSession(session.id) as SessionRecord;
      const task = refreshedSession.taskId ? this.store.getTask(refreshedSession.taskId) : undefined;
      const workspaceRoot = await this.ensureWorkspaceRoot(refreshedSession, task);
      const context: RunContext = {
        repoRoot: this.repoRoot,
        stateDir: this.stateDir,
        session: this.store.getSession(session.id) as SessionRecord,
        agent,
        workspaceRoot,
        task
      };

      await this.autoCompact(context);

      const visibleMessages = await this.visibleMessages(context.session);
      const systemPrompt = await this.buildSystemPrompt(context, visibleMessages);
      const turnResult = await this.modelAdapter.runTurn({
        agent,
        systemPrompt,
        messages: visibleMessages,
        tools: this.tools
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

      for (const toolCall of toolCalls) {
        const tool = this.tools.find((candidate) => candidate.name === toolCall.name);
        if (!tool) {
          this.store.appendMessage(session.id, 'tool', [
            {
              type: 'tool_result',
              toolCallId: toolCall.toolCallId,
              name: toolCall.name,
              ok: false,
              content: `Unknown tool ${toolCall.name}`
            }
          ]);
          continue;
        }

        const approvalRequired =
          tool.approvalMode === 'always' ||
          (tool.approvalMode === 'auto' && tool.needsApproval?.(context, toolCall.input) === true);

        if (approvalRequired) {
          this.store.createApproval({
            sessionId: session.id,
            toolName: tool.name,
            reason: `Approval required for ${tool.name}`,
            args: toolCall.input
          });
          return this.store.updateSession(session.id, { status: 'waiting_approval' });
        }

        let result;
        try {
          result = await tool.execute(context, toolCall.input);
        } catch (error) {
          const content = error instanceof Error ? error.message : String(error);
          this.store.appendMessage(session.id, 'tool', [
            {
              type: 'tool_result',
              toolCallId: toolCall.toolCallId,
              name: tool.name,
              ok: false,
              content
            }
          ]);
          continue;
        }

        this.store.appendMessage(session.id, 'tool', [
          {
            type: 'tool_result',
            toolCallId: toolCall.toolCallId,
            name: tool.name,
            ok: result.ok,
            content: result.content
          }
        ]);

        if (task && result.artifacts?.length) {
          const latestTask = this.store.getTask(task.id) as TaskRecord;
          this.store.updateTask(task.id, {
            artifacts: [...latestTask.artifacts, ...result.artifacts]
          });
        }
      }
    }

    return this.store.updateSession(session.id, { status: 'idle' });
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
        }))
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
      `Todos: ${todoLine}`,
      summaryLine,
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
    if (estimateSize(messages) < AUTO_COMPACT_THRESHOLD || messages.length <= MAX_VISIBLE_MESSAGES + 4) {
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
