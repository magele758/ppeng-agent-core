/**
 * Pure pre-wave HITL latch (C timing).
 *
 * Call after persist-assistant + `model_done`, then abort, then this latch,
 * then drain/execute. Kernel owns the I/O; this module only ranks signals.
 */

import type { HitlLatchDecision } from '../turn/host.js';

export type HitlApprovalDecision = 'proceed' | 'skip' | 'waiting';

export type HitlLatchAction = 'proceed' | 'waiting' | 'skip' | 'steer' | 'abort';

export interface DecideHitlLatchInput {
  aborted?: boolean;
  approval?: HitlApprovalDecision;
  hostLatch?: HitlLatchDecision;
}

export interface HitlLatchResult {
  action: HitlLatchAction;
  reason?: string;
}

/**
 * Rank C-aligned pre-wave signals:
 * 1. aborted → abort
 * 2. hostLatch === 'steer' → steer (close wave, skip execute)
 * 3. hostLatch === 'waiting' → waiting
 * 4. approval === 'waiting' → waiting
 * 5. approval === 'skip' → skip
 * 6. else proceed
 */
export function decideHitlLatch(input: DecideHitlLatchInput): HitlLatchResult {
  if (input.aborted) {
    return { action: 'abort', reason: 'aborted' };
  }
  if (input.hostLatch === 'steer') {
    return { action: 'steer', reason: 'host_steer' };
  }
  if (input.hostLatch === 'waiting') {
    return { action: 'waiting', reason: 'host_waiting' };
  }
  if (input.approval === 'waiting') {
    return { action: 'waiting', reason: 'approval_waiting' };
  }
  if (input.approval === 'skip') {
    return { action: 'skip', reason: 'approval_skip' };
  }
  return { action: 'proceed' };
}

/** True when the pre-wave latch must not drain/execute tools. */
export function shouldParkBeforeTools(decision: HitlLatchResult): boolean {
  return decision.action !== 'proceed';
}
