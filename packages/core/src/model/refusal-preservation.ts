// Re-export from @ppeng/agent-loop (SSOT)
export {
  isRefusalMessage,
  isRedirectAttempt,
  detectRefusalRedirectPattern,
  buildRefusalPreservationReminder,
  applyRefusalPreservationGuard
} from '@ppeng/agent-loop';
export type { RefusalPreservationResult } from '@ppeng/agent-loop';
