/**
 * L1/L2 public barrel: WAL surface + inbox / compact / budget.
 * Import from `@ppeng/agent-core/session`.
 */

export type { SessionSurfaceStore, SurfaceReplacementInput } from './surface-store.js';
export {
  foldSurface,
  foldCanonicalJson,
  unmatchedToolCallIds,
  isToolWaveOpen,
  parseSurfaceOp,
  shadowedSeqs,
  surfaceNodeToMessage,
  assertSeqStrictlyIncreasing,
  assertReplaceRangeCovered,
  assertReplaceRangeClosed,
  assertNoOpenToolWaveForCompact,
  SurfaceInvariantError
} from './surface-invariants.js';
export type { SurfaceOp, SurfaceNode } from './surface-invariants.js';
export { runAutoCompact, isContextOverflowError, COMPACT_KEEP_RECENT } from './auto-compact.js';
export type { AutoCompactStore, AutoCompactResult } from './auto-compact.js';
export { StepInboxStore } from './step-inbox.js';
export type { InboxItem, InboxTarget, InboxRole, EnqueueSteerOptions } from './step-inbox.js';
export { microCompactMessages, microCompactConfigFromEnv } from './micro-compact.js';
export type { MicroCompactConfig } from './micro-compact.js';
export { resolveHistoryTokenBudget } from './session-budget.js';
