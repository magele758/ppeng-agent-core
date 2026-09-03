/**
 * L5 host adapters: session/scheduler/spawn/compact/kernel bindings for RawAgentRuntime.
 */

import type { ApprovalPolicy } from '../approval/approval-policy.js';
import type { FileApprovalPolicy } from '../approval/policy-loader.js';
import type { ExtensionRegistry } from '../extensions/extension-registry.js';
import type { Logger } from '../logger.js';
import type { PromptBuilder } from '../model/prompt-builder.js';
import type { AgentSandbox } from '../sandbox/agent-sandbox-types.js';
import type { AutonomousScheduler } from '../services/autonomous-scheduler.js';
import type { ImageIngestService } from '../services/image-ingest-service.js';
import type { SqliteStateStore } from '../storage.js';
import type { TraceEvent } from '../stores/trace.js';
import { checkToolBindingPin, markBindingNeedsReverify } from '../discovery/cbom.js';
import { resolveDiscoveryEnabled } from '../discovery/settings.js';
import { resolveSessionModelAdapter } from '../model/provider-catalog.js';
import { resolveModelRoute, withProviderFallback } from '../model/registry-router.js';
import { waitSteeringChildrenIdle } from '../session/steering-subagent.js';
import { runCaseGovernance } from '../evolving/case-governance.js';
import { scheduleBackgroundCaseReview } from '../evolving/index.js';
import { imageBufferToDataUrl, touchImageAccess } from '../image-assets.js';
import type {
  ModelAdapter,
  SessionRecord,
  ToolContract
} from '../types.js';
import type { WorkspaceManager } from '../workspaces.js';
import type { CronJobStore } from '../cron/cron-store.js';
import type { CronFacadeHost } from '../cron/cron-facade.js';
import {
  checkToolApprovals as toolLoopCheckApprovals,
  executeToolCalls as toolLoopExecuteCalls,
  filterValidToolCalls as toolLoopFilterValid,
  processToolResults as toolLoopProcessResults,
  runTurnWithRetries as toolLoopRunTurn,
  type ToolLoopDeps
} from './tool-loop.js';
import { createToolServices as buildToolServices } from './tool-services.js';
import {
  applyOptionalFoldBudget as applyOptionalFoldBudgetView,
  prepareMessagesForModel as prepareMessagesForModelView,
  type PrepareViewHost
} from '../turn/prepare-view.js';
import type { TurnKernelHost } from '../turn/host.js';
import { autoCompactSession } from './compact-host.js';
import { autoClaimTask, ingestMailbox, unblockDependentTasks } from './scheduler-host.js';
import { handleTurnCompletion, injectEvolvingCoachBeforeRecovery } from './session-complete.js';
import { resolveSkillLoad } from './skill-load.js';
import {
  ensureWorkspaceRoot,
  spawnSubagent,
  spawnTeammate,
  startBackgroundJob,
  type SpawnHost
} from './spawn-host.js';
import type { SessionFacadeHost } from './session-facade.js';
import type { CompactHost } from './compact-host.js';
import type { SessionCompleteHost } from './session-complete.js';
import type { SchedulerTickHost } from './scheduler-host.js';

export interface L5Bindable {
  store: SqliteStateStore;
  repoRoot: string;
  stateDir: string;
  tools: ToolContract<any>[];
  modelAdapter: ModelAdapter;
  promptBuilder: PromptBuilder;
  mcpManager: { ensureLoaded(sessionId: string): Promise<void> };
  extensionRegistry: ExtensionRegistry;
  maxTurnsPerRun: number;
  maxParallelToolCalls: number;
  envApprovalPolicy: ApprovalPolicy | undefined;
  turnShapeBySession: Map<string, { systemPromptChars: number; toolCount: number }>;
  cumulativeInputTokensBySession: Map<string, { cumulative: number; sticky: boolean }>;
  sessionAbortControllers: Map<string, AbortController>;
  workspaceManager: WorkspaceManager;
  sandbox: AgentSandbox | undefined;
  setSandbox(sandbox: AgentSandbox): void;
  backgroundJobAborts: Map<string, AbortController>;
  cronStore: CronJobStore | undefined;
  setCronStore(store: CronJobStore): void;
  selfHeal: { processRuns(): Promise<void> };
  swarmExecutor: { tick(): Promise<unknown> };
  teamDagExecutor?: { tick(): Promise<unknown> };
  orchestrationEngine: { tick(): Promise<unknown> };
  autonomousScheduler: AutonomousScheduler;
  imageIngest: Pick<ImageIngestService, 'runRetention'>;
  log: Logger;
  emitTrace(sessionId: string, event: Omit<TraceEvent, 'ts' | 'sessionId'>): void;
  mergeSessionMetadata(sessionId: string, patch: Record<string, unknown>): SessionRecord;
  mergedFilePolicy(): Promise<FileApprovalPolicy | undefined>;
  runSession(sessionId: string): Promise<SessionRecord>;
  cancelSession(sessionId: string): void;
}

export function sessionFacadeFrom(rt: L5Bindable): SessionFacadeHost {
  return {
    store: rt.store,
    runImageRetention: (sessionId) => rt.imageIngest.runRetention(sessionId),
    wakeAllAutonomousSessions: (reason) => rt.autonomousScheduler.wakeAll(reason),
    wakeAgentSessions: (agentId, reason) => rt.autonomousScheduler.wakeAgent(agentId, reason)
  };
}

export function cronFacadeFrom(rt: L5Bindable): CronFacadeHost {
  return {
    ...sessionFacadeFrom(rt),
    stateDir: rt.stateDir,
    cronStore: rt.cronStore,
    setCronStore: (store) => rt.setCronStore(store)
  };
}

export function schedulerFrom(rt: L5Bindable): SchedulerTickHost {
  return {
    store: rt.store,
    stateDir: rt.stateDir,
    log: rt.log,
    cronStore: rt.cronStore,
    setCronStore: (store) => rt.setCronStore(store),
    selfHeal: rt.selfHeal,
    swarmExecutor: rt.swarmExecutor,
    teamDagExecutor: rt.teamDagExecutor,
    orchestrationEngine: rt.orchestrationEngine,
    autonomousScheduler: rt.autonomousScheduler,
    runSession: (sid) => rt.runSession(sid)
  };
}

export function spawnFrom(rt: L5Bindable): SpawnHost {
  return {
    ...sessionFacadeFrom(rt),
    repoRoot: rt.repoRoot,
    stateDir: rt.stateDir,
    workspaceManager: rt.workspaceManager,
    sandbox: rt.sandbox,
    setSandbox: (sandbox) => rt.setSandbox(sandbox),
    backgroundJobAborts: rt.backgroundJobAborts,
    runSession: (sid) => rt.runSession(sid),
    cancelSession: (sid) => rt.cancelSession(sid)
  };
}

export function compactFrom(rt: L5Bindable): CompactHost {
  return {
    store: rt.store,
    stateDir: rt.stateDir,
    modelAdapter: rt.modelAdapter,
    resolveModelAdapter: (session) =>
      resolveSessionModelAdapter(rt.store, session, process.env, rt.modelAdapter),
    extensionRegistry: rt.extensionRegistry,
    turnShapeBySession: rt.turnShapeBySession,
    emitTrace: (sessionId, event) => rt.emitTrace(sessionId, event),
    prepareMessagesForModel: (session, messages) =>
      prepareMessagesForModelView(prepareViewFrom(rt), session, messages)
  };
}

export function sessionCompleteFrom(rt: L5Bindable): SessionCompleteHost {
  return {
    store: rt.store,
    stateDir: rt.stateDir,
    emitTrace: (sessionId, event) => rt.emitTrace(sessionId, event),
    mergeSessionMetadata: (sessionId, patch) => rt.mergeSessionMetadata(sessionId, patch)
  };
}

export function prepareViewFrom(rt: L5Bindable): PrepareViewHost {
  return {
    store: rt.store,
    emitTrace: (sessionId, event) => {
      rt.emitTrace(sessionId, event as Parameters<TurnKernelHost['emitTrace']>[1]);
    },
    turnShapeBySession: rt.turnShapeBySession,
    promptBuilder: rt.promptBuilder
  };
}

export function toolLoopDepsFrom(rt: L5Bindable): ToolLoopDeps {
  return {
    tools: rt.tools,
    store: rt.store,
    envApprovalPolicy: rt.envApprovalPolicy,
    maxParallelToolCalls: rt.maxParallelToolCalls,
    modelAdapter: rt.modelAdapter,
    stateDir: rt.stateDir,
    emitTrace: (sessionId, event) => {
      void rt.emitTrace(sessionId, {
        kind: event.kind as TraceEvent['kind'],
        payload: event.payload
      });
    },
    runAfterToolExtension: async (ctx) => {
      const r = await rt.extensionRegistry.run('after_tool', {
        sessionId: ctx.sessionId,
        tool: ctx.tool,
        input: ctx.input,
        ok: ctx.ok,
        content: ctx.content
      });
      return r.systemMessage ? { systemMessage: r.systemMessage } : undefined;
    },
    settingsStore: rt.store,
    onArtifactCreated: (manifest) => {
      try {
        rt.store.createArtifactIndex({
          id: manifest.handle,
          sessionId: manifest.sessionId,
          sourceTool: manifest.sourceTool,
          fileName: manifest.fileName,
          mimeType: manifest.mimeType,
          localRelPath: manifest.storageRelPath,
          totalBytes: manifest.totalBytes,
          totalChars: manifest.totalChars,
          pageSizeChars: manifest.pageSizeChars,
          totalPages: manifest.totalPages,
          createdAt: manifest.createdAt
        });
      } catch {
        /* index is best-effort; files remain readable */
      }
    },
    checkCapabilityPin: (toolName, inputSchema) => {
      if (!resolveDiscoveryEnabled(rt.store, process.env)) {
        return { ok: true };
      }
      const store = rt.store.capabilities();
      const result = checkToolBindingPin(store, toolName, inputSchema);
      if (!result.ok && result.bindingId) {
        try {
          markBindingNeedsReverify(store, result.bindingId);
        } catch {
          /* best-effort */
        }
      }
      return result;
    }
  };
}

export function createRuntimeToolServices(rt: L5Bindable) {
  return buildToolServices({
    store: rt.store,
    stateDir: rt.stateDir,
    resolveSkillLoad: (name, sessionId) => resolveSkillLoad({
      promptBuilder: rt.promptBuilder,
      emitTrace: (id, event) => rt.emitTrace(id, event)
    }, name, sessionId),
    unblockDependentTasks: (taskId) => unblockDependentTasks(rt.store, taskId),
    spawnSubagent: (context, prompt, role, opts) =>
      spawnSubagent(spawnFrom(rt), context, prompt, role, opts),
    spawnTeammate: (context, input) => spawnTeammate(spawnFrom(rt), context, input),
    startBackgroundJob: (sessionId, command) => startBackgroundJob(spawnFrom(rt), sessionId, command),
    compactContext: async (context, opts) => {
      const compacted = await autoCompactSession(compactFrom(rt), context, opts);
      if (compacted.replaced) {
        return `Compacted seq ${compacted.replaced.startSeq}–${compacted.replaced.endSeq}.`;
      }
      return 'No compaction applied (under threshold or open tool wave).';
    }
  });
}

export function bindTurnKernelHost(rt: L5Bindable): TurnKernelHost {
  return {
    store: rt.store,
    repoRoot: rt.repoRoot,
    stateDir: rt.stateDir,
    tools: rt.tools,
    modelAdapter: rt.modelAdapter,
    resolveModelAdapter: (session) =>
      resolveSessionModelAdapter(rt.store, session, process.env, rt.modelAdapter),
    promptBuilder: rt.promptBuilder,
    mcpManager: rt.mcpManager,
    extensionRegistry: rt.extensionRegistry,
    maxTurnsPerRun: rt.maxTurnsPerRun,
    turnShapeBySession: rt.turnShapeBySession,
    cumulativeInputTokensBySession: rt.cumulativeInputTokensBySession,
    sessionAbortControllers: rt.sessionAbortControllers,
    emitTrace: (sessionId, event) => rt.emitTrace(sessionId, event),
    mergeSessionMetadata: (sessionId, patch) => rt.mergeSessionMetadata(sessionId, patch),
    ensureWorkspaceRoot: (session, task) => ensureWorkspaceRoot(spawnFrom(rt), session, task),
    ingestMailbox: (session) => ingestMailbox(rt.store, session),
    autoClaimTask: (session) => autoClaimTask(rt.store, session),
    mergedFilePolicy: () => rt.mergedFilePolicy(),
    autoCompact: (context, opts) => autoCompactSession(compactFrom(rt), context, opts),
    prepareMessagesForModel: (session, messages) =>
      prepareMessagesForModelView(prepareViewFrom(rt), session, messages),
    applyOptionalFoldBudget: (session, folded) =>
      applyOptionalFoldBudgetView(prepareViewFrom(rt), session, folded),
    resolveImageDataUrl: async (assetId, sessionId) => {
      const asset = rt.store.getImageAsset(assetId);
      if (!asset || asset.sessionId !== sessionId) {
        return undefined;
      }
      await touchImageAccess(rt.store, assetId);
      return imageBufferToDataUrl(rt.store, rt.stateDir, assetId);
    },
    runTurnWithRetries: (input, onStream) => {
      const session = input.sessionId ? rt.store.getSession(input.sessionId) : undefined;
      const route = resolveModelRoute({
        store: rt.store,
        session,
        env: process.env,
        fallbackAdapter: rt.modelAdapter
      });
      const candidates = route.candidates.map((adapter, i) => ({
        adapter,
        label: i === 0 ? 'primary' : `fallback-${i}`
      }));
      if (candidates.length <= 1) {
        const adapter = route.primary ?? (session
          ? resolveSessionModelAdapter(rt.store, session, process.env, rt.modelAdapter)
          : rt.modelAdapter);
        return toolLoopRunTurn(adapter, input, onStream);
      }
      return withProviderFallback(candidates, (adapter) => toolLoopRunTurn(adapter, input, onStream));
    },
    waitSteeringChildrenIdle: (sessionId) => waitSteeringChildrenIdle(sessionId),
    filterValidToolCalls: (toolCalls, allowExternalAiTools, sessionId) =>
      toolLoopFilterValid(toolLoopDepsFrom(rt), toolCalls, allowExternalAiTools, sessionId),
    checkToolApprovals: (validToolCalls, context, filePolicy, session) =>
      toolLoopCheckApprovals(toolLoopDepsFrom(rt), validToolCalls, context, filePolicy, session),
    executeToolCalls: (validToolCalls, context, allowExternalAiTools, sessionId) =>
      toolLoopExecuteCalls(toolLoopDepsFrom(rt), validToolCalls, context, allowExternalAiTools, sessionId),
    processToolResults: (results, validToolCalls, session, task, sessionId, onModelStreamChunk) =>
      toolLoopProcessResults(
        toolLoopDepsFrom(rt),
        results,
        validToolCalls,
        session,
        task,
        sessionId,
        onModelStreamChunk
      ),
    handleTurnCompletion: (session, agent, task) =>
      handleTurnCompletion(sessionCompleteFrom(rt), session, agent, task),
    injectEvolvingCoachBeforeRecovery: (session, agent, trigger, reason) =>
      injectEvolvingCoachBeforeRecovery(sessionCompleteFrom(rt), session, agent, trigger, reason),
    runCaseGovernance: () => {
      runCaseGovernance(rt.store.getAgentCaseStore(), process.env);
    },
    scheduleBackgroundCaseReview: (input) => {
      scheduleBackgroundCaseReview(rt.store, process.env, {
        stateDir: rt.stateDir,
        sessionId: input.sessionId,
        agentId: input.agentId,
        outcome: input.outcome,
        signals: input.signals
      });
    }
  };
}
