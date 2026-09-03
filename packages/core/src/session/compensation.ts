/**
 * Wave-level compensation (fail-soft). Side-effect tools may declare
 * `compensate` / `irreversible` / `captureSnapshot`. Missing hooks are skipped.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { RunContext, ToolContract } from '../types.js';

export interface CompensationEntry {
  name: string;
  toolCallId: string;
  undo: () => Promise<void> | void;
}

export interface CompensationTx {
  register(name: string, toolCallId: string, undo: () => Promise<void> | void): void;
  compensateLifo(): Promise<{ compensated: string[]; irreversible: string[]; failed: string[] }>;
}

interface CompensationStore {
  tx: CompensationTx;
}

const storage = new AsyncLocalStorage<CompensationStore>();

export function createCompensationTx(): CompensationTx {
  const entries: CompensationEntry[] = [];
  let sealed = false;
  return {
    register(name, toolCallId, undo) {
      if (sealed) return;
      entries.push({ name, toolCallId, undo });
    },
    async compensateLifo() {
      sealed = true;
      const compensated: string[] = [];
      const irreversible: string[] = [];
      const failed: string[] = [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const item = entries[i]!;
        try {
          await item.undo();
          compensated.push(item.toolCallId);
        } catch {
          failed.push(item.toolCallId);
        }
      }
      return { compensated, irreversible, failed };
    }
  };
}

export function runWithCompensation<T>(tx: CompensationTx, fn: () => T | Promise<T>): Promise<T> {
  return storage.run({ tx }, async () => fn());
}

export function getCurrentCompensation(): CompensationTx | undefined {
  return storage.getStore()?.tx;
}

export function registerToolCompensation(
  name: string,
  toolCallId: string,
  undo: () => Promise<void> | void
): boolean {
  const tx = storage.getStore()?.tx;
  if (!tx) return false;
  try {
    tx.register(name, toolCallId, undo);
    return true;
  } catch {
    return false;
  }
}

export interface CompletedWaveItem {
  tool: ToolContract<any>;
  toolCallId: string;
  args: Record<string, unknown>;
  snapshot: unknown;
  context: RunContext;
}

export async function compensateCompletedLifo(
  completed: CompletedWaveItem[]
): Promise<{ compensated: string[]; irreversible: string[]; failed: string[] }> {
  const compensated: string[] = [];
  const irreversible: string[] = [];
  const failed: string[] = [];
  for (let i = completed.length - 1; i >= 0; i--) {
    const item = completed[i]!;
    if (item.tool.irreversible) {
      irreversible.push(item.toolCallId);
      continue;
    }
    if (!item.tool.compensate) continue;
    try {
      await item.tool.compensate(item.context, item.args, item.snapshot);
      compensated.push(item.toolCallId);
    } catch {
      failed.push(item.toolCallId);
    }
  }
  const als = storage.getStore()?.tx;
  if (als) {
    const extra = await als.compensateLifo();
    compensated.push(...extra.compensated);
    failed.push(...extra.failed);
  }
  return { compensated, irreversible, failed };
}
