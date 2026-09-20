/**
 * Portable step-transaction helpers for the session layer.
 * Host types stay in turn/host; this module re-exports them and adds
 * pure decision helpers plus an in-memory KernelStepTx.
 */

import type { KernelStepInfo, KernelStepKind, KernelStepTx } from '../turn/host.js';

export type { KernelStepInfo, KernelStepKind, KernelStepTx };

/** End-of-turn flags used by rollback / end-reason helpers (not SDK TurnResult). */
export type StepTxEndInput = {
  aborted?: boolean;
  runError?: string;
  repetitionAborted?: boolean;
  recoveredFromModelBehavior?: boolean;
  userStopped?: boolean;
  streamInterrupted?: boolean;
  steeringInterrupted?: boolean;
  maxTurnsExceeded?: boolean;
};

export type MemoryStepTxOpts = {
  onBegin?: (info: KernelStepInfo) => void;
  onCommit?: (info: KernelStepInfo) => void;
  onRollback?: (reason: string) => void;
};

/**
 * Which TurnResult-shaped flags need an uncommitted rewind.
 * runError / repetitionAborted → reason; everything else is null.
 */
export function rollbackReasonOf(input: StepTxEndInput): string | null {
  if (input.runError) return `run-error: ${input.runError}`;
  if (input.repetitionAborted) return 'repetition-aborted: unknown';
  return null;
}

/** Fold orthogonal end flags into one audit reason. */
export function turnEndReasonOf(input: StepTxEndInput): string {
  if (input.userStopped || input.aborted) return 'user-stopped';
  if (input.maxTurnsExceeded) return 'segment-exhausted';
  if (input.steeringInterrupted) return 'steering-interrupted';
  if (input.streamInterrupted) return 'stream-interrupted';
  if (input.recoveredFromModelBehavior) return 'protocol-recovered';
  return 'completed';
}

/**
 * Uncommitted-tail rewind anchor: last `step/end` after turnStartSeq,
 * otherwise turnStartSeq itself.
 */
export function uncommittedRewindAnchorSeq(
  events: Array<{ seq: number; type: string }>,
  turnStartSeq: number
): number {
  let last: number | null = null;
  for (const e of events) {
    if (e.seq <= turnStartSeq) continue;
    if (e.type === 'step/end') last = e.seq;
  }
  return last ?? turnStartSeq;
}

/** In-memory open/closed tracker. Persist via callbacks if the host wants it. */
export function createMemoryStepTx(opts?: MemoryStepTxOpts): KernelStepTx {
  const tracker: { open: boolean; lastInfo?: KernelStepInfo } = { open: false };

  return {
    beginStep(info) {
      tracker.open = true;
      tracker.lastInfo = info;
      opts?.onBegin?.(info);
    },
    commitStep(info) {
      tracker.open = false;
      tracker.lastInfo = info;
      opts?.onCommit?.(info);
    },
    rollbackUncommitted(reason) {
      tracker.open = false;
      opts?.onRollback?.(reason);
    },
  };
}

/**
 * begin → fn → commit. Missing tx or missing methods are no-ops.
 * On throw: rollbackUncommitted(err.message) then rethrow.
 */
export async function wrapWithStepTx<T>(
  tx: KernelStepTx | undefined,
  info: KernelStepInfo,
  fn: () => Promise<T>
): Promise<T> {
  if (!tx) return fn();
  await tx.beginStep?.(info);
  try {
    const result = await fn();
    await tx.commitStep?.(info);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await tx.rollbackUncommitted?.(message);
    throw err;
  }
}
