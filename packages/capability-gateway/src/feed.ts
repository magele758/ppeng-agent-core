import type { ParsedFeedItem } from './types.js';

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
  const res = await fetch(url, {
    headers: { 'user-agent': 'raw-agent-capability-gateway/0.1' },
    signal: AbortSignal.timeout(25_000)
  });
  if (!res.ok) {
    throw new Error(`Feed ${url} HTTP ${res.status}`);
  }
  const text = await res.text();
  const parsed = parseFeedXml(text, res.headers.get('content-type') ?? undefined);
  return parsed.slice(0, Math.max(1, maxItems));
}
