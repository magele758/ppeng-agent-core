import { spawn } from 'node:child_process';
import type { RunContext, ToolContract } from './types.js';

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
      env: process.env
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

/**
 * 可选工具：供 Agent 在对话/任务中自主调用外部 AI CLI（需本机已安装对应命令）。
 * 仅当 `RAW_AGENT_EXTERNAL_AI_TOOLS=1` 时由 createBuiltinTools 挂载。
 */
export function createExternalAiTools(): ToolContract<any>[] {
  const claudeCode: ToolContract<{ prompt: string; timeout_ms?: number }> = {
    name: 'claude_code',
    description:
      'Run Claude Code CLI non-interactively (`claude -p`). Requires `claude` on PATH. Use for hard refactors or when built-in tools are insufficient; runs in workspace root and may edit files. Costs API usage; always requires approval.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Instructions for Claude Code (-p mode)' },
        timeout_ms: { type: 'number', description: 'Timeout in ms (default 600000)' }
      },
      required: ['prompt']
    },
    approvalMode: 'auto',
    sideEffectLevel: 'workspace',
    needsApproval: () => true,
    async execute(context, args) {
      const timeoutMs = typeof args.timeout_ms === 'number' && args.timeout_ms > 0 ? args.timeout_ms : 600_000;
      const cwd = workspaceCwd(context);
      try {
        const { code, output } = await spawnCaptured('claude', ['-p', args.prompt], cwd, {
          timeoutMs,
          signal: context.abortSignal
        });
        return { ok: code === 0, content: output };
      } catch (e) {
        return { ok: false, content: e instanceof Error ? e.message : String(e) };
      }
    }
  };

  const codexExec: ToolContract<{
    prompt: string;
    full_auto?: boolean;
    timeout_ms?: number;
  }> = {
    name: 'codex_exec',
    description:
      'Run OpenAI Codex CLI non-interactively (`codex exec`). Requires `codex` on PATH. Default sandbox allows writing workspace; set full_auto true for fewer prompts (riskier). Costs usage; always requires approval.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Task instructions for Codex' },
        full_auto: {
          type: 'boolean',
          description: 'If true, passes --full-auto (auto-approve tool use; use with care)'
        },
        timeout_ms: { type: 'number', description: 'Timeout in ms (default 600000)' }
      },
      required: ['prompt']
    },
    approvalMode: 'auto',
    sideEffectLevel: 'workspace',
    needsApproval: () => true,
    async execute(context, args) {
      const timeoutMs = typeof args.timeout_ms === 'number' && args.timeout_ms > 0 ? args.timeout_ms : 600_000;
      const cwd = workspaceCwd(context);
      const base =
        args.full_auto === true ? ['exec', '--full-auto'] : ['exec', '--sandbox', 'workspace-write'];
      try {
        const { code, output } = await spawnCaptured('codex', [...base, args.prompt], cwd, {
          timeoutMs,
          signal: context.abortSignal
        });
        return { ok: code === 0, content: output };
      } catch (e) {
        return { ok: false, content: e instanceof Error ? e.message : String(e) };
      }
    }
  };

  const cursorAgent: ToolContract<{ prompt: string; timeout_ms?: number }> = {
    name: 'cursor_agent',
    description:
      'Run Cursor Agent CLI non-interactively (`agent --print`). Requires `agent` on PATH (Cursor Agent CLI, not the `cursor` editor launcher). May edit files and run shell in workspace; always requires approval.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Instructions for Cursor Agent' },
        timeout_ms: { type: 'number', description: 'Timeout in ms (default 600000)' }
      },
      required: ['prompt']
    },
    approvalMode: 'auto',
    sideEffectLevel: 'workspace',
    needsApproval: () => true,
    async execute(context, args) {
      const timeoutMs = typeof args.timeout_ms === 'number' && args.timeout_ms > 0 ? args.timeout_ms : 600_000;
      const cwd = workspaceCwd(context);
      try {
        const { code, output } = await spawnCaptured('agent', ['--print', args.prompt], cwd, {
          timeoutMs,
          signal: context.abortSignal
        });
        return { ok: code === 0, content: output };
      } catch (e) {
        return { ok: false, content: e instanceof Error ? e.message : String(e) };
      }
    }
  };

  return [claudeCode, codexExec, cursorAgent];
}
