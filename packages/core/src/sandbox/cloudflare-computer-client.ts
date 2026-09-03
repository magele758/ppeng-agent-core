/**
 * HTTP client for a user-deployed Cloudflare Computer Worker.
 *
 * Contract is the official examples/container and examples/worker-shell surface
 * (https://github.com/cloudflare/computer), not a hosted api.cloudflare.com API
 * and not Computer-Use / VNC / screenshot.
 *
 *   PUT  /c/<name>/file/workspace/<path>   raw body
 *   GET  /c/<name>/file/workspace/<path>
 *   POST /c/<name>/exec                    { command | argv, cwd?, encoding? }
 *                                          → { exitCode, stdout, stderr }
 *   GET  /health                           MCP example; unauthenticated
 *   GET  /                                 container example help text
 */

import { createLogger } from '../logger.js';
import { normalizeWorkspaceName } from './sandbox-settings.js';

const log = createLogger('sandbox-cf-computer');

export interface CloudflareComputerClientOptions {
  endpoint: string;
  workspaceName?: string;
  token?: string;
  timeoutMs?: number;
  backend?: string;
  fetchImpl?: typeof fetch;
}

export interface CloudflareComputerExecInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  workspaceName?: string;
}

export interface CloudflareComputerExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface CloudflareComputerHealthProbe {
  probed: true;
  reachable: boolean;
  status?: number;
  path: string;
  detail: string;
}

export interface CloudflareComputerDisposeResult {
  ok: false;
  reason: string;
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (Array.isArray(value) && value.every((n) => typeof n === 'number')) {
    return Buffer.from(value).toString('utf8');
  }
  if (typeof value === 'object' && value !== null) {
    const rec = value as { type?: unknown; data?: unknown };
    if (rec.type === 'Buffer' && Array.isArray(rec.data)) {
      return Buffer.from(rec.data as number[]).toString('utf8');
    }
  }
  return String(value);
}

function parseExitCode(parsed: Record<string, unknown>, fallback: number): number {
  if (typeof parsed.exitCode === 'number' && Number.isFinite(parsed.exitCode)) {
    return Math.trunc(parsed.exitCode);
  }
  if (typeof parsed.code === 'number' && Number.isFinite(parsed.code)) {
    return Math.trunc(parsed.code);
  }
  if (parsed.status === 'failed' || parsed.status === 'cancelled') return 1;
  return fallback;
}

export function mapRemoteCwd(localCwd: string | undefined): string {
  if (!localCwd) return '/workspace';
  const n = localCwd.replace(/\\/g, '/');
  if (n === '/workspace' || n.startsWith('/workspace/')) return n;
  return '/workspace';
}

export function encodeWorkspaceFilePath(relPath: string): string | undefined {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.some((p) => p === '.' || p === '..')) return undefined;
  return parts.map(encodeURIComponent).join('/');
}

export class CloudflareComputerClient {
  private readonly endpoint: string;
  private readonly workspaceName: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly backend?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CloudflareComputerClientOptions) {
    this.endpoint = String(opts.endpoint ?? '').trim().replace(/\/+$/, '');
    this.workspaceName = normalizeWorkspaceName(opts.workspaceName, 'default');
    this.token = opts.token?.trim() || undefined;
    this.timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 60_000;
    this.backend = opts.backend?.trim() || undefined;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return this.endpoint.length > 0;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...(extra ?? {}) };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private resolveName(override?: string): string {
    return normalizeWorkspaceName(override, this.workspaceName);
  }

  private execUrl(name: string): string {
    return `${this.endpoint}/c/${encodeURIComponent(name)}/exec`;
  }

  private fileUrl(name: string, relPath: string): string | undefined {
    const encoded = encodeWorkspaceFilePath(relPath);
    if (!encoded) return undefined;
    return `${this.endpoint}/c/${encodeURIComponent(name)}/file/workspace/${encoded}`;
  }

  private withTimeout(
    timeoutMs: number | undefined,
    signal?: AbortSignal
  ): { signal: AbortSignal; cancel: () => void } {
    const controller = new AbortController();
    const ms = timeoutMs && timeoutMs > 0 ? timeoutMs : this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), ms);
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    return {
      signal: controller.signal,
      cancel: () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    };
  }

  async exec(input: CloudflareComputerExecInput): Promise<CloudflareComputerExecResult> {
    if (!this.configured) {
      return {
        stdout: '',
        stderr:
          '[sandbox:cloudflare-computer] endpoint is not configured. ' +
          'Set Lab 沙箱 → Worker endpoint, or CLOUDFLARE_COMPUTER_ENDPOINT.',
        code: 127
      };
    }

    const name = this.resolveName(input.workspaceName);
    const body: Record<string, unknown> = {
      command: input.command,
      encoding: 'utf8',
      cwd: input.cwd ?? '/workspace'
    };
    if (this.backend) body.backend = this.backend;
    if (input.timeoutMs && input.timeoutMs > 0) body.timeoutMs = input.timeoutMs;

    const gate = this.withTimeout(input.timeoutMs, input.signal);
    try {
      const res = await this.fetchImpl(this.execUrl(name), {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body),
        signal: gate.signal
      });
      const raw = await res.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        /* non-JSON error page */
      }
      if (!res.ok) {
        return {
          stdout: '',
          stderr: (asText(parsed.error) || raw || `HTTP ${res.status}`).slice(0, 8000),
          code: 1
        };
      }
      return {
        stdout: asText(parsed.stdout),
        stderr: asText(parsed.stderr),
        code: parseExitCode(parsed, 0)
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const aborted = /abort/i.test(msg);
      return {
        stdout: '',
        stderr: `[sandbox:cloudflare-computer] ${aborted ? 'timed out or aborted' : msg}`,
        code: aborted ? 124 : 1
      };
    } finally {
      gate.cancel();
    }
  }

  async readFile(relPath: string, workspaceName?: string): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
    if (!this.configured) return { ok: false, error: 'endpoint is not configured' };
    const url = this.fileUrl(this.resolveName(workspaceName), relPath);
    if (!url) return { ok: false, error: 'invalid path' };
    const gate = this.withTimeout(this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { method: 'GET', headers: this.headers(), signal: gate.signal });
      const text = await res.text();
      if (!res.ok) return { ok: false, error: text.slice(0, 4000) || `HTTP ${res.status}` };
      return { ok: true, body: text };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      gate.cancel();
    }
  }

  async writeFile(
    relPath: string,
    body: string | Uint8Array,
    workspaceName?: string
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.configured) return { ok: false, error: 'endpoint is not configured' };
    const url = this.fileUrl(this.resolveName(workspaceName), relPath);
    if (!url) return { ok: false, error: 'invalid path' };
    const gate = this.withTimeout(this.timeoutMs);
    try {
      const payload = typeof body === 'string' ? body : Buffer.from(body);
      const res = await this.fetchImpl(url, {
        method: 'PUT',
        headers: this.headers({ 'content-type': 'application/octet-stream' }),
        body: payload,
        signal: gate.signal
      });
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, error: text.slice(0, 4000) || `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      gate.cancel();
    }
  }

  /**
   * Official HTTP examples have no destroy/session-delete route.
   * Durable Object state persists; do not pretend we tore it down.
   */
  dispose(): CloudflareComputerDisposeResult {
    return {
      ok: false,
      reason: 'cloudflare-computer HTTP surface has no destroy API; the Durable Object persists'
    };
  }

  async health(): Promise<CloudflareComputerHealthProbe> {
    if (!this.configured) {
      return { probed: true, reachable: false, path: '', detail: 'endpoint is not configured' };
    }
    const paths = ['/health', '/'];
    let last = '';
    for (const path of paths) {
      const gate = this.withTimeout(Math.min(this.timeoutMs, 800));
      try {
        const res = await this.fetchImpl(`${this.endpoint}${path}`, {
          method: 'GET',
          headers: this.headers(),
          signal: gate.signal
        });
        const snippet = (await res.text()).slice(0, 160).replace(/\s+/g, ' ');
        if (res.ok) {
          return {
            probed: true,
            reachable: true,
            status: res.status,
            path,
            detail: snippet || `HTTP ${res.status}`
          };
        }
        last = `HTTP ${res.status} ${path}`;
        if (res.status !== 404) {
          return {
            probed: true,
            reachable: false,
            status: res.status,
            path,
            detail: snippet || last
          };
        }
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
        log.debug(`health ${path}: ${last}`);
        // Network/DNS/abort: do not wait on a second path.
        return { probed: true, reachable: false, path, detail: last };
      } finally {
        gate.cancel();
      }
    }
    return { probed: true, reachable: false, path: '/health', detail: last || 'unreachable' };
  }
}

export async function probeCloudflareComputerHealth(
  opts: CloudflareComputerClientOptions
): Promise<CloudflareComputerHealthProbe> {
  return new CloudflareComputerClient({ ...opts, timeoutMs: Math.min(opts.timeoutMs ?? 2500, 2500) }).health();
}
