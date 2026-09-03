/**
 * Formal layer: executable invariants + PBT + TLA draft alignment.
 * Passing is not a TLC / LTL proof.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertTranscriptInvariants,
  checkNoOrphanToolResults,
  checkToolCallPairing,
  checkTranscriptInvariants,
  enumerateGoalMachine,
  listSessionTransitions,
  mulberry32,
  pick,
  times,
  transitionGoal,
  transitionSession,
  unmatchedToolCallIds
} from '../dist/exports/public.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

test('goal PBT: random legal walks stay in the machine', () => {
  const { legal } = enumerateGoalMachine();
  const byFrom = new Map();
  for (const e of legal) {
    const list = byFrom.get(e.from) ?? [];
    list.push(e);
    byFrom.set(e.from, list);
  }
  const rng = mulberry32(20260903);
  times(80, () => {
    let status = 'deriving';
    times(12, () => {
      const choices = byFrom.get(status) ?? [];
      if (!choices.length) return;
      const edge = pick(rng, choices);
      const next = transitionGoal(status, edge.event);
      assert.equal(next, edge.to);
      status = next;
    });
  });
});

test('goal PBT: illegal edges throw', () => {
  const { illegal } = enumerateGoalMachine();
  assert.ok(illegal.length > 0);
  for (const { from, event } of illegal) {
    assert.throws(() => transitionGoal(from, event), /非法转移/);
  }
});

test('session lifecycle table is closed and startable', () => {
  const edges = listSessionTransitions();
  assert.ok(edges.some((e) => e.from === 'idle' && e.event === 'start' && e.to === 'running'));
  assert.ok(edges.some((e) => e.from === 'running' && e.event === 'need_approval'));
  assert.equal(transitionSession('idle', 'start'), 'running');
  assert.throws(() => transitionSession('completed', 'start'), /illegal/);
});

test('session PBT: random legal walks stay in the table', () => {
  const edges = listSessionTransitions();
  const byFrom = new Map();
  for (const e of edges) {
    const list = byFrom.get(e.from) ?? [];
    list.push(e);
    byFrom.set(e.from, list);
  }
  const rng = mulberry32(20260903);
  times(60, () => {
    let status = 'idle';
    times(10, () => {
      const choices = byFrom.get(status) ?? [];
      if (!choices.length) return;
      const edge = pick(rng, choices);
      assert.equal(transitionSession(status, edge.event), edge.to);
      status = edge.to;
    });
  });
});

test('tool pairing: closed transcript', () => {
  const msgs = [
    { parts: [{ type: 'tool_call', toolCallId: 'a', name: 'echo', input: {} }] },
    { parts: [{ type: 'tool_result', toolCallId: 'a', name: 'echo', content: 'ok' }] }
  ];
  assert.deepEqual(unmatchedToolCallIds(msgs), []);
  assert.equal(checkToolCallPairing(msgs).ok, true);
  assert.equal(checkNoOrphanToolResults(msgs).ok, true);
  assertTranscriptInvariants(msgs);
});

test('tool pairing: open wave and orphan result', () => {
  const open = [{ parts: [{ type: 'tool_call', toolCallId: 'x', name: 'echo', input: {} }] }];
  assert.equal(checkToolCallPairing(open).ok, false);
  const orphan = [{ parts: [{ type: 'tool_result', toolCallId: 'ghost', name: 'echo', content: '?' }] }];
  assert.equal(checkNoOrphanToolResults(orphan).ok, false);
});

test('PBT: random paired transcripts stay closed', () => {
  const rng = mulberry32(7);
  times(40, (i) => {
    const n = 1 + Math.floor(rng() * 4);
    const msgs = [];
    for (let k = 0; k < n; k += 1) {
      const id = `c${i}_${k}`;
      msgs.push({
        role: 'assistant',
        parts: [{ type: 'tool_call', toolCallId: id, name: 'echo', input: {} }]
      });
      msgs.push({
        role: 'tool',
        parts: [{ type: 'tool_result', toolCallId: id, name: 'echo', content: 'ok' }]
      });
    }
    const checks = checkTranscriptInvariants(msgs);
    assert.ok(checks.every((c) => c.ok), checks.map((c) => c.detail).filter(Boolean).join('; '));
  });
});

test('TLA drafts exist and list the same Goal / Session edges as TS', () => {
  const goalTla = readFileSync(join(root, 'specs/formal/tla/GoalStateMachine.tla'), 'utf8');
  for (const e of enumerateGoalMachine().legal) {
    const needle = `${e.from} --${e.event}--> ${e.to}`;
    assert.ok(goalTla.includes(needle), `Goal TLA missing ${needle}`);
  }
  const sessTla = readFileSync(join(root, 'specs/formal/tla/SessionLifecycle.tla'), 'utf8');
  for (const e of listSessionTransitions()) {
    const needle = `${e.from} --${e.event}--> ${e.to}`;
    assert.ok(sessTla.includes(needle), `Session TLA missing ${needle}`);
  }
  readFileSync(join(root, 'specs/formal/tla/ToolCallPairing.tla'), 'utf8');
});
