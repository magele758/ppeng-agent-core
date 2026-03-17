import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import type {
  AgentSpec,
  BackgroundJobRecord,
  MailRecord,
  RunContext,
  TaskRecord,
  TodoItem,
  ToolContract
} from './types.js';

export interface RuntimeToolServices {
  loadSkill: (name: string) => Promise<string | undefined>;
  updateTodo: (sessionId: string, items: TodoItem[]) => Promise<TodoItem[]>;
  createTask: (input: {
    title: string;
    description?: string;
    blockedBy?: string[];
    ownerAgentId?: string;
    sessionId?: string;
    parentTaskId?: string;
  }) => Promise<TaskRecord>;
  getTask: (taskId: string) => Promise<TaskRecord | undefined>;
  listTasks: () => Promise<TaskRecord[]>;
  updateTask: (
    taskId: string,
    patch: Partial<Pick<TaskRecord, 'status' | 'ownerAgentId' | 'blockedBy' | 'workspaceId' | 'metadata'>>
  ) => Promise<TaskRecord>;
  spawnSubagent: (context: RunContext, prompt: string, role?: string) => Promise<string>;
  spawnTeammate: (context: RunContext, input: { name: string; role: string; prompt: string }) => Promise<string>;
  listAgents: () => Promise<AgentSpec[]>;
  sendMail: (
    context: RunContext,
    input: { toAgentId: string; content: string; type?: string; correlationId?: string }
  ) => Promise<MailRecord>;
  readInbox: (agentId: string) => Promise<MailRecord[]>;
  startBackgroundJob: (sessionId: string, command: string) => Promise<BackgroundJobRecord>;
  getBackgroundJob: (jobId: string) => Promise<BackgroundJobRecord | undefined>;
  listBackgroundJobs: (sessionId?: string) => Promise<BackgroundJobRecord[]>;
  listWorkspaces: () => Promise<Array<{ id: string; taskId: string; name: string; rootPath: string; mode: string }>>;
}

function shellOutput(command: string, cwd: string): Promise<string> {
  return new Promise((resolveOutput) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      resolveOutput(combined || `(command exited with ${code ?? 0} and no output)`);
    });
  });
}

function safePath(root: string, path: string): string {
  const joined = resolve(root, normalize(path));
  if (!joined.startsWith(resolve(root))) {
    throw new Error(`Path escapes workspace: ${path}`);
  }
  return joined;
}

function repoPath(context: RunContext, path: string): string {
  return safePath(context.workspaceRoot ?? context.repoRoot, path);
}

function parseTodoItems(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) {
    throw new Error('items must be an array');
  }

  let inProgress = 0;
  const parsed = raw.map((item, index) => {
    const record = item as Record<string, unknown>;
    const content = String(record.content ?? '').trim();
    const status = String(record.status ?? 'pending') as TodoItem['status'];
    const activeForm = String(record.activeForm ?? '').trim();

    if (!content) {
      throw new Error(`todo item ${index} is missing content`);
    }
    if (!['pending', 'in_progress', 'completed'].includes(status)) {
      throw new Error(`todo item ${index} has invalid status ${status}`);
    }
    if (!activeForm) {
      throw new Error(`todo item ${index} is missing activeForm`);
    }
    if (status === 'in_progress') {
      inProgress += 1;
    }

    return {
      content,
      status,
      activeForm
    };
  });

  if (inProgress > 1) {
    throw new Error('only one todo may be in_progress');
  }

  return parsed;
}

export function createBuiltinTools(services: RuntimeToolServices): ToolContract<any>[] {
  const readFileTool: ToolContract<{ path?: string; limit?: number }> = {
    name: 'read_file',
    description: 'Read a file or list the current workspace directory.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        limit: { type: 'number' }
      }
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      if (!args.path) {
        const entries = await readdir(context.workspaceRoot ?? context.repoRoot, { withFileTypes: true });
        return {
          ok: true,
          content: entries.map((entry) => `${entry.isDirectory() ? 'dir' : 'file'} ${entry.name}`).join('\n')
        };
      }

      const content = await readFile(repoPath(context, args.path), 'utf8');
      const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : undefined;
      const lines = content.split('\n');
      const sliced = limit && lines.length > limit ? [...lines.slice(0, limit), `... (${lines.length - limit} more lines)`] : lines;
      return {
        ok: true,
        content: sliced.join('\n')
      };
    }
  };

  const writeFileTool: ToolContract<{ path: string; content: string }> = {
    name: 'write_file',
    description: 'Write a file relative to the workspace root.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['path', 'content']
    },
    approvalMode: 'auto',
    sideEffectLevel: 'workspace',
    async execute(context, args) {
      const target = repoPath(context, args.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, args.content, 'utf8');
      return {
        ok: true,
        content: `Wrote ${args.content.length} bytes to ${args.path}`
      };
    }
  };

  const editFileTool: ToolContract<{ path: string; oldText: string; newText: string }> = {
    name: 'edit_file',
    description: 'Replace the first occurrence of oldText in a file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        oldText: { type: 'string' },
        newText: { type: 'string' }
      },
      required: ['path', 'oldText', 'newText']
    },
    approvalMode: 'auto',
    sideEffectLevel: 'workspace',
    async execute(context, args) {
      const target = repoPath(context, args.path);
      const original = await readFile(target, 'utf8');
      if (!original.includes(args.oldText)) {
        return {
          ok: false,
          content: `Text not found in ${args.path}`
        };
      }

      await writeFile(target, original.replace(args.oldText, args.newText), 'utf8');
      return {
        ok: true,
        content: `Edited ${args.path}`
      };
    }
  };

  const bashTool: ToolContract<{ command: string }> = {
    name: 'bash',
    description: 'Run a shell command inside the workspace root.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' }
      },
      required: ['command']
    },
    approvalMode: 'auto',
    sideEffectLevel: 'workspace',
    needsApproval(_context, args) {
      const riskyTokens = ['rm ', 'git reset', 'git checkout', 'git clean', 'npm publish', 'sudo '];
      return riskyTokens.some((token) => args.command.includes(token));
    },
    async execute(context, args) {
      return {
        ok: true,
        content: await shellOutput(args.command, context.workspaceRoot ?? context.repoRoot)
      };
    }
  };

  const todoWriteTool: ToolContract<{ items: TodoItem[] }> = {
    name: 'TodoWrite',
    description: 'Update the session todo list.',
    inputSchema: {
      type: 'object',
      properties: {
        items: { type: 'array' }
      },
      required: ['items']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const items = parseTodoItems(args.items);
      const updated = await services.updateTodo(context.session.id, items);
      const lines = updated.map((item) => {
        const marker = item.status === 'completed' ? '[x]' : item.status === 'in_progress' ? '[>]' : '[ ]';
        const suffix = item.status === 'in_progress' ? ` <- ${item.activeForm}` : '';
        return `${marker} ${item.content}${suffix}`;
      });
      return {
        ok: true,
        content: lines.join('\n')
      };
    }
  };

  const loadSkillTool: ToolContract<{ name: string }> = {
    name: 'load_skill',
    description: 'Load a workspace skill by name.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' }
      },
      required: ['name']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(_context, args) {
      const content = await services.loadSkill(args.name);
      return {
        ok: Boolean(content),
        content: content ?? `Unknown skill ${args.name}`
      };
    }
  };

  const taskCreateTool: ToolContract<{
    title: string;
    description?: string;
    blockedBy?: string[];
    ownerAgentId?: string;
  }> = {
    name: 'task_create',
    description: 'Create a persistent task.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        blockedBy: { type: 'array', items: { type: 'string' } },
        ownerAgentId: { type: 'string' }
      },
      required: ['title']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const task = await services.createTask({
        title: args.title,
        description: args.description,
        blockedBy: args.blockedBy,
        ownerAgentId: args.ownerAgentId,
        sessionId: context.session.id,
        parentTaskId: context.task?.id
      });
      return {
        ok: true,
        content: JSON.stringify(task, null, 2)
      };
    }
  };

  const taskGetTool: ToolContract<{ taskId: string }> = {
    name: 'task_get',
    description: 'Fetch one task by id.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' }
      },
      required: ['taskId']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(_context, args) {
      const task = await services.getTask(args.taskId);
      return {
        ok: Boolean(task),
        content: task ? JSON.stringify(task, null, 2) : `Task ${args.taskId} not found`
      };
    }
  };

  const taskUpdateTool: ToolContract<{
    taskId: string;
    status?: TaskRecord['status'];
    ownerAgentId?: string;
    blockedBy?: string[];
  }> = {
    name: 'task_update',
    description: 'Update task status, owner, or dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        status: { type: 'string' },
        ownerAgentId: { type: 'string' },
        blockedBy: { type: 'array', items: { type: 'string' } }
      },
      required: ['taskId']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(_context, args) {
      const task = await services.updateTask(args.taskId, {
        status: args.status,
        ownerAgentId: args.ownerAgentId,
        blockedBy: args.blockedBy
      });
      return {
        ok: true,
        content: JSON.stringify(task, null, 2)
      };
    }
  };

  const taskListTool: ToolContract<Record<string, never>> = {
    name: 'task_list',
    description: 'List all tasks.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute() {
      const tasks = await services.listTasks();
      return {
        ok: true,
        content: tasks.length > 0 ? JSON.stringify(tasks, null, 2) : 'No tasks.'
      };
    }
  };

  const spawnSubagentTool: ToolContract<{ prompt: string; role?: string }> = {
    name: 'spawn_subagent',
    description: 'Run a clean-context subagent and return its summary.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        role: { type: 'string' }
      },
      required: ['prompt']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      return {
        ok: true,
        content: await services.spawnSubagent(context, args.prompt, args.role)
      };
    }
  };

  const spawnTeammateTool: ToolContract<{ name: string; role: string; prompt: string }> = {
    name: 'spawn_teammate',
    description: 'Create a persistent teammate session that can continue in the background.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        role: { type: 'string' },
        prompt: { type: 'string' }
      },
      required: ['name', 'role', 'prompt']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      return {
        ok: true,
        content: await services.spawnTeammate(context, {
          name: args.name,
          role: args.role,
          prompt: args.prompt
        })
      };
    }
  };

  const listTeamTool: ToolContract<Record<string, never>> = {
    name: 'list_team',
    description: 'List registered agents and teammates.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute() {
      const agents = await services.listAgents();
      return {
        ok: true,
        content: JSON.stringify(agents, null, 2)
      };
    }
  };

  const sendMessageTool: ToolContract<{
    toAgentId: string;
    content: string;
    type?: string;
    correlationId?: string;
  }> = {
    name: 'send_message',
    description: 'Send a mailbox message to another agent.',
    inputSchema: {
      type: 'object',
      properties: {
        toAgentId: { type: 'string' },
        content: { type: 'string' },
        type: { type: 'string' },
        correlationId: { type: 'string' }
      },
      required: ['toAgentId', 'content']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const mail = await services.sendMail(context, args);
      return {
        ok: true,
        content: JSON.stringify(mail, null, 2)
      };
    }
  };

  const readInboxTool: ToolContract<Record<string, never>> = {
    name: 'read_inbox',
    description: 'Read pending mailbox messages for the current agent.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context) {
      const mail = await services.readInbox(context.agent.id);
      return {
        ok: true,
        content: mail.length > 0 ? JSON.stringify(mail, null, 2) : 'Inbox empty.'
      };
    }
  };

  const bgRunTool: ToolContract<{ command: string }> = {
    name: 'bg_run',
    description: 'Run a long command in the background.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' }
      },
      required: ['command']
    },
    approvalMode: 'auto',
    sideEffectLevel: 'workspace',
    async execute(context, args) {
      const job = await services.startBackgroundJob(context.session.id, args.command);
      return {
        ok: true,
        content: JSON.stringify(job, null, 2)
      };
    }
  };

  const bgCheckTool: ToolContract<{ jobId?: string }> = {
    name: 'bg_check',
    description: 'Check one background job or list all of them.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' }
      }
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      if (args.jobId) {
        const job = await services.getBackgroundJob(args.jobId);
        return {
          ok: Boolean(job),
          content: job ? JSON.stringify(job, null, 2) : `Background job ${args.jobId} not found`
        };
      }

      const jobs = await services.listBackgroundJobs(context.session.id);
      return {
        ok: true,
        content: jobs.length > 0 ? JSON.stringify(jobs, null, 2) : 'No background jobs.'
      };
    }
  };

  const workspaceListTool: ToolContract<Record<string, never>> = {
    name: 'workspace_list',
    description: 'List active task workspaces.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute() {
      const workspaces = await services.listWorkspaces();
      return {
        ok: true,
        content: workspaces.length > 0 ? JSON.stringify(workspaces, null, 2) : 'No workspaces.'
      };
    }
  };

  const recordSummaryTool: ToolContract<{ message: string }> = {
    name: 'record_summary',
    description: 'Create a summary artifact.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' }
      },
      required: ['message']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(_context, args) {
      return {
        ok: true,
        content: args.message,
        artifacts: [
          {
            kind: 'summary',
            label: 'summary',
            value: args.message
          }
        ]
      };
    }
  };

  const tools: ToolContract<any>[] = [
    bashTool,
    readFileTool,
    writeFileTool,
    editFileTool,
    todoWriteTool,
    loadSkillTool,
    taskCreateTool,
    taskGetTool,
    taskUpdateTool,
    taskListTool,
    spawnSubagentTool,
    spawnTeammateTool,
    listTeamTool,
    sendMessageTool,
    readInboxTool,
    bgRunTool,
    bgCheckTool,
    workspaceListTool,
    recordSummaryTool
  ];

  return tools;
}
