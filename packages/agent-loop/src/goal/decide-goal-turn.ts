import type { GoalEvalResult, GoalLedgerEntry, GoalTurnDecision } from './types.js';

export interface GoalTurnDecisionInput {
  evalResult: GoalEvalResult;
  steerTexts: string[];
  ledger: GoalLedgerEntry[];
  /** When turnsUsed >= maxTurns and not met → exhausted close. */
  turnsUsed?: number;
  maxTurns?: number;
}

/**
 * Pure turn decision (shared by runtime + unit tests).
 * Order: supersede → met → stalled → user-missing → exhausted → continue.
 */
export function decideGoalTurn(input: GoalTurnDecisionInput): GoalTurnDecision {
  const { evalResult, steerTexts, ledger, turnsUsed, maxTurns } = input;
  const prev = ledger[ledger.length - 1];

  if (steerTexts.length > 0 && evalResult.steerAction === 'supersede') {
    return { kind: 'close', event: 'superseded', reason: evalResult.reason };
  }
  if (evalResult.met) {
    return { kind: 'achieved' };
  }
  if (evalResult.progress === 'stalled' && prev?.progress === 'stalled') {
    return {
      kind: 'close',
      event: 'stalled',
      reason: `连续多轮无实质进展，已停止续轮：${evalResult.reason}`
    };
  }
  if (evalResult.missingKind === 'user' && (evalResult.missing?.length ?? 0) > 0) {
    const missing = evalResult.missing!;
    if (prev?.missingKind === 'user') {
      return {
        kind: 'close',
        event: 'needs_user_unattended',
        reason: `目标模式下缺少必须由用户提供的信息，无法继续：${missing.join('、')}`
      };
    }
    return {
      kind: 'continue',
      unattendedInstruction:
        `当前缺少用户未提供的信息：${missing.join('、')}。` +
        `用户不在场：能以行业常规或保守假设补齐的，声明假设后继续完成目标；` +
        `确实无法合理假设的部分，如实说明缺口、完成其余部分，不要编造。`
    };
  }
  if (
    typeof turnsUsed === 'number' &&
    typeof maxTurns === 'number' &&
    maxTurns > 0 &&
    turnsUsed >= maxTurns
  ) {
    return {
      kind: 'close',
      event: 'exhausted',
      reason: `已达 goal 轮次上限 (${maxTurns})，未达成：${evalResult.reason}`
    };
  }
  return { kind: 'continue' };
}
