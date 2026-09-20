/**
 * Recovery module exports
 */

export { recoveryPolicyEnabled, SessionLoopGuard } from './session-loop-guard.js';
export type { LoopGuardToolCall } from './session-loop-guard.js';

export { findSimilarToolName } from './find-similar-tool-name.js';

export {
  AdvisoryGrace,
  advisoryGraceEnabled,
  advisoryGraceBudget,
  formatRecoveryAdvisory,
} from './advisory-grace.js';
export type { GuardDecision, GraceOutcome } from './advisory-grace.js';

export { AdvisoryQueue } from './advisory-queue.js';
export type { AdvisoryDraft } from './advisory-queue.js';

export {
  RiskEngine,
  formatRiskAdvisory,
  DEFAULT_RISK_CONFIG,
  riskEngineEnabled,
  riskEngineConfigFromEnv,
} from './risk-engine.js';
export type {
  RiskEngineConfig,
  RiskSignalType,
  RiskSnapshot,
  RiskTickResult,
} from './risk-engine.js';

export { buildUnknownToolResultContent } from './unknown-tool-result.js';
export type { UnknownToolResultPayload } from './unknown-tool-result.js';

export {
  UNPAIRED_TOOL_RESULT_CONTENT,
  unmatchedToolCallsFromMessages,
  syntheticUnpairedToolResultParts,
  pairUnmatchedToolCalls,
  ensureFoldToolCallsPaired,
} from './pair-unmatched-tool-calls.js';
export type {
  UnmatchedToolCall,
  FoldPairableStore,
  PairUnmatchedToolCallsResult,
} from './pair-unmatched-tool-calls.js';

export {
  isToolAvailabilityError,
  buildSyntheticBehaviorResult,
  recoverFromModelBehavior,
} from './model-behavior-recovery.js';
export type {
  PendingToolCall,
  SyntheticBehaviorResult,
  RecoverFromModelBehaviorInput,
  RecoverFromModelBehaviorResult,
} from './model-behavior-recovery.js';

export { AUTO_FORK_USED_KEY, decideAutoFork, isAutoForkUsed } from './auto-fork.js';
export type { AutoForkTrigger, AutoForkCheckpoint, AutoForkDecision } from './auto-fork.js';
