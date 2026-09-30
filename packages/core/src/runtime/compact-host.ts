/**
 * Auto-compact + transcript archive, extracted from RawAgentRuntime.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lifecycleBlocks, runLifecycleHook } from '../hooks/lifecycle-hooks.js';
import { createLogger } from '../logger.js';
import { resolveBotMemoryAgentId } from '../memory/bot-memory-scope.js';
import { memoryBackendFromEnv } from '../memory/memory-backend.js';
import { isMemoryContextAppendixText } from '../memory/memory-gate.js';
import type { ExtensionRegistry } from '../extensions/extension-registry.js';
import type { ModelAdapter, RunContext, SessionMessage, SessionRecord } from '../types.js';
import { runAutoCompact } from '../session/auto-compact.js';
import { resolveHistoryTokenBudget } from '../session/session-budget.js';
import {
  appendWorkingLogEntry,
  workingLogEnabled,
  workingLogPath
} from '../session/working-log.js';
import type { SqliteStateStore } from '../storage.js';
import type { TraceEvent } from '../stores/trace.js';
import {
  capRollingSummaryText,
  compactSummaryMaxChars
} from '../turn/prepare-view.js';
import { textPart } from './session-facade.js';

const log = createLogger('compact-host');

/** Short note of the span about to be summarized. Empty when there is no user/assistant text. */
export function shortCompactConclusion(messages: SessionMessage[], maxChars = 480): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const text = message.parts
      .filter((part): part is Extract<SessionMessage['parts'][number], { type: 'text' }> => part.type === 'text')
      .map((part) => part.text.trim())
      .filter((text) => text && !isMemoryContextAppendixText(text))
      .join(' ')
      .replace(/\s+/g, ' ');
    if (!text) continue;
    lines.push(`${message.role}: ${text.slice(0, 160)}`);
  }
  if (lines.length === 0) return '';
  const picked = lines.length <= 4 ? lines : [lines[0]!, lines[1]!, '…', lines[lines.length - 1]!];
  const body = ['压缩前结论', ...picked].join('\n');
  return body.length > maxChars ? `${body.slice(0, maxChars)}…` : body;
}

function compactNoteKey(messages: SessionMessage[]): string {
  const seqs = messages.map((message) => message.seq).filter((seq): seq is number => typeof seq === 'number');
  if (seqs.length === 0) return `compact:${Date.now().toString(36)}`;
  return `compact:${seqs[0]}-${seqs[seqs.length - 1]}`;
}

const COMPACT_NOTE_MAX_CHARS = 480;
const COMPACT_NOTE_LINE_CHARS = 160;
const COMPACT_NOTE_MAX_LINES = 4;

/**
 * Short conclusion cut from the LLM summary this compaction already produced.
 * Empty when the summary has no usable text.
 */
export function shortCompactSummaryConclusion(summary: string, maxChars = COMPACT_NOTE_MAX_CHARS): string {
  const lines = summary
    .split('\n')
    .map((line) => line.replace(/^[\s#>*\-•]+/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, COMPACT_NOTE_MAX_LINES)
    .map((line) =>
      line.length > COMPACT_NOTE_LINE_CHARS ? `${line.slice(0, COMPACT_NOTE_LINE_CHARS)}…` : line
    );
  if (lines.length === 0) return '';
  const body = ['压缩摘要结论', ...lines].join('\n');
  return body.length > maxChars ? `${body.slice(0, maxChars)}…` : body;
}

/**
 * Keep a short conclusion on the bot's session.long before the lossy replace.
 * Uses the summary when there is one, else the heuristic cut of the span.
 * Ordinary chats return immediately. Failures are warned and never thrown.
 */
function persistBotCompactLong(
  host: CompactHost,
  context: RunContext,
  older: SessionMessage[],
  summary?: string
): void {
  try {
    const agentId = resolveBotMemoryAgentId(context.session, host.store);
    if (!agentId) return;
    const note =
      (summary ? shortCompactSummaryConclusion(summary) : '') || shortCompactConclusion(older);
    if (!note) return;
    const userId =
      typeof context.session.metadata?.userId === 'string' ? context.session.metadata.userId : undefined;
    const tenantId =
      typeof context.session.metadata?.tenantId === 'string' ? context.session.metadata.tenantId : undefined;
    if (memoryBackendFromEnv() !== 'agent') {
      // session / dual: session_memory is what memory_get(long) and the appendix read.
      host.store.upsertSessionMemory({
        sessionId: context.session.id,
        scope: 'long',
        key: compactNoteKey(older),
        value: note,
        importance: 0.55,
        source: 'inferred',
        metadata: { source: 'compact' },
        agentId
      });
      return;
    }
    host.store.agentMemory().set({
      scope: 'session.long',
      namespace: 'default',
      key: compactNoteKey(older),
      value: note,
      sessionId: context.session.id,
      userId,
      tenantId,
      agentId,
      importance: 0.55,
      source: 'compact',
      confidence: 'medium'
    });
  } catch (e) {
    log.warn(`bot compact memory write failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface CompactHost {
  store: SqliteStateStore;
  stateDir: string;
  modelAdapter: ModelAdapter;
  resolveModelAdapter?(session: SessionRecord): ModelAdapter;
  extensionRegistry: ExtensionRegistry;
  turnShapeBySession: Map<string, { systemPromptChars: number; toolCount: number }>;
  emitTrace(sessionId: string, event: Omit<TraceEvent, 'ts' | 'sessionId'>): void;
  prepareMessagesForModel(session: SessionRecord, messages: SessionMessage[]): Promise<SessionMessage[]>;
}

export async function archiveMessages(
  stateDir: string,
  sessionId: string,
  messages: SessionMessage[]
): Promise<string> {
  const dir = join(stateDir, 'transcripts', sessionId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${Date.now()}.jsonl`);
  await writeFile(path, messages.map((message) => JSON.stringify(message)).join('\n'), 'utf8');
  return path;
}

export async function autoCompactSession(
  host: CompactHost,
  context: RunContext,
  opts?: { force?: boolean }
): Promise<{ replaced?: { startSeq: number; endSeq: number } }> {
  const tokenThreshold = resolveHistoryTokenBudget(
    'RAW_AGENT_COMPACT_TOKEN_THRESHOLD',
    host.turnShapeBySession.get(context.session.id) ?? {}
  );
  const preCompact = await runLifecycleHook(process.env, {
    phase: 'pre_compact',
    sessionId: context.session.id,
    context: { reason: opts?.force ? 'overflow' : 'token_threshold' }
  });
  if (lifecycleBlocks(preCompact)) {
    void host.emitTrace(context.session.id, {
      kind: 'compact_skipped',
      payload: { reason: preCompact.message ?? 'pre_compact blocked' }
    });
    return {};
  }
  if (preCompact.systemMessage || preCompact.message) {
    host.store.appendMessage(context.session.id, 'system', [
      textPart(`[pre-compact] ${preCompact.systemMessage ?? preCompact.message}`)
    ]);
  }

  const onCompactExt = await host.extensionRegistry.run('on_compact', {
    sessionId: context.session.id,
    agentId: context.agent.id,
    meta: { reason: opts?.force ? 'overflow' : 'token_threshold' }
  });
  if (onCompactExt.block) {
    void host.emitTrace(context.session.id, {
      kind: 'compact_skipped',
      payload: { reason: onCompactExt.message ?? 'on_compact extension blocked' }
    });
    return {};
  }
  if (onCompactExt.systemMessage) {
    host.store.appendMessage(context.session.id, 'system', [
      textPart(`[on-compact] ${onCompactExt.systemMessage}`)
    ]);
  }

  const result = await runAutoCompact({
    store: host.store,
    session: host.store.getSession(context.session.id) ?? context.session,
    agent: context.agent,
    tokenThreshold,
    force: opts?.force,
    summarize: async (older) => {
      const adapter = host.resolveModelAdapter?.(context.session) ?? host.modelAdapter;
      let summary: string;
      try {
        summary = await adapter.summarizeMessages({
          agent: context.agent,
          messages: older,
          reason: `compact session ${context.session.id}`
        });
      } catch (e) {
        persistBotCompactLong(host, context, older);
        throw e;
      }
      // Runs before runAutoCompact appends the replacement, with no await in between.
      persistBotCompactLong(host, context, older, adapter.name === 'heuristic' ? undefined : summary);
      return summary;
    },
    archive: (older) => archiveMessages(host.stateDir, context.session.id, older),
    prepareView: (msgs) => host.prepareMessagesForModel(context.session, msgs),
    capSummary: (text) => {
      const maxSummaryChars = compactSummaryMaxChars(process.env, tokenThreshold);
      const merged = context.session.summary ? `${context.session.summary}\n\n${text}` : text;
      return capRollingSummaryText(merged, maxSummaryChars);
    }
  });

  if (result.skippedReason === 'open_tool_wave') {
    void host.emitTrace(context.session.id, {
      kind: 'compact_skipped',
      payload: { reason: 'open_tool_wave' }
    });
    return {};
  }

  if (result.didCompact || result.pruned) {
    if (result.didCompact && workingLogEnabled(process.env) && result.replaced) {
      appendWorkingLogEntry(workingLogPath(host.stateDir, context.session.id), {
        kind: 'compact_anchor',
        content: `Compacted seq ${result.replaced.startSeq}-${result.replaced.endSeq} into a replace summary.`
      });
    }
    void host.emitTrace(context.session.id, {
      kind: 'compact',
      payload: {
        replaced: result.replaced,
        pruned: result.pruned,
        didCompact: result.didCompact
      }
    });
  }
  return { replaced: result.replaced };
}
