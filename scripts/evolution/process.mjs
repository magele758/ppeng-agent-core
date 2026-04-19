/**
 * Subprocess + env helpers for evolution-run-day.
 *
 * Extracted to keep the main orchestrator focused on flow logic rather than
 * spawn/sanitize plumbing. Mirrors `packages/core/src/sandbox/env-sanitizer.ts`
 * (Tier 0): we strip injection vectors *without* importing core, so the script
 * stays runnable inside a worktree where compiled core may be missing.
 */
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';

/** Linker / interpreter / shell injection vectors (kept in sync with core). */
const SANDBOX_INJECTION_ENV_KEYS = new Set([
  'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'DYLD_FRAMEWORK_PATH', 'DYLD_FALLBACK_LIBRARY_PATH',
  'NODE_OPTIONS',
  'PYTHONPATH', 'PYTHONSTARTUP', 'PYTHONHOME',
  'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS',
  'RUBYLIB', 'RUBYOPT', 'PERL5LIB', 'PERL5OPT',
  'BASH_ENV', 'ENV', 'CDPATH', 'IFS', 'PROMPT_COMMAND', 'GLOBIGNORE', 'SHELLOPTS', 'BASHOPTS'
]);

export function sanitizeSpawnEnvLocal(base) {
  const out = { ...base };
  for (const k of Object.keys(out)) {
    if (SANDBOX_INJECTION_ENV_KEYS.has(k) || k.startsWith('BASH_FUNC_')) {
      delete out[k];
    }
  }
  return out;
}

/**
 * Build the env we hand to child processes:
 *   - PATH augmented with node bin + standard /opt/homebrew/bin etc., so
 *     `sh`/`bash` resolve in IDE-launched / minimal PATH environments.
 *   - All injection vectors stripped (Tier 0 sandbox parity).
 */
export function enrichEnv() {
  const { execPath } = process;
  const sep = process.platform === 'win32' ? ';' : ':';
  const extra = [dirname(execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(sep);
  const merged = { ...process.env, PATH: `${extra}${sep}${process.env.PATH || ''}` };
  return sanitizeSpawnEnvLocal(merged);
}

/** Prefer `/bin/sh` so `spawn('sh')` works even if PATH is missing /bin. */
export function posixShell() {
  return existsSync('/bin/sh') ? '/bin/sh' : 'sh';
}

/** Spawn a binary with argv; returns `{ code, out, err }`. */
export function run(repoRoot, cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const baseEnv = enrichEnv();
    const env = opts.env ? { ...baseEnv, ...opts.env } : baseEnv;
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (c) => { out += c.toString(); });
    child.stderr?.on('data', (c) => { err += c.toString(); });
    child.on('close', (code) => resolve({ code: code ?? 1, out, err }));
    child.on('error', reject);
  });
}

/** Spawn a shell command string; returns `{ code, out, err }`. */
export function sh(repoRoot, cmd, cwd, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'cmd' : posixShell(),
      process.platform === 'win32' ? ['/c', cmd] : ['-c', cmd],
      {
        cwd: cwd ?? repoRoot,
        env: opts.env ?? enrichEnv(),
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );
    let out = '';
    let err = '';
    child.stdout?.on('data', (c) => { out += c.toString(); });
    child.stderr?.on('data', (c) => { err += c.toString(); });
    child.on('close', (code) => resolve({ code: code ?? 1, out, err }));
    child.on('error', reject);
  });
}

export function truthy(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());
}
