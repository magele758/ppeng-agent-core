import type { GoalCloseReason, GoalStatusValue } from './types.js';

/**
 * Goal 状态机：显式转移表 + transition() 校验。
 * 非法转移 throw（编码 bug，fail-fast）。
 */

export type GoalTransitionEvent =
  | 'derive_ok'
  | 'derive_failed'
  | 'turn'
  | 'need_user'
  | 'met'
  | 'exhausted'
  | 'superseded'
  | 'aborted'
  | 'stalled'
  | 'needs_user_unattended'
  | 'user_reply'
  | 'resume';

const TRANSITIONS: Record<GoalStatusValue, Partial<Record<GoalTransitionEvent, GoalStatusValue>>> = {
  deriving: {
    derive_ok: 'active',
    derive_failed: 'unmet_closed',
    aborted: 'unmet_closed'
  },
  active: {
    turn: 'active',
    need_user: 'waiting_user',
    met: 'achieved',
    exhausted: 'unmet_closed',
    superseded: 'unmet_closed',
    aborted: 'unmet_closed',
    stalled: 'unmet_closed',
    needs_user_unattended: 'unmet_closed'
  },
  waiting_user: {
    user_reply: 'active',
    aborted: 'unmet_closed'
  },
  unmet_closed: {
    resume: 'active'
  },
  achieved: {}
};

const CLOSE_REASONS: Partial<Record<GoalTransitionEvent, GoalCloseReason>> = {
  derive_failed: 'derive_failed',
  exhausted: 'exhausted',
  superseded: 'superseded',
  aborted: 'aborted',
  stalled: 'stalled',
  needs_user_unattended: 'needs_user_unattended'
};

export const GOAL_STATUSES: readonly GoalStatusValue[] = [
  'deriving',
  'active',
  'waiting_user',
  'unmet_closed',
  'achieved'
];

export const GOAL_EVENTS: readonly GoalTransitionEvent[] = [
  'derive_ok',
  'derive_failed',
  'turn',
  'need_user',
  'met',
  'exhausted',
  'superseded',
  'aborted',
  'stalled',
  'needs_user_unattended',
  'user_reply',
  'resume'
];

export function listGoalTransitions(): Array<{
  from: GoalStatusValue;
  event: GoalTransitionEvent;
  to: GoalStatusValue;
}> {
  const out: Array<{ from: GoalStatusValue; event: GoalTransitionEvent; to: GoalStatusValue }> = [];
  for (const from of GOAL_STATUSES) {
    const row = TRANSITIONS[from];
    for (const event of GOAL_EVENTS) {
      const to = row?.[event];
      if (to) out.push({ from, event, to });
    }
  }
  return out;
}

export function transitionGoal(from: GoalStatusValue, event: GoalTransitionEvent): GoalStatusValue {
  const to = TRANSITIONS[from]?.[event];
  if (!to) {
    throw new Error(`[GoalStateMachine] 非法转移：${from} --${event}--> (无此边)`);
  }
  return to;
}

export function closeReasonForEvent(event: GoalTransitionEvent): GoalCloseReason | undefined {
  return CLOSE_REASONS[event];
}

export function decisionToGoalEvent(
  decision: { kind: 'achieved' } | { kind: 'close'; event: string } | { kind: 'continue' }
): GoalTransitionEvent {
  if (decision.kind === 'achieved') return 'met';
  if (decision.kind === 'continue') return 'turn';
  switch (decision.event) {
    case 'superseded':
      return 'superseded';
    case 'stalled':
      return 'stalled';
    case 'needs_user_unattended':
      return 'needs_user_unattended';
    case 'exhausted':
      return 'exhausted';
    default:
      return 'aborted';
  }
}
