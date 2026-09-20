import { describe, expect, it } from 'vitest';
import { resolveLoopConfig, resolveTurnCap } from './config.js';

describe('resolveLoopConfig', () => {
  it('defaults last-turn empty tools and overflow skip appendix', () => {
    const cfg = resolveLoopConfig();
    expect(cfg.forceAnswerOnLastTurn).toBe(true);
    expect(cfg.overflowSkipAppendix).toBe(true);
    expect(cfg.stopAtToolNames).toEqual([]);
    expect(cfg.lastTurnNudge.length).toBeGreaterThan(0);
    expect(cfg.lastTurnFallback.length).toBeGreaterThan(0);
  });

  it('accepts product last-turn copy', () => {
    const cfg = resolveLoopConfig({ lastTurnNudge: '最后一轮', lastTurnFallback: '到上限了' });
    expect(cfg.lastTurnNudge).toBe('最后一轮');
    expect(cfg.lastTurnFallback).toBe('到上限了');
  });

  it('later sources override earlier ones', () => {
    const cfg = resolveLoopConfig(
      { maxTurns: 8, forceAnswerOnLastTurn: true, stopAtToolNames: ['a'] },
      { maxTurns: 0, forceAnswerOnLastTurn: false, promptCacheBustKey: 'bust', stopAtToolNames: [] }
    );
    expect(cfg.maxTurns).toBe(0);
    expect(cfg.forceAnswerOnLastTurn).toBe(false);
    expect(cfg.promptCacheBustKey).toBe('bust');
    expect(cfg.stopAtToolNames).toEqual([]);
  });
});

describe('resolveTurnCap', () => {
  it('treats 0 / negative as unlimited', () => {
    expect(resolveTurnCap(0)).toBe(Number.POSITIVE_INFINITY);
    expect(resolveTurnCap(-1)).toBe(Number.POSITIVE_INFINITY);
    expect(resolveTurnCap(4)).toBe(4);
  });
});
