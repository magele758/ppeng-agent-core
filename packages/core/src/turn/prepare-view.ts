/**
 * L3 view preparation: image contact sheet, refusal guard, micro-compact,
 * optional fold budget. Callers must pass fold() output — never WAL slice.
 */

import { createId } from '../id.js';
import { envBool, envInt } from '../env.js';
import { applyRefusalPreservationGuard } from '../model/refusal-preservation.js';
import { microCompactMessages } from '../session/micro-compact.js';
import { resolveMicroCompactConfig } from '../session/compact-settings.js';
import { resolveHistoryTokenBudget } from '../session/session-budget.js';
import {
  selectEpisodicMessages,
  selectEpisodicMessagesWithCognitiveState
} from '../model/episodic-selection.js';
import type { ImageAssetRecord, ImagePart, MessagePart, SessionMessage, SessionRecord } from '../types.js';

export const MAX_VISIBLE_MESSAGES = 24;

export function capRollingSummaryText(text: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `…[earlier summary truncated]\n\n${text.slice(-maxChars)}`;
}

/**
 * 摘要字符上限：未设置 RAW_AGENT_COMPACT_SUMMARY_MAX_CHARS 时 = 阈值×2（est≈len/4，约为阈值一半预算给摘要，余量给最近 N 条）。
 * 阈值由调用方传入（已按模型上下文窗口推导），别在这里重新读死值。
 */
export function compactSummaryMaxChars(env: NodeJS.ProcessEnv, tokenThreshold: number): number {
  return envInt(env, 'RAW_AGENT_COMPACT_SUMMARY_MAX_CHARS', tokenThreshold * 2);
}

/** Per-session accounting caches are advisory; drop oldest insertions past the cap. */
export const SESSION_CACHE_MAX = 512;
export function capSessionMap(map: Map<string, unknown>, max = SESSION_CACHE_MAX): void {
  if (map.size <= max) return;
  for (const key of map.keys()) {
    map.delete(key);
    if (map.size <= max) return;
  }
}

function textPart(text: string): MessagePart {
  return {
    type: 'text',
    text
  };
}

export interface PrepareViewHost {
  store: {
    getImageAsset(id: string): ImageAssetRecord | undefined;
    getDaemonControl?(key: string): unknown;
  };
  emitTrace(sessionId: string, event: { kind: string; payload?: unknown }): void;
  turnShapeBySession: Map<string, { systemPromptChars: number; toolCount: number }>;
  promptBuilder: {
    lastCognitivePhaseBySession: Map<string, { phase: string; confidence: number }>;
  };
}

/**
 * Prepares messages for model ingestion:
 * - Replaces cold/missing image parts with archived-image text markers.
 * - Appends warm contact sheet as a tail user message (NOT prepended), so the
 *   beginning of message history stays stable for prompt-cache reuse.
 */
export async function prepareMessagesForModel(
  host: PrepareViewHost,
  session: SessionRecord,
  messages: SessionMessage[]
): Promise<SessionMessage[]> {
  const warmId = session.metadata?.imageWarmContactAssetId;
  const warmIdStr = typeof warmId === 'string' ? warmId : undefined;

  const mapped: SessionMessage[] = messages.map((msg) => ({
    ...msg,
    parts: msg.parts.flatMap((part): MessagePart[] => {
      if (part.type !== 'image') return [part];
      const asset = host.store.getImageAsset(part.assetId);
      if (!asset || asset.retentionTier === 'cold') {
        return [{ type: 'text', text: `[archived image ${part.assetId}]` }];
      }
      const im: ImagePart = {
        type: 'image',
        assetId: part.assetId,
        mimeType: asset.mimeType,
        sourceUrl: part.sourceUrl ?? asset.sourceUrl,
        retentionTier: asset.retentionTier
      };
      return [im];
    })
  }));

  if (warmIdStr) {
    const warmAsset = host.store.getImageAsset(warmIdStr);
    const already = mapped.some((m) => m.parts.some((p) => p.type === 'image' && p.assetId === warmIdStr));
    if (warmAsset && !already) {
      const contactSheet: SessionMessage = {
        id: createId('msg'),
        sessionId: session.id,
        role: 'user',
        parts: [
          textPart('Earlier screenshots (contact sheet, compressed memory):'),
          {
            type: 'image',
            assetId: warmIdStr,
            mimeType: warmAsset.mimeType,
            retentionTier: 'warm'
          }
        ],
        createdAt: new Date(0).toISOString()
      };
      // Append contact sheet just before the last user message so the model
      // sees it as recent context, while keeping early message indices stable.
      const lastUserIdx = mapped.reduceRight((found, _, i) => found === -1 && mapped[i]!.role === 'user' ? i : found, -1);
      if (lastUserIdx > 0) {
        mapped.splice(lastUserIdx, 0, contactSheet);
      } else {
        mapped.push(contactSheet);
      }
    }
  }

  // Trajectory-integrity guard: refusal preservation (arXiv:2604.08557)
  // When enabled, detects prior assistant refusals followed by short redirect
  // attempts and injects a protective reminder to anchor the model's decision.
  let guardedMessages = mapped;
  if (envBool(process.env, 'RAW_AGENT_REFUSAL_PRESERVATION', true)) {
    const { messages: guarded, result } = applyRefusalPreservationGuard(mapped);
    if (result.shouldInjectReminder) {
      void host.emitTrace(session.id, {
        kind: 'refusal_preservation',
        payload: {
          refusalCount: result.refusalMessageIds.length,
          isRedirectAttempt: result.isRedirectAttempt
        }
      });
      guardedMessages = guarded;
    }
  }

  // Micro-compaction: every turn, collapse tool results the model has already
  // acted on. Runs last so the token estimate that drives autoCompact reflects
  // what is actually sent. Only the model's view shrinks — the stored
  // transcript keeps full outputs.
  const compactCfg = resolveMicroCompactConfig({ store: host.store, env: process.env });
  const micro = microCompactMessages(guardedMessages, compactCfg);
  if (micro.stats.collapsed > 0 || micro.stats.trimmed > 0) {
    void host.emitTrace(session.id, {
      kind: 'micro_compact',
      payload: { ...micro.stats, policy: compactCfg.policy, keepRecent: compactCfg.keepRecent }
    });
  }
  return micro.messages;
}

/**
 * Optional post-fold history budget. Never used as the packing source —
 * callers must pass `foldMessages()` output. Dropped seqs are traced; never
 * silent head-chop.
 */
export function applyOptionalFoldBudget(
  host: PrepareViewHost,
  session: SessionRecord,
  folded: SessionMessage[]
): SessionMessage[] {
  if (folded.length <= MAX_VISIBLE_MESSAGES) {
    return folded;
  }

  const useEpisodic = envBool(process.env, 'RAW_AGENT_EPISODIC_SELECTION', true);
  let selected: SessionMessage[];

  if (!useEpisodic) {
    selected = folded.slice(-MAX_VISIBLE_MESSAGES);
  } else {
    const useCognitiveState = envBool(process.env, 'RAW_AGENT_COGNITIVE_STATE_SELECTION', true);
    const tokenBudget = resolveHistoryTokenBudget(
      'RAW_AGENT_EPISODIC_TOKEN_BUDGET',
      host.turnShapeBySession.get(session.id) ?? {}
    );

    if (useCognitiveState) {
      const result = selectEpisodicMessagesWithCognitiveState(folded, tokenBudget);
      host.promptBuilder.lastCognitivePhaseBySession.set(session.id, {
        phase: result.cognitivePhase,
        confidence: result.cognitiveConfidence
      });
      selected = result.selected;
    } else {
      selected = selectEpisodicMessages(folded, tokenBudget, {
        minRecentMessages: MAX_VISIBLE_MESSAGES,
        includeInitialContext: true
      });
    }
  }

  const kept = new Set(selected.map((m) => m.id));
  const droppedSeqs = folded
    .filter((m) => !kept.has(m.id) && typeof m.seq === 'number')
    .map((m) => m.seq as number);
  if (droppedSeqs.length > 0) {
    void host.emitTrace(session.id, {
      kind: 'fold_budget_drop',
      payload: { droppedSeqs, kept: selected.length, folded: folded.length }
    });
  }
  return selected;
}
