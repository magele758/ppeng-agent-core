import type { ChannelSpec } from './types.js';

export async function deliverToChannel(
  channel: ChannelSpec,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; text: string }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'raw-agent-capability-gateway/0.1',
    ...channel.headers
  };
  let payload: string;
  if (channel.payloadMode === 'json_text') {
    payload = JSON.stringify({
      text: typeof body.text === 'string' ? body.text : JSON.stringify(body)
    });
  } else {
    payload = JSON.stringify(body);
  }
  const res = await fetch(channel.url, {
    method: 'POST',
    headers,
    body: payload,
    signal: AbortSignal.timeout(30_000)
  });
  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, text: text.slice(0, 2000) };
}
