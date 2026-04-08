import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { SelfHealPolicy } from '../types.js';
import { sanitizeSpawnEnv } from '../sandbox/env-sanitizer.js';
import { npmScriptForSelfHealPolicy } from './self-heal-policy.js';

/** 为子进程补足 PATH（supervisor/受限环境常见缺 Homebrew、同目录 npm），并剥离危险注入变量。 */
export function enrichSpawnEnv(overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base = sanitizeSpawnEnv({ overrides });
  const extraDirs = [
    path.dirname(process.execPath),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin'
  ];
  const sep = path.delimiter;
  const cur = base.PATH ?? '';
  const prefix = extraDirs.join(sep);
  const PATH = cur ? `${prefix}${sep}${cur}` : prefix;
  return { ...base, PATH };
}

/** Daemon 若从 supervisor/GUI 启动，PATH 可能不含 npm；优先用与当前 node 同目录的 npm。 */
export function resolveNpmBin(): string {
  const explicit = process.env.RAW_AGENT_NPM_BIN?.trim() || process.env.RAW_AGENT_NPM?.trim();
  if (explicit) return explicit;
  const dir = path.dirname(process.execPath);
  if (process.platform === 'win32') {
    const cmd = path.join(dir, 'npm.cmd');
    if (existsSync(cmd)) return cmd;
  } else {
    const npm = path.join(dir, 'npm');
    if (existsSync(npm)) return npm;
  }
  return 'npm';
}

/** 显式路径优先，其次常见安装位置，避免 spawn git ENOENT。 */
export function resolveGitBin(): string {
  const explicit = process.env.RAW_AGENT_GIT_BIN?.trim();
  if (explicit) return explicit;
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Git\\cmd\\git.exe',
          'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
          path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'cmd', 'git.exe')
        ]
      : ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return 'git';
}

function spawnCapture(
  command: string,
  args: string[],
  cwd: string,
  options?: { timeoutMs?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv }
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: enrichSpawnEnv(options?.env ? { ...process.env, ...options.env } : undefined)
    });

    let stdout = '';
    let stderr = '';
    const onAbort = () => child.kill('SIGTERM');
    options?.signal?.addEventListener('abort', onAbort, { once: true });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options?.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => child.kill('SIGTERM'), options.timeoutMs);
    }

    child.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    child.on('close', (code) => {
      options?.signal?.removeEventListener('abort', onAbort);
      if (timer) clearTimeout(timer);
      const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      resolve({
        code,
        output:
          options?.signal?.aborted && !combined ? '(aborted)' : combined || `(exit ${code ?? '?'}, no output)`
      });
    });
    child.on('error', (err) => {
      options?.signal?.removeEventListener('abort', onAbort);
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

const DEFAULT_TEST_TIMEOUT_MS = 3_600_000;

export async function runSelfHealNpmTest(
  cwd: string,
  policy: SelfHealPolicy,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<{ ok: boolean; output: string }> {
  const script = npmScriptForSelfHealPolicy(policy);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;
  const { code, output } = await spawnCapture(resolveNpmBin(), ['run', script], cwd, {
    timeoutMs,
    signal: options?.signal
  });
  return { ok: code === 0, output };
}

export async function gitResolveBranch(cwd: string): Promise<string | undefined> {
  try {
    const { code, output } = await spawnCapture(resolveGitBin(), ['rev-parse', '--abbrev-ref', 'HEAD'], cwd, {});
    if (code !== 0) return undefined;
    const b = output.trim();
    return b || undefined;
  } catch {
    return undefined;
  }
}

/** True if `git status --porcelain` is empty. */
export async function gitWorktreeClean(cwd: string): Promise<boolean> {
  try {
    const { code, output } = await spawnCapture(resolveGitBin(), ['status', '--porcelain'], cwd, {});
    if (code !== 0) return false;
    return output.trim().length === 0;
  } catch {
    return false;
  }
}

export async function gitMergeBranch(repoRoot: string, branch: string): Promise<{ ok: boolean; output: string }> {
  const { code, output } = await spawnCapture(resolveGitBin(), ['merge', '--no-edit', branch], repoRoot, {
    timeoutMs: 120_000
  });
  return { ok: code === 0, output };
}

export async function gitCheckoutBranch(repoRoot: string, branch: string): Promise<{ ok: boolean; output: string }> {
  const { code, output } = await spawnCapture(resolveGitBin(), ['checkout', branch], repoRoot, { timeoutMs: 60_000 });
  return { ok: code === 0, output };
}

export async function gitRevParseHead(cwd: string): Promise<string | undefined> {
  try {
    const { code, output } = await spawnCapture(resolveGitBin(), ['rev-parse', 'HEAD'], cwd, {});
    if (code !== 0) return undefined;
    const h = output.trim();
    return h || undefined;
  } catch {
    return undefined;
  }
}

/** Stash tracked + untracked (for self-heal merge when main working tree is dirty). */
export async function gitStashPush(repoRoot: string, message: string): Promise<{ ok: boolean; output: string }> {
  const { code, output } = await spawnCapture(resolveGitBin(), ['stash', 'push', '-u', '-m', message], repoRoot, {
    timeoutMs: 120_000
  });
  return { ok: code === 0, output };
}

export async function gitStashPop(repoRoot: string): Promise<{ ok: boolean; output: string }> {
  const { code, output } = await spawnCapture(resolveGitBin(), ['stash', 'pop'], repoRoot, { timeoutMs: 120_000 });
  return { ok: code === 0, output };
}

export async function gitMergeAbort(repoRoot: string): Promise<{ ok: boolean; output: string }> {
  const { code, output } = await spawnCapture(resolveGitBin(), ['merge', '--abort'], repoRoot, { timeoutMs: 60_000 });
  return { ok: code === 0, output };
}

/** 合并成功后可选推送到远端（需本机已配置 remote 与凭证）。 */
export async function gitPushBranch(
  repoRoot: string,
  remote: string,
  branch: string
): Promise<{ ok: boolean; output: string }> {
  const r = remote.trim() || 'origin';
  const { code, output } = await spawnCapture(resolveGitBin(), ['push', r, branch], repoRoot, {
    timeoutMs: 300_000
  });
  return { ok: code === 0, output };
}
