/**
 * Tool-loop helpers extracted from RawAgentRuntime (filter → approve → execute → persist).
 */

import {
  contextHasApprovalPolicy,
  policyRequiresApproval,
  policySkipsAutoApproval,
  type ApprovalPolicy
} from '../approval/approval-policy.js';
import {
  filePolicyRequiresBashApproval,
  filePolicyRequiresPathApproval,
  type FileApprovalPolicy
} from '../approval/policy-loader.js';
import {
  applyPermissionModeGate,
  resolvePermissionMode
} from '../approval/permission-mode.js';
import {
  lifecycleBlocks,
  lifecycleForcesApproval,
  runLifecycleHook
} from '../hooks/lifecycle-hooks.js';
import { toolInfraProblem } from '../model/tool-result-problem.js';
import { maybeExportOtelSpan } from '../otel.js';
import { envBool, envInt } from '../env.js';
import { buildUnknownToolResultContent } from '../recovery/unknown-tool-result.js';
import {
  isRepetitionAbort,
  loadRepetitionWatchdogConfig,
  RepetitionLoopAbortError,
  repetitionWatchdogEnabled,
  RepetitionStreamGuard
} from '../streaming/repetition-watchdog.js';
import { redactToolContent } from '../sandbox/result-redaction.js';
import {
  envToolResultMaxChars,
  findToolByName,
  partitionForParallel,
  truncateToolContent
} from '../tools/tool-orchestration.js';
import { maybeArchiveToolResult } from '../artifact/archive-tool-result.js';
import type { IngestionSettingsStore } from '../ingestion/settings.js';
import type { PagedArtifactManifest } from '../artifact/paged-artifact.js';
import type {
  ApprovalRecord,
  ApprovalStatus,
  HttpProblemDetails,
  MessagePart,
  ModelAdapter,
  ModelStreamChunk,
  ModelTurnInput,
  ModelTurnResult,
  RunContext,
  SessionRecord,
  TaskArtifact,
  TaskRecord,
  ToolContract
} from '../types.js';
import { extractInputString, stableJsonHash } from './helpers.js';
import {
  compensateCompletedLifo,
  createCompensationTx,
  runWithCompensation,
  type CompletedWaveItem
} from '../session/compensation.js';
import {
  getBoundSecretVault,
  parseSecretRefs,
  runWithSecretRefs
} from '../secrets/secret-vault.js';

type ToolCallPart = Extract<MessagePart, { type: 'tool_call' }>;

export type ToolExecResult = {
  toolCallId: string;
  name: string;
  ok: boolean;
  content: string;
  isExternal?: boolean;
  artifacts?: TaskArtifact[];
  metadata?: Record<string, unknown>;
  problem?: HttpProblemDetails;
};

export interface ToolLoopStore {
  appendMessage: (sessionId: string, role: 'tool' | 'user' | 'assistant' | 'system', parts: MessagePart[]) => unknown;
  listApprovals: (filter?: { status?: ApprovalStatus }) => ApprovalRecord[];
  createApproval: (input: {
    sessionId: string;
    toolName: string;
    reason: string;
    args: Record<string, unknown>;
    idempotencyKey?: string;
  }) => ApprovalRecord;
  deleteApproval: (id: string) => void;
  getTask: (taskId: string) => TaskRecord | undefined;
  updateTask: (taskId: string, patch: { artifacts: TaskArtifact[] }) => unknown;
}

export interface ToolLoopDeps {
  tools: ToolContract<any>[];
  store: ToolLoopStore;
  envApprovalPolicy: ApprovalPolicy | undefined;
  maxParallelToolCalls: number;
  modelAdapter: ModelAdapter;
  stateDir: string;
  emitTrace: (sessionId: string, event: { kind: string; payload?: Record<string, unknown> }) => void;
  /** Optional in-process after_tool extension hook */
  runAfterToolExtension?: (ctx: {
    sessionId: string;
    tool: string;
    input?: unknown;
    ok: boolean;
    content: string;
  }) => Promise<{ systemMessage?: string } | void>;
  /**
   * Optional CBOM schema-pin checker (Capability Discovery).
   * Return ok:false to block execution before tool.execute.
   */
  checkCapabilityPin?: (toolName: string, inputSchema: unknown) => {
    ok: boolean;
    reason?: string;
    expected?: string;
    actual?: string;
  };
  settingsStore?: IngestionSettingsStore;
  onArtifactCreated?: (manifest: PagedArtifactManifest) => void;
}

export function filterValidToolCalls(
  deps: ToolLoopDeps,
  toolCalls: ToolCallPart[],
  allowExternalAiTools: boolean,
  sessionId: string
): ToolCallPart[] {
  const valid: ToolCallPart[] = [];
  for (const tc of toolCalls) {
    const t = findToolByName(deps.tools, tc.name);
    if (t?.isExternal && !allowExternalAiTools) {
      deps.store.appendMessage(sessionId, 'tool', [
        {
          type: 'tool_result',
          toolCallId: tc.toolCallId,
          name: tc.name,
          ok: false,
          content: `Tool ${tc.name} is not available in this session`,
          problem: toolInfraProblem(
            tc.name,
            tc.toolCallId,
            'TOOL_DISABLED_IN_SESSION',
            `Tool ${tc.name} is not enabled for this session (external AI tools gate).`,
            { title: 'Tool not available in session', status: 403 }
          )
        }
      ]);
    } else {
      valid.push(tc);
    }
  }
  return valid;
}

export function checkToolApprovals(
  deps: ToolLoopDeps,
  validToolCalls: ToolCallPart[],
  context: RunContext,
  filePolicy: FileApprovalPolicy | undefined,
  session: SessionRecord
): 'waiting' | 'skip' | 'proceed' {
  const policy = deps.envApprovalPolicy ?? contextHasApprovalPolicy(context);
  const sid = session.id;
  const permissionMode = resolvePermissionMode(session.metadata, process.env);

  const needsApproval = (tool: ToolContract<any>, toolCall: ToolCallPart) => {
    const modeGate = applyPermissionModeGate(permissionMode, tool.name, tool.approvalMode);
    if (modeGate?.action === 'deny') return false;
    if (modeGate?.action === 'require_approval') return true;
    if (modeGate?.action === 'proceed' && permissionMode === 'bypass') return false;
    if (modeGate?.action === 'proceed' && permissionMode === 'acceptEdits') return false;

    if (policyRequiresApproval(policy, tool.name)) return true;
    if (filePolicy) {
      if (tool.name === 'bash') {
        const cmd = extractInputString(toolCall.input, 'command');
        if (filePolicyRequiresBashApproval(filePolicy, cmd)) return true;
      }
      if (tool.name === 'write_file' || tool.name === 'edit_file') {
        const p = extractInputString(toolCall.input, 'path');
        if (filePolicyRequiresPathApproval(filePolicy, tool.name, p)) return true;
      }
    }
    if (policy?.defaultRisky && tool.approvalMode === 'auto') return true;
    if (tool.approvalMode === 'always') return true;
    if (policySkipsAutoApproval(policy, tool.name)) return false;
    return tool.approvalMode === 'auto' && tool.needsApproval?.(context, toolCall.input) === true;
  };

  for (const tc of validToolCalls) {
    const tool = findToolByName(deps.tools, tc.name);
    if (!tool) continue;
    const modeGate = applyPermissionModeGate(permissionMode, tool.name, tool.approvalMode);
    if (modeGate?.action === 'deny') {
      const detail = `${modeGate.reason}\nremediation: ${modeGate.remediation}`;
      deps.store.appendMessage(sid, 'tool', [
        {
          type: 'tool_result',
          toolCallId: tc.toolCallId,
          name: tc.name,
          ok: false,
          content: detail,
          problem: toolInfraProblem(tc.name, tc.toolCallId, modeGate.code, detail, {
            title: 'Blocked by permission mode',
            status: 403
          })
        }
      ]);
      return 'skip';
    }
  }

  const pendingApproval = validToolCalls.find((tc) => {
    const t = findToolByName(deps.tools, tc.name);
    return t ? needsApproval(t, tc) : false;
  });

  if (!pendingApproval) return 'proceed';

  const tool = findToolByName(deps.tools, pendingApproval.name);
  if (!tool) {
    deps.store.appendMessage(sid, 'tool', [
      {
        type: 'tool_result',
        toolCallId: pendingApproval.toolCallId,
        name: pendingApproval.name,
        ok: false,
        content: `Unknown tool ${pendingApproval.name}`,
        problem: toolInfraProblem(
          pendingApproval.name,
          pendingApproval.toolCallId,
          'UNKNOWN_TOOL',
          `No tool definition matches name ${pendingApproval.name}.`,
          { title: 'Unknown tool', status: 404 }
        )
      }
    ]);
    return 'skip';
  }

  const idemKey =
    tool.approvalMode !== 'never' ? stableJsonHash(tool.name, pendingApproval.input) : undefined;
  const existingApproved = idemKey
    ? deps.store
        .listApprovals({ status: 'approved' })
        .find((a) => a.sessionId === sid && a.idempotencyKey === idemKey)
    : undefined;

  if (!existingApproved) {
    deps.store.createApproval({
      sessionId: sid,
      toolName: tool.name,
      reason: `Approval required for ${tool.name} (permissionMode=${permissionMode})`,
      args: pendingApproval.input,
      idempotencyKey: idemKey
    });
    return 'waiting';
  }
  return 'proceed';
}

export async function executeSingleTool(
  deps: ToolLoopDeps,
  toolCall: ToolCallPart,
  context: RunContext,
  allowExternalAiTools: boolean,
  sessionId: string,
  completed?: CompletedWaveItem[]
): Promise<ToolExecResult> {
  const tool = findToolByName(deps.tools, toolCall.name);
  if (!tool) {
    const available = deps.tools.map((t) => t.name);
    const content = buildUnknownToolResultContent(toolCall.name, available);
    return {
      toolCallId: toolCall.toolCallId,
      name: toolCall.name,
      ok: false,
      content,
      artifacts: undefined,
      problem: toolInfraProblem(
        toolCall.name,
        toolCall.toolCallId,
        'UNKNOWN_TOOL',
        `No tool definition matches name ${toolCall.name}.`,
        { title: 'Unknown tool', status: 404 }
      )
    };
  }
  if (tool.isExternal && !allowExternalAiTools) {
    return {
      toolCallId: toolCall.toolCallId,
      name: tool.name,
      ok: false,
      content: `Tool ${tool.name} is not available in this session`,
      isExternal: true,
      artifacts: undefined,
      problem: toolInfraProblem(
        tool.name,
        toolCall.toolCallId,
        'TOOL_DISABLED_IN_SESSION',
        `Tool ${tool.name} is not enabled for this session.`,
        { title: 'Tool not available in session', status: 403 }
      )
    };
  }

  // Capability Discovery CBOM pin — block rug-pull before execute.
  if (deps.checkCapabilityPin) {
    const pin = deps.checkCapabilityPin(tool.name, tool.inputSchema ?? {});
    if (!pin.ok) {
      deps.emitTrace(sessionId, {
        kind: 'capability_pin_fail',
        payload: {
          tool: tool.name,
          reason: pin.reason,
          expected: pin.expected,
          actual: pin.actual
        }
      });
      return {
        toolCallId: toolCall.toolCallId,
        name: tool.name,
        ok: false,
        content: JSON.stringify({
          error: 'schema_pin_mismatch',
          reason: pin.reason ?? 'CBOM schema pin failed',
          expected: pin.expected,
          actual: pin.actual
        }),
        artifacts: undefined,
        problem: toolInfraProblem(
          tool.name,
          toolCall.toolCallId,
          'SCHEMA_PIN_MISMATCH',
          pin.reason ?? 'CBOM schema pin failed',
          { title: 'Schema pin mismatch', status: 409 }
        )
      };
    }
  }

  deps.emitTrace(sessionId, { kind: 'tool_start', payload: { name: tool.name } });

  const pre = await runLifecycleHook(process.env, {
    phase: 'pre_tool_use',
    tool: tool.name,
    sessionId,
    input: toolCall.input
  });
  if (lifecycleBlocks(pre)) {
    return {
      toolCallId: toolCall.toolCallId,
      name: tool.name,
      ok: false,
      content: pre.message ?? pre.systemMessage ?? 'blocked by pre_tool_use hook',
      artifacts: undefined,
      problem: toolInfraProblem(
        tool.name,
        toolCall.toolCallId,
        'PRE_TOOL_USE_BLOCKED',
        pre.message ?? 'blocked by pre_tool_use hook',
        { title: 'Tool blocked by hook', status: 403 }
      )
    };
  }
  if (lifecycleForcesApproval(pre)) {
    const idemKey = stableJsonHash(tool.name, toolCall.input);
    const existingApproved = deps.store
      .listApprovals({ status: 'approved' })
      .find((a) => a.sessionId === sessionId && a.idempotencyKey === idemKey);
    if (!existingApproved) {
      deps.store.createApproval({
        sessionId,
        toolName: tool.name,
        reason: pre.message ?? `Hook asked for approval on ${tool.name}`,
        args: toolCall.input as Record<string, unknown>,
        idempotencyKey: idemKey
      });
      return {
        toolCallId: toolCall.toolCallId,
        name: tool.name,
        ok: false,
        content: 'waiting for approval (hook permissionDecision=ask)',
        artifacts: undefined,
        problem: toolInfraProblem(
          tool.name,
          toolCall.toolCallId,
          'HOOK_ASK_APPROVAL',
          'Hook requested human approval',
          { title: 'Approval required by hook', status: 403 }
        )
      };
    }
  }

  const execInput = pre.input !== undefined ? pre.input : toolCall.input;
  let snapshot: unknown;
  if (tool.captureSnapshot) {
    try {
      snapshot = await tool.captureSnapshot(context, execInput as Record<string, unknown>);
    } catch {
      snapshot = undefined;
    }
  }
  try {
    let result = await tool.execute(context, execInput);
    if (completed) {
      completed.push({
        tool,
        toolCallId: toolCall.toolCallId,
        args: (execInput ?? {}) as Record<string, unknown>,
        snapshot,
        context
      });
    }
    const maxChars = envToolResultMaxChars(process.env);
    // Shell-like tools may echo secrets from the child env; scrub before truncate/persist.
    const shellLike =
      tool.name === 'bash' || tool.name === 'bg_run' || tool.name === 'bg_check' || tool.name === 'work_evidence';
    const scrubbed = shellLike ? redactToolContent(result.content, process.env) : result.content;
    const archived = maybeArchiveToolResult({
      stateDir: deps.stateDir,
      sessionId,
      toolName: tool.name,
      content: scrubbed,
      settingsStore: deps.settingsStore,
      onCreated: deps.onArtifactCreated
    });
    result = {
      ...result,
      content: archived === scrubbed ? truncateToolContent(scrubbed, maxChars) : archived
    };
    void maybeExportOtelSpan(process.env, deps.stateDir, sessionId, `tool.${tool.name}`, {
      ok: String(result.ok)
    });
    await runLifecycleHook(process.env, {
      phase: 'post_tool_use',
      tool: tool.name,
      sessionId,
      input: execInput,
      ok: result.ok,
      content: result.content
    });
    if (deps.runAfterToolExtension) {
      const ext = await deps.runAfterToolExtension({
        sessionId,
        tool: tool.name,
        input: execInput,
        ok: result.ok,
        content: result.content
      });
      if (ext?.systemMessage) {
        deps.store.appendMessage(sessionId, 'system', [
          { type: 'text', text: ext.systemMessage }
        ]);
      }
    }
    return {
      toolCallId: toolCall.toolCallId,
      name: tool.name,
      ok: result.ok,
      content: result.content,
      isExternal: tool.isExternal,
      artifacts: result.artifacts,
      metadata: result.metadata
    };
  } catch (error) {
    if (completed) {
      completed.push({
        tool,
        toolCallId: toolCall.toolCallId,
        args: (execInput ?? {}) as Record<string, unknown>,
        snapshot,
        context
      });
    }
    const content = error instanceof Error ? error.message : String(error);
    await runLifecycleHook(process.env, {
      phase: 'post_tool_use',
      tool: tool.name,
      sessionId,
      input: execInput,
      ok: false,
      content
    });
    return {
      toolCallId: toolCall.toolCallId,
      name: tool.name,
      ok: false,
      content,
      isExternal: tool.isExternal,
      artifacts: undefined,
      problem: toolInfraProblem(tool.name, toolCall.toolCallId, 'TOOL_UNHANDLED_EXCEPTION', content, {
        title: 'Tool raised an exception',
        status: 500
      })
    };
  }
}

export async function executeToolCalls(
  deps: ToolLoopDeps,
  validToolCalls: ToolCallPart[],
  context: RunContext,
  allowExternalAiTools: boolean,
  sessionId: string
): Promise<ToolExecResult[]> {
  const vault = getBoundSecretVault();
  const secretValues = vault ? vault.resolveNamed(parseSecretRefs(context.session.metadata)) : {};
  const tx = createCompensationTx();
  const completed: CompletedWaveItem[] = [];
  const run = async () => {
    const results: ToolExecResult[] = [];
    for (const chunk of partitionForParallel(validToolCalls, deps.maxParallelToolCalls)) {
      const chunkResults = await Promise.all(
        chunk.map((tc) =>
          executeSingleTool(deps, tc, context, allowExternalAiTools, sessionId, completed)
        )
      );
      results.push(...chunkResults);
    }
    if (results.some((r) => !r.ok) || context.abortSignal?.aborted) {
      await compensateCompletedLifo(completed);
    }
    return results;
  };
  return runWithSecretRefs(secretValues, () => runWithCompensation(tx, run));
}

export function processToolResults(
  deps: ToolLoopDeps,
  results: ToolExecResult[],
  validToolCalls: ToolCallPart[],
  session: SessionRecord,
  task: TaskRecord | undefined,
  sessionId: string,
  onModelStreamChunk?: (chunk: ModelStreamChunk) => void
): void {
  for (const r of results) {
    const parts: MessagePart[] = [
      {
        type: 'tool_result',
        toolCallId: r.toolCallId,
        name: r.name,
        ok: r.ok,
        content: r.content,
        isExternal: r.isExternal,
        ...(r.problem ? { problem: r.problem } : {})
      }
    ];

    const a2uiMessages = Array.isArray(r.metadata?.a2uiMessages)
      ? (r.metadata!.a2uiMessages as unknown[])
      : undefined;
    if (a2uiMessages && a2uiMessages.length > 0) {
      const surfaceId =
        typeof r.metadata?.a2uiSurfaceId === 'string' ? (r.metadata!.a2uiSurfaceId as string) : '';
      const catalogId =
        typeof r.metadata?.a2uiCatalogId === 'string' ? (r.metadata!.a2uiCatalogId as string) : '';
      if (surfaceId) {
        parts.push({
          type: 'surface_update',
          surfaceId,
          catalogId,
          messages: a2uiMessages
        });
        if (onModelStreamChunk) {
          for (const env of a2uiMessages) {
            try {
              onModelStreamChunk({ type: 'a2ui_message', surfaceId, envelope: env });
            } catch {
              // best-effort
            }
          }
        }
      }
    }

    deps.store.appendMessage(session.id, 'tool', parts);
    if (r.isExternal) {
      const idemKey = stableJsonHash(
        r.name,
        validToolCalls.find((tc) => tc.toolCallId === r.toolCallId)?.input ?? {}
      );
      if (idemKey) {
        const matchingApproval = deps.store
          .listApprovals({ status: 'approved' })
          .find((a) => a.sessionId === sessionId && a.idempotencyKey === idemKey);
        if (matchingApproval) deps.store.deleteApproval(matchingApproval.id);
      }
    }
    if (task && r.artifacts?.length) {
      const latestTask = deps.store.getTask(task.id) as TaskRecord;
      deps.store.updateTask(task.id, { artifacts: [...latestTask.artifacts, ...r.artifacts] });
    }
    deps.emitTrace(sessionId, { kind: 'tool_end', payload: { name: r.name, ok: r.ok } });
  }
}

export async function runTurnWithRetries(
  modelAdapter: ModelAdapter,
  input: ModelTurnInput & { signal?: AbortSignal },
  onStream?: (chunk: ModelStreamChunk) => void
): Promise<ModelTurnResult> {
  const maxRetries = envInt(process.env, 'RAW_AGENT_MODEL_MAX_RETRIES', 2);
  const { signal, ...turnInput } = input;
  const useStream =
    Boolean(onStream) &&
    typeof modelAdapter.runTurnStream === 'function' &&
    envBool(process.env, 'RAW_AGENT_STREAM', true);
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal?.aborted) {
      throw new Error('Session aborted');
    }
    try {
      if (useStream && onStream) {
        return await runStreamTurnWithRepetitionGuard(modelAdapter, turnInput, signal, onStream);
      }
      return await modelAdapter.runTurn({ ...turnInput, signal });
    } catch (error) {
      lastError = error;
      // A degenerate-repetition abort is a model-behaviour verdict, not a
      // transport blip: retrying re-sends the whole prompt to get the same
      // garbage. Surface it so the runtime can retry once, cleanly.
      if (isRepetitionAbort(error) || attempt === maxRetries) {
        break;
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Run one streaming turn with an intra-turn repetition guard.
 *
 * The guard watches accumulated text and reasoning deltas; on a hit it aborts the
 * underlying HTTP stream (so the provider stops billing tokens immediately) and
 * throws {@link RepetitionLoopAbortError}. Wiring it here rather than in each
 * adapter keeps chat-completions, Responses, and the hybrid router covered by
 * one code path — every adapter already honours `input.signal`.
 */
async function runStreamTurnWithRepetitionGuard(
  modelAdapter: ModelAdapter,
  turnInput: ModelTurnInput,
  signal: AbortSignal | undefined,
  onStream: (chunk: ModelStreamChunk) => void
): Promise<ModelTurnResult> {
  if (!repetitionWatchdogEnabled(process.env)) {
    return modelAdapter.runTurnStream!({ ...turnInput, signal }, onStream);
  }

  const config = loadRepetitionWatchdogConfig(process.env);
  const textGuard = new RepetitionStreamGuard(config);
  const reasoningGuard = new RepetitionStreamGuard(config);
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onOuterAbort, { once: true });
  let abortReason: string | undefined;

  const guardedStream = (chunk: ModelStreamChunk) => {
    if (!abortReason) {
      const hit =
        chunk.type === 'text_delta'
          ? textGuard.push(chunk.text)
          : chunk.type === 'reasoning_delta'
            ? reasoningGuard.push(chunk.text)
            : null;
      if (hit) {
        abortReason = hit;
        controller.abort();
        // Swallow this chunk: the tail is the degenerate run itself.
        return;
      }
    }
    if (abortReason) return;
    onStream(chunk);
  };

  try {
    return await modelAdapter.runTurnStream!({ ...turnInput, signal: controller.signal }, guardedStream);
  } catch (error) {
    if (abortReason) {
      throw new RepetitionLoopAbortError(abortReason);
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', onOuterAbort);
  }
}
