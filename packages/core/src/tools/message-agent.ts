/**
 * Canonical Bot Chat only: deliver a composed message into another bot's
 * canonical session and, when that session is idle, wake it with the same
 * path cron uses (`startIdleSessionRun`). Not a subprocess CLI.
 */

import { findSimilarToolName } from '@ppeng/agent-loop/recovery';
import type { BotRecord } from '../bots/types.js';
import { CANONICAL_BOT_CHAT_META } from '../bots/types.js';
import type { Logger } from '../logger.js';
import { startIdleSessionRun } from '../runtime/scheduler-host.js';
import { mergeSessionMetadata, textPart } from '../runtime/session-facade.js';
import type { SqliteStateStore } from '../storage.js';
import type { RunContext, SessionRecord, ToolContract, ToolExecutionResult } from '../types.js';

export const MESSAGE_AGENT_TOOL_NAME = 'message_agent';
export const MESSAGE_MAX_CHARS = 4000;
export const RELAY_HOP_META = 'relayHop';
export const RELAY_HOP_LIMIT = 3;
const ROSTER_SAMPLE = 8;

const SILENCE_TOKENS = new Set(['[SILENT]', 'SILENT', 'NO_REPLY', 'NO REPLY']);

export interface MessageAgentHost {
  store: SqliteStateStore;
  runSession(sessionId: string): Promise<unknown>;
  log: Logger;
}

export function isCanonicalBotChatSession(session: {
  mode?: string;
  metadata?: Record<string, unknown> | null;
}): boolean {
  if (session.metadata?.[CANONICAL_BOT_CHAT_META] !== true) return false;
  if (session.mode === 'subagent' || session.mode === 'teammate') return false;
  return true;
}

export function readRelayHop(metadata: Record<string, unknown> | undefined): number {
  const raw = metadata?.[RELAY_HOP_META];
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
  if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) {
    const n = Number(raw.trim());
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }
  return 0;
}

/** Silence tokens and pure FYI notes are persisted but must not chain-wake the recipient. */
export function nonWakeReason(body: string): 'silent' | 'fyi' | null {
  const trimmed = body.trim();
  const token = trimmed.replace(/\s+/g, ' ').toUpperCase();
  if (SILENCE_TOKENS.has(token)) return 'silent';
  if (/^(?:\[fyi\]|fyi)\b/i.test(trimmed) && !/[?？]/.test(trimmed)) return 'fyi';
  return null;
}

export function formatBotMessage(sender: { name: string; id: string }, body: string): string {
  return `Message from ${sender.name} / ${sender.id}: ${body}`;
}

function toolJson(ok: boolean, payload: Record<string, unknown>): ToolExecutionResult {
  return { ok, content: JSON.stringify({ ok, ...payload }) };
}

function rosterNames(roster: BotRecord[]): string[] {
  return roster
    .map((bot) => bot.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, ROSTER_SAMPLE);
}

function suggestRosterName(raw: string, roster: BotRecord[]): string | null {
  const byName = findSimilarToolName(
    raw,
    roster.map((bot) => bot.name)
  );
  if (byName) return byName;
  const byId = findSimilarToolName(
    raw,
    roster.map((bot) => bot.id)
  );
  if (!byId) return null;
  return roster.find((bot) => bot.id === byId)?.name ?? null;
}

function senderBot(store: SqliteStateStore, session: SessionRecord): BotRecord | undefined {
  const metaId = typeof session.metadata?.botId === 'string' ? session.metadata.botId.trim() : '';
  if (metaId) {
    const bot = store.getBot(metaId);
    if (bot) return bot;
  }
  const byAgent = store.getBot(session.agentId);
  if (byAgent) return byAgent;
  return store.getBotByCanonicalSessionId(session.id);
}

export function resolveDeliverySession(
  store: SqliteStateStore,
  target: BotRecord,
  senderUserId: string | undefined
): SessionRecord | undefined {
  const userId = senderUserId?.trim();
  if (userId) {
    const mine = store.listSessions().find(
      (session) =>
        session.metadata?.botId === target.id &&
        session.metadata?.[CANONICAL_BOT_CHAT_META] === true &&
        session.metadata?.userId === userId
    );
    if (mine) return mine;
  }
  return store.getSession(target.canonicalSessionId);
}

function resolveRosterBot(roster: BotRecord[], raw: string): BotRecord | undefined {
  const want = raw.trim().replace(/^@+/, '');
  if (!want) return undefined;
  const byId = roster.find((bot) => bot.id === want);
  if (byId) return byId;
  const byName = roster.find((bot) => bot.name === want);
  if (byName) return byName;
  const idCi = roster.filter((bot) => bot.id.toLowerCase() === want.toLowerCase());
  if (idCi.length === 1) return idCi[0];
  const nameCi = roster.filter((bot) => bot.name.toLowerCase() === want.toLowerCase());
  if (nameCi.length === 1) return nameCi[0];
  return undefined;
}

export function createMessageAgentTool(host: MessageAgentHost): ToolContract<{
  target?: string;
  message?: string;
}> {
  return {
    name: MESSAGE_AGENT_TOOL_NAME,
    description:
      'Send a message to ONE other bot on this install roster (id or name). ' +
      'Compose the message yourself: lead with the point and the concrete ask or result. ' +
      "Do not paste the user's private 1:1 chat verbatim. " +
      'Do not fan out to several bots unless the user explicitly asked you to contact each of them. ' +
      'Do not write a "Message from" prefix; the sender name and id are added automatically. ' +
      "Delivery is fire-and-forget into that bot's canonical Bot Chat. This call does not return their reply. " +
      `The message body is at most ${MESSAGE_MAX_CHARS} characters.`,
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Roster bot id or name. Cannot be yourself.'
        },
        message: {
          type: 'string',
          description: `What you want that bot to know or do (max ${MESSAGE_MAX_CHARS} characters). Do not include a "Message from" prefix.`
        }
      },
      required: ['target', 'message']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      try {
        return await deliverMessageAgent(host, context, args);
      } catch (err) {
        return toolJson(false, {
          error: err instanceof Error ? err.message : String(err),
          error_code: 'DELIVERY_FAILED'
        });
      }
    }
  };
}

async function deliverMessageAgent(
  host: MessageAgentHost,
  context: RunContext,
  args: { target?: string; message?: string }
): Promise<ToolExecutionResult> {
  const live = host.store.getSession(context.session.id) ?? context.session;
  if (!isCanonicalBotChatSession(live)) {
    return toolJson(false, {
      error: 'message_agent is only available in a canonical Bot Chat session.',
      error_code: 'NOT_CANONICAL'
    });
  }

  const sender = senderBot(host.store, live);
  if (!sender) {
    return toolJson(false, {
      error: 'This canonical Bot Chat has no roster bot.',
      error_code: 'NOT_A_BOT'
    });
  }

  const roster = host.store.listBots().filter((bot) => bot.id !== sender.id);
  const names = rosterNames(roster);
  const targetRaw = typeof args.target === 'string' ? args.target : '';
  const messageRaw = typeof args.message === 'string' ? args.message : '';
  const body = messageRaw.trim();
  if (!targetRaw.trim()) {
    return toolJson(false, {
      error: 'target is required.',
      error_code: 'TARGET_REQUIRED',
      did_you_mean: null,
      roster: names
    });
  }
  if (!body) {
    return toolJson(false, {
      error: 'message is required. Compose what you want to say.',
      error_code: 'MESSAGE_REQUIRED'
    });
  }
  if (body.length > MESSAGE_MAX_CHARS) {
    return toolJson(false, {
      error: `message is too long (${body.length} chars > ${MESSAGE_MAX_CHARS}).`,
      error_code: 'MESSAGE_TOO_LONG'
    });
  }

  const hop = readRelayHop(live.metadata);
  if (hop >= RELAY_HOP_LIMIT) {
    return toolJson(false, {
      error: `Relay hop limit reached (relayHop >= ${RELAY_HOP_LIMIT}). Message was not sent.`,
      error_code: 'HOP_LIMIT',
      relayHop: hop
    });
  }

  const target = resolveRosterBot(roster, targetRaw);
  if (!target) {
    const selfHit = resolveRosterBot(host.store.listBots({ includeHidden: true }), targetRaw);
    if (selfHit && selfHit.id === sender.id) {
      return toolJson(false, {
        error: "You can't message yourself. Pick another bot from the roster.",
        error_code: 'SELF_TARGET',
        did_you_mean: null,
        roster: names
      });
    }
    return toolJson(false, {
      error: `No roster bot matches target '${targetRaw.trim()}'.`,
      error_code: 'UNKNOWN_TARGET',
      did_you_mean: suggestRosterName(targetRaw.trim().replace(/^@+/, ''), roster),
      roster: names
    });
  }

  const senderUserId = typeof live.metadata?.userId === 'string' ? live.metadata.userId : undefined;
  const destination = resolveDeliverySession(host.store, target, senderUserId);
  if (!destination) {
    return toolJson(false, {
      error: `Canonical session for bot '${target.name}' is missing. Message was not sent.`,
      error_code: 'TARGET_SESSION_MISSING',
      targetId: target.id
    });
  }

  const fresh = host.store.getSession(destination.id) ?? destination;
  if (fresh.status === 'running') {
    return toolJson(false, {
      error: `Bot '${target.name}' is busy (session running). The message was not written.`,
      error_code: 'TARGET_BUSY',
      targetId: target.id,
      targetName: target.name,
      sessionId: fresh.id
    });
  }

  const nextHop = hop + 1;
  mergeSessionMetadata(host.store, fresh.id, { [RELAY_HOP_META]: nextHop });
  const text = formatBotMessage(sender, body);
  host.store.appendMessage(fresh.id, 'user', [textPart(text)]);

  const skip = nonWakeReason(body);
  const startedRun = skip ? false : startIdleSessionRun(host, fresh, `message_agent:${sender.id}`);
  return toolJson(true, {
    delivered: true,
    targetId: target.id,
    targetName: target.name,
    sessionId: fresh.id,
    relayHop: nextHop,
    startedRun,
    ...(skip ? { skippedRun: skip } : {})
  });
}
