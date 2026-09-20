import { describe, expect, it } from 'vitest';
import {
  createMemoryStepTx,
  rollbackReasonOf,
  turnEndReasonOf,
  uncommittedRewindAnchorSeq,
  wrapWithStepTx,
} from './step-tx.js';
import type { KernelStepInfo } from './step-tx.js';

const STEP: KernelStepInfo = { turn: 0, step: 1, kind: 'model_done' };

describe('rollbackReasonOf', () => {
  it('runError → reason', () => {
    expect(rollbackReasonOf({ runError: 'boom' })).toBe('run-error: boom');
  });

  it('repetitionAborted → reason', () => {
    expect(rollbackReasonOf({ repetitionAborted: true })).toBe('repetition-aborted: unknown');
  });

  it('runError wins over repetitionAborted', () => {
    expect(rollbackReasonOf({ runError: 'x', repetitionAborted: true })).toBe('run-error: x');
  });

  it.each([
    ['aborted', { aborted: true }],
    ['recoveredFromModelBehavior', { recoveredFromModelBehavior: true }],
    ['userStopped', { userStopped: true }],
    ['streamInterrupted', { streamInterrupted: true }],
    ['steeringInterrupted', { steeringInterrupted: true }],
    ['maxTurnsExceeded', { maxTurnsExceeded: true }],
    ['empty', {}],
  ] as const)('%s → null', (_name, input) => {
    expect(rollbackReasonOf(input)).toBeNull();
  });
});

describe('turnEndReasonOf', () => {
  it('maps flags by priority', () => {
    expect(turnEndReasonOf({})).toBe('completed');
    expect(turnEndReasonOf({ userStopped: true })).toBe('user-stopped');
    expect(turnEndReasonOf({ aborted: true })).toBe('user-stopped');
    expect(turnEndReasonOf({ maxTurnsExceeded: true })).toBe('segment-exhausted');
    expect(turnEndReasonOf({ steeringInterrupted: true })).toBe('steering-interrupted');
    expect(turnEndReasonOf({ streamInterrupted: true })).toBe('stream-interrupted');
    expect(turnEndReasonOf({ recoveredFromModelBehavior: true })).toBe('protocol-recovered');
  });

  it('userStopped wins over later flags', () => {
    expect(
      turnEndReasonOf({
        userStopped: true,
        maxTurnsExceeded: true,
        streamInterrupted: true,
      })
    ).toBe('user-stopped');
  });
});

describe('uncommittedRewindAnchorSeq', () => {
  it('returns turnStartSeq when there is no later step/end', () => {
    const events = [
      { seq: 1, type: 'turn/start' },
      { seq: 2, type: 'step/start' },
      { seq: 3, type: 'message' },
    ];
    expect(uncommittedRewindAnchorSeq(events, 1)).toBe(1);
  });

  it('returns last step/end after turnStartSeq', () => {
    const events = [
      { seq: 1, type: 'turn/start' },
      { seq: 2, type: 'step/end' },
      { seq: 3, type: 'step/start' },
      { seq: 4, type: 'step/end' },
      { seq: 5, type: 'message' },
    ];
    expect(uncommittedRewindAnchorSeq(events, 1)).toBe(4);
  });

  it('ignores step/end at or before turnStartSeq', () => {
    const events = [
      { seq: 1, type: 'step/end' },
      { seq: 5, type: 'turn/start' },
      { seq: 6, type: 'step/start' },
    ];
    expect(uncommittedRewindAnchorSeq(events, 5)).toBe(5);
  });

  it('returns turnStartSeq for an empty event list', () => {
    expect(uncommittedRewindAnchorSeq([], 7)).toBe(7);
  });
});

describe('wrapWithStepTx', () => {
  it('commits on success', async () => {
    const order: string[] = [];
    const tx = createMemoryStepTx({
      onBegin: (info) => {
        order.push(`begin:${info.kind}`);
      },
      onCommit: (info) => {
        order.push(`commit:${info.kind}`);
      },
      onRollback: () => {
        order.push('rollback');
      },
    });

    const value = await wrapWithStepTx(tx, STEP, async () => {
      order.push('fn');
      return 42;
    });

    expect(value).toBe(42);
    expect(order).toEqual(['begin:model_done', 'fn', 'commit:model_done']);
  });

  it('rollbacks on throw and rethrows', async () => {
    const order: string[] = [];
    const tx = createMemoryStepTx({
      onBegin: () => {
        order.push('begin');
      },
      onCommit: () => {
        order.push('commit');
      },
      onRollback: (reason) => {
        order.push(`rollback:${reason}`);
      },
    });

    await expect(
      wrapWithStepTx(tx, STEP, async () => {
        order.push('fn');
        throw new Error('wave failed');
      })
    ).rejects.toThrow('wave failed');

    expect(order).toEqual(['begin', 'fn', 'rollback:wave failed']);
  });

  it('missing tx just runs fn', async () => {
    const value = await wrapWithStepTx(undefined, STEP, async () => 'ok');
    expect(value).toBe('ok');
  });

  it('missing begin/commit/rollback are no-ops', async () => {
    const value = await wrapWithStepTx({}, STEP, async () => 'compat');
    expect(value).toBe('compat');

    await expect(
      wrapWithStepTx({}, STEP, async () => {
        throw new Error('still throws');
      })
    ).rejects.toThrow('still throws');
  });
});
