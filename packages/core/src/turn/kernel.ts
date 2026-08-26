/**
 * L3 turn kernel: one session run (prepare → model → recovery → tools).
 * Behavior-preserving move of RawAgentRuntime._runSessionInner.
 */

import { createHash } from 'node:crypto';
import { NotFoundError, ValidationError } from '../errors.js';
import { envBool, envInt } from '../env.js';
import { STABLE_SYSTEM_VERSION, type PromptContext } from '../model/prompt-builder.js';
import { textSummaryFromParts } from '../model/model-adapters.js';
import {
  imageBufferToDataUrl,
  touchImageAccess
} from '../image-assets.js';
import {
  lifecycleBlocks,
  runLifecycleHook
} from '../hooks/lifecycle-hooks.js';
import {
  assertToolsetInvariant,
  promptCacheStrictFromEnv
} from '../session/prompt-cache.js';
import {
  filterToolsByOptionalGroups,
  loadOptionalToolGroupsFromEnv,
  mergeEnabledOptionalToolGroups,
  optionalToolGroupsFeatureEnabled,
  parseDefaultEnabledOptionalGroups
} from '../tools/optional-tool-groups.js';
import { isRepetitionAbort } from '../streaming/repetition-watchdog.js';
import {
  loadReasoningSpinWatchdogConfig,
  ReasoningSpinWatchdog,
  reasoningSpinWatchdogEnabled
} from '../streaming/reasoning-spin-watchdog.js';
import {
  AdvisoryGrace,
  advisoryGraceBudget,
  advisoryGraceEnabled
} from '../recovery/advisory-grace.js';
import { AdvisoryQueue } from '../recovery/advisory-queue.js';
import {
  formatRiskAdvisory,
  RiskEngine,
  riskEngineConfigFromEnv,
  riskEngineEnabled
} from '../recovery/risk-engine.js';
import { recoveryPolicyEnabled, SessionLoopGuard } from '../recovery/session-loop-guard.js';
import { createGoalGateFromMetadata, type GoalGate } from '../goal/index.js';
import { estimateUsageCostUsd, mergeCostUsd } from '../model/token-cost.js';
import { llmPromptDebugEnabled } from '../model/llm-prompt-debug.js';
import { mergeUsage, splitCumulativePromptTokens } from '../model/usage.js';
import {
  workingLogEnabled,
  workingLogPath,
  workingLogTailChars,
  readWorkingLogTail
} from '../session/working-log.js';
import { applyClaimedInbox, prepareTurnInput } from './prepare-turn-input.js';
import {
  createTurnRecoveryState,
  decideTurnRecovery,
  noteCriticalHit
} from './turn-recovery.js';
import { capSessionMap } from './prepare-view.js';
import { isContextOverflowError } from '../session/auto-compact.js';
import type { AgentStepEvent } from '../runtime/agent-loop.js';
import type {
  MessagePart,
  ModelTurnResult,
  RunContext,
  SessionMessage,
  SessionRecord,
  TokenUsage
} from '../types.js';
import type { TurnKernelHost } from './host.js';

function textPart(text: string): MessagePart {
  return { type: 'text', text };
}

export async function runSessionKernel(
host: TurnKernelHost,
sessionId: string,
options?: { onModelStreamChunk?: (chunk: ModelStreamChunk) => void; latch?: AgentLoopLatch }
): Promise<SessionRecord> {
  let session = host.store.getSession(sessionId);
  if (!session) {
    throw new NotFoundError('Session', sessionId);
  }
  if (session.status === 'waiting_approval') {
    await options?.latch?.emit({ type: 'waiting_approval' });
    return session;
  }

  const agent = host.store.getAgent(session.agentId);
  if (!agent) {
    throw new NotFoundError('Agent', session.agentId);
  }

  const controller = new AbortController();
  host.sessionAbortControllers.set(sessionId, controller);
  const signal = controller.signal;
  const sid = session.id;
  const emitStep = async (ev: AgentStepEvent) => {
    if (options?.latch) await options.latch.emit(ev);
  };
  const finishEnded = async (record: SessionRecord, reason: string) => {
    await emitStep({ type: 'ended', reason });
    return record;
  };
  const loopGuard = recoveryPolicyEnabled(process.env) ? new SessionLoopGuard(process.env) : null;
  const advisoryGrace =
    loopGuard && advisoryGraceEnabled(process.env)
      ? new AdvisoryGrace(advisoryGraceBudget(process.env))
      : null;
  const advisoryQueue = new AdvisoryQueue();
  const riskEngine = riskEngineEnabled(process.env)
    ? new RiskEngine(riskEngineConfigFromEnv(process.env))
    : null;
  const goalGate: GoalGate | null = createGoalGateFromMetadata(session.metadata, process.env);
  const spinWatchdog = reasoningSpinWatchdogEnabled(process.env)
    ? new ReasoningSpinWatchdog(loadReasoningSpinWatchdogConfig(process.env))
    : null;
  const recoveryState = createTurnRecoveryState();
  try {
    host.runCaseGovernance();
  } catch {
    /* fail-soft */
  }
  riskEngine?.noteUserIntervention(0);

  try {
    await host.mcpManager.ensureLoaded(sid);
    const filePolicy = await host.mergedFilePolicy();
    session = host.store.updateSession(session.id, { status: 'running' });
    await host.ingestMailbox(session);
    await host.autoClaimTask(session);
    const nextRunItems = host.store.claimInbox(sid, 'next-run');
    if (nextRunItems.length > 0) {
      applyClaimedInbox(host.store, sid, nextRunItems);
    }

    for (let turn = 0; turn < host.maxTurnsPerRun; turn += 1) {
      if (signal.aborted) {
        return finishEnded(host.store.updateSession(session.id, { status: 'failed' }), 'abort');
      }

      const refreshedSession = host.store.getSession(session.id) as SessionRecord;
      const task = refreshedSession.taskId ? host.store.getTask(refreshedSession.taskId) : undefined;
      const workspaceRoot = await host.ensureWorkspaceRoot(refreshedSession, task);
      let context: RunContext = {
        repoRoot: host.repoRoot,
        stateDir: host.stateDir,
        session: host.store.getSession(session.id) as SessionRecord,
        agent,
        workspaceRoot,
        task,
        abortSignal: signal
      };

      const packed = await prepareTurnInput(sid, {
        store: host.store,
        autoCompact: async () => {
          await host.autoCompact(context);
        },
        claimNextStep: () => host.store.claimInbox(sid, 'next-step'),
        prepareView: (sess, msgs) => host.prepareMessagesForModel(sess, msgs),
        buildAppendix: (sess) => {
          const promptCtxInner: PromptContext = { ...context, session: sess };
          const memoryAppendix = host.promptBuilder.buildMemoryAppendix(promptCtxInner);
          const workingLogTail = workingLogEnabled(process.env)
            ? readWorkingLogTail(
                workingLogPath(host.stateDir, sid),
                workingLogTailChars(process.env)
              )
            : '';
          return [
            memoryAppendix,
            workingLogTail.trim()
              ? `[working log — durable trail across compaction; full transcripts at the referenced paths]\n${workingLogTail.trim()}`
              : ''
          ]
            .filter(Boolean)
            .join('\n\n');
        },
        applyFoldBudget: (sess, foldedMsgs) => host.applyOptionalFoldBudget(sess, foldedMsgs)
      });
      context = { ...context, session: packed.session };
      const visibleMessages = packed.messages;
      const rawVisible = packed.viewMessages;
      await emitStep({
        type: 'turn_prepared',
        messages: visibleMessages,
        foldSeqs: packed.foldSeqs
      });
      const promptCtx: PromptContext = context;
      const drainedAdvisory = advisoryQueue.drainCombined();
      if (drainedAdvisory) {
        host.store.appendMessage(sid, 'system', [textPart(drainedAdvisory)]);
      }
      const systemPrompt = await host.promptBuilder.buildSystemPrompt(promptCtx, rawVisible);
      const stablePrefixHash = createHash('sha256')
        .update(host.promptBuilder.buildStablePrefix(promptCtx))
        .digest('hex')
        .slice(0, 16);
      const routing = host.promptBuilder.getRouting(sid);
      void host.emitTrace(sid, {
        kind: 'turn_start',
        payload: {
          turn,
          adapter: host.modelAdapter.name,
          stablePrefixHash,
          routing: routing ? {
            mode: routing.mode,
            confidence: routing.confidence.level,
            shortlistCount: routing.shortlistNames.length,
            topSkill: routing.routed[0]?.skill.name
          } : undefined
        }
      });

      const resolveImageDataUrl = async (assetId: string, sig?: AbortSignal) => {
        const asset = host.store.getImageAsset(assetId);
        if (!asset || asset.sessionId !== context.session.id) {
          return undefined;
        }
        await touchImageAccess(host.store, assetId);
        return imageBufferToDataUrl(host.store, host.stateDir, assetId);
      };

      // Env var is a capability gate: feature must be enabled globally.
      // Session metadata is the opt-in: each session must explicitly request external AI tools.
      const externalAiCapabilityGate = envBool(process.env, 'RAW_AGENT_EXTERNAL_AI_TOOLS', false);
      const sessionOptIn = context.session.metadata?.allowExternalAiTools === true;
      const allowExternalAiTools = externalAiCapabilityGate && sessionOptIn;
      const externallyGated = allowExternalAiTools ? host.tools : host.tools.filter((t) => !t.isExternal);
      // Per-agent whitelist: when AgentSpec.allowedTools is set, scope this turn's
      // tool list to that subset so e.g. an SRE persona can't see stock tools.
      let turnTools =
        agent.allowedTools && agent.allowedTools.length > 0
          ? externallyGated.filter((t) => agent.allowedTools!.includes(t.name))
          : externallyGated;

      // Subagent spawn may pin an extra allowlist on session.metadata.allowedTools
      const metaAllowed = context.session.metadata?.allowedTools;
      if (Array.isArray(metaAllowed) && metaAllowed.length > 0) {
        const allow = new Set(metaAllowed.map((n) => String(n)));
        turnTools = turnTools.filter((t) => allow.has(t.name));
      }

      const hasExplicitOptionalToolSelection =
        context.session.metadata &&
        Object.prototype.hasOwnProperty.call(context.session.metadata, 'enabledOptionalToolGroups');
      const defaultOptionalGroups = parseDefaultEnabledOptionalGroups(process.env);
      // Filter when the feature is on and either the session pinned a selection
      // or the server declares defaults (union of both, mirroring ai-agent-node).
      if (
        optionalToolGroupsFeatureEnabled(process.env) &&
        (hasExplicitOptionalToolSelection || defaultOptionalGroups.length > 0)
      ) {
        const ogroups = loadOptionalToolGroupsFromEnv(process.env);
        const clientEnabled = hasExplicitOptionalToolSelection
          ? context.session.metadata?.enabledOptionalToolGroups
          : [];
        const enabled = mergeEnabledOptionalToolGroups(defaultOptionalGroups, clientEnabled);
        turnTools = filterToolsByOptionalGroups(turnTools, enabled, ogroups).tools;
      }

      const toolsetLock = assertToolsetInvariant(
        sid,
        turnTools.map((t) => t.name),
        context.session.metadata,
        { strict: promptCacheStrictFromEnv(process.env) }
      );
      // Feed the next turn's history-budget derivation with this turn's actual
      // prompt shape (system prompt size + tool count).
      host.turnShapeBySession.set(sid, {
        systemPromptChars: systemPrompt.length,
        toolCount: turnTools.length
      });
      if (Object.keys(toolsetLock.metadataPatch).length > 0) {
        host.mergeSessionMetadata(sid, toolsetLock.metadataPatch);
        context = {
          ...context,
          session: host.store.getSession(sid) as SessionRecord
        };
      }
      if (toolsetLock.drifted) {
        void host.emitTrace(sid, {
          kind: 'prompt_cache_bust',
          payload: { fingerprint: toolsetLock.fingerprint, reason: 'toolset_drift' }
        });
      }

      if (turn === 0) {
        const startHook = await runLifecycleHook(process.env, {
          phase: 'session_start',
          sessionId: sid,
          context: { agentId: agent.id, mode: context.session.mode }
        });
        if (startHook.systemMessage || startHook.message) {
          host.store.appendMessage(sid, 'system', [
            textPart(startHook.systemMessage ?? startHook.message ?? '')
          ]);
        }
        const startExt = await host.extensionRegistry.run('session_start', {
          sessionId: sid,
          agentId: agent.id,
          meta: { mode: context.session.mode }
        });
        if (startExt.systemMessage || startExt.message) {
          host.store.appendMessage(sid, 'system', [
            textPart(startExt.systemMessage ?? startExt.message ?? '')
          ]);
        }
      }

      const beforeTurn = await host.extensionRegistry.run('before_turn', {
        sessionId: sid,
        agentId: agent.id,
        meta: { turn }
      });
      if (beforeTurn.block) {
        host.store.appendMessage(sid, 'system', [
          textPart(beforeTurn.message ?? beforeTurn.systemMessage ?? 'blocked by before_turn extension')
        ]);
        return finishEnded(host.store.updateSession(session.id, { status: 'failed' }), 'before_turn_blocked');
      }
      if (beforeTurn.systemMessage) {
        host.store.appendMessage(sid, 'system', [textPart(beforeTurn.systemMessage)]);
      }

      let turnInput = {
        agent,
        systemPrompt,
        messages: visibleMessages,
        tools: turnTools,
        signal,
        resolveImageDataUrl,
        promptCacheKey: toolsetLock.promptCacheKey,
        ...(llmPromptDebugEnabled(process.env)
          ? { debugLlmContext: { stateDir: host.stateDir, sessionId: sid } }
          : {})
      };

      let turnResult: ModelTurnResult;
      try {
        turnResult = await host.runTurnWithRetries(turnInput, options?.onModelStreamChunk);
      } catch (error) {
        // Degenerate repetition: the polluted partial was never persisted, so a
        // single clean retry is safe. A second hit means the model is stuck —
        // finalize gracefully instead of burning another full-tools prompt.
        if (isRepetitionAbort(error)) {
          void host.emitTrace(sid, {
            kind: 'repetition_abort',
            payload: { reason: error.reason, retry: true }
          });
          try {
            turnResult = await host.runTurnWithRetries(turnInput, options?.onModelStreamChunk);
          } catch (retryError) {
            const reason = isRepetitionAbort(retryError) ? retryError.reason : error.reason;
            void host.emitTrace(sid, {
              kind: 'repetition_abort',
              payload: { reason, retry: false }
            });
            host.store.appendMessage(sid, 'system', [
              textPart(`[recovery] Stopped: model output degenerated into repetition (${reason})`)
            ]);
            return finishEnded(host.store.updateSession(session.id, { status: 'idle' }), 'repetition');
          }
        } else if (isContextOverflowError(error)) {
          void host.emitTrace(sid, {
            kind: 'model_error',
            payload: { message: error instanceof Error ? error.message : String(error), overflow: true }
          });
          const compacted = await host.autoCompact(context, { force: true });
          if (compacted.replaced) {
            await emitStep({ type: 'compacted', replaced: compacted.replaced });
          }
          const packedRetry = await prepareTurnInput(sid, {
            store: host.store,
            autoCompact: async () => {},
            claimNextStep: () => host.store.claimInbox(sid, 'next-step'),
            prepareView: (sess, msgs) => host.prepareMessagesForModel(sess, msgs),
            buildAppendix: () => '',
            applyFoldBudget: (sess, foldedMsgs) => host.applyOptionalFoldBudget(sess, foldedMsgs)
          });
          turnInput = { ...turnInput, messages: packedRetry.messages };
          turnResult = await host.runTurnWithRetries(turnInput, options?.onModelStreamChunk);
        } else {
          void host.emitTrace(sid, {
            kind: 'model_error',
            payload: { message: error instanceof Error ? error.message : String(error) }
          });
          throw error;
        }
      }

      // Some gateways report prompt_tokens as a session running total. Left
      // as-is that would be summed again every turn, inflating totals and cost
      // quadratically. Normalize to this turn's share before anything consumes it.
      if (turnResult.usage) {
        const prev = host.cumulativeInputTokensBySession.get(sid);
        const split = splitCumulativePromptTokens(
          turnResult.usage.inputTokens,
          prev?.cumulative,
          prev?.sticky ?? false
        );
        host.cumulativeInputTokensBySession.set(sid, {
          cumulative: split.cumulativeInputTokens,
          // Once classified cumulative the session stays that way; see usage.ts.
          sticky: (prev?.sticky ?? false) || split.treatedAsCumulative
        });
        if (split.treatedAsCumulative) {
          const cached = Math.min(turnResult.usage.cachedInputTokens ?? 0, split.turnInputTokens);
          turnResult = {
            ...turnResult,
            usage: {
              ...turnResult.usage,
              inputTokens: split.turnInputTokens,
              totalTokens: split.turnInputTokens + turnResult.usage.outputTokens,
              ...(cached > 0 ? { cachedInputTokens: cached } : {})
            }
          };
          void host.emitTrace(sid, {
            kind: 'usage_cumulative_split',
            payload: {
              reportedInputTokens: split.cumulativeInputTokens,
              turnInputTokens: split.turnInputTokens
            }
          });
        }
      }

      let turnCostUsd: number | undefined;
      let turnCostModel: string | undefined;
      if (turnResult.usage) {
        try {
          const cost = estimateUsageCostUsd(
            turnResult.usage,
            process.env.RAW_AGENT_MODEL_NAME,
            process.env
          );
          turnCostUsd = cost.usd;
          turnCostModel = cost.model;
        } catch {
          /* ignore */
        }
      }

      void host.emitTrace(sid, {
        kind: 'turn_end',
        payload: {
          stopReason: turnResult.stopReason,
          ...(turnResult.finishReason ? { finishReason: turnResult.finishReason } : {}),
          ...(turnResult.usage ? { usage: turnResult.usage } : {}),
          ...(turnResult.truncated ? { truncated: true } : {}),
          ...(turnResult.requestId ? { requestId: turnResult.requestId } : {}),
          ...(turnCostUsd !== undefined ? { costUsd: turnCostUsd, costModel: turnCostModel } : {}),
          stableSystemVersion: STABLE_SYSTEM_VERSION
        }
      });

      // Truncation is a control-flow event (see decideTurnRecovery), not a clean end.
      if (turnResult.truncated) {
        void host.emitTrace(sid, {
          kind: 'turn_truncated',
          payload: {
            finishReason: turnResult.finishReason ?? 'length',
            ...(turnResult.usage ? { outputTokens: turnResult.usage.outputTokens } : {})
          }
        });
      }

      // Aggregate per-session token totals + USD cost estimate (best-effort).
      if (turnResult.usage) {
        try {
          const current = host.store.getSession(session.id);
          const prevTotals = (current?.metadata?.usageTotals ?? undefined) as
            | TokenUsage
            | undefined;
          const merged = mergeUsage(prevTotals, turnResult.usage);
          const prevCostUsd =
            typeof current?.metadata?.usageCostUsd === 'number'
              ? (current.metadata.usageCostUsd as number)
              : undefined;
          const usageCostUsd = mergeCostUsd(prevCostUsd, turnCostUsd);
          if (merged) {
            host.store.updateSession(session.id, {
              metadata: {
                ...(current?.metadata ?? {}),
                usageTotals: merged,
                ...(usageCostUsd !== undefined ? { usageCostUsd } : {})
              }
            });
          }
        } catch (err) {
          void err; // never let usage accounting break the turn
        }
      }

      const recovery = decideTurnRecovery({
        stopReason: turnResult.stopReason,
        finishReason: turnResult.finishReason,
        truncated: turnResult.truncated,
        assistantParts: turnResult.assistantParts,
        state: recoveryState,
        userAborted: signal.aborted
      });
      if (recovery.action === 'abort' && recovery.reason === 'user_abort') {
        return finishEnded(host.store.updateSession(session.id, { status: 'failed' }), 'abort');
      }
      if (recovery.action === 'retry-same-input') {
        host.store.appendMessage(sid, 'system', [
          textPart('[recovery] Truncated/incomplete tool_call discarded; retrying the same input.')
        ]);
        continue;
      }
      if (recovery.action === 'retry-after-nudge') {
        if (turnResult.assistantParts.length > 0) {
          host.store.appendMessage(session.id, 'assistant', turnResult.assistantParts);
        }
        host.store.appendMessage(sid, 'system', [textPart(recovery.nudge)]);
        continue;
      }
      if (recovery.action === 'abort') {
        host.store.updateSession(session.id, { status: 'failed' });
        throw new ValidationError(
          recovery.reason === 'empty_assistant'
            ? 'Model returned no assistant content'
            : `Turn recovery aborted: ${recovery.reason}`
        );
      }

      if (turnResult.assistantParts.length === 0) {
        host.store.updateSession(session.id, { status: 'failed' });
        throw new ValidationError('Model returned no assistant content');
      }

      // Reasoning spin: several turns in a row with only reasoning / empty output.
      // Deliberately no retry — a re-ask re-sends the full tool schemas for the
      // same non-answer. Persist what we got, explain, and finalize.
      const spinReason = spinWatchdog?.noteParts(turnResult.assistantParts);
      if (spinReason) {
        host.store.appendMessage(session.id, 'assistant', turnResult.assistantParts);
        host.store.appendMessage(sid, 'system', [textPart(`[recovery] Stopped: ${spinReason}`)]);
        void host.emitTrace(sid, {
          kind: 'reasoning_spin_abort',
          payload: { reason: spinReason, streak: spinWatchdog!.streak }
        });
        return finishEnded(host.store.updateSession(session.id, { status: 'idle' }), 'reasoning_spin');
      }

      let pendingRecoveryAdvisory: string | undefined;
      if (loopGuard) {
        const rep = loopGuard.checkAssistantRepetition(turnResult.assistantParts);
        const graceOut = advisoryGrace ? advisoryGrace.apply(rep) : rep.abort
          ? { action: 'abort' as const, reason: rep.reason }
          : { action: 'continue' as const };
        if (graceOut.action === 'advise') {
          const strike = noteCriticalHit(recoveryState);
          if (strike.action === 'abort') {
            host.store.appendMessage(session.id, 'assistant', turnResult.assistantParts);
            host.store.appendMessage(session.id, 'system', [
              textPart(`[recovery] Stopped: ${graceOut.reason} (critical strike)`)
            ]);
            return finishEnded(host.store.updateSession(session.id, { status: 'idle' }), 'repetition');
          }
          pendingRecoveryAdvisory = graceOut.advisory;
          void host.emitTrace(sid, {
            kind: 'recovery_advisory',
            payload: { reason: graceOut.reason, trigger: 'repetition' }
          });
        } else if (graceOut.action === 'abort') {
          host.store.appendMessage(session.id, 'assistant', turnResult.assistantParts);
          await host.injectEvolvingCoachBeforeRecovery(session, agent, 'repetition', graceOut.reason);
          host.store.appendMessage(session.id, 'system', [textPart(`[recovery] Stopped: ${graceOut.reason}`)]);
          void host.emitTrace(sid, {
            kind: 'recovery_abort',
            payload: { reason: graceOut.reason, trigger: 'repetition' }
          });
          host.scheduleBackgroundCaseReview({
            sessionId: session.id,
            agentId: agent.id,
            outcome: 'failure',
            signals: { trigger: 'repetition', reason: graceOut.reason }
          });
          return finishEnded(host.store.updateSession(session.id, { status: 'idle' }), 'repetition');
        }
      }

      host.store.appendMessage(session.id, 'assistant', turnResult.assistantParts);
      if (pendingRecoveryAdvisory) {
        host.store.appendMessage(session.id, 'system', [textPart(pendingRecoveryAdvisory)]);
      }
      await emitStep({
        type: 'model_done',
        stopReason: turnResult.stopReason,
        finishReason: turnResult.finishReason,
        truncated: turnResult.truncated,
        assistant: { parts: turnResult.assistantParts }
      });

      if (turnResult.stopReason !== 'tool_use') {
        const stopPhase = context.session.mode === 'subagent' ? 'subagent_stop' : 'stop';
        const stopHook = await runLifecycleHook(process.env, {
          phase: stopPhase,
          sessionId: sid,
          context: { stopReason: turnResult.stopReason, agentId: agent.id }
        });
        if (lifecycleBlocks(stopHook)) {
          host.store.appendMessage(sid, 'system', [
            textPart(
              `[stop-hook] ${stopHook.message ?? stopHook.systemMessage ?? 'stop blocked; continuing verification loop'}`
            )
          ]);
          continue;
        }
        if (stopHook.systemMessage) {
          host.store.appendMessage(sid, 'system', [textPart(stopHook.systemMessage)]);
        }
        const stopExt = await host.extensionRegistry.run('stop', {
          sessionId: sid,
          agentId: agent.id,
          meta: { stopReason: turnResult.stopReason, mode: context.session.mode }
        });
        if (stopExt.block) {
          host.store.appendMessage(sid, 'system', [
            textPart(
              `[stop-extension] ${stopExt.message ?? stopExt.systemMessage ?? 'stop blocked; continuing'}`
            )
          ]);
          continue;
        }
        if (stopExt.systemMessage) {
          host.store.appendMessage(sid, 'system', [textPart(stopExt.systemMessage)]);
        }

        // Soft goal completion gate (orthogonal to task_run_mode): only vetoes
        // normal completion; hard stops already returned above via recovery.
        if (goalGate?.isActive()) {
          const snapMsgs = host.store.listMessages(sid).slice(-8);
          const snapshot = snapMsgs
            .map((m) => `${m.role}: ${textSummaryFromParts(m.parts)}`)
            .join('\n')
            .slice(0, 12_000);
          const judge =
            typeof host.modelAdapter.completeText === 'function'
              ? (input: { system: string; user: string; signal?: AbortSignal }) =>
                  host.modelAdapter.completeText!({ ...input, jsonMode: true })
              : async () =>
                  JSON.stringify({ met: true, reason: 'no completeText; fail-open' });
          const { evalResult, decision } = await goalGate.evaluate({
            snapshot,
            judge,
            signal
          });
          host.mergeSessionMetadata(sid, goalGate.metadataPatch());
          void host.emitTrace(sid, {
            kind: 'goal_eval',
            payload: {
              met: evalResult.met,
              reason: evalResult.reason,
              source: evalResult.source,
              decision: decision.kind,
              turnsUsed: goalGate.getTurnsUsed()
            }
          });
          if (decision.kind === 'continue') {
            const reason =
              decision.unattendedInstruction ??
              `[goal] Condition not met yet: ${evalResult.reason}. Continue working toward the goal.`;
            host.store.appendMessage(sid, 'system', [textPart(reason)]);
            continue;
          }
          if (decision.kind === 'close') {
            host.store.appendMessage(sid, 'system', [
              textPart(`[goal] Closed (${decision.event}): ${decision.reason}`)
            ]);
          } else if (decision.kind === 'achieved') {
            host.store.appendMessage(sid, 'system', [
              textPart(`[goal] Achieved: ${evalResult.reason}`)
            ]);
          }
        }

        return host.handleTurnCompletion(session, agent, task).then((completed) =>
          finishEnded(completed, 'end')
        );
      }

      const assistantMessage = host.store.listMessages(session.id).slice(-1)[0];
      if (!assistantMessage) {
        return finishEnded(host.store.updateSession(session.id, { status: 'failed' }), 'missing_assistant');
      }
      type ToolCallPart = Extract<MessagePart, { type: 'tool_call' }>;
      const toolCalls = assistantMessage.parts.filter(
        (part): part is ToolCallPart => part.type === 'tool_call'
      );

      const validToolCalls = host.filterValidToolCalls(toolCalls, allowExternalAiTools, session.id);

      const approvalResult = host.checkToolApprovals(validToolCalls, context, filePolicy, session);
      if (approvalResult === 'waiting') {
        await emitStep({ type: 'waiting_approval' });
        return host.store.updateSession(session.id, { status: 'waiting_approval' });
      }
      if (approvalResult === 'skip') {
        continue;
      }

      const results = await host.executeToolCalls(validToolCalls, context, allowExternalAiTools, sid);
      host.processToolResults(results, validToolCalls, session, task, sid, options?.onModelStreamChunk);
      await emitStep({
        type: 'tools_done',
        results: results.map((r) => ({ ok: r.ok, content: r.content, name: r.name }))
      });

      if (riskEngine) {
        for (const r of results) {
          riskEngine.observeTool({
            toolName: r.name,
            success: r.ok,
            errorMessage: r.ok ? undefined : r.content
          });
        }
        const iterLimit = envInt(process.env, 'RAW_AGENT_MAX_TURNS', 32);
        const usageTotals = host.store.getSession(sid)?.metadata?.usageTotals as
          | TokenUsage
          | undefined;
        const budgetTokens = envInt(process.env, 'RAW_AGENT_TOKEN_BUDGET', 0);
        const tick = riskEngine.tick({
          iteration: turn,
          iterationLimit: iterLimit,
          usedTokens: usageTotals?.totalTokens,
          budgetTokens: budgetTokens > 0 ? budgetTokens : undefined
        });
        if (tick.shouldAdvise) {
          const draft = advisoryQueue.enqueue(formatRiskAdvisory(tick.signals), 'risk');
          void host.emitTrace(sid, {
            kind: 'risk_advisory',
            payload: { reason: tick.reason, signals: tick.signals, advisoryId: draft.id }
          });
        }
      }

      if (loopGuard) {
        const ar = loopGuard.afterToolRound(
          validToolCalls.map((tc) => ({ name: tc.name })),
          results.map((r) => ({ name: r.name, ok: r.ok }))
        );
        const graceOut = advisoryGrace ? advisoryGrace.apply(ar) : ar.abort
          ? { action: 'abort' as const, reason: ar.reason }
          : { action: 'continue' as const };
        if (graceOut.action === 'advise') {
          const strike = noteCriticalHit(recoveryState);
          if (strike.action === 'abort') {
            host.store.appendMessage(session.id, 'system', [
              textPart(`[recovery] Stopped: ${graceOut.reason} (critical strike)`)
            ]);
            return finishEnded(host.store.updateSession(session.id, { status: 'idle' }), 'tool_loop');
          }
          host.store.appendMessage(session.id, 'system', [textPart(graceOut.advisory)]);
          void host.emitTrace(sid, {
            kind: 'recovery_advisory',
            payload: { reason: graceOut.reason, trigger: 'tools' }
          });
          continue;
        }
        if (graceOut.action === 'abort') {
          const fresh = host.store.getSession(session.id) as SessionRecord;
          await host.injectEvolvingCoachBeforeRecovery(fresh, agent, 'tools', graceOut.reason);
          host.store.appendMessage(session.id, 'system', [textPart(`[recovery] Stopped: ${graceOut.reason}`)]);
          void host.emitTrace(sid, {
            kind: 'recovery_abort',
            payload: { reason: graceOut.reason, trigger: 'tools' }
          });
          host.scheduleBackgroundCaseReview({
            sessionId: session.id,
            agentId: agent.id,
            outcome: 'failure',
            signals: { trigger: 'tools', reason: graceOut.reason }
          });
          return finishEnded(host.store.updateSession(session.id, { status: 'idle' }), 'tool_loop');
        }
      }
    }

    host.scheduleBackgroundCaseReview({
      sessionId: session.id,
      agentId: agent.id,
      outcome: 'partial',
      signals: { reason: 'max_turns_exhausted', maxTurns: host.maxTurnsPerRun }
    });
    return finishEnded(host.store.updateSession(session.id, { status: 'idle' }), 'max_turns');
  } finally {
    host.sessionAbortControllers.delete(sessionId);
    // Both per-session maps must outlive a single run (turn shape seeds the next
    // run's budget, cumulative tokens span turns), so they are pruned by size
    // rather than cleared here — a long-lived daemon would otherwise leak a
    // slot per session forever.
    capSessionMap(host.turnShapeBySession);
    capSessionMap(host.cumulativeInputTokensBySession);
  }
}
