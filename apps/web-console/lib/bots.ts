import type { BotInfo } from './types';

export type CreateBotInput = {
  name: string;
  title?: string;
  description?: string;
};

export type OpenBotResponse = {
  bot?: BotInfo;
  session?: { id?: string; agentId?: string };
  sessionId?: string;
};

/** Sidebar session → Bot roster match (canonical session only). */
export function botForCanonicalSession(
  bots: readonly BotInfo[],
  sessionId: string | null | undefined
): BotInfo | undefined {
  if (!sessionId) return undefined;
  return bots.find((b) => b.canonicalSessionId === sessionId);
}

export function visibleBotRoster(bots: readonly BotInfo[]): BotInfo[] {
  return bots.filter((b) => !b.hidden);
}

export function parseOpenBotResponse(data: OpenBotResponse): { bot: BotInfo; sessionId: string } {
  const bot = data.bot;
  const sessionId = data.session?.id || data.sessionId;
  if (!bot?.id || !sessionId) {
    throw new Error('打开 Bot 失败：响应缺少 bot 或 session');
  }
  return { bot, sessionId };
}
