/**
 * L3 turn kernel: one session run (prepare → model → recovery → tools).
 * Behavior-preserving move of RawAgentRuntime._runSessionInner.
 */

import { createHash } from 'node:crypto';
import { NotFoundError, ValidationError } from '../errors.js';
import { envBool, envInt } from '../env.js';
import { createId } from '../id.js';
import { STABLE_SYSTEM_VERSION, type PromptContext } from '../model/prompt-builder.js';
import { foldGoalJudgeSnapshot } from './goal-snapshot.js';
import {
  lifecycleBlocks,
  runLifecycleHook
} from '../hooks/lifecycle-hooks.js';
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
import { resolveTurnTools } from './resolve-turn-tools.js';
import { isContextOverflowError } from '../session/auto-compact.js';
import type { AgentLoopLatch, AgentStepEvent } from '../runtime/agent-loop.js';
import {
  createWaitingApprovalInterrupt,
  decideInterruptResume,
  mergeInterruptMetadata,
  unmatchedToolCallsFromFold,
  type RunInterruptState
} from '../session/interrupt.js';
import {
  mergeOutcomeMetadata,
  runOutcomeFromEnd,
  type RunOutcome
} from '../session/run-outcome.js';
import { closeOpenToolWave, TOOL_WAVE_SKIPPED_STEER_CONTENT } from '../session/tool-wave-close.js';
import {
  drainSteerAtToolLaunch,
  resolveSteerDrainPolicy,
  type SteerDrainPolicy
} from '../session/steer-drain.js';
import type {
  MessagePart,
  ModelStreamChunk,
  ModelTurnResult,
  RunContext,
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
  options?: {
    onModelStreamChunk?: (chunk: ModelStreamChunk) => void;
    latch?: AgentLoopLatch;
    steerDrainPolicy?: SteerDrainPolicy;
  }
): Promise<SessionRecord> {
  let session = host.store.getSession(sessionId);
  if (!session) {
    throw new NotFoundError('Session', sessionId);
  }

  const pendingApprovalIds = host.store
    .listApprovals({ status: 'pending' })
    .filter((a) => a.sessionId === sessionId)
    .map((a) => a.id);
  const resumeDecision = decideInterruptResume({ session, pendingApprovalIds });
  if (resumeDecision.action === 'yield_waiting') {
    await options?.latch?.emit({
      type: 'waiting_approval',
      approvalIds: resumeDecision.interrupt.approvalIds,
      interrupt: resumeDecision.interrupt
    });
    return session;
  }
  let resumeFromInterrupt: RunInterruptState | undefined =
    resumeDecision.action === 'resume_tools' ? resumeDecision.interrupt : undefined;

  const agent = host.store.getAgent(session.agentId);
  if (!agent) {
    throw new NotFoundError('Agent', session.agentId);
  }

  const controller = new AbortController();
  host.sessionAbortControllers.set(sessionId, controller);
  const signal = controller.signal;
  const sid = session.id;
  const writerRunId = resumeFromInterrupt?.writerRunId ?? createId('run');
  host.store.claimWriter(sessionId, writerRunId);
  const emitStep = async (ev: AgentStepEvent) => {
    if (options?.latch) await options.latch.emit(ev);
  };
  const persistOutcome = (record: SessionRecord, reason: string): { record: SessionRecord; outcome: RunOutcome } => {
    const outcome = runOutcomeFromEnd({ reason, sessionStatus: record.status });
    const next = host.store.updateSession(record.id, {
      metadata: mergeOutcomeMetadata(record.metadata ?? {}, outcome)
    });
    return { record: next, outcome };
  };
  const finishEnded = async (record: SessionRecord, reason: string) => {
    const { record: next, outcome } = persistOutcome(record, reason);
    void host.emitTrace(next.id, {
      kind: 'turn_end',
      payload: { terminal: true, reason, outcome }
    });
    await emitStep({ type: 'ended', reason, outcome });
    return next;
  };
  const closeWaveIfOpen = () => {
    try {
      closeOpenToolWave(host.store, sid, 'interrupted');
    } catch {
      /* best-effort */
    }
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
  const adapterOf = (sess: SessionRecord) =>
    host.resolveModelAdapter?.(sess) ?? host.modelAdapter;
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
        closeWaveIfOpen();
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

      if (resumeFromInterrupt) {
        const interrupt = resumeFromInterrupt;
        resumeFromInterrupt = undefined;
        const claimed = host.store.claimInbox(sid, 'next-step');
        if (claimed.length > 0) {
          applyClaimedInbox(host.store, sid, claimed);
        }
        const remaining = unmatchedToolCallsFromFold(
          host.store.foldMessages(sid),
          interrupt.toolCallIds.filter((id) => !interrupt.executedToolCallIds.includes(id))
        );
        const sessionOptIn = context.session.metadata?.allowExternalAiTools === true;
        const allowExt = envBool(process.env, 'RAW_AGENT_EXTERNAL_AI_TOOLS', false) && sessionOptIn;
        if (remaining.length > 0) {
          const results = await host.executeToolCalls(remaining, context, allowExt, sid);
          host.processToolResults(results, remaining, session, task, sid, options?.onModelStreamChunk);
          await emitStep({
            type: 'tools_done',
            results: results.map((r) => ({ ok: r.ok, content: r.content, name: r.name }))
          });
        }
        const after = host.store.getSession(sid);
        host.store.updateSession(sid, {
          metadata: mergeInterruptMetadata(after?.metadata ?? {}, null)
        });
        continue;
      }

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
          adapter: adapterOf(host.store.getSession(sid) ?? session).name,
          stablePrefixHash,
          routing: routing ? {
            mode: routing.mode,
            confidence: routing.confidence.level,
            shortlistCount: routing.shortlistNames.length,
            topSkill: routing.routed[0]?.skill.name
          } : undefined
        }
      });

      const resolveImageDataUrl = async (assetId: string, _sig?: AbortSignal) => {
        return host.resolveImageDataUrl(assetId, context.session.id);
      };

      const selectedTools = resolveTurnTools({
        env: process.env,
        tools: host.tools,
        agent,
        session: context.session,
        sessionId: sid,
        systemPromptChars: systemPrompt.length
      });
      const allowExternalAiTools = selectedTools.allowExternalAiTools;
      const turnTools = selectedTools.turnTools;
      host.turnShapeBySession.set(sid, selectedTools.turnShape);
      if (Object.keys(selectedTools.metadataPatch).length > 0) {
        host.mergeSessionMetadata(sid, selectedTools.metadataPatch);
        context = {
          ...context,
          session: host.store.getSession(sid) as SessionRecord
        };
      }
      if (selectedTools.drifted) {
        void host.emitTrace(sid, {
          kind: 'prompt_cache_bust',
          payload: { fingerprint: selectedTools.fingerprint, reason: 'toolset_drift' }
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
        sessionId: sid,
        resolveImageDataUrl,
        promptCacheKey: selectedTools.promptCacheKey,
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
        closeWaveIfOpen();
        return finishEnded(host.store.updateSession(session.id, { status: 'failed' }), 'abort');
      }
      if (recovery.action === 'retry-same-input') {
        host.store.appendMessage(sid, 'system', [
          textPart('[recovery] Truncated/incomplete tool_call discarded; retrying the same input.')
        ]);
        continue;
      }
      if (recovery.action === 'retry-after-nudge') {
        if (!recovery.discardAssistant && turnResult.assistantParts.length > 0) {
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

      const assistantMessage = host.store.appendMessage(session.id, 'assistant', turnResult.assistantParts);
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
          const snapshot = foldGoalJudgeSnapshot(host.store, sid);
          const gateAdapter = adapterOf(host.store.getSession(sid) ?? session);
          const judge =
            typeof gateAdapter.completeText === 'function'
              ? (input: { system: string; user: string; signal?: AbortSignal }) =>
                  gateAdapter.completeText!({ ...input, jsonMode: true })
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
        const approvalIds = host.store
          .listApprovals({ status: 'pending' })
          .filter((a) => a.sessionId === sid)
          .map((a) => a.id);
        const interrupt = createWaitingApprovalInterrupt({
          toolCallIds: validToolCalls.map((c) => c.toolCallId),
          approvalIds,
          writerRunId
        });
        const current = host.store.getSession(sid) as SessionRecord;
        const outcome = runOutcomeFromEnd({
          reason: 'waiting_approval',
          sessionStatus: 'waiting_approval'
        });
        const updated = host.store.updateSession(sid, {
          status: 'waiting_approval',
          metadata: mergeInterruptMetadata(
            mergeOutcomeMetadata(current.metadata ?? {}, outcome),
            interrupt
          )
        });
        await emitStep({ type: 'waiting_approval', approvalIds, interrupt });
        return updated;
      }
      if (approvalResult === 'skip') {
        continue;
      }

      const drainPolicy = resolveSteerDrainPolicy({
        option: options?.steerDrainPolicy,
        sessionMetadata: host.store.getSession(sid)?.metadata,
        store: host.store
      });
      const drain = drainSteerAtToolLaunch({
        store: host.store,
        sessionId: sid,
        toolCallIds: validToolCalls.map((c) => c.toolCallId),
        policy: drainPolicy
      });
      if (drain.drained) {
        await emitStep({
          type: 'tools_done',
          results: drain.skippedIds.map((id) => ({
            ok: false,
            content: TOOL_WAVE_SKIPPED_STEER_CONTENT,
            name: validToolCalls.find((c) => c.toolCallId === id)?.name
          }))
        });
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
    const current = host.store.getSession(sessionId);
    if (current?.status !== 'waiting_approval') {
      host.store.releaseWriter(sessionId, writerRunId);
    }
    // Both per-session maps must outlive a single run (turn shape seeds the next
    // run's budget, cumulative tokens span turns), so they are pruned by size
    // rather than cleared here — a long-lived daemon would otherwise leak a
    // slot per session forever.
    capSessionMap(host.turnShapeBySession);
    capSessionMap(host.cumulativeInputTokensBySession);
  }
}
