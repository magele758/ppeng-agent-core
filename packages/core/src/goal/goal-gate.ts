// Re-export from @ppeng/agent-loop (SSOT)
export {
  createGoalGateFromMetadata,
  defaultGoalMaxTurns,
  GoalGate,
  goalGateEnabled,
  readGoalLedger,
  resolveGoalCondition
} from '@ppeng/agent-loop/goal';
export type { GoalJudgeFn } from '@ppeng/agent-loop/goal';
