/**
 * L3 public barrel: turn kernel, packing, recovery, tool dispatch.
 * Import from `@ppeng/agent-core/turn`.
 *
 * `runTurnKernel` is the embed path: custom SessionSurfaceStore + ModelAdapter
 * + tools, no RawAgentRuntime / daemon / AUTH_TOKEN.
 * `createTurnKernelLoopHost` is the L4 host factory over that kernel.
 */

export { prepareTurnInput, applyClaimedInbox, applyMemoryAppendixToMessages } from './prepare-turn-input.js';
export type {
  PrepareTurnInputStore,
  PrepareTurnInputDeps,
  PreparedTurnInput
} from './prepare-turn-input.js';
export {
  decideTurnRecovery,
  createTurnRecoveryState,
  noteCriticalHit,
  toolCallParts,
  isIncompleteToolCall,
  hasIncompleteToolCalls,
  hasAssistantText,
  MAX_TRUNCATION_CONTINUES,
  MAX_PROTOCOL_RETRIES,
  MAX_EMPTY_RETRIES,
  MAX_CRITICAL_HITS
} from './turn-recovery.js';
export type { RecoveryAction, TurnRecoveryState, DecideTurnRecoveryInput } from './turn-recovery.js';
export {
  prepareMessagesForModel,
  applyOptionalFoldBudget,
  capRollingSummaryText,
  compactSummaryMaxChars,
  capSessionMap,
  MAX_VISIBLE_MESSAGES
} from './prepare-view.js';
export { runSessionKernel } from './kernel.js';
export { runTurnKernel } from './embed-kernel.js';
export { createTurnKernelLoopHost } from './loop-host.js';
export type { TurnKernelLoopHostInput } from './loop-host.js';
export { adaptTurnKernelStore, createEmbedTurnHost, createEmbedTurnPrompt } from './embed-host.js';
export { resolveTurnTools } from './resolve-turn-tools.js';
export type {
  TurnKernelHost,
  TurnKernelStore,
  TurnKernelPrompt,
  RunTurnKernelInput
} from './host.js';
export {
  checkToolApprovals,
  executeToolCalls,
  filterValidToolCalls,
  processToolResults,
  runTurnWithRetries
} from './tool-dispatch.js';
export type { ToolExecResult, ToolLoopDeps } from './tool-dispatch.js';
