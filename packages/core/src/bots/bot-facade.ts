import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { createId, nowIso } from '../id.js';
import type { SessionFacadeHost } from '../runtime/session-facade.js';
import {
  createChatSession,
  ensureAgent,
  getPermissionMode,
  setPermissionMode
} from '../runtime/session-facade.js';
import type { AgentSpec, SessionRecord } from '../types.js';
import type { SqliteStateStore } from '../storage.js';
import {
  BOT_DEFAULT_PERMISSION_MODE,
  BOT_DESCRIPTION_MAX,
  BOT_NAME_MAX,
  BOT_ROSTER_CAP,
  BOT_TITLE_MAX,
  CANONICAL_BOT_CHAT_META,
  SESSION_CUT_META,
  type BotRecord,
  type CreateBotInput,
  type ListBotsOptions,
  type OpenBotResult,
  type UpdateBotInput
} from './types.js';

export function slugifyBotName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (/^[a-z][a-z0-9-]{1,47}$/.test(slug)) return slug;
  return '';
}

export function canonicalBotChatTitle(name: string): string {
  return `Bot Chat · ${name}`;
}

export function botInstructions(input: { name: string; title: string; description: string }): string {
  const bits = [
    `You are ${input.name}${input.title && input.title !== input.name ? ` (${input.title})` : ''}.`,
    input.description.trim(),
    'You are a named persistent teammate. Continue this conversation; do not treat it as a disposable chat.',
    'You choose the execution style for each request — do not ask the user to pick Chat / Task / Orchestrator / Self-Heal / Planner / Generator / Evaluator.',
    'Q&A: answer directly. Multi-step or implementation: TodoWrite, tools, task_create. Cross-cutting work: orchestrate teammates or spawn_subagent. Research/plan/implement/review as the task requires.',
    'This session has full permission (bypass). Never ask the user to approve tool calls.',
    'This is a long-lived conversation. Older turns are compacted and keyframes are kept (session cut); do not ask the user to start a new chat.'
  ].filter(Boolean);
  return bits.join('\n');
}

function normalizeName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new ValidationError('name is required');
  if (name.length > BOT_NAME_MAX) throw new ValidationError(`name must be ≤ ${BOT_NAME_MAX} characters`);
  return name;
}

function normalizeTitle(raw: string | undefined, fallback: string): string {
  const title = (raw ?? '').trim() || fallback;
  if (title.length > BOT_TITLE_MAX) throw new ValidationError(`title must be ≤ ${BOT_TITLE_MAX} characters`);
  return title;
}

function normalizeDescription(raw: string | undefined): string {
  const description = (raw ?? '').trim();
  if (description.length > BOT_DESCRIPTION_MAX) {
    throw new ValidationError(`description must be ≤ ${BOT_DESCRIPTION_MAX} characters`);
  }
  return description;
}

function allocateBotId(store: SqliteStateStore, name: string): string {
  const slug = slugifyBotName(name);
  if (slug && !store.getBot(slug) && !store.getAgent(slug)) return slug;
  return createId('bot');
}

function botAgentSpec(bot: Pick<BotRecord, 'id' | 'name' | 'title' | 'description'>): AgentSpec {
  return {
    id: bot.id,
    name: bot.name,
    role: bot.title || 'Bot',
    instructions: botInstructions(bot),
    capabilities: ['bot', 'tool-use', 'task-management', 'orchestration'],
    autonomous: true,
    domainId: 'bot'
  };
}

function createCanonicalSession(
  host: SessionFacadeHost,
  bot: Pick<BotRecord, 'id' | 'name'>,
  owner?: { userId?: string; tenantId?: string }
): SessionRecord {
  return createChatSession(host, {
    title: canonicalBotChatTitle(bot.name),
    agentId: bot.id,
    background: false,
    metadata: {
      botId: bot.id,
      [CANONICAL_BOT_CHAT_META]: true,
      [SESSION_CUT_META]: true,
      permissionMode: BOT_DEFAULT_PERMISSION_MODE,
      ...(owner?.userId ? { userId: owner.userId } : {}),
      ...(owner?.tenantId ? { tenantId: owner.tenantId } : {})
    }
  });
}

function ensureBotBypass(host: SessionFacadeHost, sessionId: string): void {
  if (getPermissionMode(host.store, sessionId) === BOT_DEFAULT_PERMISSION_MODE) return;
  setPermissionMode(host.store, sessionId, { mode: BOT_DEFAULT_PERMISSION_MODE });
}

function ensureBotSessionCut(host: SessionFacadeHost, sessionId: string): void {
  const session = host.store.getSession(sessionId);
  if (!session || session.metadata?.[SESSION_CUT_META] === true) return;
  host.store.updateSession(sessionId, {
    metadata: { ...session.metadata, [SESSION_CUT_META]: true }
  });
}

export function listBots(store: SqliteStateStore, opts?: ListBotsOptions): BotRecord[] {
  return store.listBots(opts);
}

export function getBot(store: SqliteStateStore, id: string): BotRecord {
  const bot = store.getBot(id);
  if (!bot) throw new NotFoundError('Bot', id);
  return bot;
}

export function createBot(host: SessionFacadeHost, input: CreateBotInput): BotRecord {
  const name = normalizeName(input.name);
  const title = normalizeTitle(input.title, name);
  const description = normalizeDescription(input.description);
  if (host.store.getBotByName(name)) {
    throw new ConflictError(`Bot name already exists: ${name}`);
  }
  if (host.store.countBots({ includeHidden: true }) >= BOT_ROSTER_CAP) {
    throw new ValidationError(`Bot roster cap reached (${BOT_ROSTER_CAP})`);
  }

  const id = allocateBotId(host.store, name);
  const draft: Pick<BotRecord, 'id' | 'name' | 'title' | 'description'> = {
    id,
    name,
    title,
    description
  };
  ensureAgent(host.store, botAgentSpec(draft));
  const session = createCanonicalSession(host, draft);
  const now = nowIso();
  return host.store.createBot({
    id,
    name,
    title,
    description,
    agentId: id,
    canonicalSessionId: session.id,
    hidden: false,
    createdAt: now,
    updatedAt: now
  });
}

export function updateBot(host: SessionFacadeHost, id: string, patch: UpdateBotInput): BotRecord {
  const current = getBot(host.store, id);
  const name = patch.name !== undefined ? normalizeName(patch.name) : current.name;
  if (name !== current.name) {
    const taken = host.store.getBotByName(name);
    if (taken && taken.id !== id) throw new ConflictError(`Bot name already exists: ${name}`);
  }
  const title = patch.title !== undefined ? normalizeTitle(patch.title, name) : current.title;
  const description =
    patch.description !== undefined ? normalizeDescription(patch.description) : current.description;
  const next = host.store.updateBot(id, {
    name,
    title,
    description,
    hidden: patch.hidden
  });
  host.store.upsertAgent(botAgentSpec(next));
  const session = host.store.getSession(next.canonicalSessionId);
  if (session && (name !== current.name || title !== current.title)) {
    host.store.updateSession(next.canonicalSessionId, {
      title: canonicalBotChatTitle(next.name)
    });
  }
  return next;
}

export function openBot(
  host: SessionFacadeHost,
  id: string,
  opts?: { userId?: string; tenantId?: string }
): OpenBotResult {
  const bot = getBot(host.store, id);
  host.store.upsertAgent(botAgentSpec(bot));
  const userId = opts?.userId?.trim();
  if (userId) {
    const mine = host.store.listSessions().find(
      (session) =>
        session.metadata?.botId === bot.id &&
        session.metadata?.[CANONICAL_BOT_CHAT_META] === true &&
        session.metadata?.userId === userId
    );
    if (mine) {
      ensureBotBypass(host, mine.id);
      ensureBotSessionCut(host, mine.id);
      return { bot, sessionId: mine.id, createdSession: false };
    }
    const session = createCanonicalSession(host, bot, { userId, tenantId: opts?.tenantId });
    return { bot, sessionId: session.id, createdSession: true };
  }
  const existing = host.store.getSession(bot.canonicalSessionId);
  if (existing) {
    ensureBotBypass(host, existing.id);
    ensureBotSessionCut(host, existing.id);
    return { bot, sessionId: existing.id, createdSession: false };
  }
  const session = createCanonicalSession(host, bot);
  const updated = host.store.updateBot(bot.id, { canonicalSessionId: session.id });
  return { bot: updated, sessionId: session.id, createdSession: true };
}

export function resolveBotIdFromBody(body: Record<string, unknown>): string | undefined {
  const raw = typeof body.botId === 'string' ? body.botId.trim() : '';
  return raw || undefined;
}
