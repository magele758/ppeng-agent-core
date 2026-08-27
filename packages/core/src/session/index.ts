/**
 * L1/L2 public barrel: WAL surface + inbox / compact / budget.
 * Import from `@ppeng/agent-core/session`.
 */

export type {
  SessionSurfaceStore,
  SessionSurfaceStoreExt,
  SurfaceReplacementInput,
  SurfaceReplaceInput,
  SurfaceWriteOpts
} from './surface-store.js';
export { createMemorySurfaceStore, MemorySurfaceStore } from './surface-store.js';
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
export {
  applyInboxOverflow,
  parseInboxOverflowCap,
  planInboxOverflow,
  resolveInboxOverflowCap,
  summarizeInboxOverflow,
  DEFAULT_INBOX_OVERFLOW_CAP,
  INBOX_OVERFLOW_KEY,
  INBOX_OVERFLOW_PREFIX,
  SUGGESTED_INBOX_OVERFLOW_CAP
} from './inbox-overflow.js';
export { microCompactMessages, microCompactConfigFromEnv } from './micro-compact.js';
export type { MicroCompactConfig } from './micro-compact.js';
export { resolveHistoryTokenBudget } from './session-budget.js';
export { decideSteerAdmission, steerAckToHttp } from './steer-ack.js';
export type { SteerAck, SteerAckStatus, HttpSteerAck } from './steer-ack.js';
export { runOutcomeFromEnd, parseRunOutcome, mergeOutcomeMetadata } from './run-outcome.js';
export type { RunOutcome, RunOutcomeKind } from './run-outcome.js';
export {
  createWaitingApprovalInterrupt,
  decideInterruptResume,
  parseRunInterrupt,
  mergeInterruptMetadata,
  unmatchedToolCallsFromFold
} from './interrupt.js';
export type { RunInterruptState } from './interrupt.js';
export { assertWriterClaim, WriterClaimError } from './writer-claim.js';
export { closeOpenToolWave } from './tool-wave-close.js';
export {
  drainSteerAtToolLaunch,
  resolveSteerDrainPolicy,
  AGENT_LOOP_SETTINGS_KEY
} from './steer-drain.js';
export type { SteerDrainPolicy } from './steer-drain.js';
