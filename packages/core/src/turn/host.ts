/**
 * L3 kernel host: L5 RawAgentRuntime is one implementation.
 * Kernel must not import daemon or web-console.
 */

import type { FileApprovalPolicy } from '../approval/policy-loader.js';
import type { ExtensionRegistry } from '../extensions/extension-registry.js';
import type { PromptBuilder } from '../model/prompt-builder.js';
import type { AgentLoopLatch, AgentStepEvent } from '../runtime/agent-loop.js';
import type { ToolExecResult } from '../runtime/tool-loop.js';
import type { SessionSurfaceStore } from '../session/surface-store.js';
import type { TraceEvent } from '../stores/trace.js';
import type {
  AgentSpec,
  ApprovalRecord,
  ImageAssetRecord,
  MessagePart,
  ModelAdapter,
  ModelStreamChunk,
  ModelTurnInput,
  ModelTurnResult,
  RunContext,
  SessionMessage,
  SessionRecord,
  TaskRecord,
  ToolContract
} from '../types.js';

export type ToolCallPart = Extract<MessagePart, { type: 'tool_call' }>;

export interface TurnKernelStore extends SessionSurfaceStore {
  getAgent(id: string): AgentSpec | undefined;
  getTask(id: string): TaskRecord | undefined;
  updateSession(
    id: string,
    patch: Partial<Omit<SessionRecord, 'id' | 'createdAt'>>
  ): SessionRecord;
  getImageAsset(id: string): ImageAssetRecord | undefined;
  claimWriter(sessionId: string, runId: string): void;
  releaseWriter(sessionId: string, runId: string): void;
  listApprovals(filter?: { status?: ApprovalRecord['status'] }): ApprovalRecord[];
  getDaemonControl?(key: string): unknown;
}

export interface TurnKernelHost {
  store: TurnKernelStore;
  repoRoot: string;
  stateDir: string;
  tools: ToolContract<any>[];
  modelAdapter: ModelAdapter;
  promptBuilder: PromptBuilder;
  mcpManager: { ensureLoaded(sessionId: string): Promise<void> };
  extensionRegistry: ExtensionRegistry;
  maxTurnsPerRun: number;
  turnShapeBySession: Map<string, { systemPromptChars: number; toolCount: number }>;
  cumulativeInputTokensBySession: Map<string, { cumulative: number; sticky: boolean }>;
  sessionAbortControllers: Map<string, AbortController>;

  emitTrace(sessionId: string, event: Omit<TraceEvent, 'ts' | 'sessionId'>): void;
  mergeSessionMetadata(sessionId: string, patch: Record<string, unknown>): SessionRecord;
  ensureWorkspaceRoot(session: SessionRecord, task?: TaskRecord): Promise<string | undefined>;
  ingestMailbox(session: SessionRecord): Promise<void>;
  autoClaimTask(session: SessionRecord): Promise<void>;
  mergedFilePolicy(): Promise<FileApprovalPolicy | undefined>;
  autoCompact(
    context: RunContext,
    opts?: { force?: boolean }
  ): Promise<{ replaced?: { startSeq: number; endSeq: number } }>;
  prepareMessagesForModel(session: SessionRecord, messages: SessionMessage[]): Promise<SessionMessage[]>;
  applyOptionalFoldBudget(session: SessionRecord, folded: SessionMessage[]): SessionMessage[];
  resolveImageDataUrl(assetId: string, sessionId: string): Promise<string | undefined>;
  runTurnWithRetries(
    input: ModelTurnInput & { signal?: AbortSignal },
    onStream?: (chunk: ModelStreamChunk) => void
  ): Promise<ModelTurnResult>;
  filterValidToolCalls(
    toolCalls: ToolCallPart[],
    allowExternalAiTools: boolean,
    sessionId: string
  ): ToolCallPart[];
  checkToolApprovals(
    validToolCalls: ToolCallPart[],
    context: RunContext,
    filePolicy: FileApprovalPolicy | undefined,
    session: SessionRecord
  ): 'waiting' | 'skip' | 'proceed';
  executeToolCalls(
    validToolCalls: ToolCallPart[],
    context: RunContext,
    allowExternalAiTools: boolean,
    sessionId: string
  ): Promise<ToolExecResult[]>;
  processToolResults(
    results: ToolExecResult[],
    validToolCalls: ToolCallPart[],
    session: SessionRecord,
    task: TaskRecord | undefined,
    sessionId: string,
    onModelStreamChunk?: (chunk: ModelStreamChunk) => void
  ): void;
  handleTurnCompletion(
    session: SessionRecord,
    agent: { id: string },
    task?: TaskRecord
  ): Promise<SessionRecord>;
  injectEvolvingCoachBeforeRecovery(
    session: SessionRecord,
    agent: { id: string },
    trigger: string,
    reason: string
  ): Promise<void>;
  runCaseGovernance(): void;
  scheduleBackgroundCaseReview(input: {
    sessionId: string;
    agentId: string;
    outcome: 'success' | 'failure' | 'partial';
    signals?: Record<string, unknown>;
  }): void;
}

export type { AgentLoopLatch, AgentStepEvent };
