/** Soft goal-completion gate types (absorb subset of ai-agent-node goal/). */

export type GoalEvalSource = 'model' | 'fail-open-error' | 'fail-open-parse' | 'inactive';

export interface GoalEvalResult {
  met: boolean;
  reason: string;
  source: GoalEvalSource;
  /** Optional structured fields — missing → fall back to met/reason only. */
  progress?: 'advanced' | 'stalled';
  missing?: string[];
  missingKind?: 'user' | 'tool' | 'unknown';
  steerAction?: 'merge' | 'supersede';
}

export interface GoalLedgerEntry {
  turn: number;
  met: boolean;
  reason: string;
  progress?: 'advanced' | 'stalled';
  missingKind?: 'user' | 'tool' | 'unknown';
  at: string;
}

export type GoalTurnDecision =
  | { kind: 'achieved' }
  | { kind: 'close'; event: 'superseded' | 'stalled' | 'needs_user_unattended' | 'exhausted'; reason: string }
  | { kind: 'continue'; unattendedInstruction?: string };

/** Session metadata keys for goal soft-gate. */
export const GOAL_CONDITION_META = 'goalCondition';
export const GOAL_MAX_TURNS_META = 'goalMaxTurns';
export const GOAL_TURNS_USED_META = 'goalTurnsUsed';
export const GOAL_LEDGER_META = 'goalLedger';
export const GOAL_ENABLED_META = 'goalEnabled';
