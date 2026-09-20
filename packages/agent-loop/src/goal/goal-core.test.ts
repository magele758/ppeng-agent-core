import { describe, expect, it } from 'vitest';
import { parseGoalEvalJson } from './parse-goal-eval.js';
import { decideGoalTurn } from './decide-goal-turn.js';
import {
  GOAL_STATUSES,
  closeReasonForEvent,
  decisionToGoalEvent,
  listGoalTransitions,
  transitionGoal,
} from './goal-state-machine.js';
import {
  describeGoalVerifySpec,
  isExecutableVerifySpec,
  isSafeRelPath,
  parseGoalVerifySpec,
  sanitizeDerivedVerifySpec,
} from './verify-spec.js';
import type { GoalEvalResult, GoalLedgerEntry } from './types.js';

const evalOf = (partial: Partial<GoalEvalResult>): GoalEvalResult => ({
  met: false,
  reason: 'r',
  source: 'llm' as GoalEvalResult['source'],
  ...partial,
});
const entry = (partial: Partial<GoalLedgerEntry>): GoalLedgerEntry => ({
  turn: 0,
  met: false,
  reason: '',
  at: 't',
  ...partial,
});

describe('parseGoalEvalJson', () => {
  it('extracts the JSON object even when wrapped in prose / code fences', () => {
    const out = parseGoalEvalJson('Sure!\n```json\n{"met": true, "reason": " done "}\n```');
    expect(out).toEqual({ met: true, reason: 'done' });
  });

  it('fills a default reason and normalizes optional fields (snake and camel case)', () => {
    expect(parseGoalEvalJson('{"met": false}')).toEqual({ met: false, reason: 'goal not met' });
    expect(
      parseGoalEvalJson(
        '{"met": false, "progress": "stalled", "missing": ["api key"], "missing_kind": "user", "steer_action": "supersede"}'
      )
    ).toEqual({
      met: false,
      reason: 'goal not met',
      progress: 'stalled',
      missing: ['api key'],
      missingKind: 'user',
      steerAction: 'supersede',
    });
    expect(parseGoalEvalJson('{"met": true, "missingKind": "tool", "steerAction": "merge"}')).toMatchObject({
      missingKind: 'tool',
      steerAction: 'merge',
    });
  });

  it('rejects garbage, arrays, non-boolean met and bad optional shapes', () => {
    expect(parseGoalEvalJson('')).toBeUndefined();
    expect(parseGoalEvalJson('not json')).toBeUndefined();
    expect(parseGoalEvalJson('[1,2]')).toBeUndefined();
    expect(parseGoalEvalJson('{"met": "yes"}')).toBeUndefined();
    expect(parseGoalEvalJson('{"met": false, "missing": [1], "progress": "flying"}')).toEqual({
      met: false,
      reason: 'goal not met',
    });
  });
});

describe('decideGoalTurn', () => {
  it('orders supersede → met → stalled → user-missing → exhausted → continue', () => {
    expect(decideGoalTurn({ evalResult: evalOf({ met: true, steerAction: 'supersede' }), steerTexts: ['x'], ledger: [] })).toEqual({
      kind: 'close',
      event: 'superseded',
      reason: 'r',
    });
    // supersede without any steer text is ignored
    expect(decideGoalTurn({ evalResult: evalOf({ met: true, steerAction: 'supersede' }), steerTexts: [], ledger: [] })).toEqual({
      kind: 'achieved',
    });
    expect(
      decideGoalTurn({
        evalResult: evalOf({ progress: 'stalled' }),
        steerTexts: [],
        ledger: [entry({ progress: 'stalled' })],
      })
    ).toMatchObject({ kind: 'close', event: 'stalled' });
    // a single stalled turn is not enough
    expect(decideGoalTurn({ evalResult: evalOf({ progress: 'stalled' }), steerTexts: [], ledger: [] })).toEqual({
      kind: 'continue',
    });
  });

  it('user-missing info: first hit continues with an unattended instruction, second hit closes', () => {
    const first = decideGoalTurn({
      evalResult: evalOf({ missingKind: 'user', missing: ['预算'] }),
      steerTexts: [],
      ledger: [],
    });
    expect(first.kind).toBe('continue');
    expect(first.kind === 'continue' && first.unattendedInstruction).toContain('预算');
    const second = decideGoalTurn({
      evalResult: evalOf({ missingKind: 'user', missing: ['预算'] }),
      steerTexts: [],
      ledger: [entry({ missingKind: 'user' })],
    });
    expect(second).toMatchObject({ kind: 'close', event: 'needs_user_unattended' });
  });

  it('closes as exhausted only when turnsUsed reaches a positive maxTurns', () => {
    expect(decideGoalTurn({ evalResult: evalOf({}), steerTexts: [], ledger: [], turnsUsed: 5, maxTurns: 5 })).toMatchObject({
      kind: 'close',
      event: 'exhausted',
    });
    expect(decideGoalTurn({ evalResult: evalOf({}), steerTexts: [], ledger: [], turnsUsed: 5, maxTurns: 0 })).toEqual({
      kind: 'continue',
    });
    expect(decideGoalTurn({ evalResult: evalOf({}), steerTexts: [], ledger: [], turnsUsed: 2, maxTurns: 5 })).toEqual({
      kind: 'continue',
    });
  });
});

describe('goal state machine', () => {
  it('follows the transition table and rejects illegal edges', () => {
    expect(transitionGoal('deriving', 'derive_ok')).toBe('active');
    expect(transitionGoal('active', 'need_user')).toBe('waiting_user');
    expect(transitionGoal('waiting_user', 'user_reply')).toBe('active');
    expect(transitionGoal('active', 'met')).toBe('achieved');
    expect(transitionGoal('unmet_closed', 'resume')).toBe('active');
    expect(() => transitionGoal('achieved', 'turn')).toThrow(/非法转移/);
    expect(() => transitionGoal('deriving', 'met')).toThrow();
  });

  it('every listed transition is valid and achieved is terminal', () => {
    const edges = listGoalTransitions();
    expect(edges.length).toBeGreaterThan(10);
    for (const e of edges) expect(transitionGoal(e.from, e.event)).toBe(e.to);
    expect(edges.filter((e) => e.from === 'achieved')).toHaveLength(0);
    expect(GOAL_STATUSES).toContain('achieved');
  });

  it('maps decisions to events and events to close reasons', () => {
    expect(decisionToGoalEvent({ kind: 'achieved' })).toBe('met');
    expect(decisionToGoalEvent({ kind: 'continue' })).toBe('turn');
    expect(decisionToGoalEvent({ kind: 'close', event: 'stalled' })).toBe('stalled');
    expect(decisionToGoalEvent({ kind: 'close', event: 'exhausted' })).toBe('exhausted');
    expect(decisionToGoalEvent({ kind: 'close', event: 'whatever' })).toBe('aborted');
    expect(closeReasonForEvent('exhausted')).toBe('exhausted');
    expect(closeReasonForEvent('turn')).toBeUndefined();
  });
});

describe('verify-spec', () => {
  it('parses files_exist / http / command shapes, inferring kind when omitted', () => {
    expect(parseGoalVerifySpec({ paths: ['a.md', ' b.md '] })).toEqual({ kind: 'files_exist', paths: ['a.md', 'b.md'] });
    expect(parseGoalVerifySpec({ kind: 'files_exist', paths: [] })).toBeUndefined();
    expect(parseGoalVerifySpec({ kind: 'http', url: ' https://x.test/health ', expectStatus: 204 })).toEqual({
      kind: 'http',
      url: 'https://x.test/health',
      expectStatus: 204,
    });
    expect(parseGoalVerifySpec({ kind: 'http', url: 'https://x', expectStatus: -1 })).toEqual({ kind: 'http', url: 'https://x' });
    expect(parseGoalVerifySpec({ command: 'npm test' })).toEqual({ kind: 'command', command: 'npm test' });
    expect(parseGoalVerifySpec({ kind: 'nope' })).toBeUndefined();
    expect(parseGoalVerifySpec('x')).toBeUndefined();
  });

  it('isSafeRelPath rejects absolute, traversal, drive and empty paths', () => {
    expect(isSafeRelPath('docs/a.md')).toBe(true);
    expect(isSafeRelPath('/etc/passwd')).toBe(false);
    expect(isSafeRelPath('~/x')).toBe(false);
    expect(isSafeRelPath('C:\\x')).toBe(false);
    expect(isSafeRelPath('a/../b')).toBe(false);
    expect(isSafeRelPath('a//b')).toBe(false);
    expect(isSafeRelPath('')).toBe(false);
    expect(isSafeRelPath('x'.repeat(300))).toBe(false);
  });

  it('sanitizeDerivedVerifySpec drops command, unsafe paths and non-http urls; caps to 8 paths', () => {
    expect(sanitizeDerivedVerifySpec({ command: 'rm -rf /' })).toBeUndefined();
    expect(sanitizeDerivedVerifySpec({ paths: ['/abs', 'ok.md', '../up'] })).toEqual({ kind: 'files_exist', paths: ['ok.md'] });
    expect(sanitizeDerivedVerifySpec({ paths: ['/abs'] })).toBeUndefined();
    const many = Array.from({ length: 12 }, (_, i) => `f${i}.md`);
    expect(sanitizeDerivedVerifySpec({ paths: many })?.paths).toHaveLength(8);
    expect(sanitizeDerivedVerifySpec({ kind: 'http', url: 'ftp://x' })).toBeUndefined();
    expect(sanitizeDerivedVerifySpec({ kind: 'http', url: 'https://x' })).toEqual({ kind: 'http', url: 'https://x' });
  });

  it('describe/isExecutable cover every kind', () => {
    expect(describeGoalVerifySpec({ kind: 'files_exist', paths: ['a'] }).label).toContain('a');
    expect(describeGoalVerifySpec({ kind: 'http', url: 'https://x' }).label).toContain('200');
    expect(describeGoalVerifySpec({ kind: 'command', command: 'ls' }).label).toContain('默认不执行');
    expect(isExecutableVerifySpec({ kind: 'files_exist', paths: [] })).toBe(false);
    expect(isExecutableVerifySpec({ kind: 'http', url: 'x' })).toBe(false);
    expect(isExecutableVerifySpec({ kind: 'command', command: '  ' })).toBe(false);
    expect(isExecutableVerifySpec({ kind: 'command', command: 'ls' })).toBe(true);
  });
});
