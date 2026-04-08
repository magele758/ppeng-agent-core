import { spawn } from 'node:child_process';
import { sanitizeSpawnEnv } from '../sandbox/env-sanitizer.js';
import type { RunContext, ToolContract } from '../types.js';

function workspaceCwd(context: RunContext): string {
  return context.workspaceRoot ?? context.repoRoot;
}

/** spawn 无 shell，提示词仅作 argv 传递，避免注入 */
function spawnCaptured(
  command: string,
  args: string[],
  cwd: string,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: sanitizeSpawnEnv()
    });

    let stdout = '';
    let stderr = '';

    const onAbort = () => {
      child.kill('SIGTERM');
    };
    options?.signal?.addEventListener('abort', onAbort, { once: true });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options?.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, options.timeoutMs);
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      options?.signal?.removeEventListener('abort', onAbort);
      if (timer) clearTimeout(timer);
      const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      resolve({
        code,
        output:
          options?.signal?.aborted && !combined
            ? '(aborted)'
            : combined || `(exit ${code ?? '?'}, no output)`
      });
    });

    child.on('error', (err) => {
      options?.signal?.removeEventListener('abort', onAbort);
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

interface ExternalToolDef {
  name: string;
  command: string;
  description: string;
  buildArgs: (args: { prompt: string; [k: string]: unknown }) => string[];
}

function createExternalCliTool(def: ExternalToolDef): ToolContract<{ prompt: string; timeout_ms?: number }> {
  return {
    name: def.name,
    isExternal: true,
    description: def.description,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Instructions for the CLI tool' },
        timeout_ms: { type: 'number', description: 'Timeout in ms (default 600000)' }
      },
      required: ['prompt']
    },
    approvalMode: 'auto',
    sideEffectLevel: 'workspace',
    needsApproval: () => true,
    async execute(context, args) {
      if (typeof args.prompt !== 'string' || args.prompt.length > 50_000) {
        return { ok: false, content: 'prompt must be a string (max 50k chars)' };
      }
      const timeoutMs = typeof args.timeout_ms === 'number' && args.timeout_ms > 0 ? args.timeout_ms : 600_000;
      const cwd = workspaceCwd(context);
      try {
        const { code, output } = await spawnCaptured(def.command, def.buildArgs(args), cwd, {
          timeoutMs,
          signal: context.abortSignal
        });
        return { ok: code === 0, content: output };
      } catch (e) {
        return { ok: false, content: e instanceof Error ? e.message : String(e) };
      }
    }
  };
}

/**
 * 可选工具：供 Agent 在对话/任务中自主调用外部 AI CLI（需本机已安装对应命令）。
 * 仅当 `RAW_AGENT_EXTERNAL_AI_TOOLS=1` 时由 createBuiltinTools 挂载。
 */
export function createExternalAiTools(): ToolContract<any>[] {
  return [
    createExternalCliTool({
      name: 'claude_code',
      command: 'claude',
      description:
        'Run Claude Code CLI non-interactively (`claude -p`). Requires `claude` on PATH. Use for hard refactors or when built-in tools are insufficient; runs in workspace root and may edit files. Costs API usage; always requires approval.',
      buildArgs: (args) => ['-p', args.prompt]
    }),
    createExternalCliTool({
      name: 'codex_exec',
      command: 'codex',
      description:
        'Run OpenAI Codex CLI non-interactively (`codex exec`). Requires `codex` on PATH. Default sandbox allows writing workspace; set full_auto true for fewer prompts (riskier). Costs usage; always requires approval.',
      buildArgs: (args) => {
        const base = (args as { full_auto?: boolean }).full_auto === true
          ? ['exec', '--full-auto']
          : ['exec', '--sandbox', 'workspace-write'];
        return [...base, args.prompt];
      }
    }),
    createExternalCliTool({
      name: 'cursor_agent',
      command: 'agent',
      description:
        'Run Cursor Agent CLI non-interactively (`agent --print`). Requires `agent` on PATH (Cursor Agent CLI, not the `cursor` editor launcher). May edit files and run shell in workspace; always requires approval.',
      buildArgs: (args) => ['--print', args.prompt]
    })
  ];
}

