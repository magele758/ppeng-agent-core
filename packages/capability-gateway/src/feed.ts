import dns from 'node:dns';
import { Agent, fetch, ProxyAgent } from 'undici';
import type { Dispatcher } from 'undici';
import type { ParsedFeedItem } from './types.js';

/** Prefer IPv4 first — Undici default + poor IPv6 routes often yield 10s connect timeouts while browsers work. */
if (process.env.RAW_AGENT_FEED_IPV4_FIRST !== '0') {
  try {
    dns.setDefaultResultOrder('ipv4first');
  } catch {
    /* ignore */
  }
}

const feedDispatchers: {
  direct: Dispatcher | undefined;
  directInsecure: Dispatcher | undefined;
  proxy: Dispatcher | undefined;
  proxyInsecure: Dispatcher | undefined;
} = {
  direct: undefined,
  directInsecure: undefined,
  proxy: undefined,
  proxyInsecure: undefined
};

function msEnv(key: string, fallback: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n >= 1000 ? n : fallback;
}

function pickProxyUri(): string {
  for (const k of [
    'RAW_AGENT_HTTPS_PROXY',
    'HTTPS_PROXY',
    'https_proxy',
    'RAW_AGENT_HTTP_PROXY',
    'HTTP_PROXY',
    'http_proxy'
  ] as const) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return '';
}

/**
 * Browser-shaped UA + Accept-Language to avoid bot rejection on public mirrors
 * (Nitter / 部分 WAF 对 `raw-agent-capability-gateway/...` 这类 UA 直接断连)。
 * 覆盖：RAW_AGENT_FEED_USER_AGENT
 */
function feedRequestHeaders(): Record<string, string> {
  const ua =
    process.env.RAW_AGENT_FEED_USER_AGENT?.trim() ||
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  return {
    'user-agent': ua,
    accept:
      'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8',
    'accept-language': 'en-US,en;q=0.9'
  };
}

/** Hosts for which TLS certificate verification is skipped (self-signed / broken chains). */
function tlsBypassHostnames(): Set<string> {
  const raw = process.env.RAW_AGENT_FEED_INSECURE_TLS_HOSTS;
  if (raw === '') return new Set();
  if (raw != null && raw.trim() !== '') {
    return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  }
  // Default: public Nitter frontends often fail standard TLS verification.
  return new Set(['nitter.net']);
}

function hostUsesTlsBypass(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return tlsBypassHostnames().has(h);
}

function pickFeedDispatcher(hostname: string): Dispatcher {
  const connectMs = msEnv('RAW_AGENT_FEED_CONNECT_TIMEOUT_MS', 45_000);
  const headersMs = msEnv('RAW_AGENT_FEED_HEADERS_TIMEOUT_MS', 45_000);
  const bodyMs = msEnv('RAW_AGENT_FEED_BODY_TIMEOUT_MS', 120_000);
  const insecure = hostUsesTlsBypass(hostname);
  const proxy = pickProxyUri();

  if (proxy) {
    const slot = insecure ? 'proxyInsecure' : 'proxy';
    if (!feedDispatchers[slot]) {
      feedDispatchers[slot] = new ProxyAgent({
        uri: proxy,
        headersTimeout: headersMs,
        bodyTimeout: bodyMs,
        proxyTls: { timeout: connectMs },
        requestTls: insecure
          ? { timeout: connectMs, rejectUnauthorized: false }
          : { timeout: connectMs }
      });
    }
    return feedDispatchers[slot]!;
  }

  const slot = insecure ? 'directInsecure' : 'direct';
  if (!feedDispatchers[slot]) {
    feedDispatchers[slot] = new Agent({
      connect: insecure
        ? { timeout: connectMs, rejectUnauthorized: false }
        : { timeout: connectMs },
      headersTimeout: headersMs,
      bodyTimeout: bodyMs
    });
  }
  return feedDispatchers[slot]!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function feedMaxAttempts(): number {
  const n = Number(process.env.RAW_AGENT_FEED_MAX_ATTEMPTS);
  if (Number.isFinite(n) && n >= 1) return Math.min(5, Math.floor(n));
  return 2;
}

function isRetryableFetchError(err: Error, attempt: number, maxAttempts: number): boolean {
  if (attempt >= maxAttempts) return false;
  const msg = err.message;
  if (/HTTP 5\d\d/.test(msg)) return true;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  if (/Connect Timeout|fetch failed|ECONNRESET|ECONNREFUSED|EAI_AGAIN/i.test(msg)) return true;
  return false;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function firstMatch(block: string, re: RegExp): string {
  const m = block.match(re);
  return m?.[1] ? decodeXmlEntities(m[1]) : '';
}

/** Best-effort RSS 2.0 / Atom without extra dependencies. */
export function parseFeedXml(xml: string, contentType?: string): ParsedFeedItem[] {
  const items: ParsedFeedItem[] = [];
  const lower = xml.slice(0, 500).toLowerCase();
  const isAtom =
    lower.includes('<feed') ||
    (contentType?.includes('atom') ?? false) ||
    xml.includes('xmlns="http://www.w3.org/2005/Atom"');

  if (isAtom) {
    const entryRe = /<entry\b[\s\S]*?<\/entry>/gi;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(xml)) !== null) {
      const block = m[0];
      const title = firstMatch(block, /<title[^>]*>([\s\S]*?)<\/title>/i);
      let link = firstMatch(block, /<link[^>]+href="([^"]+)"/i);
      if (!link) {
        link = firstMatch(block, /<link[^>]*>([\s\S]*?)<\/link>/i);
      }
      if (title && link) {
        items.push({ title, link });
      }
    }
    return items;
  }

  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[0];
    const title = firstMatch(block, /<title[^>]*>([\s\S]*?)<\/title>/i);
    let link = firstMatch(block, /<link[^>]*>([\s\S]*?)<\/link>/i);
    if (!link) {
      link = firstMatch(block, /<guid[^>]*>([\s\S]*?)<\/guid>/i);
    }
    if (title && link) {
      items.push({ title, link });
    }
  }
  return items;
}

export async function fetchFeedItems(url: string, maxItems: number): Promise<ParsedFeedItem[]> {
  const overallMs = msEnv('RAW_AGENT_FEED_FETCH_TIMEOUT_MS', 120_000);
  const maxAttempts = feedMaxAttempts();
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`Feed invalid URL: ${url}`);
  }

  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: feedRequestHeaders(),
        signal: AbortSignal.timeout(overallMs),
        dispatcher: pickFeedDispatcher(hostname)
      });

      if (res.status >= 500 && res.status <= 599 && attempt < maxAttempts) {
        await sleep(600 * attempt);
        continue;
      }

      if (!res.ok) {
        throw new Error(`Feed ${url} HTTP ${res.status}`);
      }
      const text = await res.text();
      const parsed = parseFeedXml(text, res.headers.get('content-type') ?? undefined);
      return parsed.slice(0, Math.max(1, maxItems));
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      lastErr = err;
      if (isRetryableFetchError(err, attempt, maxAttempts)) {
        await sleep(600 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error(`Feed ${url}: exhausted retries`);
}
