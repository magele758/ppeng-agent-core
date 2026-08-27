/**
 * Auto-compact + transcript archive, extracted from RawAgentRuntime.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lifecycleBlocks, runLifecycleHook } from '../hooks/lifecycle-hooks.js';
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

export interface CompactHost {
  store: SqliteStateStore;
  stateDir: string;
  modelAdapter: ModelAdapter;
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
    summarize: (older) =>
      host.modelAdapter.summarizeMessages({
        agent: context.agent,
        messages: older,
        reason: `compact session ${context.session.id}`
      }),
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
