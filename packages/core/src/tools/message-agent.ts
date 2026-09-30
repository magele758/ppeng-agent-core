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
import { getPermissionMode, mergeSessionMetadata, textPart } from '../runtime/session-facade.js';
import type { SqliteStateStore } from '../storage.js';
import type { RunContext, SessionRecord, ToolContract, ToolExecutionResult } from '../types.js';

export const MESSAGE_AGENT_TOOL_NAME = 'message_agent';
export const MESSAGE_MAX_CHARS = 4000;
export const RELAY_HOP_META = 'relayHop';
/** Id of the relayed user message that `relayHop` belongs to; the hop is stale once any later user message lands. */
export const RELAY_HOP_MESSAGE_META = 'relayHopMessageId';
export const RELAY_HOP_LIMIT = 3;
const ROSTER_SAMPLE = 8;

const SILENCE_TOKENS = new Set(['[SILENT]', 'SILENT', 'NO_REPLY', 'NO REPLY']);

export interface MessageAgentHost {
  store: SqliteStateStore;
  runSession(sessionId: string): Promise<unknown>;
  /** In-process run registry; covers the window before the kernel persists `status: running`. */
  isSessionRunning?(sessionId: string): boolean;
  log: Logger;
}

export function isCanonicalBotChatSession(session: {
  mode?: string;
  metadata?: Record<string, unknown> | null;
}): boolean {
  if (session.metadata?.[CANONICAL_BOT_CHAT_META] !== true) return false;
  return session.mode === 'chat';
}

/**
 * Hop depth of the run currently driven by this session. `relayHop` is only trusted while the
 * relayed message is still the latest user message; a human (or cron, approval) message after it
 * starts a fresh chain, so a finished 3-hop chain never locks the bot out of message_agent.
 */
export function effectiveRelayHop(store: SqliteStateStore, session: SessionRecord): number {
  const hop = readRelayHop(session.metadata);
  if (hop <= 0) return 0;
  const anchor = session.metadata?.[RELAY_HOP_MESSAGE_META];
  if (typeof anchor !== 'string' || !anchor) return 0;
  const messages = store.foldMessages(session.id);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role !== 'user' || message.hidden) continue;
    return message.id === anchor ? hop : 0;
  }
  return 0;
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

/**
 * Silence tokens and explicit FYI notes are persisted but must not chain-wake the recipient.
 * Only a leading `FYI` / `[FYI]` marker opts out of waking; ordinary messages (with or without a
 * question mark) always wake an idle recipient, so delegated work is never swallowed silently.
 */
export function nonWakeReason(body: string): 'silent' | 'fyi' | null {
  const trimmed = body.trim();
  const token = trimmed.replace(/\s+/g, ' ').toUpperCase();
  if (SILENCE_TOKENS.has(token)) return 'silent';
  if (/^(?:\[fyi\]|fyi\b)/i.test(trimmed) && !/[?？](?:\s|$)/.test(trimmed)) return 'fyi';
  return null;
}

export function formatBotMessage(sender: { name: string; id: string }, body: string): string {
  return `Message from ${sender.name} / ${sender.id}: ${body}`;
}

function toolJson(ok: boolean, payload: Record<string, unknown>): ToolExecutionResult {
  return { ok, content: JSON.stringify({ ok, ...payload }) };
}

function rosterNames(roster: BotRecord[], limit = ROSTER_SAMPLE): string[] {
  return roster
    .map((bot) => bot.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
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
  const bot = store.getBot(session.agentId);
  if (!bot) return undefined;
  const metaId = session.metadata?.botId;
  if (typeof metaId === 'string' && metaId.trim() && metaId.trim() !== bot.id) return undefined;
  return bot;
}

function ownerField(session: { metadata?: Record<string, unknown> | null }, key: 'userId' | 'tenantId'): string {
  const raw = session.metadata?.[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

/** A destination owned by someone else must never receive this sender's message. */
export function crossesOwner(sender: SessionRecord, destination: SessionRecord): boolean {
  for (const key of ['userId', 'tenantId'] as const) {
    const dest = ownerField(destination, key);
    if (dest && dest !== ownerField(sender, key)) return true;
  }
  return false;
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
        isCanonicalBotChatSession(session) &&
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
      'Call with an empty target to get the roster names back. ' +
      'Compose the message yourself: lead with the point and the concrete ask or result. ' +
      "Do not paste the user's private 1:1 chat verbatim. " +
      'Do not fan out to several bots unless the user explicitly asked you to contact each of them. ' +
      'Do not write a "Message from" prefix; the sender name and id are added automatically. ' +
      "Delivery is fire-and-forget into that bot's canonical Bot Chat and wakes it when idle; " +
      'this call never returns their reply (they may message you back later). ' +
      'Start the message with "FYI" (and ask no question) for a note that needs no action: it is stored but the bot is NOT woken. ' +
      'If the bot is busy or not idle the message is not written and you get a structured error; do not retry in a loop. ' +
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

  if (getPermissionMode(host.store, live.id) === 'plan') {
    return toolJson(false, {
      error: 'message_agent writes into another bot chat and is blocked while permissionMode=plan.',
      error_code: 'PERMISSION_MODE_PLAN'
    });
  }

  const roster = host.store.listBots().filter((bot) => bot.id !== sender.id);
  const names = rosterNames(roster);
  const targetRaw = typeof args.target === 'string' ? args.target : '';
  const messageRaw = typeof args.message === 'string' ? args.message : '';
  const body = messageRaw.trim();
  if (!targetRaw.trim()) {
    return toolJson(false, {
      error: 'target is required. Pick a bot from roster.',
      error_code: 'TARGET_REQUIRED',
      did_you_mean: null,
      roster: rosterNames(roster, roster.length),
      rosterTotal: roster.length
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

  const hop = effectiveRelayHop(host.store, live);
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

  const senderUserId = ownerField(live, 'userId') || undefined;
  const destination = resolveDeliverySession(host.store, target, senderUserId);
  if (!destination || !isCanonicalBotChatSession(destination) || destination.agentId !== target.id) {
    return toolJson(false, {
      error: `Canonical session for bot '${target.name}' is missing. Message was not sent.`,
      error_code: 'TARGET_SESSION_MISSING',
      targetId: target.id
    });
  }
  if (destination.id === live.id) {
    return toolJson(false, {
      error: "You can't message yourself. Pick another bot from the roster.",
      error_code: 'SELF_TARGET',
      did_you_mean: null,
      roster: names
    });
  }
  if (crossesOwner(live, destination)) {
    return toolJson(false, {
      error: `Bot '${target.name}' has no Bot Chat for your user. Message was not sent.`,
      error_code: 'TARGET_OWNER_MISMATCH',
      targetId: target.id
    });
  }

  // Everything below is synchronous: no other tool call can interleave between the status
  // check, the write, and the wake.
  const fresh = host.store.getSession(destination.id) ?? destination;
  if (fresh.status === 'running' || host.isSessionRunning?.(fresh.id)) {
    return toolJson(false, {
      error: `Bot '${target.name}' is busy (session running). The message was not written.`,
      error_code: 'TARGET_BUSY',
      targetId: target.id,
      targetName: target.name,
      sessionId: fresh.id
    });
  }
  if (fresh.status !== 'idle') {
    return toolJson(false, {
      error: `Bot '${target.name}' is not idle (status ${fresh.status}). The message was not written.`,
      error_code: 'TARGET_NOT_IDLE',
      targetId: target.id,
      targetName: target.name,
      sessionId: fresh.id,
      status: fresh.status
    });
  }

  const nextHop = hop + 1;
  const written = host.store.appendMessage(fresh.id, 'user', [textPart(formatBotMessage(sender, body))]);
  mergeSessionMetadata(host.store, fresh.id, {
    [RELAY_HOP_META]: nextHop,
    [RELAY_HOP_MESSAGE_META]: written.id
  });

  const skip = nonWakeReason(body);
  const startedRun = skip ? false : startIdleSessionRun(host, fresh, `message_agent:${sender.id}`);
  const note = startedRun
    ? `Delivered to ${target.name} and woke it. It works in its own chat with its own permissions; its reply is NOT returned to this call.`
    : `Delivered to ${target.name} but did NOT wake it (${skip ?? 'not started'}); it sees the message on its next run. No reply is returned to this call.`;
  return toolJson(true, {
    delivered: true,
    targetId: target.id,
    targetName: target.name,
    sessionId: fresh.id,
    relayHop: nextHop,
    startedRun,
    woke: startedRun,
    ...(skip ? { skippedRun: skip } : {}),
    note
  });
}
