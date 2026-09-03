/**
 * Fetch a provider's model catalog (OpenAI-compatible GET /models, Anthropic GET /models).
 */

import type { ModelProviderKind } from './provider-catalog.js';

export interface RemoteModel {
  id: string;
  ownedBy?: string;
}

export interface ListRemoteModelsResult {
  models: RemoteModel[];
  endpoint: string;
  status: number;
}

/** OpenAI-compat chat/models live under /v1; host-only URLs 404 on /chat/completions. */
export function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) return '';
  if (/\/v\d+(?:beta)?(?:\/|$)/i.test(base)) return base;
  return `${base}/v1`;
}

export function baseUrlFromModelsEndpoint(endpoint: string): string | undefined {
  const raw = endpoint.trim().replace(/\/+$/, '');
  if (!raw) return undefined;
  if (raw.endsWith('/models')) {
    const next = raw.slice(0, -'/models'.length).replace(/\/+$/, '');
    return next || undefined;
  }
  return undefined;
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  if (base.endsWith('/v1') && p.startsWith('/v1/')) {
    return `${base}${p.slice(3)}`;
  }
  return `${base}${p}`;
}

function candidateEndpoints(kind: ModelProviderKind, baseUrl: string): string[] {
  const base = baseUrl.trim();
  if (!base) return [];
  if (kind === 'heuristic') return [];
  const primary = joinUrl(base, '/models');
  const out = [primary];
  if (!base.replace(/\/+$/, '').endsWith('/v1')) {
    const withV1 = joinUrl(`${base.replace(/\/+$/, '')}/v1`, '/models');
    if (withV1 !== primary) out.push(withV1);
  }
  return out;
}

export function parseRemoteModelList(payload: unknown): RemoteModel[] {
  if (!payload || typeof payload !== 'object') return [];
  const rec = payload as Record<string, unknown>;
  const buckets: unknown[] = [];
  if (Array.isArray(rec.data)) buckets.push(...rec.data);
  else if (Array.isArray(rec.models)) buckets.push(...rec.models);
  else if (Array.isArray(payload)) buckets.push(...payload);
  const seen = new Set<string>();
  const out: RemoteModel[] = [];
  for (const item of buckets) {
    if (typeof item === 'string') {
      const id = item.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const ownedBy =
      (typeof o.owned_by === 'string' && o.owned_by.trim()) ||
      (typeof o.display_name === 'string' && o.display_name.trim()) ||
      (typeof o.ownedBy === 'string' && o.ownedBy.trim()) ||
      undefined;
    out.push({ id, ownedBy: ownedBy || undefined });
  }
  return out;
}

function authHeaders(kind: ModelProviderKind, apiKey: string): Record<string, string> {
  if (kind === 'anthropic-compatible') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    };
  }
  return { authorization: `Bearer ${apiKey}` };
}

export async function listRemoteModels(input: {
  kind: ModelProviderKind;
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ListRemoteModelsResult> {
  if (input.kind === 'heuristic') {
    return { models: [{ id: 'heuristic' }], endpoint: '', status: 200 };
  }
  const endpoints = candidateEndpoints(input.kind, input.baseUrl);
  if (!endpoints.length) {
    throw new Error('缺少 Base URL');
  }
  if (!input.apiKey.trim()) {
    throw new Error('缺少 API Key');
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 15_000;
  let lastErr = '无法列出模型';
  let lastStatus = 0;
  let lastEndpoint = endpoints[0]!;
  for (const endpoint of endpoints) {
    lastEndpoint = endpoint;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(endpoint, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...authHeaders(input.kind, input.apiKey)
        },
        signal: ac.signal
      });
      lastStatus = res.status;
      const text = await res.text();
      if (!res.ok) {
        lastErr = `HTTP ${res.status}: ${text.slice(0, 240)}`;
        continue;
      }
      let payload: unknown = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        lastErr = '模型列表不是 JSON';
        continue;
      }
      const models = parseRemoteModelList(payload);
      if (!models.length) {
        lastErr = '模型列表为空';
        continue;
      }
      return { models, endpoint, status: res.status };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${lastErr} (${lastEndpoint}${lastStatus ? `, status ${lastStatus}` : ''})`);
}
