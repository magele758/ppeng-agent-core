/**
 * Bot sessions keep a private memory namespace (agent_memory.agent_id).
 * Legacy rows with a null agent id stay on the shared user.memory pool.
 */

export interface BotMemorySession {
  agentId?: string;
  metadata?: Record<string, unknown> | null;
}

export interface BotMemoryLookup {
  getBot?(id: string): { id?: string; agentId: string } | undefined;
  listBots?(opts?: { includeHidden?: boolean }): Array<{ id: string; agentId: string }>;
}

/**
 * Agent id to read/write when this session is a bot.
 * A session is a bot when metadata.botId is set, or when session.agentId matches a bot.
 * Returns undefined for ordinary chats so they keep using shared user.memory.
 */
export function resolveBotMemoryAgentId(
  session: BotMemorySession,
  lookup?: BotMemoryLookup
): string | undefined {
  const metaBotId =
    typeof session.metadata?.botId === 'string' ? session.metadata.botId.trim() : '';
  const sessionAgent = typeof session.agentId === 'string' ? session.agentId.trim() : '';

  if (metaBotId) {
    const bot = lookup?.getBot?.(metaBotId);
    const fromBot = bot?.agentId?.trim();
    if (fromBot) return fromBot;
    return sessionAgent || metaBotId;
  }

  if (!sessionAgent || !lookup) return undefined;
  const byId = lookup.getBot?.(sessionAgent);
  const fromId = byId?.agentId?.trim();
  if (fromId) return fromId;
  const listed = lookup.listBots?.({ includeHidden: true }) ?? [];
  const match = listed.find((bot) => bot.id === sessionAgent || bot.agentId === sessionAgent);
  return match?.agentId?.trim() || undefined;
}
