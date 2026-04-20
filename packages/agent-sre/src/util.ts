/**
 * Small helpers shared across SRE tools.
 *
 * - `httpJsonGet` / `httpJsonPost`: thin fetch wrappers with a timeout, JSON
 *   parsing, and uniform error reporting. Tools call these instead of raw
 *   `fetch` so error shape is consistent in the result content.
 * - `notConfigured`: returns the standard "env not set" payload shape so an
 *   agent immediately learns which variable to set rather than seeing a
 *   network error.
 */

import type { ToolExecutionResult } from '@ppeng/agent-core';

const DEFAULT_TIMEOUT_MS = 15_000;

export function notConfigured(envVar: string, hint?: string): ToolExecutionResult {
  return {
    ok: false,
    content: `${envVar} is not configured.${hint ? ` ${hint}` : ''}`,
  };
}

/** Truncate stringified JSON so a noisy result page doesn't flood the model context. */
export function truncate(text: string, maxChars = 16_000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... (truncated, original ${text.length} chars)`;
}

export interface JsonRequestOptions {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Authorization header value (e.g. "Token foo"); convenience over headers. */
  auth?: string;
}

export async function httpJson(opts: JsonRequestOptions): Promise<ToolExecutionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers = new Headers(opts.headers ?? {});
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  if (opts.auth && !headers.has('authorization')) headers.set('authorization', opts.auth);
  if (opts.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');

  try {
    const res = await fetch(opts.url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        content: `HTTP ${res.status} ${res.statusText} from ${opts.url}\n${truncate(text, 4_000)}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      return { ok: true, content: truncate(text) };
    }
    return { ok: true, content: truncate(JSON.stringify(parsed, null, 2)) };
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      return { ok: false, content: `Request timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms: ${opts.url}` };
    }
    return { ok: false, content: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Trim and optionally drop trailing slash; safer when joining `${BASE}/api/v1/...`. */
export function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
