/**
 * Bot sessions keep a private memory namespace (agent_memory.agent_id).
 * Legacy rows with a null agent id stay on the shared user.memory pool.
 */

export interface BotMemorySession {
  id?: string;
  agentId?: string;
  mode?: string;
  parentSessionId?: string;
  metadata?: Record<string, unknown> | null;
}

export interface BotMemoryLookup {
  getBot?(id: string): { id?: string; agentId: string } | undefined;
  listBots?(opts?: { includeHidden?: boolean }): Array<{ id: string; agentId: string }>;
  getSession?(id: string): BotMemorySession | undefined;
}

/** Child sessions spawned by a bot share that bot's namespace. */
const INHERITING_MODES = new Set(['subagent', 'teammate']);
const MAX_PARENT_HOPS = 6;

function resolveOwnBotAgentId(session: BotMemorySession, lookup?: BotMemoryLookup): string | undefined {
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

function parentSessionIdOf(session: BotMemorySession): string {
  if (session.parentSessionId?.trim()) return session.parentSessionId.trim();
  const fromMeta = session.metadata?.parentSessionId;
  return typeof fromMeta === 'string' ? fromMeta.trim() : '';
}

/**
 * Agent id to read/write when this session is a bot.
 * A session is a bot when metadata.botId is set, or when session.agentId matches a bot.
 * Subagent / teammate sessions inherit the namespace of the bot session that spawned them.
 * Returns undefined for ordinary chats so they keep using shared user.memory.
 */
export function resolveBotMemoryAgentId(
  session: BotMemorySession,
  lookup?: BotMemoryLookup
): string | undefined {
  const own = resolveOwnBotAgentId(session, lookup);
  if (own) return own;
  if (!lookup?.getSession || !session.mode || !INHERITING_MODES.has(session.mode)) return undefined;

  const visited = new Set<string>();
  if (session.id) visited.add(session.id);
  let current: BotMemorySession = session;
  for (let hop = 0; hop < MAX_PARENT_HOPS; hop += 1) {
    const parentId = parentSessionIdOf(current);
    if (!parentId || visited.has(parentId)) return undefined;
    visited.add(parentId);
    const parent = lookup.getSession(parentId);
    if (!parent) return undefined;
    const fromParent = resolveOwnBotAgentId(parent, lookup);
    if (fromParent) return fromParent;
    if (!parent.mode || !INHERITING_MODES.has(parent.mode)) return undefined;
    current = parent;
  }
  return undefined;
}
