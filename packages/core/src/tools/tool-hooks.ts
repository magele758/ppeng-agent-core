import { spawn } from 'node:child_process';
import { sanitizeSpawnEnv } from '../sandbox/env-sanitizer.js';
import { envInt } from '../env.js';

export interface ToolHookPayload {
  phase: 'pre_tool_use' | 'post_tool_use';
  tool: string;
  sessionId: string;
  input: unknown;
  /** Present for post only */
  ok?: boolean;
  content?: string;
}

export interface ToolHookResult {
  block?: boolean;
  message?: string;
  /** Replace tool input (pre only) */
  input?: unknown;
}

function parseHookOutput(text: string): ToolHookResult {
  const t = text.trim();
  if (!t) {
    return {};
  }
  try {
    return JSON.parse(t) as ToolHookResult;
  } catch {
    return { message: t };
  }
}

export async function runToolHook(
  env: NodeJS.ProcessEnv,
  payload: ToolHookPayload
): Promise<ToolHookResult> {
  const key = payload.phase === 'pre_tool_use' ? 'RAW_AGENT_HOOK_PRE_TOOL' : 'RAW_AGENT_HOOK_POST_TOOL';
  const scriptPath = env[key]?.trim();
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
      resolve({ block: false, message: `hook spawn error: ${e instanceof Error ? e.message : String(e)}` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      // Killed (e.g. SIGTERM on timeout): code is null; must fail closed for pre_tool_use.
      const killed = signal != null;
      const badExit = code !== 0 && code !== null;
      if (killed || badExit) {
        const detail = killed ? `signal ${signal}` : `exit ${code}`;
        resolve({
          block: payload.phase === 'pre_tool_use',
          message: err || out || `hook ${detail}`
        });
        return;
      }
      resolve(parseHookOutput(out));
    });
    child.stdin?.write(body);
    child.stdin?.end();
  });
}

