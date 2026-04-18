import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { sanitizeSpawnEnv } from '../sandbox/env-sanitizer.js';
import { createSandboxFromEnv, type SandboxManager } from '../sandbox/os-sandbox.js';
import { createExternalAiTools } from './external-ai-tools.js';
import { globWorkspaceFiles } from './glob-files.js';
import { runWorkspaceGrep } from './grep-workspace.js';
import { readFileLineRange, shouldStreamReadFile } from './read-file-range.js';
import { lspSendRequest, parseLspConfigFromEnv } from './lsp-client.js';
import { fetchUrlText, webSearchFromEnv } from './web-fetch.js';
import {
  HARNESS_ARTIFACT_DIR,
  HARNESS_ARTIFACT_FILES,
  type AgentSpec,
  type BackgroundJobRecord,
  type MailRecord,
  type RunContext,
  type TaskRecord,
  type TodoItem,
  type ToolContract
} from '../types.js';
import {
  SOCIAL_POST_SCHEDULE_METADATA_KEY,
  SOCIAL_POST_TASK_KIND,
  buildSocialPostSchedule,
  taskTitleForSocialSchedule,
  type SocialPostApprovalState
} from '../social-schedule.js';

export interface RuntimeToolServices {
  loadSkill: (name: string, sessionId: string) => Promise<{ content?: string; error?: string }>;
  updateTodo: (sessionId: string, items: TodoItem[]) => Promise<TodoItem[]>;
  createTask: (input: {
    title: string;
    description?: string;
    blockedBy?: string[];
    ownerAgentId?: string;
    sessionId?: string;
    parentTaskId?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<TaskRecord>;
  getTask: (taskId: string) => Promise<TaskRecord | undefined>;
  listTasks: () => Promise<TaskRecord[]>;
  updateTask: (
    taskId: string,
    patch: Partial<Pick<TaskRecord, 'status' | 'ownerAgentId' | 'blockedBy' | 'workspaceId' | 'metadata'>>
  ) => Promise<TaskRecord>;
  harnessWriteSpec: (
    context: RunContext,
    input: { kind: 'product_spec' | 'sprint_contract' | 'evaluator_feedback'; content: string }
  ) => Promise<string>;
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
  upsertSessionMemory: (
    sessionId: string,
    scope: 'scratch' | 'long',
    key: string,
    value: string,
    metadata?: Record<string, unknown>
  ) => Promise<unknown>;
  listSessionMemory: (sessionId: string, scope?: 'scratch' | 'long') => Promise<unknown[]>;
  deleteSessionMemory: (sessionId: string, scope: 'scratch' | 'long', key: string) => Promise<boolean>;
  visionAnalyze: (input: {
    sessionId: string;
    assetIds: string[];
    prompt: string;
    signal?: AbortSignal;
  }) => Promise<string>;
}

// Lazy singleton — created once on first use.
let _sandbox: SandboxManager | undefined;
function getSandbox(): SandboxManager {
  if (!_sandbox) _sandbox = createSandboxFromEnv();
  return _sandbox;
}

function shellOutput(
  command: string,
  cwd: string,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<string> {
  const sandbox = getSandbox();
  return sandbox.execute(command, cwd, {
    timeoutMs: options?.timeoutMs,
    signal: options?.signal,
  }).then((result) => {
    if (options?.signal?.aborted) return '(command aborted)';
    const combined = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
    return combined || `(command exited with ${result.code ?? 0} and no output)`;
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

function externalAiToolsEnabled(): boolean {
  const v = process.env.RAW_AGENT_EXTERNAL_AI_TOOLS?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function notebookToolsEnabled(): boolean {
  const v = process.env.RAW_AGENT_NOTEBOOK_TOOLS?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
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
  const readFileTool: ToolContract<{ path?: string; limit?: number; offset_line?: number }> = {
    name: 'read_file',
    description:
      'Read a file or list the current workspace directory. For large files use offset_line + limit to read a line window without loading the whole file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        limit: { type: 'number' },
        offset_line: { type: 'number', description: '0-based start line when reading a file' }
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

      const target = repoPath(context, args.path);
      const targetStat = await stat(target);
      const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : undefined;
      const offsetLine = typeof args.offset_line === 'number' && args.offset_line >= 0 ? args.offset_line : 0;

      if (targetStat.isDirectory()) {
        const entries = await readdir(target, { withFileTypes: true });
        const lines = entries.map((entry) => `${entry.isDirectory() ? 'dir' : 'file'} ${entry.name}`);
        const sliced =
          limit && lines.length > limit ? [...lines.slice(0, limit), `... (${lines.length - limit} more entries)`] : lines;
        return {
          ok: true,
          content: sliced.join('\n') || '(empty directory)'
        };
      }

      const useWindow = offsetLine > 0 || (limit !== undefined && (await shouldStreamReadFile(target)));
      if (useWindow && limit !== undefined) {
        const { lines, truncated } = await readFileLineRange(target, offsetLine, limit);
        const header = `lines ${offsetLine}-${offsetLine + lines.length - 1}${truncated ? ' (more below)' : ''}\n`;
        return {
          ok: true,
          content: header + lines.join('\n')
        };
      }

      const content = await readFile(target, 'utf8');
      const lines = content.split('\n');
      const sliceStart = offsetLine;
      const sliceEnd = limit !== undefined ? sliceStart + limit : lines.length;
      const windowed = lines.slice(sliceStart, sliceEnd);
      const moreBelow = sliceEnd < lines.length;
      const header =
        offsetLine > 0 || moreBelow
          ? `lines ${sliceStart}-${sliceStart + windowed.length - 1}${moreBelow ? ` of ${lines.length}` : ''}\n`
          : '';
      return {
        ok: true,
        content: header + windowed.join('\n') + (moreBelow ? `\n... (${lines.length - sliceEnd} more lines)` : '')
      };
    }
  };

  const grepFilesTool: ToolContract<{
    pattern: string;
    glob?: string;
    max_matches?: number;
    context_lines?: number;
  }> = {
    name: 'grep_files',
    description: 'Search file contents under the workspace with ripgrep or grep.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        glob: { type: 'string' },
        max_matches: { type: 'number' },
        context_lines: { type: 'number' }
      },
      required: ['pattern']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const cwd = context.workspaceRoot ?? context.repoRoot;
      const max = typeof args.max_matches === 'number' && args.max_matches > 0 ? args.max_matches : 50;
      const ctx = typeof args.context_lines === 'number' && args.context_lines >= 0 ? args.context_lines : 0;
      const result = await runWorkspaceGrep({
        cwd,
        pattern: args.pattern,
        glob: args.glob,
        maxMatches: max,
        contextLines: ctx
      });
      return {
        ok: result.ok,
        content: result.content
      };
    }
  };

  const globFilesTool: ToolContract<{ pattern: string; max_results?: number }> = {
    name: 'glob_files',
    description:
      'List file paths under the workspace matching a glob pattern (Node built-in glob). Use instead of bash find for simple discovery.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern relative to workspace root, e.g. **/*.ts' },
        max_results: { type: 'number' }
      },
      required: ['pattern']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const cwd = context.workspaceRoot ?? context.repoRoot;
      return globWorkspaceFiles({
        cwd,
        pattern: args.pattern,
        maxResults: args.max_results
      });
    }
  };

  const webFetchTool: ToolContract<{ url: string }> = {
    name: 'web_fetch',
    description:
      'HTTP GET a public URL and return text (size-capped; blocks private IPs unless RAW_AGENT_WEB_FETCH_ALLOW_PRIVATE=1).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' }
      },
      required: ['url']
    },
    approvalMode: 'auto',
    sideEffectLevel: 'system',
    needsApproval: () => false,
    async execute(_context, args) {
      const maxBytes = Number(process.env.RAW_AGENT_WEB_FETCH_MAX_BYTES);
      const r = await fetchUrlText({
        url: args.url,
        maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : undefined,
        allowPrivateHosts: ['1', 'true', 'yes'].includes(
          String(process.env.RAW_AGENT_WEB_FETCH_ALLOW_PRIVATE ?? '').toLowerCase()
        )
      });
      return { ok: r.ok, content: r.content };
    }
  };

  const webSearchTool: ToolContract<{ query: string }> = {
    name: 'web_search',
    description:
      'Search the web when RAW_AGENT_WEB_SEARCH_URL is set (template with {query}). Otherwise returns configuration instructions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' }
      },
      required: ['query']
    },
    approvalMode: 'auto',
    sideEffectLevel: 'system',
    needsApproval: () => false,
    async execute(_context, args) {
      const r = await webSearchFromEnv(process.env, { query: args.query });
      return { ok: r.ok, content: r.content };
    }
  };

  const visionAnalyzeTool: ToolContract<{ asset_ids: string[]; prompt: string }> = {
    name: 'vision_analyze',
    description:
      'Run the configured VL model on one or more session image assets (ids from user messages / image parts). Use for OCR, UI description, diagram reading.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Image asset ids belonging to the current session'
        },
        prompt: { type: 'string', description: 'What to extract or answer about the image(s)' }
      },
      required: ['asset_ids', 'prompt']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const text = await services.visionAnalyze({
        sessionId: context.session.id,
        assetIds: args.asset_ids,
        prompt: args.prompt,
        signal: context.abortSignal
      });
      return { ok: true, content: text };
    }
  };

  const spillToolResultTool: ToolContract<{ content: string; label?: string }> = {
    name: 'spill_tool_result',
    description:
      'Write large text under .agent-spills/<sessionId>/ in the workspace (or repo) so read_file can paginate with offset_line/limit.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        label: { type: 'string' }
      },
      required: ['content']
    },
    approvalMode: 'never',
    sideEffectLevel: 'workspace',
    async execute(context, args) {
      const root = context.workspaceRoot ?? context.repoRoot;
      const relDir = join('.agent-spills', context.session.id);
      const dir = join(root, relDir);
      await mkdir(dir, { recursive: true });
      const name = `${args.label ?? 'spill'}-${Date.now()}.txt`;
      const relPath = join(relDir, name).replace(/\\/g, '/');
      await writeFile(join(dir, name), args.content, 'utf8');
      return {
        ok: true,
        content: `Spilled ${args.content.length} bytes. Use read_file with path "${relPath}" and offset_line/limit for chunks.`
      };
    }
  };

  const memorySetTool: ToolContract<{ scope: 'scratch' | 'long'; key: string; value: string }> = {
    name: 'memory_set',
    description: 'Store a key/value in session memory (scratch is copied on subagent handoff).',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['scratch', 'long'] },
        key: { type: 'string' },
        value: { type: 'string' }
      },
      required: ['scope', 'key', 'value']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      await services.upsertSessionMemory(context.session.id, args.scope, args.key, args.value);
      return { ok: true, content: `Set ${args.scope}/${args.key}` };
    }
  };

  const memoryGetTool: ToolContract<{ scope?: 'scratch' | 'long' }> = {
    name: 'memory_get',
    description: 'List session memory entries.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['scratch', 'long'] }
      }
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const rows = await services.listSessionMemory(context.session.id, args.scope);
      return {
        ok: true,
        content: rows.length > 0 ? JSON.stringify(rows, null, 2) : 'No memory entries.'
      };
    }
  };

  const memoryDeleteTool: ToolContract<{ scope: 'scratch' | 'long'; key: string }> = {
    name: 'memory_delete',
    description: 'Delete one memory key.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['scratch', 'long'] },
        key: { type: 'string' }
      },
      required: ['scope', 'key']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const ok = await services.deleteSessionMemory(context.session.id, args.scope, args.key);
      return { ok, content: ok ? `Deleted ${args.scope}/${args.key}` : 'Key not found' };
    }
  };

  const handoffStateTool: ToolContract<{ notes: string }> = {
    name: 'handoff_state',
    description: 'Record handoff notes into scratch memory for subagents/teammates (key handoff.notes).',
    inputSchema: {
      type: 'object',
      properties: {
        notes: { type: 'string' }
      },
      required: ['notes']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      await services.upsertSessionMemory(context.session.id, 'scratch', 'handoff.notes', args.notes);
      return { ok: true, content: 'Handoff notes stored in scratch memory.' };
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

  const bashTool: ToolContract<{ command: string; timeout_ms?: number }> = {
    name: 'bash',
    description: 'Run a shell command inside the workspace root. Optional timeout_ms (default from env RAW_AGENT_BASH_TIMEOUT_MS).',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout_ms: { type: 'number' }
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
      const envDefault = Number(process.env.RAW_AGENT_BASH_TIMEOUT_MS);
      const timeoutMs =
        typeof args.timeout_ms === 'number' && args.timeout_ms > 0
          ? args.timeout_ms
          : Number.isFinite(envDefault) && envDefault > 0
            ? envDefault
            : 120_000;
      return {
        ok: true,
        content: await shellOutput(args.command, context.workspaceRoot ?? context.repoRoot, {
          timeoutMs,
          signal: context.abortSignal
        })
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
    description: 'Load a skill by name (repo `skills/` and `~/.agents/**/SKILL.md`; same name in ~/.agents overrides).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' }
      },
      required: ['name']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const { content, error } = await services.loadSkill(args.name, context.session.id);
      return {
        ok: Boolean(content),
        content: content ?? error ?? `Unknown skill ${args.name}`
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
    metadata?: Record<string, unknown>;
  }> = {
    name: 'task_update',
    description:
      'Update task status, owner, dependencies, or metadata (metadata merges with existing keys). Use metadata.harnessSprint* for sprint contract workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        status: { type: 'string' },
        ownerAgentId: { type: 'string' },
        blockedBy: { type: 'array', items: { type: 'string' } },
        metadata: { type: 'object', description: 'Shallow-merged into existing task metadata' }
      },
      required: ['taskId']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(_context, args) {
      const task = await services.updateTask(args.taskId, {
        status: args.status,
        ownerAgentId: args.ownerAgentId,
        blockedBy: args.blockedBy,
        metadata: args.metadata
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

  const scheduleSocialPostTool: ToolContract<{
    body: string;
    channels: string[];
    publish_at: string;
    approval?: SocialPostApprovalState;
    first_comment?: string;
    follow_up_hint?: string;
    idempotency_key?: string;
  }> = {
    name: 'schedule_social_post',
    description:
      'Queue a multi-channel social post as a task with structured metadata (approval + publish time + optional first comment). Uses task storage until outbound dispatch is wired; idempotency_key prevents duplicate publishes once dispatch runs.',
    inputSchema: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'Post body / main text' },
        channels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Targets e.g. x, linkedin, webhook:<gateway channel id>'
        },
        publish_at: { type: 'string', description: 'ISO 8601 UTC time to publish' },
        approval: {
          type: 'string',
          enum: ['draft', 'pending_approval', 'approved', 'rejected'],
          description: 'Defaults to pending_approval'
        },
        first_comment: { type: 'string', description: 'Optional first comment (e.g. X reply)' },
        follow_up_hint: { type: 'string', description: 'Optional note for future auto-reply' },
        idempotency_key: { type: 'string', description: 'Omit to auto-generate' }
      },
      required: ['body', 'channels', 'publish_at']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const built = buildSocialPostSchedule({
        body: args.body,
        channels: args.channels,
        publishAt: args.publish_at,
        approval: args.approval,
        firstComment: args.first_comment,
        followUpHint: args.follow_up_hint,
        idempotencyKey: args.idempotency_key
      });
      if (!built.ok) {
        return { ok: false, content: built.error };
      }
      const schedule = built.schedule;
      const task = await services.createTask({
        title: taskTitleForSocialSchedule(schedule.body),
        description: schedule.body,
        ownerAgentId: context.agent.id,
        sessionId: context.session.id,
        parentTaskId: context.task?.id,
        metadata: {
          kind: SOCIAL_POST_TASK_KIND,
          [SOCIAL_POST_SCHEDULE_METADATA_KEY]: schedule
        }
      });
      return {
        ok: true,
        content: JSON.stringify(
          {
            taskId: task.id,
            schedule,
            note: 'Dispatch not executed here; use future approve/run-now flow or task_update to change approval.'
          },
          null,
          2
        )
      };
    }
  };

  const spawnSubagentTool: ToolContract<{ prompt: string; role?: string }> = {
    name: 'spawn_subagent',
    description:
      'Run a clean-context subagent and return its summary. role maps to builtin agents: research→researcher, implement→implementer, review→reviewer, planner→planner, generator→generator, evaluator→evaluator; otherwise uses the parent agent.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        role: {
          type: 'string',
          description:
            'Optional: research | implement | review | planner | generator | evaluator (harness roles) or omit to inherit parent agent'
        }
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

  const harnessWriteSpecTool: ToolContract<{
    kind: 'product_spec' | 'sprint_contract' | 'evaluator_feedback';
    content: string;
  }> = {
    name: 'harness_write_spec',
    description: `Write a structured harness artifact under ${HARNESS_ARTIFACT_DIR}/ (${HARNESS_ARTIFACT_FILES.productSpec}, ${HARNESS_ARTIFACT_FILES.sprintContract}, ${HARNESS_ARTIFACT_FILES.evaluatorFeedback}) for handoffs across compaction or subagents.`,
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['product_spec', 'sprint_contract', 'evaluator_feedback'],
          description: 'Which artifact to write'
        },
        content: { type: 'string', description: 'Full markdown body' }
      },
      required: ['kind', 'content']
    },
    approvalMode: 'never',
    sideEffectLevel: 'workspace',
    async execute(context, args) {
      const path = await services.harnessWriteSpec(context, {
        kind: args.kind,
        content: args.content
      });
      return {
        ok: true,
        content: `Wrote ${path}`
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

  const lspRequestTool: ToolContract<{ method: string; params?: Record<string, unknown> }> = {
    name: 'lsp_request',
    description:
      'Send a single LSP request after initialize (requires RAW_AGENT_LSP_ENABLED=1 and RAW_AGENT_LSP_COMMAND JSON with command/args).',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string' },
        params: { type: 'object' }
      },
      required: ['method']
    },
    approvalMode: 'auto',
    sideEffectLevel: 'system',
    needsApproval: () => true,
    async execute(_context, args) {
      const cfg = parseLspConfigFromEnv(process.env);
      if (!cfg) {
        return {
          ok: false,
          content: 'LSP disabled. Set RAW_AGENT_LSP_ENABLED=1 and RAW_AGENT_LSP_COMMAND={"command":"...","args":[]}.'
        };
      }
      try {
        const text = await lspSendRequest(cfg, args.method, args.params ?? {});
        return { ok: true, content: text };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { ok: false, content: msg };
      }
    }
  };

  const notebookEditTool: ToolContract<{ path: string; cell_index: number; source: string }> = {
    name: 'notebook_edit',
    description:
      'Edit one code/markdown cell in a Jupyter .ipynb file (nbformat). Requires RAW_AGENT_NOTEBOOK_TOOLS=1.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Notebook path relative to workspace' },
        cell_index: { type: 'number', description: '0-based cell index' },
        source: { type: 'string', description: 'New cell source text' }
      },
      required: ['path', 'cell_index', 'source']
    },
    approvalMode: 'auto',
    sideEffectLevel: 'workspace',
    async execute(context, args) {
      const target = repoPath(context, args.path);
      if (!target.toLowerCase().endsWith('.ipynb')) {
        return { ok: false, content: 'Path must end with .ipynb' };
      }
      const raw = await readFile(target, 'utf8');
      const nb = JSON.parse(raw) as { cells?: Array<{ cell_type?: string; source?: string | string[] }> };
      const cells = nb.cells;
      if (!cells || args.cell_index < 0 || args.cell_index >= cells.length) {
        return { ok: false, content: 'Invalid cell_index for this notebook' };
      }
      const cell = cells[args.cell_index];
      if (!cell) {
        return { ok: false, content: 'Missing cell' };
      }
      if (cell.cell_type !== 'code' && cell.cell_type !== 'markdown') {
        return { ok: false, content: `Cell ${args.cell_index} is not code or markdown` };
      }
      const lines = args.source.split('\n');
      cell.source = lines.map((line, i) => (i < lines.length - 1 ? `${line}\n` : line));
      await writeFile(target, `${JSON.stringify(nb, null, 2)}\n`, 'utf8');
      return { ok: true, content: `Updated cell ${args.cell_index} in ${args.path}` };
    }
  };

  const tools: ToolContract<any>[] = [
    bashTool,
    readFileTool,
    visionAnalyzeTool,
    grepFilesTool,
    globFilesTool,
    webFetchTool,
    webSearchTool,
    spillToolResultTool,
    memorySetTool,
    memoryGetTool,
    memoryDeleteTool,
    handoffStateTool,
    writeFileTool,
    editFileTool,
    todoWriteTool,
    loadSkillTool,
    taskCreateTool,
    taskGetTool,
    taskUpdateTool,
    taskListTool,
    scheduleSocialPostTool,
    harnessWriteSpecTool,
    spawnSubagentTool,
    spawnTeammateTool,
    listTeamTool,
    sendMessageTool,
    readInboxTool,
    bgRunTool,
    bgCheckTool,
    workspaceListTool,
    recordSummaryTool,
    lspRequestTool
  ];

  if (notebookToolsEnabled()) {
    tools.push(notebookEditTool);
  }

  if (externalAiToolsEnabled()) {
    tools.push(...createExternalAiTools());
  }

  return tools;
}

export { createExternalAiTools };
