import { describe, expect, it } from 'vitest';
import {
  compensateCompletedLifo,
  createCompensationTx,
  getCurrentCompensation,
  registerToolCompensation,
  runWithCompensation,
  type CompletedWaveItem,
} from './compensation.js';
import type { RunContext, ToolContract } from '../types.js';

const ctx = {} as RunContext;

function tool(
  name: string,
  extra: Partial<ToolContract<Record<string, unknown>>> = {}
): ToolContract<Record<string, unknown>> {
  return {
    name,
    description: name,
    inputSchema: { type: 'object' },
    approvalMode: 'auto',
    sideEffectLevel: 'workspace',
    execute: async () => ({ ok: true, content: '' }),
    ...extra,
  };
}

function item(
  t: ToolContract<Record<string, unknown>>,
  toolCallId: string,
  snapshot: unknown = undefined
): CompletedWaveItem {
  return { tool: t, toolCallId, args: { id: toolCallId }, snapshot, context: ctx };
}

describe('createCompensationTx', () => {
  it('undoes registered entries in LIFO order and seals after compensation', async () => {
    const tx = createCompensationTx();
    const order: string[] = [];
    tx.register('a', 'c1', () => {
      order.push('c1');
    });
    tx.register('b', 'c2', async () => {
      order.push('c2');
    });
    tx.register('c', 'c3', () => {
      throw new Error('boom');
    });
    const out = await tx.compensateLifo();
    expect(order).toEqual(['c2', 'c1']);
    expect(out.compensated).toEqual(['c2', 'c1']);
    expect(out.failed).toEqual(['c3']);
    // Late registrations after the LIFO pass are dropped.
    tx.register('d', 'c4', () => {
      order.push('c4');
    });
    const again = await tx.compensateLifo();
    expect(again.compensated).toEqual(['c2', 'c1']);
    expect(order).toEqual(['c2', 'c1', 'c2', 'c1']);
  });
});

describe('ALS binding', () => {
  it('exposes the tx inside runWithCompensation and not outside', async () => {
    expect(getCurrentCompensation()).toBeUndefined();
    expect(registerToolCompensation('x', 'none', () => undefined)).toBe(false);
    const tx = createCompensationTx();
    const inside = await runWithCompensation(tx, async () => {
      expect(getCurrentCompensation()).toBe(tx);
      return registerToolCompensation('write_file', 'w1', () => undefined);
    });
    expect(inside).toBe(true);
    expect(getCurrentCompensation()).toBeUndefined();
    const out = await tx.compensateLifo();
    expect(out.compensated).toEqual(['w1']);
  });
});

describe('compensateCompletedLifo', () => {
  it('runs compensate hooks newest-first with the captured snapshot, skips missing hooks, reports irreversible', async () => {
    const calls: Array<{ id: string; snapshot: unknown }> = [];
    const undoable = tool('edit', {
      captureSnapshot: async () => 'snap',
      compensate: async (_c, args, snapshot) => {
        calls.push({ id: String(args.id), snapshot });
      },
    });
    const plain = tool('read', { sideEffectLevel: 'none' });
    const locked = tool('send_email', { irreversible: true });
    const failing = tool('rm', {
      compensate: async () => {
        throw new Error('cannot restore');
      },
    });

    const out = await compensateCompletedLifo([
      item(undoable, 'e1', 'snap-1'),
      item(plain, 'r1'),
      item(locked, 'm1'),
      item(failing, 'x1'),
      item(undoable, 'e2', 'snap-2'),
    ]);

    expect(calls).toEqual([
      { id: 'e2', snapshot: 'snap-2' },
      { id: 'e1', snapshot: 'snap-1' },
    ]);
    expect(out.compensated).toEqual(['e2', 'e1']);
    expect(out.irreversible).toEqual(['m1']);
    expect(out.failed).toEqual(['x1']);
  });

  it('merges in-flight ALS registrations after the wave items', async () => {
    const tx = createCompensationTx();
    const undone: string[] = [];
    const t = tool('edit', {
      compensate: async (_c, args) => {
        undone.push(String(args.id));
      },
    });
    const out = await runWithCompensation(tx, async () => {
      registerToolCompensation('nested', 'n1', () => {
        undone.push('n1');
      });
      return compensateCompletedLifo([item(t, 'e1')]);
    });
    expect(undone).toEqual(['e1', 'n1']);
    expect(out.compensated).toEqual(['e1', 'n1']);
  });
});
