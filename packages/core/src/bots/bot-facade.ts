import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { createId, nowIso } from '../id.js';
import type { SessionFacadeHost } from '../runtime/session-facade.js';
import { createChatSession, ensureAgent } from '../runtime/session-facade.js';
import type { AgentSpec, SessionRecord } from '../types.js';
import type { SqliteStateStore } from '../storage.js';
import {
  BOT_DESCRIPTION_MAX,
  BOT_NAME_MAX,
  BOT_ROSTER_CAP,
  BOT_TITLE_MAX,
  CANONICAL_BOT_CHAT_META,
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
    'You are a named persistent teammate. Continue this conversation; do not treat it as a disposable chat.'
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
    capabilities: ['bot', 'tool-use'],
    domainId: 'bot'
  };
}

function createCanonicalSession(host: SessionFacadeHost, bot: Pick<BotRecord, 'id' | 'name'>): SessionRecord {
  return createChatSession(host, {
    title: canonicalBotChatTitle(bot.name),
    agentId: bot.id,
    background: false,
    metadata: {
      botId: bot.id,
      [CANONICAL_BOT_CHAT_META]: true
    }
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

export function openBot(host: SessionFacadeHost, id: string): OpenBotResult {
  const bot = getBot(host.store, id);
  const existing = host.store.getSession(bot.canonicalSessionId);
  if (existing) {
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
