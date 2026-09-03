/**
 * AutoFork: on deadloop second hit (or repetition abort), rewind once
 * to the latest closed checkpoint and inject a strategy nudge.
 * Does not open a parallel session.
 */

import type { StepCheckpoint } from './checkpoint.js';

export type AutoForkTrigger = 'repetition-aborted' | 'deadloop-exhausted';

export interface AutoForkDecision {
  shouldFork: boolean;
  trigger?: AutoForkTrigger;
  checkpoint?: StepCheckpoint;
  guidance?: string;
  skipReason?: string;
}

export const AUTO_FORK_USED_KEY = 'autoForkUsed';

const DEFAULT_GUIDANCE: Record<AutoForkTrigger, string> = {
  'repetition-aborted':
    '【策略调整】刚才输出出现严重重复。请换一种表达方式或直接给出最终答案，不要重复之前的内容。',
  'deadloop-exhausted':
    '【策略调整】检测到持续卡顿。请用最简单直接的方式完成任务，避免复杂推理或工具调用死循环。'
};

export function decideAutoFork(input: {
  trigger: AutoForkTrigger;
  alreadyUsed: boolean;
  checkpoint?: StepCheckpoint;
  currentSeq: number;
}): AutoForkDecision {
  if (input.alreadyUsed) {
    return { shouldFork: false, skipReason: 'already-used' };
  }
  if (!input.checkpoint) {
    return { shouldFork: false, skipReason: 'no-checkpoint' };
  }
  if (input.currentSeq <= input.checkpoint.seq) {
    return { shouldFork: false, skipReason: 'already-at-checkpoint' };
  }
  return {
    shouldFork: true,
    trigger: input.trigger,
    checkpoint: input.checkpoint,
    guidance: DEFAULT_GUIDANCE[input.trigger]
  };
}

export function isAutoForkUsed(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.[AUTO_FORK_USED_KEY] === true;
}
