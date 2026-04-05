import { isIPv4, isIPv6 } from 'node:net';

function isPrivateIp(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '0.0.0.0') {
    return true;
  }
  // Strip IPv6 brackets (URL.hostname keeps them, e.g. "[::1]")
  const stripped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (isIPv4(stripped)) {
    const parts = stripped.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      return true;
    }
    const a = parts[0]!;
    const b = parts[1]!;
    if (a === 10) {
      return true;
    }
    if (a === 127) {
      return true;
    }
    if (a === 0) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    if (a === 169 && b === 254) {
      return true;
    }
    return false;
  }
  if (isIPv6(stripped)) {
    const h = stripped.toLowerCase();
    if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) {
      return true;
    }
  }
  return false;
}

export interface WebFetchOptions {
  url: string;
  maxBytes?: number;
  timeoutMs?: number;
  allowPrivateHosts?: boolean;
}

const DEFAULT_MAX = 2_000_000;

/**
 * Fetch http(s) URL as text with size cap and basic SSRF guard (blocks private IPs when allowPrivateHosts is false).
 */
export async function fetchUrlText(options: WebFetchOptions): Promise<{ ok: boolean; content: string }> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX;
  const timeoutMs = options.timeoutMs ?? 30_000;
  let parsed: URL;
  try {
    parsed = new URL(options.url);
  } catch {
    return { ok: false, content: 'Invalid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, content: 'Only http(s) URLs are allowed' };
  }
  const host = parsed.hostname;
  if (!options.allowPrivateHosts && isPrivateIp(host)) {
    return { ok: false, content: 'Refused: private/local host (set RAW_AGENT_WEB_FETCH_ALLOW_PRIVATE=1 to allow)' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(options.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'raw-agent-web_fetch/1.0' }
    });
    const ct = res.headers.get('content-type') ?? '';
    if (!res.ok) {
      return { ok: false, content: `HTTP ${res.status} ${res.statusText}` };
    }
    const buf = await readLimitedBody(res.body, maxBytes);
    const text = decodeBody(buf, ct);
    return {
      ok: true,
      content: `Content-Type: ${ct}\n\n${text}`
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, content: `fetch failed: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<Uint8Array> {
  if (!body) {
    return new Uint8Array();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        chunks.push(value.subarray(0, Math.max(0, value.byteLength - (total - maxBytes))));
        break;
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
    if (offset >= maxBytes) {
      break;
    }
  }
  return out.subarray(0, Math.min(offset, maxBytes));
}

function decodeBody(buf: Uint8Array, contentType: string): string {
  const low = contentType.toLowerCase();
  if (low.includes('charset=utf-8') || (!low.includes('charset') && isMostlyText(buf))) {
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }
  if (low.startsWith('text/') || low.includes('json') || low.includes('xml')) {
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }
  return `[binary or unknown encoding, ${buf.byteLength} bytes]\n` + new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 4096));
}

function isMostlyText(buf: Uint8Array): boolean {
  let bad = 0;
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) {
    const b = buf[i]!;
    if (b < 9 || (b > 13 && b < 32)) {
      bad++;
    }
  }
  return bad / n < 0.03;
}

export interface WebSearchOptions {
  query: string;
  templateUrl?: string;
  maxBytes?: number;
  timeoutMs?: number;
}

/**
 * If RAW_AGENT_WEB_SEARCH_URL is set, substitute {query} (URL-encoded) and GET. Otherwise returns guidance string.
 */
export async function webSearchFromEnv(
  env: NodeJS.ProcessEnv,
  options: WebSearchOptions
): Promise<{ ok: boolean; content: string }> {
  const template = options.templateUrl ?? env.RAW_AGENT_WEB_SEARCH_URL?.trim();
  if (!template) {
    return {
      ok: false,
      content:
        'web_search is not configured. Set RAW_AGENT_WEB_SEARCH_URL with a template containing {query}, or use MCP browser/search tools.'
    };
  }
  const url = template.replace(/\{query\}/g, encodeURIComponent(options.query));
  return fetchUrlText({
    url,
    maxBytes: options.maxBytes,
    timeoutMs: options.timeoutMs,
    allowPrivateHosts: ['1', 'true', 'yes'].includes(String(env.RAW_AGENT_WEB_FETCH_ALLOW_PRIVATE ?? '').toLowerCase())
  });
}
