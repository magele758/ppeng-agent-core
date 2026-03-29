import type { RawAgentRuntime } from '@ppeng/agent-core';
import { deliverToChannel } from './channels.js';
import { decryptFeishuEncryptPayload } from './feishu-crypto.js';
import { sendFeishuTextMessage } from './feishu-api.js';
import { env } from 'node:process';
import type { ChannelSpec, FeishuProviderSpec, WeComProviderSpec } from './types.js';
import { readGatewayState, writeGatewayState, type GatewayPersistedState } from './state.js';

function parseJsonContent(raw: string): { text?: string } {
  try {
    return JSON.parse(raw) as { text?: string };
  } catch {
    return {};
  }
}

function unwrapFeishuBody(raw: Record<string, unknown>, encryptKey?: string): Record<string, unknown> {
  const enc = raw.encrypt;
  if (typeof enc === 'string' && encryptKey) {
    const decrypted = decryptFeishuEncryptPayload(enc, encryptKey);
    return JSON.parse(decrypted) as Record<string, unknown>;
  }
  return raw;
}

/** Exported for tests / adapters. */
export function feishuUrlVerificationResponse(body: Record<string, unknown>): { challenge: string } | null {
  if (body.type === 'url_verification' && typeof body.challenge === 'string') {
    return { challenge: body.challenge };
  }
  return null;
}

export interface FeishuInboundText {
  text: string;
  /** Key for sticky session */
  sessionKey: string;
  /** Where to reply */
  receiveId: string;
  receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id';
}

/** Exported for tests / adapters. */
export function extractFeishuInboundText(body: Record<string, unknown>): FeishuInboundText | null {
  const header = body.header as Record<string, unknown> | undefined;
  const eventType = typeof header?.event_type === 'string' ? header.event_type : '';
  if (eventType && !eventType.includes('message')) {
    return null;
  }

  const event = (body.event ?? body) as Record<string, unknown>;
  const message = event.message as Record<string, unknown> | undefined;
  if (!message) {
    return null;
  }

  const messageType = String(message.message_type ?? '');
  if (messageType && messageType !== 'text') {
    return null;
  }

  const contentRaw = typeof message.content === 'string' ? message.content : '';
  const { text } = parseJsonContent(contentRaw);
  const trimmed = text?.trim();
  if (!trimmed) {
    return null;
  }

  const chatId = typeof message.chat_id === 'string' ? message.chat_id : '';
  const sender = event.sender as Record<string, unknown> | undefined;
  const senderId = sender?.sender_id as Record<string, unknown> | undefined;
  const openId =
    typeof senderId?.open_id === 'string'
      ? senderId.open_id
      : typeof senderId?.user_id === 'string'
        ? senderId.user_id
        : '';

  const chatType = String(message.chat_type ?? '');
  if (chatId && (chatType === 'group' || chatType === 'topic')) {
    return {
      text: trimmed,
      sessionKey: `feishu:chat:${chatId}`,
      receiveId: chatId,
      receiveIdType: 'chat_id'
    };
  }

  if (openId) {
    return {
      text: trimmed,
      sessionKey: `feishu:user:${openId}`,
      receiveId: openId,
      receiveIdType: 'open_id'
    };
  }

  if (chatId) {
    return {
      text: trimmed,
      sessionKey: `feishu:chat:${chatId}`,
      receiveId: chatId,
      receiveIdType: 'chat_id'
    };
  }

  return null;
}

export async function runAgentTurnAndReply(input: {
  runtime: RawAgentRuntime;
  gatewayDir: string;
  state: GatewayPersistedState;
  sessionKey: string;
  userText: string;
  agentId: string;
  reply: (text: string) => Promise<void>;
  stickySession?: boolean;
}): Promise<{ sessionId: string }> {
  const sticky = input.stickySession !== false;
  const map = { ...(input.state.channelSessions ?? {}) };
  let sessionId = sticky ? map[input.sessionKey]?.sessionId : undefined;

  if (sessionId) {
    input.runtime.sendUserMessage(sessionId, input.userText);
  } else {
    const session = input.runtime.createChatSession({
      title: `IM ${input.sessionKey.slice(0, 40)}`,
      message: input.userText,
      agentId: input.agentId,
      background: false
    });
    sessionId = session.id;
    if (sticky) {
      map[input.sessionKey] = { sessionId, updatedAt: new Date().toISOString() };
      input.state.channelSessions = map;
      await writeGatewayState(input.gatewayDir, input.state);
    }
  }

  await input.runtime.runSession(sessionId);
  const answer = input.runtime.getLatestAssistantText(sessionId) ?? '(无回复)';

  if (sticky && map[input.sessionKey]?.sessionId !== sessionId) {
    map[input.sessionKey] = { sessionId, updatedAt: new Date().toISOString() };
    input.state.channelSessions = map;
    await writeGatewayState(input.gatewayDir, input.state);
  }

  await input.reply(answer);
  return { sessionId };
}

export async function handleFeishuEventRequest(input: {
  body: Record<string, unknown>;
  spec: FeishuProviderSpec;
  runtime: RawAgentRuntime;
  gatewayDir: string;
  channels: ChannelSpec[];
}): Promise<
  | { kind: 'challenge'; challenge: string }
  | { kind: 'json'; status: number; body: Record<string, unknown> }
  | { kind: 'empty'; status: number }
> {
  const unwrapped = unwrapFeishuBody(input.body, input.spec.encryptKey);
  const challenge = feishuUrlVerificationResponse(unwrapped);
  if (challenge) {
    if (input.spec.verificationToken && unwrapped.token !== input.spec.verificationToken) {
      return { kind: 'json', status: 403, body: { error: 'Invalid verification token' } };
    }
    return { kind: 'challenge', challenge: challenge.challenge };
  }

  const inbound = extractFeishuInboundText(unwrapped);
  if (!inbound) {
    return { kind: 'empty', status: 200 };
  }

  const agentId = input.spec.defaultAgentId ?? 'main';
  const state = await readGatewayState(input.gatewayDir);

  const replyChannel = input.spec.replyChannelId
    ? input.channels.find((c) => c.id === input.spec.replyChannelId)
    : undefined;

  const appId = env.RAW_AGENT_FEISHU_APP_ID?.trim();
  const appSecret = env.RAW_AGENT_FEISHU_APP_SECRET?.trim();

  const reply = async (text: string) => {
    if (replyChannel?.type === 'feishu_bot' && appId && appSecret) {
      await sendFeishuTextMessage({
        appId,
        appSecret,
        receiveId: inbound.receiveId,
        receiveIdType: inbound.receiveIdType,
        text
      });
      return;
    }
    if (replyChannel) {
      await deliverToChannel(replyChannel, { text, event: 'gateway.im.reply' });
    }
  };

  await runAgentTurnAndReply({
    runtime: input.runtime,
    gatewayDir: input.gatewayDir,
    state,
    sessionKey: inbound.sessionKey,
    userText: inbound.text,
    agentId,
    reply
  });

  return { kind: 'empty', status: 200 };
}

export async function handleWeComBridgeRequest(input: {
  body: Record<string, unknown>;
  spec: WeComProviderSpec;
  runtime: RawAgentRuntime;
  gatewayDir: string;
  channels: ChannelSpec[];
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const secret = input.spec.bridgeSecret?.trim();
  if (secret) {
    const got = String(input.body.secret ?? '');
    if (got !== secret) {
      return { status: 403, body: { error: 'Invalid secret' } };
    }
  }

  const userKey = String(input.body.userKey ?? input.body.user_id ?? '').trim();
  const text = String(input.body.text ?? input.body.content ?? '').trim();
  if (!userKey || !text) {
    return { status: 400, body: { error: 'Missing userKey and text' } };
  }

  const agentId = input.spec.defaultAgentId ?? 'main';
  const state = await readGatewayState(input.gatewayDir);
  const sessionKey = `wecom:user:${userKey}`;

  const replyChannel = input.spec.replyChannelId
    ? input.channels.find((c) => c.id === input.spec.replyChannelId)
    : undefined;

  const reply = async (out: string) => {
    if (replyChannel) {
      await deliverToChannel(replyChannel, { text: out, event: 'gateway.im.reply' });
    }
  };

  await runAgentTurnAndReply({
    runtime: input.runtime,
    gatewayDir: input.gatewayDir,
    state,
    sessionKey,
    userText: text,
    agentId,
    reply
  });

  return { status: 200, body: { ok: true } };
}
