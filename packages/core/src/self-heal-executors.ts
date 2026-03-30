import { spawn } from 'node:child_process';
import type { SelfHealPolicy } from './types.js';
import { npmScriptForSelfHealPolicy } from './self-heal-policy.js';

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
      env: options?.env ?? process.env
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
  const { code, output } = await spawnCapture('npm', ['run', script], cwd, {
    timeoutMs,
    signal: options?.signal
  });
  return { ok: code === 0, output };
}

export async function gitResolveBranch(cwd: string): Promise<string | undefined> {
  try {
    const { code, output } = await spawnCapture('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd, {});
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
    const { code, output } = await spawnCapture('git', ['status', '--porcelain'], cwd, {});
    if (code !== 0) return false;
    return output.trim().length === 0;
  } catch {
    return false;
  }
}

export async function gitMergeBranch(repoRoot: string, branch: string): Promise<{ ok: boolean; output: string }> {
  const { code, output } = await spawnCapture('git', ['merge', '--no-edit', branch], repoRoot, {
    timeoutMs: 120_000
  });
  return { ok: code === 0, output };
}

export async function gitCheckoutBranch(repoRoot: string, branch: string): Promise<{ ok: boolean; output: string }> {
  const { code, output } = await spawnCapture('git', ['checkout', branch], repoRoot, { timeoutMs: 60_000 });
  return { ok: code === 0, output };
}

export async function gitRevParseHead(cwd: string): Promise<string | undefined> {
  try {
    const { code, output } = await spawnCapture('git', ['rev-parse', 'HEAD'], cwd, {});
    if (code !== 0) return undefined;
    const h = output.trim();
    return h || undefined;
  } catch {
    return undefined;
  }
}

/** Stash tracked + untracked (for self-heal merge when main working tree is dirty). */
export async function gitStashPush(repoRoot: string, message: string): Promise<{ ok: boolean; output: string }> {
  const { code, output } = await spawnCapture('git', ['stash', 'push', '-u', '-m', message], repoRoot, {
    timeoutMs: 120_000
  });
  return { ok: code === 0, output };
}

export async function gitStashPop(repoRoot: string): Promise<{ ok: boolean; output: string }> {
  const { code, output } = await spawnCapture('git', ['stash', 'pop'], repoRoot, { timeoutMs: 120_000 });
  return { ok: code === 0, output };
}

export async function gitMergeAbort(repoRoot: string): Promise<{ ok: boolean; output: string }> {
  const { code, output } = await spawnCapture('git', ['merge', '--abort'], repoRoot, { timeoutMs: 60_000 });
  return { ok: code === 0, output };
}
