import { spawn } from 'node:child_process';
import { sanitizeSpawnEnv } from '../sandbox/env-sanitizer.js';
import { envInt } from '../env.js';
import { runToolHook, type ToolHookPayload, type ToolHookResult } from '../tools/tool-hooks.js';

/**
 * Lifecycle hook phases aligned with Claude Code-style extension surface.
 * Tool phases reuse {@link runToolHook}; others use RAW_AGENT_HOOK_<PHASE> env scripts.
 */
export type LifecycleHookPhase =
  | 'session_start'
  | 'user_prompt_submit'
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'pre_compact'
  | 'stop'
  | 'subagent_stop';

export type PermissionDecision = 'allow' | 'deny' | 'ask';

export interface LifecycleHookPayload {
  phase: LifecycleHookPhase;
  sessionId: string;
  /** Tool name when phase is pre/post_tool_use */
  tool?: string;
  input?: unknown;
  ok?: boolean;
  content?: string;
  /** Optional free-form context (prompt text, compact reason, stop reason, …) */
  context?: Record<string, unknown>;
}

export interface LifecycleHookResult {
  /** Legacy block flag (pre_tool_use / user_prompt_submit) */
  block?: boolean;
  message?: string;
  systemMessage?: string;
  /** Replace tool input (pre_tool_use only) */
  input?: unknown;
  updatedInput?: unknown;
  /**
   * Claude-style permission decision.
   * - allow: proceed
   * - deny: block (same as block=true)
   * - ask: force human approval for this tool call
   */
  permissionDecision?: PermissionDecision;
}

const PHASE_ENV: Record<Exclude<LifecycleHookPhase, 'pre_tool_use' | 'post_tool_use'>, string> = {
  session_start: 'RAW_AGENT_HOOK_SESSION_START',
  user_prompt_submit: 'RAW_AGENT_HOOK_USER_PROMPT_SUBMIT',
  pre_compact: 'RAW_AGENT_HOOK_PRE_COMPACT',
  stop: 'RAW_AGENT_HOOK_STOP',
  subagent_stop: 'RAW_AGENT_HOOK_SUBAGENT_STOP'
};

function parseLifecycleOutput(text: string): LifecycleHookResult {
  const t = text.trim();
  if (!t) return {};
  try {
    const parsed = JSON.parse(t) as LifecycleHookResult & {
      hookSpecificOutput?: {
        permissionDecision?: PermissionDecision;
        updatedInput?: unknown;
        systemMessage?: string;
      };
    };
    const nested = parsed.hookSpecificOutput;
    if (nested) {
      return {
        ...parsed,
        permissionDecision: parsed.permissionDecision ?? nested.permissionDecision,
        updatedInput: parsed.updatedInput ?? nested.updatedInput,
        systemMessage: parsed.systemMessage ?? nested.systemMessage
      };
    }
    return parsed;
  } catch {
    return { message: t, systemMessage: t };
  }
}

function normalizeDecision(result: LifecycleHookResult): LifecycleHookResult {
  if (result.permissionDecision === 'deny') {
    return { ...result, block: true };
  }
  if (result.permissionDecision === 'allow' && result.block === undefined) {
    return { ...result, block: false };
  }
  if (result.updatedInput !== undefined && result.input === undefined) {
    return { ...result, input: result.updatedInput };
  }
  return result;
}

async function runScriptHook(
  env: NodeJS.ProcessEnv,
  envKey: string,
  payload: LifecycleHookPayload,
  failClosed: boolean
): Promise<LifecycleHookResult> {
  const scriptPath = env[envKey]?.trim();
  if (!scriptPath) {
    return {};
  }

  const body = `${JSON.stringify(payload)}\n`;
  const useNode =
    scriptPath.endsWith('.mjs') ||
    scriptPath.endsWith('.cjs') ||
    scriptPath.endsWith('.js') ||
    scriptPath.endsWith('.ts');

  return new Promise((resolve) => {
    const child = useNode
      ? spawn(process.execPath, [scriptPath], {
          env: sanitizeSpawnEnv({ overrides: env }),
          stdio: ['pipe', 'pipe', 'pipe']
        })
      : spawn(scriptPath, [], {
          env: sanitizeSpawnEnv({ overrides: env }),
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false
        });

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, envInt(env, 'RAW_AGENT_HOOK_TIMEOUT_MS', 30_000));

    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      err += d.toString('utf8');
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({
        block: failClosed,
        message: `hook spawn error: ${e instanceof Error ? e.message : String(e)}`
      });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const killed = signal != null;
      const badExit = code !== 0 && code !== null;
      if (killed || badExit) {
        const detail = killed ? `signal ${signal}` : `exit ${code}`;
        resolve({
          block: failClosed,
          message: err || out || `hook ${detail}`
        });
        return;
      }
      resolve(normalizeDecision(parseLifecycleOutput(out)));
    });
    child.stdin?.write(body);
    child.stdin?.end();
  });
}

/**
 * Run a lifecycle hook. Tool phases delegate to {@link runToolHook} then normalize
 * Claude-style `permissionDecision` / `updatedInput` fields.
 */
export async function runLifecycleHook(
  env: NodeJS.ProcessEnv,
  payload: LifecycleHookPayload
): Promise<LifecycleHookResult> {
  if (payload.phase === 'pre_tool_use' || payload.phase === 'post_tool_use') {
    const toolPayload: ToolHookPayload = {
      phase: payload.phase,
      tool: payload.tool ?? 'unknown',
      sessionId: payload.sessionId,
      input: payload.input,
      ok: payload.ok,
      content: payload.content
    };
    const raw: ToolHookResult = await runToolHook(env, toolPayload);
    return normalizeDecision({
      block: raw.block,
      message: raw.message,
      input: raw.input,
      updatedInput: raw.input,
      ...(raw as LifecycleHookResult)
    });
  }

  const envKey = PHASE_ENV[payload.phase];
  const failClosed = payload.phase === 'user_prompt_submit' || payload.phase === 'pre_compact';
  return runScriptHook(env, envKey, payload, failClosed);
}

/** Map lifecycle result to approval / block decisions for the tool gate. */
export function lifecycleForcesApproval(result: LifecycleHookResult): boolean {
  return result.permissionDecision === 'ask';
}

export function lifecycleBlocks(result: LifecycleHookResult): boolean {
  return result.block === true || result.permissionDecision === 'deny';
}
