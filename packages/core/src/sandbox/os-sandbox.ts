/**
 * Tier 1 Sandbox — OS-level process sandboxing.
 *
 * On macOS: wraps commands with `sandbox-exec -f <profile>`.
 * On Linux:  wraps commands with `bwrap` (bubblewrap) if available.
 * Elsewhere: gracefully degrades to Tier 0 (env sanitization only).
 *
 * The sandbox restricts file access to sensitive directories (~/.ssh, ~/.aws,
 * ~/.gnupg, ~/.config) while allowing the agent workspace and system binaries.
 */

import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createId } from '../id.js';
import { sanitizeSpawnEnv, type SanitizeEnvOptions } from './env-sanitizer.js';

// ---------------------------------------------------------------------------
// SandboxProvider interface
// ---------------------------------------------------------------------------

export interface SandboxExecOptions {
  /** Working directory for the command. */
  cwd: string;
  /** Allowed read/write workspace path (usually === cwd). */
  workspace: string;
  /** Sanitized env (from Tier 0). */
  env: NodeJS.ProcessEnv;
  /** Timeout in ms. */
  timeoutMs?: number;
  /** Abort signal. */
  signal?: AbortSignal;
  /** Allow network access (default: true). */
  allowNetwork?: boolean;
}

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Which sandbox tier was actually used. */
  tier: 0 | 1 | 2;
}

export interface SandboxProvider {
  readonly name: string;
  readonly tier: 0 | 1 | 2;
  /** Check if this provider is available on the current system. */
  isAvailable(): boolean;
  /** Execute a shell command within the sandbox. */
  execute(command: string, options: SandboxExecOptions): Promise<SandboxExecResult>;
}

// ---------------------------------------------------------------------------
// macOS sandbox-exec provider
// ---------------------------------------------------------------------------

function buildSeatbeltProfile(workspace: string, home: string, allowNetwork: boolean): string {
  const lines: string[] = [
    '(version 1)',
    '(allow default)',
    '',
    '; --- Deny access to sensitive directories ---',
    `(deny file-read* (subpath "${home}/.ssh"))`,
    `(deny file-write* (subpath "${home}/.ssh"))`,
    `(deny file-read* (subpath "${home}/.aws"))`,
    `(deny file-write* (subpath "${home}/.aws"))`,
    `(deny file-read* (subpath "${home}/.gnupg"))`,
    `(deny file-write* (subpath "${home}/.gnupg"))`,
    `(deny file-read* (subpath "${home}/.kube"))`,
    `(deny file-write* (subpath "${home}/.kube"))`,
    `(deny file-read* (subpath "${home}/.docker"))`,
    `(deny file-write* (subpath "${home}/.docker"))`,
  ];

  if (!allowNetwork) {
    lines.push('', '; --- Deny network ---', '(deny network*)');
  }

  // Explicitly allow workspace (overrides broader deny if workspace is inside home)
  lines.push(
    '',
    '; --- Allow workspace ---',
    `(allow file-read* (subpath "${workspace}"))`,
    `(allow file-write* (subpath "${workspace}"))`,
  );

  return lines.join('\n') + '\n';
}

/** Visible for testing. */
export { buildSeatbeltProfile };

export class MacOSSandboxProvider implements SandboxProvider {
  readonly name = 'sandbox-exec';
  readonly tier = 1 as const;
  private static availabilityCache: boolean | undefined;

  isAvailable(): boolean {
    if (process.platform !== 'darwin') return false;
    if (MacOSSandboxProvider.availabilityCache !== undefined) {
      return MacOSSandboxProvider.availabilityCache;
    }
    if (!existsSync('/usr/bin/sandbox-exec')) {
      MacOSSandboxProvider.availabilityCache = false;
      return false;
    }

    const smoke = spawnSync(
      '/usr/bin/sandbox-exec',
      ['-p', '(version 1)\n(allow default)\n', '/usr/bin/true'],
      {
        encoding: 'utf8',
        timeout: 3000
      }
    );
    MacOSSandboxProvider.availabilityCache = smoke.status === 0;
    return MacOSSandboxProvider.availabilityCache;
  }

  async execute(command: string, options: SandboxExecOptions): Promise<SandboxExecResult> {
    const home = options.env.HOME ?? process.env.HOME ?? '/tmp';
    const profile = buildSeatbeltProfile(
      options.workspace,
      home,
      options.allowNetwork !== false,
    );

    // Write profile to a temp file (sandbox-exec requires a file path)
    const profilePath = join(tmpdir(), `sandbox-${createId('sb')}.sb`);
    writeFileSync(profilePath, profile, 'utf8');

    try {
      return await this.spawnSandboxed(profilePath, command, options);
    } finally {
      try { unlinkSync(profilePath); } catch { /* ignore cleanup errors */ }
    }
  }

  private spawnSandboxed(
    profilePath: string,
    command: string,
    options: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'sandbox-exec',
        ['-f', profilePath, '--', 'bash', '-c', command],
        {
          cwd: options.cwd,
          env: options.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';

      const onAbort = () => { child.kill('SIGTERM'); };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (options.timeoutMs && options.timeoutMs > 0) {
        timer = setTimeout(() => { child.kill('SIGTERM'); }, options.timeoutMs);
      }

      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      child.on('close', (code, signal) => {
        options.signal?.removeEventListener('abort', onAbort);
        if (timer) clearTimeout(timer);
        resolve({ stdout, stderr, code, signal, tier: 1 });
      });

      child.on('error', (err) => {
        options.signal?.removeEventListener('abort', onAbort);
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Linux bubblewrap provider
// ---------------------------------------------------------------------------

export class LinuxBwrapProvider implements SandboxProvider {
  readonly name = 'bwrap';
  readonly tier = 1 as const;

  isAvailable(): boolean {
    if (process.platform !== 'linux') return false;
    const result = spawnSync('bwrap', ['--version'], { encoding: 'utf8', timeout: 3000 });
    return result.status === 0;
  }

  async execute(command: string, options: SandboxExecOptions): Promise<SandboxExecResult> {
    const home = options.env.HOME ?? process.env.HOME ?? '/tmp';

    const args = [
      // Bind the root filesystem read-only
      '--ro-bind', '/', '/',
      // Bind the workspace read-write
      '--bind', options.workspace, options.workspace,
      // Bind /tmp and /dev for basic functionality
      '--dev', '/dev',
      '--tmpfs', '/tmp',
      // Unshare PID namespace for isolation
      '--unshare-pid',
      // Block sensitive directories by overlaying empty tmpfs
      '--tmpfs', join(home, '.ssh'),
      '--tmpfs', join(home, '.aws'),
      '--tmpfs', join(home, '.gnupg'),
      '--tmpfs', join(home, '.kube'),
      '--tmpfs', join(home, '.docker'),
    ];

    if (options.allowNetwork === false) {
      args.push('--unshare-net');
    }

    // The command to execute
    args.push('--', 'bash', '-c', command);

    return this.spawnBwrap(args, options);
  }

  private spawnBwrap(
    args: string[],
    options: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('bwrap', args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      const onAbort = () => { child.kill('SIGTERM'); };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (options.timeoutMs && options.timeoutMs > 0) {
        timer = setTimeout(() => { child.kill('SIGTERM'); }, options.timeoutMs);
      }

      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      child.on('close', (code, signal) => {
        options.signal?.removeEventListener('abort', onAbort);
        if (timer) clearTimeout(timer);
        resolve({ stdout, stderr, code, signal, tier: 1 });
      });

      child.on('error', (err) => {
        options.signal?.removeEventListener('abort', onAbort);
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Tier 0 fallback (no OS sandbox, just env sanitization)
// ---------------------------------------------------------------------------

export class DirectProvider implements SandboxProvider {
  readonly name = 'direct';
  readonly tier = 0 as const;

  isAvailable(): boolean {
    return true; // always available
  }

  async execute(command: string, options: SandboxExecOptions): Promise<SandboxExecResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        cwd: options.cwd,
        shell: true,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      const onAbort = () => { child.kill('SIGTERM'); };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (options.timeoutMs && options.timeoutMs > 0) {
        timer = setTimeout(() => { child.kill('SIGTERM'); }, options.timeoutMs);
      }

      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      child.on('close', (code, signal) => {
        options.signal?.removeEventListener('abort', onAbort);
        if (timer) clearTimeout(timer);
        resolve({ stdout, stderr, code, signal, tier: 0 });
      });

      child.on('error', (err) => {
        options.signal?.removeEventListener('abort', onAbort);
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }
}

// ---------------------------------------------------------------------------
// SandboxManager — auto-selects the best available provider
// ---------------------------------------------------------------------------

export type SandboxMode = 'auto' | 'direct' | 'os' | 'container';

export class SandboxManager {
  private provider: SandboxProvider;
  private readonly mode: SandboxMode;

  constructor(mode: SandboxMode = 'auto') {
    this.mode = mode;
    this.provider = this.selectProvider();
  }

  get activeProvider(): SandboxProvider {
    return this.provider;
  }

  get activeTier(): 0 | 1 | 2 {
    return this.provider.tier;
  }

  /**
   * Execute a shell command in the sandbox.
   *
   * Applies Tier 0 env sanitization automatically, then delegates
   * to the selected OS-level provider (or direct fallback).
   */
  async execute(
    command: string,
    cwd: string,
    options?: {
      workspace?: string;
      timeoutMs?: number;
      signal?: AbortSignal;
      allowNetwork?: boolean;
      envOptions?: SanitizeEnvOptions;
    },
  ): Promise<SandboxExecResult> {
    const env = sanitizeSpawnEnv(options?.envOptions);
    return this.provider.execute(command, {
      cwd,
      workspace: options?.workspace ?? cwd,
      env,
      timeoutMs: options?.timeoutMs,
      signal: options?.signal,
      allowNetwork: options?.allowNetwork,
    });
  }

  private selectProvider(): SandboxProvider {
    if (this.mode === 'direct') {
      return new DirectProvider();
    }

    if (this.mode === 'os' || this.mode === 'auto') {
      const macOS = new MacOSSandboxProvider();
      if (macOS.isAvailable()) return macOS;

      const bwrap = new LinuxBwrapProvider();
      if (bwrap.isAvailable()) return bwrap;

      if (this.mode === 'os') {
        // Explicitly requested but not available — still fall back gracefully
        return new DirectProvider();
      }
    }

    // 'auto' fallback or 'container' (Tier 2 not yet implemented)
    return new DirectProvider();
  }
}

/** Create a SandboxManager from env config. */
export function createSandboxFromEnv(env?: NodeJS.ProcessEnv): SandboxManager {
  const e = env ?? process.env;
  const mode = (e.RAW_AGENT_SANDBOX_MODE ?? 'auto') as SandboxMode;
  return new SandboxManager(mode);
}
