/**
 * L1: Streaming watchdogs — repetition and reasoning-spin detection.
 */

export {
  repetitionWatchdogEnabled,
  loadRepetitionWatchdogConfig,
  detectRepetitionLoop,
  RepetitionLoopAbortError,
  isRepetitionAbort,
  RepetitionStreamGuard,
} from './repetition-watchdog.js';
export type { RepetitionWatchdogConfig } from './repetition-watchdog.js';

export {
  reasoningSpinWatchdogEnabled,
  loadReasoningSpinWatchdogConfig,
  classifyAssistantParts,
  ReasoningSpinWatchdog,
} from './reasoning-spin-watchdog.js';
export type { ModelResponseKind, ReasoningSpinWatchdogConfig } from './reasoning-spin-watchdog.js';
