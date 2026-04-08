import { spawn } from 'node:child_process';
import { sanitizeSpawnEnv } from '../sandbox/env-sanitizer.js';

export interface GrepOptions {
  cwd: string;
  pattern: string;
  glob?: string;
  maxMatches: number;
  contextLines?: number;
}

function runCmd(
  command: string,
  args: string[],
  cwd: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, env: sanitizeSpawnEnv() });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    child.on('error', () => {
      resolve({ code: -1, stdout: '', stderr: 'spawn error' });
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

/** Run ripgrep if available, else recursive grep. */
export async function runWorkspaceGrep(options: GrepOptions): Promise<{ ok: boolean; content: string }> {
  const { cwd, pattern, glob, maxMatches, contextLines = 0 } = options;
  const limit = Math.min(Math.max(maxMatches, 1), 500);

  const rgArgs = [
    '--line-number',
    '--no-heading',
    '--max-count',
    String(limit),
    ...(contextLines > 0 ? ['-C', String(contextLines)] : []),
    ...(glob ? ['--glob', glob] : []),
    pattern,
    '.'
  ];

  const rg = await runCmd('rg', rgArgs, cwd);
  if (rg.code !== -1) {
    if (rg.code === 0 || rg.stdout.trim()) {
      return { ok: true, content: rg.stdout.trim() || '(no matches)' };
    }
    if (rg.code === 1) {
      return { ok: true, content: '(no matches)' };
    }
  }

  const grepArgs = ['-RIn', '--max-count', String(limit), pattern, '.'];
  const g = await runCmd('grep', grepArgs, cwd);
  if (g.code === -1) {
    return { ok: false, content: 'Neither rg nor grep is available in PATH.' };
  }
  if (g.code === 0 || g.stdout.trim()) {
    return { ok: true, content: g.stdout.trim() || '(no matches)' };
  }
  if (g.code === 1) {
    return { ok: true, content: '(no matches)' };
  }
  return { ok: false, content: g.stderr.trim() || 'grep failed' };
}
