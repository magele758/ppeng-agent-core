export interface BotRecord {
  id: string;
  name: string;
  title: string;
  description: string;
  agentId: string;
  canonicalSessionId: string;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBotInput {
  name: string;
  title?: string;
  description?: string;
}

export interface UpdateBotInput {
  name?: string;
  title?: string;
  description?: string;
  hidden?: boolean;
}

export interface ListBotsOptions {
  includeHidden?: boolean;
}

export interface OpenBotResult {
  bot: BotRecord;
  sessionId: string;
  createdSession: boolean;
}

export const BOT_NAME_MAX = 64;
export const BOT_TITLE_MAX = 80;
export const BOT_DESCRIPTION_MAX = 2000;
export const BOT_ROSTER_CAP = 50;

export const CANONICAL_BOT_CHAT_META = 'canonicalBotChat';
