import { describe, it, expect } from 'vitest';
import { decideHitlLatch, shouldParkBeforeTools } from './hitl-latch.js';

describe('decideHitlLatch', () => {
  it('aborted wins over host steer and approval waiting', () => {
    expect(
      decideHitlLatch({
        aborted: true,
        hostLatch: 'steer',
        approval: 'waiting'
      })
    ).toEqual({ action: 'abort', reason: 'aborted' });
  });

  it('aborted wins over approval skip', () => {
    expect(decideHitlLatch({ aborted: true, approval: 'skip' })).toEqual({
      action: 'abort',
      reason: 'aborted'
    });
  });

  it('host steer wins over approval waiting', () => {
    expect(decideHitlLatch({ hostLatch: 'steer', approval: 'waiting' })).toEqual({
      action: 'steer',
      reason: 'host_steer'
    });
  });

  it('host steer wins over approval skip', () => {
    expect(decideHitlLatch({ hostLatch: 'steer', approval: 'skip' })).toEqual({
      action: 'steer',
      reason: 'host_steer'
    });
  });

  it('host waiting wins over approval skip', () => {
    expect(decideHitlLatch({ hostLatch: 'waiting', approval: 'skip' })).toEqual({
      action: 'waiting',
      reason: 'host_waiting'
    });
  });

  it('host waiting wins over approval waiting', () => {
    expect(decideHitlLatch({ hostLatch: 'waiting', approval: 'waiting' })).toEqual({
      action: 'waiting',
      reason: 'host_waiting'
    });
  });

  it('approval waiting parks when host proceeds', () => {
    expect(decideHitlLatch({ hostLatch: 'proceed', approval: 'waiting' })).toEqual({
      action: 'waiting',
      reason: 'approval_waiting'
    });
  });

  it('approval skip when host proceeds', () => {
    expect(decideHitlLatch({ hostLatch: 'proceed', approval: 'skip' })).toEqual({
      action: 'skip',
      reason: 'approval_skip'
    });
  });

  it('proceeds when both signals allow', () => {
    expect(decideHitlLatch({ hostLatch: 'proceed', approval: 'proceed' })).toEqual({
      action: 'proceed'
    });
  });

  it('proceeds when all inputs are omitted', () => {
    expect(decideHitlLatch({})).toEqual({ action: 'proceed' });
  });

  it('treats aborted=false as not aborted', () => {
    expect(decideHitlLatch({ aborted: false, approval: 'waiting' })).toEqual({
      action: 'waiting',
      reason: 'approval_waiting'
    });
  });
});

describe('shouldParkBeforeTools', () => {
  it('is false only for proceed', () => {
    expect(shouldParkBeforeTools({ action: 'proceed' })).toBe(false);
  });

  it('is true for waiting, steer, abort, and skip', () => {
    expect(shouldParkBeforeTools({ action: 'waiting' })).toBe(true);
    expect(shouldParkBeforeTools({ action: 'steer' })).toBe(true);
    expect(shouldParkBeforeTools({ action: 'abort' })).toBe(true);
    expect(shouldParkBeforeTools({ action: 'skip' })).toBe(true);
  });
});
