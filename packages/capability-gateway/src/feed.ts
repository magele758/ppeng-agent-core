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

let feedDispatcher: Dispatcher | undefined;

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

function getFeedDispatcher(): Dispatcher {
  if (feedDispatcher) return feedDispatcher;

  const connectMs = msEnv('RAW_AGENT_FEED_CONNECT_TIMEOUT_MS', 45_000);
  const headersMs = msEnv('RAW_AGENT_FEED_HEADERS_TIMEOUT_MS', 45_000);
  const bodyMs = msEnv('RAW_AGENT_FEED_BODY_TIMEOUT_MS', 120_000);
  const proxy = pickProxyUri();

  if (proxy) {
    feedDispatcher = new ProxyAgent({
      uri: proxy,
      connect: { timeout: connectMs },
      headersTimeout: headersMs,
      bodyTimeout: bodyMs
    });
  } else {
    feedDispatcher = new Agent({
      connect: { timeout: connectMs },
      headersTimeout: headersMs,
      bodyTimeout: bodyMs
    });
  }
  return feedDispatcher;
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
  const res = await fetch(url, {
    headers: {
      'user-agent': 'raw-agent-capability-gateway/0.1',
      accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8'
    },
    signal: AbortSignal.timeout(overallMs),
    dispatcher: getFeedDispatcher()
  });
  if (!res.ok) {
    throw new Error(`Feed ${url} HTTP ${res.status}`);
  }
  const text = await res.text();
  const parsed = parseFeedXml(text, res.headers.get('content-type') ?? undefined);
  return parsed.slice(0, Math.max(1, maxItems));
}
