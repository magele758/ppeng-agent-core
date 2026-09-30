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
 * A body that is only a silence token is the recipient's "nothing more to say" convention: it is
 * persisted but must not chain-wake the other side. This is not a sender intent signal; senders
 * opt out of waking with the explicit `wake:false` argument.
 */
export function isSilenceToken(body: string): boolean {
  return SILENCE_TOKENS.has(body.trim().replace(/\s+/g, ' ').toUpperCase());
}

const WAKE_OFF_STRINGS = new Set(['false', '0', 'no']);

/** Only an explicit opt-out ("wake: false"-like) skips the wake; absent / unknown values wake. */
export function wantsWake(raw: unknown): boolean {
  if (raw === false || raw === null || raw === 0) return false;
  return !(typeof raw === 'string' && WAKE_OFF_STRINGS.has(raw.trim().toLowerCase()));
}

/** Ended chats a human message would simply re-run (`runSession` has no status gate). */
function isReviveableStatus(status: SessionRecord['status']): boolean {
  return status === 'failed' || status === 'completed';
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
  wake?: boolean;
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
      "Delivery is fire-and-forget into that bot's canonical Bot Chat and wakes it by default; " +
      'this call never returns their reply (they may message you back later). ' +
      'Set wake=false for a note that needs no action: it is stored but the bot is NOT woken and sees it on its next run. ' +
      'wake is the only switch (default true); wording such as "FYI" in the message does not change it. ' +
      'A bot whose last run failed or ended is restarted by a waking message. ' +
      'If the bot is busy (running) or waiting for human approval the message is not written and you get a structured error; do not retry in a loop. ' +
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
        },
        wake: {
          type: 'boolean',
          description:
            'Default true: wake the bot to act on the message. Set false to only store the message without waking it.'
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
  args: { target?: string; message?: string; wake?: unknown }
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
  if (fresh.status !== 'idle' && !isReviveableStatus(fresh.status)) {
    const pendingApprovalIds =
      fresh.status === 'waiting_approval'
        ? host.store
            .listApprovals({ status: 'pending' })
            .filter((approval) => approval.sessionId === fresh.id)
            .map((approval) => approval.id)
        : [];
    return toolJson(false, {
      error:
        fresh.status === 'waiting_approval'
          ? `Bot '${target.name}' is waiting for human approval, so the message was not written. A person must approve or reject its pending tool call(s) in Lab (approvals page) before it can receive messages; do not retry in a loop.`
          : `Bot '${target.name}' is not idle (status ${fresh.status}). The message was not written.`,
      error_code: 'TARGET_NOT_IDLE',
      targetId: target.id,
      targetName: target.name,
      sessionId: fresh.id,
      status: fresh.status,
      ...(pendingApprovalIds.length ? { approvalIds: pendingApprovalIds } : {})
    });
  }

  const nextHop = hop + 1;
  const written = host.store.appendMessage(fresh.id, 'user', [textPart(formatBotMessage(sender, body))]);
  mergeSessionMetadata(host.store, fresh.id, {
    [RELAY_HOP_META]: nextHop,
    [RELAY_HOP_MESSAGE_META]: written.id
  });

  const skip: 'silent' | 'wake_false' | null = !wantsWake(args.wake)
    ? 'wake_false'
    : isSilenceToken(body)
      ? 'silent'
      : null;
  const revivedFrom = !skip && fresh.status !== 'idle' ? fresh.status : undefined;
  const wakeTarget = revivedFrom ? host.store.updateSession(fresh.id, { status: 'idle' }) : fresh;
  const startedRun = skip ? false : startIdleSessionRun(host, wakeTarget, `message_agent:${sender.id}`);
  const note = startedRun
    ? `Delivered to ${target.name} and woke it${revivedFrom ? ` (its previous run had ${revivedFrom}; it was restarted)` : ''}. It works in its own chat with its own permissions; its reply is NOT returned to this call.`
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
    ...(revivedFrom ? { revivedFrom } : {}),
    note
  });
}
