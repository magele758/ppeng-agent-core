import { describe, it, expect } from 'vitest';
import {
  AUTO_FORK_USED_KEY,
  decideAutoFork,
  isAutoForkUsed,
} from './auto-fork.js';

describe('recovery/auto-fork', () => {
  it('shouldFork when unused and currentSeq is past a checkpoint', () => {
    const decision = decideAutoFork({
      trigger: 'deadloop-exhausted',
      alreadyUsed: false,
      checkpoint: { seq: 2 },
      currentSeq: 5,
    });
    expect(decision.shouldFork).toBe(true);
    expect(decision.trigger).toBe('deadloop-exhausted');
    expect(decision.checkpoint).toEqual({ seq: 2 });
    expect(decision.guidance).toContain('策略调整');
    expect(decision.skipReason).toBeUndefined();
  });

  it('uses repetition-aborted guidance', () => {
    const decision = decideAutoFork({
      trigger: 'repetition-aborted',
      alreadyUsed: false,
      checkpoint: { seq: 1 },
      currentSeq: 4,
    });
    expect(decision.shouldFork).toBe(true);
    expect(decision.trigger).toBe('repetition-aborted');
    expect(decision.guidance).toContain('重复');
  });

  it('skips when already used', () => {
    expect(
      decideAutoFork({
        trigger: 'deadloop-exhausted',
        alreadyUsed: true,
        checkpoint: { seq: 2 },
        currentSeq: 5,
      })
    ).toEqual({ shouldFork: false, skipReason: 'already-used' });
  });

  it('skips when there is no checkpoint', () => {
    expect(
      decideAutoFork({
        trigger: 'repetition-aborted',
        alreadyUsed: false,
        currentSeq: 5,
      })
    ).toEqual({ shouldFork: false, skipReason: 'no-checkpoint' });
  });

  it('skips when already at the checkpoint seq', () => {
    expect(
      decideAutoFork({
        trigger: 'deadloop-exhausted',
        alreadyUsed: false,
        checkpoint: { seq: 5 },
        currentSeq: 5,
      })
    ).toEqual({ shouldFork: false, skipReason: 'already-at-checkpoint' });
    expect(
      decideAutoFork({
        trigger: 'deadloop-exhausted',
        alreadyUsed: false,
        checkpoint: { seq: 6 },
        currentSeq: 5,
      }).skipReason
    ).toBe('already-at-checkpoint');
  });

  it('isAutoForkUsed reads AUTO_FORK_USED_KEY', () => {
    expect(AUTO_FORK_USED_KEY).toBe('autoForkUsed');
    expect(isAutoForkUsed({ autoForkUsed: true })).toBe(true);
    expect(isAutoForkUsed({ autoForkUsed: false })).toBe(false);
    expect(isAutoForkUsed({})).toBe(false);
    expect(isAutoForkUsed(undefined)).toBe(false);
  });
});
