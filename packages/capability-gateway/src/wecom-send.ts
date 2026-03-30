/**
 * WeCom (企业微信) group robot outbound API.
 * @see https://developer.work.weixin.qq.com/document/path/91770
 */
export async function sendWeComGroupBotMarkdown(webhookUrl: string, markdown: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { content: markdown.slice(0, 4000) }
    }),
    signal: AbortSignal.timeout(15_000)
  });
  const data = (await res.json()) as { errcode?: number; errmsg?: string };
  if (!res.ok || (data.errcode !== undefined && data.errcode !== 0)) {
    throw new Error(`WeCom webhook failed: ${res.status} ${JSON.stringify(data)}`);
  }
}

export function buildWeComWebhookUrl(baseOrFull: string, key?: string): string {
  const t = baseOrFull.trim();
  if (t.includes('key=')) {
    return t;
  }
  const base = t.replace(/\/$/, '');
  const k = key?.trim();
  if (!k) {
    return base;
  }
  return `${base}?key=${encodeURIComponent(k)}`;
}
