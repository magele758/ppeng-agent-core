/**
 * Shared helpers for Home Assistant northbound tools.
 *
 * Credentials are read from env by name (credRef style):
 *   HOME_ASSISTANT_URL   — HA base URL
 *   HOME_ASSISTANT_TOKEN — long-lived access token (never echoed into results)
 *
 * HOME_ASSISTANT_MOCK=1 returns fixed fixtures (no network) for CI / local.
 */

import type { ToolExecutionResult } from '@ppeng/agent-core';

const DEFAULT_TIMEOUT_MS = 15_000;

export function notConfigured(envVar: string, hint?: string): ToolExecutionResult {
  return {
    ok: false,
    content: `${envVar} is not configured.${hint ? ` ${hint}` : ''}`,
  };
}

export function truncate(text: string, maxChars = 16_000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... (truncated, original ${text.length} chars)`;
}

export function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function isMockEnabled(): boolean {
  const raw = (process.env.HOME_ASSISTANT_MOCK ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/** Resolve HA base URL + Bearer token from credRef-style env names. */
export function resolveHaCreds(overrides?: {
  base_url?: string;
  token?: string;
}): { ok: true; base: string; token: string } | { ok: false; result: ToolExecutionResult } {
  if (isMockEnabled()) {
    return { ok: true, base: 'http://mock.home-assistant.local', token: 'mock' };
  }
  const base = (overrides?.base_url ?? process.env.HOME_ASSISTANT_URL ?? '').trim();
  if (!base) {
    return {
      ok: false,
      result: notConfigured(
        'HOME_ASSISTANT_URL',
        'Set it to your Home Assistant base URL, e.g. http://homeassistant.local:8123 (or HOME_ASSISTANT_MOCK=1).',
      ),
    };
  }
  const token = (overrides?.token ?? process.env.HOME_ASSISTANT_TOKEN ?? '').trim();
  if (!token) {
    return {
      ok: false,
      result: notConfigured(
        'HOME_ASSISTANT_TOKEN',
        'Set a long-lived access token (credRef: HOME_ASSISTANT_TOKEN). Never paste the token into chat.',
      ),
    };
  }
  return { ok: true, base: normalizeBase(base), token };
}

export interface JsonRequestOptions {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  auth?: string;
}

export async function httpJson(opts: JsonRequestOptions): Promise<ToolExecutionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers = new Headers(opts.headers ?? {});
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  if (opts.auth && !headers.has('authorization')) headers.set('authorization', opts.auth);
  if (!headers.has('user-agent')) {
    headers.set('user-agent', 'ppeng-agent-homeiot/0.1 (+https://ppeng.dev)');
  }

  try {
    const res = await fetch(opts.url, {
      method: 'GET',
      headers,
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
      return {
        ok: false,
        content: `Request timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms: ${opts.url}`,
      };
    }
    return { ok: false, content: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Fixed entities for HOME_ASSISTANT_MOCK=1 (light + sensor). */
export function mockEntities(): Record<string, unknown>[] {
  return [
    {
      entity_id: 'light.living_room',
      state: 'on',
      attributes: {
        friendly_name: 'Living Room Light',
        brightness: 180,
        supported_color_modes: ['brightness'],
      },
      last_changed: '2026-01-01T12:00:00.000Z',
      last_updated: '2026-01-01T12:00:00.000Z',
      provider: 'mock',
    },
    {
      entity_id: 'sensor.living_room_temperature',
      state: '22.5',
      attributes: {
        friendly_name: 'Living Room Temperature',
        unit_of_measurement: '°C',
        device_class: 'temperature',
      },
      last_changed: '2026-01-01T12:00:00.000Z',
      last_updated: '2026-01-01T12:05:00.000Z',
      provider: 'mock',
    },
  ];
}

export function mockEntityState(entityId: string): Record<string, unknown> | null {
  const id = entityId.trim().toLowerCase();
  return mockEntities().find((e) => String(e.entity_id).toLowerCase() === id) ?? null;
}
