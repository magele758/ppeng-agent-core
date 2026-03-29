import { env } from 'node:process';

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function feishuApiBase(): string {
  return (env.RAW_AGENT_FEISHU_API_BASE ?? 'https://open.feishu.cn').replace(/\/$/, '');
}

export async function getFeishuTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  const now = Date.now();
  const hit = tokenCache.get(appId);
  if (hit && hit.expiresAt > now + 60_000) {
    return hit.token;
  }
  const url = `${feishuApiBase()}/open-apis/auth/v3/tenant_access_token/internal`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(15_000)
  });
  const data = (await res.json()) as { code?: number; tenant_access_token?: string; expire?: number };
  if (!res.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Feishu token error: ${res.status} ${JSON.stringify(data)}`);
  }
  const expireSec = typeof data.expire === 'number' ? data.expire : 7200;
  tokenCache.set(appId, { token: data.tenant_access_token, expiresAt: now + expireSec * 1000 });
  return data.tenant_access_token;
}

export async function sendFeishuTextMessage(input: {
  appId: string;
  appSecret: string;
  receiveId: string;
  receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id';
  text: string;
}): Promise<void> {
  const token = await getFeishuTenantAccessToken(input.appId, input.appSecret);
  const url = new URL(`${feishuApiBase()}/open-apis/im/v1/messages`);
  url.searchParams.set('receive_id_type', input.receiveIdType);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({
      receive_id: input.receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text: input.text.slice(0, 20_000) })
    }),
    signal: AbortSignal.timeout(30_000)
  });
  const data = (await res.json()) as { code?: number; msg?: string };
  if (!res.ok || data.code !== 0) {
    throw new Error(`Feishu send message failed: ${res.status} ${JSON.stringify(data)}`);
  }
}
