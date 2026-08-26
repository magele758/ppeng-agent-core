/**
 * Single terminal RunOutcome for an L4 loop (A8).
 *
 * Session.status remains the L5/HTTP projection for a quarter; hosts should
 * read `outcome` from the ended event or session.metadata.outcome.
 */

export type RunOutcomeKind = 'completed' | 'idle' | 'waiting_approval' | 'failed' | 'aborted';

export type FailureStage = 'model' | 'tool' | 'approval' | 'recovery' | 'host';

export interface RunOutcome {
  kind: RunOutcomeKind;
  reason: string;
  failureStage?: FailureStage;
}

export const RUN_OUTCOME_METADATA_KEY = 'outcome';

export function buildRunOutcome(input: {
  kind: RunOutcomeKind;
  reason: string;
  failureStage?: FailureStage;
}): RunOutcome {
  const outcome: RunOutcome = { kind: input.kind, reason: input.reason };
  if (input.failureStage) outcome.failureStage = input.failureStage;
  return outcome;
}

/** Map an L4 end reason + resulting session status onto a single outcome. */
export function runOutcomeFromEnd(input: {
  reason: string;
  sessionStatus: string;
  failureStage?: FailureStage;
}): RunOutcome {
  const reason = input.reason;
  if (reason === 'abort' || reason === 'closed' || reason === 'user_abort') {
    return buildRunOutcome({
      kind: 'aborted',
      reason,
      failureStage: input.failureStage ?? 'host'
    });
  }
  if (reason === 'waiting_approval') {
    return buildRunOutcome({
      kind: 'waiting_approval',
      reason,
      failureStage: input.failureStage ?? 'approval'
    });
  }
  if (
    reason === 'empty_assistant' ||
    reason === 'empty_tool_calls' ||
    reason === 'truncated_tool_call' ||
    reason === 'content_filter' ||
    reason === 'repetition' ||
    reason === 'reasoning_spin' ||
    reason === 'loop_guard_critical'
  ) {
    return buildRunOutcome({
      kind: input.sessionStatus === 'failed' ? 'failed' : 'idle',
      reason,
      failureStage: input.failureStage ?? 'recovery'
    });
  }
  if (reason === 'tool_loop' || reason === 'missing_assistant') {
    return buildRunOutcome({
      kind: input.sessionStatus === 'failed' ? 'failed' : 'idle',
      reason,
      failureStage: input.failureStage ?? (reason === 'tool_loop' ? 'tool' : 'model')
    });
  }
  if (reason === 'before_turn_blocked') {
    return buildRunOutcome({
      kind: 'failed',
      reason,
      failureStage: input.failureStage ?? 'host'
    });
  }
  if (input.sessionStatus === 'failed') {
    return buildRunOutcome({
      kind: 'failed',
      reason,
      failureStage: input.failureStage ?? 'model'
    });
  }
  if (input.sessionStatus === 'completed') {
    return buildRunOutcome({ kind: 'completed', reason });
  }
  if (input.sessionStatus === 'waiting_approval') {
    return buildRunOutcome({
      kind: 'waiting_approval',
      reason,
      failureStage: input.failureStage ?? 'approval'
    });
  }
  return buildRunOutcome({ kind: 'idle', reason });
}

export function parseRunOutcome(raw: unknown): RunOutcome | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;
  if (
    kind !== 'completed' &&
    kind !== 'idle' &&
    kind !== 'waiting_approval' &&
    kind !== 'failed' &&
    kind !== 'aborted'
  ) {
    return undefined;
  }
  const reason = typeof obj.reason === 'string' ? obj.reason : 'unknown';
  const failureStage = parseFailureStage(obj.failureStage);
  return buildRunOutcome({ kind, reason, failureStage });
}

function parseFailureStage(raw: unknown): FailureStage | undefined {
  if (raw === 'model' || raw === 'tool' || raw === 'approval' || raw === 'recovery' || raw === 'host') {
    return raw;
  }
  return undefined;
}

export function mergeOutcomeMetadata(
  metadata: Record<string, unknown>,
  outcome: RunOutcome
): Record<string, unknown> {
  return { ...metadata, [RUN_OUTCOME_METADATA_KEY]: outcome };
}
